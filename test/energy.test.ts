/**
 * M7 에너지 설정 화면 SSR + BFF 통합: UI-ENE-01 단가·배출계수(TC-ENE-015), UI-ENE-02 계량·고지서(TC-ENE-008).
 * 가짜 gateway: test/msw/handlers/energy.ts.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TestBrowser, startApp, type AppContext } from "./app-harness";
import { eneState } from "./msw/handlers/energy";

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

const tou = (weekdaySecondFrom: string) => ({
  intent: "createTariff",
  idempotencyKey: "t1",
  validFrom: "2026-12-01",
  mode: "TOU",
  "WEEKDAY.from": ["00:00", weekdaySecondFrom],
  "WEEKDAY.to": ["09:00", "24:00"],
  "WEEKDAY.rate": ["100", "200"],
  "WEEKDAY.label": ["경부하", ""],
  "WEEKEND_HOLIDAY.from": ["00:00"],
  "WEEKEND_HOLIDAY.to": ["24:00"],
  "WEEKEND_HOLIDAY.rate": ["100"],
  "WEEKEND_HOLIDAY.label": [""],
});

describe("ENE-01.02 UI-ENE-01 에너지 설정", () => {
  it("TC-ENE-015 기본 배출계수 옆에 출처 문서명과 기준 연도, 과거 재계산 안내", async () => {
    const i = await integrator();
    const factors = await i.get("/energy/settings?tab=factors");
    expect(factors.response.status).toBe(200);
    expect(factors.body).toContain("0.4567 tCO2eq/MWh");
    expect(factors.body).toContain("국가 온실가스 배출·흡수계수 — 전력 배출계수 (2023년 기준)");
    expect(factors.body).toContain("기본값(읽기 전용)");
    expect(factors.body).toContain("과거 기간은 다시 계산하지 않습니다");
    expect(factors.body).not.toContain('name="intent" value="deleteFactor"');

    const tariffs = await i.get("/energy/settings");
    expect(tariffs.body).toContain("150.00 원/kWh");
    expect(tariffs.body).toContain("2026-01-01 ~ 2026-09-30");
    expect(tariffs.body).toContain("00:00–09:00 경부하 98");
    expect(tariffs.body).toContain('href="/energy/meters"');
  });

  it("TC-ENE-015 TOU가 24시간을 덮지 않으면 저장할 수 없고, 덮으면 저장된다", async () => {
    const i = await integrator();
    const gap = await i.post("/energy/settings", tou("10:00"));
    expect(gap.response.status).toBe(400);
    expect(gap.body).toContain("24시간을 모두 지정하세요");
    expect(eneState(app.gateway.m2).tariffs).toHaveLength(2);
    const saved = await i.post("/energy/settings", tou("09:00"));
    expect(saved.response.status).toBe(302);
    const added = eneState(app.gateway.m2).tariffs.at(-1) as { touSchedule: { seasons: { bands: unknown[] }[] } };
    expect(added.touSchedule.seasons[0].bands).toHaveLength(3);

    const overlap = await i.post("/energy/settings", { intent: "createTariff", idempotencyKey: "t2", validFrom: "2026-10-01", mode: "FLAT", flatRate: "160" });
    expect(overlap.response.status).toBe(409);
    expect(overlap.body).toContain("기간이 겹칩니다");
    const zero = await i.post("/energy/settings", { intent: "createTariff", validFrom: "2027-01-01", mode: "FLAT", flatRate: "0" });
    expect(zero.response.status).toBe(400);

    const system = await i.post("/energy/settings?tab=factors", { intent: "deleteFactor", id: "1" });
    expect(system.response.status).toBe(409);
    expect(system.body).toContain("시스템 기본 배출계수는 바꿀 수 없습니다");
    const factor = await i.post("/energy/settings?tab=factors", { intent: "createFactor", validFrom: "2026-01-01", factor: "0.44", sourceTitle: "한전 공시", sourceYear: "2025" });
    expect(factor.response.status).toBe(302);
    expect((await i.get("/energy/settings?tab=factors")).body).toContain("2020-01-01 ~ 2025-12-31");
  });

  it("OPERATOR는 설정 화면에 들어갈 수 없고 VIEWER는 에너지 메뉴가 없다", async () => {
    const o = await operator();
    expect((await o.get("/energy/settings")).response.status).toBe(403);
    const v = await viewer();
    expect((await v.get("/")).body).not.toContain('href="/energy/meters"');
    expect((await v.get("/energy/meters")).response.status).toBe(403);
  });
});

describe("ENE-01.01 UI-ENE-02 계량·고지서", () => {
  it("TC-ENE-008 측정·추정 배지, 고지서와 측정 합계 차이 7.8%", async () => {
    const o = await operator();
    const room = await o.get("/energy/meters?spaceId=31");
    expect(room.response.status).toBe(200);
    expect(room.body).toContain("실습실의 에너지 출처");
    expect(room.body).toContain(">측정<");
    expect(room.body).toContain(">추정<");
    expect(room.body).toContain("합계에는 측정값을 쓰고");
    expect(room.body).toContain("정격 1200W · 대기 5W");
    expect(room.body).toContain("고지서는 사이트·건물 단위로 입력합니다.");
    expect(room.body).not.toContain('name="intent" value="addMetered"');

    const building = await o.get("/energy/meters?spaceId=2&year=2026");
    expect(building.body).toContain("2026년 고지서");
    expect(building.body).toContain("3,200");
    expect(building.body).toContain("2,950");
    expect(building.body).toContain("차이 7.8%");
  });

  it("TC-ENE-008 같은 달 고지서는 409 뒤 덮어쓰기 확인, 확인하면 저장된다", async () => {
    const i = await integrator();
    const first = await i.post("/energy/meters?year=2026", { intent: "putBill", spaceId: "2", month: "2026-09", kwh: "3300", amountKrw: "" });
    expect(first.response.status).toBe(409);
    expect(first.body).toContain("2026-09 고지서가 이미 있습니다. 새 값으로 덮어쓸까요?");
    expect(first.body).toContain('name="overwrite" value="true"');
    const confirmed = await i.post("/energy/meters?year=2026", { intent: "putBill", spaceId: "2", month: "2026-09", kwh: "3300", amountKrw: "", overwrite: "true" });
    expect(confirmed.response.status).toBe(302);
    expect(eneState(app.gateway.m2).bills[0]).toMatchObject({ month: "2026-09", kwh: 3300 });
    const bad = await i.post("/energy/meters", { intent: "putBill", spaceId: "2", month: "2026-10", kwh: "0" });
    expect(bad.response.status).toBe(400);
    expect(bad.body).toContain("사용량은 0보다 커야 합니다");
  });

  it("측정 추가는 아직 연결 안 된 power만 후보로, 같은 계량기는 409", async () => {
    const i = await integrator();
    const page = await i.get("/energy/meters?spaceId=31");
    expect(page.body).toContain('value="2001|power"');
    expect(page.body).not.toContain('value="2001|energy"');
    const added = await i.post("/energy/meters", { intent: "addMetered", spaceId: "31", meter: "2001|power", idempotencyKey: "m1" });
    expect(added.response.status).toBe(302);
    expect(eneState(app.gateway.m2).sources.at(-1)).toMatchObject({ metricKey: "power", cumulative: false });
    const again = await i.post("/energy/meters", { intent: "addMetered", spaceId: "2", meter: "2001|power", idempotencyKey: "m2" });
    expect(again.response.status).toBe(409);
    expect(again.body).toContain("이미 다른 공간에 연결된 계량기");
    const noPower = await i.post("/energy/meters", { intent: "addEstimated", spaceId: "31", deviceId: "1042", ratedPowerW: "" });
    expect(noPower.response.status).toBe(400);
    expect(noPower.body).toContain("정격 소비 전력을 숫자로 입력하세요");
  });
});

describe("ENE-01.03 UI-ENE-03 에너지 대시보드", () => {
  it("VIEWER도 본다: 브레드크럼, 지표 카드, 기준선 없음 안내, 하위 단위와 추정 비율·출처 배지, 기본 기간은 이번 달", async () => {
    const v = await viewer();
    const page = await v.get("/energy?scope=2");
    expect(page.response.status).toBe(200);
    expect(page.body).toContain(">포트폴리오<");
    expect(page.body).toContain(">광주캠퍼스<");
    expect(page.body).toContain(">본관<");
    expect(page.body).toContain("6,020kWh");
    expect(page.body).toContain("12.0kWh/㎡");
    expect(page.body).toContain("924,800원");
    expect(page.body).toContain("2.75tCO2eq");
    expect(page.body).toContain("재실 시간 없음");
    expect(page.body).toContain("기준선이 아직 없습니다");
    expect(page.body).toContain("추정 비율 12.0%");
    expect(page.body).toContain('href="/energy?period=thisMonth&amp;compare=BASELINE&amp;scope=3"');
    expect(page.body).toContain(">측정·추정<");
    expect(page.body).not.toContain('href="/energy/meters"');
    const q = eneState(app.gateway.m2).lastMetrics!;
    expect(q).toMatchObject({ scopeSpaceId: "2", granularity: "DAY", compare: "BASELINE", to: q.to });
    expect(q.from.endsWith("-01")).toBe(true);
  });

  it("직전 기간 비교는 증감 배지, 올해 기간은 월 칸, 범위 밖·없는 공간은 경고", async () => {
    const o = await operator();
    const prev = await o.get("/energy?scope=2&period=custom&from=2026-10-01&to=2026-10-02&compare=PREVIOUS_PERIOD");
    expect(prev.body).toContain("−4.1%");
    expect(prev.body).toContain("직전 기간 6,277kWh");
    expect(eneState(app.gateway.m2).lastMetrics).toMatchObject({ from: "2026-10-01", to: "2026-10-02", compare: "PREVIOUS_PERIOD" });
    await o.get("/energy?period=thisYear");
    expect(eneState(app.gateway.m2).lastMetrics).toMatchObject({ granularity: "MONTH" });
    expect(eneState(app.gateway.m2).lastMetrics!.scopeSpaceId).toBeUndefined();
    const missing = await o.get("/energy?scope=999");
    expect(missing.response.status).toBe(200);
    expect(missing.body).toContain("공간을 찾을 수 없습니다.");
  });

  it("출처가 하나도 없으면 연결 안내와 [계량·고지서](OPERATOR+)", async () => {
    eneState(app.gateway.m2).sources = [];
    const o = await operator();
    const page = await o.get("/energy");
    expect(page.body).toContain("에너지 출처를 연결하세요");
    expect(page.body).toContain('href="/energy/meters"');
  });
});

describe("ENE-01.04 UI-ENE-04 기준선 탭", () => {
  it("범위 공간에 [현황]·[기준선] 탭, VIEWER는 결과·버전만(계산·적용 없음)", async () => {
    const v = await viewer();
    const dash = await v.get("/energy?scope=2");
    expect(dash.body).toContain('href="/energy?scope=2&amp;tab=baseline"');
    const page = await v.get("/energy?scope=2&tab=baseline");
    expect(page.response.status).toBe(200);
    expect(page.body).toContain("적용 중: 기간 평균 · 2026-03-01 ~ 2026-05-31 · R² 0.820");
    expect(page.body).toContain('data-version="701"');
    expect(page.body).toContain("적합도 낮음(R² &lt; 0.5)");
    expect(page.body).not.toContain('value="createBaseline"');
    expect(page.body).not.toContain('value="activateBaseline"');
    const portfolio = await v.get("/energy");
    expect(portfolio.body).not.toContain("tab=baseline");
  });

  it("계산: 30일보다 짧으면 \"N일 더 필요\", 회귀는 기온 원천 필수, 맞으면 TRAINING 버전으로 이동 → READY 버전 [적용]", async () => {
    const i = await integrator();
    const page = await i.get("/energy?scope=2&tab=baseline&version=702");
    expect(page.body).toContain('value="createBaseline"');
    expect(page.body).toContain('data-version="702"');
    expect(page.body).toContain(`value="2026-07-06"`);
    expect(page.body).toContain(`value="2026-10-03"`);
    const base = { intent: "createBaseline", method: "PERIOD_AVERAGE", trainFrom: "2026-09-01", trainTo: "2026-09-25", coolingBaseC: "24", heatingBaseC: "18", splitWeekday: "true", temperatureDeviceId: "", temperatureMetricKey: "temperature" };
    const short = await i.post("/energy?scope=2&tab=baseline", base);
    expect(short.response.status).toBe(409);
    expect(short.body).toContain("학습 기간이 짧습니다. 5일 더 필요합니다(최소 30일)");
    const noTemp = await i.post("/energy?scope=2&tab=baseline", { ...base, method: "DEGREE_DAY_REGRESSION", trainFrom: "2026-07-01", trainTo: "2026-09-30" });
    expect(noTemp.response.status).toBe(400);
    expect(noTemp.body).toContain("필수 입력입니다");
    const ok = await i.post("/energy?scope=2&tab=baseline", { ...base, method: "DEGREE_DAY_REGRESSION", trainFrom: "2026-07-01", trainTo: "2026-09-30", temperatureDeviceId: "1001" });
    expect(ok.response.status).toBe(302);
    const s = eneState(app.gateway.m2);
    expect(s.lastBaselineRequest).toMatchObject({ scopeSpaceId: "2", method: "DEGREE_DAY_REGRESSION", params: { coolingBaseC: 24, heatingBaseC: 18, splitWeekday: true }, temperatureSource: { deviceId: "1001", metricKey: "temperature" } });
    expect(ok.response.headers.get("location")).toBe(`/energy?scope=2&tab=baseline&version=${s.versions[0].versionId}`);
    const training = await i.get(ok.response.headers.get("location")!);
    expect(training.body).toContain("계산 중입니다. 잠시 뒤 새로 고치세요");

    const notReady = await i.post("/energy?scope=2&tab=baseline", { intent: "activateBaseline", versionId: String(s.versions[0].versionId) });
    expect(notReady.response.status).toBe(409);
    expect(notReady.body).toContain("계산이 끝난(준비됨) 버전만 적용할 수 있습니다");
    const activated = await i.post("/energy?scope=2&tab=baseline", { intent: "activateBaseline", versionId: "702" });
    expect(activated.response.status).toBe(302);
    expect(s.versions.find((x) => x.versionId === "701")!.status).toBe("RETIRED");
    expect(s.baselines[0].activeVersionId).toBe("702");
  });
});
