/**
 * M5 데이터 관리 화면 SSR + BFF 통합: UI-TSD-02 내보내기 작업, UI-TSD-08 정기 내보내기·데이터 사전, UI-TSD-03 가져오기, UI-TSD-04 보관 설정,
 * UI-OPS-01 저장 지표, UI-TSD-01 탐색기 [내보내기]·1년 기간. 가짜 gateway: test/msw/handlers/data.ts.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TestBrowser, startApp, type AppContext } from "./app-harness";
import { EXPORT_CSV, dataState } from "./msw/handlers/data";

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

function json(browser: TestBrowser, path: string, method: string, body: unknown) {
  return browser.request(path, { method, headers: { "Content-Type": "application/json", "X-CSRF-TOKEN": browser.csrf, "Idempotency-Key": "k-1" }, body: JSON.stringify(body) });
}
const parse = (body: string) => JSON.parse(body) as { header: { resultCode: string }; response: Record<string, unknown> };
const state = () => dataState(app.gateway.m2);

describe("TSD-04.01 UI-TSD-02 내보내기 작업", () => {
  it("TC-TSD-106 AT-TSD-04.4 ANALYST: 작업 목록·정기·사전 탭, VIEWER는 사전 탭만이고 내보내기 API 403", async () => {
    const page = await (await analyst()).get("/exports");
    expect(page.response.status).toBe(200);
    expect(page.body).toContain("내보내기 작업");
    expect(page.body).toContain("정기 내보내기");
    expect(page.body).toContain("30.0 MB");

    const v = await viewer();
    const viewerPage = await v.get("/exports?tab=jobs");
    expect(viewerPage.response.status).toBe(200);
    expect(viewerPage.body).toContain("데이터 사전 v4");
    expect(viewerPage.body).not.toContain('href="/exports?tab=schedules"');
    const denied = await json(v, "/bff/api/core/exports", "POST", { query: { series: [{ deviceId: "1042", metric: "temperature" }] }, format: "CSV" });
    expect(denied.response.status).toBe(403);
  });

  it("TC-TSD-108 1년치 CSV: 비동기 202 → 작업 목록, 완료 파일은 BFF가 서명 주소 그대로 흘려보낸다(UTF-8 BOM·머리)", async () => {
    const browser = await analyst();
    const created = await json(browser, "/bff/api/core/exports", "POST", {
      query: { series: [{ deviceId: "1042", metric: "temperature" }], from: "2025-10-04T00:00:00Z", to: "2026-10-04T00:00:00Z", resolution: "1m", tz: "Asia/Seoul" },
      format: "CSV",
      columns: "LONG",
      includeQuality: true,
      tz: "Asia/Seoul",
    });
    expect(created.response.status).toBe(202);
    expect(parse(created.body).response).toMatchObject({ mode: "ASYNC", estimatedRows: 1_576_800 });
    expect(created.response.headers.get("location")).toMatch(/^\/bff\/api\/core\/exports\/\d+$/);
    expect(state().exports[0].status).toBe("QUEUED");

    const file = await browser.get("/bff/api/core/exports/71/file?expires=1760000000&signature=ab");
    expect(file.response.status).toBe(200);
    expect(file.response.headers.get("content-disposition")).toContain("export-71.csv");
    // TestBrowser는 본문을 글자로 읽으며 BOM을 떼므로 BOM 뒤 내용을 비교한다(BOM 자체는 core가 붙인다)
    expect(file.body).toBe(EXPORT_CSV.replace(/^\uFEFF/, ""));
    expect(file.body.startsWith("time,device_id,device_name,space_path,metric,value,unit,quality")).toBe(true);
  });

  it("TC-TSD-075 진행 중 3개면 429 EXPORT_LIMIT_EXCEEDED, [취소]는 API-TSD-22", async () => {
    const browser = await analyst();
    for (let i = 0; i < 3; i += 1) state().exports.unshift({ id: `9${i}`, status: "RUNNING", format: "CSV", query: {}, createdAt: "2026-10-04T00:00:00Z" });
    const limited = await json(browser, "/bff/api/core/exports", "POST", { query: { series: [{ deviceId: "1042", metric: "co2" }], from: "2025-01-01T00:00:00Z", to: "2026-01-01T00:00:00Z" } });
    expect(limited.response.status).toBe(429);
    expect(parse(limited.body).header.resultCode).toBe("EXPORT_LIMIT_EXCEEDED");
    const cancelled = await json(browser, "/bff/api/core/exports/90/cancel", "POST", {});
    expect(parse(cancelled.body).response.status).toBe("CANCELLED");
  });
});

describe("TSD-04.03 정기 내보내기 메일 링크 /data/exports/{jobId}", () => {
  it("TC-TSD-164 ANALYST: 링크로 들어오면 그 작업 하나와 [다운로드]·[전체 작업 목록], 없는 작업은 404, VIEWER는 403", async () => {
    const ana = await analyst();
    const page = await ana.get("/data/exports/71");
    expect(page.response.status).toBe(200);
    expect(page.body).toContain("다운로드");
    expect(page.body).toContain("전체 작업 목록");
    expect((await ana.get("/data/exports/999")).response.status).toBe(404);
    const viewer = await as("view.er", "Viewer-Pass-123");
    expect((await viewer.get("/data/exports/71")).response.status).toBe(403);
  });
});

describe("TSD-04.03 TSD-07.02 TSD-07.04 UI-TSD-08", () => {
  it("TC-TSD-164 정기 내보내기 탭: 마지막 실행 실패 빨간 배지와 사유, BI 계정·피드 탭은 없다, PATCH는 baseVersion", async () => {
    const browser = await operator();
    const page = await browser.get("/exports?tab=schedules");
    expect(page.response.status).toBe(200);
    expect(page.body).toContain("주간 실내환경");
    expect(page.body).toContain("✖ 실패");
    expect(page.body).toContain("인증 실패");
    expect(page.body).toContain("매주 월요일 02:00");
    expect(page.body).not.toMatch(/BI 계정|피드/);
    const conflict = await json(browser, "/bff/api/core/export-schedules/5", "PATCH", { enabled: false, baseVersion: 1 });
    expect(conflict.response.status).toBe(409);
    const updated = await json(browser, "/bff/api/core/export-schedules/5", "PATCH", { enabled: false, baseVersion: 2 });
    expect(parse(updated.body).response).toMatchObject({ enabled: false, version: 3 });
  });

  it("TC-TSD-164 AT-TSD-19.1 데이터 사전: 판 번호·측정 항목·품질 코드·공간 계층, HTML 내려받기 중계", async () => {
    const browser = await viewer();
    const page = await browser.get("/exports?tab=dictionary");
    expect(page.body).toContain("데이터 사전 v4");
    expect(page.body).toContain("temperature");
    expect(page.body).toContain("미검증");
    expect(page.body).toContain("실습실");
    const html = await browser.get("/bff/api/core/data-dictionary?format=html&version=4");
    expect(html.response.headers.get("content-type")).toContain("text/html");
    expect(html.body).toContain("데이터 사전 v4");
  });
});

describe("TSD-04.02 UI-TSD-03 데이터 가져오기", () => {
  it("TC-TSD-112 INTEGRATOR: 목록·마법사·작업 상세(미리 실행 결과) → 실행 202, OPERATOR는 403", async () => {
    const browser = await integrator();
    const list = await browser.get("/imports");
    expect(list.response.status).toBe(200);
    expect(list.body).toContain("아카데미 iot-bucket 2026-09");
    expect(list.body).toContain("미리 실행 완료");
    expect((await browser.get("/imports/new")).body).toContain("출처 라벨");
    const detail = await browser.get("/imports/9");
    expect(detail.body).toContain("1,284,300");
    expect(detail.body).toContain("DEVICE_NOT_MAPPED");
    expect(detail.body).toContain("가져오기 실행");
    const run = await json(browser, "/bff/api/core/imports/9/run", "POST", {});
    expect(run.response.status).toBe(202);
    expect(parse(run.body).response.status).toBe("RUNNING");
    const again = await json(browser, "/bff/api/core/imports/9/run", "POST", {});
    expect(parse(again.body).header.resultCode).toBe("IMPORT_STATE_CONFLICT");
    expect((await browser.get("/imports/404")).response.status).toBe(404);

    const op = await operator();
    expect((await op.get("/imports")).response.status).toBe(403);
    expect((await op.get("/imports/new")).response.status).toBe(403);
  });

  it("TC-TSD-113 CSV multipart 업로드는 BFF를 거쳐 202(작업 ID로 이동)", async () => {
    const browser = await integrator();
    await browser.get("/imports/new");
    const form = new FormData();
    form.set("file", new File(["time,devEui,temperature\n2026-09-01T00:00:00Z,24e1,22\n"], "iot.csv", { type: "text/csv" }));
    form.set("mapping", JSON.stringify({ timeColumn: "time", deviceColumn: "devEui", metricColumns: [{ column: "temperature", metricKey: "temperature" }] }));
    form.set("originLabel", "아카데미 CSV");
    form.set("dryRun", "true");
    const response = await browser.request("/bff/api/core/imports", { method: "POST", headers: { "X-CSRF-TOKEN": browser.csrf }, body: form });
    expect(response.response.status).toBe(202);
    expect(parse(response.body).response).toMatchObject({ sourceKind: "CSV", status: "QUEUED" });
    expect(response.response.headers.get("location")).toMatch(/^\/bff\/api\/core\/imports\/\d+$/);
  });
});

describe("TSD-05.01 UI-TSD-04 데이터 보관 설정", () => {
  it("TC-TSD-124 TC-TSD-125 ADMIN: 조직 기본·재정의·저장 현황·장기 보관 파일, 미리 보기(단축) → 확인 토큰으로 저장", async () => {
    const browser = await admin();
    const page = await browser.get("/settings/data-retention");
    expect(page.response.status).toBe(200);
    expect(page.body).toContain("측정값 원본");
    expect(page.body).toContain("영향 미리 보기 후 저장");
    expect(page.body).toContain("telemetry_p2026_10");
    expect(page.body).toContain("50.0 MB");
    const items = state().effective.map((e) => ({ ...e }));
    items.push({ scope: "METRIC", scopeRef: "door", dataClass: "TELEMETRY", retainDays: 30, archiveBeforeDelete: false });
    const preview = await json(browser, "/bff/api/core/retention-policies/preview", "POST", { items });
    const body = parse(preview.body).response as { shortened: boolean; confirmToken: string; affectedRows: number };
    expect(body).toMatchObject({ shortened: true, affectedRows: 1_200_000 });
    const saved = await browser.request("/bff/api/core/retention-policies", { method: "PUT", headers: { "Content-Type": "application/json", "X-CSRF-TOKEN": browser.csrf }, body: JSON.stringify({ items, confirmToken: body.confirmToken }) });
    expect(parse(saved.body).response.appliesAt).toBe("2026-10-05T02:00:00Z");
  });

  it("권한별 노출: INTEGRATOR는 보기만(저장 버튼 없음), OPERATOR·VIEWER는 403", async () => {
    const page = await (await integrator()).get("/settings/data-retention");
    expect(page.response.status).toBe(200);
    expect(page.body).not.toContain("영향 미리 보기 후 저장");
    expect((await (await operator()).get("/settings/data-retention")).response.status).toBe(403);
    expect((await (await viewer()).get("/settings/data-retention")).response.status).toBe(403);
  });
});

describe("OPS-01.03 UI-OPS-01 저장 지표", () => {
  it("TC-OPS-013 ADMIN: DB 용량·상위 테이블·디스크 여유 19% 경고, 관리 메뉴에 시스템 상태·데이터 보관, INTEGRATOR는 403", async () => {
    const browser = await admin();
    const page = await browser.get("/admin/system");
    expect(page.response.status).toBe(200);
    expect(page.body).toContain("38.2 GB");
    expect(page.body).toContain("data2flow_pipeline.telemetry");
    expect(page.body).toContain("디스크 여유가 20% 미만입니다");
    expect(page.body).toContain('href="/admin/system"');
    expect(page.body).toContain('href="/settings/data-retention"');
    expect((await (await integrator()).get("/admin/system")).response.status).toBe(403);
  });
});

describe("TSD-03.03 TSD-04.01 데이터 탐색 [내보내기]·1년", () => {
  it("ANALYST는 [내보내기]·[내보내기 작업], VIEWER는 없음, 1년 기간 선택지", async () => {
    const q = `/explore?${new URLSearchParams({ q: JSON.stringify({ series: [{ kind: "device", id: "1042", metric: "temperature", label: "AM107 temperature" }], range: "1y" }) })}`;
    const page = await (await analyst()).get(q);
    expect(page.response.status).toBe(200);
    expect(page.body).toContain('href="/exports"');
    expect(page.body).toMatch(/<option value="1y" selected="">1년<\/option>/);
    const call = app.gateway.received.find((r) => r.path.startsWith("/api/v1/core/telemetry/series"));
    expect(new URL(`http://x${call?.path}`).searchParams.get("from")).toBe("2025-10-04T00:00:00Z");
    const viewerPage = await (await viewer()).get(q);
    expect(viewerPage.body).not.toContain('href="/exports"');
  });
});
