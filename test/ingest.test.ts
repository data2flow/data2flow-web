/**
 * 수집 모니터·실패 메시지 SSR + BFF 통합(UI-DSH-03, UI-ING-01, UI-ING-04): DSH-03.01~03.04, ING-07.03, OPS-01.02.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TestBrowser, startApp, type AppContext } from "./app-harness";
import { ingestState } from "./msw/handlers/ingest";

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
const viewer = () => as("view.er", "Viewer-Pass-123");

const navOf = (html: string) => /<nav aria-label="주 메뉴"[^>]*>(.*?)<\/nav>/s.exec(html)?.[1] ?? "";
const state = () => ingestState(app.gateway.m2);

describe("DSH-03.01 수집 흐름 다이어그램(UI-DSH-03)", () => {
  it("TC-DSH-021 AT-DSH-03.1 단계 6개와 처리/분·실패/분, 실패 단계 강조와 실패 목록 링크", async () => {
    const browser = await operator();
    const page = await browser.get("/ingest/monitor");
    expect(page.response.status).toBe(200);
    for (const stage of ["소스", "디코딩", "스크립트", "검증", "저장", "발행"]) expect(page.body).toContain(stage);
    expect(page.body).toContain("실패 12/분");
    expect(page.body).toMatch(/data-stage="SCRIPT" data-failing="true"/);
    expect(page.body).toContain('href="/ingest/failures?stage=SCRIPT&amp;code=SCRIPT_ERROR"');
    expect(page.body).toContain("갱신 0초 전");
    // 요약 카드(OPS-01.02)와 소스별 표
    expect(page.body).toContain("분당 수신");
    expect(page.body).toContain("12.4");
    expect(page.body).toContain('href="/sources/7"');
    expect(page.body).toContain("ingress 0.1s → raw 0.3s → telemetry 0.4s");
    const paths = app.gateway.received.map((r) => r.path);
    expect(paths).toContain("/api/v1/core/ingest/summary?window=1h");
    expect(paths).toContain("/api/v1/core/monitoring/ingest?window=1h");
    expect(paths.some((p) => p.startsWith("/api/v1/core/ingest/metrics?from=2026-10-03T23:00:00Z&to=2026-10-04T00:00:00Z&step=1m"))).toBe(true);
  });

  it("TC-DSH-025 24시간 전환은 window=24h로 다시 조회한다", async () => {
    const browser = await operator();
    const page = await browser.get("/ingest/monitor?window=24h");
    expect(page.body).toContain("소스별 처리량(24시간)");
    expect(app.gateway.received.some((r) => r.path === "/api/v1/core/monitoring/ingest?window=24h")).toBe(true);
    expect(app.gateway.received.some((r) => r.path.includes("step=5m"))).toBe(true);
  });

  it("UI-ING-01 경고가 있으면 카드 색과 원인 후보 띠, 지표 조회 실패는 화면을 유지하고 안내", async () => {
    Object.assign(state().summary, { alerts: [{ level: "CRITICAL", code: "INGEST_LAG_HIGH", message: "처리 지연 1분 초과", causeHints: ["DB 응답 지연(320ms)"] }] });
    state().metricsAvailable = false;
    const browser = await operator();
    const page = await browser.get("/ingest/monitor");
    expect(page.body).toMatch(/data-card="streamLagSec" data-tone="bad"/);
    expect(page.body).toContain("처리 지연 1분 초과");
    expect(page.body).toContain("원인 후보: DB 응답 지연(320ms)");
    expect(page.body).toContain("지표를 불러오지 못했습니다");
  });

  it("DSH-08.02 소스가 없으면 안내와 [데이터 소스 등록](SRC_ADMIN만)", async () => {
    Object.assign(state().snapshot, { sources: [] });
    Object.assign(state().summary, { sources: [] });
    const page = await (await integrator()).get("/ingest/monitor");
    expect(page.body).toContain("등록된 데이터 소스가 없습니다");
    expect(page.body).toContain('href="/sources/new"');
    const op = await (await operator()).get("/ingest/monitor");
    expect(op.body).not.toContain('href="/sources/new"');
    expect(op.body).toContain("관리자에게 요청");
  });

  it("TC-DSH-027 메시지 스트림 탭", async () => {
    const page = await (await operator()).get("/ingest/monitor?tab=stream&sourceId=7");
    expect(page.body).toContain("수집 메시지 스트림");
    expect(page.body).toContain("아직 받은 메시지가 없습니다.");
  });
});

describe("TC-DSH-023 AT-DSH-03.3 권한: 수집 모니터는 OPERATOR 이상", () => {
  it("VIEWER는 수집 메뉴가 없고 주소로 들어오면 403, OPERATOR는 메뉴가 있다", async () => {
    const v = await viewer();
    expect(navOf((await v.get("/")).body)).not.toContain("/ingest/monitor");
    const denied = await v.get("/ingest/monitor");
    expect(denied.response.status).toBe(403);
    expect((await v.get("/ingest/failures")).response.status).toBe(403);
    const o = await operator();
    expect(navOf((await o.get("/")).body)).toContain('href="/ingest/monitor"');
  });
});

describe("UI-ING-01 알람 기준(ADMIN, API-ING-04)", () => {
  it("ADMIN만 편집 폼, 경고 ≥ 위험이면 400과 안내, 맞으면 저장(baseVersion)", async () => {
    expect((await (await operator()).get("/ingest/monitor")).body).not.toContain("수집 알람 기준");
    const browser = await admin();
    const page = await browser.get("/ingest/monitor");
    expect(page.body).toContain("수집 알람 기준");
    const bad = await browser.post("/ingest/monitor", { lagWarnSec: "300", lagCriticalSec: "300", heartbeatCriticalSec: "120", baseVersion: "1" });
    expect(bad.response.status).toBe(400);
    expect(bad.body).toContain("경고 기준은 위험 기준보다 작아야 합니다");
    const saved = await browser.post("/ingest/monitor", { lagWarnSec: "30", lagCriticalSec: "300", heartbeatCriticalSec: "120", baseVersion: "1" });
    expect(saved.response.status).toBe(200);
    expect(saved.body).toContain("저장했습니다");
    expect(app.gateway.received.find((r) => r.method === "PUT")?.body).toEqual({ lagWarnSec: 30, lagCriticalSec: 300, heartbeatCriticalSec: 120, baseVersion: 1 });
    const conflict = await browser.post("/ingest/monitor", { lagWarnSec: "30", lagCriticalSec: "300", heartbeatCriticalSec: "120", baseVersion: "1" });
    expect(conflict.response.status).toBe(409);
  });
});

describe("ING-07.03 실패 메시지(UI-ING-04)", () => {
  it("TC-ING-090 단계 탭 건수, 사유별 묶음, 모니터 링크의 stage·code가 미리 적용된다", async () => {
    const browser = await operator();
    const page = await browser.get("/ingest/failures");
    expect(page.response.status).toBe(200);
    expect(page.body).toContain("ING_EXTERNAL_ID_MISSING");
    expect(page.body).toContain("SCRIPT_RUNTIME_ERROR");
    expect(page.body).toMatch(/디코딩<span[^>]*>3<\/span>/);
    expect(page.body).toMatch(/스크립트<span[^>]*>1<\/span>/);
    const scoped = await browser.get("/ingest/failures?stage=SCRIPT&code=SCRIPT_RUNTIME_ERROR");
    expect(scoped.body).not.toContain("ING_EXTERNAL_ID_MISSING");
    expect(scoped.body).toContain("Cannot read property");
    expect(app.gateway.received.some((r) => r.path.includes("groupBy=none") && r.path.includes("errorCode=SCRIPT_RUNTIME_ERROR") && r.path.includes("stage=SCRIPT"))).toBe(true);
    // OPERATOR는 재처리·폐기 버튼이 없다
    expect(scoped.body).not.toContain("선택 재처리");
    expect(scoped.body).not.toContain("묶음 전체 재처리");
  });

  it("TC-ING-090 AT-ING-07.1 INTEGRATOR 선택 재처리 → 결과 패널(성공·같은 오류), 멱등 키", async () => {
    const browser = await integrator();
    const page = await browser.get("/ingest/failures?code=ING_EXTERNAL_ID_MISSING");
    expect(page.body).toContain("선택 재처리");
    const key = /name="idempotencyKey" value="([^"]+)"/.exec(page.body)?.[1];
    const result = await browser.post("/ingest/failures?code=ING_EXTERNAL_ID_MISSING", { intent: "reprocess", idempotencyKey: key ?? "", dlqItemId: ["500", "501"] });
    expect(result.response.status).toBe(200);
    expect(result.body).toContain("재처리 결과");
    const sent = app.gateway.received.find((r) => r.path === "/api/v1/core/ingest/failures/reprocess");
    expect(sent?.body).toEqual({ dlqItemIds: ["500", "501"] });
    expect(sent?.headers["idempotency-key"]).toBe(key);
    expect(state().failures.filter((f) => f.status === "RESOLVED").map((f) => f.id)).toEqual(["500", "501"]);
  });

  it("묶음 전체 재처리: 같은 오류 코드의 열린 항목을 모아 보낸다, 잠긴 항목은 LOCKED", async () => {
    state().failures[2].lockedBy = "kim.op";
    const browser = await integrator();
    await browser.get("/ingest/failures");
    const result = await browser.post("/ingest/failures", { intent: "reprocess-group", errorCode: "ING_EXTERNAL_ID_MISSING", idempotencyKey: "k-1" });
    expect(result.body).toContain("잠김");
    expect(app.gateway.received.find((r) => r.path === "/api/v1/core/ingest/failures/reprocess")?.body).toEqual({ dlqItemIds: ["500", "501", "502"] });
  });

  it("AT-ING-07.2 폐기: 사유 2~200자 아니면 400 안내, 맞으면 폐기 건수", async () => {
    const browser = await integrator();
    await browser.get("/ingest/failures?code=SCRIPT_RUNTIME_ERROR");
    const bad = await browser.post("/ingest/failures?code=SCRIPT_RUNTIME_ERROR", { intent: "discard", reason: "x", dlqItemId: "510" });
    expect(bad.response.status).toBe(400);
    expect(bad.body).toContain("폐기 사유를 입력하세요");
    const done = await browser.post("/ingest/failures?code=SCRIPT_RUNTIME_ERROR", { intent: "discard", reason: "매핑 오류로 버림", dlqItemId: "510" });
    expect(done.body).toContain("1건을 폐기했습니다.");
    expect(state().failures.find((f) => f.id === "510")?.status).toBe("DISCARDED");
  });

  it("5,000건 초과 묶음은 버튼 비활성과 안내, 서버도 거부(ING_DLQ_BATCH_TOO_LARGE)", async () => {
    const many = Array.from({ length: 5001 }, (_, i) => ({ ...state().failures[0], id: String(10000 + i) }));
    state().failures.push(...many);
    const browser = await integrator();
    const page = await browser.get("/ingest/failures");
    expect(page.body).toContain("한 번에 최대 5,000건까지 재처리할 수 있습니다");
    const over = await browser.post("/ingest/failures", { intent: "reprocess", idempotencyKey: "k", dlqItemId: many.map((m) => m.id) });
    expect(over.response.status).toBe(400);
    expect(over.body).toContain("한 번에 최대 5,000건까지 재처리할 수 있습니다.");
  });

  it("OPERATOR가 재처리 API를 직접 부르면 403, 실패가 없으면 빈 화면 안내", async () => {
    const browser = await operator();
    await browser.get("/ingest/failures");
    const denied = await browser.post("/ingest/failures", { intent: "reprocess", idempotencyKey: "k", dlqItemId: "500" });
    expect(denied.response.status).toBe(403);
    state().failures.length = 0;
    expect((await browser.get("/ingest/failures")).body).toContain("실패한 메시지가 없습니다");
  });
});

describe("원본 메시지 API(API-ING-05·06) 계약 — 다른 화면이 함께 쓴다", () => {
  it("커서 목록·31일 초과 거부·payload는 INGEST_PAYLOAD_READ만", async () => {
    const op = await operator();
    await op.get("/");
    const list = await op.get("/bff/api/core/ingest/raw-messages?from=2026-10-03T00:00:00Z&to=2026-10-04T00:00:00Z&deviceId=1042&size=1");
    const body = JSON.parse(list.body);
    expect(body.responses).toHaveLength(1);
    expect(body.responses[0]).toMatchObject({ id: "8812345", deviceName: "AM107-067999", status: "OK" });
    expect(body.nextCursor).toBe("1");
    const tooLong = await op.get("/bff/api/core/ingest/raw-messages?from=2026-08-01T00:00:00Z&to=2026-10-04T00:00:00Z");
    expect(JSON.parse(tooLong.body).header.resultCode).toBe("ING_QUERY_RANGE_TOO_LARGE");
    expect(JSON.parse((await op.get("/bff/api/core/ingest/raw-messages/8812345")).body).response.payload).toBeUndefined();
    const int = await integrator();
    expect(JSON.parse((await int.get("/bff/api/core/ingest/raw-messages/8812345")).body).response.payload).toContain("temperature");
  });
});
