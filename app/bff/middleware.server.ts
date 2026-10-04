/**
 * 모든 라우트 요청 앞뒤에서 도는 BFF 미들웨어(root.tsx에 등록).
 * 1) 세션 쿠키를 열고(유휴·절대 만료 확인, IAM-03.01) 요청 컨텍스트에 둔다
 * 2) 상태를 바꾸는 요청은 CSRF 토큰 + Origin 검사(BR-IAM-22)
 * 3) 응답에 Set-Cookie(바뀐 경우만)와 보안 헤더(HSTS, CSP nonce, X-Frame-Options 등, auth.md §9.2)를 붙인다
 */
import { randomBytes } from "node:crypto";
import { createContext, type MiddlewareFunction } from "react-router";
import { createI18n, type Language } from "~/i18n";
import { logout } from "./auth-flow.server";
import type { BffConfig } from "./config.server";
import { requestMetaFrom } from "./request-meta.server";
import { getRuntime, type BffRuntime } from "./runtime.server";
import { BffSession, type RequestMeta } from "./session.server";

export interface BffRequestContext {
  session: BffSession;
  runtime: BffRuntime;
  meta: RequestMeta;
  nonce: string;
}

export const bffContext = createContext<BffRequestContext | null>(null);

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const FORM_TYPES = ["application/x-www-form-urlencoded", "multipart/form-data"];

export function isAllowedOrigin(origin: string | null, config: BffConfig): boolean {
  return Boolean(origin) && config.allowedOrigins.includes(origin as string);
}

/** 이중 제출 토큰: 헤더 `X-CSRF-TOKEN` 또는 폼 필드 `_csrf`가 세션 토큰과 같고 Origin이 웹 주소여야 한다 */
export async function verifyCsrf(request: Request, session: BffSession, config: BffConfig): Promise<boolean> {
  if (!isAllowedOrigin(request.headers.get("Origin"), config)) return false;
  let token = request.headers.get("X-CSRF-TOKEN");
  const contentType = request.headers.get("Content-Type") ?? "";
  if (!token && FORM_TYPES.some((type) => contentType.startsWith(type))) {
    try {
      const value = (await request.clone().formData()).get("_csrf");
      token = typeof value === "string" ? value : null;
    } catch {
      token = null;
    }
  }
  return session.checkCsrf(token);
}

export function errorResponse(status: number, code: string, lang: string, requestId: string, extraHeaders: Record<string, string> = {}) {
  const t = createI18n(lang as Language).t;
  const body = { header: { isSuccessful: false, resultCode: code, resultMessage: t(`errors.${code}`, { defaultValue: code, n: extraHeaders["Retry-After"] ?? "" }) } };
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-REQUEST-ID": requestId, ...extraHeaders },
  });
}

export function contentSecurityPolicy(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
}

function withMutableHeaders(response: Response): Response {
  try {
    response.headers.set("X-Content-Type-Options", "nosniff");
    return response;
  } catch {
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers: new Headers(response.headers) });
  }
}

export function applySecurityHeaders(response: Response, config: BffConfig, nonce: string): Response {
  const out = withMutableHeaders(response);
  const headers = out.headers;
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (config.cookieSecure) headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  const contentType = headers.get("Content-Type") ?? "";
  if (contentType.startsWith("text/html")) {
    headers.set("Cache-Control", "private, no-store");
    // 개발 서버(Vite HMR)는 nonce 없는 스크립트를 넣으므로 CSP는 운영 빌드에서만 건다
    if (config.contentSecurityPolicy) headers.set("Content-Security-Policy", contentSecurityPolicy(nonce));
  }
  return out;
}

export const bffMiddleware: MiddlewareFunction<Response> = async ({ request, context }, next) => {
  const url = new URL(request.url);
  if (url.pathname === "/healthz") return next();

  const runtime = await getRuntime();
  // 메신저 콜백(서버 간 호출)은 세션 쿠키·CSRF 대상이 아니다. 채널별 비밀값 검증은 라우트가 한다(auth.md §9.3)
  if (url.pathname.startsWith("/hooks/")) return applySecurityHeaders(await next(), runtime.config, randomBytes(16).toString("base64"));

  const meta = requestMetaFrom(request, runtime.config.trustedProxyHops);
  const session = BffSession.fromRequest(request, runtime, meta);
  const nonce = randomBytes(16).toString("base64");
  context.set(bffContext, { session, runtime, meta, nonce });

  if (session.expired && session.expiredRefreshToken) {
    // 유휴·절대 만료: auth에도 폐기를 알린다(실패해도 쿠키는 이미 지움)
    await logout(session, session.expiredRefreshToken);
  }

  let response: Response;
  if (!SAFE_METHODS.has(request.method.toUpperCase()) && !(await verifyCsrf(request, session, runtime.config))) {
    response = errorResponse(403, "AUTH_CSRF_INVALID", meta.lang, meta.requestId);
  } else {
    session.touch();
    response = await next();
  }

  response = applySecurityHeaders(response, runtime.config, nonce);
  const cookie = session.commit();
  if (cookie) response.headers.append("Set-Cookie", cookie);
  if (!response.headers.has("X-REQUEST-ID")) response.headers.set("X-REQUEST-ID", meta.requestId);
  return response;
};

/** 라우트 loader·action에서 BFF 컨텍스트를 꺼낸다 */
export function bff(context: { get: <T>(key: ReturnType<typeof createContext<T>>) => T }): BffRequestContext {
  const value = context.get(bffContext);
  if (!value) throw new Error("bff middleware is not installed");
  return value;
}
