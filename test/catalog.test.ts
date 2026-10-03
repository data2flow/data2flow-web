/**
 * 기기 모델·측정 항목·그룹 화면 SSR + BFF 통합(UI-DEV-08·09·11): DEV-03.01, DEV-04.01, DEV-04.02, DEV-06.01, DEV-07.05.
 * gateway는 가짜(test/msw/handlers/models.ts·groups.ts, design/api/DEV-api.md §3~§5 계약).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TestBrowser, startApp, type AppContext } from "./app-harness";
import { groupExtra } from "./msw/handlers/groups";

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
  // 로그인 뒤 세션 CSRF 토큰을 받는다
  await browser.get("/");
  return browser;
}
const integrator = () => as("lee.int", "Integrator-Pass1");
const operator = () => as("kim.op", "Correct-Horse-9");
const viewer = () => as("view.er", "Viewer-Pass-123");
const writes = () => app.gateway.received.filter((r) => r.method !== "GET" && r.path.startsWith("/api/v1/core/"));

describe("DEV-03.01 UI-DEV-08 기기 모델", () => {
  it("TC-DEV-093 목록 카드(제조사·통신 방식·측정 항목 수·기기 수·기본 제공 배지)와 필터, INTEGRATOR에게만 [새 모델]", async () => {
    const browser = await integrator();
    const page = await browser.get("/models");
    expect(page.response.status).toBe(200);
    expect(page.body).toContain("AM107");
    expect(page.body).toContain("측정 항목 3개");
    expect(page.body).toContain("기본 제공");
    expect(page.body).toContain('href="/models?new=1"');
    const filtered = await browser.get("/models?protocol=MQTT");
    expect(filtered.body).toContain("조건에 맞는 모델이 없습니다");
    const custom = await browser.get("/models?builtin=false");
    expect(custom.body).toContain("조건에 맞는 모델이 없습니다");
    const reader = await viewer();
    const viewPage = await reader.get("/models");
    expect(viewPage.response.status).toBe(200);
    expect(viewPage.body).not.toContain('href="/models?new=1"');
  });

  it("TC-DEV-093 새 모델: 코드 형식·측정 항목 검증 문구, 저장하면 상세로 이동, 같은 코드는 MODEL_CODE_DUPLICATE", async () => {
    const browser = await integrator();
    const form = await browser.get("/models?new=1");
    expect(form.body).toContain('name="metrics"');
    const bad = await browser.post("/models?new=1", { code: "esp", vendor: "자체", name: "ESP", protocol: "MQTT", kind: "SENSOR", defaultIntervalSec: "60" });
    expect(bad.response.status).toBe(400);
    expect(bad.body).toContain("코드는 영문 대문자·숫자로 시작하는 50자 이하");
    expect(bad.body).toContain("센서 모델은 측정 항목이 1개 이상 있어야 합니다");
    const ok = await browser.post("/models?new=1", { code: "ESP32-TH", vendor: "자체 제작", name: "ESP32-TH", protocol: "MQTT", kind: "SENSOR", defaultIntervalSec: "60", metrics: ["temperature", "humidity"], capabilities: "" });
    expect(ok.response.headers.get("Location")).toBe("/models/ESP32-TH");
    expect(writes().at(-1)?.body).toMatchObject({ code: "ESP32-TH", protocol: "MQTT", metrics: [{ key: "temperature", required: true }, { key: "humidity", required: true }] });
    expect(writes().at(-1)?.headers["idempotency-key"]).toBeTruthy();
    const dup = await browser.post("/models?new=1", { code: "ESP32-TH", vendor: "a", name: "b", protocol: "MQTT", kind: "SENSOR", metrics: "temperature" });
    expect(dup.response.status).toBe(409);
    expect(dup.body).toContain("같은 코드의 모델이 이미 있습니다.");
  });

  it("OPERATOR가 모델 생성 API를 직접 부르면 403, 화면에는 생성 폼이 없다", async () => {
    const browser = await operator();
    const page = await browser.get("/models?new=1");
    expect(page.body).not.toContain('name="code"');
    const denied = await browser.post("/models?new=1", { code: "X-1", vendor: "a", name: "b", protocol: "MQTT", kind: "ACTUATOR" });
    expect(denied.response.status).toBe(403);
  });

  it("BR-DEV-14 기본 제공 모델은 읽기 전용, [복제]로 새 코드 모델을 만들어 상세로 이동", async () => {
    const browser = await integrator();
    const detail = await browser.get("/models/AM107");
    expect(detail.response.status).toBe(200);
    expect(detail.body).toContain("기본 제공 모델은 수정하거나 삭제할 수 없습니다");
    expect(detail.body).not.toContain(">사용 중지<");
    expect(detail.body).toContain("<fieldset disabled");
    const badClone = await browser.post("/models/AM107", { intent: "clone", newCode: "am107 copy", name: "x" });
    expect(badClone.response.status).toBe(400);
    const clone = await browser.post("/models/AM107", { intent: "clone", newCode: "AM107-LAB", name: "AM107 실습실" });
    expect(clone.response.headers.get("Location")).toBe("/models/AM107-LAB");
    const copy = await browser.get("/models/AM107-LAB?tab=metrics");
    expect(copy.body).toContain('name="metrics"');
    expect(copy.body).toContain(">co2<");
    expect((await browser.get("/models/NOPE")).response.status).toBe(404);
  });

  it("정보 수정(baseVersion, 409 안내), 측정 항목·기능 저장, 사용 중지, 쓰는 기기가 있으면 삭제 거부(MODEL_IN_USE)", async () => {
    const browser = await integrator();
    await browser.post("/models?new=1", { code: "ESP32-TH", vendor: "자체", name: "ESP32", protocol: "MQTT", kind: "SENSOR", metrics: "temperature" });
    await browser.get("/models/ESP32-TH");
    const saved = await browser.post("/models/ESP32-TH", { intent: "info", baseVersion: "1", vendor: "자체 제작", name: "ESP32-TH v2", protocol: "MQTT", kind: "SENSOR", defaultIntervalSec: "30", capabilities: "Switch", description: "" });
    expect(saved.body).toContain("저장했습니다.");
    const stale = await browser.post("/models/ESP32-TH", { intent: "info", baseVersion: "1", vendor: "a", name: "b", protocol: "MQTT", kind: "SENSOR" });
    expect(stale.response.status).toBe(409);
    expect(stale.body).toContain("다른 사용자가 먼저 수정했습니다");
    const noMetric = await browser.post("/models/ESP32-TH", { intent: "metrics", baseVersion: "2" });
    expect(noMetric.response.status).toBe(400);
    const metrics = await browser.post("/models/ESP32-TH", { intent: "metrics", baseVersion: "2", metrics: ["temperature", "co2"], requiredMetrics: "temperature" });
    expect(metrics.body).toContain("저장했습니다.");
    expect(writes().at(-1)?.body).toEqual({ metrics: [{ key: "temperature", required: true }, { key: "co2", required: false }], baseVersion: 2 });
    await browser.post("/models/ESP32-TH", { intent: "capabilities", baseVersion: "3", capabilities: "Switch, FanSpeed" });
    expect(writes().at(-1)?.body).toEqual({ capabilities: [{ capability: "Switch", constraints: null }, { capability: "FanSpeed", constraints: null }], baseVersion: 3 });
    const caps = await browser.get("/models/ESP32-TH?tab=capabilities");
    expect(caps.body).toContain("FanSpeed");
    app.gateway.m2.devices[0].modelId = app.gateway.m2.models.find((m) => m.code === "ESP32-TH")!.id;
    const blocked = await browser.post("/models/ESP32-TH", { intent: "delete" });
    expect(blocked.response.status).toBe(409);
    expect(blocked.body).toContain("쓰는 기기가 있는 모델은 [사용 중지]만 할 수 있습니다.");
    await browser.post("/models/ESP32-TH", { intent: "deprecate" });
    expect((await browser.get("/models")).body).toContain("DEPRECATED");
    const devices = await browser.get("/models/ESP32-TH?tab=devices");
    expect(devices.body).toContain('href="/devices?modelId=');
    app.gateway.m2.devices[0].modelId = "12";
    const removed = await browser.post("/models/ESP32-TH", { intent: "delete" });
    expect(removed.response.headers.get("Location")).toBe("/models");
    expect((await browser.post("/models/AM107", { intent: "weird" })).response.status).toBe(400);
  });

  it("DEV-07.05 패키지: 속성 스키마 형식 검사 후 저장(API-DEV-42), 스크립트 목록을 못 불러와도 화면은 열린다", async () => {
    const browser = await integrator();
    await browser.post("/models?new=1", { code: "ESP32-TH", vendor: "자체", name: "ESP32", protocol: "MQTT", kind: "SENSOR", metrics: "temperature" });
    const pkg = await browser.get("/models/ESP32-TH?tab=package");
    expect(pkg.response.status).toBe(200);
    expect(pkg.body).toContain("속성 스키마(JSON Schema)");
    const bad = await browser.post("/models/ESP32-TH?tab=package", { intent: "package", baseVersion: "1", attributeSchema: '{"properties":{"a":{"type":"date"}}}' });
    expect(bad.response.status).toBe(400);
    expect(bad.body).toContain("스키마 형식이 올바르지 않습니다");
    const schema = '{"type":"object","properties":{"setpoint":{"type":"number","unit":"℃","default":24}},"required":["setpoint"]}';
    const ok = await browser.post("/models/ESP32-TH?tab=package", { intent: "package", baseVersion: "1", attributeSchema: schema, decodeScriptId: "", transformScriptId: "", driverKey: "" });
    expect(ok.body).toContain("저장했습니다.");
    expect(writes().at(-1)?.body).toMatchObject({ attributeSchema: JSON.parse(schema), decodeScriptId: null });
    const again = await browser.get("/models/ESP32-TH?tab=package");
    expect(again.body).toContain("setpoint");
  });
});

describe("DEV-04.01·04.02 UI-DEV-09 측정 항목", () => {
  it("TC-DEV-126 검증됨 표·탭 배지, INTEGRATOR만 편집, 키 형식·최소>최대 문구, 저장", async () => {
    const browser = await integrator();
    const page = await browser.get("/metrics");
    expect(page.body).toContain("temperature");
    expect(page.body).toContain("-20 ~ 60");
    expect(page.body).toContain("tab=verified&amp;edit=101");
    const bad = await browser.post("/metrics?tab=verified&new=1", { intent: "create", key: "Lux", displayName: "조도", valueType: "NUMBER", aggDefault: "AVG", validMin: "10", validMax: "1" });
    expect(bad.response.status).toBe(400);
    expect(bad.body).toContain("측정 항목 키는 영문 소문자로 시작하는 64자 이하여야 합니다");
    expect(bad.body).toContain("최소값이 최대값보다 큽니다");
    const enumMissing = await browser.post("/metrics?tab=verified&new=1", { intent: "create", key: "door", displayName: "문", valueType: "ENUM", aggDefault: "LAST" });
    expect(enumMissing.body).toContain("값 매핑을 입력하세요");
    const created = await browser.post("/metrics?tab=verified&new=1", { intent: "create", key: "door", displayName: "문", valueType: "ENUM", aggDefault: "LAST", enumMap: "open=1, close=0" });
    expect(created.response.headers.get("Location")).toBe("/metrics?tab=verified&saved=1");
    expect(writes().at(-1)?.body).toMatchObject({ key: "door", enumMap: { open: 1, close: 0 } });
    const dup = await browser.post("/metrics?tab=verified&new=1", { intent: "create", key: "door", displayName: "문", valueType: "NUMBER", aggDefault: "AVG" });
    expect(dup.body).toContain("같은 키의 측정 항목이나 별칭이 이미 있습니다.");
    const edit = await browser.get("/metrics?tab=verified&edit=101");
    expect(edit.body).toContain("temperature 편집");
    const updated = await browser.post("/metrics?tab=verified&edit=101", { intent: "update", id: "101", baseVersion: "1", displayName: "온도", unit: "℃", valueType: "NUMBER", aggDefault: "AVG", validMin: "-10", validMax: "50", precision: "1" });
    expect(updated.response.headers.get("Location")).toBe("/metrics?tab=verified&saved=1");
    expect(writes().at(-1)?.body).toMatchObject({ validMin: -10, validMax: 50, baseVersion: 1 });
    expect((await browser.get("/metrics?tab=verified&saved=1")).body).toContain("처리했습니다.");
  });

  it("VIEWER는 편집 버튼이 없고 쓰기는 서버가 403", async () => {
    const browser = await viewer();
    const page = await browser.get("/metrics?tab=unverified");
    expect(page.response.status).toBe(200);
    expect(page.body).toContain("illuminance");
    expect(page.body).not.toContain("별칭으로 연결</button>");
    const denied = await browser.post("/metrics", { intent: "ignore", id: "104" });
    expect(denied.response.status).toBe(403);
  });

  it("TC-DEV-133 미검증 → 비슷한 표준 키 추천, [별칭으로 연결]은 과거 데이터 변환 작업을 시작하고 진행률을 보인다", async () => {
    const browser = await integrator();
    app.gateway.m2.metrics.push({ id: "105", key: "illumination", displayName: "조도", unit: "lux", valueType: "NUMBER", validMin: 0, validMax: 100000, precision: 0, aggDefault: "AVG", status: "VERIFIED", builtin: false, aliases: [], version: 1 });
    const page = await browser.get("/metrics?tab=unverified");
    expect(page.body).toContain("illumination(유사 67%)");
    expect(page.body).toContain("미검증<span");
    const noTarget = await browser.post("/metrics?tab=unverified", { intent: "alias", id: "104", targetKey: "" });
    expect(noTarget.response.status).toBe(400);
    const linked = await browser.post("/metrics?tab=unverified", { intent: "alias", id: "104", targetKey: "illumination", remapHistory: "on" });
    expect(linked.response.status).toBe(200);
    expect(writes().at(-1)?.body).toEqual({ targetKey: "illumination", remapHistory: true });
    expect(linked.body).toContain("과거 데이터 변환");
    const aliases = await browser.get("/metrics?tab=aliases");
    expect(aliases.body).toContain("illuminance");
    const jobId = [...(app.gateway.m2.extra.models as { jobs: Map<string, unknown> }).jobs.keys()][0];
    const job = await browser.request(`/bff/api/core/metric-remap-jobs/${jobId}`);
    expect(JSON.parse(job.body).response.status).toBe("RUNNING");
  });

  it("표준 등록·무시·복원·별칭 추가와 삭제", async () => {
    const browser = await integrator();
    const verifyForm = await browser.get("/metrics?tab=unverified&verify=104");
    expect(verifyForm.body).toContain("illuminance 표준 등록");
    const verified = await browser.post("/metrics?tab=unverified&verify=104", { intent: "verify", id: "104", displayName: "조도", unit: "lux", valueType: "NUMBER", aggDefault: "AVG" });
    expect(verified.response.headers.get("Location")).toBe("/metrics?tab=unverified&saved=1");
    expect(app.gateway.m2.metrics.find((m) => m.id === "104")?.status).toBe("VERIFIED");
    app.gateway.m2.metrics.push({ id: "106", key: "lux_raw", displayName: "lux_raw", unit: null, valueType: "NUMBER", validMin: null, validMax: null, precision: null, aggDefault: "AVG", status: "UNVERIFIED", builtin: false, aliases: [], version: 1 });
    await browser.get("/metrics?tab=unverified");
    await browser.post("/metrics?tab=unverified", { intent: "ignore", id: "106" });
    const ignored = await browser.get("/metrics?tab=ignored");
    expect(ignored.body).toContain("lux_raw");
    await browser.post("/metrics?tab=ignored", { intent: "restore", id: "106" });
    expect(app.gateway.m2.metrics.find((m) => m.id === "106")?.status).toBe("UNVERIFIED");
    await browser.get("/metrics?tab=aliases");
    const badAlias = await browser.post("/metrics?tab=aliases", { intent: "alias-add", alias: "Temp C", metricKey: "temperature" });
    expect(badAlias.response.status).toBe(400);
    const added = await browser.post("/metrics?tab=aliases", { intent: "alias-add", alias: "tmp", metricKey: "temperature" });
    expect(added.body).toContain("처리했습니다.");
    const page = await browser.get("/metrics?tab=aliases");
    expect(page.body).toContain("tmp");
    await browser.post("/metrics?tab=aliases", { intent: "alias-delete", id: "201" });
    expect((await browser.get("/metrics?tab=aliases")).body).not.toContain(">temp<");
    expect((await browser.post("/metrics", { intent: "nope" })).response.status).toBe(400);
  });
});

describe("DEV-06.01 UI-DEV-11 기기 그룹", () => {
  it("TC-DEV-087 목록(유형·기기 수·사용처), 이름 필수·중복, 동적 조건 1개 이상·1,000대 초과 문구", async () => {
    const browser = await integrator();
    const list = await browser.get("/device-groups");
    expect(list.body).toContain("3층 CO2 센서");
    expect(list.body).toContain("규칙 1 · 플로우 0 · 대시보드 1");
    const form = await browser.get("/device-groups?new=1");
    expect(form.body).toContain("기기 검색(이름·외부 ID)");
    const empty = await browser.post("/device-groups?new=1", { name: "", type: "STATIC" });
    expect(empty.response.status).toBe(400);
    expect(empty.body).toContain("이름을 입력하세요");
    const noCriteria = await browser.post("/device-groups?new=1", { name: "동적", type: "DYNAMIC", criteria: "{}" });
    expect(noCriteria.body).toContain("조건을 1개 이상 지정하세요");
    const tooMany = await browser.post("/device-groups?new=1", { name: "동적", type: "DYNAMIC", criteria: '{"statuses":["ACTIVE"]}', previewCount: "1500" });
    expect(tooMany.body).toContain("그룹에는 1,000대까지 넣을 수 있습니다");
    const dup = await browser.post("/device-groups?new=1", { name: "3층 CO2 센서", type: "STATIC" });
    expect(dup.response.status).toBe(409);
    expect(dup.body).toContain("같은 이름의 그룹이 이미 있습니다.");
    expect((await browser.get("/device-groups?type=DYNAMIC")).body).toContain("조건에 맞는 그룹이 없습니다");
  });

  it("TC-DEV-167 동적 그룹 생성 → 상세에서 일치 기기, 미리 보기 API는 BFF로 중계", async () => {
    const browser = await integrator();
    const preview = await browser.request("/bff/api/core/device-groups/preview", { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-TOKEN": browser.csrf }, body: JSON.stringify({ criteria: { modelIds: ["12"] } }) });
    expect(JSON.parse(preview.body).response).toMatchObject({ count: 1, sample: [{ id: "1042", name: "AM107-067999" }] });
    await browser.get("/device-groups?new=1");
    const created = await browser.post("/device-groups?new=1", { name: "AM107 묶음", type: "DYNAMIC", description: "", criteria: '{"modelIds":["12"],"spaceIds":["3"],"includeDescendants":true}', previewCount: "1" });
    const location = created.response.headers.get("Location") ?? "";
    expect(location).toMatch(/^\/device-groups\/\d+$/);
    expect(writes().at(-1)?.body).toMatchObject({ type: "DYNAMIC", criteria: { modelIds: ["12"], spaceIds: ["3"] } });
    const detail = await browser.get(location);
    expect(detail.body).toContain("AM107-067999");
    expect(detail.body).toContain("소속 기기 1대");
    expect(detail.body).not.toContain("기기 추가</h2>");
    const patch = await browser.post(location, { intent: "update", name: "AM107 묶음2", type: "DYNAMIC", description: "실습실", criteria: '{"statuses":["ACTIVE"]}' });
    expect(patch.body).toContain("저장했습니다.");
    expect(writes().at(-1)?.body).toEqual({ name: "AM107 묶음2", description: "실습실", criteria: { statuses: ["ACTIVE"] } });
  });

  it("TC-DEV-166 정적 그룹: 기기 추가·제거(API-DEV-35), 사용처가 있으면 삭제 거부(GROUP_IN_USE), 없으면 삭제", async () => {
    const browser = await integrator();
    await browser.get("/device-groups?new=1");
    const created = await browser.post("/device-groups?new=1", { name: "실습실 센서", type: "STATIC", deviceIds: ["1042"] });
    const location = created.response.headers.get("Location")!;
    const page = await browser.get(location);
    expect(page.body).toContain("기기 추가");
    const none = await browser.post(location, { intent: "add" });
    expect(none.body).toContain("기기를 선택하세요");
    await browser.post(location, { intent: "add", deviceIds: ["1050"] });
    expect(writes().at(-1)).toMatchObject({ path: expect.stringContaining("/members/add"), body: { deviceIds: ["1050"] } });
    expect((await browser.get(location)).body).toContain("EM300-TH-151606");
    await browser.post(location, { intent: "remove", deviceIds: ["1042"] });
    expect((await browser.get(location)).body).not.toContain("AM107-067999");
    groupExtra(app.gateway.m2).usage["61"] = { rules: 1, flows: 0, dashboards: 1 };
    await browser.get("/device-groups/61");
    const blocked = await browser.post("/device-groups/61", { intent: "delete" });
    expect(blocked.response.status).toBe(409);
    expect(blocked.body).toContain("이 그룹을 쓰는 곳이 있어 삭제할 수 없습니다.");
    expect(blocked.body).toContain("규칙 1 · 플로우 0 · 대시보드 1");
    const removed = await browser.post(location, { intent: "delete" });
    expect(removed.response.headers.get("Location")).toBe("/device-groups");
    expect((await browser.get("/device-groups/999")).response.status).toBe(404);
    expect((await browser.post("/device-groups/61", { intent: "x" })).response.status).toBe(400);
  });

  it("OPERATOR는 그룹을 볼 수 있지만 만들기·편집이 없고, 쓰기는 403", async () => {
    const browser = await operator();
    const list = await browser.get("/device-groups?new=1");
    expect(list.response.status).toBe(200);
    expect(list.body).not.toContain('href="?new=1"');
    expect(list.body).not.toContain("기기 검색");
    const detail = await browser.get("/device-groups/61");
    expect(detail.body).not.toContain('value="remove"');
    expect((await browser.post("/device-groups/61", { intent: "delete" })).response.status).toBe(403);
  });
});
