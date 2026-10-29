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
