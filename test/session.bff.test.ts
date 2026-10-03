/**
 * 세션 유지·재발급·만료·폐기(IAM-03.01, IAM-03.03, IAM-07.03, IAM-07.04, IAM-07.05) SSR + BFF 통합 테스트.
 * 시간은 가짜 시계로만 움직인다(sleep 없음).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TestBrowser, startApp, type AppContext } from "./app-harness";

let app: AppContext;

beforeAll(async () => {
  app = await startApp();
});
afterAll(async () => {
  await app.close();
});
beforeEach(() => app.reset());

const MINUTE = 60_000;

async function loggedIn(loginId = "kim.op", password = "Correct-Horse-9") {
  const browser = new TestBrowser(app);
  const result = await browser.login(loginId, password);
  expect(result.response.status).toBe(302);
  return browser;
}

describe("IAM-03.01 세션 유지와 만료", () => {
  it("TC-IAM-109 AT-IAM-03.1 Access 만료·Refresh 유효 → 사용자 개입 없이 200, 회전된 Refresh로 쿠키 재발급", async () => {
    const browser = await loggedIn();
    const before = browser.cookies.get("data2flow_session");
    for (const minutes of [25, 25, 15]) {
      // 유휴 30분 안에 계속 활동하다가, 로그인 후 65분에 BFF 캐시의 Access가 만료된다
      app.clock.advance(minutes * MINUTE);
      if (minutes !== 15) await browser.get("/");
    }
    const page = await browser.get("/me/profile");
    expect(page.response.status).toBe(200);
    expect(app.gateway.refreshCalls).toBe(1);
    expect(page.setCookies.some((c) => c.startsWith("data2flow_session=v1."))).toBe(true);
    expect(browser.cookies.get("data2flow_session")).not.toBe(before);
  });

  it("design/auth.md §9.2 gateway가 401 AUTH_TOKEN_EXPIRED를 주면 BFF가 재발급하고 1회 재시도한다(브라우저는 모름)", async () => {
    const browser = await loggedIn();
    app.gateway.expireAccessTokens();
    const page = await browser.get("/me/profile");
    expect(page.response.status).toBe(200);
    expect(app.gateway.refreshCalls).toBe(1);
  });

  it("TC-IAM-110 AT-IAM-03.2 같은 세션의 두 탭이 동시에 재발급해도 둘 다 로그아웃되지 않는다(재발급 1회, 회전 반영)", async () => {
    const tabA = await loggedIn();
    const tabB = tabA.tab();
    app.gateway.expireAccessTokens();
    const staleCookie = tabA.cookies.get("data2flow_session") as string;
    const [a, b] = await Promise.all([tabA.get("/"), tabB.get("/me/profile")]);
    expect(a.response.status).toBe(200);
    expect(b.response.status).toBe(200);
    expect(app.gateway.refreshCalls).toBe(1);

    // 늦게 도착한 요청이 회전 전 쿠키를 들고 와도 최신 Refresh로 바꿔 준다
    const late = new TestBrowser(app);
    late.cookies.set("data2flow_session", staleCookie);
    app.clock.advance(31_000); // 유예 30초가 지나도
    app.gateway.expireAccessTokens();
    const lateResult = await late.get("/");
    expect(lateResult.response.status).toBe(200);
    expect(app.gateway.revokedSids.size).toBe(0);
  });

  it("TC-IAM-112 AT-IAM-03.3 마지막 활동 후 31분 → 화면은 로그인으로(reason=expired), API는 401 AUTH_SESSION_EXPIRED", async () => {
    const browser = await loggedIn();
    const cookie = browser.cookies.get("data2flow_session") as string;
    app.clock.advance(31 * MINUTE);
    const page = await browser.get("/me/profile");
    expect(page.response.status).toBe(302);
    expect(page.response.headers.get("Location")).toBe("/login?next=%2Fme%2Fprofile&reason=expired");
    expect(page.setCookies[0]).toMatch(/^data2flow_session=;.*Max-Age=0/);
    expect(app.gateway.received.some((r) => r.path === "/api/v1/auth/logout")).toBe(true);

    const api = new TestBrowser(app);
    api.cookies.set("data2flow_session", cookie);
    const response = await api.get("/bff/api/core/devices");
    expect(response.response.status).toBe(401);
    expect(JSON.parse(response.body).header.resultCode).toBe("AUTH_SESSION_EXPIRED");

    const login = await browser.get(page.response.headers.get("Location") as string);
    expect(login.body).toContain("오랫동안 사용하지 않아 로그아웃되었습니다");
  });

  it("IAM-03.01 유휴 시간은 설정으로 바꾼다(DATA2FLOW_SESSION_IDLE_MINUTES=10)", async () => {
    app.reset({ DATA2FLOW_SESSION_IDLE_MINUTES: "10" });
    const browser = await loggedIn();
    app.clock.advance(9 * MINUTE);
    expect((await browser.get("/")).response.status).toBe(200);
    app.clock.advance(11 * MINUTE);
    expect((await browser.get("/")).response.status).toBe(302);
  });

  it("AT-IAM-03.4 로그인 후 12시간 동안 계속 활동해도 12시간 1분째는 만료", async () => {
    const browser = await loggedIn();
    for (let i = 0; i < 47; i++) {
      app.clock.advance(15 * MINUTE);
      const page = await browser.get("/");
      expect(page.response.status).toBe(200);
    }
    app.clock.advance(16 * MINUTE); // 로그인 후 12시간 1분
    const page = await browser.get("/");
    expect(page.response.status).toBe(302);
    expect(page.response.headers.get("Location")).toContain("reason=expired");
  });
});

describe("IAM-07.05 즉시 폐기", () => {
  it("AT-IAM-04.1 로그아웃하면 쿠키를 지우고 sid를 폐기한다(같은 쿠키로 다시 와도 로그인 화면)", async () => {
    const browser = await loggedIn();
    const cookie = browser.cookies.get("data2flow_session") as string;
    await browser.get("/");
    const out = await browser.post("/logout", {});
    expect(out.response.status).toBe(302);
    expect(out.response.headers.get("Location")).toBe("/login?reason=logout");
    expect(browser.cookies.has("data2flow_session")).toBe(false);
    const logoutCall = app.gateway.received.find((r) => r.path === "/api/v1/auth/logout");
    expect(logoutCall?.headers.cookie).toMatch(/^data2flow_refresh=/);
    expect(app.gateway.revokedSids.size).toBe(1);

    const replay = new TestBrowser(app);
    replay.cookies.set("data2flow_session", cookie);
    const page = await replay.get("/me/profile");
    expect(page.response.status).toBe(302);
    expect(page.response.headers.get("Location")).toContain("/login");
  });

  it("TC-IAM-122 AT-IAM-04.2 관리자가 모든 세션을 종료하면 두 기기 모두 다음 요청에서 로그인 화면(reason=revoked)", async () => {
    const deviceA = await loggedIn();
    const deviceB = await loggedIn();
    const admin = await loggedIn("admin01", "Admin-Pass-123");
    await admin.get("/admin/members/7");
    const revoke = await admin.post("/admin/members/7", { intent: "revoke-sessions" });
    expect(revoke.response.status).toBe(200);
    for (const device of [deviceA, deviceB]) {
      const page = await device.get("/me/profile");
      expect(page.response.status).toBe(302);
      expect(page.response.headers.get("Location")).toBe("/login?next=%2Fme%2Fprofile&reason=revoked");
      expect(device.cookies.has("data2flow_session")).toBe(false);
    }
    expect((await admin.get("/")).response.status).toBe(200);
  });

  it("AT-IAM-03.5 Refresh 재사용 탐지(AUTH_SESSION_REVOKED) → 쿠키 삭제, 로그인 화면", async () => {
    const browser = await loggedIn();
    app.gateway.revokedSids.add([...app.gateway.access.values()][0].sid);
    app.gateway.expireAccessTokens();
    const page = await browser.get("/");
    expect(page.response.status).toBe(302);
    expect(page.response.headers.get("Location")).toContain("reason=revoked");
    expect(browser.cookies.has("data2flow_session")).toBe(false);
  });

  it("BR-IAM-24 auth 장애(503)면 세션을 지우지 않고 503 화면", async () => {
    const { http, HttpResponse } = await import("msw");
    const browser = await loggedIn();
    app.gateway.expireAccessTokens();
    app.server.use(http.post("http://gateway.test/api/v1/auth/refresh-token", () => HttpResponse.json({ header: { isSuccessful: false, resultCode: "AUTH_UNAVAILABLE", resultMessage: "x" } }, { status: 503 })));
    const page = await browser.get("/me/profile");
    expect(page.response.status).toBe(503);
    expect(browser.cookies.has("data2flow_session")).toBe(true);
  });
});
