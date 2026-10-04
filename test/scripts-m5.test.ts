/**
 * M5 스크립트·수집 화면 SSR + BFF 통합: UI-SCR-02 M5 탭(테스트 케이스 UI-SCR-04, 설정, 운영 UI-SCR-05), 공유 모듈 UI-SCR-06, 수식 항목 UI-SCR-07,
 * 재처리 UI-ING-05(ING-01.04, SCR-03.06), 데이터 품질 UI-ING-06(ING-06.02).
 * 가짜 gateway: test/msw/handlers/scripts-m5.ts(core ScriptM5Controller·IngestController·IngestInsightController 모양).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TestBrowser, startApp, type AppContext } from "./app-harness";
import { m5State } from "./msw/handlers/scripts-m5";

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
const analyst = () => as("ana.lyst", "Analyst-Pass-123");
const viewer = () => as("view.er", "Viewer-Pass-123");

function json(browser: TestBrowser, path: string, method: string, body?: unknown, headers: Record<string, string> = {}) {
  return browser.request(path, { method, headers: { "Content-Type": "application/json", "X-CSRF-TOKEN": browser.csrf, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
}
const parse = (body: string) => JSON.parse(body) as { header: { resultCode: string }; response: Record<string, unknown>; responses?: Record<string, unknown>[] };
const state = () => m5State(app.gateway.m2);

describe("SCR-03.03·04.02·03.05 UI-SCR-02 M5 탭", () => {
  it("TC-SCR-049 테스트 케이스 탭: 저장된 케이스·비교 방식, 탭 목록(테스트 케이스 n·설정·운영)", async () => {
    const browser = await integrator();
    const page = await browser.get("/scripts/501?tab=tests");
    expect(page.response.status).toBe(200);
    expect(page.body).toContain("테스트 케이스 0");
    expect(page.body).toContain("설정");
    expect(page.body).toContain("운영");
    expect(page.body).toContain("공유 모듈");
    expect(page.body).toContain("수식 항목");
  });

  it("TC-SCR-047~049 BFF 중계: 케이스 생성 201·이름 중복 400 errors[name]·일괄 실행 결과, OPERATOR 쓰기 403", async () => {
    const browser = await integrator();
    await browser.get("/scripts/501");
    const created = await json(browser, "/bff/api/core/scripts/501/test-cases", "POST", { name: "온도 없음", input: {}, expected: {}, compareMode: "EXACT" });
    expect(created.response.status).toBe(201);
    const dup = await json(browser, "/bff/api/core/scripts/501/test-cases", "POST", { name: "온도 없음", input: {}, expected: {}, compareMode: "EXACT" });
    expect(dup.response.status).toBe(400);
    const run = await json(browser, "/bff/api/core/scripts/501/test-cases/run", "POST", {});
    expect(parse(run.body).response).toMatchObject({ passed: 1, failed: 1 });
    const op = await operator();
    await op.get("/scripts/501");
    expect((await json(op, "/bff/api/core/scripts/501/test-cases/run", "POST", {})).response.status).toBe(403);
    expect((await op.request("/bff/api/core/scripts/501/test-cases")).response.status).toBe(200);
  });

  it("TC-SCR-070 TC-SCR-071 설정 탭: 현재 설정값, PUT config(baseVersion) 성공·비밀값 400·충돌 409", async () => {
    const browser = await integrator();
    const page = await browser.get("/scripts/501?tab=config");
    expect(page.body).toContain("설정값(ctx.config)");
    expect(page.body).toContain('value="tempOffset"');
    const saved = await json(browser, "/bff/api/core/scripts/501/config", "PUT", { config: { tempOffset: 0.7 }, baseVersion: 7 });
    expect(parse(saved.body).response).toMatchObject({ config: { tempOffset: 0.7 }, version: 8 });
    expect(parse((await json(browser, "/bff/api/core/scripts/501/config", "PUT", { config: { apiToken: "x" }, baseVersion: 8 })).body).header.resultCode).toBe("SCRIPT_CONFIG_SECRET_FORBIDDEN");
    expect((await json(browser, "/bff/api/core/scripts/501/config", "PUT", { config: {}, baseVersion: 1 })).response.status).toBe(409);
  });

  it("TC-SCR-060 TC-SCR-080~083 운영 탭: 지표·오류(입력 원문은 SCRIPT_WRITE만)·로그 수집 중계", async () => {
    const browser = await integrator();
    const page = await browser.get("/scripts/501?tab=ops");
    expect(page.response.status).toBe(200);
    expect(page.body).toContain("운영 지표");
    const stats = await browser.request("/bff/api/core/scripts/501/stats?from=2026-10-03T00%3A00%3A00Z&to=2026-10-04T00%3A00%3A00Z&step=1m");
    expect(parse(stats.body).response.warnings).toEqual([{ type: "SLOW", value: 25, hints: ["LARGE_INPUT"] }]);
    const errors = parse((await browser.request("/bff/api/core/scripts/501/errors?page=1&size=100")).body);
    expect(errors.responses?.[0]).toHaveProperty("inputSnapshot");
    const capture = await json(browser, "/bff/api/core/scripts/501/log-capture", "POST", { enabled: true });
    expect(parse(capture.body).response).toEqual({ enabled: true, until: "2026-10-04T00:30:00Z" });
    const op = await operator();
    expect(parse((await op.request("/bff/api/core/scripts/501/errors?page=1&size=100")).body).responses?.[0]).not.toHaveProperty("inputSnapshot");
  });
});

describe("SCR-04.01 UI-SCR-06 공유 모듈", () => {
  it("TC-SCR-069 목록·편집기 SSR, 생성·버전 배포·사용 중 버전 삭제 409 중계", async () => {
    const browser = await integrator();
    const list = await browser.get("/scripts/modules");
    expect(list.response.status).toBe(200);
    expect(list.body).toContain("milesight-channels");
    expect(list.body).toContain("2개");
    expect(list.body).toContain("새 모듈");
    const detail = await browser.get("/scripts/modules/3");
    expect(detail.body).toContain("import { … } from &#x27;module:milesight-channels@1&#x27;;");
    const created = await json(browser, "/bff/api/core/script-modules", "POST", { name: "ab-c", code: "export const A = 1;" });
    expect(created.response.status).toBe(201);
    const release = await json(browser, "/bff/api/core/script-modules/3/release", "POST", undefined, { "Idempotency-Key": "k1" });
    expect(parse(release.body).response).toMatchObject({ versionNo: 2 });
    const inUse = await json(browser, "/bff/api/core/script-modules/3/versions/1", "DELETE");
    expect(parse(inUse.body).header.resultCode).toBe("SCRIPT_MODULE_IN_USE");
    expect((await browser.get("/scripts/modules/999")).response.status).toBe(404);
  });

  it("OPERATOR는 목록만(새 모듈 없음), VIEWER는 403", async () => {
    const op = await operator();
    const page = await op.get("/scripts/modules");
    expect(page.response.status).toBe(200);
    expect(page.body).not.toContain("새 모듈");
    expect((await (await viewer()).get("/scripts/modules")).response.status).toBe(403);
  });
});

describe("SCR-01.06 UI-SCR-07 수식 항목", () => {
  it("TC-SCR-015~019 목록 SSR(결과 키·수식·대상), 미리 보기·생성·키 충돌 409 중계", async () => {
    const browser = await integrator();
    const page = await browser.get("/scripts/formulas");
    expect(page.response.status).toBe(200);
    expect(page.body).toContain("thi(temperature, humidity)");
    expect(page.body).toContain("불쾌지수");
    expect(page.body).toContain("새 수식");
    const preview = await json(browser, "/bff/api/core/formula-metrics/preview", "POST", { expression: "thi(temperature, humidity)", targetType: "MODEL", targetId: "11", hours: 24 });
    expect(parse(preview.body).response.series).toEqual([{ t: "2026-10-03T23:00:00Z", value: 71.2 }]);
    const created = await json(browser, "/bff/api/core/formula-metrics", "POST", { resultKey: "co2_10m", displayName: "CO2 10분", expression: "rolling_mean(co2, 10m)", targetType: "SPACE", targetId: "1", status: "ACTIVE" });
    expect(created.response.status).toBe(201);
    const conflict = await json(browser, "/bff/api/core/formula-metrics", "POST", { resultKey: "temperature", displayName: "x", expression: "1", targetType: "MODEL", targetId: "11", status: "ACTIVE" });
    expect(parse(conflict.body).header.resultCode).toBe("SCRIPT_FORMULA_KEY_CONFLICT");
  });

  it("OPERATOR는 조회만(새 수식 없음)", async () => {
    const page = await (await operator()).get("/scripts/formulas");
    expect(page.response.status).toBe(200);
    expect(page.body).toContain("thi(temperature, humidity)");
    expect(page.body).not.toContain("새 수식");
  });
});

describe("ING-01.04 SCR-03.06 UI-ING-05 재처리", () => {
  it("TC-ING-029 TC-ING-030 INTEGRATOR: 작업 목록(진행률), 미리 채움(배포 후 재처리), 미리 보기·생성(Idempotency-Key 202)·같은 소스 실행 중 409·취소 중계", async () => {
    const browser = await integrator();
    const page = await browser.get("/ingest/reprocess?sourceId=7&deviceIds=11,x&from=2026-09-27T00%3A00%3A00Z&to=2026-10-04T00%3A00%3A00Z&memo=v5%20%EB%B0%B0%ED%8F%AC");
    expect(page.response.status).toBe(200);
    expect(page.body).toContain("RJ-12");
    expect(page.body).toContain("62.9%");
    expect(page.body).toContain('value="v5 배포"');
    expect(page.body).toContain('value="2026-09-27T09:00"');
    expect(page.body).toContain("기기 1대");
    const body = { sourceId: 8, from: "2026-09-27T00:00:00Z", to: "2026-10-04T00:00:00Z" };
    expect(parse((await json(browser, "/bff/api/core/ingest/reprocess-jobs/preview", "POST", body)).body).response.total).toBe(102330);
    const created = await json(browser, "/bff/api/core/ingest/reprocess-jobs", "POST", body, { "Idempotency-Key": "reprocess-1" });
    expect(created.response.status).toBe(202);
    expect(state().received.find((r) => r.path === "/ingest/reprocess-jobs" && r.method === "POST")?.headers["idempotency-key"]).toBe("reprocess-1");
    const running = await json(browser, "/bff/api/core/ingest/reprocess-jobs", "POST", { ...body, sourceId: 7 }, { "Idempotency-Key": "reprocess-2" });
    expect(parse(running.body).header.resultCode).toBe("ING_REPROCESS_ALREADY_RUNNING");
    expect(parse((await json(browser, "/bff/api/core/ingest/reprocess-jobs/12/cancel", "POST", undefined, { "Idempotency-Key": "c1" })).body).response.status).toBe("CANCELLED");
    expect(parse((await json(browser, "/bff/api/core/ingest/reprocess-jobs/12/cancel", "POST", undefined, { "Idempotency-Key": "c2" })).body).header.resultCode).toBe("ING_REPROCESS_NOT_CANCELLABLE");
  });

  it("OPERATOR는 화면 403(INGEST_REPROCESS 없음), 수집 구역 탭에 재처리 없음", async () => {
    const op = await operator();
    expect((await op.get("/ingest/reprocess")).response.status).toBe(403);
    const monitor = await op.get("/ingest/failures");
    expect(monitor.body).not.toContain('href="/ingest/reprocess"');
    expect(monitor.body).toContain('href="/ingest/quality"');
  });
});

describe("ING-06.02 UI-ING-06 데이터 품질", () => {
  it("TC-ING-071 TC-ING-072 기본 어제 날짜·기기 묶음, 점수 오름차순과 문제 구간 링크, 최하위·분포, 필터 쿼리 전달", async () => {
    const browser = await operator();
    const page = await browser.get("/ingest/quality");
    expect(page.response.status).toBe(200);
    expect(page.body).toContain('value="2026-10-03"');
    expect(page.body.indexOf("AM103-081175")).toBeLessThan(page.body.indexOf("EM320-TH-389818"));
    expect(page.body).toContain('href="/devices/1?tab=chart&amp;highlight=gap,range"');
    expect(page.body).toContain("최하위 10개");
    expect(page.body).toContain("대상 2개 · 평균 점수 65");
    await browser.get("/ingest/quality?day=2026-10-01&groupBy=space&spaceId=1");
    expect(app.gateway.received.some((r) => r.path.startsWith("/api/v1/core/ingest/quality?") && r.path.includes("day=2026-10-01") && r.path.includes("groupBy=space") && r.path.includes("spaceId=1"))).toBe(true);
    const trend = await browser.request("/bff/api/core/ingest/quality/trend?groupBy=device&targetId=1&from=2026-09-04&to=2026-10-03");
    expect(parse(trend.body).response.points).toHaveLength(1);
  });

  it("ANALYST도 본다, 점수가 없으면 안내, VIEWER는 403", async () => {
    app.gateway.m2.extra["m5.qualityEmpty"] = true;
    const page = await (await analyst()).get("/ingest/quality?groupBy=bogus&day=bad");
    expect(page.response.status).toBe(200);
    expect(page.body).toContain("아직 계산된 품질 점수가 없습니다. 매일 00:30에 계산됩니다");
    expect((await (await viewer()).get("/ingest/quality")).response.status).toBe(403);
  });
});
