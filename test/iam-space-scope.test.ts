/**
 * IAM M2 화면: 회원 공간 범위를 공간 트리에서 지정(IAM-01.07, IAM-04.02), 공간 필터, 실시간 연결의 공간 범위(IAM-04.06 웹 쪽).
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

async function admin() {
  const browser = new TestBrowser(app);
  const login = await browser.login("admin01", "Admin-Pass-123");
  expect(login.response.status).toBe(302);
  return browser;
}

describe("IAM-01.07 회원 관리의 공간 권한 지정(공간 계층 M2)", () => {
  it("TC-IAM-052 초대 대화상자는 공간 트리를 보여 주고, 고른 공간들을 spaceScope 배열로 보낸다", async () => {
    const browser = await admin();
    const page = await browser.get("/admin/members?tab=members&dialog=invite");
    expect(page.body).toContain('aria-label="광주캠퍼스 › 본관 › 3층 › 실습실"');
    expect(page.body).not.toContain("공간 ID를 쉼표로 구분합니다");
    const key = /name="idempotencyKey" value="([^"]+)"/.exec(page.body)?.[1] as string;
    const result = await browser.post("/admin/members?tab=members&dialog=invite", { intent: "invite", idempotencyKey: key, emails: "park@school.ac.kr", name: "", role: "OPERATOR", spaceScope: ["3", "31", "3"] });
    expect(result.response.status).toBe(200);
    const call = app.gateway.received.find((r) => r.method === "POST" && r.path === "/api/v1/core/invitations");
    expect(call?.body).toMatchObject({ emails: ["park@school.ac.kr"], role: "OPERATOR", spaceScope: ["3", "31"] });
  });

  it("TC-IAM-053 AT-IAM-09.1 회원 상세에서 역할·공간 범위 저장 → PUT …/role { role, spaceScope[], baseVersion }", async () => {
    const browser = await admin();
    const detail = await browser.get("/admin/members/7");
    expect(detail.response.status).toBe(200);
    expect(detail.body).toContain('aria-label="광주캠퍼스 › 본관 › 3층"');
    let body: unknown;
    app.server.use(
      http.put(`${GW}/users/7/role`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(envelope({ id: "7", version: 2 }));
      }),
    );
    const save = await browser.post("/admin/members/7", { intent: "role", role: "OPERATOR", baseVersion: "1", spaceScope: ["3"] });
    expect(save.response.status).toBe(200);
    expect(body).toEqual({ role: "OPERATOR", customRoleId: null, spaceScope: ["3"], baseVersion: 1 });
  });

  it("공간 트리를 못 불러오면 공간 ID 입력으로 대신한다(쉼표 구분)", async () => {
    const browser = await admin();
    app.server.use(http.get(`${GW}/spaces`, () => HttpResponse.json({ header: { isSuccessful: false, resultCode: "SERVICE_UNAVAILABLE", resultMessage: "" } }, { status: 503 })));
    const page = await browser.get("/admin/members?tab=members&dialog=create");
    expect(page.body).toContain("공간 ID를 쉼표로 구분합니다");
    const key = /name="idempotencyKey" value="([^"]+)"/.exec(page.body)?.[1] as string;
    await browser.post("/admin/members?tab=members&dialog=create", { intent: "create", idempotencyKey: key, loginId: "park.op", email: "park@school.ac.kr", name: "박운영", role: "VIEWER", spaceScope: "3, 31", temporaryPassword: "" });
    const call = app.gateway.received.find((r) => r.method === "POST" && r.path === "/api/v1/core/users");
    expect((call?.body as { spaceScope: string[] }).spaceScope).toEqual(["3", "31"]);
  });

  it("회원 목록의 공간 필터는 spaceId 쿼리로 넘긴다", async () => {
    const browser = await admin();
    const page = await browser.get("/admin/members?tab=members&spaceId=31");
    expect(page.response.status).toBe(200);
    expect(app.gateway.received.some((r) => r.path.startsWith("/api/v1/core/users?") && r.path.includes("spaceId=31"))).toBe(true);
  });
});

describe("IAM-04.06 TC-IAM-143 실시간 스트림에도 공간 범위(웹은 토큰 없이 중계만, 거부는 서버)", () => {
  it("범위 밖 토픽 구독을 core가 거부하면 BFF는 그 결과 코드를 그대로 돌려준다", async () => {
    const browser = new TestBrowser(app);
    await browser.login("kim.op", "Correct-Horse-9");
    app.server.use(http.get(`${GW}/stream/live`, () => HttpResponse.json({ header: { isSuccessful: false, resultCode: "PERMISSION_DENIED", resultMessage: "" } }, { status: 403 })));
    const result = await browser.get("/bff/stream/live?topics=space:999");
    expect(result.response.status).toBe(403);
    expect(JSON.parse(result.body).header.resultCode).toBe("PERMISSION_DENIED");
  });
});
