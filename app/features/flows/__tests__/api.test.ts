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
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
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
