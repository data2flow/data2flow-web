/** 승격 대상 매핑 loader 공용(UI-FLW-13, FLW-09.01): 내보내기 참조 모으기, 종류별 후보, 시나리오 목록 */
import { describe, expect, it, vi } from "vitest";

const fail = { ok: false, status: 503, code: "SERVICE_UNAVAILABLE", message: "" };

vi.mock("~/bff/api.server", () => {
  const list = (responses: unknown[]) => ({ ok: true, status: 200, list: { header: {}, responses } });
  return {
    callApi: vi.fn(async (_c: unknown, _r: unknown, path: string) => {
      if (path === "/api/v1/core/spaces") return { ok: true, status: 200, data: [{ id: 1, name: "캠퍼스", children: [{ id: 31, name: "실습실" }, { id: 90, name: "가상", virtual: true }] }] };
      if (path === "/api/v1/core/flows/f-1/export?version=5") return { ok: true, status: 200, data: { references: [{ kind: "SPACE", id: "v-31", name: "실습실" }, { kind: "DEVICE", id: 7, name: null }] } };
      if (path === "/api/v1/core/flows/f-2/export") return { ok: true, status: 200, data: {} };
      return fail;
    }),
    callList: vi.fn(async (_c: unknown, _r: unknown, path: string) => {
      if (path.startsWith("/api/v1/core/devices")) return list([{ id: 1042, name: "에어컨" }, { id: 2001, name: "가상 에어컨", virtual: true }]);
      if (path.startsWith("/api/v1/core/sink-connections")) return list([{ sinkConnectionId: "sc-1", name: "MySQL" }]);
      if (path.startsWith("/api/v1/core/scripts")) return list([{ id: "s1", name: "보정" }]);
      if (path.startsWith("/api/v1/core/sim/scenarios")) return list([{ scenarioId: 3, name: "폭염 오후", lastRun: { status: "PASSED" } }, { scenarioId: "4", name: "새" }]);
      return fail;
    }),
  };
});

describe("FLW-09.01 승격 대상 매핑 loader", () => {
  it("플로우 내보내기 참조를 모으고(실패한 플로우는 failed), 종류별 후보를 읽는다(가상 제외, 읽기 실패는 빈 목록)", async () => {
    const { loadCandidates, loadReferences, loadScenarios } = await import("../server");
    const refs = await loadReferences({} as never, new Request("https://x/"), [{ flowId: "f-1", version: 5 }, { flowId: "f-2" }, { flowId: "f-3", version: null }]);
    expect(refs.references).toEqual([
      { kind: "SPACE", id: "v-31", name: "실습실" },
      { kind: "DEVICE", id: "7", name: "7" },
    ]);
    expect(refs.failed).toEqual(["f-3"]);
    const candidates = await loadCandidates({} as never, new Request("https://x/"), new Set(["SPACE", "DEVICE", "SINK_CONNECTION", "NOTIFICATION_CHANNEL", "SCRIPT"]));
    expect(candidates).toEqual({
      SPACE: [
        { id: "1", name: "캠퍼스" },
        { id: "31", name: "실습실" },
      ],
      DEVICE: [{ id: "1042", name: "에어컨" }],
      SINK_CONNECTION: [{ id: "sc-1", name: "MySQL" }],
      NOTIFICATION_CHANNEL: [],
      SCRIPT: [{ id: "s1", name: "보정" }],
    });
    expect(await loadCandidates({} as never, new Request("https://x/"), new Set())).toEqual({});
    expect(await loadScenarios({} as never, new Request("https://x/"))).toEqual([
      { scenarioId: "3", name: "폭염 오후", lastRun: { status: "PASSED" } },
      { scenarioId: "4", name: "새", lastRun: null },
    ]);
  });
});
