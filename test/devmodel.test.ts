/**
 * M5 기기·모델 데이터 관리 SSR + BFF 통합(UI-DEV-19 검색식·저장된 검색, UI-DEV-08 모델 가져오기·내보내기, UI-DEV-20 표준 형식 내보내기,
 * UI-DEV-10 게이트웨이, UI-DEV-09 표시 단위): DEV-13.03, DEV-03.04, DEV-13.04, DEV-05.02, DEV-04.04.
 * 가짜 gateway: test/msw/handlers/devmodel.ts(core M5 컨트롤러 모양).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TestBrowser, startApp, type AppContext } from "./app-harness";
import { devModelState } from "./msw/handlers/devmodel";

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
const operator = () => as("kim.op", "Correct-Horse-9");
const integrator = () => as("lee.int", "Integrator-Pass1");
const viewer = () => as("view.er", "Viewer-Pass-123");

function json(browser: TestBrowser, path: string, method: string, body?: unknown) {
  return browser.request(path, { method, headers: { "Content-Type": "application/json", "X-CSRF-TOKEN": browser.csrf }, body: body === undefined ? undefined : JSON.stringify(body) });
}
const parse = (body: string) => JSON.parse(body) as { header: { resultCode: string }; response: Record<string, unknown>; responses?: Record<string, unknown>[] };
const state = () => devModelState(app.gateway.m2);
const devicesWith = (q: string) => `/devices?${new URLSearchParams({ q })}`;

describe("DEV-13.03 UI-DEV-19 기기 검색식과 저장된 검색", () => {
  it("TC-DEV-317 AT-DEV-25.2: `battery < ` 검색 → 400 DEVICE_QUERY_INVALID를 오류 화면 대신 입력란에 열 11과 함께 보인다", async () => {
    const browser = await viewer();
    const page = await browser.get(devicesWith("battery < "));
    expect(page.response.status).toBe(200);
    expect(page.body).toContain('aria-invalid="true"');
    expect(page.body).toMatch(/11열: /);
    expect(page.body).toContain('role="alert"');
    // 목록은 비어 있고 다른 기기는 보이지 않는다
    expect(page.body).not.toContain("AM107-067999");
  });

  it("TC-DEV-317 TC-DEV-313: 검색식 실행 → 맞는 기기만, 결과 수와 소요 시간(counts{total, tookMs}) 표시", async () => {
    const browser = await viewer();
    const page = await browser.get(devicesWith('model = "AM107" and battery < 95 and space in "3층"'));
    expect(page.response.status).toBe(200);
    expect(page.body).toContain("AM107-067999");
    expect(page.body).not.toContain("EM300-TH-151606");
    expect(page.body).toContain("1대 · 84ms");
    const sent = app.gateway.received.map((r) => r.path).find((p) => p.startsWith("/api/v1/core/devices?") && p.includes("battery"));
    expect(new URL(`http://gw${sent}`).searchParams.get("q")).toBe('model = "AM107" and battery < 95 and space in "3층"');
  });

  it("TC-DEV-314: 검색 시간 초과(DEVICE_QUERY_TIMEOUT)도 입력란 오류로, 키워드 검색은 기존 목록 필터 그대로", async () => {
    const browser = await viewer();
    const slow = await browser.get(devicesWith('name ~ "slow"'));
    expect(slow.response.status).toBe(200);
    expect(slow.body).toContain("검색이 5초 안에 끝나지 않았습니다");
    const keyword = await browser.get("/devices?q=AM107");
    expect(keyword.body).toContain("AM107-067999");
    expect(keyword.body).not.toMatch(/\d+대 · \d+ms/);
  });

  it("TC-DEV-314 AT-DEV-25.3: 저장된 검색 목록(공유) 표시, OPERATOR(DEV_PLACE)는 저장·삭제, VIEWER는 저장 403", async () => {
    const view = await viewer();
    const page = await view.get("/devices");
    expect(page.body).toContain("배터리 부족 · 공유");
    expect(page.body).not.toContain(">검색 저장<");
    const denied = await json(view, "/bff/api/core/saved-searches", "POST", { name: "x", query: "battery < 10", shared: false });
    expect(denied.response.status).toBe(403);

    const op = await operator();
    expect((await op.get("/devices")).body).toContain(">검색 저장<");
    const created = await json(op, "/bff/api/core/saved-searches", "POST", { name: "3층 배터리", query: 'space in "3층" and battery < 30', shared: false });
    expect(created.response.status).toBe(201);
    expect(created.response.headers.get("location")).toMatch(/^\/bff\/api\/core\/saved-searches\/\d+$/);
    const id = String(parse(created.body).response.id);
    const picked = await op.get(`/devices?${new URLSearchParams({ q: 'space in "3층" and battery < 30', saved: id })}`);
    expect(picked.body).toContain("3층 배터리");
    expect(picked.body).toContain(">저장된 검색 삭제<");
    expect((await json(op, `/bff/api/core/saved-searches/${id}`, "DELETE")).response.status).toBe(204);
    expect(state().saved.map((s) => s.id)).not.toContain(id);
  });
});

describe("DEV-03.04 UI-DEV-08 모델 가져오기·내보내기(data2flow·DTDL)", () => {
  it("TC-DEV-112 TC-DEV-109: 모델 상세에 [내보내기] 두 형식(VIEWER도), 목록 [가져오기]는 INTEGRATOR만", async () => {
    const view = await viewer();
    const detail = await view.get("/models/EM300-TH");
    expect(detail.body).toContain("내보내기(data2flow)");
    expect(detail.body).toContain("내보내기(DTDL)");
    expect((await view.get("/models")).body).not.toContain(">가져오기<");
    expect((await (await integrator()).get("/models")).body).toContain(">가져오기<");

    const dtdl = await view.get("/bff/api/core/device-models/11/export?format=dtdl");
    expect(dtdl.response.status).toBe(200);
    expect(parse(dtdl.body).response["@context"]).toBe("dtmi:dtdl:context;3");
  });

  it("TC-DEV-109: multipart 가져오기가 BFF를 그대로 지난다 — 미리 보기(dryRun) 200, 가져오기 201 + Location은 BFF 주소, 같은 코드 다시 409", async () => {
    const browser = await integrator();
    const file = new File([JSON.stringify({ format: "data2flow", model: { code: "VIB-01", name: "진동 센서" } })], "vib.json", { type: "application/json" });
    const form = () => {
      const f = new FormData();
      f.set("file", file);
      f.set("format", "data2flow");
      f.set("createMissingMetrics", "true");
      return f;
    };
    const dry = form();
    dry.set("dryRun", "true");
    const preview = await browser.request("/bff/api/core/device-models/import", { method: "POST", headers: { "X-CSRF-TOKEN": browser.csrf }, body: dry });
    expect(preview.response.status).toBe(200);
    expect(parse(preview.body).response).toMatchObject({ dryRun: true, model: null, createdMetrics: ["vibration"] });
    expect(state().imports[0]).toMatchObject({ dryRun: true, format: "data2flow", createMissingMetrics: "true", fileName: "vib.json" });

    const real = form();
    real.set("dryRun", "false");
    const created = await browser.request("/bff/api/core/device-models/import", { method: "POST", headers: { "X-CSRF-TOKEN": browser.csrf }, body: real });
    expect(created.response.status).toBe(201);
    expect((parse(created.body).response.model as { code: string }).code).toBe("VIB-01");
    const again = await browser.request("/bff/api/core/device-models/import", { method: "POST", headers: { "X-CSRF-TOKEN": browser.csrf }, body: form() });
    expect(again.response.status).toBe(409);
    expect(parse(again.body).header.resultCode).toBe("MODEL_CODE_DUPLICATE");
  });
});

describe("DEV-13.04 UI-DEV-20 표준 형식 내보내기", () => {
  it("TC-DEV-322 TC-DEV-319: INTEGRATOR 내보내기 202 → 작업 DONE(보고서·downloadUrl) → 파일은 BFF가 Content-Disposition과 함께 중계, OPERATOR 403", async () => {
    const browser = await integrator();
    const started = await json(browser, "/bff/api/core/devices/export-standard", "POST", { format: "NGSI_LD", scope: { spaceIds: [], deviceIds: ["1042", "1050"] }, includeValues: true });
    expect(started.response.status).toBe(202);
    const jobId = String(parse(started.body).response.jobId);
    const job = parse((await browser.get(`/bff/api/core/export-jobs/${jobId}`)).body).response as { status: string; downloadUrl: string; report: { skipped: unknown[] } };
    expect(job.status).toBe("DONE");
    expect(job.report.skipped).toHaveLength(1);
    const file = await browser.get(`/bff/api/core/export-jobs/${jobId}/file`);
    expect(file.response.status).toBe(200);
    expect(file.response.headers.get("content-type")).toContain("application/ld+json");
    expect(file.response.headers.get("content-disposition")).toContain(`data2flow-ngsi_ld-${jobId}.jsonld`);

    const op = await operator();
    expect((await json(op, "/bff/api/core/devices/export-standard", "POST", { format: "DTDL", scope: { spaceIds: ["3"], deviceIds: [] }, includeValues: false })).response.status).toBe(403);
    // 기기 목록에 공간을 거르면 INTEGRATOR에게 [표준 형식 내보내기]가 보인다
    expect((await browser.get("/devices?spaceId=3")).body).toContain(">표준 형식 내보내기<");
    expect((await op.get("/devices?spaceId=3")).body).not.toContain(">표준 형식 내보내기<");
  });
});

describe("DEV-05.02 UI-DEV-10 게이트웨이", () => {
  it("TC-DEV-155 TC-DEV-151: 목록(연결 상태 글자·24시간 수신 기기 수), 상세(기기별 평균 rssi·snr·최적 경로 비율 표, 분포 차트)", async () => {
    const browser = await viewer();
    const list = await browser.get("/gateways");
    expect(list.response.status).toBe(200);
    expect(list.body).toContain("UG65-F79304");
    expect(list.body).toContain("24e124fffef5dccc");
    expect(list.body).toContain("온라인");
    expect(list.body).toContain("오프라인");
    expect(list.body).toContain("9대");
    const offline = await browser.get("/gateways?status=OFFLINE");
    expect(offline.body).not.toContain("UG65-F79304");

    const detail = await browser.get("/gateways/71?period=7d");
    expect(detail.response.status).toBe(200);
    expect(detail.body).toContain("수신 기기 2대");
    expect(detail.body).toContain("-33.0");
    expect(detail.body).toContain("9.5");
    expect(detail.body).toContain("62%");
    expect(detail.body).toContain('aria-label="RSSI 분포"');
    const stats = app.gateway.received.find((r) => r.path.startsWith("/api/v1/core/gateways/71/stats?"));
    const params = new URL(`http://gw${stats?.path}`).searchParams;
    expect(Date.parse(params.get("to") as string) - Date.parse(params.get("from") as string)).toBe(7 * 86_400_000);
    // VIEWER에게는 편집 폼이 없다
    expect(detail.body).not.toContain('name="offlineAfterSec"');
  });

  it("TC-DEV-152: INTEGRATOR가 이름·오프라인 기준을 고친다(60~86400초 검사 후 PATCH)", async () => {
    const browser = await integrator();
    await browser.get("/gateways/71");
    const bad = await browser.post("/gateways/71", { name: "UG65", spaceId: "", offlineAfterSec: "30" });
    expect(bad.response.status).toBe(400);
    expect(bad.body).toContain("60~86400초 사이로 적어 주세요");
    const saved = await browser.post("/gateways/71", { name: "본관 3층 GW", spaceId: "3", offlineAfterSec: "600" });
    expect(saved.response.status).toBe(200);
    expect(state().gateways[0]).toMatchObject({ name: "본관 3층 GW", offlineAfterSec: 600 });
  });
});

describe("DEV-04.04 단위 체계 변환 표시(℃ ↔ ℉)", () => {
  it("TC-DEV-145 TC-DEV-140: ADMIN이 조직 단위를 ℉로 → 기기 현재값 22.3℃가 72.1℉로 보이고 저장값은 그대로, ADMIN 외에는 설정 폼이 없다", async () => {
    const op = await operator();
    const metrics = await op.get("/metrics");
    expect(metrics.body).toContain("표시 단위");
    expect(metrics.body).not.toContain('name="temperatureUnit"');

    const browser = await admin();
    await browser.get("/metrics");
    const saved = await browser.post("/metrics?tab=verified", { intent: "units", temperatureUnit: "F", baseVersion: "1" });
    expect(saved.response.status).toBe(200);
    expect(state().orgTemperatureUnit).toBe("F");
    const device = await op.get("/devices/1042");
    expect(device.body).toContain("72.1℉");
    expect(device.body).not.toContain("22.3℃");
    expect(device.body).toContain("44.5%");
    expect(app.gateway.m2.devices[0].latest[0]).toMatchObject({ value: 22.3, unit: "℃" });
  });

  it("TC-DEV-145: 사용자 설정(내 정보 > 프로필)이 조직 기본보다 앞선다 — ℉ 조직에서 본인만 ℃", async () => {
    state().orgTemperatureUnit = "F";
    const op = await operator();
    const profile = await op.get("/me/profile");
    expect(profile.body).toContain("내 온도 표시 단위");
    const saved = await op.post("/me/profile", { intent: "temperatureUnit", temperatureUnit: "C", baseVersion: "1" });
    expect(saved.response.status).toBe(200);
    expect((await op.get("/devices/1042")).body).toContain("22.3℃");
    expect((await (await viewer()).get("/devices/1042")).body).toContain("72.1℉");
  });
});
