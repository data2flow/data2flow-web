/**
 * BFF 토큰 처리 단위 테스트(design/testing/frontend.md §3.1 token-cache·proxy·csrf).
 */
import { http, HttpResponse } from "msw";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { login, logout, verifyMfa } from "../auth-flow.server";
import { SessionEndedError, UpstreamUnavailableError, ensureAccessToken, fallbackHeader, publicFetch, readEnvelope, refreshFromSetCookie, sessionFetch } from "../gateway.server";
import { RotationLog } from "../runtime.server";
import { cookieValue, setup } from "./helpers";

const t = setup();
beforeAll(() => t.server.listen({ onUnhandledFrame: "error" }));
afterAll(() => t.server.close());
beforeEach(() => t.reset());

async function loggedIn(loginId = "kim.op", password = "Correct-Horse-9") {
  const session = t.session();
  const outcome = await login(session, loginId, password);
  expect(outcome.kind).toBe("ok");
  return cookieValue(session.commit());
}

describe("IAM-07.04 로그인 → 세션 수립", () => {
  it("Set-Cookie data2flow_refresh(IAM-api)를 쿠키 안에 보관하고 Access는 서버 캐시에", async () => {
    const session = t.session();
    expect(await login(session, " KIM.OP ", "Correct-Horse-9")).toEqual({ kind: "ok", mustChangePassword: false });
    expect(session.authenticated).toBe(true);
    expect(session.refreshToken).toMatch(/^eyJ/);
    expect(await t.state.runtime.store.get(session.sid as string)).toBeDefined();
  });

  it("본문 refreshToken·sid(auth.md §3.2)도 받는다", async () => {
    t.state.gateway.refreshInBody = true;
    const session = t.session();
    await login(session, "kim.op", "Correct-Horse-9");
    expect(session.sid).toMatch(/^sid-7-/);
  });

  it("Refresh가 없으면 세션을 만들지 않는다(AUTH_UNAVAILABLE)", async () => {
    t.server.use(http.post("http://gateway.test/api/v1/auth/login", () => HttpResponse.json({ header: { isSuccessful: true, resultCode: "SUCCESS", resultMessage: "SUCCESS" }, response: { accessToken: "eyJx.eyJy.z", expiresIn: 3600 } })));
    const session = t.session();
    expect(await login(session, "kim.op", "x")).toMatchObject({ kind: "error", code: "AUTH_UNAVAILABLE" });
    expect(session.authenticated).toBe(false);
  });

  it("MFA: 티켓은 세션 안에만, 만료되면 MFA_TICKET_EXPIRED", async () => {
    const session = t.session();
    expect(await login(session, "totp.user", "Totp-Pass-123")).toEqual({ kind: "mfa" });
    expect(session.pendingMfaTicket).toMatch(/^mfa-ticket/);
    const cookie = cookieValue(session.commit());
    const next = t.session(cookie);
    expect(await verifyMfa(next, "123456")).toMatchObject({ kind: "ok" });
    expect(next.pendingMfaTicket).toBeUndefined();
    const again = t.session();
    await login(again, "totp.user", "Totp-Pass-123");
    t.state.now += 6 * 60_000;
    expect(await verifyMfa(again, "123456")).toMatchObject({ kind: "error", code: "MFA_TICKET_EXPIRED" });
  });
});

describe("IAM-07.03 재발급·회전(single-flight)", () => {
  it("캐시가 없으면 Refresh로 재발급, 동시 요청은 1회만 보내고 회전된 Refresh를 둘 다 쓴다", async () => {
    const cookie = await loggedIn();
    const a = t.session(cookie);
    const b = t.session(cookie);
    await t.state.runtime.store.delete(a.sid as string);
    const [ta, tb] = await Promise.all([ensureAccessToken(a), ensureAccessToken(b)]);
    expect(ta).toBe(tb);
    expect(t.state.gateway.refreshCalls).toBe(1);
    expect(a.refreshToken).toBe(b.refreshToken);
    expect(cookieValue(a.commit())).not.toBe(cookie);
    // 회전 전 쿠키로 들어와도 최신 Refresh로 바꿔 준다
    const stale = t.session(cookie);
    expect(stale.refreshToken).toBe(a.refreshToken);
    expect(stale.commit()).toBeDefined();
  });

  it("재사용 탐지(AUTH_SESSION_REVOKED)면 세션을 지우고 SessionEndedError", async () => {
    const cookie = await loggedIn();
    const session = t.session(cookie);
    t.state.gateway.revokeUser("7");
    await t.state.runtime.store.delete(session.sid as string);
    await expect(ensureAccessToken(session)).rejects.toBeInstanceOf(SessionEndedError);
    expect(session.isDestroyed).toBe(true);
    expect(session.commit()).toMatch(/Max-Age=0/);
  });

  it("auth 장애(503)·한도(429)는 세션을 지우지 않고 UpstreamUnavailableError", async () => {
    const cookie = await loggedIn();
    const session = t.session(cookie);
    await t.state.runtime.store.delete(session.sid as string);
    t.server.use(http.post("http://gateway.test/api/v1/auth/refresh-token", () => HttpResponse.json({ header: { isSuccessful: false, resultCode: "AUTH_RATE_LIMITED", resultMessage: "x" } }, { status: 429, headers: { "Retry-After": "7" } })));
    const error = await ensureAccessToken(session).catch((e) => e);
    expect(error).toBeInstanceOf(UpstreamUnavailableError);
    expect(error).toMatchObject({ code: "AUTH_RATE_LIMITED", status: 429, retryAfter: 7 });
    expect(session.isDestroyed).toBe(false);
    t.server.use(http.post("http://gateway.test/api/v1/auth/refresh-token", () => HttpResponse.error()));
    await expect(ensureAccessToken(session)).rejects.toMatchObject({ status: 503 });
  });

  it("세션 없는 요청은 SessionEndedError(AUTH_TOKEN_INVALID)", async () => {
    await expect(sessionFetch(t.session(), "/api/v1/core/devices")).rejects.toMatchObject({ code: "AUTH_TOKEN_INVALID" });
    await expect(ensureAccessToken(t.session())).rejects.toMatchObject({ code: "AUTH_TOKEN_INVALID" });
  });

  it("gateway 401 AUTH_TOKEN_EXPIRED → 재발급 후 1회 재시도, 계속 만료면 세션 종료", async () => {
    const cookie = await loggedIn();
    const session = t.session(cookie);
    t.state.gateway.expireAccessTokens();
    const ok = await sessionFetch(session, "/api/v1/core/devices");
    expect(ok.status).toBe(200);
    t.server.use(http.get("http://gateway.test/api/v1/core/devices", () => HttpResponse.json({ header: { isSuccessful: false, resultCode: "AUTH_TOKEN_EXPIRED", resultMessage: "x" } }, { status: 401 })));
    await expect(sessionFetch(session, "/api/v1/core/devices")).rejects.toMatchObject({ code: "AUTH_TOKEN_INVALID" });
  });

  it("공개 경로 호출에는 Authorization이 없고 X-Forwarded-For·X-REQUEST-ID·Accept-Language를 붙인다", async () => {
    const response = await publicFetch(t.state.runtime, { requestId: "r-12345678", lang: "en", clientIp: "1.2.3.4" }, "/api/v1/core/password-resets", { method: "POST", body: "{}", headers: { "Content-Type": "application/json" } });
    expect(response.status).toBe(202);
    const call = t.state.gateway.received.at(-1);
    expect(call?.headers.authorization).toBeUndefined();
    expect(call?.headers["x-forwarded-for"]).toBe("1.2.3.4");
    expect(call?.headers["accept-language"]).toBe("en");
    expect(call?.headers["x-request-id"]).toBe("r-12345678");
  });
});

describe("IAM-07.05 로그아웃", () => {
  it("auth에 Refresh 쿠키·Bearer로 폐기를 알리고 캐시·쿠키를 지운다, auth 장애여도 지운다", async () => {
    const cookie = await loggedIn();
    const session = t.session(cookie);
    const sid = session.sid as string;
    await logout(session);
    expect(t.state.gateway.received.at(-1)?.headers.authorization).toMatch(/^Bearer /);
    expect(await t.state.runtime.store.get(sid)).toBeUndefined();
    expect(session.commit()).toMatch(/Max-Age=0/);
    t.server.use(http.post("http://gateway.test/api/v1/auth/logout", () => HttpResponse.error()));
    const other = t.session(await loggedIn());
    await logout(other);
    expect(other.authenticated).toBe(false);
    const anonymous = t.session();
    await logout(anonymous);
    expect(anonymous.isDestroyed).toBe(true);
  });
});

describe("응답 해석", () => {
  it("JSON이 아니면 상태 코드로 머리를 만든다", async () => {
    expect((await readEnvelope(new Response("oops", { status: 500 }))).header.resultCode).toBe("INTERNAL_ERROR");
    expect((await readEnvelope(new Response('{"a":1}', { status: 200 }))).response).toEqual({ a: 1 });
    expect((await readEnvelope(new Response(null, { status: 204 }))).header.isSuccessful).toBe(true);
    for (const [status, code] of [[401, "AUTH_TOKEN_INVALID"], [403, "PERMISSION_DENIED"], [404, "RESOURCE_NOT_FOUND"], [409, "VERSION_CONFLICT"], [429, "RATE_LIMITED"], [503, "SERVICE_UNAVAILABLE"], [502, "INTERNAL_ERROR"], [400, "INVALID_REQUEST"]] as const) {
      expect(fallbackHeader(status).resultCode).toBe(code);
    }
    expect(refreshFromSetCookie(new Response(null, { headers: { "Set-Cookie": "other=1" } }))).toBeUndefined();
  });

  it("RotationLog: 기록이 만료되면 원래 값", () => {
    let now = 0;
    const log = new RotationLog(() => now, 1000);
    log.record("a", "b");
    log.record("b", "c");
    log.record("c", "c");
    expect(log.latest("a")).toBe("c");
    now = 2000;
    expect(log.latest("a")).toBe("a");
  });
});
