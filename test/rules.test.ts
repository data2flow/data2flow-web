/**
 * 규칙 화면 SSR + BFF 통합(UI-RUL-01·02·03·10, RUL-01.01~13·06.02~06.04).
 * 가짜 gateway는 test/msw/handlers/rules.ts(API-RUL-01~08).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TestBrowser, startApp, type AppContext } from "./app-harness";
import { rulesState } from "./msw/handlers/rules";

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
const analyst = () => as("ana.lyst", "Analyst-Pass-123");
const viewer = () => as("view.er", "Viewer-Pass-123");
const state = () => rulesState(app.gateway.m2);

const payload = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    name: "사무실 고CO2",
    templateKey: "high-co2",
    scope: { type: "SPACE", ids: ["32"], includeChildren: true },
    condition: { kind: "threshold", metric: "co2", op: ">", value: 1000, for: "PT5M", clear: 900 },
    timeCondition: null,
    severity: "MAJOR",
    titleTemplate: "고CO2 · {{space.path}}",
    autoClear: true,
    ...extra,
  });

describe("UI-RUL-01 규칙 목록(RUL-06.03·06.04)", () => {
  it("VIEWER는 메뉴는 알람만, /rules는 403(RULE_READ 없음)", async () => {
    const browser = await viewer();
    const home = await browser.get("/");
    expect(home.body).toContain('href="/alarms"');
    expect((await browser.get("/rules")).response.status).toBe(403);
    expect((await browser.get("/rules/tuning")).response.status).toBe(403);
  });

  it("TC-RUL-106 AT-RUL-01.3 ERROR 규칙이 사유와 함께 맨 위, ANALYST는 새 규칙·행 메뉴 없음", async () => {
    const browser = await analyst();
    const page = await browser.get("/rules");
    expect(page.response.status).toBe(200);
    expect(page.body.indexOf("야간 문열림")).toBeLessThan(page.body.indexOf("본관 고CO2"));
    expect(page.body).toContain("대상 기기 없음");
    expect(page.body).toContain("co2 &gt; 1000ppm 5분");
    expect(page.body).toContain("튜닝 제안 1건");
    expect(page.body).not.toContain("새 규칙");
    expect(page.body).not.toContain("플로우로 열기");
    expect((await browser.get("/rules/new")).response.status).toBe(403);
  });

  it("OPERATOR: 필터는 API 쿼리로, 비활성·활성, 삭제(열린 알람 해제), 플로우로 열기(AT-RUL-15.1·15.2)", async () => {
    const browser = await operator();
    await browser.get("/rules?q=CO2&status=ACTIVE&severity=MAJOR");
    const sent = app.gateway.received.filter((r) => r.path.startsWith("/api/v1/core/rules?")).at(-1)!;
    expect(sent.path).toContain("status=ACTIVE");
    expect(sent.path).toContain("severity=MAJOR");
    expect(sent.path).toContain("q=CO2");
    expect((await browser.post("/rules", { intent: "deactivate", ruleId: "301" })).response.status).toBe(200);
    expect(state().rules[0].status).toBe("INACTIVE");
    const again = await browser.post("/rules", { intent: "deactivate", ruleId: "301" });
    expect(again.response.status).toBe(409);
    expect(again.body).toContain("지금 상태에서는 할 수 없습니다");
    await browser.post("/rules", { intent: "activate", ruleId: "301" });
    expect(state().rules[0].status).toBe("ACTIVE");
    const converted = await browser.post("/rules", { intent: "convert", ruleId: "302" });
    expect(converted.response.status).toBe(302);
    expect(converted.response.headers.get("location")).toBe("/automation/flows/0d6f2b1e-7c4a-4b8e-9f00-000000000302");
    expect((await browser.get("/rules")).body).not.toContain("야간 문열림");
    await browser.post("/rules", { intent: "delete", ruleId: "301", clearOpenAlarms: "true" });
    expect(state().alarms.find((a) => a.id === "9001")?.status).toBe("CLEARED");
    expect((await browser.get("/rules")).body).toContain("규칙이 없습니다. 템플릿으로 시작하세요");
  });

  it("RUL-06.04 규칙 900개 이상이면 한도 근접 배너", async () => {
    const browser = await operator();
    const base = state().rules[0];
    for (let i = 0; i < 900; i += 1) state().rules.push({ ...base, ruleId: String(1000 + i), name: `규칙 ${i}` });
    expect((await browser.get("/rules")).body).toContain("규칙이 902개입니다. 조직당 1000개까지 만들 수 있습니다.");
  });
});

describe("UI-RUL-02 규칙 만들기·수정(RUL-01.01~10)", () => {
  it("TC-RUL-106 AT-RUL-01.3 co2 기기가 없는 범위로 저장 → ERROR(NO_TARGET)와 경고, 목록 맨 위", async () => {
    const browser = await operator();
    const form = await browser.get("/rules/new?template=high-co2");
    expect(form.response.status).toBe(200);
    const saved = await browser.post("/rules/new", { intent: "save", payload: payload() });
    expect(saved.response.status).toBe(302);
    const location = saved.response.headers.get("location")!;
    expect(location).toMatch(/^\/rules\/\d+\?saved=1&warn=NO_TARGET$/);
    const detail = await browser.get(location);
    expect(detail.body).toContain("대상 기기가 없습니다");
    expect(detail.body).toContain("규칙 오류: 대상 기기 없음");
    const sent = app.gateway.received.find((r) => r.method === "POST" && r.path === "/api/v1/core/rules")!;
    expect(sent.body).toMatchObject({ scope: { type: "SPACE", ids: ["32"] }, condition: { metric: "co2", clear: 900 } });
    const list = await browser.get("/rules");
    expect(list.body.indexOf("사무실 고CO2")).toBeLessThan(list.body.indexOf("본관 고CO2"));
  });

  it("AT-RUL-01.1 본관(하위 포함)에 고CO2 → ACTIVE, 대상 1대. 같은 이름은 409", async () => {
    const browser = await operator();
    await browser.get("/rules/new");
    const saved = await browser.post("/rules/new", { intent: "save", payload: payload({ name: "본관 새 고CO2", scope: { type: "SPACE", ids: ["2"], includeChildren: true } }) });
    expect(saved.response.status).toBe(302);
    expect(state().rules[0]).toMatchObject({ status: "ACTIVE", scope: { targetCount: 1 } });
    const dup = await browser.post("/rules/new", { intent: "save", payload: payload({ name: "본관 고CO2" }) });
    expect(dup.response.status).toBe(409);
    expect(dup.body).toContain("같은 이름의 규칙이 있습니다");
    const broken = await browser.post("/rules/new", { intent: "save", payload: "{" });
    expect(broken.response.status).toBe(400);
  });

  it("RUL-01.08 이상 탐지 조건은 엔진이 거부(400 RULE_CONDITION_INVALID, rule.condition.kind UNSUPPORTED) → 조건 아래 안내", async () => {
    const browser = await operator();
    await browser.get("/rules/new");
    const anomaly = await browser.post("/rules/new", { intent: "save", payload: payload({ name: "이상 탐지", condition: { kind: "anomaly", minScore: 3, metric: "co2" } }) });
    expect(anomaly.response.status).toBe(400);
    expect(anomaly.body).toContain("조건이 올바르지 않습니다");
    expect(anomaly.body).toContain("이상 탐지 조건은 아직 저장할 수 없습니다");
    expect(state().rules.some((r) => r.name === "이상 탐지")).toBe(false);
  });

  it("수정은 baseVersion으로(낡은 버전이면 409 안내), ANALYST는 읽기 전용", async () => {
    const browser = await operator();
    const page = await browser.get("/rules/301");
    expect(page.body).toContain("본관 고CO2");
    const ok = await browser.post("/rules/301", { intent: "save", payload: payload({ name: "본관 고CO2", scope: { type: "SPACE", ids: ["2"], includeChildren: true }, baseVersion: 3 }) });
    expect(ok.response.status).toBe(302);
    expect(state().rules.find((r) => r.ruleId === "301")?.version).toBe(4);
    const stale = await browser.post("/rules/301", { intent: "save", payload: payload({ name: "본관 고CO2", baseVersion: 3 }) });
    expect(stale.response.status).toBe(409);
    expect(stale.body).toContain("그 사이 다른 사람이 이 규칙을 바꿨습니다");
    expect((await browser.get("/rules/99999")).response.status).toBe(404);
    const ana = await analyst();
    const read = await ana.get("/rules/301");
    expect(read.response.status).toBe(200);
    expect(read.body).not.toContain(">저장<");
  });

  it("TC-RUL-036 AT-RUL-05.1 차트 기준선 → API-RUL-07 초안으로 폼(metric=co2, op=>, value=1000, 대상=실습실)", async () => {
    const browser = await operator();
    const page = await browser.get("/rules/new?fromChart=1&metric=co2&op=%3E&value=1000&spaceId=31");
    expect(page.response.status).toBe(200);
    const sent = app.gateway.received.find((r) => r.path === "/api/v1/core/rules/draft-from-chart")!;
    expect(sent.body).toEqual({ metric: "co2", value: 1000, op: ">", target: { spaceId: "31" } });
    expect(page.body).toContain('value="co2 &gt; 1000"');
    const device = await browser.get("/rules/new?fromChart=1&metric=co2&op=%3E&value=1200&deviceIds=1042");
    expect(device.response.status).toBe(200);
    expect(app.gateway.received.filter((r) => r.path === "/api/v1/core/rules/draft-from-chart").at(-1)!.body).toMatchObject({ target: { deviceIds: ["1042"] } });
    // 복제: 원본 값으로 채우고 이름 뒤에 (2)
    expect((await browser.get("/rules/new?copy=301")).body).toContain('value="본관 고CO2 (2)"');
  });

  it("RUL-01.11 시뮬레이션 BFF 중계(동기 200, 30일 넘으면 400)", async () => {
    const browser = await operator();
    await browser.get("/rules/301");
    const body = { rule: JSON.parse(payload()), from: "2026-09-27T00:00:00Z", to: "2026-10-04T00:00:00Z" };
    const sync = await browser.request("/bff/api/core/rules/simulate", { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-TOKEN": browser.csrf }, body: JSON.stringify(body) });
    expect(JSON.parse(sync.body).response.alarms).toBe(14);
    const tooLong = await browser.request("/bff/api/core/rules/301/simulate", { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-TOKEN": browser.csrf }, body: JSON.stringify({ ...body, from: "2026-08-01T00:00:00Z" }) });
    expect(tooLong.response.status).toBe(400);
    expect(JSON.parse(tooLong.body).header.resultCode).toBe("RULE_SIMULATION_RANGE_INVALID");
    expect((await browser.get("/rules/301?simulate=1")).response.status).toBe(200);
  });
});

describe("UI-RUL-10 튜닝 제안(RUL-06.02, BR-RUL-22, AT-RUL-14.2)", () => {
  it("제안 목록(현재 → 제안, 예상 알람 40 → 6), 적용하면 새 규칙 버전, 무시", async () => {
    const browser = await operator();
    const page = await browser.get("/rules/tuning");
    expect(page.body).toContain("과다 발생");
    expect(page.body).toContain("예상 알람 40건 → 6건");
    expect(page.body).toContain("co2 &gt; 1000ppm 15분");
    const applied = await browser.post("/rules/tuning", { intent: "apply", id: "41" });
    expect(applied.body).toContain("제안을 적용했습니다(규칙 버전 4)");
    expect((await browser.get("/rules/tuning")).body).toContain("열린 튜닝 제안이 없습니다");
    expect((await browser.post("/rules/tuning", { intent: "nope", id: "41" })).response.status).toBe(400);
    const ana = await analyst();
    expect((await ana.get("/rules/tuning")).body).not.toContain(">적용<");
  });
});
