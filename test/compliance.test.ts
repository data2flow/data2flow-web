/**
 * M7 환경 기준 화면 SSR + BFF 통합: UI-CMP-01 목록, UI-CMP-02 상세(기준값·버전·적용 범위), UI-CMP-03 편집, UI-CMP-04 적용·해제.
 * 가짜 gateway: test/msw/handlers/compliance.ts.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TestBrowser, startApp, type AppContext } from "./app-harness";
import { cmpState } from "./msw/handlers/compliance";

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
  await browser.get("/");
  return browser;
}
const integrator = () => as("lee.int", "Integrator-Pass1");
const operator = () => as("kim.op", "Correct-Horse-9");
const viewer = () => as("view.er", "Viewer-Pass-123");

const payload = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    name: "새 기준",
    sourceTitle: "내부 기준",
    sourceUrl: "",
    effectiveDate: "2026-10-01",
    description: "",
    streakDays: "",
    streakRatio: "",
    facilityTypeRequired: false,
    changeNote: "",
    coverage: [],
    metrics: [{ metricKey: "co2", facilityType: "", evalWindow: "HOUR_1", lower: "", upper: "900", inclusive: true, unit: "ppm", requirement: "LIMIT", note: "", baseName: "", bands: [] }],
    ...extra,
  });

describe("CMP-01.01 UI-CMP-01 목록·UI-CMP-02 상세 SSR", () => {
  it("TC-CMP-016 VIEWER는 목록·상세를 읽기만, 메뉴는 CMP_READ로 보인다", async () => {
    const v = await viewer();
    const page = await v.get("/compliance/profiles");
    expect(page.response.status).toBe(200);
    expect(page.body).toContain("실내공기질관리법 다중이용시설");
    expect(page.body).toContain("우리 학교 기준");
    expect(page.body).toContain('href="/compliance/profiles"');
    expect(page.body).not.toContain("새 프로필");
    expect(page.body).not.toContain("복제해 수정");
    expect((await v.get("/compliance/profiles/new")).response.status).toBe(403);
    expect((await v.get("/compliance/profiles/101/edit")).response.status).toBe(403);

    const detail = await v.get("/compliance/profiles/1");
    expect(detail.body).toContain("시스템 프로필은 고칠 수 없습니다");
    expect(detail.body).toContain("일반 다중이용시설");
    expect(detail.body).toContain("≤ 1000");
    expect((await v.get("/compliance/profiles/999")).response.status).toBe(404);
  });

  it("검색어·구분 거르기와 지난 버전 보기", async () => {
    const i = await integrator();
    const org = await i.get("/compliance/profiles?kind=ORGANIZATION");
    expect(org.body).toContain("우리 학교 기준");
    expect(org.body).not.toContain("실내공기질관리법 다중이용시설");
    const versions = await i.get("/compliance/profiles/101?tab=versions");
    expect(versions.body).toContain("CO2 기준 강화");
    expect(versions.body).toContain('href="/compliance/profiles/101?version=1"');
    const older = await i.get("/compliance/profiles/101?version=1");
    expect(older.body).toContain("지난 버전 v1을 보고 있습니다(현재 v2).");
    expect(older.body).toContain("≤ 1200");
  });
});

describe("CMP-01.01 UI-CMP-03 만들기·편집·복제", () => {
  it("TC-CMP-001 새 프로필을 만들면 상세로 간다, 같은 이름은 거부", async () => {
    const i = await integrator();
    const form = await i.get("/compliance/profiles/new");
    expect(form.response.status).toBe(200);
    expect(form.body).toContain("새 기준 프로필");
    const created = await i.post("/compliance/profiles/new", { payload: payload(), mode: "create" });
    expect(created.response.status).toBe(302);
    const location = created.response.headers.get("location")!;
    expect(location).toMatch(/^\/compliance\/profiles\/\d+$/);
    expect((await i.get(location)).body).toContain("새 기준");
    const dup = await i.post("/compliance/profiles/new", { payload: payload(), mode: "create" });
    expect(dup.response.status).toBe(409);
    expect(dup.body).toContain("같은 이름의 프로필이 이미 있습니다.");
  });

  it("TC-CMP-007 잘못된 기준값은 BFF가 먼저 거부한다(하한 > 상한)", async () => {
    const i = await integrator();
    const bad = payload({ metrics: [{ metricKey: "co2", facilityType: "", evalWindow: "HOUR_1", lower: "900", upper: "800", inclusive: true, unit: "ppm", requirement: "LIMIT", note: "", baseName: "", bands: [] }] });
    const res = await i.post("/compliance/profiles/new", { payload: bad, mode: "create" });
    expect(res.response.status).toBe(400);
    expect(res.body).toContain("하한이 상한보다 클 수 없습니다");
    expect(cmpState(app.gateway.m2).profiles).toHaveLength(2);
  });

  it("잠기지 않은 현재 버전은 고치고(PUT), 잠긴 뒤에는 변경 메모를 받아 새 버전으로", async () => {
    const i = await integrator();
    const edit = await i.get("/compliance/profiles/101/edit");
    expect(edit.body).toContain("우리 학교 기준 v2 편집");
    const saved = await i.post("/compliance/profiles/101/edit", { payload: payload(), mode: "update", baseVersion: "3", versionNo: "2" });
    expect(saved.response.status).toBe(302);
    expect(cmpState(app.gateway.m2).versions["101"]).toHaveLength(2);
    expect(cmpState(app.gateway.m2).versions["101"][1].sourceTitle).toBe("내부 기준");

    cmpState(app.gateway.m2).versions["101"][1].locked = true;
    const locked = await i.get("/compliance/profiles/101/edit");
    expect(locked.body).toContain("저장하면 새 버전이 됩니다");
    const noNote = await i.post("/compliance/profiles/101/edit", { payload: payload(), mode: "version", baseVersion: "4", versionNo: "2" });
    expect(noNote.response.status).toBe(400);
    const next = await i.post("/compliance/profiles/101/edit", { payload: payload({ changeNote: "기준 900" }), mode: "version", baseVersion: "4", versionNo: "2" });
    expect(next.response.status).toBe(302);
    expect(cmpState(app.gateway.m2).profiles[1].currentVersionNo).toBe(3);
    const stale = await i.post("/compliance/profiles/101/edit", { payload: payload({ changeNote: "다시" }), mode: "version", baseVersion: "4", versionNo: "3" });
    expect(stale.response.status).toBe(409);
    expect(stale.body).toContain("다른 사람이 먼저 고쳤습니다");
  });

  it("시스템 프로필은 편집 대신 상세로, [복제해 수정]은 복제본 편집 화면으로", async () => {
    const i = await integrator();
    const sys = await i.get("/compliance/profiles/1/edit");
    expect(sys.response.status).toBe(302);
    expect(sys.response.headers.get("location")).toBe("/compliance/profiles/1");
    const cloned = await i.post("/compliance/profiles", { intent: "clone", profileId: "1", name: "우리 기관 국내법" });
    expect(cloned.response.status).toBe(302);
    expect(cloned.response.headers.get("location")).toMatch(/^\/compliance\/profiles\/\d+\/edit$/);
    const empty = await i.post("/compliance/profiles/1", { intent: "clone", profileId: "1", name: " " });
    expect(empty.response.status).toBe(400);
  });
});

describe("CMP-01.03·01.04 UI-CMP-04 적용 범위", () => {
  it("적용 목록·측정 가능성, 시설 유형이 필요한 프로필은 유형 없이 적용 못 한다", async () => {
    const i = await integrator();
    const page = await i.get("/compliance/profiles/101?tab=applications");
    expect(page.body).toContain("실습실");
    expect(page.body).toContain("기기 없음: 사무실");

    const noFacility = await i.post("/compliance/profiles/1", { intent: "apply", targetType: "SPACE", targetSpaceId: "31", includeDescendants: "true" });
    expect(noFacility.response.status).toBe(400);
    expect(noFacility.body).toContain("이 프로필은 시설 유형을 골라야 합니다");
    const noSpace = await i.post("/compliance/profiles/1", { intent: "apply", targetType: "SPACE", facilityType: "GENERAL" });
    expect(noSpace.response.status).toBe(400);

    const applied = await i.post("/compliance/profiles/1", { intent: "apply", targetType: "SPACE_USAGE", targetUsage: "CLASSROOM", facilityType: "SENSITIVE", pinVersion: "1" });
    expect(applied.response.status).toBe(200);
    const added = cmpState(app.gateway.m2).applications.at(-1)!;
    expect(added).toMatchObject({ profileId: "1", targetType: "SPACE_USAGE", targetUsage: "CLASSROOM", targetSpaceId: null, facilityType: "SENSITIVE", pinnedVersionNo: 1 });

    expect((await i.post("/compliance/profiles/101", { intent: "unapply", applicationId: "501" })).response.status).toBe(200);
    expect(cmpState(app.gateway.m2).applications.some((a) => a.applicationId === "501")).toBe(false);
  });

  it("보관한 프로필은 새로 적용할 수 없고, OPERATOR는 적용·보관을 못 한다", async () => {
    const i = await integrator();
    expect((await i.post("/compliance/profiles/101", { intent: "archive" })).response.status).toBe(200);
    const page = await i.get("/compliance/profiles/101?tab=applications");
    expect(page.body).toContain("보관된 프로필은 새로 적용할 수 없습니다.");
    const rejected = await i.post("/compliance/profiles/101", { intent: "apply", targetType: "SPACE", targetSpaceId: "32" });
    expect(rejected.response.status).toBe(409);

    const o = await operator();
    const view = await o.get("/compliance/profiles/101?tab=applications");
    expect(view.response.status).toBe(200);
    expect(view.body).not.toContain("적용 추가");
    expect((await o.post("/compliance/profiles/101", { intent: "unarchive" })).response.status).toBe(403);
  });
});

describe("CMP-01.05·02.01 UI-CMP-05 종합 점수·UI-CMP-06 준수 현황판 SSR", () => {
  it("VIEWER는 현황판을 본다: 요약·충족률·이탈 상위·연속 달성·깨짐·품질 경고, CSV 링크, 메뉴", async () => {
    const v = await viewer();
    const page = await v.get("/compliance/status?period=7");
    expect(page.response.status).toBe(200);
    expect(page.body).toContain('href="/compliance/status"');
    expect(page.body).toContain("평균 충족률");
    expect(page.body).toContain("92.4%");
    expect(page.body).toContain("CO2 18h");
    expect(page.body).toContain("47/90일");
    expect(page.body).toMatch(/D-\d+ 깨짐: CO2/);
    expect(page.body).toContain("데이터 품질 기준 미달(결측 10% 초과)");
    expect(page.body).toMatch(/href="\/bff\/api\/core\/compliance\/status\.csv\?from=\d{4}-\d{2}-\d{2}&amp;to=\d{4}-\d{2}-\d{2}"/);
    expect(page.body).not.toContain("data-space-detail");
  });

  it("줄을 펼치면 일별 막대와 이탈 구간을 보여 준다", async () => {
    const page = await (await viewer()).get("/compliance/status?open=31:101");
    expect(page.response.status).toBe(200);
    expect(page.body).toContain("data-space-detail");
    expect(page.body).toContain("2026-10-02 충족률 80%, 이탈 275분, 결측 65분");
    expect(page.body).toContain("최고 1,420");
    expect(page.body).toContain("알람 #77");
    expect(page.body).toContain('href="/compliance/status"');
  });

  it("기간이 400일을 넘으면 안내하고, 프로필을 고르면 그 줄만, 없으면 빈 안내", async () => {
    const v = await viewer();
    const tooLong = await v.get("/compliance/status?period=custom&from=2025-09-01&to=2026-10-06");
    expect(tooLong.body).toContain("400일 이내여야 합니다");
    const none = await v.get("/compliance/status?profileId=1");
    expect(none.body).toContain("표시할 준수 현황이 없습니다");
  });

  it("공간 개요에 종합 점수 카드: 점수·등급, 일부 항목 제외, 감점 1순위, 계산식 입력값", async () => {
    const page = await (await viewer()).get("/spaces/31");
    expect(page.response.status).toBe(200);
    expect(page.body).toContain("data-score-card");
    expect(page.body).toContain("종합 실내 환경 점수");
    expect(page.body).toContain("보통");
    expect(page.body).toContain("일부 항목 제외");
    expect(page.body).toContain("감점 1순위: CO2 1,180");
    const other = await (await viewer()).get("/spaces/32");
    expect(other.response.status).toBe(200);
    expect(other.body).not.toContain("data-score-card");
  });
});

describe("CMP-02.02·02.04·02.06 UI-CMP-07 리포트 목록·생성, UI-CMP-08 미리 보기·발행", () => {
  const form = (extra: Record<string, string | string[]> = {}) => ({ type: "KR_SELF_CHECK", title: "", spaceIds: ["31"], facilityType: "GENERAL", periodFrom: "2026-09-01", periodTo: "2026-09-30", includeActions: "true", ...extra });

  it("TC-CMP-045 VIEWER는 목록·미리 보기만: 판·상태·진행률, 초안 PDF는 서명 링크로 연다, 생성·발행 버튼 없음", async () => {
    const v = await viewer();
    const page = await v.get("/compliance/reports");
    expect(page.response.status).toBe(200);
    expect(page.body).toContain("2026-09 자가 점검(실습실)");
    expect(page.body).toContain("r2");
    expect(page.body).toContain("생성 중");
    expect(page.body).toContain('aria-valuenow="60"');
    expect(page.body).toContain('href="/compliance/reports"');
    expect(page.body).not.toContain("새 리포트");
    expect((await v.get("/compliance/reports/new")).response.status).toBe(403);

    const detail = await v.get("/compliance/reports/801");
    expect(detail.body).toContain('src="/bff/api/core/compliance/reports/801/revisions/2/content/preview?expires=1791000600&amp;signature=abc"');
    expect(detail.body).toContain("모든 쪽에 &quot;초안&quot; 표시");
    expect(detail.body).toContain("결측률이 12.5%로 10%를 넘습니다");
    expect(detail.body).toContain("이전 판 이후 30건 추가");
    expect(detail.body).toContain("해시 검증");
    expect(detail.body).not.toContain('value="publish"');
    const first = await v.get("/compliance/reports/801?rev=1");
    expect(first.body).toContain("9f2a…c41");
    expect(first.body).toContain("김운영");
    const content = await v.get("/bff/api/core/compliance/reports/801/revisions/1/content/pdf?expires=1&signature=x");
    expect(content.response.headers.get("content-type")).toContain("application/pdf");
  });

  it("TC-CMP-046·049 OPERATOR: 마법사 검증, 같은 조건은 판 +1, 초안 발행·재발행 409, 프로필 미적용 공간 안내", async () => {
    const o = await operator();
    const wizard = await o.get("/compliance/reports/new");
    expect(wizard.response.status).toBe(200);
    expect(wizard.body).toContain("미리 보기 생성");
    expect(wizard.body).toContain("인증 보조(RESET)");

    const empty = await o.post("/compliance/reports/new", form({ spaceIds: [] }));
    expect(empty.response.status).toBe(400);
    expect(empty.body).toContain("공간을 하나 이상 고르세요");
    const order = await o.post("/compliance/reports/new", form({ periodFrom: "2026-09-30", periodTo: "2026-09-01" }));
    expect(order.body).toContain("종료일은 시작일 이후여야 합니다");
    const notApplied = await o.post("/compliance/reports/new", form({ spaceIds: ["32"] }));
    expect(notApplied.response.status).toBe(409);
    expect(notApplied.body).toContain("선택한 공간에 프로필이 적용되어 있지 않습니다");

    const created = await o.post("/compliance/reports/new", form());
    expect(created.response.status).toBe(302);
    expect(created.response.headers.get("location")).toBe("/compliance/reports/801?rev=3");
    const generating = await o.get("/compliance/reports/801?rev=3");
    expect(generating.body).toContain("리포트를 만들고 있습니다");
    expect(generating.body).not.toContain('value="regenerate"');

    const draft = await o.get("/compliance/reports/801?rev=2");
    expect(draft.body).toContain('value="publish"');
    const published = await o.post("/compliance/reports/801?rev=2", { intent: "publish", revisionNo: "2" });
    expect(published.response.status).toBe(302);
    expect((await o.get("/compliance/reports/801?rev=2")).body).not.toContain('value="publish"');
    const again = await o.post("/compliance/reports/801?rev=2", { intent: "publish", revisionNo: "2" });
    expect(again.response.status).toBe(409);
    expect(again.body).toContain("지금 상태에서는 할 수 없습니다");

    const regenerated = await o.post("/compliance/reports/801", { intent: "regenerate", revisionNo: "2" });
    expect(regenerated.response.headers.get("location")).toBe("/compliance/reports/801?rev=4");
  });

  it("TC-CMP-054 초안 판 삭제, 발행된 판은 409, 마지막 판을 지우면 목록으로", async () => {
    const o = await operator();
    const published = await o.post("/compliance/reports/801", { intent: "delete", revisionNo: "1" });
    expect(published.response.status).toBe(409);
    const draft = await o.post("/compliance/reports/801", { intent: "delete", revisionNo: "2" });
    expect(draft.response.headers.get("location")).toBe("/compliance/reports/801");
    const created = await o.post("/compliance/reports/new", form({ periodFrom: "2026-08-01", periodTo: "2026-08-31" }));
    const location = created.response.headers.get("location")!;
    expect(location).toMatch(/^\/compliance\/reports\/\d+\?rev=1$/);
    expect((await o.get("/compliance/reports?status=GENERATING")).body).toContain("실내공기질 자가 점검 리포트 2026-08-01 ~ 2026-08-31");
  });
});

describe("CMP-02.05 UI-CMP-10 개선 조치 기록", () => {
  const actionForm = (extra: Record<string, string | string[]> = {}) => ({
    intent: "save",
    actionId: "",
    startedAt: "2026-10-02T01:00:00Z",
    cause: "VENTILATION",
    causeNote: "",
    actionText: "환기 장치 필터 교체",
    actorUserId: "7",
    actedAt: "2026-10-02T11:00",
    linkedAlarmIds: "77",
    linkedWorkOrderIds: "",
    resultMode: "AUTO",
    resultNote: "",
    ...extra,
  });

  it("TC-CMP-064 OPERATOR: 검증(원인·이탈 이전 시각·없는 작업 지시), 작업 지시 만들기로 연결, 저장하면 현황판에 [조치 보기]", async () => {
    const o = await operator();
    const status = await o.get("/compliance/status?open=31:101");
    expect(status.body).toContain('href="/compliance/excursions/9001"');
    expect(status.body).toContain("개선 조치 기록");

    const page = await o.get("/compliance/excursions/9001");
    expect(page.response.status).toBe(200);
    expect(page.body).toContain("대상 이탈");
    expect(page.body).toContain("실습실");
    expect(page.body).toContain("아직 기록된 조치가 없습니다");
    expect(page.body).toContain("24시간 후 결과가 기록됩니다");

    const noCause = await o.post("/compliance/excursions/9001", actionForm({ cause: "" }));
    expect(noCause.response.status).toBe(400);
    expect(noCause.body).toContain("원인을 선택하세요");
    const early = await o.post("/compliance/excursions/9001", actionForm({ actedAt: "2026-10-02T09:30" }));
    expect(early.body).toContain("이탈 이전 시각은 입력할 수 없습니다");
    const manual = await o.post("/compliance/excursions/9001", actionForm({ resultMode: "MANUAL" }));
    expect(manual.body).toContain("결과를 적어 주세요");
    const missing = await o.post("/compliance/excursions/9001", actionForm({ linkedWorkOrderIds: "999999" }));
    expect(missing.response.status).toBe(404);
    expect(missing.body).toContain("없는 작업 지시가 있습니다");

    const withOrder = await o.post("/compliance/excursions/9001", actionForm({ intent: "createWorkOrder" }));
    expect(withOrder.response.status).toBe(200);
    const orderId = /name="linkedWorkOrderIds"[^>]*value="(\d+)"/.exec(withOrder.body)?.[1];
    expect(orderId).toBeTruthy();

    const saved = await o.post("/compliance/excursions/9001", actionForm({ linkedWorkOrderIds: orderId! }));
    expect(saved.response.status).toBe(302);
    expect(saved.response.headers.get("location")).toBe("/compliance/excursions/9001");
    const action = cmpState(app.gateway.m2).actions[0];
    expect(action).toMatchObject({ cause: "VENTILATION", actedAt: "2026-10-02T02:00:00Z", linkedAlarmIds: ["77"], linkedWorkOrderIds: [orderId], resultMode: "AUTO" });
    const after = await o.get("/compliance/excursions/9001");
    expect(after.body).toContain("기록된 조치 1건");
    expect(after.body).toContain("환기 장치 필터 교체");
    expect(after.body).toContain("자동 확인 대기 중");
    expect(after.body).toContain(`href="/work-orders/${orderId}"`);
    expect((await o.get("/compliance/status?open=31:101")).body).toContain("조치 보기");
  });

  it("편집하면 값이 채워지고 수동 결과로 바꿀 수 있다, 삭제, VIEWER는 보기만", async () => {
    const o = await operator();
    await o.post("/compliance/excursions/9001", actionForm());
    const id = cmpState(app.gateway.m2).actions[0].actionId as string;
    const edit = await o.get(`/compliance/excursions/9001?edit=${id}`);
    expect(edit.body).toContain("조치 고치기");
    expect(edit.body).toContain("환기 장치 필터 교체");
    expect(edit.body).toContain('value="2026-10-02T11:00"');
    const updated = await o.post(`/compliance/excursions/9001?edit=${id}`, actionForm({ actionId: id, resultMode: "MANUAL", resultNote: "다음 날 정상" }));
    expect(updated.response.status).toBe(302);
    expect((await o.get("/compliance/excursions/9001")).body).toContain("결과: 다음 날 정상");

    const v = await viewer();
    const view = await v.get("/compliance/excursions/9001");
    expect(view.body).toContain("환기 장치 필터 교체");
    expect(view.body).not.toContain("새 조치");
    expect(view.body).not.toContain('value="delete"');
    const denied = await v.post("/compliance/excursions/9001", { intent: "delete", actionId: id });
    expect(denied.response.status).toBe(403);

    const removed = await o.post("/compliance/excursions/9001", { intent: "delete", actionId: id });
    expect(removed.response.status).toBe(302);
    expect(cmpState(app.gateway.m2).actions).toHaveLength(0);
    expect((await o.get("/compliance/excursions/1234")).response.status).toBe(404);
  });
});

describe("CMP-02.04 UI-CMP-09 정기 발행", () => {
  const scheduleForm = (extra: Record<string, string | string[]> = {}) => ({
    intent: "save",
    name: "분기 자가 점검",
    type: "KR_SELF_CHECK",
    title: "",
    spaceIds: "31",
    facilityType: "",
    cadence: "QUARTERLY",
    dayOfPeriod: "5",
    publishTime: "08:30",
    periodRule: "PREVIOUS_QUARTER",
    userIds: ["7", "9"],
    emails: "Audit@Example.com",
    format: "PDF_CSV",
    enabled: "true",
    ...extra,
  });

  it("목록: 주기·다음 발행·마지막 실패 원인과 [재시도], [이력], 지금 실행", async () => {
    const o = await operator();
    expect((await o.get("/compliance/reports")).body).toContain('href="/compliance/reports/schedules"');
    const page = await o.get("/compliance/reports/schedules");
    expect(page.response.status).toBe(200);
    expect(page.body).toContain("월간 자가 점검");
    expect(page.body).toContain("매월 1일 09:00");
    expect(page.body).toContain("실패");
    expect(page.body).toContain("선택한 공간에 프로필이 적용되어 있지 않습니다.");
    expect(page.body).toContain("재시도");

    const history = await o.get("/compliance/reports/schedules?runs=701");
    expect(history.body).toContain("실행 이력: 월간 자가 점검");
    expect(history.body).toContain("3번 시도");

    const run = await o.post("/compliance/reports/schedules", { intent: "runNow", scheduleId: "701" });
    expect(run.response.status).toBe(302);
    expect(run.response.headers.get("location")).toBe("/compliance/reports/schedules?runs=701");
    const after = await o.get("/compliance/reports/schedules?runs=701");
    expect(after.body).toContain("지금 실행");
    expect(after.body).toContain("대기");
    expect(cmpState(app.gateway.m2).runs).toHaveLength(2);
  });

  it("TC-CMP-059 만들기 검증(실행일·이메일·수신자), 프로필 없는 공간, 저장, 고치기(버전), 삭제", async () => {
    const o = await operator();
    const page = await o.get("/compliance/reports/schedules/new");
    expect(page.response.status).toBe(200);
    expect(page.body).toContain("수신자");
    expect(page.body).toContain("김운영");

    const day = await o.post("/compliance/reports/schedules/new", scheduleForm({ dayOfPeriod: "32" }));
    expect(day.response.status).toBe(400);
    expect(day.body).toContain("실행일은 1~28 사이여야 합니다.");
    const email = await o.post("/compliance/reports/schedules/new", scheduleForm({ emails: "not-an-email" }));
    expect(email.body).toContain("이메일 형식이 올바르지 않습니다.");
    const none = await o.post("/compliance/reports/schedules/new", scheduleForm({ userIds: [], emails: "" }));
    expect(none.body).toContain("수신자를 한 명 이상 정하세요.");
    const office = await o.post("/compliance/reports/schedules/new", scheduleForm({ spaceIds: "32" }));
    expect(office.response.status).toBe(409);
    expect(office.body).toContain("선택한 공간에 프로필이 적용되어 있지 않습니다.");

    const saved = await o.post("/compliance/reports/schedules/new", scheduleForm());
    expect(saved.response.status).toBe(302);
    const created = cmpState(app.gateway.m2).schedules[1];
    expect(created).toMatchObject({
      name: "분기 자가 점검",
      cadence: "QUARTERLY",
      dayOfPeriod: 5,
      publishTime: "08:30",
      recipients: { userIds: ["7", "9"], emails: ["audit@example.com"] },
      format: "PDF_CSV",
      enabled: true,
    });
    const id = created.reportScheduleId as string;
    expect((await o.get("/compliance/reports/schedules")).body).toContain("분기 첫 달 5일 08:30");

    const edit = await o.get(`/compliance/reports/schedules/${id}`);
    expect(edit.body).toContain("정기 발행 고치기");
    expect(edit.body).toContain("audit@example.com");
    const off = await o.post(`/compliance/reports/schedules/${id}`, scheduleForm({ version: "0", enabled: "" }));
    expect(off.response.status).toBe(302);
    expect(cmpState(app.gateway.m2).schedules[1]).toMatchObject({ enabled: false, nextRunAt: null, version: 1 });
    expect((await o.get("/compliance/reports/schedules")).body).toContain("꺼짐");
    const stale = await o.post(`/compliance/reports/schedules/${id}`, scheduleForm({ version: "0" }));
    expect(stale.response.status).toBe(409);
    expect(stale.body).toContain("다른 사용자가 먼저 수정했습니다");

    const removed = await o.post(`/compliance/reports/schedules/${id}`, { intent: "delete" });
    expect(removed.response.status).toBe(302);
    expect(cmpState(app.gateway.m2).schedules).toHaveLength(1);
    expect((await o.get(`/compliance/reports/schedules/${id}`)).response.status).toBe(404);
  });

  it("VIEWER는 목록과 이력만 보고 만들기·지금 실행은 없다", async () => {
    const v = await viewer();
    const page = await v.get("/compliance/reports/schedules?runs=701");
    expect(page.response.status).toBe(200);
    expect(page.body).toContain("월간 자가 점검");
    expect(page.body).not.toContain("새 정기 발행");
    expect(page.body).not.toContain('value="runNow"');
    expect((await v.get("/compliance/reports/schedules/new")).response.status).toBe(403);
    const denied = await v.post("/compliance/reports/schedules", { intent: "runNow", scheduleId: "701" });
    expect(denied.response.status).toBe(403);
  });
});
