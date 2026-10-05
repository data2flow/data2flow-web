/**
 * 로컬 미리보기 로그인 미리 채우기(OPS-08.01, ADR-057) SSR 통합 테스트.
 * 켜지면 로그인 화면 HTML에 관리자 아이디·비밀번호가 기본값으로 들어가고 안내가 보인다. 실제 호스트 주소면 꺼진다.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ORIGIN, TestBrowser, startApp, type AppContext } from "./app-harness";

let app: AppContext;
const PREVIEW = {
  DATA2FLOW_PREVIEW_LOGIN_ID: "kim.op",
  DATA2FLOW_PREVIEW_LOGIN_PASSWORD: "Correct-Horse-9",
};
const LOCAL = { DATA2FLOW_PUBLIC_ORIGIN: "http://localhost:3000", DATA2FLOW_COOKIE_SECURE: "false", DATA2FLOW_ALLOWED_ORIGINS: ORIGIN };
const NOTICE = "로컬 미리보기: 관리자 계정이 미리 채워져 있습니다";

beforeAll(async () => {
  app = await startApp();
});
afterAll(async () => {
  await app.close();
});
beforeEach(() => app.reset());

describe("OPS-08.01 로컬 미리보기 로그인 미리 채우기", () => {
  it("기본(꺼짐): 로그인 폼이 비어 있고 안내가 없다", async () => {
    const page = await new TestBrowser(app).get("/login");
    expect(page.response.status).toBe(200);
    expect(page.body).not.toContain(NOTICE);
    expect(page.body).not.toContain("Correct-Horse-9");
  });

  it("localhost + Secure 꺼짐: 아이디·비밀번호가 채워지고 안내가 보이며, 그대로 제출하면 홈으로 간다", async () => {
    app.reset({ ...LOCAL, ...PREVIEW });
    const browser = new TestBrowser(app);
    const page = await browser.get("/login");
    expect(page.response.status).toBe(200);
    expect(page.body).toContain(NOTICE);
    expect(page.body).toMatch(/name="loginId"[^>]*value="kim.op"|value="kim.op"[^>]*name="loginId"/);
    expect(page.body).toMatch(/name="password"[^>]*value="Correct-Horse-9"|value="Correct-Horse-9"[^>]*name="password"/);
    const login = await browser.post("/login", { intent: "credentials", loginId: "kim.op", password: "Correct-Horse-9", next: "/" });
    expect(login.response.status).toBe(302);
    expect(login.response.headers.get("Location")).toBe("/");
  });

  it("영어 화면(/en/login)도 안내를 그 언어로 보인다", async () => {
    app.reset({ ...LOCAL, ...PREVIEW });
    const page = await new TestBrowser(app).get("/en/login");
    expect(page.body).toContain("Local preview: the administrator account is pre-filled.");
  });

  it("실제 호스트 주소(운영)에서는 값을 넣어도 꺼진다", async () => {
    app.reset({ ...PREVIEW, DATA2FLOW_COOKIE_SECURE: "false" });
    const page = await new TestBrowser(app).get("/login");
    expect(page.body).not.toContain(NOTICE);
    expect(page.body).not.toContain("Correct-Horse-9");
  });

  it("localhost여도 Secure 쿠키가 켜져 있으면 꺼진다", async () => {
    app.reset({ ...PREVIEW, DATA2FLOW_PUBLIC_ORIGIN: "http://localhost:3000" });
    const page = await new TestBrowser(app).get("/login");
    expect(page.body).not.toContain(NOTICE);
    expect(page.body).not.toContain("Correct-Horse-9");
  });
});
