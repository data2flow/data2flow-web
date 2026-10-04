/**
 * M5 브라우저 API 묶음의 경로·메서드·멱등 키(design/api/SCR-api.md API-SCR-10~14·18~22, ING-api.md API-ING-09·10·12·14, core 컨트롤러 경로)
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { qualityApi, reprocessApi } from "~/features/ingest/m5-api";
import { scriptApi } from "../api";
import { formulaApi, moduleApi, scriptOpsApi } from "../m5-api";

afterEach(() => vi.unstubAllGlobals());

function capture() {
  const calls: { url: string; method: string; body: unknown; key: string | null }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      const headers = new Headers(init.headers);
      calls.push({ url, method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : undefined, key: headers.get("Idempotency-Key") });
      return new Response(JSON.stringify({ header: { isSuccessful: true, resultCode: "SUCCESS" }, response: {} }), { status: 200, headers: { "Content-Type": "application/json" } });
    }),
  );
  return calls;
}

describe("M5 BFF 경로(SCR-03.03·03.05·04.01·04.02·01.06·05.01·05.02, ING-01.04·06.02)", () => {
  it("스크립트 운영·테스트 케이스·모듈·수식", async () => {
    const calls = capture();
    const body = { name: "c", input: {}, expected: {}, compareMode: "EXACT" as const };
    await scriptOpsApi.listCases("5");
    await scriptOpsApi.createCase("5", body);
    await scriptOpsApi.updateCase("5", "1", body);
    await scriptOpsApi.deleteCase("5", "1");
    await scriptOpsApi.runCases("5", {});
    await scriptOpsApi.stats("5", { from: "a", to: "b", step: "1m" });
    await scriptOpsApi.errors("5");
    await scriptOpsApi.logCapture("5", true);
    await scriptOpsApi.logs("5");
    await scriptOpsApi.saveConfig("5", { config: { a: 1 }, baseVersion: 2 });
    await scriptApi.runCases!("5", { versionId: "9" });
    await scriptApi.saveCase!("5", body);
    await moduleApi.create({ name: "m-1", code: "" });
    await moduleApi.save("3", { name: "m-1", code: "" });
    await moduleApi.release("3");
    await moduleApi.deleteVersion("3", 2);
    await moduleApi.usage("3");
    const formula = { resultKey: "thi", displayName: "x", expression: "1", targetType: "MODEL" as const, targetId: "1", status: "ACTIVE" as const };
    await formulaApi.create(formula);
    await formulaApi.update("4", formula);
    await formulaApi.remove("4");
    await formulaApi.preview({ expression: "1", targetType: "MODEL", targetId: "1", hours: 24 });
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      "GET /bff/api/core/scripts/5/test-cases",
      "POST /bff/api/core/scripts/5/test-cases",
      "PUT /bff/api/core/scripts/5/test-cases/1",
      "DELETE /bff/api/core/scripts/5/test-cases/1",
      "POST /bff/api/core/scripts/5/test-cases/run",
      "GET /bff/api/core/scripts/5/stats?from=a&to=b&step=1m",
      "GET /bff/api/core/scripts/5/errors?page=1&size=100",
      "POST /bff/api/core/scripts/5/log-capture",
      "GET /bff/api/core/scripts/5/logs?page=1&size=100",
      "PUT /bff/api/core/scripts/5/config",
      "POST /bff/api/core/scripts/5/test-cases/run",
      "POST /bff/api/core/scripts/5/test-cases",
      "POST /bff/api/core/script-modules",
      "PUT /bff/api/core/script-modules/3",
      "POST /bff/api/core/script-modules/3/release",
      "DELETE /bff/api/core/script-modules/3/versions/2",
      "GET /bff/api/core/script-modules/3/usage",
      "POST /bff/api/core/formula-metrics",
      "PUT /bff/api/core/formula-metrics/4",
      "DELETE /bff/api/core/formula-metrics/4",
      "POST /bff/api/core/formula-metrics/preview",
    ]);
    expect(calls[14].key).toBeTruthy();
    expect(calls[7].body).toEqual({ enabled: true });
  });

  it("재처리·품질: 생성은 Idempotency-Key, 취소도 멱등 키", async () => {
    const calls = capture();
    const body = { sourceId: 7, from: "a", to: "b" };
    await reprocessApi.preview(body);
    await reprocessApi.create(body, "k-1");
    await reprocessApi.cancel("12");
    await reprocessApi.list();
    await qualityApi.trend({ groupBy: "device", targetId: "1", from: "2026-09-04", to: "2026-10-03" });
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      "POST /bff/api/core/ingest/reprocess-jobs/preview",
      "POST /bff/api/core/ingest/reprocess-jobs",
      "POST /bff/api/core/ingest/reprocess-jobs/12/cancel",
      "GET /bff/api/core/ingest/reprocess-jobs?page=1&size=20",
      "GET /bff/api/core/ingest/quality/trend?groupBy=device&targetId=1&from=2026-09-04&to=2026-10-03",
    ]);
    expect(calls[1].key).toBe("k-1");
    expect(calls[2].key).toBeTruthy();
  });
});
