/**
 * BFF → gateway 호출(design/auth.md §9.2). Access 토큰은 서버 캐시에서 꺼내 `Authorization: Bearer`로만 붙인다.
 * - 캐시에 없으면 세션 쿠키 안의 Refresh로 재발급(회전, single-flight)
 * - gateway 401 `AUTH_TOKEN_EXPIRED` → 재발급 후 1회 재시도
 * - `AUTH_SESSION_REVOKED`·`AUTH_TOKEN_INVALID`·`AUTH_SESSION_EXPIRED` → 세션 쿠키 삭제, SessionEndedError
 * 브라우저가 보낸 신원 헤더(X-USER-ID 등)는 넘기지 않는다. 허용한 헤더만 새로 만들어 보낸다(AT-IAM-21.3).
 */
import type { ApiEnvelope, ApiFailure, ResultHeader } from "~/lib/api-types";
import type { BffRuntime, RefreshedTokens } from "./runtime.server";
import type { BffSession, RequestMeta } from "./session.server";

export const REFRESH_COOKIE = "data2flow_refresh";

/** 세션이 끝났다는 gateway·auth 응답 코드 */
export const SESSION_END_CODES = new Set(["AUTH_SESSION_REVOKED", "AUTH_TOKEN_INVALID", "AUTH_SESSION_EXPIRED"]);

export class SessionEndedError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "SessionEndedError";
  }
}

/** gateway·auth 장애. 세션은 지우지 않는다(fail-closed, BR-IAM-24) */
export class UpstreamUnavailableError extends Error {
  constructor(
    readonly code = "SERVICE_UNAVAILABLE",
    readonly status = 503,
    readonly retryAfter?: number,
  ) {
    super(code);
    this.name = "UpstreamUnavailableError";
  }
}

export interface GatewayInit {
  method?: string;
  body?: BodyInit | null;
  /** 허용 목록을 거친 헤더만 넣는다 */
  headers?: Record<string, string>;
}

/** gateway로 보내는 기본 헤더. 사용자 IP는 BFF가 정한 값으로 X-Forwarded-For를 다시 쓴다(auth.md §5) */
export function baseHeaders(meta: RequestMeta, extra: Record<string, string> = {}): Headers {
  const headers = new Headers();
  headers.set("Accept", "application/json");
  headers.set("Accept-Language", meta.lang);
  headers.set("X-REQUEST-ID", meta.requestId);
  if (meta.clientIp) headers.set("X-Forwarded-For", meta.clientIp);
  if (meta.userAgent) headers.set("User-Agent", meta.userAgent);
  for (const [name, value] of Object.entries(extra)) headers.set(name, value);
  return headers;
}

export async function rawFetch(runtime: BffRuntime, path: string, init: RequestInit): Promise<Response> {
  try {
    return await runtime.fetch(`${runtime.config.gatewayUrl}${path}`, {
      ...init,
      redirect: "manual",
      signal: AbortSignal.timeout(runtime.config.gatewayTimeoutMs),
    });
  } catch {
    throw new UpstreamUnavailableError();
  }
}

/** 응답 본문을 공통 형식으로 읽는다. JSON이 아니면 상태 코드로 머리를 만든다 */
export async function readEnvelope<T>(response: Response): Promise<ApiEnvelope<T>> {
  const text = await response.text().catch(() => "");
  if (text) {
    try {
      const parsed = JSON.parse(text) as ApiEnvelope<T>;
      if (parsed && typeof parsed === "object" && parsed.header) return parsed;
      if (response.ok) return { header: successHeader(), response: parsed as T };
    } catch {
      // 아래에서 상태 코드로 만든다
    }
  }
  return { header: response.ok ? successHeader() : fallbackHeader(response.status) };
}

function successHeader(): ResultHeader {
  return { isSuccessful: true, resultCode: "SUCCESS", resultMessage: "SUCCESS" };
}

export function fallbackHeader(status: number): ResultHeader {
  const code =
    status === 401
      ? "AUTH_TOKEN_INVALID"
      : status === 403
        ? "PERMISSION_DENIED"
        : status === 404
          ? "RESOURCE_NOT_FOUND"
          : status === 409
            ? "VERSION_CONFLICT"
            : status === 429
              ? "RATE_LIMITED"
              : status === 503
                ? "SERVICE_UNAVAILABLE"
                : status >= 500
                  ? "INTERNAL_ERROR"
                  : "INVALID_REQUEST";
  return { isSuccessful: false, resultCode: code, resultMessage: code };
}

export function retryAfterOf(response: Response): number | undefined {
  const raw = response.headers.get("Retry-After");
  if (!raw) return undefined;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.ceil(seconds) : undefined;
}

export function toFailure(status: number, envelope: ApiEnvelope<unknown>, retryAfter?: number): ApiFailure {
  return {
    ok: false,
    status,
    code: envelope.header?.resultCode ?? fallbackHeader(status).resultCode,
    message: envelope.header?.resultMessage ?? "",
    errors: envelope.errors,
    retryAfter,
  };
}

/** Set-Cookie 목록에서 data2flow_refresh 값을 꺼낸다(API-IAM-01·02 응답) */
export function refreshFromSetCookie(response: Response): string | undefined {
  const cookies = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  for (const cookie of cookies) {
    const first = cookie.split(";")[0];
    const index = first.indexOf("=");
    if (index > 0 && first.slice(0, index).trim() === REFRESH_COOKIE) {
      const value = first.slice(index + 1).trim();
      return value || undefined;
    }
  }
  return undefined;
}

async function peekCode(response: Response): Promise<string | undefined> {
  try {
    const envelope = await readEnvelope(response.clone());
    return envelope.header?.resultCode;
  } catch {
    return undefined;
  }
}

/**
 * Refresh로 Access를 다시 받는다(API-IAM-02). 같은 Refresh로 동시에 들어온 요청은 한 번만 보낸다.
 */
export async function refreshTokens(runtime: BffRuntime, meta: RequestMeta, refreshToken: string): Promise<RefreshedTokens> {
  const pending = runtime.inflight.get(refreshToken);
  if (pending) return pending;
  const task = (async () => {
    const headers = baseHeaders(meta, { Cookie: `${REFRESH_COOKIE}=${refreshToken}`, "Content-Type": "application/json" });
    const response = await rawFetch(runtime, "/api/v1/auth/refresh-token", { method: "POST", headers, body: "{}" });
    const nextFromCookie = refreshFromSetCookie(response);
    const envelope = await readEnvelope<{ accessToken?: string; expiresIn?: number; refreshToken?: string }>(response);
    if (!response.ok || !envelope.response?.accessToken) {
      const code = envelope.header?.resultCode ?? fallbackHeader(response.status).resultCode;
      if (response.status === 401 || SESSION_END_CODES.has(code)) throw new SessionEndedError(SESSION_END_CODES.has(code) ? code : "AUTH_TOKEN_INVALID");
      throw new UpstreamUnavailableError(code, response.status >= 500 ? 503 : response.status, retryAfterOf(response));
    }
    const next = envelope.response.refreshToken || nextFromCookie || refreshToken;
    const expiresIn = Number(envelope.response.expiresIn ?? 3600);
    const tokens: RefreshedTokens = {
      accessToken: envelope.response.accessToken,
      expiresAt: runtime.now() + expiresIn * 1000,
      refreshToken: next,
    };
    runtime.rotations.record(refreshToken, next);
    return tokens;
  })();
  runtime.inflight.set(refreshToken, task);
  try {
    return await task;
  } finally {
    runtime.inflight.delete(refreshToken);
  }
}

/** 세션의 Access를 확보한다(캐시 → 재발급) */
export async function ensureAccessToken(session: BffSession, forceRefresh = false): Promise<string> {
  const { runtime } = session;
  const sid = session.sid;
  const refreshToken = session.refreshToken;
  if (!sid || !refreshToken) throw new SessionEndedError("AUTH_TOKEN_INVALID");
  if (!forceRefresh) {
    const cached = await runtime.store.get(sid);
    if (cached) return cached.token;
  }
  try {
    const tokens = await refreshTokens(runtime, session.meta, refreshToken);
    await runtime.store.set(sid, { token: tokens.accessToken, expiresAt: tokens.expiresAt });
    session.updateRefreshToken(tokens.refreshToken);
    return tokens.accessToken;
  } catch (error) {
    if (error instanceof SessionEndedError) {
      await runtime.store.delete(sid);
      session.destroy();
    }
    throw error;
  }
}

/**
 * 로그인한 세션으로 gateway를 부른다. 401 AUTH_TOKEN_EXPIRED는 재발급 후 1회 재시도하고,
 * 세션 종료 코드는 쿠키를 지운 뒤 SessionEndedError를 던진다.
 */
export async function sessionFetch(session: BffSession, path: string, init: GatewayInit = {}): Promise<Response> {
  if (!session.authenticated) throw new SessionEndedError("AUTH_TOKEN_INVALID");
  const send = async (token: string) => {
    const headers = baseHeaders(session.meta, init.headers);
    headers.set("Authorization", `Bearer ${token}`);
    return rawFetch(session.runtime, path, { method: init.method ?? "GET", headers, body: init.body ?? undefined });
  };
  let response = await send(await ensureAccessToken(session));
  if (response.status === 401) {
    const code = await peekCode(response);
    if (code === "AUTH_TOKEN_EXPIRED") {
      response = await send(await ensureAccessToken(session, true));
    }
  }
  if (response.status === 401) {
    const code = (await peekCode(response)) ?? "AUTH_TOKEN_INVALID";
    if (SESSION_END_CODES.has(code) || code === "AUTH_TOKEN_EXPIRED") {
      if (session.sid) await session.runtime.store.delete(session.sid);
      session.destroy();
      throw new SessionEndedError(code === "AUTH_TOKEN_EXPIRED" ? "AUTH_TOKEN_INVALID" : code);
    }
  }
  return response;
}

/** 세션 없이(공개 경로) gateway를 부른다 */
export async function publicFetch(runtime: BffRuntime, meta: RequestMeta, path: string, init: GatewayInit = {}): Promise<Response> {
  return rawFetch(runtime, path, { method: init.method ?? "GET", headers: baseHeaders(meta, init.headers), body: init.body ?? undefined });
}
