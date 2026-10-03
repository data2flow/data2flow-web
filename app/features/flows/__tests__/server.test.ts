import { describe, expect, it, vi } from "vitest";

vi.mock("~/bff/api.server", () => {
  const list = (responses: unknown[]) => ({ ok: true, status: 200, list: { header: {}, responses } });
  return {
    callApi: vi.fn(async (_c: unknown, _r: unknown, path: string) => (path.includes("/metrics") ? { ok: true, status: 200, data: { summary: { executions: 1, errors: 0, errorRate: 0 }, nodes: [] } } : { ok: true, status: 200, data: [{ id: "31", name: "실습실", type: "ROOM" }] })),
    callList: vi.fn(async (_c: unknown, _r: unknown, path: string) => {
      if (path.startsWith("/api/v1/core/flow-nodes")) return list([{ type: "trigger.telemetry" }]);
      if (path.includes("virtual=true")) return list([{ id: "2001", name: "AC-1", space: { id: "90" }, model: null }]);
      if (path.startsWith("/api/v1/core/devices")) return list([{ id: 1042, name: "AM107", space: { id: "31" }, model: { id: "12" }, tags: ["pilot"] }]);
      if (path.startsWith("/api/v1/core/device-models")) return list([{ id: 12, name: "AM107" }]);
      return { ok: false, status: 503, code: "SERVICE_UNAVAILABLE", message: "" };
    }),
    listOrThrow: (r: { list: unknown }) => r.list,
  };
});

describe("플로우 편집기 loader 공용", () => {
  it("카탈로그·공간·실제+가상 기기·모델, 실패한 보조 조회는 빈 값", async () => {
    const { loadEditorContext } = await import("../server");
    const result = await loadEditorContext({} as never, new Request("https://x/automation/flows/f1"), "f1");
    expect(result.nodeTypes).toHaveLength(1);
    expect(result.spaces[0].name).toBe("실습실");
    expect(result.devices).toEqual([
      { id: "1042", name: "AM107", spaceId: "31", modelId: "12", tags: ["pilot"] },
      { id: "2001", name: "AC-1", spaceId: "90", modelId: null, tags: [] },
    ]);
    expect(result.models).toEqual([{ id: "12", name: "AM107" }]);
    expect(result.metricKeys).toEqual([]);
    expect(result.metrics?.summary.executions).toBe(1);
    const fresh = await loadEditorContext({} as never, new Request("https://x/automation/flows/new"));
    expect(fresh.metrics).toBeNull();
  });
});
