/**
 * 플로우 화면 테스트 도구: React Flow용 jsdom 스텁(ResizeObserver·DOMMatrixReadOnly), 가짜 FlowApi, 편집기 렌더.
 */
import { screen } from "@testing-library/react";
import { vi } from "vitest";
import type { EditorFactory } from "~/components/code-editor";
import type { Me } from "~/lib/api-types";
import type { SpaceNode } from "~/lib/spaces";
import { meOf, renderRoute } from "../../../../test/render";
import type { FlowApi } from "../api";
import { FlowEditor, type FlowEditorProps } from "../flow-editor";
import { createFlowGraph, catalogOf, toDefinition } from "../model/flow-graph";
import type { FlowDetail, FlowGraph } from "../model/types";
import { M3_NODE_TYPES } from "../model/__tests__/catalog-fixture";
import { fakeSockets } from "./fake-socket";

export function stubReactFlowDom() {
  class RO {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal("ResizeObserver", RO);
  class Matrix {
    m22 = 1;
    constructor() {}
  }
  vi.stubGlobal("DOMMatrixReadOnly", Matrix);
}

export const catalog = catalogOf(M3_NODE_TYPES);

/** 테스트에서 Monaco 대신 textarea */
export const textareaFactory: EditorFactory = async () => null;

export const SPACES: SpaceNode[] = [
  { id: "3", type: "FLOOR", name: "3층", children: [{ id: "31", parentId: "3", type: "ROOM", name: "실습실", children: [] }, { id: "90", parentId: "3", type: "ROOM", name: "데모 강의실", children: [], ...({ virtual: true } as object) }] },
];

export function coolingGraph(spaceId = "31"): FlowGraph {
  return createFlowGraph(catalog)
    .node("trigger.telemetry", "n-trg00001", { target: { spaceId, relation: "measures" }, metrics: ["temperature"] })
    .node("transform.aggregate", "n-agg00001", { window: "PT5M", fn: "avg" })
    .node("condition.threshold", "n-thr00001", { metric: "temperature", op: ">", value: 27, for: "PT5M", clear: 26 })
    .node("action.control", "n-act00001", { target: { spaceId, relation: "controls" }, capability: "Thermostat", command: "set", args: { mode: "cool", targetTemperature: 24 } })
    .wire("n-trg00001", "out", "n-agg00001")
    .wire("n-agg00001", "out", "n-thr00001")
    .wire("n-thr00001", "true", "n-act00001")
    .build();
}

export function detailOf(graph: FlowGraph, overrides: Partial<FlowDetail["flow"]> = {}, validation: FlowDetail["version"]["validation"] = { errors: [], warnings: [] }): FlowDetail {
  const flow = { flowId: "f-7f3a", name: "고온이면 냉방", status: "DRAFT" as const, activeVersion: null, draftVersion: 1, ...overrides };
  return { flow, version: { version: flow.draftVersion ?? flow.activeVersion ?? 1, state: flow.draftVersion ? "DRAFT" : "ACTIVE", definition: toDefinition(graph), validation }, applyStatus: null, editors: [], emergencyStop: { active: false } };
}

const okr = <T,>(data: T, status = 200) => Promise.resolve({ ok: true as const, status, data });

export function fakeApi(overrides: Partial<FlowApi> = {}): FlowApi {
  return {
    create: vi.fn(() => okr({ flowId: "f-new", draftVersion: 1, validation: { errors: [], warnings: [] } }, 201)),
    rename: vi.fn(() => okr({ flowId: "f-7f3a", name: "x" })),
    saveDraft: vi.fn((_id: string, body: { baseVersion: number }) => okr({ flowId: "f-7f3a", draftVersion: body.baseVersion + 1, validation: { errors: [], warnings: [] } })),
    validate: vi.fn(() => okr({ errors: [], warnings: [], changeSummary: { added: [], removed: [], changed: [] }, risky: { controlNodesChanged: false, executionModeChanged: false }, approvalRequired: false })),
    apply: vi.fn(() => okr({ appliedVersion: 2, applyStatus: { targetVersion: 2, converged: true } })),
    versions: vi.fn(() => okr({ responses: [{ version: 14, state: "ACTIVE", appliedBy: { userId: "7", name: "김운영" }, appliedAt: "2026-10-03T02:02:00Z", memo: "기준 온도 상향" }, { version: 13, state: "ARCHIVED", appliedBy: { userId: "7", name: "김운영" }, appliedAt: "2026-10-03T00:40:00Z", memo: "변환 노드 추가" }], totalCount: 2 })),
    diff: vi.fn(() => okr({ added: ["n-agg00001"], removed: [], changed: [{ nodeId: "n-thr00001", fields: ["config.value"] }] })),
    rollback: vi.fn(() => okr({ appliedVersion: 13, applyStatus: { targetVersion: 13, converged: false, instances: [] } })),
    metrics: vi.fn(() => okr({ summary: { executions: 0, errors: 0, errorRate: 0 }, nodes: [] })),
    capabilities: vi.fn(() => okr({ responses: [{ name: "Thermostat" }, { name: "Switch" }] })),
    capability: vi.fn((name: string) =>
      okr(
        name === "Thermostat"
          ? { name, attributes: [{ name: "mode", type: "enum", enum: ["off", "cool", "heat"] }, { name: "targetTemperature", type: "number", unit: "°C", min: 5, max: 35, step: 0.5 }, { name: "currentTemperature", type: "number", readOnly: true }], commands: [{ name: "set", sets: ["mode", "targetTemperature"] }] }
          : { name, attributes: [{ name: "on", type: "boolean" }], commands: [{ name: "set" }] },
      ),
    ),
    testRun: vi.fn(() => okr({ trace: { messageId: "m-test", version: 14, steps: [], result: "COMPLETED" } })),
    replay: vi.fn(() => okr({ jobId: "rp-1" }, 202)),
    replayJob: vi.fn(() => okr({ status: "SUCCEEDED" as const, progress: { processed: 10, total: 10 }, result: { executions: 10, branchCounts: {}, actions: { command: 0, notify: 0, sink: 0 }, errors: 0 } })),
    trace: vi.fn(() => okr({ messageId: "m-1", version: 13, steps: [], result: "COMPLETED" })),
    overlay: vi.fn((_id: string, body: { revision: number }) => okr({ revision: body.revision + 1 })),
    shadow: vi.fn(() => Promise.resolve({ ok: false as const, status: 404, code: "RESOURCE_NOT_FOUND", message: "" })),
    startShadow: vi.fn(() => okr({ status: "RUNNING" })),
    endShadow: vi.fn(() => okr({}, 204)),
    updateSettings: vi.fn((id: string, patch: object) => okr({ flowId: id, ...patch })),
    variables: vi.fn(() => okr({ responses: [], totalCount: 0 })),
    resetVariable: vi.fn(() => okr({}, 204)),
    rawMessages: vi.fn(() => okr({ responses: [] })),
    ...overrides,
  } as FlowApi;
}

export async function renderEditor(props: Partial<FlowEditorProps> & { role?: string; session?: Me } = {}) {
  const { role = "INTEGRATOR", session, ...rest } = props;
  const me = session ?? meOf(role);
  const api = rest.api ?? fakeApi();
  // 라이브 뷰·편집 참여는 가짜 WebSocket(frontend.md §3.4)
  const sockets = fakeSockets();
  const all: FlowEditorProps = {
    detail: null,
    nodeTypes: M3_NODE_TYPES,
    spaces: SPACES,
    devices: [{ id: "1042", name: "AM107-067999", spaceId: "31", modelId: "12", tags: ["pilot"] }],
    models: [{ id: "12", name: "AM107" }],
    metricKeys: ["temperature", "co2"],
    metrics: null,
    canWrite: me.permissions.includes("FLOW_WRITE"),
    canDeployControl: me.permissions.includes("FLOW_DEPLOY_CONTROL"),
    timezone: "Asia/Seoul",
    onCreated: vi.fn(),
    onReload: vi.fn(),
    editorFactory: textareaFactory,
    socketFactory: sockets.create,
    me: { userId: me.id, name: me.name ?? me.loginId },
    ...rest,
    api,
  };
  const view = await renderRoute(<FlowEditor {...all} />, { session: me });
  // root 로더가 끝나 편집기가 그려질 때까지(그 뒤에 라이브 연결이 열린다)
  await screen.findByRole("tablist", { name: "하단 패널" });
  return { ...view, props: all, api, sockets };
}
