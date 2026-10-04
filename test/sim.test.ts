/**
 * 가상 환경 화면 SSR + BFF 통합(UI-SIM-01·02·03·05·06·07·08·09·11·12, SIM-01.01·01.02·04.01·04.02·05.03·06.03·09.01·09.02).
 * 실제 라우트·loader·action을 돌리고 core는 가짜 gateway(test/msw/handlers/sim.ts, design/api/SIM-api.md).
 * M3 시연 경로: 키트 배치 → [플로우로 만들기] 링크 → "폭염 오후" x60 실행 → 실행 패널(SSE 중계).
 */
import { HttpResponse, http } from "msw";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TestBrowser, startApp, type AppContext } from "./app-harness";
import { GATEWAY } from "./msw/fake-gateway";
import { simState } from "./msw/handlers/sim";

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
const admin = () => as("admin01", "Admin-Pass-123");
const integrator = () => as("lee.int", "Integrator-Pass1");
const operator = () => as("kim.op", "Correct-Horse-9");
const analyst = () => as("ana.lyst", "Analyst-Pass-123");
const viewer = () => as("view.er", "Viewer-Pass-123");
const last = (method: string, path: string) => app.gateway.received.filter((r) => r.method === method && r.path.startsWith(path)).at(-1);

function json(browser: TestBrowser, path: string, method: string, body?: unknown) {
  return browser.request(path, { method, headers: { "Content-Type": "application/json", "X-CSRF-TOKEN": browser.csrf }, body: body === undefined ? undefined : JSON.stringify(body) });
}

describe("UI-SIM-01 가상 환경 홈(SIM-04.05, SIM-11.01)", () => {
  it("VIEWER는 메뉴가 없고 403, ANALYST는 보기·실행(준비 버튼 없음)", async () => {
    const view = await viewer();
    expect((await view.get("/")).body).not.toContain('href="/sim"');
    expect((await view.get("/sim")).response.status).toBe(403);
    const ana = await analyst();
    const page = await ana.get("/sim");
    expect(page.response.status).toBe(200);
    expect(page.body).toContain('href="/sim"');
    expect(page.body).toContain("가상 기기 2/500");
    expect(page.body).toContain("실행 0/5");
    expect(page.body).toContain("폭염 오후");
    expect(page.body).toContain("데모 강의실");
    expect(page.body).not.toMatch(/>준비</);
    expect(page.body).toContain(">실행<");
  });

  it("INTEGRATOR [준비] → API-SIM-18, 이미 준비된 것은 재사용 안내", async () => {
    const lee = await integrator();
    await lee.get("/sim");
    const prepared = await lee.post("/sim", { intent: "prepare", presetKey: "classroom-crowded", idempotencyKey: "k-1" });
    expect(prepared.response.status).toBe(200);
    expect(prepared.body).toContain("데모를 준비했습니다.");
    expect(last("POST", "/api/v1/core/sim/presets/classroom-crowded/prepare")).toBeTruthy();
    const again = await lee.post("/sim", { intent: "prepare", presetKey: "classroom-crowded" });
    expect(again.body).toContain("이미 준비된 데모를 다시 씁니다.");
    expect((await lee.post("/sim", { intent: "prepare", presetKey: "../x" })).response.status).toBe(400);
    expect((await lee.post("/sim", { intent: "other", presetKey: "a" })).response.status).toBe(400);
  });

  it("M3 시연: '폭염 오후'를 x60으로 실행 → 프리셋 scenarioId(API-SIM-18)로 API-SIM-14(Idempotency-Key) → 실행 패널", async () => {
    const kim = await operator();
    const home0 = await kim.get("/sim");
    // overview presets의 scenarioId를 폼에 실어 보낸다(시나리오 목록을 뒤지지 않는다)
    expect(home0.body).toContain('name="scenarioId" value="601"');
    const run = await kim.post("/sim", { intent: "run", presetKey: "heatwave-afternoon", scenarioId: "601", acceleration: "60", idempotencyKey: "k-run" });
    expect(run.response.status).toBe(302);
    const location = run.response.headers.get("Location") as string;
    expect(location).toMatch(/^\/sim\/runs\/\d+$/);
    const sent = last("POST", "/api/v1/core/sim/runs");
    expect(sent?.body).toEqual({ scenarioId: "601", acceleration: 60, timestampPolicy: "SIMULATED", notificationPolicy: "PREFIX" });
    expect(sent?.headers["idempotency-key"]).toBe("k-run");
    const panel = await kim.get(location);
    expect(panel.response.status).toBe(200);
    expect(panel.body).toContain("폭염 오후");
    expect(panel.body).toContain("x60");
    expect(panel.body).toContain("시뮬레이션 시각");
    expect(panel.body).toContain("실제 시각");
    expect(panel.body).toContain(">일시정지<");
    expect(app.gateway.received.some((r) => r.method === "GET" && /\/sim\/scenarios(\?|$)/.test(r.path))).toBe(false);
    // 폼에 scenarioId가 없으면 프리셋 목록(GET /core/sim/presets)에서 찾는다
    const fallback = await kim.post("/sim", { intent: "run", presetKey: "heatwave-afternoon", acceleration: "30", idempotencyKey: "k-run-2" });
    expect(fallback.response.status).toBe(302);
    expect(last("GET", "/api/v1/core/sim/presets")).toBeTruthy();
    expect(last("POST", "/api/v1/core/sim/runs")?.body).toMatchObject({ scenarioId: "601", acceleration: 30 });
    // 준비 안 된 프리셋·잘못된 가속
    expect((await kim.post("/sim", { intent: "run", presetKey: "night-unmanned", acceleration: "60" })).body).toContain("데모를 먼저 준비하세요");
    expect((await kim.post("/sim", { intent: "run", presetKey: "heatwave-afternoon", acceleration: "61" })).response.status).toBe(400);
    const home = await kim.get("/sim");
    expect(home.body).toContain("실행 2/5");
  });
});

describe("UI-SIM-02 카탈로그(SIM-09.01, SIM-09.07)", () => {
  it("카드와 배치(API-SIM-05, Idempotency-Key), 한도 409 문구, 입력 검사", async () => {
    const lee = await integrator();
    const page = await lee.get("/sim/catalog");
    expect(page.body).toContain("온습도 센서");
    expect(page.body).toContain("모델: EM300-TH");
    expect((await lee.get("/sim/catalog?tab=actuator")).body).toContain("냉방 3.5kW");
    const placed = await lee.post("/sim/catalog", { intent: "place", typeId: "11", spaceId: "41", count: "2", namePrefix: "TH", reportMode: "RUN_ONLY", idempotencyKey: "p-1" });
    expect(placed.body).toContain("가상 기기 2대를 만들었습니다: TH-1, TH-2");
    const sent = last("POST", "/api/v1/core/sim/devices");
    expect(sent?.body).toEqual({ typeId: "11", spaceId: "41", count: 2, namePrefix: "TH", reportMode: "RUN_ONLY" });
    expect(sent?.headers["idempotency-key"]).toBe("p-1");
    expect((await lee.post("/sim/catalog", { intent: "place", typeId: "11", spaceId: "", count: "0", namePrefix: "" })).response.status).toBe(400);
    simState(app.gateway.m2).devicesLimit = 4;
    const quota = await lee.post("/sim/catalog", { intent: "place", typeId: "21", spaceId: "41", count: "1", profileId: "301", idempotencyKey: "p-2" });
    expect(quota.response.status).toBe(409);
    expect(quota.body).toContain("가상 기기 한도(500대)를 넘습니다. 남은 수: 0");
    expect((await lee.post("/sim/catalog", { intent: "nope" })).response.status).toBe(400);
    const op = await operator();
    expect((await op.get("/sim/catalog")).body).not.toMatch(/>배치</);
  });

  it("키트 배치(새 가상 공간) → 만든 기기와 [플로우로 만들기] 링크(템플릿 + 공간), 입력 검사", async () => {
    const lee = await integrator();
    await lee.get("/sim/catalog?tab=kit");
    const result = await lee.post("/sim/catalog?tab=kit", { intent: "kit", kitKey: "classroom-standard", mode: "new", newSpaceName: "가상 강의실", preset: "CLASSROOM", idempotencyKey: "kit-1" });
    expect(result.response.status).toBe(200);
    expect(last("POST", "/api/v1/core/sim/kits/classroom-standard/place")?.body).toEqual({ newSpace: { name: "가상 강의실", preset: "CLASSROOM" } });
    expect(result.body).toContain("키트 기기 3대를 배치했습니다");
    expect(result.body).toMatch(/href="\/automation\/templates\?template=hot-then-cool&amp;spaceId=\d+"/);
    const existing = await lee.post("/sim/catalog?tab=kit", { intent: "kit", kitKey: "classroom-standard", mode: "existing", spaceId: "41" });
    expect(existing.body).toContain("데모 강의실에 키트 기기 3대를 배치했습니다");
    expect((await lee.post("/sim/catalog", { intent: "kit", kitKey: "classroom-standard", mode: "existing", spaceId: "" })).response.status).toBe(400);
    expect((await lee.post("/sim/catalog", { intent: "kit", kitKey: "classroom-standard", mode: "new", newSpaceName: "" })).response.status).toBe(400);
    expect((await lee.post("/sim/catalog", { intent: "kit", kitKey: "none", mode: "existing", spaceId: "41" })).response.status).toBe(404);
  });
});

describe("UI-SIM-05 조직 프로필 · UI-SIM-04 특성 상속(SIM-09.02)", () => {
  it("목록·편집(출처 배지), 새 프로필·복제·사용 중 삭제 거부, 저장은 BFF로 PUT(baseVersion)", async () => {
    const lee = await integrator();
    const page = await lee.get("/sim/profiles");
    expect(page.body).toContain("강의실 표준 에어컨");
    const edit = await lee.get("/sim/profiles?id=301");
    expect(edit.body).toContain("냉방 능력");
    expect(edit.body).toContain("직접 설정");
    expect(edit.body).toContain("카탈로그");
    expect((await lee.post("/sim/profiles", { intent: "create", name: "x", typeId: "21" })).response.status).toBe(400);
    const created = await lee.post("/sim/profiles", { intent: "create", name: "고성능 에어컨", typeId: "21" });
    expect(created.response.headers.get("Location")).toMatch(/^\/sim\/profiles\?id=\d+$/);
    const cloned = await lee.post("/sim/profiles", { intent: "clone", sourceId: "301", typeId: "21", name: "강의실 표준 에어컨 (복사본)" });
    expect(cloned.response.status).toBe(302);
    expect(last("POST", "/api/v1/core/sim/profiles")?.body).toEqual({ name: "강의실 표준 에어컨 (복사본)", typeId: "21", overrides: { coolingCapacityKw: 5 } });
    const inUse = await lee.post("/sim/profiles", { intent: "delete", id: "301" });
    expect(inUse.response.status).toBe(409);
    expect(inUse.body).toContain("사용 중인 프로필입니다");
    const id = (created.response.headers.get("Location") as string).split("=")[1];
    expect((await lee.post("/sim/profiles", { intent: "delete", id })).response.status).toBe(302);
    const put = await json(lee, "/bff/api/core/sim/profiles/301", "PUT", { name: "강의실 표준 에어컨", typeId: "21", overrides: { coolingCapacityKw: 30 }, baseVersion: 1 });
    expect(put.response.status).toBe(400);
    expect(JSON.parse(put.body).header.resultCode).toBe("SIM_PROPERTY_OUT_OF_RANGE");
    expect((await lee.get("/sim/profiles?id=999")).body).toContain("대상을 찾을 수 없습니다");
    expect((await lee.post("/sim/profiles", { intent: "x" })).response.status).toBe(400);
    const op = await operator();
    const opDelete = await op.post("/sim/profiles", { intent: "delete", id: "301" });
    expect(opDelete.response.status).toBe(403);
  });
});

describe("UI-SIM-06 가상 공간과 물리 설정(SIM-01.01·01.02, SIM-07.03)", () => {
  it("목록·상세(프리셋 값, 기기), 새 공간 POST, 수정 PUT(baseVersion), 범위 밖은 400 문구", async () => {
    const lee = await integrator();
    const list = await lee.get("/sim/spaces");
    expect(list.body).toContain('href="/sim/spaces/41"');
    // 목록은 API-SIM-10 GET(ItemsResponse)
    expect(last("GET", "/api/v1/core/sim/spaces")?.path).toBe("/api/v1/core/sim/spaces");
    const detail = await lee.get("/sim/spaces/41");
    expect(detail.body).toContain('value="66"');
    expect(detail.body).toContain("TH-1");
    expect(detail.body).not.toContain("샌드박스로 지정");
    const bad = await lee.post("/sim/spaces/41", { intent: "save", name: "데모 강의실", preset: "CLASSROOM", baseVersion: "2", "physics.areaM2": "0", "physics.heightM": "3" });
    expect(bad.response.status).toBe(400);
    expect(bad.body).toContain("1~5000 사이로 입력하세요.");
    const saved = await lee.post("/sim/spaces/41", { intent: "save", name: "데모 강의실", preset: "CUSTOM", parentId: "3", baseVersion: "2", "physics.areaM2": "70", "physics.outdoorLinked": "false" });
    expect(saved.body).toContain("저장했습니다.");
    expect(last("PUT", "/api/v1/core/sim/spaces/41")?.body).toMatchObject({ name: "데모 강의실", preset: "CUSTOM", parentId: "3", baseVersion: 2, physics: { areaM2: 70, heightM: 3, outdoorLinked: false } });
    const conflict = await lee.post("/sim/spaces/41", { intent: "save", name: "데모 강의실", preset: "CLASSROOM", baseVersion: "2" });
    expect(conflict.response.status).toBe(409);
    const fresh = await lee.get("/sim/spaces/new");
    expect(fresh.body).toContain("새 가상 공간");
    const created = await lee.post("/sim/spaces/new", { intent: "save", name: "데모 사무실", preset: "OFFICE" });
    expect(created.response.headers.get("Location")).toMatch(/^\/sim\/spaces\/\d+$/);
    expect(last("POST", "/api/v1/core/sim/spaces")?.body).toMatchObject({ name: "데모 사무실", preset: "OFFICE", physics: { areaM2: 120 } });
    expect((await lee.post("/sim/spaces/new", { intent: "save", name: "", preset: "BAD" })).response.status).toBe(400);
    expect((await lee.get("/sim/spaces/999")).response.status).toBe(404);
  });

  it("샌드박스 지정은 ADMIN(SIM_ADMIN)만, 실행 중이면 삭제 거부, 미리 보기는 BFF로", async () => {
    const boss = await admin();
    await boss.get("/sim/spaces/41");
    const on = await boss.post("/sim/spaces/41", { intent: "sandbox", sandbox: "true" });
    expect(on.body).toContain("저장했습니다.");
    expect((await boss.get("/sim/spaces/41")).body).toContain("샌드박스 해제");
    const lee = await integrator();
    await lee.get("/sim/spaces/41");
    expect((await lee.post("/sim/spaces/41", { intent: "sandbox", sandbox: "false" })).response.status).toBe(403);
    const preview = await json(lee, "/bff/api/core/sim/preview", "POST", { spaceId: "41", hours: 24, condition: { occupancy: 30 } });
    expect(JSON.parse(preview.body).response.series.co2).toHaveLength(24);
    simState(app.gateway.m2).runs.push({ runId: "9", kind: "SCENARIO", status: "RUNNING", scenarioId: "601", accelerationRequested: 1, accelerationEffective: 1, throttled: false, simClock: "x", startedAt: "x", elapsedSec: 0, progressPct: 0, seed: 1, expectations: [], lastEvents: [] });
    const busy = await lee.post("/sim/spaces/41", { intent: "delete" });
    expect(busy.response.status).toBe(409);
    expect(busy.body).toContain("이 공간에서 이미 시나리오가 실행 중입니다");
    simState(app.gateway.m2).runs.length = 0;
    expect((await lee.post("/sim/spaces/41", { intent: "delete" })).response.headers.get("Location")).toBe("/sim/spaces");
    expect((await lee.post("/sim/spaces/41", { intent: "x" })).response.status).toBe(400);
  });
});

describe("UI-SIM-07·08 시나리오(SIM-04.01)", () => {
  it("목록(길이·기대 결과·내보내기), 복제 → 편집기, 삭제, 편집기 SSR, 저장은 BFF(baseVersion·위치 오류)", async () => {
    const lee = await integrator();
    const page = await lee.get("/sim/scenarios");
    expect(page.body).toContain("폭염 오후");
    expect(page.body).toContain("4h");
    expect(page.body).toContain('href="/bff/api/core/sim/scenarios/601/export?format=json&amp;includeSpaces=true"');
    const cloned = await lee.post("/sim/scenarios", { intent: "clone", id: "601", name: "폭염 오후 (복사본)" });
    const location = cloned.response.headers.get("Location") as string;
    expect(location).toMatch(/^\/sim\/scenarios\/\d+\/edit$/);
    const editor = await lee.get(location);
    expect(editor.body).toContain("폭염 오후 (복사본)");
    expect(editor.body).toContain("타임라인");
    expect(editor.body).toContain("30명");
    const fresh = await lee.get("/sim/scenarios/new/edit");
    expect(fresh.body).toContain("새 시나리오");
    const bad = await json(lee, "/bff/api/core/sim/scenarios", "POST", { name: "x", spaceIds: ["41"], simStartAt: "2026-08-12T00:00:00Z", durationSec: 3600, events: [{ id: "ev-1", track: "OCCUPANCY", at: "2026-08-13T00:00:00Z" }] });
    expect(JSON.parse(bad.body).errors[0].field).toBe("events[0].at");
    const conflict = await json(lee, "/bff/api/core/sim/scenarios/601", "PUT", { name: "폭염 오후", baseVersion: 1 });
    expect(conflict.response.status).toBe(409);
    const id = location.split("/")[3];
    expect((await lee.post("/sim/scenarios", { intent: "delete", id })).response.headers.get("Location")).toBe("/sim/scenarios");
    expect((await lee.post("/sim/scenarios", { intent: "delete", id: "999" })).response.status).toBe(404);
    expect((await lee.post("/sim/scenarios", { intent: "x" })).response.status).toBe(400);
    const ana = await analyst();
    const view = await ana.get("/sim/scenarios");
    expect(view.body).not.toContain("새 시나리오");
  });
});

describe("UI-SIM-09·10·12 실행 패널·장애 주입·결과(SIM-04.02, SIM-05.03)", () => {
  it("실행 상태 SSR, 제어는 BFF(상태 충돌 409), SSE는 /bff/stream/sim/runs/{id}로 중계, 리포트", async () => {
    const kim = await operator();
    await kim.get("/sim");
    const start = await json(kim, "/bff/api/core/sim/runs", "POST", { scenarioId: "601", acceleration: 60 });
    const runId = JSON.parse(start.body).response.runId as string;
    const page = await kim.get(`/sim/runs/${runId}`);
    expect(page.body).toContain(`R-${runId} 폭염 오후`);
    expect(page.body).toContain("장애 주입");
    const paused = await json(kim, `/bff/api/core/sim/runs/${runId}/pause`, "POST");
    expect(JSON.parse(paused.body).response.status).toBe("PAUSED");
    const conflict = await json(kim, `/bff/api/core/sim/runs/${runId}/pause`, "POST");
    expect(conflict.response.status).toBe(409);
    const accel = await json(kim, `/bff/api/core/sim/runs/${runId}`, "PATCH", { acceleration: 60 });
    expect(JSON.parse(accel.body).response).toMatchObject({ accelerationEffective: 24, throttled: true });
    const fault = await json(kim, "/bff/api/core/sim/faults", "POST", { runId, targetType: "DEVICE", targetIds: ["1042"], kind: "STUCK", params: {}, startInSec: 0, durationSec: 1800 });
    expect(JSON.parse(fault.body).header.resultCode).toBe("SIM_TARGET_NOT_VIRTUAL");
    const injected = await json(kim, "/bff/api/core/sim/faults", "POST", { runId, targetType: "DEVICE", targetIds: ["2001"], kind: "STUCK", params: {}, startInSec: 0, durationSec: 1800 });
    const faultId = JSON.parse(injected.body).response.faultIds[0];
    expect(JSON.parse((await kim.get(`/bff/api/core/sim/faults?runId=${runId}`)).body).responses).toHaveLength(1);
    expect(JSON.parse((await json(kim, `/bff/api/core/sim/faults/${faultId}/cancel`, "POST")).body).response.status).toBe("CANCELLED");
    app.server.use(http.get(`${GATEWAY}/api/v1/core/stream/sim/runs/*`, () => new HttpResponse('event: sim.tick\ndata: {"simClock":"2026-08-12T04:01:00Z","progressPct":1}\n\n', { headers: { "Content-Type": "text/event-stream" } })));
    const stream = await kim.get(`/bff/stream/sim/runs/${runId}`);
    expect(stream.response.headers.get("content-type")).toContain("text/event-stream");
    expect(stream.body).toContain("event: sim.tick");
    const report = await kim.get(`/sim/runs/${runId}/report`);
    expect(report.body).toContain("기대 결과 1/1 통과");
    expect(report.body).toContain("8.1 kWh");
    expect(report.body).toContain("JSON 내려받기");
    expect((await kim.get("/sim/runs/999")).response.status).toBe(404);
    const ana = await analyst();
    expect((await ana.get(`/sim/runs/${runId}`)).body).toContain("장애 주입");
  });
});

describe("UI-SIM-11 실제 데이터 재생 — 파일 가져오기(SIM-06.03)", () => {
  it("M3: core가 재생 경로(API-SIM-22·23)를 열지 않으면(404) '아직 쓸 수 없음' 문구, 10MB 넘는 파일은 BFF에서 거부", async () => {
    const kim = await operator();
    expect((await kim.get("/sim/replay")).body).toContain("최대 10MB");
    const csv = "timestamp,deviceId,temperature\n2026-10-02T00:00:00Z,AM107,22";
    const form = new FormData();
    form.set("_csrf", kim.csrf);
    form.set("intent", "upload");
    form.set("file", new File([csv], "a.csv", { type: "text/csv" }));
    const res = await kim.request("/sim/replay", { method: "POST", body: form });
    expect(res.response.status).toBe(503);
    expect(res.body).toContain("실제 데이터 재생은 아직 쓸 수 없습니다");
    expect(last("POST", "/api/v1/core/sim/replay-files")).toBeTruthy();
    const big = new FormData();
    big.set("_csrf", kim.csrf);
    big.set("intent", "upload");
    big.set("file", new File([new Uint8Array(10 * 1024 * 1024 + 1)], "big.csv", { type: "text/csv" }));
    const tooBig = await kim.request("/sim/replay", { method: "POST", body: big });
    expect([400, 413]).toContain(tooBig.response.status);
  });

  it("CSV 업로드는 multipart로 중계 → 매핑·미리 보기, 열 누락은 행 번호, 대상 건수·재생 시작(M4 계약)", async () => {
    const kim = await operator();
    simState(app.gateway.m2).replayEnabled = true;
    const page = await kim.get("/sim/replay");
    expect(page.body).toContain("파일 가져오기");
    const csv = ["timestamp,deviceId,temperature,humidity", ...Array.from({ length: 30 }, (_, i) => `2026-10-02T00:${String(i).padStart(2, "0")}:00Z,AM107,22.${i},44`)].join("\n");
    const upload = async (content: string) => {
      const form = new FormData();
      form.set("_csrf", kim.csrf);
      form.set("intent", "upload");
      form.set("file", new File([content], "classroom.csv", { type: "text/csv" }));
      return kim.request("/sim/replay", { method: "POST", body: form });
    };
    const ok = await upload(csv);
    expect(ok.response.status).toBe(200);
    expect(ok.body).toContain("열 매핑 (30행)");
    expect(ok.body).toContain("미리 보기 20행");
    const bad = await upload("timestamp,deviceId,temperature\n2026-10-02T00:00:00Z,AM107");
    expect(bad.response.status).toBe(400);
    expect(bad.body).toContain("파일 형식이 올바르지 않습니다");
    expect(bad.body).toContain("2행: 열 누락");
    const fileId = [...simState(app.gateway.m2).files.keys()][0];
    const body = { source: { type: "FILE", fileId, columnMapping: { time: "timestamp", deviceId: "deviceId", metrics: { temperature: "temperature", humidity: "humidity" } }, timeFormat: "ISO8601" }, timeShift: { basis: "NOW" }, acceleration: 60, cloneSpaceId: "41" };
    expect(JSON.parse((await json(kim, "/bff/api/core/sim/replays?dryRun=true", "POST", body)).body).response.total).toBe(60);
    expect(JSON.parse((await json(kim, "/bff/api/core/sim/replays", "POST", body)).body).response.runId).toBeTruthy();
    const empty = new FormData();
    empty.set("_csrf", kim.csrf);
    empty.set("intent", "upload");
    expect((await kim.request("/sim/replay", { method: "POST", body: empty })).response.status).toBe(400);
    expect((await kim.post("/sim/replay", { intent: "x" })).response.status).toBe(400);
  });
});

describe("UI-SIM-03 기기 상세 [가상] 탭(SIM-09.02)", () => {
  it("가상 기기에만 탭, 특성 출처와 출력 설정, 실제 기기에는 탭 없음", async () => {
    const lee = await integrator();
    await lee.get("/sim");
    const page = await lee.get("/devices/2002?tab=virtual");
    expect(page.response.status).toBe(200);
    expect(page.body).toContain('href="/devices/2002?tab=virtual"');
    expect(page.body).toContain("냉방 능력");
    expect(page.body).toContain("직접 설정");
    expect(page.body).toContain("power=OFF mode=cool targetTemperature=26");
    expect(page.body).toContain("실패 확률(%, 0~100)");
    const patch = await json(lee, "/bff/api/core/sim/devices/2002", "PATCH", { overrides: { powerKw: null } });
    expect(JSON.parse(patch.body).response.properties.find((p: { key: string }) => p.key === "powerKw").origin).toBe("CATALOG");
    const real = await lee.get("/devices/1042");
    expect(real.body).not.toContain("?tab=virtual");
  });
});

describe("[SIM-09.06] UI-SIM-14 사용자 정의 가상 기기 유형", () => {
  const draft = { name: "VOC 센서", category: "SENSOR", icon: "", description: "", linkedModelCode: "", metrics: [{ key: "tvoc", source: "GENERATOR" }], capabilities: [], defs: [{ key: "errorPct", name: "측정 오차", type: "number", unit: "%", min: "0", max: "50", enumValues: "", default: "10", description: "" }], effects: [] };

  it("TC-SIM-102 AT-SIM-14.1 만들기 → 카탈로그에 추가(API-SIM-03 POST), 편집(PUT baseVersion), 사용 중 삭제 거부, 검사 실패 400, OPERATOR는 편집 불가", async () => {
    const lee = await integrator();
    const page = await lee.get("/sim/catalog?tab=sensor&type=new");
    expect(page.response.status).toBe(200);
    expect(page.body).toContain("새 사용자 정의 유형");
    expect(page.body).toContain(">co2<");
    const invalid = await lee.post("/sim/catalog?tab=sensor&type=new", { intent: "saveType", draft: JSON.stringify({ ...draft, name: "V" }) });
    expect(invalid.response.status).toBe(400);
    expect(invalid.body).toContain("2~80자로 입력하세요.");
    expect((await lee.post("/sim/catalog?type=new", { intent: "saveType", draft: "{" })).response.status).toBe(400);
    const saved = await lee.post("/sim/catalog?tab=sensor&type=new", { intent: "saveType", draft: JSON.stringify(draft) });
    expect(saved.response.status).toBe(302);
    expect(saved.response.headers.get("Location")).toBe("/sim/catalog?tab=sensor&saved=type");
    expect(last("POST", "/api/v1/core/sim/types")?.body).toMatchObject({ name: "VOC 센서", category: "SENSOR", metrics: [{ key: "tvoc", defaultSource: { kind: "GENERATOR" } }], propertyDefs: [{ key: "errorPct", min: 0, max: 50, default: 10 }] });
    const catalog = await lee.get("/sim/catalog?tab=sensor&saved=type");
    expect(catalog.body).toContain("사용자 정의 유형을 저장했습니다");
    expect(catalog.body).toContain("VOC 센서");
    const typeId = /type=(\d+)"/.exec(catalog.body)?.[1] as string;
    const edit = await lee.get(`/sim/catalog?tab=sensor&type=${typeId}`);
    expect(edit.body).toContain("사용자 정의 유형: VOC 센서");
    const updated = await lee.post(`/sim/catalog?tab=sensor&type=${typeId}`, { intent: "saveType", typeId, baseVersion: "1", draft: JSON.stringify({ ...draft, description: "실내 VOC" }) });
    expect(updated.response.status).toBe(302);
    expect(last("PUT", `/api/v1/core/sim/types/${typeId}`)?.body).toMatchObject({ description: "실내 VOC", baseVersion: 1 });
    const conflict = await lee.post(`/sim/catalog?tab=sensor&type=${typeId}`, { intent: "saveType", typeId, baseVersion: "1", draft: JSON.stringify(draft) });
    expect(conflict.response.status).toBe(409);
    const deleted = await lee.post(`/sim/catalog?type=${typeId}`, { intent: "deleteType", typeId });
    expect(deleted.response.headers.get("Location")).toBe("/sim/catalog?saved=typeDeleted");
    const inUse = await lee.post("/sim/catalog?type=11", { intent: "deleteType", typeId: "11" });
    expect(inUse.response.status).toBe(404);
    const kim = await operator();
    const opPage = await kim.get("/sim/catalog?tab=sensor");
    expect(opPage.body).not.toContain("사용자 정의 유형 만들기");
  });
});
