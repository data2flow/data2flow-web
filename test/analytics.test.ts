/**
 * M6 분석·AI 화면 SSR + BFF 통합: UI-ANA-01~06(갤러리·설명서·마법사·목록·결과·모델), API-ANA-16 상태 스트림 중계,
 * API-AIA-01 해설 스트림 중계, UI-IAM-10 토큰·서비스 계정, UI-AIA-06·07, 대시보드 고정(API-DSH-08). 가짜 gateway: test/msw/handlers/analytics.ts·ai.ts.
 */
import { HttpResponse, http } from "msw";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TestBrowser, startApp, type AppContext } from "./app-harness";
import { GATEWAY } from "./msw/fake-gateway";
import { aiState } from "./msw/handlers/ai";
import { m6State } from "./msw/handlers/analytics";

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
const analyst = () => as("ana.lyst", "Analyst-Pass-123");
const viewer = () => as("view.er", "Viewer-Pass-123");

function json(browser: TestBrowser, path: string, method: string, body: unknown, headers: Record<string, string> = {}) {
  return browser.request(path, { method, headers: { "Content-Type": "application/json", "X-CSRF-TOKEN": browser.csrf, ...headers }, body: JSON.stringify(body) });
}

describe("ANA-01.01 UI-ANA-01 갤러리·UI-ANA-02 설명서 SSR", () => {
  it("TC-ANA-006 AT-ANA-01.1 VIEWER는 카드만, ANALYST는 [이 템플릿으로 분석]과 분석 메뉴", async () => {
    const v = await viewer();
    const page = await v.get("/analytics/templates");
    expect(page.response.status).toBe(200);
    expect(page.body).toContain("쾌적도 분석");
    expect(page.body).toContain("센서 건강 진단");
    expect(page.body).not.toContain("이 템플릿으로 분석");
    expect(page.body).toContain('href="/analytics/templates"');
    expect((await v.get("/analytics/new?template=anomaly-detect")).response.status).toBe(403);
    expect((await v.get("/analytics/models")).response.status).toBe(403);

    const a = await analyst();
    const mine = await a.get("/analytics/templates");
    expect(mine.body).toContain('href="/analytics/new?template=anomaly-detect"');
    const guide = await a.get("/analytics/templates/anomaly-detect");
    expect(guide.response.status).toBe(200);
    expect(guide.body).toContain("빨간 점은 단발 이상입니다");
    expect((await a.get("/analytics/templates/nope")).response.status).toBe(404);
  });

  it("TC-ANA-033 질문으로 찾기·실행 가능성은 BFF로 core API-ANA-03·04를 부른다", async () => {
    const a = await analyst();
    const search = await a.get(`/bff/api/core/analytics/templates?keyword=${encodeURIComponent("센서")}&size=100`);
    expect(JSON.parse(search.body).responses.map((t: { key: string }) => t.key)).toEqual(["sensor-health"]);
    const runnable = await a.get("/bff/api/core/analytics/templates?view=runnable&spaceId=31&size=100");
    expect(JSON.parse(runnable.body).responses.find((t: { key: string }) => t.key === "sensor-health").runnable).toBe(false);
  });
});

describe("ANA-03 UI-ANA-03 마법사·UI-ANA-04 목록 SSR", () => {
  it("AT-ANA-02.1 마법사는 템플릿을 서버에서 읽어 그린다, 템플릿이 없으면 갤러리 안내", async () => {
    const a = await analyst();
    const page = await a.get("/analytics/new?template=anomaly-detect");
    expect(page.response.status).toBe(200);
    expect(page.body).toContain("새 분석: 이상 탐지");
    const none = await a.get("/analytics/new");
    expect(none.body).toContain("갤러리에서 템플릿을 먼저 고르세요.");
    const missing = await a.get("/analytics/new?template=nope");
    expect(missing.body).toContain("분석 템플릿을 찾을 수 없습니다.");
  });

  it("API-ANA-06·08 저장 후 실행은 BFF로 중계되고 Location은 BFF 경로", async () => {
    const a = await analyst();
    const created = await json(a, "/bff/api/core/analytics/analyses", "POST", { name: "새 분석", templateKey: "anomaly-detect", bindings: [], period: { type: "RELATIVE", days: 14 } }, { "Idempotency-Key": "k-1" });
    expect(created.response.status).toBe(201);
    expect(created.response.headers.get("location")).toMatch(/^\/bff\/api\/core\/analytics\/analyses\/\d+$/);
    const id = JSON.parse(created.body).response.analysisId;
    const run = await json(a, `/bff/api/core/analytics/analyses/${id}/runs`, "POST", { acknowledgeWarnings: false }, { "Idempotency-Key": "k-2" });
    expect(run.response.status).toBe(202);
    expect(JSON.parse(run.body).response.status).toBe("QUEUED");
  });

  it("UI-ANA-04 목록(내 것)과 실행 없는 분석은 [지금 실행] 안내, 실행 있으면 최근 실행으로 이동", async () => {
    const a = await analyst();
    const list = await a.get("/analytics");
    expect(list.body).toContain("실습실 온도 이상 탐지");
    expect(list.body).toContain('href="/analytics/17/runs/129"');
    const empty = await a.get("/analytics/18?saved=1");
    expect(empty.body).toContain("분석을 저장했습니다.");
    expect(empty.body).toContain("지금 실행");
    const redirect = await a.get("/analytics/17");
    expect(redirect.response.status).toBe(302);
    expect(redirect.response.headers.get("location")).toBe("/analytics/17/runs/129");
  });
});

describe("ANA-05 UI-ANA-05 결과 SSR·스트림", () => {
  it("TC-ANA-115 결과·주의 문구·AI 해설 탭(AI 켜짐), 결과 읽는 법은 설명서에서", async () => {
    const a = await analyst();
    const page = await a.get("/analytics/17/runs/128");
    expect(page.response.status).toBe(200);
    expect(page.body).toContain("최근 14일 중 이상 12건");
    expect(page.body).toContain("이상은 평소와 다름이지 잘못됨이 아닙니다");
    expect(page.body).toContain("AI 해설");
    expect(page.body).toContain("빨간 점은 단발 이상입니다");
    expect(app.gateway.received.some((r) => r.path.startsWith("/api/v1/ai/commentaries?subjectType=ANALYSIS_RUN&subjectId=128"))).toBe(true);
  });

  it("TC-AIA-066 조직 AI가 꺼져 있으면 결과는 그대로, AI 해설 탭·버튼 없음", async () => {
    aiState(app.gateway.m2).enabled = false;
    const page = await (await analyst()).get("/analytics/17/runs/128");
    expect(page.response.status).toBe(200);
    expect(page.body).toContain("최근 14일 중 이상 12건");
    expect(page.body).not.toContain("AI 해설");
  });

  it("ANA-05.08 보관 기간이 지난 결과는 안내, 없는 실행은 404", async () => {
    const a = await analyst();
    const expired = await a.get("/analytics/17/runs/100");
    expect(expired.response.status).toBe(200);
    expect(expired.body).toContain("결과 보관 기간이 지났습니다.");
    expect((await a.get("/analytics/17/runs/999")).response.status).toBe(404);
  });

  it("TC-ANA-103 API-ANA-16 실행 상태 스트림은 /bff/stream/analytics/runs/{id}로 중계(세션 쿠키만, Bearer는 BFF)", async () => {
    const a = await analyst();
    app.server.use(http.get(`${GATEWAY}/api/v1/core/stream/analytics/runs/*`, () => new HttpResponse('event: run-status\ndata: {"runId":"129","status":"RUNNING","progress":70}\n\nevent: run-done\ndata: {"runId":"129","status":"SUCCEEDED"}\n\n', { headers: { "Content-Type": "text/event-stream" } })));
    const stream = await a.get("/bff/stream/analytics/runs/129");
    expect(stream.response.status).toBe(200);
    expect(stream.response.headers.get("content-type")).toContain("text/event-stream");
    expect(stream.body).toContain("event: run-done");
    expect((await a.get("/bff/stream/analytics/runs/abc")).response.status).toBe(404);
  });

  it("TC-ANA-124 API-AIA-01 해설 생성 스트림은 /bff/api/ai/commentaries POST로 중계되고, 제공자가 없으면 503 AI_PROVIDER_UNAVAILABLE", async () => {
    const a = await analyst();
    const res = await json(a, "/bff/api/ai/commentaries", "POST", { subjectType: "ANALYSIS_RUN", subjectId: "128", analysisId: "17", regenerate: false }, { Accept: "text/event-stream" });
    expect(res.response.status).toBe(200);
    expect(res.response.headers.get("content-type")).toContain("text/event-stream");
    expect(res.body).toContain("event:verification");
    expect(res.body).toContain("[12건](#result-table-anomalies)");
    aiState(app.gateway.m2).provider = "NONE";
    const none = await json(a, "/bff/api/ai/commentaries", "POST", { subjectType: "ANALYSIS_RUN", subjectId: "128", regenerate: true }, { Accept: "text/event-stream" });
    expect(none.response.status).toBe(503);
    expect(JSON.parse(none.body).header.resultCode).toBe("AI_PROVIDER_UNAVAILABLE");
  });

  it("TC-ANA-129 ANA-05.06 [대시보드에 고정]은 API-DSH-08로 중계, VIEWER는 403", async () => {
    const a = await analyst();
    const pinned = await json(a, "/bff/api/core/dashboards/5/widgets/pin-analysis", "POST", { analysisId: "17", chartId: "series" });
    expect(pinned.response.status).toBe(200);
    expect(JSON.parse(pinned.body).response).toMatchObject({ widgetId: "analysis-17" });
    expect(m6State(app.gateway.m2).pins).toEqual([{ dashboardId: "5", body: { analysisId: "17", chartId: "series" } }]);
    const denied = await json(await viewer(), "/bff/api/core/dashboards/5/widgets/pin-analysis", "POST", { analysisId: "17" });
    expect(denied.response.status).toBe(403);
  });

  it("UI-ANA-06 모델 관리(A 이상)", async () => {
    const page = await (await analyst()).get("/analytics/models");
    expect(page.response.status).toBe(200);
    expect(page.body).toContain("실습실 온도 이상 탐지");
  });
});

describe("IAM-05 UI-IAM-10 토큰·서비스 계정, UI-AIA-07 MCP, UI-AIA-06 AI 설정", () => {
  it("TC-IAM-158 내 정보 > API 토큰: 발급 권한이 있으면 [새 토큰], VIEWER는 발급 불가 안내", async () => {
    const a = await analyst();
    const page = await a.get("/me/tokens");
    expect(page.response.status).toBe(200);
    expect(page.body).toContain("노트북 Claude");
    expect(page.body).toContain("+ 새 토큰");
    expect(page.body).toContain('href="/me/tokens"');
    const v = await (await viewer()).get("/me/tokens");
    expect(v.body).toContain("이 역할은 토큰을 발급할 수 없습니다.");
  });

  it("TC-AIA-077 발급 원문은 응답 한 번(Cache-Control no-store), 쓰기 범위는 ANALYST 400·INTEGRATOR 승인 대기", async () => {
    const a = await analyst();
    const issued = await json(a, "/bff/api/core/api-tokens", "POST", { kind: "MCP", name: "새 MCP", scopes: ["read:telemetry"], spaceScope: [], expiresAt: "2026-12-31T23:59:59Z" });
    expect(issued.response.status).toBe(201);
    expect(issued.response.headers.get("cache-control")).toContain("no-store");
    expect(JSON.parse(issued.body).response.token).toMatch(/^data2flow_raw\d+SECRET$/);
    const list = await a.get("/me/tokens");
    expect(list.body).not.toContain("SECRET");
    const exceeded = await json(a, "/bff/api/core/api-tokens", "POST", { kind: "MCP", name: "쓰기", scopes: ["mcp:write"], expiresAt: "2026-12-31T23:59:59Z" });
    expect(JSON.parse(exceeded.body).header.resultCode).toBe("API_TOKEN_SCOPE_EXCEEDED");
    const i = await integrator();
    const pending = await json(i, "/bff/api/core/api-tokens", "POST", { kind: "API_KEY", name: "제어", scopes: ["control:devices"], expiresAt: "2026-12-31T23:59:59Z" });
    expect(JSON.parse(pending.body).response.status).toBe("PENDING_APPROVAL");
  });

  it("TC-IAM-160 관리 화면(ADMIN): 전체 토큰·승인 대기·서비스 계정 탭, 다른 역할은 403", async () => {
    const ad = await admin();
    const all = await ad.get("/admin/tokens");
    expect(all.response.status).toBe(200);
    expect(all.body).toContain("이통합");
    const pending = await ad.get("/admin/tokens?tab=pending");
    expect(pending.body).toContain("제어 키");
    expect(pending.body).toContain("승인");
    const accounts = await ad.get("/admin/tokens?tab=accounts");
    expect(accounts.body).toContain("BI 연동");
    const approve = await json(ad, "/bff/api/core/api-tokens/42/approve", "POST", {});
    expect(approve.response.status).toBe(204);
    expect((await (await analyst()).get("/admin/tokens")).response.status).toBe(403);
  });

  it("TC-AIA-087 /ai/mcp: 엔드포인트·도구 목록·내 MCP 토큰(kind=MCP), VIEWER는 403", async () => {
    const page = await (await analyst()).get("/ai/mcp");
    expect(page.response.status).toBe(200);
    expect(page.body).toContain("https://data2flow-mcp.java21.net/mcp");
    expect(page.body).toContain("query_telemetry");
    expect(page.body).toContain("노트북 Claude");
    expect(app.gateway.received.some((r) => r.path.includes("/api/v1/core/api-tokens?owner=me&amp;kind=MCP") || r.path.includes("/api/v1/core/api-tokens?owner=me&kind=MCP"))).toBe(true);
    expect((await (await viewer()).get("/ai/mcp")).response.status).toBe(403);
  });

  it("TC-AIA-065 /settings/ai(ADMIN): FAKE 제공자 띠, 사용량·평가 탭, 다른 역할은 403", async () => {
    const ad = await admin();
    const page = await ad.get("/settings/ai");
    expect(page.response.status).toBe(200);
    expect(page.body).toContain("시험용 가짜 제공자(FAKE)입니다");
    expect((await ad.get("/settings/ai?tab=usage")).response.status).toBe(200);
    expect((await ad.get("/settings/ai?tab=eval")).response.status).toBe(200);
    expect((await (await integrator()).get("/settings/ai")).response.status).toBe(403);
  });
});
