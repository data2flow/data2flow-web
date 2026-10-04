import { afterEach, describe, expect, it, vi } from "vitest";
import { flowApi } from "../api";

afterEach(() => vi.unstubAllGlobals());

describe("FLW API 클라이언트(BFF 경로·멱등 키)", () => {
  it("각 호출의 메서드·경로·본문", async () => {
    const calls: { url: string; method: string; body?: string; headers: Headers }[] = [];
    vi.stubGlobal("fetch", (url: string, init: RequestInit) => {
      calls.push({ url, method: init.method ?? "GET", body: init.body as string | undefined, headers: new Headers(init.headers) });
      return Promise.resolve(new Response(JSON.stringify({ header: { isSuccessful: true, resultCode: "SUCCESS" }, response: {} }), { status: 200 }));
    });
    const def = { schema: "data2flow.flow-definition/v1", nodes: [], wires: [] };
    await flowApi.create({ name: "a", definition: def });
    await flowApi.rename("f 1", "b");
    await flowApi.saveDraft("f1", { baseVersion: 3, definition: def });
    await flowApi.validate("f1", 4);
    await flowApi.apply("f1", { version: 4, baseVersion: 3, acknowledgedRisks: true });
    await flowApi.versions("f1");
    await flowApi.diff("f1", 3, 4);
    await flowApi.rollback("f1", { toVersion: 3 });
    await flowApi.metrics("f1", "1h");
    await flowApi.metrics("f1", "24h");
    await flowApi.capabilities();
    await flowApi.capability("Thermostat");
    // M4: 시험 실행·재생·추적·오버레이·섀도우·설정·변수·원본 메시지
    await flowApi.testRun("f1", { definition: def, input: { message: { deviceId: 1 } }, startNodeId: "n-js1" });
    await flowApi.replay("f1", { version: 4, from: "2026-10-01T00:00:00Z", to: "2026-10-02T00:00:00Z" });
    await flowApi.replayJob("rp 1");
    await flowApi.trace("f1", "m/1");
    await flowApi.overlay("f1", { bypass: ["n1"], debug: [], revision: 2 });
    await flowApi.shadow("f1");
    await flowApi.startShadow("f1", { version: 5, durationMinutes: 60 });
    await flowApi.endShadow("f1", "promote");
    await flowApi.updateSettings("f1", { purpose: "냉방" });
    await flowApi.variables("f1");
    await flowApi.resetVariable("f1", "last alert");
    await flowApi.rawMessages({ from: "2026-10-03T00:00:00Z", to: "2026-10-04T00:00:00Z", deviceIds: ["1042"] });
    await flowApi.createSubflow({ name: "s", description: "", definition: {}, fromFlow: { flowId: "f1", nodeIds: ["a"] } });
    await flowApi.subflow("sf 1");
    expect(calls.slice(12).map((c) => `${c.method} ${c.url}`)).toEqual([
      "POST /bff/api/core/flows/f1/test-run",
      "POST /bff/api/core/flows/f1/replay",
      "GET /bff/api/core/flow-replays/rp%201",
      "GET /bff/api/core/flows/f1/traces/m%2F1",
      "PUT /bff/api/core/flows/f1/overlay",
      "GET /bff/api/core/flows/f1/shadow",
      "POST /bff/api/core/flows/f1/shadow",
      "POST /bff/api/core/flows/f1/shadow/promote",
      "PATCH /bff/api/core/flows/f1",
      "GET /bff/api/core/flows/f1/variables",
      "POST /bff/api/core/flows/f1/variables/last%20alert/reset",
      "GET /bff/api/core/ingest/raw-messages?from=2026-10-03T00%3A00%3A00Z&to=2026-10-04T00%3A00%3A00Z&size=20&deviceId=1042",
      "POST /bff/api/core/subflows",
      "GET /bff/api/core/subflows/sf%201",
    ]);
    expect(JSON.parse(calls[12].body!)).toEqual({ definition: def, input: { message: { deviceId: 1 } }, startNodeId: "n-js1" });
    expect(calls[13].headers.get("Idempotency-Key")).toBeTruthy();
    expect(calls.slice(0, 12).map((c) => `${c.method} ${c.url}`)).toEqual([
      "POST /bff/api/core/flows",
      "PATCH /bff/api/core/flows/f%201",
      "PUT /bff/api/core/flows/f1/draft",
      "POST /bff/api/core/flows/f1/validate",
      "POST /bff/api/core/flows/f1/apply",
      "GET /bff/api/core/flows/f1/versions",
      "GET /bff/api/core/flows/f1/version-diff?from=3&to=4",
      "POST /bff/api/core/flows/f1/rollback",
      "GET /bff/api/core/flows/f1/metrics?window=1h&step=1m",
      "GET /bff/api/core/flows/f1/metrics?window=24h&step=1h",
      "GET /bff/api/core/capabilities?size=100",
      "GET /bff/api/core/capabilities/Thermostat",
    ]);
    expect(calls[0].headers.get("Idempotency-Key")).toBeTruthy();
    expect(calls[4].headers.get("Idempotency-Key")).toBeTruthy();
    expect(JSON.parse(calls[2].body!)).toEqual({ baseVersion: 3, definition: def });
  });
});
