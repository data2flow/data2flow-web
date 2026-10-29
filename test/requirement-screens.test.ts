/**
 * 요구사항 시험 화면 보강 SSR + BFF 통합: UI-ACT-08 조직 제어 한계·보호 설정, UI-ING-02 원본 메시지 목록, UI-TSD-06 데이터 완전성,
 * UI-ANA-07 분석 템플릿 설정, UI-ANA-09 데이터셋, UI-DSH-11 화면 설정. 가짜 gateway: test/msw/handlers/requirement-screens.ts(그 밖은 기존 핸들러).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TestBrowser, startApp, type AppContext } from "./app-harness";
import { requirementScreensState } from "./msw/handlers/requirement-screens";

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
const admin = () => as("admin01", "Admin-Pass-123");
const integrator = () => as("lee.int", "Integrator-Pass1");
const operator = () => as("kim.op", "Correct-Horse-9");
const analyst = () => as("ana.lyst", "Analyst-Pass-123");
const viewer = () => as("view.er", "Viewer-Pass-123");

function json(browser: TestBrowser, path: string, method: string, body?: unknown) {
  return browser.request(path, { method, headers: { "Content-Type": "application/json", "X-CSRF-TOKEN": browser.csrf }, body: body === undefined ? undefined : JSON.stringify(body) });
}

describe("ACT-06.04 UI-ACT-08 조직 제어 한계·보호 설정", () => {
  it("ACT-06.04 ADMIN은 관리 메뉴에서 열고 기능별 절대 한계·보호 기본값을 본다, 다른 역할은 403", async () => {
    const a = await admin();
    const page = await a.get("/settings/control");
    expect(page.response.status).toBe(200);
    expect(page.body).toContain("조직 제어 한계·보호 설정");
    expect(page.body).toContain('href="/settings/control"');
    // 한계 표: Thermostat.targetTemperature 18~28, 표준 범위 5~35 참고
    expect(page.body).toContain("targetTemperature");
    expect(page.body).toContain('value="18"');
    expect(page.body).toContain("5 ~ 35 °C");
    expect(page.body).toContain("수동 우선 시간(분)");
    expect(page.body).toContain("제어 노드가 있는 플로우는 배포 승인 필요");

    const i = await integrator();
    expect((await i.get("/settings/control")).response.status).toBe(403);
    expect((await i.get("/")).body).not.toContain('href="/settings/control"');
  });

  it("BR-ACT-09 모델 범위보다 넓은 한계는 LIMIT_WIDER_THAN_MODEL, 좁은 한계는 저장되고 버전이 오른다", async () => {
    const a = await admin();
    await a.get("/settings/control");
    const body = (limits: unknown, baseVersion: number) => ({ absoluteLimits: limits, manualOverrideMinutes: 30, minIntervalSec: 10, oscillation: { windowSec: 60, flips: 3 }, defaultValiditySec: 600, scheduleRespectsManualOverride: true, requireApprovalForControlNodes: true, baseVersion });
    const wide = await json(a, "/bff/api/core/settings/control", "PUT", body({ Thermostat: { targetTemperature: { min: 10, max: 28 } } }, 2));
    expect(wide.response.status).toBe(400);
    expect(JSON.parse(wide.body).header.resultCode).toBe("LIMIT_WIDER_THAN_MODEL");
    const narrow = await json(a, "/bff/api/core/settings/control", "PUT", body({ Thermostat: { targetTemperature: { min: 20, max: 26 } } }, 2));
    expect(narrow.response.status).toBe(200);
    expect(JSON.parse(narrow.body).response.version).toBe(3);
    expect(requirementScreensState(app.gateway.m2).control.requireApprovalForControlNodes).toBe(true);
    expect((await a.get("/settings/control")).body).toContain('value="26"');
  });
});

describe("ING-01.01 UI-ING-02 원본 메시지 목록", () => {
  it("AT-ING-06.1 OPERATOR는 수집 메뉴에서 기간·상태로 원본을 거르고 상태별 건수를 본다, VIEWER는 403", async () => {
    const o = await operator();
    const page = await o.get("/ingest/raw-messages?period=24h");
    expect(page.response.status).toBe(200);
    expect(page.body).toContain('href="/ingest/raw-messages"');
    expect(page.body).toContain("application/1/device/24e124707c067999/event/up");
    expect(page.body).toContain("DECODE_ERROR");
    expect(page.body).toContain("(식별 불가)");

    const onlyErrors = await o.get("/ingest/raw-messages?period=24h&status=DECODE_ERROR");
    expect(onlyErrors.body).toContain("devices/unknown/telemetry");
    expect(onlyErrors.body).not.toContain("application/1/device/24e124136d151606/event/up");

    const none = await o.get("/ingest/raw-messages?period=1h&topic=nothing-matches");
    expect(none.body).toContain("조건에 맞는 메시지가 없습니다");

    const v = await viewer();
    expect((await v.get("/ingest/raw-messages")).response.status).toBe(403);
  });

  it("AT-ING-06.2 행의 상세(API-ING-06)는 BFF로 열리고 원본 payload는 INTEGRATOR만 받는다", async () => {
    const o = await operator();
    const detail = JSON.parse((await o.get("/bff/api/core/ingest/raw-messages/8812345")).body).response;
    expect(detail.payload).toBeUndefined();
    const i = await integrator();
    expect(JSON.parse((await i.get("/bff/api/core/ingest/raw-messages/8812345")).body).response.payload).toBeTruthy();
  });
});

describe("TSD-02.04 UI-TSD-06 데이터 완전성", () => {
  it("TSD-02.04 VIEWER도 기기별 예상·실제 수신·완전성 %·공백 수를 보고, 완전성이 낮은 기기가 먼저 나온다", async () => {
    const v = await viewer();
    const page = await v.get("/explore/coverage?days=1");
    expect(page.response.status).toBe(200);
    expect(page.body).toContain("데이터 완전성");
    expect(page.body).toContain('href="/explore/coverage"');
    expect(page.body).toContain("92.4%");
    expect(page.body).toContain("100.0%");
    expect(page.body.indexOf("92.4%")).toBeLessThan(page.body.indexOf("100.0%"));
    // 가장 긴 공백 1시간 30분
    expect(page.body).toContain("1시간 30분");
  });
});

describe("ANA-01.03 UI-ANA-07 분석 템플릿 설정", () => {
  it("ANA-01.03 ADMIN은 템플릿별 사용 수와 활성 스위치, 결과 보관 기간을 본다, ANALYST는 403", async () => {
    const a = await admin();
    const page = await a.get("/settings/analytics-templates");
    expect(page.response.status).toBe(200);
    expect(page.body).toContain("분석 템플릿 설정");
    expect(page.body).toContain('href="/settings/analytics-templates"');
    expect(page.body).toContain("anomaly-detect");
    expect(page.body).toContain('value="365"');
    const an = await analyst();
    expect((await an.get("/settings/analytics-templates")).response.status).toBe(403);
  });

  it("API-ANA-18 끄면 core가 일정을 멈추고, API-ANA-25 보관 기간은 30~1095일만 받는다", async () => {
    const a = await admin();
    await a.get("/settings/analytics-templates");
    const off = await json(a, "/bff/api/core/analytics/template-settings/anomaly-detect", "PUT", { enabled: false });
    expect(JSON.parse(off.body).response.pausedAnalysisIds).toEqual(["17"]);
    expect(requirementScreensState(app.gateway.m2).templateEnabled["anomaly-detect"]).toBe(false);
    expect((await json(a, "/bff/api/core/analytics/settings", "PUT", { resultRetentionDays: 10 })).response.status).toBe(400);
    expect(JSON.parse((await json(a, "/bff/api/core/analytics/settings", "PUT", { resultRetentionDays: 400 })).body).response.resultRetentionDays).toBe(400);
  });
});

describe("ANA-10.01 UI-ANA-09 데이터셋", () => {
  it("BR-ANA-21 VIEWER는 목록·상세(바인딩 칩·버전 이력·사용 중인 분석)를 보고, [최신 버전으로 올리기]는 ANALYST부터", async () => {
    const v = await viewer();
    const list = await v.get("/analytics/datasets");
    expect(list.response.status).toBe(200);
    expect(list.body).toContain("실습실 온도");
    expect(list.body).toContain('href="/analytics/datasets/61"');
    expect(list.body).not.toContain("+ 데이터셋");
    const detail = await v.get("/analytics/datasets/61");
    expect(detail.body).toContain("AM107 · 온도");
    expect(detail.body).toContain("최근 14일");
    expect(detail.body).toContain("실습실 온도 이상 탐지");
    expect(detail.body).toContain("새 버전 있음");
    expect(detail.body).not.toContain("최신 버전으로 올리기");

    const an = await analyst();
    expect((await an.get("/analytics/datasets")).body).toContain("+ 데이터셋");
    expect((await an.get("/analytics/datasets/61")).body).toContain("최신 버전으로 올리기");
    expect((await an.get("/analytics/datasets/999")).response.status).toBe(404);
  });

  it("API-ANA-20 만들기·올리기, TC-ANA-177 쓰는 중 지우기 거절은 BFF로 중계된다", async () => {
    const an = await analyst();
    await an.get("/analytics/datasets");
    const created = await an.request("/bff/api/core/analytics/datasets", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-TOKEN": an.csrf, "Idempotency-Key": "k-1" },
      body: JSON.stringify({ name: "새 묶음", bindings: [], period: { type: "RELATIVE", days: 7 }, qualityFilter: "NORMAL_ONLY", includeVirtual: false }),
    });
    expect(created.response.status).toBe(201);
    const upgraded = await json(an, "/bff/api/core/analytics/datasets/61/analyses/17/upgrade-dataset", "POST");
    expect(JSON.parse(upgraded.body).response.datasetVersion).toBe(2);
    expect((await an.get("/analytics/datasets/61")).body).not.toContain("새 버전 있음");
    const del = await json(an, "/bff/api/core/analytics/datasets/61", "DELETE");
    expect(del.response.status).toBe(409);
    expect(JSON.parse(del.body).header.resultCode).toBe("DATASET_IN_USE");
  });
});

describe("DSH-07 UI-DSH-11 화면 설정", () => {
  it("DSH-07.02 모든 사용자는 내 정보 [화면 설정] 탭에서 테마를 저장하고 쿠키로 바로 적용된다", async () => {
    const v = await viewer();
    const page = await v.get("/me/preferences");
    expect(page.response.status).toBe(200);
    expect(page.body).toContain('href="/me/preferences"');
    expect(page.body).toContain("시스템 설정 따름");
    const saved = await v.post("/me/preferences", { intent: "save", theme: "DARK", home: "HOME", defaultDashboardId: "", temperatureUnit: "F" });
    expect(saved.response.status).toBe(200);
    expect(saved.body).toContain("화면 설정을 저장했습니다.");
    expect(saved.setCookies.some((c) => c.startsWith("data2flow_theme=DARK"))).toBe(true);
    const missing = await v.post("/me/preferences", { intent: "save", theme: "LIGHT", home: "DASHBOARD", defaultDashboardId: "", temperatureUnit: "" });
    expect(missing.response.status).toBe(400);
    expect(missing.body).toContain("기본 대시보드를 고르세요");
  });

  it("즐겨찾기를 빼고, 기능 안내를 다시 보이게 한다", async () => {
    const o = await operator();
    await o.get("/me/preferences");
    const current = JSON.parse((await o.get("/bff/api/core/accounts/me/preferences")).body).response;
    await json(o, "/bff/api/core/accounts/me/preferences", "PUT", { favorites: [{ type: "DEVICE", id: "1042", name: "AM107-067999" }], baseVersion: current.version });
    const page = await o.get("/me/preferences");
    expect(page.body).toContain("AM107-067999");
    const removed = await o.post("/me/preferences", { intent: "removeFavorite", favorite: "DEVICE:1042" });
    expect(removed.body).toContain("즐겨찾기에서 뺐습니다.");
    expect(removed.body).toContain("즐겨찾기가 없습니다");
    const reset = await o.post("/me/preferences", { intent: "resetTours" });
    expect(reset.body).toContain("기능 안내를 다시 보여 줍니다.");
  });
});
