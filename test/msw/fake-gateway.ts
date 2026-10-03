/**
 * BFF → gateway 호출을 흉내 내는 가짜 gateway(MSW, design/testing/frontend.md §1).
 * auth(로그인·재발급 회전·로그아웃)와 core 계정 API의 계약(design/api/IAM-api.md, OPS-api.md)을 상태와 함께 흉내 낸다.
 * 토큰은 진짜 JWT 모양(`eyJ…`)으로 만들어, 응답·HTML 어디에도 새지 않는지 검사할 수 있게 한다.
 */
import { http, HttpResponse, type HttpHandler } from "msw";
import { CoreState, type CoreRequest } from "./core-fixtures";
import { CORE_HANDLERS } from "./handlers";

export const GATEWAY = "http://gateway.test";

export interface FakeUser {
  id: string;
  loginId: string;
  password: string;
  name: string;
  email: string;
  role: string;
  permissions: string[];
  mustChangePassword?: boolean;
  mfa?: boolean;
  pending?: boolean;
  mfaSetupRequired?: boolean;
  timezone?: string;
  locale?: string;
  version: number;
}

interface RefreshRecord {
  sid: string;
  userId: string;
  rotatedAt?: number;
  next?: string;
}

export interface ReceivedRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body?: unknown;
}

import { ADMIN_PERMISSIONS, INTEGRATOR_PERMISSIONS, OPERATOR_PERMISSIONS, VIEWER_PERMISSIONS } from "../roles";
export { ADMIN_PERMISSIONS, INTEGRATOR_PERMISSIONS, OPERATOR_PERMISSIONS, VIEWER_PERMISSIONS };

function b64u(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

export function envelope(response?: unknown, code = "SUCCESS") {
  const body: Record<string, unknown> = { header: { isSuccessful: code === "SUCCESS", resultCode: code, resultMessage: code === "SUCCESS" ? "SUCCESS" : `msg:${code}` } };
  if (response !== undefined) body.response = response;
  return body;
}

export function fail(status: number, code: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  return HttpResponse.json({ ...envelope(undefined, code), ...extra }, { status, headers });
}

export class FakeGateway {
  now: () => number;
  users: FakeUser[];
  accessTtlSec = 3600;
  graceMs = 30_000;
  /** access → {sid, userId, exp} */
  readonly access = new Map<string, { sid: string; userId: string; exp: number }>();
  readonly refresh = new Map<string, RefreshRecord>();
  readonly revokedSids = new Set<string>();
  readonly sessionsOfUser = new Map<string, Set<string>>();
  readonly received: ReceivedRequest[] = [];
  /** auth가 본문에 sid·refreshToken을 넣는지(auth.md §3.2) 아니면 Set-Cookie만 쓰는지(IAM-api.md) */
  refreshInBody = false;
  /** 조직 설정 가입 신청 허용(API-IAM-74 공개 조회, IAM-01.08) */
  signupRequestEnabled = false;
  refreshCalls = 0;
  /** M2 수집 경로 core 상태(공간·기기·소스 …, core-fixtures.ts) */
  m2 = new CoreState();
  /** 열린 SSE 연결(가짜 gateway가 흘려 보낼 수 있다) */
  readonly streams = new Set<{ path: string; headers: Record<string, string>; push: (text: string) => void; close: () => void }>();
  streamCancelled = 0;
  private seq = 0;
  private readonly mfaTickets = new Map<string, string>();

  constructor(now: () => number) {
    this.now = now;
    this.users = [
      { id: "7", loginId: "kim.op", password: "Correct-Horse-9", name: "김운영", email: "kim@school.ac.kr", role: "OPERATOR", permissions: OPERATOR_PERMISSIONS, version: 1, timezone: "Asia/Seoul", locale: "ko" },
      { id: "1", loginId: "admin01", password: "Admin-Pass-123", name: "홍길동", email: "hong@school.ac.kr", role: "ADMIN", permissions: ADMIN_PERMISSIONS, version: 3, timezone: "Asia/Seoul", locale: "ko" },
      { id: "2", loginId: "boot.admin", password: "Initial-Pass-1", name: "부트", email: "boot@school.ac.kr", role: "ADMIN", permissions: ADMIN_PERMISSIONS, mustChangePassword: true, version: 1 },
      { id: "3", loginId: "totp.user", password: "Totp-Pass-123", name: "TOTP", email: "totp@school.ac.kr", role: "VIEWER", permissions: ["DEV_READ"], mfa: true, version: 1 },
      { id: "4", loginId: "pending.user", password: "Pending-Pass-1", name: "대기", email: "p@school.ac.kr", role: "VIEWER", permissions: [], pending: true, version: 1 },
      { id: "5", loginId: "mfa.admin", password: "MfaAdmin-Pass1", name: "필수", email: "m@school.ac.kr", role: "ADMIN", permissions: ADMIN_PERMISSIONS, mfaSetupRequired: true, version: 1 },
      { id: "8", loginId: "lee.int", password: "Integrator-Pass1", name: "이통합", email: "lee@school.ac.kr", role: "INTEGRATOR", permissions: INTEGRATOR_PERMISSIONS, version: 1, timezone: "Asia/Seoul", locale: "ko" },
      { id: "9", loginId: "view.er", password: "Viewer-Pass-123", name: "조회자", email: "viewer@school.ac.kr", role: "VIEWER", permissions: VIEWER_PERMISSIONS, version: 1, timezone: "Asia/Seoul", locale: "ko" },
    ];
  }

  user(loginId: string) {
    return this.users.find((u) => u.loginId === loginId) as FakeUser;
  }

  private token(kind: "ACCESS" | "REFRESH", sid: string, userId: string) {
    this.seq += 1;
    const payload = { sub: userId, org: "1", sid, jti: `${kind.toLowerCase()}-${this.seq}`, typ: kind, exp: Math.floor(this.now() / 1000) + 3600 };
    return `${b64u({ alg: "HS256", typ: "JWT", kid: "k1" })}.${b64u(payload)}.sig${this.seq}`;
  }

  private issue(user: FakeUser) {
    const sid = `sid-${user.id}-${++this.seq}`;
    const accessToken = this.token("ACCESS", sid, user.id);
    const refreshToken = this.token("REFRESH", sid, user.id);
    this.access.set(accessToken, { sid, userId: user.id, exp: this.now() + this.accessTtlSec * 1000 });
    this.refresh.set(refreshToken, { sid, userId: user.id });
    if (!this.sessionsOfUser.has(user.id)) this.sessionsOfUser.set(user.id, new Set());
    this.sessionsOfUser.get(user.id)?.add(sid);
    const body: Record<string, unknown> = { accessToken, tokenType: "Bearer", expiresIn: this.accessTtlSec, mustChangePassword: Boolean(user.mustChangePassword), mfaRequired: false };
    if (this.refreshInBody) Object.assign(body, { refreshToken, sid });
    return HttpResponse.json(envelope(body), {
      headers: { "Set-Cookie": `data2flow_refresh=${refreshToken}; Path=/api/v1/auth; HttpOnly; Secure; SameSite=Strict` },
    });
  }

  /** 관리자 강제 종료(API-IAM-24)·비밀번호 변경 등: 사용자의 모든 sid 폐기 */
  revokeUser(userId: string, except?: string) {
    for (const sid of this.sessionsOfUser.get(userId) ?? []) if (sid !== except) this.revokedSids.add(sid);
  }

  /** Access를 강제로 만료시킨다(Access 만료·Refresh 유효 상태) */
  expireAccessTokens() {
    for (const value of this.access.values()) value.exp = this.now() - 1;
  }

  private record(request: Request, body?: unknown) {
    const headers: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      headers[key] = value;
    });
    this.received.push({ method: request.method, path: new URL(request.url).pathname + new URL(request.url).search, headers, body });
  }

  private refreshCookie(request: Request) {
    const cookie = request.headers.get("cookie") ?? "";
    return /data2flow_refresh=([^;]+)/.exec(cookie)?.[1];
  }

  /** gateway 인증 필터: introspection을 흉내 낸다 */
  authenticate(request: Request): { user: FakeUser; sid: string } | Response {
    const header = request.headers.get("authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    const record = this.access.get(token);
    if (!record) return fail(401, "AUTH_TOKEN_INVALID", {}, { "WWW-Authenticate": "Bearer" });
    if (this.revokedSids.has(record.sid)) return fail(401, "AUTH_SESSION_REVOKED");
    if (record.exp <= this.now()) return fail(401, "AUTH_TOKEN_EXPIRED");
    const user = this.users.find((u) => u.id === record.userId) as FakeUser;
    return { user, sid: record.sid };
  }

  handlers(): HttpHandler[] {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- 핸들러 안에서 상태를 쓰려고 묶는다
    const gw = this;
    return [
      http.post(`${GATEWAY}/api/v1/auth/login`, async ({ request }) => {
        const body = (await request.json()) as { loginId: string; password: string };
        gw.record(request, { loginId: body.loginId });
        const user = gw.users.find((u) => u.loginId === body.loginId);
        if (!user || user.password !== body.password) return fail(401, "AUTH_INVALID_CREDENTIALS");
        if (user.pending) return fail(403, "AUTH_PENDING_APPROVAL");
        if (user.mfa) {
          const ticket = `mfa-ticket-${++gw.seq}`;
          gw.mfaTickets.set(ticket, user.id);
          return HttpResponse.json({ ...envelope({ mfaTicket: ticket }, "MFA_REQUIRED") }, { status: 401 });
        }
        return gw.issue(user);
      }),
      http.post(`${GATEWAY}/api/v1/auth/login/mfa`, async ({ request }) => {
        const body = (await request.json()) as { mfaTicket: string; code: string };
        gw.record(request);
        const userId = gw.mfaTickets.get(body.mfaTicket);
        if (!userId || body.code !== "123456") return fail(401, "MFA_CODE_INVALID");
        gw.mfaTickets.delete(body.mfaTicket);
        return gw.issue(gw.users.find((u) => u.id === userId) as FakeUser);
      }),
      http.post(`${GATEWAY}/api/v1/auth/refresh-token`, ({ request }) => {
        gw.record(request);
        gw.refreshCalls += 1;
        const presented = gw.refreshCookie(request);
        const record = presented ? gw.refresh.get(presented) : undefined;
        if (!presented || !record) return fail(401, "AUTH_TOKEN_INVALID");
        if (gw.revokedSids.has(record.sid)) return fail(401, "AUTH_SESSION_REVOKED");
        let current = presented;
        if (record.next) {
          if (gw.now() - (record.rotatedAt ?? 0) > gw.graceMs) {
            gw.revokedSids.add(record.sid);
            return fail(401, "AUTH_SESSION_REVOKED");
          }
          // GRACE: 같은 계보의 최신 토큰으로 처리
          while (gw.refresh.get(current)?.next) current = gw.refresh.get(current)?.next as string;
        }
        const next = gw.token("REFRESH", record.sid, record.userId);
        const latest = gw.refresh.get(current) as RefreshRecord;
        latest.next = next;
        latest.rotatedAt = gw.now();
        gw.refresh.set(next, { sid: record.sid, userId: record.userId });
        const accessToken = gw.token("ACCESS", record.sid, record.userId);
        gw.access.set(accessToken, { sid: record.sid, userId: record.userId, exp: gw.now() + gw.accessTtlSec * 1000 });
        return HttpResponse.json(envelope({ accessToken, expiresIn: gw.accessTtlSec }), {
          headers: { "Set-Cookie": `data2flow_refresh=${next}; Path=/api/v1/auth; HttpOnly; Secure; SameSite=Strict` },
        });
      }),
      http.post(`${GATEWAY}/api/v1/auth/logout`, ({ request }) => {
        gw.record(request);
        const presented = gw.refreshCookie(request);
        const record = presented ? gw.refresh.get(presented) : undefined;
        if (record) gw.revokedSids.add(record.sid);
        return new HttpResponse(null, { status: 204, headers: { "Set-Cookie": "data2flow_refresh=; Max-Age=0; Path=/api/v1/auth" } });
      }),
      http.get(`${GATEWAY}/api/v1/core/stream/*`, ({ request }) => gw.openStream(request)),
      http.get(`${GATEWAY}/api/v1/core/sources/:id/live`, ({ request }) => gw.openStream(request)),
      http.all(`${GATEWAY}/api/v1/core/*`, async ({ request }) => {
        const url = new URL(request.url);
        const path = url.pathname.replace("/api/v1/core", "");
        let body: unknown;
        if (!["GET", "HEAD"].includes(request.method) && (request.headers.get("content-type") ?? "").includes("json")) {
          body = await request.json().catch(() => undefined);
        }
        gw.record(request, body);
        if (path.startsWith("/password-resets") || path.startsWith("/public/") || /^\/invitations\/tok-/.test(path)) {
          return gw.publicCore(request, path, body);
        }
        const auth = gw.authenticate(request);
        if (auth instanceof Response) return auth;
        const allowedWhileChanging = path === "/accounts/me" || path === "/accounts/me/password";
        if (auth.user.mustChangePassword && !allowedWhileChanging) return fail(403, "AUTH_PASSWORD_CHANGE_REQUIRED");
        if (auth.user.mfaSetupRequired && !path.startsWith("/accounts/me/mfa")) return fail(403, "MFA_SETUP_REQUIRED");
        return gw.core(request, path, body, auth.user, auth.sid);
      }),
    ];
  }

  private publicCore(request: Request, path: string, body: unknown): Response {
    if (path === "/public/signup-settings" && request.method === "GET") {
      return HttpResponse.json(envelope({ signupRequestEnabled: this.signupRequestEnabled }));
    }
    if (path === "/password-resets" && request.method === "POST") return new HttpResponse(null, { status: 202 });
    if (/^\/password-resets\/[^/]+\/confirm$/.test(path)) {
      if (path.includes("expired")) return fail(410, "RESET_TOKEN_INVALID");
      return new HttpResponse(null, { status: 204 });
    }
    if (/^\/invitations\/tok-[^/]+$/.test(path)) {
      if (path.includes("expired")) return fail(410, "INVITATION_INVALID");
      return HttpResponse.json(envelope({ organizationName: "한빛대학교", invitedBy: "홍길동", role: "OPERATOR", email: "lee@school.ac.kr", expiresAt: "2026-10-06T05:00:00Z" }));
    }
    if (/^\/invitations\/tok-[^/]+\/login-id-availability$/.test(path)) {
      const loginId = new URL(request.url).searchParams.get("loginId");
      return HttpResponse.json(envelope({ available: !this.users.some((u) => u.loginId === loginId), reason: null }));
    }
    if (/^\/invitations\/tok-[^/]+\/accept$/.test(path)) {
      const { loginId } = body as { loginId: string };
      if (this.users.some((u) => u.loginId === loginId)) return fail(409, "LOGIN_ID_DUPLICATED");
      return HttpResponse.json(envelope({ loginId }));
    }
    return fail(404, "RESOURCE_NOT_FOUND");
  }

  /** SSE: 인증을 확인하고 열린 연결로 등록한다. 테스트는 `emit`으로 이벤트를 흘린다 */
  openStream(request: Request): Response {
    const auth = this.authenticate(request);
    this.record(request);
    if (auth instanceof Response) return auth;
    const headers: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      headers[key] = value;
    });
    const url = new URL(request.url);
    const encoder = new TextEncoder();
    let entry: { path: string; headers: Record<string, string>; push: (text: string) => void; close: () => void } | undefined;
    const body = new ReadableStream<Uint8Array>({
      start: (controller) => {
        entry = {
          path: url.pathname + url.search,
          headers,
          push: (text) => controller.enqueue(encoder.encode(text)),
          close: () => {
            try {
              controller.close();
            } catch {
              // 이미 닫힘
            }
            if (entry) this.streams.delete(entry);
          },
        };
        this.streams.add(entry);
        controller.enqueue(encoder.encode(": connected\n\n"));
      },
      cancel: () => {
        this.streamCancelled += 1;
        if (entry) this.streams.delete(entry);
      },
    });
    return new HttpResponse(body, { headers: { "Content-Type": "text/event-stream" } });
  }

  /** 열린 모든 SSE 연결에 이벤트 하나를 보낸다 */
  emit(event: string, data: unknown, id?: string) {
    const text = `${id ? `id: ${id}\n` : ""}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const stream of this.streams) stream.push(text);
  }

  closeStreams() {
    for (const stream of [...this.streams]) stream.close();
  }

  /** 테스트가 덮어쓸 수 있는 core 응답(기본은 성공 시나리오만) */
  async core(request: Request, path: string, body: unknown, user: FakeUser, sid: string): Promise<Response> {
    const m2Request: CoreRequest = { request, method: request.method, path, url: new URL(request.url), body, user, can: (p) => user.permissions.includes(p) };
    for (const handler of CORE_HANDLERS) {
      const handled = await handler(this.m2, m2Request);
      if (handled) return handled;
    }
    return this.coreM1(request, path, body, user, sid);
  }

  private coreM1(request: Request, path: string, body: unknown, user: FakeUser, sid: string): Response {
    const method = request.method;
    const admin = user.permissions.includes("IAM_MANAGE");
    if (path === "/accounts/me" && method === "GET") {
      return HttpResponse.json(
        envelope({
          id: user.id,
          loginId: user.loginId,
          email: user.email,
          name: user.name,
          phone: null,
          locale: user.locale ?? "ko",
          timezone: user.timezone ?? "Asia/Seoul",
          role: user.role,
          permissions: user.permissions,
          spaceScope: [],
          mustChangePassword: Boolean(user.mustChangePassword),
          mfaEnabled: Boolean(user.mfa),
          version: user.version,
        }),
      );
    }
    if (path === "/accounts/me" && method === "PATCH") {
      const patch = body as { baseVersion: number; timezone?: string; locale?: string; name?: string };
      if (patch.baseVersion !== user.version) return fail(409, "VERSION_CONFLICT");
      Object.assign(user, { timezone: patch.timezone ?? user.timezone, locale: patch.locale ?? user.locale, name: patch.name ?? user.name, version: user.version + 1 });
      return HttpResponse.json(envelope({ id: user.id, version: user.version }));
    }
    if (path === "/accounts/me/password" && method === "PUT") {
      const change = body as { currentPassword: string; newPassword: string; keepCurrentSession: boolean };
      if (change.currentPassword !== user.password) return fail(400, "PASSWORD_CURRENT_MISMATCH");
      user.password = change.newPassword;
      user.mustChangePassword = false;
      this.revokeUser(user.id, change.keepCurrentSession ? sid : undefined);
      return new HttpResponse(null, { status: 204 });
    }
    if (path === "/accounts/me/sessions" && method === "GET") {
      const sessions = [...(this.sessionsOfUser.get(user.id) ?? [])]
        .filter((s) => !this.revokedSids.has(s))
        .map((s, i) => ({ sid: s, userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X) Chrome/130", ip: `59.28.174.${50 + i}`, firstLoginAt: "2026-10-03T00:00:00Z", lastUsedAt: "2026-10-03T23:30:00Z", current: s === sid }));
      return HttpResponse.json(envelope(sessions));
    }
    const sessionMatch = /^\/accounts\/me\/sessions\/([^/]+)$/.exec(path);
    if (sessionMatch && method === "DELETE") {
      this.revokedSids.add(decodeURIComponent(sessionMatch[1]));
      return new HttpResponse(null, { status: 204 });
    }
    if (path === "/accounts/me/mfa/setup" && method === "POST") return HttpResponse.json(envelope({ otpauthUri: "otpauth://totp/data2flow:kim.op?secret=JBSWY3DPEHPK3PXP&issuer=data2flow", secret: "JBSW****3PXP" }));
    if (path === "/accounts/me/mfa/confirm" && method === "POST") {
      if ((body as { code: string }).code !== "123456") return fail(401, "MFA_CODE_INVALID");
      user.mfa = true;
      user.mfaSetupRequired = false;
      return HttpResponse.json(envelope({ recoveryCodes: Array.from({ length: 10 }, (_, i) => `rc-${i}-abcdef`) }));
    }
    if (!admin && (path.startsWith("/users") || path.startsWith("/invitations") || path.startsWith("/custom-roles") || path.startsWith("/security-policy") || path.startsWith("/permissions"))) {
      return fail(403, "PERMISSION_DENIED");
    }
    if (path === "/security-policy" && method === "GET") {
      return HttpResponse.json(envelope({ sessionIdleMinutes: 30, sessionAbsoluteHours: 12, accessTtlMinutes: 60, refreshTtlHours: 6, loginMaxFailures: 5, lockoutMinutes: 15, mfaRequiredRoles: [], signupRequestEnabled: false, signupAllowedDomains: [], auditRetentionDays: 365, version: 2 }));
    }
    if (path === "/custom-roles" && method === "GET") {
      return HttpResponse.json({ ...envelope(), responses: [{ id: "31", name: "시설 야간 당직", permissions: ["ALARM_HANDLE", "DEV_READ", "DEVICE_CONTROL"], assignedUsers: 1, version: 1 }], totalCount: 1 });
    }
    if (path === "/users" && method === "GET") {
      return HttpResponse.json({
        ...envelope(),
        page: 1,
        size: 50,
        totalPages: 1,
        responses: this.users.map((u) => ({ id: u.id, name: u.name, loginId: u.loginId, email: u.email, role: u.role, status: u.pending ? "PENDING_APPROVAL" : "ACTIVE", mfaEnabled: Boolean(u.mfa), lastLoginAt: "2026-10-03T00:00:00Z" })),
        totalCount: this.users.length,
      });
    }
    if (path === "/invitations" && method === "POST") {
      const { emails } = body as { emails: string[] };
      return HttpResponse.json(envelope({ results: emails.map((email, i) => ({ email, status: "CREATED", invitationId: String(100 + i) })) }));
    }
    const detail = /^\/users\/([^/]+)$/.exec(path);
    if (detail && method === "GET") {
      const target = this.users.find((u) => u.id === detail[1]);
      if (!target) return fail(404, "USER_NOT_FOUND");
      return HttpResponse.json(
        envelope({ id: target.id, loginId: target.loginId, email: target.email, name: target.name, status: "ACTIVE", role: target.role, customRoleId: null, spaceScope: [], mfaEnabled: Boolean(target.mfa), lastLoginAt: "2026-10-03T00:00:00Z", lastLoginIp: "59.28.174.54", activeSessionCount: this.sessionsOfUser.get(target.id)?.size ?? 0, createdAt: "2026-09-01T00:00:00Z", version: target.version }),
      );
    }
    const revokeAll = /^\/users\/([^/]+)\/sessions\/revoke-all$/.exec(path);
    if (revokeAll && method === "POST") {
      this.revokeUser(revokeAll[1]);
      return HttpResponse.json(envelope({ revokedSessions: this.sessionsOfUser.get(revokeAll[1])?.size ?? 0 }));
    }
    return fail(404, "RESOURCE_NOT_FOUND");
  }
}
