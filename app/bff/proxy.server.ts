/**
 * 브라우저 API 중계 `/bff/api/{svc}/**` → `http://data2flow-api-gateway/api/v1/{svc}/**` (design/auth.md §9.2).
 * - 허용 목록의 서비스만 중계한다. auth는 넣지 않는다(토큰을 주고받는 API라 브라우저가 직접 부르면 안 된다)
 * - 요청 헤더는 허용 목록만 옮기고 Authorization은 BFF가 붙인다. 위조 신원 헤더(X-USER-ID 등)는 버린다
 * - 응답의 Set-Cookie는 버린다(gateway·auth 쿠키가 브라우저로 새지 않게)
 */
import { SessionEndedError, UpstreamUnavailableError, publicFetch, sessionFetch } from "./gateway.server";
import { errorResponse, type BffRequestContext } from "./middleware.server";
import { proxyStream } from "./stream-proxy.server";

export const PROXY_SERVICES = new Set(["core", "ai"]);

const FORWARD_REQUEST_HEADERS = ["content-type", "idempotency-key", "accept"];
const FORWARD_RESPONSE_HEADERS = ["content-type", "content-disposition", "retry-after", "x-request-id", "cache-control", "content-language"];
const MAX_BODY_BYTES = 10 * 1024 * 1024;
/** 데이터 가져오기 CSV(UI-TSD-03 "≤2GB") — 버퍼에 담지 않고 흘려보낸다 */
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024;
/** 큰 업로드는 gateway가 응답 머리를 보낼 때까지 오래 걸린다 */
const UPLOAD_HEADER_TIMEOUT_MS = 30 * 60_000;

/** 본문을 흘려보내는 업로드 경로(core 데이터 가져오기 multipart, API-TSD-30) */
export function isStreamingUpload(service: string, rest: string, method: string, contentType: string | null): boolean {
  return service === "core" && rest === "imports" && method === "POST" && (contentType ?? "").toLowerCase().startsWith("multipart/form-data");
}

/** 넘치면 오류로 끊는 본문 스트림 */
export function limitStream(body: ReadableStream<Uint8Array>, max: number): ReadableStream<Uint8Array> {
  let total = 0;
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        total += chunk.byteLength;
        if (total > max) controller.error(new Error("BODY_TOO_LARGE"));
        else controller.enqueue(chunk);
      },
    }),
  );
}

export async function proxyRequest(request: Request, ctx: BffRequestContext, service: string, rest: string): Promise<Response> {
  const { session, runtime, meta } = ctx;
  if (!PROXY_SERVICES.has(service) || rest.split("/").some((part) => part === ".." || part === ".")) {
    return errorResponse(404, "RESOURCE_NOT_FOUND", meta.lang, meta.requestId);
  }
  if (session.expired) return errorResponse(401, "AUTH_SESSION_EXPIRED", meta.lang, meta.requestId);
  // `/bff/api/core/stream/**`(API 문서의 BFF 표기)도 SSE 중계로 보낸다. 일반 중계는 제한 시간이 있어 오래 열 수 없다
  if (service === "core" && rest.startsWith("stream/") && request.method.toUpperCase() === "GET") return proxyStream(request, ctx, rest.slice("stream/".length));

  const url = new URL(request.url);
  const path = `/api/v1/${service}/${rest}${url.search}`;
  const headers: Record<string, string> = {};
  for (const name of FORWARD_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers[name] = value;
  }
  const method = request.method.toUpperCase();
  const streaming = isStreamingUpload(service, rest, method, request.headers.get("content-type"));
  let body: ArrayBuffer | ReadableStream<Uint8Array> | undefined;
  if (streaming) {
    if (Number(request.headers.get("content-length") ?? 0) > MAX_UPLOAD_BYTES) return errorResponse(413, "INVALID_REQUEST", meta.lang, meta.requestId);
    body = request.body ? limitStream(request.body, MAX_UPLOAD_BYTES) : undefined;
  } else if (method !== "GET" && method !== "HEAD") {
    body = await request.arrayBuffer();
    if (body.byteLength > MAX_BODY_BYTES) return errorResponse(413, "INVALID_REQUEST", meta.lang, meta.requestId);
  }

  // 제한 시간은 응답 머리까지만 센다. 본문(1년치 CSV 내려받기 등, TSD-04.01)은 브라우저가 끊을 때까지 흘려보낸다
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(new DOMException("timeout", "TimeoutError")), streaming ? UPLOAD_HEADER_TIMEOUT_MS : runtime.config.gatewayTimeoutMs);
  const onClientGone = () => abort.abort();
  request.signal?.addEventListener("abort", onClientGone, { once: true });
  let upstream: Response;
  try {
    upstream = session.authenticated
      ? await sessionFetch(session, path, { method, headers, body, signal: abort.signal })
      : await publicFetch(runtime, meta, path, { method, headers, body, signal: abort.signal });
  } catch (error) {
    request.signal?.removeEventListener("abort", onClientGone);
    if (error instanceof SessionEndedError) return errorResponse(401, error.code, meta.lang, meta.requestId);
    if (error instanceof UpstreamUnavailableError) {
      const extra: Record<string, string> = error.retryAfter !== undefined ? { "Retry-After": String(error.retryAfter) } : {};
      return errorResponse(error.status, error.code, meta.lang, meta.requestId, extra);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }

  const out = new Headers();
  for (const name of FORWARD_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) out.set(name, value);
  }
  const location = upstream.headers.get("location");
  if (location) out.set("Location", location.replace(/^(https?:\/\/[^/]+)?\/api\/v1\//, "/bff/api/"));
  if (!out.has("cache-control")) out.set("Cache-Control", "no-store");
  return new Response(upstream.body, { status: upstream.status, headers: out });
}
