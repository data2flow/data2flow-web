/**
 * M5 floor SSR + BFF 통합: 평면도 보기(DSH-02.02·02.03), 위치 경로(DSH-09.02), 층 전환·[3D](DSH-12.04), 운영 모드 수동 지정(DEV-11.02 화면),
 * 조직 달력(DEV-12.01, UI-DEV-14), 외부 맥락(DSC-06.01·06.02·06.04·06.05, UI-DSC-04).
 * 가짜 gateway: test/msw/handlers/floor.ts(core M5 BuildingModelController·CalendarController·ContextSourceController 모양).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TestBrowser, startApp, type AppContext } from "./app-harness";
import { floorExtra, seedModel } from "./msw/handlers/floor";
import { spaceExtra } from "./msw/handlers/spaces";

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
const sent = (method: string, path: string) => app.gateway.received.filter((r) => r.method === method && r.path.split("?")[0] === path);
const core = () => app.gateway.m2;

/** 본관(2)에 3층(3)·4층(4), 실습실(31) 평면도와 마커 */
function seedFloors() {
  core().spaces.push({ id: "4", parentId: "2", type: "FLOOR", name: "4층", code: "4f", sortOrder: 1, version: 1 });
  const plans = spaceExtra(core()).floorplans;
  plans["3"] = { width: 1200, height: 800, version: 1, markers: [] };
  plans["4"] = { width: 1200, height: 800, version: 3, markers: [] };
  plans["31"] = { width: 1200, height: 800, version: 1, markers: [{ deviceId: "1042", x: 0.25, y: 0.5 }] };
}

describe("DSH-02.02 평면도 보기 — 마커 현재값·상태(UI-DSH-02 평면도 탭)", () => {
  it("TC-DSH-014 AT-DSH-02.1: 마커에 현재값과 상태 기호, 보기에는 편집 도구가 없고 권한자만 [평면도 편집]", async () => {
    seedFloors();
    const page = await (await viewer()).get("/spaces/31?tab=floorplan");
    expect(page.response.status).toBe(200);
    expect(page.body).toContain('data-marker="1042"');
    expect(page.body).toContain('data-state="NORMAL"');
    expect(page.body).toContain("AM107-067999 · 정상");
    expect(page.body).toContain("22.3℃");
    expect(page.body).toContain("히트 컬러");
    expect(page.body).not.toContain("평면도 편집");
    expect(page.body).not.toContain("편집 모드");

    const admin = await integrator();
    const view = await admin.get("/spaces/31?tab=floorplan");
    expect(view.body).toContain('href="/spaces/31?tab=floorplan&amp;edit=1"');
    const editor = await admin.get("/spaces/31?tab=floorplan&edit=1");
    expect(editor.body).toContain("편집 모드");
    expect(sent("GET", "/api/v1/core/spaces/31/devices").length).toBeGreaterThan(0);
  });

  it("열린 알람이 있는 기기는 ▲ 알람 상태(색 + 글자, NFR-08.03)", async () => {
    seedFloors();
    core().extra.spaceOpenAlarms = { "31": [{ id: "9", severity: "MAJOR", status: "ACTIVE", title: "고CO2", device: { id: "1042" } }] };
    const page = await (await viewer()).get("/spaces/31?tab=floorplan");
    expect(page.body).toContain('data-state="ALARM"');
    expect(page.body).toContain("AM107-067999 · 알람");
  });
});

describe("DSH-09.02 위치 경로(breadcrumb)", () => {
  it("TC-DSH-089 AT-DSH-02.2: 사이트 › 건물 › 3층 › 실습실, 층은 평면도 탭으로, 포트폴리오에서 오면 앞에 포트폴리오(AT-DSH-12.4)", async () => {
    const browser = await viewer();
    const page = await browser.get("/spaces/31");
    expect(page.body).toContain('aria-label="위치 경로"');
    expect(page.body).toContain('href="/spaces/1"');
    expect(page.body).toContain('href="/spaces/2"');
    expect(page.body).toContain('href="/spaces/3?tab=floorplan"');
    expect(page.body).toMatch(/aria-current="page">실습실</);
    const fromPortfolio = await browser.get("/spaces/31?from=portfolio");
    expect(fromPortfolio.body).toContain('href="/portfolio"');
    expect(fromPortfolio.body).toContain("포트폴리오");
    expect(fromPortfolio.body).toContain('href="/spaces/1?from=portfolio"');
  });
});

describe("DSH-12.04 층 전환 평면도와 3D 모델", () => {
  it("TC-DSH-109 AT-DSH-13.1: 건물 평면도 탭은 층 전환 바, [▲]은 다음 층 `?floor=`, 그 층 평면도로 바뀐다", async () => {
    seedFloors();
    const browser = await viewer();
    const first = await browser.get("/spaces/2?tab=floorplan");
    expect(sent("GET", "/api/v1/core/buildings/2/floors")).toHaveLength(1);
    expect(first.body).toContain('aria-label="층 전환"');
    expect(first.body).toContain("1 / 2층");
    expect(first.body).toContain('href="/spaces/2?tab=floorplan&amp;floor=4"');
    expect(first.body).toContain('src="/bff/api/core/spaces/3/floorplan/image?v=1"');
    const up = await browser.get("/spaces/2?tab=floorplan&floor=4");
    expect(up.body).toContain("2 / 2층");
    expect(up.body).toContain('src="/bff/api/core/spaces/4/floorplan/image?v=3"');
    expect(up.body).toContain('href="/spaces/2?tab=floorplan&amp;floor=3"');
    // 층 공간에서는 같은 건물의 다른 층 공간으로 이동
    const floor = await browser.get("/spaces/3?tab=floorplan");
    expect(floor.body).toContain('href="/spaces/4?tab=floorplan"');
  });

  it("TC-DSH-111 AT-DSH-13.2: [3D] 탭 — 10개 중 8개 매핑 요소는 상태 색, 2개 회색, VIEWER에게 편집 도구 없음", async () => {
    seedModel(core());
    const page = await (await viewer()).get("/spaces/2?tab=model3d");
    expect(page.body).toContain("3D");
    expect((page.body.match(/data-state="UNMAPPED"/g) ?? []).length).toBe(2);
    expect((page.body.match(/data-element=/g) ?? []).length).toBe(10);
    expect(page.body).toContain("연결 8 · 연결 없음 2");
    expect(page.body).toContain("열람 전용");
    expect(page.body).not.toContain("공간 연결 편집");
    expect(page.body).not.toContain("IFC 올리기");
    // 건물이 아닌 공간에는 [3D] 탭이 없다
    expect((await (await viewer()).get("/spaces/31")).body).not.toContain("tab=model3d");
  });

  it("AT-DSH-13.3: IFC가 아닌 파일은 MODEL_FILE_INVALID 안내, .ifc는 올리고 공간 연결·삭제(INTEGRATOR)", async () => {
    const model = seedModel(core());
    const browser = await integrator();
    const page = await browser.get("/spaces/2?tab=model3d");
    expect(page.body).toContain("IFC 올리기");
    expect(page.body).toContain("공간 연결 편집");
    const bad = new FormData();
    bad.set("_csrf", browser.csrf);
    bad.set("intent", "bimUpload");
    bad.set("file", new File(["x"], "plan.dwg"));
    const rejected = await browser.request("/spaces/2?tab=model3d", { method: "POST", body: bad });
    expect(rejected.response.status).toBe(400);
    expect(rejected.body).toContain("200MB 이하");
    expect(floorExtra(core()).uploads).toBe(0);

    const good = new FormData();
    good.set("_csrf", browser.csrf);
    good.set("intent", "bimUpload");
    good.set("name", "신관");
    good.set("file", new File(["ISO-10303-21;"], "annex.ifc"));
    const uploaded = await browser.request("/spaces/2?tab=model3d", { method: "POST", body: good });
    expect(uploaded.response.status).toBe(200);
    expect(uploaded.body).toContain("변환이 끝나면 열람할 수 있습니다");
    expect(floorExtra(core()).models).toHaveLength(2);

    const mappings = JSON.stringify([{ ifcGlobalId: model.elements[0].ifcGlobalId, spaceId: "31" }, { ifcGlobalId: model.elements[9].ifcGlobalId, spaceId: "32" }, { ifcGlobalId: "bad", spaceId: "31" }, { ifcGlobalId: model.elements[1].ifcGlobalId, spaceId: "" }]);
    const mapped = await browser.post(`/spaces/2?tab=model3d&model=${model.id}`, { intent: "bimMapping", modelId: model.id, mappings });
    expect(mapped.response.status).toBe(200);
    expect(sent("PUT", `/api/v1/core/buildings/2/models/${model.id}/space-mapping`)[0].body).toEqual({ mappings: [{ ifcGlobalId: model.elements[0].ifcGlobalId, spaceId: "31" }, { ifcGlobalId: model.elements[9].ifcGlobalId, spaceId: "32" }] });
    const deleted = await browser.post("/spaces/2?tab=model3d", { intent: "bimDelete", modelId: model.id });
    expect(deleted.response.status).toBe(200);
    expect(sent("DELETE", `/api/v1/core/buildings/2/models/${model.id}`)).toHaveLength(1);
  });
});

describe("DEV-11.02 운영 모드 수동 지정(UI-DEV-14, API-DEV-08 POST)", () => {
  it("OPERATOR(DEV_PLACE)는 수동 지정·해제, VIEWER는 폼 없음", async () => {
    const op = await operator();
    const page = await op.get("/spaces/31?tab=schedule");
    expect(page.body).toContain("수동 지정 해제");
    const until = new Date(Date.now() + 3600_000).toISOString();
    const set = await op.post("/spaces/31?tab=schedule", { intent: "override", mode: "MAINTENANCE", until });
    expect(set.response.status).toBe(200);
    expect(sent("POST", "/api/v1/core/spaces/31/override-mode")[0].body).toEqual({ mode: "MAINTENANCE", until });
    await op.post("/spaces/31?tab=schedule", { intent: "override", mode: "", until: "" });
    expect(sent("POST", "/api/v1/core/spaces/31/override-mode")[1].body).toEqual({ mode: null });
    expect((await (await viewer()).get("/spaces/31?tab=schedule")).body).not.toContain("수동 지정 해제");
  });
});

describe("DEV-12.01 조직 달력(UI-DEV-14)", () => {
  it("TC-DEV-297: 월 보기에 공휴일·가져온 일정(원본 삭제됨), VIEWER는 [+ 일정] 없음, 범위 필터는 spaceId로", async () => {
    const browser = await viewer();
    const page = await browser.get("/calendar");
    expect(page.response.status).toBe(200);
    expect(sent("GET", "/api/v1/core/calendar-events")[0].path).toContain("from=2026-09-28&to=2026-11-01");
    expect(page.body).toContain("개천절");
    expect(page.body).toContain("한글날");
    expect(page.body).toContain("중간고사 기간");
    expect(page.body).toContain("원본 삭제됨");
    expect(page.body).toContain('data-date="2026-10-03"');
    expect(page.body).not.toContain("+ 일정");
    expect(page.body).not.toContain("외부 달력 연결");
    const list = await browser.get("/calendar?view=list&date=2026-10-01&spaceId=31");
    expect(sent("GET", "/api/v1/core/calendar-events")[1].path).toContain("spaceId=31");
    expect(list.body).toContain("2026-10-12 ~ 2026-10-17");
    const week = await browser.get("/calendar?view=week&date=2026-10-09");
    expect(sent("GET", "/api/v1/core/calendar-events")[2].path).toContain("from=2026-10-05&to=2026-10-11");
    expect(week.body).toContain("한글날");
  });

  it("TC-DEV-297: 입력 검증(시작 ≤ 종료 \"시작일이 종료일보다 늦습니다\", 최대 366일), 추가·자동 일정은 영향만 수정·수동 일정 삭제", async () => {
    const op = await operator();
    expect((await op.get("/calendar")).body).toContain("+ 일정");
    const reversed = await op.post("/calendar", { intent: "create", title: "휴관", type: "CLOSURE", startsOn: "2026-10-20", endsOn: "2026-10-19", affectsMode: "HOLIDAY" });
    expect(reversed.response.status).toBe(400);
    expect(reversed.body).toContain("시작일이 종료일보다 늦습니다");
    const long = await op.post("/calendar", { intent: "create", title: "긴 방학", type: "VACATION", startsOn: "2026-01-01", endsOn: "2027-01-02", affectsMode: "UNOCCUPIED" });
    expect(long.response.status).toBe(400);
    expect(long.body).toContain("기간은 최대 366일입니다");
    expect(sent("POST", "/api/v1/core/calendar-events")).toHaveLength(0);
    const created = await op.post("/calendar", { intent: "create", title: "축제", type: "EVENT", startsOn: "2026-10-21", endsOn: "2026-10-22", affectsMode: "NONE", scopeSpaceIds: ["1"] });
    expect(created.response.status).toBe(200);
    expect(created.body).toContain("일정을 추가했습니다.");
    expect(sent("POST", "/api/v1/core/calendar-events")[0].body).toEqual({ title: "축제", type: "EVENT", startsOn: "2026-10-21", endsOn: "2026-10-22", startTime: null, endTime: null, scopeSpaceIds: ["1"], affectsMode: "NONE" });

    await op.post("/calendar", { intent: "update", id: "501", affectsMode: "NONE" });
    expect(sent("PATCH", "/api/v1/core/calendar-events/501")[0].body).toEqual({ affectsMode: "NONE", baseVersion: 1 });
    const manual = floorExtra(core()).events.find((e) => e.title === "축제")!;
    await op.post("/calendar", { intent: "update", id: manual.id, title: "가을 축제", type: "EVENT", startsOn: "2026-10-21", endsOn: "2026-10-23", affectsMode: "NONE", scopeSpaceIds: ["1"] });
    expect(sent("PATCH", `/api/v1/core/calendar-events/${manual.id}`)[0].body).toEqual({ title: "가을 축제", endsOn: "2026-10-23", baseVersion: 1 });
    const removed = await op.post("/calendar", { intent: "delete", id: manual.id });
    expect(removed.body).toContain("일정을 지웠습니다.");
    const autoDelete = await op.post("/calendar", { intent: "delete", id: "502" });
    expect(autoDelete.response.status).toBe(400);
  });

  it("목록을 못 불러오면 [다시 시도], 외부 달력 연결은 INTEGRATOR에게만", async () => {
    core().extra.calendarFails = true;
    const page = await (await viewer()).get("/calendar");
    expect(page.body).toContain("일정을 불러오지 못했습니다.");
    expect(page.body).toContain("다시 시도");
    core().extra.calendarFails = false;
    expect((await (await integrator()).get("/calendar")).body).toContain('href="/sources/context"');
  });
});

describe("DSC-06 외부 맥락 데이터(UI-DSC-04)", () => {
  it("TC-DSC-144: 사이트가 하나면 바로 그 사이트, 대기질 측정소는 가까운 순, 켤 때 API 키가 없으면 저장 거부", async () => {
    const browser = await integrator();
    const index = await browser.get("/sources/context");
    expect(index.response.status).toBe(302);
    expect(index.response.headers.get("Location")).toBe("/sources/context/1");
    const page = await browser.get("/sources/context/1");
    expect(page.body).toContain("외부 맥락 · 광주캠퍼스");
    expect(page.body).toContain("기상청 날씨");
    expect(page.body).toContain("대기질(에어코리아)");
    expect(page.body).toContain("학사일정(iCal)");
    expect(page.body.indexOf("치평동 1.2km")).toBeLessThan(page.body.indexOf("농성동 2.4km"));
    expect(page.body).toContain("시뮬레이터 값");
    const noKey = await browser.post("/sources/context/1", { intent: "save", type: "AIRKOREA", enabled: "true", stationName: "치평동", items: ["PM10", "PM25"] });
    expect(noKey.response.status).toBe(400);
    expect(noKey.body).toContain("켤 때는 API 키가 필요합니다");
    const saved = await browser.post("/sources/context/1", { intent: "save", type: "KMA_WEATHER", enabled: "true", apiKey: "kma-key", nx: "58", ny: "74", items: ["T1H", "REH"], forecast: "true", dailyQuota: "1000", unitCost: "" });
    expect(saved.response.status).toBe(200);
    expect(floorExtra(core()).lastPut).toEqual({ siteId: "1", type: "KMA_WEATHER", body: { enabled: true, apiKey: "kma-key", nx: 58, ny: 74, items: ["T1H", "REH"], forecast: true, dailyQuota: 1000, unitCost: null } });
    const after = await browser.get("/sources/context/1");
    expect(after.body).toContain("저장된 키가 있습니다");
    expect(after.body).not.toContain("kma-key");
  });

  it("TC-DSC-144: 좌표가 없는 사이트는 \"위치 필요\"와 공간 화면 링크, 측정소는 부르지 않는다", async () => {
    const site = core().spaces.find((s) => s.id === "1")!;
    site.latitude = null;
    site.longitude = null;
    const page = await (await integrator()).get("/sources/context/1");
    expect(page.body).toContain("위치 필요");
    expect(page.body).toContain('href="/spaces/1?tab=props"');
    expect(sent("GET", "/api/v1/core/external/airkorea-stations")).toHaveLength(0);
  });

  it("TC-DSC-156 AT-DSC-09.3: iCal 주소는 https·webcal만, 파일은 올린 뒤 fileObjectKey로 저장하고 카테고리 → 유형 매핑, 지금 갱신 결과 +2 −1", async () => {
    const browser = await integrator();
    await browser.get("/sources/context/1");
    const bad = await browser.post("/sources/context/1", { intent: "save", type: "ICAL", enabled: "true", url: "http://example.com/a.ics", refreshHours: "6", typeMapping: "[]" });
    expect(bad.response.status).toBe(400);
    expect(bad.body).toContain("https:// 또는 webcal:// 주소만 쓸 수 있습니다");
    const form = new FormData();
    form.set("_csrf", browser.csrf);
    form.set("intent", "save");
    form.set("type", "ICAL");
    form.set("enabled", "true");
    form.set("url", "");
    form.set("refreshHours", "12");
    form.set("typeMapping", JSON.stringify([{ category: "시험", type: "EXAM" }, { category: "", type: "EVENT" }, { category: "방학", type: "VACATION" }]));
    form.set("file", new File(["BEGIN:VCALENDAR"], "academic.ics", { type: "text/calendar" }));
    const saved = await browser.request("/sources/context/1", { method: "POST", body: form });
    expect(saved.response.status).toBe(200);
    expect(sent("POST", "/api/v1/core/sources/ical/upload")).toHaveLength(1);
    expect(floorExtra(core()).lastPut?.body).toEqual({ enabled: true, fileObjectKey: "ical/2026/academic.ics", typeMapping: { 시험: "EXAM", 방학: "VACATION" }, refreshHours: 12 });
    const page = await browser.get("/sources/context/1");
    expect(page.body).toContain("+2 −1");
    expect(page.body).toContain("지금 갱신");
    const sourceId = floorExtra(core()).context["1"].find((c) => c.type === "ICAL")!.sourceId!;
    const refreshed = await browser.post("/sources/context/1", { intent: "refresh", type: "ICAL", sourceId });
    expect(refreshed.body).toContain("갱신: ✓ 성공 +2 −1");
  });

  it("TC-DSC-162 AT-DSC-09.4: 호출량 막대(90일) — 80% 이상 경고 \"80% 도달\", 100%면 \"다음 날까지 호출 중지\", 비용 표시", async () => {
    floorExtra(core()).context["1"] = [{ type: "KMA_WEATHER", sourceId: "71", enabled: true, config: { nx: 58, ny: 74, dailyQuota: 1000, unitCost: 2 }, apiKeyConfigured: true, version: 1 }, { type: "AIRKOREA", sourceId: "72", enabled: true, config: { stationName: "치평동" }, apiKeyConfigured: true, version: 1 }];
    floorExtra(core()).usage["71"] = [
      { day: "2026-10-03", calls: 312, failures: 0, quota: 1000, warning: false, exhausted: false, cost: 624 },
      { day: "2026-10-04", calls: 820, failures: 3, quota: 1000, warning: true, exhausted: false, cost: 1640 },
    ];
    floorExtra(core()).usage["72"] = [{ day: "2026-10-04", calls: 500, failures: 0, quota: 500, warning: true, exhausted: true, cost: null }];
    const page = await (await operator()).get("/sources/context/1");
    expect(page.body).toContain("오늘 호출 820/1000");
    expect(page.body).toContain("80% 도달");
    expect(page.body).toContain("한도 도달 — 다음 날까지 호출 중지");
    expect(page.body).toContain('data-level="warn"');
    expect(page.body).toContain('data-level="exhausted"');
    expect(page.body).toContain("비용: 오늘 1,640 · 이번 달 2,264");
    // OPERATOR는 조회만(설정·지금 갱신·측정소 없음)
    expect(page.body).not.toContain("지금 갱신");
    expect(page.body).not.toContain('name="apiKey"');
    expect(sent("GET", "/api/v1/core/external/airkorea-stations")).toHaveLength(0);
  });
});
