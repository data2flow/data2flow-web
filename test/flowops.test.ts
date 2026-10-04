/**
 * 자동화 부가 화면 SSR + BFF 통합: Sink 연결(UI-FLW-08, FLW-04.01), 스냅샷(UI-FLW-18, FLW-11.02), 승격 파이프라인·대상 매핑(UI-FLW-19·13, FLW-11.03, FLW-09.01~03),
 * 확장 노드 패키지(UI-FLW-21, FLW-11.05), Git 동기화(UI-FLW-20, FLW-11.04). 가짜 gateway는 test/msw/handlers/flowops.ts.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TestBrowser, startApp, type AppContext } from "./app-harness";
import { flowopsState } from "./msw/handlers/flowops";

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
const state = () => flowopsState(app.gateway.m2);
const sent = (method: string, prefix: string) => app.gateway.received.filter((r) => r.method === method && r.path.startsWith(prefix));

describe("UI-FLW-08 Sink 저장소 연결(FLW-04.01, BR-FLW-27·28)", () => {
  it("권한: OPERATOR·ANALYST는 403, INTEGRATOR는 목록(종류·상태·최근 오류·사용 플로우)과 비밀값 없는 응답", async () => {
    expect((await (await operator()).get("/automation/sink-connections")).response.status).toBe(403);
    expect((await (await analyst()).get("/automation/sink-connections")).response.status).toBe(403);
    const browser = await integrator();
    const page = await browser.get("/automation/sink-connections");
    expect(page.response.status).toBe(200);
    expect(page.body).toContain("연구실 MySQL");
    expect(page.body).toContain("시계열 InfluxDB");
    expect(page.body).toContain("401 unauthorized");
    expect(page.body).not.toMatch(/"password"\s*:/);
  });

  it("TC-FLW-081 등록 폼 검증(호스트·포트 필수, 비밀번호 필수) → 저장 전 연결 테스트 → 저장, 비밀번호는 다시 보이지 않음", async () => {
    const browser = await integrator();
    const form = await browser.get("/automation/sink-connections?edit=new&type=POSTGRESQL");
    expect(form.body).toContain("새 Sink 연결");
    const invalid = await browser.post("/automation/sink-connections", { intent: "save", type: "POSTGRESQL", name: "보고서 DB", host: "", port: "70000", database: "rep", username: "u", password: "" });
    expect(invalid.response.status).toBe(400);
    expect(invalid.body).toContain("필수 입력입니다");
    expect(invalid.body).toContain("1~65535 사이로 입력하세요");
    expect(sent("POST", "/api/v1/core/sink-connections")).toHaveLength(0);

    const tested = await browser.post("/automation/sink-connections", { intent: "test", type: "POSTGRESQL", name: "보고서 DB", host: "pg.lab.local", port: "5432", database: "rep", username: "u", password: "Secret-1", tls: "on" });
    expect(tested.response.status).toBe(200);
    expect(tested.body).toContain("연결됨 (18ms)");
    expect(tested.body).not.toContain("Secret-1");
    expect(sent("POST", "/api/v1/core/sink-connections/test").at(-1)!.body).toMatchObject({ type: "POSTGRESQL", config: { host: "pg.lab.local", port: 5432, database: "rep", tls: true }, secret: { username: "u", password: "Secret-1" } });

    const saved = await browser.post("/automation/sink-connections", { intent: "save", type: "POSTGRESQL", name: "보고서 DB", host: "pg.lab.local", port: "5432", database: "rep", username: "u", password: "Secret-1", tls: "on" });
    expect(saved.response.status).toBe(200);
    expect(saved.body).toContain("연결을 저장했습니다");
    expect(state().sinks.find((s) => s.name === "보고서 DB")?.secret).toEqual({ username: "u", password: "Secret-1" });
  });

  it("TC-FLW-083 연결 테스트 실패 원인: 200 ok:false(AUTH)와 502 SINK_CONNECTION_TEST_FAILED(원인 TIMEOUT)", async () => {
    const browser = await integrator();
    await browser.get("/automation/sink-connections");
    const auth = await browser.post("/automation/sink-connections", { intent: "test", type: "MYSQL", host: "auth.lab.local", port: "3306", database: "x", username: "u", password: "p" });
    expect(auth.body).toContain("연결할 수 없습니다: 인증 실패");
    const timeout = await browser.post("/automation/sink-connections", { intent: "test", type: "MYSQL", host: "timeout.lab.local", port: "3306", database: "x", username: "u", password: "p" });
    expect(timeout.response.status).toBe(502);
    expect(timeout.body).toContain("연결할 수 없습니다:");
    state().sinks[0].config = { host: "dns.lab.local", port: 3306, database: "lab", tls: true };
    const saved = await browser.post("/automation/sink-connections", { intent: "testSaved", sinkConnectionId: "sc-1" });
    expect(saved.body).toContain("주소를 찾을 수 없음(DNS)");
  });

  it("수정: 비밀값을 비우면 서버 값 유지(PATCH에 secret 없음), baseVersion 전달, 대상 스키마 확인(있음·없음)", async () => {
    const browser = await integrator();
    const edit = await browser.get("/automation/sink-connections?edit=sc-1");
    expect(edit.body).toContain("연결 편집: 연구실 MySQL");
    expect(edit.body).toContain("mysql.lab.local");
    const saved = await browser.post("/automation/sink-connections", { intent: "save", sinkConnectionId: "sc-1", baseVersion: "3", type: "MYSQL", name: "연구실 MySQL 2", host: "mysql.lab.local", port: "3306", database: "lab", username: "", password: "" });
    expect(saved.body).toContain("연결을 저장했습니다");
    const patch = sent("PATCH", "/api/v1/core/sink-connections/sc-1").at(-1)!.body as Record<string, unknown>;
    expect(patch.baseVersion).toBe(3);
    expect(patch).not.toHaveProperty("secret");
    expect(state().sinks[0].secret).toEqual({ username: "lab", password: "p" });

    const exists = await browser.get("/automation/sink-connections?edit=sc-1&target=room_temp");
    expect(exists.body).toContain("room_temp: 열 3개");
    const missing = await browser.get("/automation/sink-connections?edit=sc-1&target=other_table");
    expect(missing.body).toContain("SINK_SCHEMA_MISSING");
    const bad = await browser.get("/automation/sink-connections?edit=sc-1&target=drop%20table");
    expect(bad.body).not.toContain("열 3개");
    expect(sent("GET", "/api/v1/core/sink-connections/sc-1/schema?target=drop")).toHaveLength(0);
  });

  it("TC-FLW-082 쓰는 플로우가 있는 연결 삭제 → 409 SINK_CONNECTION_IN_USE, 안 쓰는 연결은 삭제", async () => {
    const browser = await integrator();
    await browser.get("/automation/sink-connections");
    const inUse = await browser.post("/automation/sink-connections", { intent: "delete", sinkConnectionId: "sc-1" });
    expect(inUse.response.status).toBe(409);
    expect(inUse.body).toContain("사용 중인 연결입니다");
    const removed = await browser.post("/automation/sink-connections", { intent: "delete", sinkConnectionId: "sc-2" });
    expect(removed.body).toContain("연결을 삭제했습니다");
    expect(state().sinks.map((s) => s.sinkConnectionId)).toEqual(["sc-1"]);
  });

  it("BR-FLW-28 실패 보관함: 목록, 선택 없이 재전송은 거부, 선택 재전송·모두 재전송", async () => {
    const browser = await integrator();
    const page = await browser.get("/automation/sink-connections?deadLetters=sc-1");
    expect(page.body).toContain("실패 보관함: 연구실 MySQL");
    expect(page.body).toContain("Duplicate entry");
    const none = await browser.post("/automation/sink-connections", { intent: "resend", sinkConnectionId: "sc-1" });
    expect(none.response.status).toBe(400);
    expect(none.body).toContain("하나 이상 고르세요");
    const one = await browser.post("/automation/sink-connections", { intent: "resend", sinkConnectionId: "sc-1", ids: ["dl-1"] });
    expect(one.body).toContain("재전송 요청 1건: 성공 1, 실패 0");
    expect(sent("POST", "/api/v1/core/sink-connections/sc-1/dead-letters/resend").at(-1)!.body).toEqual({ ids: ["dl-1"] });
    await browser.post("/automation/sink-connections", { intent: "resend", sinkConnectionId: "sc-1", all: "true" });
    expect(sent("POST", "/api/v1/core/sink-connections/sc-1/dead-letters/resend").at(-1)!.body).toEqual({ all: true });
    expect(state().deadLetters["sc-1"]).toHaveLength(0);
  });
});

describe("UI-FLW-18 스냅샷(FLW-11.02)", () => {
  it("ANALYST는 보기만(경로 가드 FLOW_READ), OPERATOR는 목록(최신순)과 새 스냅샷 검증", async () => {
    expect((await (await analyst()).get("/automation/snapshots")).response.status).toBe(200);
    const browser = await operator();
    const page = await browser.get("/automation/snapshots");
    expect(page.body.indexOf("냉방 튜닝 후")).toBeLessThan(page.body.indexOf("학기 시작 전"));
    const form = await browser.get("/automation/snapshots?new=1");
    expect(form.body).toContain("고온이면 냉방 v13");
    const empty = await browser.post("/automation/snapshots", { intent: "create", name: "", memo: "" });
    expect(empty.response.status).toBe(400);
    expect(empty.body).toContain("이름을 입력하세요");
    expect(empty.body).toContain("플로우를 1개 이상 고르세요");
  });

  it("TC-FLW-239 같은 이름 → SNAPSHOT_NAME_DUPLICATED 문구, AT-FLW-26.1 생성하면 묶인 스크립트·Sink 연결 수 표시", async () => {
    const browser = await operator();
    await browser.get("/automation/snapshots?new=1");
    const dup = await browser.post("/automation/snapshots", { intent: "create", name: "학기 시작 전", memo: "", flowIds: ["f-7f3a"] });
    expect(dup.response.status).toBe(409);
    expect(dup.body).toContain("같은 이름의 스냅샷이 있습니다");
    const created = await browser.post("/automation/snapshots", { intent: "create", name: "중간고사 전", memo: "점검", flowIds: ["f-7f3a", "f-co2"] });
    expect(created.body).toContain("스냅샷을 만들었습니다: 플로우 2, 스크립트 1, Sink 연결 1");
    expect(sent("POST", "/api/v1/core/flow-snapshots").at(-1)!.body).toEqual({ name: "중간고사 전", memo: "점검", flowIds: ["f-7f3a", "f-co2"] });
    expect(sent("POST", "/api/v1/core/flow-snapshots").at(-1)!.headers["idempotency-key"]).toBeTruthy();
  });

  it("TC-FLW-233 AT-FLW-26.2 S1(v12)·S2(v14) 비교 → 노드 추가 1, 설정 변경 2, 스크립트 v3→v4", async () => {
    const browser = await operator();
    const page = await browser.get("/automation/snapshots?compare=s1&compare=s2");
    expect(page.body).toContain("비교: 학기 시작 전 → 냉방 튜닝 후");
    expect(page.body).toContain("노드 추가 1, 삭제 0, 설정 변경 2, 스크립트 버전 차이 1");
    expect(page.body).toContain("스크립트 s-12: v3 → v4");
    expect(page.body).toContain("n-thr00001 config.value: 27 → 28");
    const one = await browser.get("/automation/snapshots?compare=s1");
    expect(one.body).toContain("비교할 스냅샷을 두 개 고르세요");
  });

  it("TC-FLW-235 AT-FLW-26.3 복원: 먼저 영향 범위(바뀌는 플로우 2개, 초기화 노드 상태) → 확인하면 새 버전으로 라이브 적용", async () => {
    const browser = await integrator();
    await browser.get("/automation/snapshots");
    const preview = await browser.post("/automation/snapshots", { intent: "previewRestore", snapshotId: "s1" });
    expect(preview.body).toContain("복원 확인: 학기 시작 전");
    expect(preview.body).toContain("바뀌는 플로우 2개");
    expect(preview.body).toContain("고온이면 냉방: v14 → v12");
    expect(preview.body).toContain("초기화되는 노드 상태 1개: n-dbg-1");
    expect(sent("POST", "/api/v1/core/flow-snapshots/s1/restore").at(-1)!.body).toEqual({ dryRun: true });
    const restored = await browser.post("/automation/snapshots", { intent: "restore", snapshotId: "s1" });
    expect(restored.body).toContain("복원했습니다: 고온이면 냉방 v15, CO2 환기 자동화 v15");
  });

  it("제어 노드 포함 복원을 배포 권한 없이 → 202 승인 대기, TC-FLW-236 의존 객체 없음 → SNAPSHOT_DEPENDENCY_MISSING", async () => {
    const browser = await operator();
    await browser.get("/automation/snapshots");
    const pending = await browser.post("/automation/snapshots", { intent: "restore", snapshotId: "s1" });
    expect(pending.body).toContain("제어 노드가 있어 승인 대기로 요청했습니다");
    state().missingDependency.add("s2");
    const missing = await browser.post("/automation/snapshots", { intent: "previewRestore", snapshotId: "s2" });
    expect(missing.response.status).toBe(409);
    expect(missing.body).toContain("스냅샷에 필요한 항목이 없어 복원할 수 없습니다");
  });

  it("상세: 플로우 버전·스크립트·변수·Sink 연결(비밀값 없음)", async () => {
    const browser = await operator();
    const page = await browser.get("/automation/snapshots?id=s1");
    expect(page.body).toContain("고온이면 냉방 v12");
    expect(page.body).toContain("s-12 v3");
    expect(page.body).toContain("lastAlert");
  });
});

describe("UI-FLW-19 승격 파이프라인(FLW-11.03)과 UI-FLW-13 대상 매핑(FLW-09.01)", () => {
  it("ANALYST는 403(경로 가드 FLOW_WRITE), OPERATOR도 열림(TC-FLW-200 승격 요청), INTEGRATOR는 단계 그림·요청 가능(정의 편집 없음), ADMIN은 정의 편집", async () => {
    expect((await (await analyst()).get("/automation/pipelines")).response.status).toBe(403);
    expect((await (await operator()).get("/automation/pipelines")).response.status).toBe(200);
    const browser = await integrator();
    const page = await browser.get("/automation/pipelines");
    expect(page.body).toContain("승격 파이프라인: 기본");
    expect(page.body).toContain("재생 제어 ≤ 50");
    expect(page.body).toContain("승격 요청");
    expect(page.body).not.toContain("정의 편집");
    expect(page.body).toContain('href="/settings/git-sync"');
    const denied = await browser.post("/automation/pipelines", { intent: "savePipeline", pipelineId: "default", baseVersion: "2", name: "기본", "stage.0.key": "test", "stage.1.key": "prod" });
    expect(denied.response.status).toBe(403);
    const adminPage = await (await admin()).get("/automation/pipelines?edit=1");
    expect(adminPage.body).toContain("파이프라인 정의: 기본");
  });

  it("정의 검증(단계 2~5개, 키 형식·중복) → 저장(PUT baseVersion)", async () => {
    const browser = await admin();
    await browser.get("/automation/pipelines?edit=1");
    const one = await browser.post("/automation/pipelines", { intent: "savePipeline", pipelineId: "default", baseVersion: "2", name: "기본", "stage.0.key": "test", "stage.0.env": "TEST" });
    expect(one.response.status).toBe(400);
    expect(one.body).toContain("단계는 2~5개여야 합니다");
    const dup = await browser.post("/automation/pipelines", { intent: "savePipeline", pipelineId: "default", baseVersion: "2", name: "기본", "stage.0.key": "test", "stage.1.key": "test" });
    expect(dup.body).toContain("같은 키가 이미 있습니다");
    const saved = await browser.post("/automation/pipelines", {
      intent: "savePipeline",
      pipelineId: "default",
      baseVersion: "2",
      name: "기본",
      "stage.0.key": "test",
      "stage.0.env": "TEST",
      "stage.1.key": "prod",
      "stage.1.env": "PROD",
      "stage.1.roles": ["ADMIN"],
      "stage.1.testRunRequired": "on",
      "stage.1.replayDays": "1",
      "stage.1.maxCommands": "50",
      "stage.1.maxNotifications": "10",
    });
    expect(saved.body).toContain("파이프라인을 저장했습니다");
    expect(sent("PUT", "/api/v1/core/flow-pipelines/default").at(-1)!.body).toMatchObject({ baseVersion: 2, stages: [{ key: "test", env: "TEST" }, { key: "prod", env: "PROD", approvers: { roles: ["ADMIN"], userIds: [] }, checks: { testRunRequired: true, replayDays: 1, maxCommands: 50, maxNotifications: 10 } }] });
  });

  it("TC-FLW-243 AT-FLW-27.2 재생 제어 120 > 상한 50 → CHECK_FAILED, 승인 불가·사유 표시; TC-FLW-249 본인 요청은 승인 불가", async () => {
    state().replayCommands = 120;
    const lee = await integrator();
    const form = await lee.get("/automation/pipelines?pipeline=default&request=1&snapshot=s2");
    expect(form.body).toContain("매핑할 참조가 없습니다");
    await lee.post("/automation/pipelines", { intent: "requestPromotion", pipelineId: "default", snapshotId: "s2", fromStage: "verify", toStage: "prod" });
    // 매핑 두 개(가짜 core는 2개 미만이면 FLOW_PROMOTION_BLOCKED)
    const blocked = await lee.post("/automation/pipelines", { intent: "requestPromotion", pipelineId: "default", snapshotId: "s2", fromStage: "verify", toStage: "prod", refs: ["SPACE:v-31"], "map.SPACE:v-31": "31" });
    expect(blocked.response.status).toBe(409);
    expect(blocked.body).toContain("승격 조건을 만족하지 않습니다");
    const failed = await lee.post("/automation/pipelines", { intent: "requestPromotion", pipelineId: "default", snapshotId: "s2", fromStage: "verify", toStage: "prod", refs: ["SPACE:v-31", "DEVICE:v-ac-1"], "map.SPACE:v-31": "31", "map.DEVICE:v-ac-1": "1042" });
    expect(failed.body).toContain("자동 검사를 통과하지 못해 승인할 수 없습니다(CHECK_FAILED)");
    expect(sent("POST", "/api/v1/core/flow-promotions").at(-1)!.body).toEqual({ pipelineId: "default", snapshotId: "s2", fromStage: "verify", toStage: "prod", targetMappings: [{ from: "v-31", to: "31" }, { from: "v-ac-1", to: "1042" }] });
    const id = state().promotions[0].promotionId;
    const adminBrowser = await admin();
    const detail = await adminBrowser.get(`/automation/pipelines?promotion=${id}`);
    expect(detail.body).toContain("검사 실패");
    expect(detail.body).toContain("120 / 50");
    expect(detail.body).toContain("자동 검사를 통과하지 못한 요청은 승인할 수 없습니다");
    const conflict = await adminBrowser.post("/automation/pipelines", { intent: "approve", promotionId: id });
    expect(conflict.response.status).toBe(409);

    state().replayCommands = 10;
    const mine = await adminBrowser.post("/automation/pipelines", { intent: "requestPromotion", pipelineId: "default", snapshotId: "s1", fromStage: "verify", toStage: "prod", refs: ["SPACE:v-31", "DEVICE:v-ac-1"], "map.SPACE:v-31": "31", "map.DEVICE:v-ac-1": "1042" });
    expect(mine.body).toContain("승격을 요청했습니다");
    const own = state().promotions[1].promotionId;
    const ownDetail = await adminBrowser.get(`/automation/pipelines?promotion=${own}`);
    expect(ownDetail.body).toContain("본인이 요청한 승격은 승인할 수 없습니다");
    const self = await adminBrowser.post("/automation/pipelines", { intent: "approve", promotionId: own });
    expect(self.response.status).toBe(403);
  });

  it("AT-FLW-27.4 다른 사람이 요청한 PENDING 요청은 ADMIN이 승인(APPLIED), 반려는 사유 필수", async () => {
    const lee = await integrator();
    await lee.get("/automation/pipelines");
    await lee.post("/automation/pipelines", { intent: "requestPromotion", pipelineId: "default", snapshotId: "s1", fromStage: "verify", toStage: "prod", refs: ["SPACE:v-31", "DEVICE:v-ac-1"], "map.SPACE:v-31": "31", "map.DEVICE:v-ac-1": "1042" });
    await lee.post("/automation/pipelines", { intent: "requestPromotion", pipelineId: "default", snapshotId: "s2", fromStage: "verify", toStage: "prod", refs: ["SPACE:v-31", "DEVICE:v-ac-1"], "map.SPACE:v-31": "31", "map.DEVICE:v-ac-1": "1042" });
    const [first, second] = state().promotions;
    const adminBrowser = await admin();
    const list = await adminBrowser.get("/automation/pipelines");
    expect(list.body).toContain("승인 대기");
    const approved = await adminBrowser.post("/automation/pipelines", { intent: "approve", promotionId: first.promotionId });
    expect(approved.body).toContain("승격을 승인했습니다");
    expect(first.status).toBe("APPLIED");
    const noReason = await adminBrowser.post("/automation/pipelines", { intent: "reject", promotionId: second.promotionId, reason: " " });
    expect(noReason.response.status).toBe(400);
    const rejected = await adminBrowser.post("/automation/pipelines", { intent: "reject", promotionId: second.promotionId, reason: "검증 부족" });
    expect(rejected.body).toContain("승격을 반려했습니다");
    expect(sent("POST", `/api/v1/core/flow-promotions/${second.promotionId}/reject`).at(-1)!.body).toEqual({ reason: "검증 부족" });
  });

  it("TC-FLW-200 AT-FLW-21.2 시험 플로우 운영 승격: 가상 기기 1대 매핑 누락 → 차단·누락 대상 표시, 매핑하면 승인 요청(제어 노드)", async () => {
    const browser = await integrator();
    const page = await browser.get("/automation/pipelines?promote=f-test");
    expect(page.body).toContain("운영으로 승격: 고온이면 냉방(시험) (시험 v5)");
    // 이름이 같은 공간(실습실)은 자동 제안, 관계는 공간 매핑을 따름, 가상 에어컨은 매핑 안 됨
    expect(page.body).toContain("공간 매핑을 따름");
    expect(page.body).toContain("매핑되지 않은 대상 1개");
    expect(page.body).toContain("제어 노드 포함 → ADMIN 승인 필요");
    expect(page.body).toMatch(/<button[^>]*disabled[^>]*>승격 요청<\/button>/);
    const blocked = await browser.post("/automation/pipelines", { intent: "promoteFlow", flowId: "f-test", version: "5", refs: ["SPACE:v-31", "RELATION:controls/Thermostat", "DEVICE:v-ac-1"], "map.SPACE:v-31": "31", "map.DEVICE:v-ac-1": "" });
    expect(blocked.response.status).toBe(400);
    expect(blocked.body).toContain("매핑되지 않은 대상 1개");
    expect(sent("POST", "/api/v1/core/flows/f-test/promote")).toHaveLength(0);
    const done = await browser.post("/automation/pipelines", { intent: "promoteFlow", flowId: "f-test", version: "5", refs: ["SPACE:v-31", "RELATION:controls/Thermostat", "DEVICE:v-ac-1"], "map.SPACE:v-31": "31", "map.DEVICE:v-ac-1": "1042" });
    expect(done.body).toContain("승인 대기로 요청했습니다");
    expect(sent("POST", "/api/v1/core/flows/f-test/promote").at(-1)!.body).toEqual({ version: 5, mappings: [{ kind: "SPACE", sourceId: "v-31", targetId: "31" }, { kind: "DEVICE", sourceId: "v-ac-1", targetId: "1042" }] });
  });

  it("TC-FLW-204 승격 조건 시나리오 실패 → FLOW_PROMOTION_BLOCKED(SCENARIO_FAILED), 제어 노드 없는 플로우는 바로 운영 플로우", async () => {
    state().failingScenarios.add("sc-heat");
    state().testFlows[0].hasControlNode = false;
    const browser = await integrator();
    await browser.get("/automation/pipelines?promote=f-test");
    const body = { intent: "promoteFlow", flowId: "f-test", version: "5", refs: ["SPACE:v-31", "DEVICE:v-ac-1"], "map.SPACE:v-31": "31", "map.DEVICE:v-ac-1": "1042" };
    const failed = await browser.post("/automation/pipelines", { ...body, scenarioId: "sc-heat" });
    expect(failed.response.status).toBe(409);
    expect(failed.body).toContain("승격 조건을 만족하지 않습니다");
    expect(failed.body).toContain("SCENARIO_FAILED");
    const ok = await browser.post("/automation/pipelines", body);
    expect(ok.body).toContain("운영 플로우로 승격했습니다");
    expect(ok.body).toContain("운영 플로우 열기");
  });
});

describe("UI-FLW-21 확장 노드 패키지(FLW-11.05)", () => {
  it("INTEGRATOR는 목록만(설치 없음), ADMIN은 설치 폼; TC-FLW-260 서명된 패키지 설치 → 서명·라이선스·실행 방식·노드 표시", async () => {
    const lee = await integrator();
    const readOnly = await lee.get("/automation/packages");
    expect(readOnly.body).toContain("acme.modbus-write");
    expect(readOnly.body).toContain("Apache-2.0");
    expect(readOnly.body).toContain("ACME (서명 확인)");
    expect(readOnly.body).toContain("설치·업그레이드·비활성화는 관리자(ADMIN)만 할 수 있습니다.");
    expect(readOnly.body).not.toContain("패키지 설치");
    const browser = await admin();
    const page = await browser.get("/automation/packages");
    expect(page.body).toContain("패키지 설치");
    const form = new FormData();
    form.set("_csrf", browser.csrf);
    form.set("intent", "install");
    form.set("file", new File(["pkg"], "acme.bacnet-read-1.0.0.d2fpkg"));
    const installed = await browser.request("/automation/packages", { method: "POST", body: form });
    expect(installed.body).toContain("acme.bacnet-read@1.0.0 설치됨 — 서명 ACME, Apache-2.0, JS 샌드박스");
    expect(installed.body).toContain("노드: acme.bacnet-read/write");
  });

  it("TC-FLW-262·264·271 검사 실패 사유(서명·라이선스·형식), 입력 검증(.d2fpkg·https)", async () => {
    const browser = await admin();
    await browser.get("/automation/packages");
    const unsigned = await browser.post("/automation/packages", { intent: "install", registryUrl: "https://registry.example/unsigned.pkg" });
    expect(unsigned.response.status).toBe(400);
    expect(unsigned.body).toContain("서명을 확인할 수 없는 패키지입니다");
    const agpl = await browser.post("/automation/packages", { intent: "install", registryUrl: "https://registry.example/agpl.pkg" });
    expect(agpl.body).toContain("라이선스 정책에 맞지 않는 패키지입니다");
    const broken = await browser.post("/automation/packages", { intent: "install", registryUrl: "https://registry.example/broken.pkg" });
    expect(broken.body).toContain("패키지 형식이 올바르지 않습니다");
    const http = await browser.post("/automation/packages", { intent: "install", registryUrl: "http://registry.example/a.pkg" });
    expect(http.body).toContain("https:// 주소를 입력하세요");
    const empty = await browser.post("/automation/packages", { intent: "install", registryUrl: "" });
    expect(empty.body).toContain("파일이나 등록소 URL 중 하나를 넣으세요");
    expect(sent("POST", "/api/v1/core/node-packages")).toHaveLength(3);
  });

  it("TC-FLW-266 AT-FLW-29.4 v2 설치는 나란히(플로우는 v1 유지 안내), AT-FLW-29.5 비활성화·활성화", async () => {
    const browser = await admin();
    await browser.get("/automation/packages");
    const upgraded = await browser.post("/automation/packages", { intent: "upgrade", name: "acme.modbus-write", registryUrl: "https://registry.example/acme.modbus-write-2.0.0" });
    expect(upgraded.body).toContain("acme.modbus-write@2.0.0 설치됨");
    expect(upgraded.body).toContain("기존 버전을 쓰는 플로우는 그대로 실행됩니다");
    const list = await browser.get("/automation/packages");
    expect(list.body).toContain("설치된 버전: 2.0.0, 1.0.0");
    const disabled = await browser.post("/automation/packages", { intent: "disable", name: "acme.modbus-write" });
    expect(disabled.body).toContain("사용 중인 플로우 2개는 실행 중인 버전으로 계속 동작합니다");
    const enabled = await browser.post("/automation/packages", { intent: "enable", name: "acme.modbus-write" });
    expect(enabled.body).toContain("acme.modbus-write을(를) 활성화했습니다");
    const badName = await browser.post("/automation/packages", { intent: "disable", name: "../x" });
    expect(badName.response.status).toBe(400);
  });
});

describe("UI-FLW-20 Git 동기화(FLW-11.04)", () => {
  it("OPERATOR는 403, INTEGRATOR: 설정 없음(404)이면 빈 폼, 형식 검증, 연결 실패 원인, 저장", async () => {
    expect((await (await operator()).get("/settings/git-sync")).response.status).toBe(403);
    const browser = await integrator();
    const page = await browser.get("/settings/git-sync");
    expect(page.response.status).toBe(200);
    expect(page.body).toContain("Git 동기화");
    expect(page.body).not.toContain("내보내기 커밋");
    const invalid = await browser.post("/settings/git-sync", { intent: "save", repoUrl: "git@github.com:org/a.git", branch: "", authType: "SSH_KEY", credentialRef: "deploy-key" });
    expect(invalid.response.status).toBe(400);
    expect(invalid.body).toContain("저장소 주소 형식이 올바르지 않습니다");
    expect(invalid.body).toContain("브랜치를 입력하세요");
    const unreachable = await browser.post("/settings/git-sync", { intent: "test", repoUrl: "ssh://git@unreachable.example/a.git", branch: "main", authType: "SSH_KEY", credentialRef: "deploy-key" });
    expect(unreachable.response.status).toBe(502);
    expect(unreachable.body).toContain("저장소에 연결할 수 없습니다");
    const okTest = await browser.post("/settings/git-sync", { intent: "test", repoUrl: "ssh://git@github.com/data2flow/automation.git", branch: "main", authType: "SSH_KEY", credentialRef: "deploy-key" });
    expect(okTest.body).toContain("HEAD a1b2c3d4");
    const saved = await browser.post("/settings/git-sync", { intent: "save", repoUrl: "ssh://git@github.com/data2flow/automation.git", branch: "main", path: "/", authType: "SSH_KEY", credentialRef: "deploy-key", targets: ["FLOW", "SCRIPT"], baseVersion: "0" });
    expect(saved.body).toContain("Git 동기화 설정을 저장했습니다");
    expect(state().git?.targets).toEqual(["FLOW", "SCRIPT"]);
  });

  it("TC-FLW-250 내보내기 커밋(메시지 필수), TC-FLW-255 AT-FLW-28.4 충돌 1건 → 선택 전 적용은 막힘, 선택하면 DRAFT 반영", async () => {
    const st = state();
    st.git = { repoUrl: "ssh://git@github.com/data2flow/automation.git", branch: "main", path: "/", auth: { type: "SSH_KEY", credentialRef: "deploy-key" }, targets: ["FLOW"], version: 1, updatedBy: { userId: "8", name: "이통합" }, updatedAt: "2026-10-03T00:00:00Z" };
    st.gitConflicts = ["flows/co2.yaml"];
    const browser = await integrator();
    await browser.get("/settings/git-sync");
    const noMessage = await browser.post("/settings/git-sync", { intent: "export", message: "" });
    expect(noMessage.body).toContain("커밋 메시지를 입력하세요");
    const exported = await browser.post("/settings/git-sync", { intent: "export", message: "학기 설정 내보내기" });
    expect(exported.body).toContain("커밋 0f1e2d3c: 파일 4개");
    const preview = await browser.post("/settings/git-sync", { intent: "preview" });
    expect(preview.body).toContain("변경 1건, 충돌 1건, 오류 1건");
    expect(preview.body).toContain("n-thr-1 value 27→28");
    expect(preview.body).toContain("flows/broken.yaml:12 검증 실패(반영 안 함)");
    const unresolved = await browser.post("/settings/git-sync", { intent: "apply", conflicts: ["flows/co2.yaml"] });
    expect(unresolved.response.status).toBe(409);
    expect(unresolved.body).toContain("충돌 1건을 먼저 해결하세요");
    expect(st.gitApplied).toBe(0);
    expect(sent("POST", "/api/v1/core/git-sync/import").every((r) => (r.body as { dryRun: boolean }).dryRun)).toBe(true);
    const applied = await browser.post("/settings/git-sync", { intent: "apply", conflicts: ["flows/co2.yaml"], "resolve.flows/co2.yaml": "GIT" });
    expect(applied.body).toContain("초안 1건을 만들었습니다");
    expect(sent("POST", "/api/v1/core/git-sync/import").at(-1)!.body).toEqual({ dryRun: false, resolutions: [{ objectKey: "flows/co2.yaml", choose: "GIT" }] });
  });
});
