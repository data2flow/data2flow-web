/**
 * 스크립트 화면 SSR + BFF 통합(UI-SCR-01·02, SCR-03.01·03.02·04.05, SCR-03.04 배포 최소 흐름).
 * 가짜 gateway는 test/msw/handlers/scripts.ts(API-SCR-01~08·15).
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

async function as(loginId: string, password: string) {
  const browser = new TestBrowser(app);
  const result = await browser.login(loginId, password);
  expect(result.response.status).toBe(302);
  return browser;
}
const integrator = () => as("lee.int", "Integrator-Pass1");
const operator = () => as("kim.op", "Correct-Horse-9");

function json(browser: TestBrowser, path: string, method: string, body: unknown, headers: Record<string, string> = {}) {
  return browser.request(path, { method, headers: { "Content-Type": "application/json", "X-CSRF-TOKEN": browser.csrf, ...headers }, body: JSON.stringify(body) });
}

describe("UI-SCR-01 스크립트 목록", () => {
  it("SCRIPT_READ 없는 VIEWER는 403 화면", async () => {
    const viewer = await as("view.er", "Viewer-Pass-123");
    const page = await viewer.get("/scripts");
    expect(page.response.status).toBe(403);
  });

  it("OPERATOR는 목록만(새 스크립트 버튼 없음), 행에 종류·대상·활성 버전·DRAFT 표시", async () => {
    const browser = await operator();
    const page = await browser.get("/scripts");
    expect(page.response.status).toBe(200);
    expect(page.body).toContain("온도 보정 오프셋");
    expect(page.body).toContain("모델 1");
    expect(page.body).toContain("v4");
    expect(page.body).toContain("저장된 DRAFT 있음");
    expect(page.body).not.toContain("새 스크립트");
  });

  it("INTEGRATOR: 사용량 n / 300, 필터는 쿼리로 넘김, 결과 없음 안내", async () => {
    const browser = await integrator();
    const page = await browser.get("/scripts");
    expect(page.body).toContain("스크립트 1 / 300");
    expect(page.body).toContain("새 스크립트");
    const filtered = await browser.get("/scripts?kind=DECODE&checkFailed=true&keyword=x");
    expect(app.gateway.received.some((r) => r.path.startsWith("/api/v1/core/scripts?") && r.path.includes("kind=DECODE") && r.path.includes("checkFailed=true") && r.path.includes("keyword=x"))).toBe(true);
    expect(filtered.body).toContain("조건에 맞는 스크립트가 없습니다");
  });

  it("스크립트가 없으면 템플릿으로 시작하라는 안내", async () => {
    const browser = await integrator();
    await browser.get("/scripts");
    app.gateway.m2.scripts.length = 0;
    const page = await browser.get("/scripts");
    expect(page.body).toContain("아직 스크립트가 없습니다. 템플릿으로 시작해 보세요");
    expect(page.body).toContain("템플릿에서 만들기");
  });

  it("[새 스크립트] 대화상자 → 만들면 편집기로 이동, 검증 오류·이름 중복은 안내", async () => {
    const browser = await integrator();
    const dialog = await browser.get("/scripts?dialog=create&template=calibration-offset");
    expect(dialog.body).toContain("새 스크립트");
    expect(dialog.body).toContain("보정 오프셋");
    expect(dialog.body).toContain("EM300-TH");
    const bad = await browser.post("/scripts?dialog=create", { intent: "create", name: "a", kind: "TRANSFORM", idempotencyKey: "k1" });
    expect(bad.response.status).toBe(400);
    expect(bad.body).toContain("이름은 2~80자로 입력해 주세요.");
    const dup = await browser.post("/scripts?dialog=create", { intent: "create", name: "온도 보정 오프셋", kind: "TRANSFORM", idempotencyKey: "k2" });
    expect(dup.response.status).toBe(409);
    expect(dup.body).toContain("이미 같은 이름의 스크립트가 있습니다");
    const created = await browser.post("/scripts?dialog=create", { intent: "create", name: "이슬점 파생", kind: "TRANSFORM", templateKey: "dew-point", modelId: ["11", "12"], idempotencyKey: "k3" });
    expect(created.response.status).toBe(302);
    expect(created.response.headers.get("Location")).toMatch(/^\/scripts\/\d+$/);
    const post = app.gateway.received.filter((r) => r.method === "POST" && r.path === "/api/v1/core/scripts").at(-1);
    expect(post?.body).toEqual({ name: "이슬점 파생", kind: "TRANSFORM", templateKey: "dew-point", bindings: [{ targetType: "MODEL", targetId: "11", failurePolicy: "FAIL_OPEN" }, { targetType: "MODEL", targetId: "12", failurePolicy: "FAIL_OPEN" }] });
    expect(post?.headers["idempotency-key"]).toBe("k3");
    const decode = await browser.post("/scripts?dialog=create", { intent: "create", name: "ESP32 디코더", kind: "DECODE", sourceId: "7", idempotencyKey: "k4" });
    expect(decode.response.status).toBe(302);
    expect(app.gateway.received.filter((r) => r.path === "/api/v1/core/scripts" && r.method === "POST").at(-1)?.body).toMatchObject({ bindings: [{ targetType: "SOURCE", targetId: "7", failurePolicy: "FAIL_CLOSED" }] });
    expect((await browser.post("/scripts", { intent: "other" })).response.status).toBe(400);
  });
});

describe("UI-SCR-02 스크립트 편집기", () => {
  it("OPERATOR는 읽기 전용(저장·배포·테스트 없음), 쓰기 API는 서버가 403", async () => {
    const browser = await operator();
    const page = await browser.get("/scripts/501");
    expect(page.response.status).toBe(200);
    expect(page.body).toContain("조회 전용입니다");
    expect(page.body).not.toMatch(/>저장</);
    expect(page.body).not.toMatch(/>배포</);
    expect(page.body).not.toMatch(/>실행</);
    const denied = await json(browser, "/bff/api/core/scripts/501/draft", "PUT", { code: "x", baseVersionNo: 5 });
    expect(denied.response.status).toBe(403);
  });

  it("INTEGRATOR: 머리줄(ACTIVE v4 · DRAFT v5), 연결 칩, 코드, 테스트 패널, 없는 스크립트는 404", async () => {
    const browser = await integrator();
    const page = await browser.get("/scripts/501");
    expect(page.body).toContain("ACTIVE v4");
    expect(page.body).toContain("DRAFT v5");
    expect(page.body).toContain("MODEL EM300-TH");
    expect(page.body).toContain("function transform(msg, ctx)");
    expect(page.body).toMatch(/>실행</);
    const versions = await browser.get("/scripts/501?tab=versions");
    expect(versions.body).toContain("오프셋 설정값으로 분리");
    expect((await browser.get("/scripts/999")).response.status).toBe(404);
  });

  it("TC-SCR-077 정적 검사·TC-SCR-079 DRAFT 저장(baseVersionNo, 충돌 409)·검사 오류면 배포 400", async () => {
    const browser = await integrator();
    await browser.get("/scripts/501");
    const check = await json(browser, "/bff/api/core/scripts/check", "POST", { kind: "TRANSFORM", code: 'function transform(msg, ctx) {\n  // a\n  const fs = require("fs");\n  return msg;\n}' });
    expect(JSON.parse(check.body).response.problems).toEqual([{ line: 3, col: 14, severity: "ERROR", code: "SCRIPT_FORBIDDEN_API", message: "금지된 API: require" }]);
    const bad = 'function transform(msg, ctx) {\n  return require("fs");\n}';
    const saved = await json(browser, "/bff/api/core/scripts/501/draft", "PUT", { code: bad, baseVersionNo: 5 });
    expect(saved.response.status).toBe(200);
    expect(JSON.parse(saved.body).response).toMatchObject({ versionNo: 5, staticCheck: { ok: false } });
    expect(app.gateway.received.find((r) => r.method === "PUT")?.body).toEqual({ code: bad, baseVersionNo: 5 });
    const conflict = await json(browser, "/bff/api/core/scripts/501/draft", "PUT", { code: bad, baseVersionNo: 4 });
    expect(conflict.response.status).toBe(409);
    expect(JSON.parse(conflict.body).header.resultCode).toBe("SCRIPT_VERSION_CONFLICT");
    const blocked = await json(browser, "/bff/api/core/scripts/501/deploy", "POST", { versionId: "805", memo: "배포 시도", baseActiveVersionId: "804" }, { "Idempotency-Key": "d1" });
    expect(blocked.response.status).toBe(400);
    expect(JSON.parse(blocked.body).header.resultCode).toBe("SCRIPT_STATIC_CHECK_FAILED");
  });

  it("검사를 통과한 DRAFT는 배포(Idempotency-Key 전달), 적용 n/n, 이후 화면은 ACTIVE v5", async () => {
    const browser = await integrator();
    await browser.get("/scripts/501");
    const deployed = await json(browser, "/bff/api/core/scripts/501/deploy", "POST", { versionId: "805", memo: "오프셋 조정", baseActiveVersionId: "804" }, { "Idempotency-Key": "d2" });
    expect(deployed.response.status).toBe(200);
    expect(JSON.parse(deployed.body).response.applied).toMatchObject({ reported: 2, total: 2 });
    const request = app.gateway.received.find((r) => r.path === "/api/v1/core/scripts/501/deploy");
    expect(request?.headers["idempotency-key"]).toBe("d2");
    const page = await browser.get("/scripts/501");
    expect(page.body).toContain("ACTIVE v5");
  });

  it("SCR-03.02 테스트 실행(API-SCR-08 /scripts/test-run): 결과·차이·로그, while(true)는 SCRIPT_TIMEOUT", async () => {
    const browser = await integrator();
    await browser.get("/scripts/501");
    const run = await json(browser, "/bff/api/core/scripts/test-run", "POST", { kind: "TRANSFORM", code: "function transform(msg){return msg}", input: { metrics: [{ key: "temperature", value: 22.3 }] }, scriptId: "501" });
    const result = JSON.parse(run.body).response;
    expect(result.diff.changed).toEqual([{ key: "temperature", from: 22.3, to: 22.8 }]);
    expect(result.logs).toHaveLength(4);
    const timeout = await json(browser, "/bff/api/core/scripts/test-run", "POST", { kind: "TRANSFORM", code: "function transform(){ while(true){} }" });
    expect(JSON.parse(timeout.body).response.error.code).toBe("SCRIPT_TIMEOUT");
  });
});
