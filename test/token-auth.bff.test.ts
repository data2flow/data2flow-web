/**
 * M1 완료 확인(plan/milestones.md §M1): 브라우저가 받는 어떤 것에도 토큰이 없다(IAM-07.04, TC-IAM-190).
 * 그리고 BFF 중계(`/bff/api/**`)의 허용 목록·신원 헤더 위조 차단·CSRF·Set-Cookie 차단(IAM-07.02, IAM-07.09).
 */
import { http, HttpResponse } from "msw";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { JWT_PATTERN, TestBrowser, startApp, type AppContext } from "./app-harness";

let app: AppContext;

beforeAll(async () => {
  app = await startApp();
});
afterAll(async () => {
  await app.close();
});
beforeEach(() => app.reset());

/** gateway가 발급한 모든 토큰 원문(Access·Refresh) */
function issuedTokens() {
  return [...app.gateway.access.keys(), ...app.gateway.refresh.keys()];
}

describe("TC-IAM-190 IAM-07.04 브라우저에는 토큰이 없다(AT-IAM-02.1·02.2·02.3)", () => {
  for (const refreshInBody of [false, true]) {
    it(`로그인→화면→데이터 요청(.data)→API 중계→재발급→로그아웃 전체에서 쿠키·HTML·JS 데이터·API 응답 어디에도 토큰이 없다 (auth 응답 형식: ${refreshInBody ? "본문 refreshToken·sid" : "Set-Cookie data2flow_refresh"})`, async () => {
      app.gateway.refreshInBody = refreshInBody;
      const browser = new TestBrowser(app);
      await browser.login("admin01", "Admin-Pass-123");
      await browser.get("/");
      await browser.get("/me/profile");
      await browser.get("/me/sessions");
      await browser.get("/admin/members");
      await browser.get("/me/profile.data");
      await browser.get("/bff/api/core/devices");
      await browser.get("/bff/api/core/accounts/me");
      app.gateway.expireAccessTokens();
      await browser.get("/me/security");
      await browser.request("/bff/api/core/accounts/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "X-CSRF-TOKEN": browser.csrf },
        body: JSON.stringify({ name: "홍길동", baseVersion: 3 }),
      });
      await browser.post("/logout", {});

      const tokens = issuedTokens();
      expect(tokens.length).toBeGreaterThanOrEqual(4);
      expect(app.gateway.refreshCalls).toBeGreaterThanOrEqual(1);
      for (const exchange of browser.exchanges) {
        const headerDump = [...exchange.response.headers.entries()].map(([k, v]) => `${k}: ${v}`).join("\n");
        for (const token of tokens) {
          expect(exchange.body.includes(token), `${exchange.request.url} body`).toBe(false);
          expect(headerDump.includes(token), `${exchange.request.url} headers`).toBe(false);
        }
        expect(exchange.body).not.toMatch(JWT_PATTERN);
        expect(headerDump).not.toMatch(/data2flow_refresh/);
        for (const cookie of exchange.setCookies) expect(cookie.startsWith("data2flow_session=")).toBe(true);
      }
      // 쿠키 저장소에는 세션 쿠키 하나뿐(로그아웃 뒤에는 없음)
      expect([...browser.cookies.keys()].every((name) => name === "data2flow_session")).toBe(true);
    });
  }

  it("세션 쿠키 값은 불투명하다(암호화): 쿠키를 풀어 봐도 토큰 문자열·JSON이 보이지 않는다", async () => {
    const browser = new TestBrowser(app);
    await browser.login("kim.op", "Correct-Horse-9");
    const value = browser.cookies.get("data2flow_session") as string;
    const decoded = value
      .split(".")
      .map((part) => Buffer.from(part, "base64url").toString("latin1"))
      .join(" ");
    for (const token of issuedTokens()) expect(decoded.includes(token)).toBe(false);
    expect(decoded).not.toMatch(/eyJ|"rt"|refresh/);
  });

  it("변조한 세션 쿠키는 무시하고 지운다", async () => {
    const browser = new TestBrowser(app);
    await browser.login("kim.op", "Correct-Horse-9");
    const value = browser.cookies.get("data2flow_session") as string;
    browser.cookies.set("data2flow_session", `${value.slice(0, -4)}AAAA`);
    const page = await browser.get("/me/profile");
    expect(page.response.status).toBe(302);
    expect(page.setCookies.some((c) => /Max-Age=0/.test(c))).toBe(true);
  });
});

describe("IAM-07.04 BFF 중계 /bff/api/{svc}/**", () => {
  it("TC-IAM-183 AT-IAM-21.3 브라우저가 X-USER-ID·X-ORG-ID·Authorization을 넣어 보내도 gateway에는 BFF가 붙인 Bearer만 간다", async () => {
    const browser = new TestBrowser(app);
    await browser.login("kim.op", "Correct-Horse-9");
    await browser.get("/bff/api/core/devices?page=1", { "X-USER-ID": "1", "X-ORG-ID": "999", Authorization: "Bearer forged", "X-REQUEST-ID": "req-12345678" });
    const call = app.gateway.received.find((r) => r.path === "/api/v1/core/devices?page=1");
    expect(call).toBeDefined();
    expect(call?.headers["x-user-id"]).toBeUndefined();
    expect(call?.headers["x-org-id"]).toBeUndefined();
    expect(call?.headers.authorization).toMatch(/^Bearer eyJ/);
    expect(call?.headers.authorization).not.toBe("Bearer forged");
    expect(call?.headers["x-request-id"]).toBe("req-12345678");
    expect(call?.headers.cookie).toBeUndefined();
  });

  it("허용 목록 밖 서비스(auth 포함)는 404, gateway를 부르지 않는다", async () => {
    const browser = new TestBrowser(app);
    await browser.login("kim.op", "Correct-Horse-9");
    const before = app.gateway.received.length;
    for (const path of ["/bff/api/auth/refresh-token", "/bff/api/action/commands", "/bff/api/core/../auth/login"]) {
      const result = await browser.get(path);
      expect(result.response.status).toBe(404);
    }
    expect(app.gateway.received.length).toBe(before);
  });

  it("상태를 바꾸는 중계 요청은 X-CSRF-TOKEN과 Origin이 맞아야 한다(BR-IAM-22)", async () => {
    const browser = new TestBrowser(app);
    await browser.login("kim.op", "Correct-Horse-9");
    await browser.get("/");
    const body = JSON.stringify({ name: "김", baseVersion: 1 });
    const noToken = await browser.request("/bff/api/core/accounts/me", { method: "PATCH", headers: { "Content-Type": "application/json" }, body });
    expect(noToken.response.status).toBe(403);
    expect(JSON.parse(noToken.body).header.resultCode).toBe("AUTH_CSRF_INVALID");
    const badOrigin = await browser.request("/bff/api/core/accounts/me", { method: "PATCH", headers: { "Content-Type": "application/json", "X-CSRF-TOKEN": browser.csrf }, body, origin: "https://evil.example" });
    expect(badOrigin.response.status).toBe(403);
    const ok = await browser.request("/bff/api/core/accounts/me", { method: "PATCH", headers: { "Content-Type": "application/json", "X-CSRF-TOKEN": browser.csrf }, body });
    expect(ok.response.status).toBe(200);
    const get = await browser.get("/bff/api/core/devices");
    expect(get.response.status).toBe(200);
  });

  it("gateway 응답의 Set-Cookie는 버리고, Location은 /bff/api 로 바꾼다", async () => {
    const browser = new TestBrowser(app);
    await browser.login("kim.op", "Correct-Horse-9");
    let idempotencyKey: string | null = null;
    app.server.use(
      http.post("http://gateway.test/api/v1/core/maintenance-windows", ({ request }) => {
        idempotencyKey = request.headers.get("idempotency-key");
        return HttpResponse.json({ header: { isSuccessful: true, resultCode: "SUCCESS", resultMessage: "SUCCESS" }, response: { id: "9" } }, { status: 201, headers: { Location: "/api/v1/core/maintenance-windows/9", "Set-Cookie": "upstream=1; Path=/" } });
      }),
    );
    await browser.get("/");
    const result = await browser.request("/bff/api/core/maintenance-windows", { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-TOKEN": browser.csrf, "Idempotency-Key": "idem-1" }, body: "{}" });
    expect(result.response.status).toBe(201);
    expect(result.response.headers.get("Location")).toBe("/bff/api/core/maintenance-windows/9");
    expect(result.setCookies.some((c) => c.startsWith("upstream"))).toBe(false);
    expect(idempotencyKey).toBe("idem-1");
  });

  it("TC-IAM-010 AT-IAM-01.2 임시 비밀번호 상태의 세션으로 /bff/api/core/devices → 403 AUTH_PASSWORD_CHANGE_REQUIRED", async () => {
    const browser = new TestBrowser(app);
    await browser.login("boot.admin", "Initial-Pass-1");
    const result = await browser.get("/bff/api/core/devices");
    expect(result.response.status).toBe(403);
    expect(JSON.parse(result.body).header.resultCode).toBe("AUTH_PASSWORD_CHANGE_REQUIRED");
  });

  it("AT-IAM-22.4 쿠키 없이 중계 경로를 부르면 gateway 판정(401)을 그대로 돌려준다(토큰 없이 전달)", async () => {
    const browser = new TestBrowser(app);
    const result = await browser.get("/bff/api/core/devices");
    expect(result.response.status).toBe(401);
    expect(app.gateway.received.at(-1)?.headers.authorization).toBeUndefined();
  });

  it("세션이 폐기되면 중계 요청은 쿠키를 지우고 401 AUTH_SESSION_REVOKED", async () => {
    const browser = new TestBrowser(app);
    await browser.login("kim.op", "Correct-Horse-9");
    app.gateway.revokeUser("7");
    const result = await browser.get("/bff/api/core/devices");
    expect(result.response.status).toBe(401);
    expect(JSON.parse(result.body).header.resultCode).toBe("AUTH_SESSION_REVOKED");
    expect(browser.cookies.has("data2flow_session")).toBe(false);
  });

  it("gateway가 응답하지 않으면 503 SERVICE_UNAVAILABLE(fail-closed)", async () => {
    const browser = new TestBrowser(app);
    await browser.login("kim.op", "Correct-Horse-9");
    app.server.use(http.get("http://gateway.test/api/v1/core/devices", () => HttpResponse.error()));
    const result = await browser.get("/bff/api/core/devices");
    expect(result.response.status).toBe(503);
    expect(JSON.parse(result.body).header.resultCode).toBe("SERVICE_UNAVAILABLE");
    expect(browser.cookies.has("data2flow_session")).toBe(true);
  });
});

describe("auth.md §9.2 보안 헤더", () => {
  it("HTML 응답에 CSP(nonce)·HSTS·X-Frame-Options·nosniff·Referrer-Policy, 인라인 스크립트에 같은 nonce", async () => {
    const browser = new TestBrowser(app);
    const page = await browser.get("/login");
    const headers = page.response.headers;
    const csp = headers.get("Content-Security-Policy") ?? "";
    const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
    expect(nonce).toBeTruthy();
    expect(csp).toContain("frame-ancestors 'none'");
    expect(page.body).toContain(`nonce="${nonce}"`);
    expect(headers.get("Strict-Transport-Security")).toMatch(/max-age=31536000/);
    expect(headers.get("X-Frame-Options")).toBe("DENY");
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("/healthz 는 세션 쿠키를 만들지 않는다", async () => {
    const browser = new TestBrowser(app);
    const result = await browser.get("/healthz");
    expect(result.response.status).toBe(200);
    expect(result.setCookies).toHaveLength(0);
  });
});
