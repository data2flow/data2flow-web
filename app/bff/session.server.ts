/**
 * 요청 하나 동안의 BFF 세션(IAM-07.04, IAM-03.01). 쿠키를 열어 상태를 들고 있다가, 바뀌었으면 응답에 Set-Cookie를 붙인다.
 * 토큰은 이 객체 안(서버 메모리)과 암호화된 쿠키 안에만 있고, 화면 데이터로 내보내는 메서드는 없다.
 */
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { BffRuntime } from "./runtime.server";
import { SESSION_COOKIE, readCookie, seal, serializeSessionCookie, unseal, type SessionPayload } from "./session-cookie.server";

export interface RequestMeta {
  requestId: string;
  /** gateway로 넘길 Accept-Language */
  lang: string;
  /** 사용자 IP(X-Forwarded-For에서 고른 값) */
  clientIp?: string;
  userAgent?: string;
}

export type ExpiryReason = "IDLE" | "ABSOLUTE";

/** 활동 시각은 1분에 한 번만 갱신해 Set-Cookie를 줄인다 */
const TOUCH_INTERVAL_MS = 60_000;
/** 로그인 전 세션(CSRF 토큰만)의 쿠키 수명 */
const ANONYMOUS_MAX_AGE_SEC = 2 * 60 * 60;

function newCsrfToken() {
  return randomBytes(32).toString("base64url");
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export class BffSession {
  private payload: SessionPayload | null;
  private dirty = false;
  private destroyed = false;
  /** 이번 요청에서 유휴·절대 만료로 끝난 경우 그 이유 */
  readonly expired?: ExpiryReason;
  /** 만료로 끝난 세션의 Refresh(로그아웃 통보용). 응답에는 쓰지 않는다 */
  readonly expiredRefreshToken?: string;

  constructor(
    payload: SessionPayload | null,
    readonly runtime: BffRuntime,
    readonly meta: RequestMeta,
    options: { dirty?: boolean } = {},
  ) {
    this.payload = payload;
    this.dirty = options.dirty ?? false;
    if (payload?.rt) {
      const reason = this.expiryReason(payload);
      if (reason) {
        this.expired = reason;
        this.expiredRefreshToken = payload.rt;
        this.payload = null;
        this.destroyed = true;
        this.dirty = true;
      }
    }
  }

  static fromRequest(request: Request, runtime: BffRuntime, meta: RequestMeta): BffSession {
    const raw = readCookie(request.headers.get("Cookie"), SESSION_COOKIE);
    let payload = raw ? unseal(raw, runtime.config.sessionKeys) : null;
    let dirty = Boolean(raw) && !payload; // 열 수 없는 쿠키는 지운다
    if (payload?.rt) {
      const latest = runtime.rotations.latest(payload.rt);
      if (latest !== payload.rt) {
        payload = { ...payload, rt: latest };
        dirty = true;
      }
    }
    // 이전 키로 암호화된 쿠키는 현재 키로 다시 쓴다(kid 교체)
    if (raw && payload && raw.split(".")[1] !== runtime.config.sessionKeys[0].kid) dirty = true;
    const session = new BffSession(payload, runtime, meta, { dirty });
    if (dirty && !payload && raw) session.destroyed = true;
    return session;
  }

  private expiryReason(payload: SessionPayload): ExpiryReason | undefined {
    const { config, now } = this.runtime;
    const current = now();
    if (payload.iat !== undefined && current - payload.iat >= config.sessionAbsoluteHours * 3_600_000) return "ABSOLUTE";
    if (payload.la !== undefined && current - payload.la >= config.sessionIdleMinutes * 60_000) return "IDLE";
    return undefined;
  }

  get authenticated(): boolean {
    return Boolean(this.payload?.rt && this.payload.sid);
  }

  get sid(): string | undefined {
    return this.payload?.sid;
  }

  get refreshToken(): string | undefined {
    return this.payload?.rt;
  }

  get mustChangePassword(): boolean {
    return Boolean(this.payload?.mcp);
  }

  get userId(): string | undefined {
    return this.payload?.userId;
  }

  /** 대기 중인 2단계 인증 티켓(만료되면 없음) */
  get pendingMfaTicket(): string | undefined {
    const mfa = this.payload?.mfa;
    if (!mfa) return undefined;
    return mfa.exp > this.runtime.now() ? mfa.ticket : undefined;
  }

  /** CSRF 토큰. 세션이 없으면 로그인 전 세션을 만들어 발급한다 */
  csrfToken(): string {
    if (!this.payload) {
      this.payload = { csrf: newCsrfToken() };
      this.destroyed = false;
      this.dirty = true;
    }
    return this.payload.csrf;
  }

  /** 세션에 묶인 CSRF 토큰과 상수 시간 비교 */
  checkCsrf(token: string | null | undefined): boolean {
    if (!token || !this.payload) return false;
    return safeEqual(token, this.payload.csrf);
  }

  /** 마지막 활동 시각 갱신(유휴 시간 연장) */
  touch() {
    if (!this.payload?.rt) return;
    const current = this.runtime.now();
    if (this.payload.la === undefined || current - this.payload.la >= TOUCH_INTERVAL_MS) {
      this.payload.la = current;
      this.dirty = true;
    }
  }

  /** 로그인 성공: CSRF 토큰도 새로 만든다(세션 고정 방지) */
  establish(input: { sid?: string; refreshToken: string; mustChangePassword: boolean }) {
    const current = this.runtime.now();
    this.payload = {
      csrf: newCsrfToken(),
      sid: input.sid || `bff-${randomUUID()}`,
      rt: input.refreshToken,
      iat: current,
      la: current,
      mcp: input.mustChangePassword || undefined,
    };
    this.destroyed = false;
    this.dirty = true;
    return this.payload.sid as string;
  }

  setPendingMfa(ticket: string, ttlMs = 5 * 60_000) {
    this.csrfToken();
    (this.payload as SessionPayload).mfa = { ticket, exp: this.runtime.now() + ttlMs };
    this.dirty = true;
  }

  clearPendingMfa() {
    if (this.payload?.mfa) {
      delete this.payload.mfa;
      this.dirty = true;
    }
  }

  updateRefreshToken(refreshToken: string) {
    if (this.payload && this.payload.rt !== refreshToken) {
      this.payload.rt = refreshToken;
      this.dirty = true;
    }
  }

  setMustChangePassword(value: boolean) {
    if (!this.payload) return;
    if (Boolean(this.payload.mcp) !== value) {
      this.payload.mcp = value || undefined;
      this.dirty = true;
    }
  }

  setIdentity(userId: string | undefined, orgId: string | undefined) {
    if (!this.payload?.rt) return;
    if (this.payload.userId !== userId || this.payload.orgId !== orgId) {
      this.payload.userId = userId;
      this.payload.orgId = orgId;
      this.dirty = true;
    }
  }

  /** 로그아웃·폐기·만료: 쿠키를 지운다 */
  destroy() {
    this.payload = null;
    this.destroyed = true;
    this.dirty = true;
  }

  get isDestroyed() {
    return this.destroyed;
  }

  /** 바뀐 것이 있을 때만 Set-Cookie 값을 만든다 */
  commit(): string | undefined {
    if (!this.dirty) return undefined;
    const { config, now } = this.runtime;
    if (this.destroyed || !this.payload) {
      return serializeSessionCookie("", { secure: config.cookieSecure, maxAge: 0 });
    }
    let maxAge = ANONYMOUS_MAX_AGE_SEC;
    if (this.payload.rt) {
      const absoluteLeft = (this.payload.iat ?? now()) + config.sessionAbsoluteHours * 3_600_000 - now();
      maxAge = Math.min(config.refreshTtlHours * 3600, Math.floor(absoluteLeft / 1000));
    }
    const value = seal(this.payload, config.sessionKeys[0]);
    return serializeSessionCookie(value, { secure: config.cookieSecure, maxAge });
  }
}
