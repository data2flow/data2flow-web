/**
 * DSH-07.02 라이트·다크 테마(TC-DSH-074 웹 쪽): 사용자 메뉴에서 바꾸면 쿠키로 서버 렌더링부터 적용하고 화면 설정(API-DSH-12)에도 저장한다.
 */
import { http, HttpResponse } from "msw";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TestBrowser, startApp, type AppContext } from "./app-harness";
import { envelope } from "./msw/fake-gateway";

let app: AppContext;
const GW = "http://gateway.test/api/v1/core";

beforeAll(async () => {
  app = await startApp();
});
afterAll(async () => {
  await app.close();
});
beforeEach(() => app.reset());

describe("DSH-07.02 테마 전환", () => {
  it("TC-DSH-074 기본은 시스템 설정(속성 없음), 다크로 바꾸면 html[data-theme=dark]와 preferences PUT { theme, baseVersion }", async () => {
    const browser = new TestBrowser(app);
    await browser.login("kim.op", "Correct-Horse-9");
    const home = await browser.get("/me/profile");
    expect(home.body).not.toContain("data-theme=");
    expect(home.body).toContain("테마: 시스템");
    let put: unknown;
    app.server.use(
      http.get(`${GW}/accounts/me/preferences`, () => HttpResponse.json(envelope({ theme: "SYSTEM", version: 4 }))),
      http.put(`${GW}/accounts/me/preferences`, async ({ request }) => {
        put = await request.json();
        return HttpResponse.json(envelope({ theme: "DARK", version: 5 }));
      }),
    );
    const change = await browser.post("/theme", { theme: "DARK", next: "/me/profile?x=1" });
    expect(change.response.status).toBe(302);
    expect(change.response.headers.get("Location")).toBe("/me/profile?x=1");
    expect(change.setCookies.join(";")).toMatch(/data2flow_theme=DARK; Path=\/; Max-Age=31536000; SameSite=Lax; Secure/);
    expect(put).toEqual({ theme: "DARK", baseVersion: 4 });
    const after = await browser.get("/me/profile");
    expect(after.body).toContain('data-theme="dark"');
    expect(after.body).toContain("테마: 다크");
  });

  it("저장 API가 실패해도 쿠키로 적용, 바깥 주소로는 돌아가지 않는다, CSRF 없으면 403", async () => {
    const browser = new TestBrowser(app);
    await browser.login("kim.op", "Correct-Horse-9");
    await browser.get("/");
    app.server.use(http.get(`${GW}/accounts/me/preferences`, () => HttpResponse.error()));
    const change = await browser.post("/theme", { theme: "light", next: "https://evil.example/" });
    expect(change.response.headers.get("Location")).toBe("/");
    expect((await browser.get("/")).body).toContain('data-theme="light"');
    const forged = await browser.post("/theme", { theme: "DARK", next: "/" }, { csrf: null });
    expect(forged.response.status).toBe(403);
    expect((await browser.get("/theme")).response.status).toBe(302);
  });
});
