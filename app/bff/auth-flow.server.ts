/**
 * 로그인·2단계 인증·로그아웃(UI-IAM-01, API-IAM-01·62·03). 브라우저는 BFF의 `/login` 폼만 쓰고,
 * BFF가 gateway의 `/api/v1/auth/**`를 부른다. 받은 토큰은 서버 캐시와 암호화 쿠키에만 둔다(IAM-07.04).
 */
import type { ApiFailure } from "~/lib/api-types";
import {
  REFRESH_COOKIE,
  baseHeaders,
  rawFetch,
  readEnvelope,
  refreshFromSetCookie,
  retryAfterOf,
  toFailure,
} from "./gateway.server";
import type { BffSession } from "./session.server";

interface TokenResponse {
  accessToken?: string;
  tokenType?: string;
  expiresIn?: number;
  mustChangePassword?: boolean;
  mfaRequired?: boolean;
  /** auth.md §3.2는 본문에 refreshToken·sid를 둔다고 적었다. 있으면 쓰고, 없으면 Set-Cookie를 본다 */
  refreshToken?: string;
  sid?: string;
  mfaTicket?: string;
}

export type LoginOutcome =
  | { kind: "ok"; mustChangePassword: boolean }
  | { kind: "mfa" }
  | ({ kind: "error" } & ApiFailure);

async function establishFrom(session: BffSession, response: Response): Promise<LoginOutcome> {
  const refreshCookie = refreshFromSetCookie(response);
  const envelope = await readEnvelope<TokenResponse>(response);
  const body = envelope.response;
  if (response.ok && body?.accessToken) {
    const refreshToken = body.refreshToken || refreshCookie;
    if (!refreshToken) {
      // Refresh가 없으면 세션을 유지할 수 없다. 토큰을 버리고 실패로 처리한다
      return { kind: "error", ok: false, status: 503, code: "AUTH_UNAVAILABLE", message: "" };
    }
    const mustChangePassword = Boolean(body.mustChangePassword);
    const sid = session.establish({ sid: body.sid, refreshToken, mustChangePassword });
    const expiresIn = Number(body.expiresIn ?? 3600);
    await session.runtime.store.set(sid, { token: body.accessToken, expiresAt: session.runtime.now() + expiresIn * 1000 });
    return { kind: "ok", mustChangePassword };
  }
  if (response.status === 401 && envelope.header?.resultCode === "MFA_REQUIRED" && body?.mfaTicket) {
    session.setPendingMfa(body.mfaTicket);
    return { kind: "mfa" };
  }
  return { kind: "error", ...toFailure(response.status, envelope, retryAfterOf(response)) };
}

export async function login(session: BffSession, loginId: string, password: string): Promise<LoginOutcome> {
  const headers = baseHeaders(session.meta, { "Content-Type": "application/json" });
  const response = await rawFetch(session.runtime, "/api/v1/auth/login", {
    method: "POST",
    headers,
    body: JSON.stringify({ loginId: loginId.trim().toLowerCase(), password }),
  });
  return establishFrom(session, response);
}

export async function verifyMfa(session: BffSession, code: string): Promise<LoginOutcome> {
  const ticket = session.pendingMfaTicket;
  if (!ticket) {
    session.clearPendingMfa();
    return { kind: "error", ok: false, status: 401, code: "MFA_TICKET_EXPIRED", message: "" };
  }
  const headers = baseHeaders(session.meta, { "Content-Type": "application/json" });
  const response = await rawFetch(session.runtime, "/api/v1/auth/login/mfa", {
    method: "POST",
    headers,
    body: JSON.stringify({ mfaTicket: ticket, code: code.trim() }),
  });
  const outcome = await establishFrom(session, response);
  if (outcome.kind === "ok") session.clearPendingMfa();
  return outcome;
}

/** 로그아웃(API-IAM-03, 멱등). auth 장애여도 쿠키와 캐시는 지운다 */
export async function logout(session: BffSession, refreshToken = session.refreshToken): Promise<void> {
  const sid = session.sid;
  if (refreshToken) {
    const cached = sid ? await session.runtime.store.get(sid) : undefined;
    const extra: Record<string, string> = { Cookie: `${REFRESH_COOKIE}=${refreshToken}`, "Content-Type": "application/json" };
    if (cached) extra.Authorization = `Bearer ${cached.token}`;
    try {
      const response = await rawFetch(session.runtime, "/api/v1/auth/logout", {
        method: "POST",
        headers: baseHeaders(session.meta, extra),
        body: "{}",
      });
      await response.body?.cancel().catch(() => {});
    } catch {
      // 폐기 통보 실패는 쿠키 삭제를 막지 않는다. Refresh는 6시간 뒤 만료되고 쿠키가 없어 다시 쓸 수 없다
    }
  }
  if (sid) await session.runtime.store.delete(sid);
  session.destroy();
}
