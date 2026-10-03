/**
 * 브라우저 API 중계 `/bff/api/{svc}/**` → `http://data2flow-api-gateway/api/v1/{svc}/**` (design/auth.md §9.2).
 * - 허용 목록의 서비스만 중계한다. auth는 넣지 않는다(토큰을 주고받는 API라 브라우저가 직접 부르면 안 된다)
 * - 요청 헤더는 허용 목록만 옮기고 Authorization은 BFF가 붙인다. 위조 신원 헤더(X-USER-ID 등)는 버린다
 * - 응답의 Set-Cookie는 버린다(gateway·auth 쿠키가 브라우저로 새지 않게)
 */
import { SessionEndedError, UpstreamUnavailableError, publicFetch, sessionFetch } from "./gateway.server";
import { errorResponse, type BffRequestContext } from "./middleware.server";

export const PROXY_SERVICES = new Set(["core", "ai"]);

const FORWARD_REQUEST_HEADERS = ["content-type", "idempotency-key", "accept"];
const FORWARD_RESPONSE_HEADERS = ["content-type", "content-disposition", "retry-after", "x-request-id", "cache-control", "content-language"];
const MAX_BODY_BYTES = 10 * 1024 * 1024;

export async function proxyRequest(request: Request, ctx: BffRequestContext, service: string, rest: string): Promise<Response> {
  const { session, runtime, meta } = ctx;
  if (!PROXY_SERVICES.has(service) || rest.split("/").some((part) => part === ".." || part === ".")) {
    return errorResponse(404, "RESOURCE_NOT_FOUND", meta.lang, meta.requestId);
  }
  if (session.expired) return errorResponse(401, "AUTH_SESSION_EXPIRED", meta.lang, meta.requestId);

  const url = new URL(request.url);
  const path = `/api/v1/${service}/${rest}${url.search}`;
  const headers: Record<string, string> = {};
  for (const name of FORWARD_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers[name] = value;
  }
  const method = request.method.toUpperCase();
  let body: ArrayBuffer | undefined;
  if (method !== "GET" && method !== "HEAD") {
    body = await request.arrayBuffer();
    if (body.byteLength > MAX_BODY_BYTES) return errorResponse(413, "INVALID_REQUEST", meta.lang, meta.requestId);
  }

  let upstream: Response;
  try {
    upstream = session.authenticated
      ? await sessionFetch(session, path, { method, headers, body })
      : await publicFetch(runtime, meta, path, { method, headers, body });
  } catch (error) {
    if (error instanceof SessionEndedError) return errorResponse(401, error.code, meta.lang, meta.requestId);
    if (error instanceof UpstreamUnavailableError) {
      const extra: Record<string, string> = error.retryAfter !== undefined ? { "Retry-After": String(error.retryAfter) } : {};
      return errorResponse(error.status, error.code, meta.lang, meta.requestId, extra);
    }
    throw error;
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
