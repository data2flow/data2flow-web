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
