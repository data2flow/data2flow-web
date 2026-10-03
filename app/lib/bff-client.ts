/**
 * 브라우저에서 BFF API를 부를 때 쓰는 fetch(`/bff/api/{svc}/**`). 토큰은 다루지 않고,
 * 상태를 바꾸는 요청에 CSRF 토큰(`X-CSRF-TOKEN`, 페이지의 meta 태그)을 붙인다(BR-IAM-22).
 * 401이면 다른 탭에도 알리고 로그인 화면으로 보낸다.
 */
import { announceLogout } from "./session-broadcast";

export function csrfTokenFromDocument(doc: Document | undefined = typeof document === "undefined" ? undefined : document): string | undefined {
  return doc?.querySelector('meta[name="csrf-token"]')?.getAttribute("content") ?? undefined;
}

export interface BffFetchOptions {
  fetchImpl?: typeof fetch;
  csrfToken?: string;
  onUnauthorized?: (code: string) => void;
}

export async function bffFetch(path: string, init: RequestInit = {}, options: BffFetchOptions = {}): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers);
  if (!["GET", "HEAD"].includes(method)) {
    const token = options.csrfToken ?? csrfTokenFromDocument();
    if (token) headers.set("X-CSRF-TOKEN", token);
  }
  const response = await (options.fetchImpl ?? fetch)(path, { ...init, headers, credentials: "same-origin" });
  if (response.status === 401) {
    const body = (await response.clone().json().catch(() => null)) as { header?: { resultCode?: string } } | null;
    const code = body?.header?.resultCode ?? "AUTH_TOKEN_INVALID";
    announceLogout(code);
    options.onUnauthorized?.(code);
  }
  return response;
}

export type BffJsonResult<T> = { ok: true; status: number; data: T } | { ok: false; status: number; code: string; message: string; errors?: { field: string; code: string; message: string }[] };

/**
 * 브라우저에서 JSON API를 부르고 공통 응답 형식(api-rules §3)을 푼다. 본문이 있으면 JSON으로 보낸다.
 * 목록 응답은 `response` 대신 봉투 전체(`responses`, `totalCount` …)를 돌려준다.
 */
export async function bffJson<T>(path: string, init: { method?: string; body?: unknown; idempotencyKey?: string; signal?: AbortSignal } = {}, options: BffFetchOptions = {}): Promise<BffJsonResult<T>> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  if (init.idempotencyKey) headers["Idempotency-Key"] = init.idempotencyKey;
  let response: Response;
  try {
    response = await bffFetch(path, { method: init.method ?? "GET", headers, body: init.body === undefined ? undefined : JSON.stringify(init.body), signal: init.signal }, options);
  } catch {
    return { ok: false, status: 0, code: "SERVICE_UNAVAILABLE", message: "" };
  }
  if (response.status === 204) return { ok: true, status: 204, data: undefined as T };
  const body = (await response.json().catch(() => null)) as { header?: { resultCode?: string; resultMessage?: string }; response?: unknown; responses?: unknown; errors?: { field: string; code: string; message: string }[] } | null;
  if (response.ok) {
    const data = body && "responses" in body ? body : (body?.response ?? body);
    return { ok: true, status: response.status, data: data as T };
  }
  return { ok: false, status: response.status, code: body?.header?.resultCode ?? "UNKNOWN", message: body?.header?.resultMessage ?? "", errors: body?.errors };
}

/** 쓰기 요청의 멱등 키(브라우저) */
export function clientIdempotencyKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `k-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
