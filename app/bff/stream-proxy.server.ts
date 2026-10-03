/**
 * 실시간 연결 중계 `/bff/stream/**` (design/auth.md §8·§9.2, IAM-07.06, DSH-05.01).
 * 브라우저는 세션 쿠키만으로 `EventSource`를 열고, BFF가 세션의 Access 토큰을 붙여 gateway의 SSE에 연결한 뒤 본문을 그대로 흘려 보낸다.
 * - 허용 목록 경로만 중계한다(실시간 구독 API-DSH-20 `/stream/live`, 소스 원본 메시지 API-DSC-10 `/stream/sources/{id}/live`)
 * - 공통 이벤트 `ready`(받아들인·거부한 토픽)와 15초 `ping`도 그대로 흘린다
 * - 브라우저가 연결을 끊으면(request.signal) gateway 연결도 끊는다
 * - 연결을 맺기 전 Access가 만료되었으면 재발급 후 다시 연결한다(sessionFetch). 연결 중 만료·폐기는 서버가 끊고, 브라우저가 다시 연결한다
 * - 세션이 끝났으면 401과 결과 코드(쿠키 삭제)를 돌려준다. 클라이언트는 다시 연결하지 않고 로그인 화면으로 간다
 */
import { SessionEndedError, UpstreamUnavailableError, readEnvelope, sessionFetch } from "./gateway.server";
import { errorResponse, type BffRequestContext } from "./middleware.server";

/** 브라우저 경로 → gateway 경로 */
export function streamTarget(rest: string, search: string): string | undefined {
  const clean = rest.replace(/^\/+|\/+$/g, "");
  if (clean.split("/").some((part) => part === ".." || part === "." || part === "")) return undefined;
  // core의 SSE는 모두 `/api/v1/core/stream/**`에 있다: 실시간 구독(API-DSH-20), 소스 원본 메시지(API-DSC-10)
  if (clean === "live" || /^sources\/\d{1,19}\/live$/.test(clean)) return `/api/v1/core/stream/${clean}${search}`;
  return undefined;
}

export async function proxyStream(request: Request, ctx: BffRequestContext, rest: string): Promise<Response> {
  const { session, runtime, meta } = ctx;
  const url = new URL(request.url);
  const path = streamTarget(rest, url.search);
  if (!path) return errorResponse(404, "RESOURCE_NOT_FOUND", meta.lang, meta.requestId);
  if (!session.authenticated) return errorResponse(401, session.expired ? "AUTH_SESSION_EXPIRED" : "AUTH_TOKEN_INVALID", meta.lang, meta.requestId);

  const headers: Record<string, string> = { Accept: "text/event-stream" };
  const lastEventId = request.headers.get("Last-Event-ID");
  if (lastEventId && lastEventId.length <= 200) headers["Last-Event-ID"] = lastEventId;

  // 연결을 맺을 때까지만 제한 시간을 둔다. 맺은 뒤에는 브라우저가 끊을 때까지 연다
  const controller = new AbortController();
  const onClientAbort = () => controller.abort();
  request.signal.addEventListener("abort", onClientAbort, { once: true });
  const connectTimer = setTimeout(() => controller.abort(), runtime.config.gatewayTimeoutMs);

  let upstream: Response;
  try {
    upstream = await sessionFetch(session, path, { method: "GET", headers, signal: controller.signal });
  } catch (error) {
    request.signal.removeEventListener("abort", onClientAbort);
    if (error instanceof SessionEndedError) return errorResponse(401, error.code, meta.lang, meta.requestId);
    if (error instanceof UpstreamUnavailableError) return errorResponse(error.status, error.code, meta.lang, meta.requestId);
    throw error;
  } finally {
    clearTimeout(connectTimer);
  }

  const contentType = upstream.headers.get("content-type") ?? "";
  if (!upstream.ok || !contentType.startsWith("text/event-stream") || !upstream.body) {
    request.signal.removeEventListener("abort", onClientAbort);
    const envelope = await readEnvelope(upstream);
    const code = upstream.ok ? "SERVICE_UNAVAILABLE" : envelope.header.resultCode;
    return errorResponse(upstream.ok ? 502 : upstream.status, code, meta.lang, meta.requestId);
  }

  const reader = upstream.body.getReader();
  const body = new ReadableStream<Uint8Array>({
    async pull(out) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          request.signal.removeEventListener("abort", onClientAbort);
          out.close();
        } else out.enqueue(value);
      } catch {
        // gateway가 끊었거나 브라우저가 떠났다. 브라우저 쪽은 다시 연결한다
        request.signal.removeEventListener("abort", onClientAbort);
        out.close();
      }
    },
    cancel() {
      controller.abort();
      request.signal.removeEventListener("abort", onClientAbort);
      return reader.cancel().catch(() => undefined);
    },
  });
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
      "X-REQUEST-ID": meta.requestId,
    },
  });
}
