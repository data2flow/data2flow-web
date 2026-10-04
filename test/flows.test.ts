/**
 * 자동화 플로우 화면 SSR + BFF 통합(UI-FLW-01·02·04·15, FLW-01.01·01.05·01.06·03.07·05.06).
 * 가짜 gateway는 test/msw/handlers/flows.ts(API-FLW-01~10·14·20·24·30, API-ACT-25).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TestBrowser, startApp, type AppContext } from "./app-harness";
import { flowsState } from "./msw/handlers/flows";

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
const operator = () => as("kim.op", "Correct-Horse-9");
const integrator = () => as("lee.int", "Integrator-Pass1");
const admin = () => as("admin01", "Admin-Pass-123");
const analyst = () => as("ana.lyst", "Analyst-Pass-123");
const viewer = () => as("view.er", "Viewer-Pass-123");

function json(browser: TestBrowser, path: string, method: string, body: unknown, headers: Record<string, string> = {}) {
  return browser.request(path, { method, headers: { "Content-Type": "application/json", "X-CSRF-TOKEN": browser.csrf, ...headers }, body: JSON.stringify(body) });
}
const parse = (body: string) => JSON.parse(body) as { header: { resultCode: string; isSuccessful: boolean }; response: Record<string, unknown>; errors?: unknown[] };
const state = () => flowsState(app.gateway.m2);

describe("UI-FLW-01 플로우 목록", () => {
  it("VIEWER는 메뉴·경로 모두 403(FLOW_READ 없음)", async () => {
    const browser = await viewer();
    const home = await browser.get("/");
    expect(home.body).not.toContain('href="/automation/flows"');
    expect((await browser.get("/automation/flows")).response.status).toBe(403);
  });

  it("ANALYST는 목록만(새 플로우·템플릿·상태 변경 없음), DEGRADED가 먼저", async () => {
    const browser = await analyst();
    const page = await browser.get("/automation/flows");
    expect(page.response.status).toBe(200);
    expect(page.body).toContain('href="/automation/flows"');
    expect(page.body.indexOf("CO2 환기 자동화")).toBeLessThan(page.body.indexOf("고온이면 냉방"));
    expect(page.body).toContain("성능 저하");
    expect(page.body).toContain("v13");
    // core는 목록의 metrics1h를 아직 생략한다(API-FLW-01): 오류 대신 "지표 없음"
    expect(page.body).toContain('title="지표 없음"');
    expect(page.body).not.toContain("새 플로우");
    expect(page.body).not.toContain("템플릿에서 만들기");
    expect((await browser.get("/automation/templates")).response.status).toBe(403);
    expect((await browser.get("/automation/flows/new")).response.status).toBe(403);
  });

  it("OPERATOR: 필터는 쿼리로, 일시 정지·재개, DRAFT 삭제는 이름 확인", async () => {
    const browser = await operator();
    const page = await browser.get("/automation/flows");
    expect(page.body).toContain("새 플로우");
    expect(page.body).toContain("템플릿에서 만들기");
    await browser.get("/automation/flows?q=냉방&status=ACTIVE&kind=FLOW&spaceId=31");
    const sent = app.gateway.received.filter((r) => r.path.startsWith("/api/v1/core/flows?")).at(-1)!;
    expect(sent.path).toContain("q=%EB%83%89%EB%B0%A9");
    expect(sent.path).toContain("status=ACTIVE");
    expect(sent.path).toContain("sort=health");
    expect(sent.path).toContain("size=50");
    const noMatch = await browser.get("/automation/flows?q=없는것");
    expect(noMatch.body).toContain("조건에 맞는 플로우가 없습니다");
    const paused = await browser.post("/automation/flows", { intent: "pause", flowId: "f-7f3a" });
    expect(paused.response.status).toBe(200);
    expect(state().flows.find((f) => f.flowId === "f-7f3a")?.status).toBe("PAUSED");
    const conflict = await browser.post("/automation/flows", { intent: "pause", flowId: "f-7f3a" });
    expect(conflict.response.status).toBe(409);
    expect(conflict.body).toContain("지금 상태에서는 할 수 없습니다");
    await browser.post("/automation/flows", { intent: "resume", flowId: "f-7f3a" });
    expect(state().flows.find((f) => f.flowId === "f-7f3a")?.status).toBe("ACTIVE");
    const dialog = await browser.get("/automation/flows?delete=f-draft");
    expect(dialog.body).toContain("플로우 삭제: 초안 플로우");
    const wrong = await browser.post("/automation/flows?delete=f-draft", { intent: "delete", flowId: "f-draft", name: "초안 플로우", confirmName: "초안" });
    expect(wrong.response.status).toBe(400);
    expect(wrong.body).toContain("이름이 일치하지 않습니다");
    const deleted = await browser.post("/automation/flows", { intent: "delete", flowId: "f-draft", name: "초안 플로우", confirmName: "초안 플로우" });
    expect(deleted.body).toContain("플로우를 삭제했습니다.");
    expect(state().flows.some((f) => f.flowId === "f-draft")).toBe(false);
    const active = await browser.post("/automation/flows", { intent: "delete", flowId: "f-7f3a", name: "고온이면 냉방", confirmName: "고온이면 냉방" });
    expect(active.response.status).toBe(409);
    expect((await browser.post("/automation/flows", { intent: "x", flowId: "f-7f3a" })).response.status).toBe(400);
  });

  it("플로우가 없으면 템플릿으로 시작하라는 안내", async () => {
    const browser = await operator();
    await browser.get("/automation/flows");
    state().flows.length = 0;
    const page = await browser.get("/automation/flows");
    expect(page.body).toContain("아직 자동화가 없습니다. 템플릿으로 시작해 보세요");
  });
});

describe("UI-FLW-04 템플릿 갤러리(FLW-01.05)", () => {
  it("TC-FLW-112 AT-FLW-01.3 VIEWER는 갤러리 403, API 직접 호출도 403", async () => {
    const browser = await viewer();
    expect((await browser.get("/automation/templates")).response.status).toBe(403);
    expect((await browser.get("/bff/api/core/flow-templates")).response.status).toBe(403);
  });

  it("TC-FLW-021 '고온이면 냉방'에 실습실·27℃·5분·24℃ → DRAFT 4노드, 대상 기기 없음 경고는 적용을 막지 않음", async () => {
    const browser = await operator();
    const gallery = await browser.get("/automation/templates");
    expect(gallery.body).toContain("고온이면 냉방");
    expect(gallery.body).toContain("필요: temperature, Thermostat");
    expect(gallery.body).toContain("텔레메트리 → 집계 → 임계값 → 기기 제어");
    // core 템플릿은 hot-then-cool·co2-then-ventilate 두 개(COMFORT)
    const safety = await browser.get("/automation/templates?category=SAFETY");
    expect(safety.body).toContain("템플릿이 없습니다");
    const co2 = (await browser.get("/automation/templates?q=CO2")).body;
    expect(co2).toContain(">CO2 높으면 환기</h2>");
    expect(co2).not.toContain(">고온이면 냉방</h2>");
    // 가상 환경 키트 배치에서 넘어온 공간 미리 채움(FLW-03.07)
    const form = await browser.get("/automation/templates?template=hot-then-cool&spaceId=31");
    expect(form.body).toContain("고온이면 냉방 템플릿으로 만들기");
    expect(form.body).toMatch(/<option value="31" selected="">/);
    const invalid = await browser.post("/automation/templates?template=hot-then-cool", { templateKey: "hot-then-cool", name: "", "p.spaceId": "31", "p.threshold": "50", "p.duration": "5", "p.duration.unit": "m", "p.targetTemperature": "24" });
    expect(invalid.response.status).toBe(400);
    expect(invalid.body).toContain("이름은 1~100자로 입력하세요");
    expect(invalid.body).toContain("40 이하여야 합니다");
    const created = await browser.post("/automation/templates?template=hot-then-cool", { templateKey: "hot-then-cool", name: "실습실 냉방", idempotencyKey: "k-1", "p.spaceId": "31", "p.threshold": "27", "p.duration": "5", "p.duration.unit": "m", "p.targetTemperature": "24" });
    expect(created.response.status).toBe(302);
    const location = created.response.headers.get("Location")!;
    expect(location).toMatch(/^\/automation\/flows\/f-\d+\?from=template$/);
    const post = app.gateway.received.filter((r) => r.path === "/api/v1/core/flow-templates/hot-then-cool/instantiate").at(-1)!;
    expect(post.body).toEqual({ name: "실습실 냉방", params: { spaceId: "31", threshold: 27, duration: "PT5M", targetTemperature: 24 } });
    expect(post.headers["idempotency-key"]).toBe("k-1");
    const flow = state().flows.at(-1)!;
    expect(flow.status).toBe("DRAFT");
    expect(flow.activeVersion).toBeNull();
    expect(flow.versions[0].definition.nodes.map((n) => n.type)).toEqual(["trigger.telemetry", "transform.aggregate", "condition.threshold", "action.control"]);
    const editor = await browser.get(location);
    expect(editor.response.status).toBe(200);
    expect(editor.body).toContain("대상 기기 없음");
    const dup = await browser.post("/automation/templates", { templateKey: "hot-then-cool", name: "실습실 냉방", "p.spaceId": "31", "p.threshold": "27", "p.duration": "5", "p.targetTemperature": "24" });
    expect(dup.response.status).toBe(409);
    expect(dup.body).toContain("같은 이름의 플로우가 있습니다");
    expect((await browser.post("/automation/templates", { templateKey: "nope", name: "x" })).response.status).toBe(404);
  });
});

describe("UI-FLW-02 편집기·버전 배포(FLW-01.01·01.06)", () => {
  it("ANALYST는 읽기 전용 편집기, 없는 플로우는 404", async () => {
    const browser = await analyst();
    const page = await browser.get("/automation/flows/f-7f3a");
    expect(page.response.status).toBe(200);
    expect(page.body).toContain("보기 전용(권한 없음)");
    expect(page.body).toContain("모든 인스턴스 v13 적용됨");
    expect(page.body).not.toContain("노드 팔레트");
    expect((await browser.get("/automation/flows/f-none")).response.status).toBe(404);
    const denied = await json(browser, "/bff/api/core/flows/f-7f3a/draft", "PUT", { baseVersion: 13, definition: {} });
    expect(denied.response.status).toBe(403);
  });

  it("새 플로우 화면과 카탈로그 팔레트, OPERATOR는 제어 노드 잠김", async () => {
    const browser = await operator();
    const page = await browser.get("/automation/flows/new");
    expect(page.response.status).toBe(200);
    expect(page.body).toContain("노드 팔레트");
    expect(page.body).toContain("팔레트에서 트리거를 끌어다 놓으세요");
    expect(page.body).toContain("기기 제어 (잠김)");
  });

  it("초안 저장(baseVersion 충돌 409) → 검증 → 적용 ACTIVE v14, 버전 목록·비교·롤백", async () => {
    const browser = await integrator();
    await browser.get("/automation/flows/f-7f3a");
    const detail = parse((await browser.get("/bff/api/core/flows/f-7f3a")).body).response as { version: { definition: { nodes: { id: string; config: Record<string, unknown> }[] } } };
    const definition = detail.version.definition;
    definition.nodes[2].config.value = 28;
    const stale = await json(browser, "/bff/api/core/flows/f-7f3a/draft", "PUT", { baseVersion: 12, definition });
    expect(stale.response.status).toBe(409);
    expect(parse(stale.body).header.resultCode).toBe("FLOW_VERSION_CONFLICT");
    const saved = await json(browser, "/bff/api/core/flows/f-7f3a/draft", "PUT", { baseVersion: 13, definition });
    expect(parse(saved.body).response).toMatchObject({ draftVersion: 14 });
    // 저장할 때마다 새 번호: 다음 저장의 baseVersion은 직전 응답 draftVersion(14). 옛 기준(13)은 409
    expect((await json(browser, "/bff/api/core/flows/f-7f3a/draft", "PUT", { baseVersion: 13, definition })).response.status).toBe(409);
    const resaved = await json(browser, "/bff/api/core/flows/f-7f3a/draft", "PUT", { baseVersion: 14, definition });
    expect(parse(resaved.body).response).toMatchObject({ draftVersion: 15 });
    const validated = parse((await json(browser, "/bff/api/core/flows/f-7f3a/validate", "POST", { version: 15 })).body).response;
    expect(validated.changeSummary).toEqual({ added: [], removed: [], changed: [{ nodeId: "n-thr00001", statePolicy: "KEEP" }] });
    // baseVersion은 지금 ACTIVE 번호(13)
    const applied = await json(browser, "/bff/api/core/flows/f-7f3a/apply", "POST", { version: 15, baseVersion: 13, memo: "기준 28", acknowledgedRisks: false }, { "Idempotency-Key": "ap-1" });
    expect(parse(applied.body).response).toMatchObject({ appliedVersion: 15 });
    const page = await browser.get("/automation/flows/f-7f3a");
    expect(page.body).toContain("실행 v15");
    const versions = parse((await browser.get("/bff/api/core/flows/f-7f3a/versions")).body) as unknown as { responses: { version: number; state: string }[] };
    expect(versions.responses.map((v) => `${v.version}:${v.state}`)).toEqual(["15:ACTIVE", "13:ARCHIVED", "12:ARCHIVED"]);
    const diff = parse((await browser.get("/bff/api/core/flows/f-7f3a/version-diff?from=13&to=15")).body).response;
    expect(diff.changed).toEqual([{ nodeId: "n-thr00001", fields: ["config.value"], statePolicy: "KEEP" }]);
    // 롤백은 보관(ARCHIVED) 버전을 다시 적용한다(새 번호 없음)
    const rollback = await json(browser, "/bff/api/core/flows/f-7f3a/rollback", "POST", { toVersion: 13, memo: "되돌림" });
    expect(parse(rollback.body).response).toMatchObject({ appliedVersion: 13 });
    expect(state().flows[0].activeVersion).toBe(13);
    expect(state().flows[0].versions.find((v) => v.state === "ACTIVE")?.definition.nodes[2].config.value).toBe(27);
  });

  it("TC-FLW-113 AT-FLW-03.5 OPERATOR가 제어 노드 플로우 적용 → 403 PERMISSION_DENIED", async () => {
    const browser = await operator();
    await browser.get("/automation/flows/f-7f3a");
    const detail = parse((await browser.get("/bff/api/core/flows/f-7f3a")).body).response as { version: { definition: { nodes: { config: Record<string, unknown> }[] } } };
    detail.version.definition.nodes[3].config.args = { mode: "cool", targetTemperature: 23 };
    await json(browser, "/bff/api/core/flows/f-7f3a/draft", "PUT", { baseVersion: 13, definition: detail.version.definition });
    const denied = await json(browser, "/bff/api/core/flows/f-7f3a/apply", "POST", { version: 14, baseVersion: 13, acknowledgedRisks: true });
    expect(denied.response.status).toBe(403);
    expect(parse(denied.body).header.resultCode).toBe("PERMISSION_DENIED");
    expect(state().flows[0].activeVersion).toBe(13);
  });

  it("TC-FLW-114·120 AT-FLW-23.1 승인 필요 설정: INTEGRATOR 적용 → 202 승인 대기, ADMIN 승인 → ACTIVE", async () => {
    const browser = await integrator();
    await browser.get("/automation/flows/f-7f3a");
    state().requireApproval = true;
    const detail = parse((await browser.get("/bff/api/core/flows/f-7f3a")).body).response as { version: { definition: { nodes: { config: Record<string, unknown> }[] } } };
    detail.version.definition.nodes[3].config.args = { mode: "cool", targetTemperature: 23 };
    await json(browser, "/bff/api/core/flows/f-7f3a/draft", "PUT", { baseVersion: 13, definition: detail.version.definition });
    const validated = parse((await json(browser, "/bff/api/core/flows/f-7f3a/validate", "POST", { version: 14 })).body).response;
    expect(validated).toMatchObject({ risky: { controlNodesChanged: true }, approvalRequired: true });
    // 위험 변경인데 확인이 없으면 400 INVALID_REQUEST errors[{field: acknowledgedRisks}]
    const unacknowledged = await json(browser, "/bff/api/core/flows/f-7f3a/apply", "POST", { version: 14, baseVersion: 13 });
    expect(unacknowledged.response.status).toBe(400);
    expect(parse(unacknowledged.body).errors).toEqual([expect.objectContaining({ field: "acknowledgedRisks", code: "AssertTrue" })]);
    const pending = await json(browser, "/bff/api/core/flows/f-7f3a/apply", "POST", { version: 14, baseVersion: 13, acknowledgedRisks: true });
    expect(pending.response.status).toBe(202);
    expect(parse(pending.body).header).toMatchObject({ resultCode: "FLOW_APPROVAL_REQUIRED", isSuccessful: true });
    expect(parse(pending.body).response).toEqual({ approvalId: state().approvals[0].approvalId, version: 14 });
    expect(state().flows[0].activeVersion).toBe(13);
    const own = await browser.get("/automation/approvals");
    expect(own.body).toContain("내가 보낸 요청만 보입니다");
    expect(own.body).toContain("고온이면 냉방 v14");
    expect(own.body).not.toContain(">승인<");

    const boss = await admin();
    const list = await boss.get("/automation/approvals");
    expect(list.body).toContain("고온이면 냉방 v14");
    expect(list.body).toContain("제어 노드");
    const approvalId = state().approvals[0].approvalId;
    const noReason = await boss.post("/automation/approvals", { intent: "reject", approvalId, reason: "" });
    expect(noReason.response.status).toBe(400);
    expect(noReason.body).toContain("거절 사유를 1~500자로 입력하세요");
    const ok = await boss.post("/automation/approvals", { intent: "approve", approvalId });
    expect(ok.body).toContain("승인했습니다. 원자적으로 적용됩니다.");
    expect(state().flows[0].activeVersion).toBe(14);
    const again = await boss.post("/automation/approvals", { intent: "approve", approvalId });
    expect(again.response.status).toBe(409);
    expect((await boss.post("/automation/approvals", { intent: "x" })).response.status).toBe(400);
    expect((await boss.get("/automation/approvals")).body).toContain("승인 대기 중인 요청이 없습니다");
  });

  it("거절 흐름과 비관리자 승인 API 403", async () => {
    const browser = await integrator();
    await browser.get("/automation/flows/f-7f3a");
    state().requireApproval = true;
    const detail = parse((await browser.get("/bff/api/core/flows/f-7f3a")).body).response as { version: { definition: { nodes: { config: Record<string, unknown> }[] } } };
    detail.version.definition.nodes[3].config.validitySeconds = 300;
    await json(browser, "/bff/api/core/flows/f-7f3a/draft", "PUT", { baseVersion: 13, definition: detail.version.definition });
    // 제어 노드가 바뀌면 승인 대기
    await json(browser, "/bff/api/core/flows/f-7f3a/apply", "POST", { version: 14, baseVersion: 13, acknowledgedRisks: true });
    const approvalId = state().approvals[0].approvalId;
    expect((await json(browser, `/bff/api/core/flow-approvals/${approvalId}/approve`, "POST", {})).response.status).toBe(403);
    const boss = await admin();
    await boss.get("/automation/approvals");
    const rejected = await boss.post("/automation/approvals", { intent: "reject", approvalId, reason: "기준이 너무 낮음" });
    expect(rejected.body).toContain("거절했습니다");
    expect(state().approvals[0].status).toBe("REJECTED");
  });

  it("오류 격리(FLW-05.03) 지표와 가상 공간 연결 표시(FLW-03.07), 기능 카탈로그", async () => {
    const browser = await operator();
    const page = await browser.get("/automation/flows/f-co2");
    expect(page.response.status).toBe(200);
    expect(app.gateway.received.some((r) => r.path === "/api/v1/core/flows/f-co2/metrics?window=1h&step=1m")).toBe(true);
    // 엔진 지표를 받을 수 없으면(503) 화면은 열리고 오류 탭은 "지표 없음"
    state().metricsUnavailable = true;
    const noMetrics = await browser.get("/automation/flows/f-co2");
    expect(noMetrics.response.status).toBe(200);
    const caps = parse((await browser.get("/bff/api/core/capabilities/Thermostat")).body).response as { attributes: { name: string }[] };
    expect(caps.attributes.map((a) => a.name)).toContain("targetTemperature");
    expect((await browser.get("/bff/api/core/capabilities/Nope")).response.status).toBe(404);
    expect((await browser.get("/bff/api/core/capabilities")).response.status).toBe(200);
    expect((await json(browser, "/bff/api/core/flows", "POST", { name: "고온이면 냉방", definition: { nodes: [], wires: [] } })).response.status).toBe(409);
    const created = parse((await json(browser, "/bff/api/core/flows", "POST", { name: "새 자동화", definition: { schema: "data2flow.flow-definition/v1", nodes: [], wires: [] } })).body).response;
    expect(created).toMatchObject({ draftVersion: 1 });
    const renamed = await json(browser, `/bff/api/core/flows/${created.flowId}`, "PATCH", { name: "고온이면 냉방" });
    expect(renamed.response.status).toBe(409);
  });
});
