/**
 * 로그인(UI-IAM-01) SSR + BFF 통합 테스트. 실제 라우트·미들웨어를 돌리고 gateway만 MSW 가짜로 바꾼다.
 * 관련: IAM-02.01, IAM-02.05, IAM-07.04, IAM-07.11, IAM-01.06, IAM-01.08, ADR-037
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

describe("IAM-02.01 로그인 아이디·비밀번호", () => {
  it("TC-IAM-074 AT-IAM-02.1 올바른 아이디·비밀번호 → 302 홈, data2flow_session(HttpOnly·Secure·SameSite=Lax)만 받고 본문·HTML에 JWT가 없다", async () => {
    const browser = new TestBrowser(app);
    const login = await browser.login("kim.op", "Correct-Horse-9");
    expect(login.response.status).toBe(302);
    expect(login.response.headers.get("Location")).toBe("/");
    expect(login.setCookies).toHaveLength(1);
    const cookie = login.setCookies[0];
    expect(cookie).toMatch(/^data2flow_session=v1\.k1\./);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Secure/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).not.toMatch(/data2flow_refresh/);
    expect([...browser.cookies.keys()]).toEqual(["data2flow_session"]);

    const home = await browser.get("/");
    expect(home.response.status).toBe(200);
    expect(home.body).toContain("김운영");
    for (const exchange of browser.exchanges) {
      expect(exchange.body).not.toMatch(JWT_PATTERN);
      for (const value of exchange.setCookies) expect(value).not.toMatch(JWT_PATTERN);
    }
  });

  it("AT-IAM-02.2 아이디를 대문자(KIM.OP)로 입력해도 로그인된다(소문자로 바꿔 전송)", async () => {
    const browser = new TestBrowser(app);
    const login = await browser.login("KIM.OP", "Correct-Horse-9");
    expect(login.response.status).toBe(302);
    expect(app.gateway.received.find((r) => r.path === "/api/v1/auth/login")?.body).toEqual({ loginId: "kim.op" });
  });

  it("AT-IAM-02.3 틀린 비밀번호·없는 아이디는 같은 문구(AUTH_INVALID_CREDENTIALS), 잠금 여부를 드러내지 않는다", async () => {
    const browser = new TestBrowser(app);
    const wrong = await browser.login("kim.op", "nope-nope-nope");
    const missing = await browser.login("ghost.user", "nope-nope-nope");
    expect(wrong.response.status).toBe(401);
    expect(missing.response.status).toBe(401);
    const message = "아이디 또는 비밀번호가 올바르지 않습니다";
    expect(wrong.body).toContain(message);
    expect(missing.body).toContain(message);
    expect(browser.cookies.has("data2flow_session")).toBe(true); // 로그인 전 세션(CSRF)만
  });

  it("AT-IAM-16.4 승인 대기 계정은 '관리자 승인 대기 중입니다' 안내", async () => {
    const browser = new TestBrowser(app);
    const result = await browser.login("pending.user", "Pending-Pass-1");
    expect(result.response.status).toBe(403);
    expect(result.body).toContain("관리자 승인 대기 중입니다");
  });

  it("AT-IAM-02.6 한도 초과(429 AUTH_RATE_LIMITED)는 남은 초를 안내한다", async () => {
    const browser = new TestBrowser(app);
    await browser.get("/login");
    app.server.use(
      http.post("http://gateway.test/api/v1/auth/login", () =>
        HttpResponse.json({ header: { isSuccessful: false, resultCode: "AUTH_RATE_LIMITED", resultMessage: "x" } }, { status: 429, headers: { "Retry-After": "42" } }),
      ),
    );
    const result = await browser.post("/login", { intent: "credentials", loginId: "kim.op", password: "Correct-Horse-9", next: "/" });
    expect(result.response.status).toBe(429);
    expect(result.body).toContain("42초 후 다시 시도해 주세요");
  });

  it("TC-IAM-086 AT-IAM-02.8 next=//evil.com 이면 로그인 뒤 홈(/)으로 간다", async () => {
    const browser = new TestBrowser(app);
    await browser.get("/login?next=//evil.com");
    const result = await browser.post("/login", { intent: "credentials", loginId: "kim.op", password: "Correct-Horse-9", next: "//evil.com" });
    expect(result.response.headers.get("Location")).toBe("/");
  });

  it("design/auth.md §9.2 로그인 안 한 채 보호 화면을 열면 /login?next= 로 보내고, 로그인하면 그 경로로 돌아간다", async () => {
    const browser = new TestBrowser(app);
    const page = await browser.get("/me/profile");
    expect(page.response.status).toBe(302);
    expect(page.response.headers.get("Location")).toBe("/login?next=%2Fme%2Fprofile");
    const result = await browser.login("kim.op", "Correct-Horse-9", "/me/profile");
    expect(result.response.headers.get("Location")).toBe("/me/profile");
  });
});

describe("IAM-07.04 CSRF(BR-IAM-22)", () => {
  it("TC-IAM-084 AT-IAM-02.7 CSRF 토큰 없이 로그인 POST → 403 AUTH_CSRF_INVALID", async () => {
    const browser = new TestBrowser(app);
    await browser.get("/login");
    const result = await browser.post("/login", { intent: "credentials", loginId: "kim.op", password: "Correct-Horse-9" }, { csrf: null });
    expect(result.response.status).toBe(403);
    expect(JSON.parse(result.body).header.resultCode).toBe("AUTH_CSRF_INVALID");
    expect(app.gateway.received.some((r) => r.path === "/api/v1/auth/login")).toBe(false);
  });

  it("TC-IAM-084 다른 Origin에서 온 POST는 토큰이 맞아도 403", async () => {
    const browser = new TestBrowser(app);
    await browser.get("/login");
    const result = await browser.post("/login", { intent: "credentials", loginId: "kim.op", password: "Correct-Horse-9" }, { origin: "https://evil.example" });
    expect(result.response.status).toBe(403);
    const noOrigin = await browser.post("/login", { intent: "credentials", loginId: "kim.op", password: "Correct-Horse-9" }, { origin: null });
    expect(noOrigin.response.status).toBe(403);
  });
});

describe("IAM-02.05 2단계 인증(TOTP)", () => {
  it("TC-IAM-101 AT-IAM-14.2 비밀번호만 맞으면 토큰 없이 TOTP 화면, 코드 확인 뒤 세션 발급", async () => {
    const browser = new TestBrowser(app);
    const first = await browser.login("totp.user", "Totp-Pass-123");
    expect(first.response.status).toBe(200);
    expect(first.body).toContain("2단계 인증");
    expect(first.body).not.toMatch(/mfa-ticket/);
    expect(app.gateway.access.size).toBe(0);

    const page = await browser.get("/login");
    expect(page.body).toContain('name="code"');
    const wrong = await browser.post("/login", { intent: "mfa", code: "000000", next: "/" });
    expect(wrong.response.status).toBe(401);
    expect(wrong.body).toContain("인증 코드가 올바르지 않습니다");
    const ok = await browser.post("/login", { intent: "mfa", code: "123456", next: "/" });
    expect(ok.response.status).toBe(302);
    expect(ok.response.headers.get("Location")).toBe("/");
    expect(app.gateway.access.size).toBe(1);
  });

  it("TOTP 형식이 아니면 gateway를 부르지 않고 '6자리 숫자' 안내", async () => {
    const browser = new TestBrowser(app);
    await browser.login("totp.user", "Totp-Pass-123");
    const result = await browser.post("/login", { intent: "mfa", code: "12", next: "/" });
    expect(result.response.status).toBe(400);
    expect(result.body).toContain("6자리 숫자를 입력해 주세요");
  });
});

describe("IAM-07.11·IAM-01.06·IAM-01.08 로그인 화면 구성", () => {
  it("TC-IAM-029 AT-IAM-20.1 가입 신청이 꺼져 있으면(기본) 회원가입·가입 신청·소셜 로그인 링크가 없다", async () => {
    const browser = new TestBrowser(app);
    const page = await browser.get("/login");
    expect(page.body).not.toContain("가입 신청");
    expect(page.body).not.toContain("회원가입");
    expect(page.body).not.toContain("조직 만들기");
    expect(page.body).not.toMatch(/oauth2|google|github|kakao/i);
    expect(page.body).toMatch(/autocomplete="current-password"/i);
  });

  it("TC-IAM-051 /signup 직접 입력은 404 화면", async () => {
    const browser = new TestBrowser(app);
    const page = await browser.get("/signup");
    expect(page.response.status).toBe(404);
  });

  it("IAM-01.08 AT-IAM-16.1 조직 설정에서 가입 신청을 켜면(API-IAM-74) 로그인 화면에 [가입 신청] 링크가 생긴다", async () => {
    app.gateway.signupRequestEnabled = true;
    const browser = new TestBrowser(app);
    const page = await browser.get("/login");
    expect(page.body).toContain('href="/signup"');
    expect(app.gateway.received.some((r) => r.path === "/api/v1/core/public/signup-settings" && !r.headers.authorization)).toBe(true);
    const signup = await browser.get("/signup");
    expect(signup.response.status).toBe(200);
  });

  it("IAM-01.08 배포 설정이 켜져 있어도 조직 설정이 꺼져 있으면 링크가 없고 /signup은 404", async () => {
    app.reset({ DATA2FLOW_SIGNUP_REQUEST_ENABLED: "true" });
    const browser = new TestBrowser(app);
    const page = await browser.get("/login");
    expect(page.body).not.toContain('href="/signup"');
    expect((await browser.get("/signup")).response.status).toBe(404);
  });

  it("IAM-01.08 공개 설정 조회가 실패하면 배포 설정(DATA2FLOW_SIGNUP_REQUEST_ENABLED)을 대체값으로 쓴다", async () => {
    app.server.use(
      http.get("http://gateway.test/api/v1/core/public/signup-settings", () =>
        HttpResponse.json({ header: { isSuccessful: false, resultCode: "SERVICE_UNAVAILABLE", resultMessage: "x" } }, { status: 503 }),
      ),
    );
    const off = await new TestBrowser(app).get("/login");
    expect(off.response.status).toBe(200);
    expect(off.body).not.toContain('href="/signup"');

    app.reset({ DATA2FLOW_SIGNUP_REQUEST_ENABLED: "true" });
    app.server.use(http.get("http://gateway.test/api/v1/core/public/signup-settings", () => HttpResponse.error()));
    const on = await new TestBrowser(app).get("/login");
    expect(on.response.status).toBe(200);
    expect(on.body).toContain('href="/signup"');
  });
});

describe("ADR-037 언어별 공개 주소", () => {
  it("NFR-08.01 /en/login·/ja/login·/zh/login 은 그 언어로 렌더링하고 hreflang·canonical을 넣는다", async () => {
    const browser = new TestBrowser(app);
    const en = await browser.get("/en/login");
    expect(en.body).toContain('<html lang="en"');
    expect(en.body).toContain("Sign in");
    expect(en.body).toContain('rel="canonical" href="https://data2flow.java21.net/en/login"');
    expect(en.body).toMatch(/hreflang="ja" href="https:\/\/data2flow\.java21\.net\/ja\/login"/i);
    const ja = await browser.get("/ja/login");
    expect(ja.body).toContain("ログイン");
    const zh = await browser.get("/zh/login");
    expect(zh.body).toContain('<html lang="zh-Hans"');
    expect(zh.body).toContain("登录");
  });

  it("접두사 없는 /login 은 브라우저 언어(Accept-Language), 없으면 한국어", async () => {
    const browser = new TestBrowser(app);
    const ja = await browser.get("/login", { "Accept-Language": "ja-JP,ja;q=0.9" });
    expect(ja.body).toContain('<html lang="ja"');
    const ko = await browser.get("/login", { "Accept-Language": "fr-FR" });
    expect(ko.body).toContain('<html lang="ko"');
  });

  it("/ko/login 은 접두사 없는 주소로, 모르는 접두사는 404", async () => {
    const browser = new TestBrowser(app);
    const ko = await browser.get("/ko/login?next=%2Fme");
    expect(ko.response.status).toBe(302);
    expect(ko.response.headers.get("Location")).toBe("/login?next=%2Fme");
    const unknown = await browser.get("/fr/login");
    expect(unknown.response.status).toBe(404);
  });
});
