import { describe, expect, it } from "vitest";
import { addNode, catalogOf, createFlowGraph, toDefinition, updateNode } from "../../model/flow-graph";
import type { FlowDetail } from "../../model/types";
import { M3_NODE_TYPES } from "../../model/__tests__/catalog-fixture";
import { applyBlockReason, combinedValidation, editorReducer, graphOf, initialState, isDirty, nodeBadges, redoable, undoable } from "../flow-editor-store";

const catalog = catalogOf(M3_NODE_TYPES);

function detail(): FlowDetail {
  const graph = createFlowGraph(catalog)
    .node("trigger.telemetry", "n-trigger01", { target: { spaceId: "31" }, metrics: ["temperature"] })
    .node("condition.threshold", "n-thresh01", { metric: "temperature", op: ">", value: 27 })
    .node("debug.log", "n-debug001")
    .wire("n-trigger01", "out", "n-thresh01")
    .wire("n-thresh01", "true", "n-debug001")
    .build();
  return {
    flow: { flowId: "f-1", name: "고온이면 냉방", status: "ACTIVE", activeVersion: 13, draftVersion: null },
    version: { version: 13, state: "ACTIVE", definition: toDefinition(graph), validation: { errors: [], warnings: [] } },
  };
}

describe("FLW-01.02 TC-FLW-007 AT-FLW-02.2 검증 결과 → 노드 배지·적용 비활성 사유·저장 후 dirty=false", () => {
  it("FLOW_VALIDATION_FAILED 상세(CYCLE a,b · UNCONNECTED c)를 노드별 오류 배지로", () => {
    let state = initialState(detail());
    state = editorReducer(state, { type: "server", result: { errors: [{ code: "CYCLE", nodeIds: ["n-trigger01", "n-thresh01"] }, { code: "UNCONNECTED", nodeIds: ["n-debug001"] }], warnings: [{ code: "TARGET_MISSING", nodeId: "n-debug001" }] } });
    const validation = combinedValidation(state, catalog);
    const badges = nodeBadges(validation);
    expect(badges.get("n-trigger01")).toEqual({ errors: ["CYCLE"], warnings: [] });
    expect(badges.get("n-debug001")).toEqual({ errors: ["UNCONNECTED"], warnings: ["TARGET_MISSING"] });
    // 저장된 초안이 없는 ACTIVE 플로우
    expect(applyBlockReason(state, validation, true)).toBe("noChanges");
    state = editorReducer(state, { type: "saved", flowId: "f-1", draftVersion: 14, validation: { errors: [{ code: "CYCLE", nodeIds: ["n-trigger01", "n-thresh01"] }], warnings: [] } });
    expect(applyBlockReason(state, combinedValidation(state, catalog), true)).toBe("errors");
    state = editorReducer(state, { type: "server", result: null });
    expect(applyBlockReason(state, combinedValidation(state, catalog), true)).toBeNull();
    expect(applyBlockReason(state, combinedValidation(state, catalog), false)).toBe("readOnly");
    expect(applyBlockReason(editorReducer(state, { type: "busy", busy: "applying" }), { errors: [], warnings: [] }, true)).toBe("busy");
    expect(applyBlockReason(initialState(null), { errors: [], warnings: [] }, true)).toBe("empty");
  });

  it("편집하면 dirty, 저장하면 dirty=false·baseVersion은 새 초안 버전", () => {
    let state = initialState(detail());
    expect(state.baseVersion).toBe(13);
    expect(isDirty(state)).toBe(false);
    state = editorReducer(state, { type: "change", graph: updateNode(graphOf(state), "n-thresh01", { config: { metric: "temperature" } }) });
    expect(isDirty(state)).toBe(true);
    // op 미입력(core 카탈로그 필수): 화면 검증 INVALID_CONFIG → 적용 막힘(저장은 가능)
    expect(combinedValidation(state, catalog).errors).toEqual([{ code: "INVALID_CONFIG", nodeId: "n-thresh01", path: "op", message: "required" }]);
    expect(applyBlockReason(state, combinedValidation(state, catalog), true)).toBe("unsaved");
    state = editorReducer(state, { type: "saved", flowId: "f-1", draftVersion: 14, validation: null });
    expect(isDirty(state)).toBe(false);
    expect(state.baseVersion).toBe(14);
    expect(applyBlockReason(state, combinedValidation(state, catalog), true)).toBe("errors");
    state = editorReducer(state, { type: "rename", name: "다른 이름" });
    expect(isDirty(state)).toBe(true);
  });

  it("실행 취소·다시 실행, 선택·복사·붙여넣기, 위치 교체는 이력 밖, 없어진 노드의 서버 오류는 버림", () => {
    let state = initialState(detail());
    const added = addNode(graphOf(state), "debug.log", catalog, { id: "n-debug002" });
    state = editorReducer(state, { type: "change", graph: added.graph, select: ["n-debug002"] });
    expect(undoable(state)).toBe(true);
    state = editorReducer(state, { type: "undo" });
    expect(graphOf(state).nodes).toHaveLength(3);
    expect(redoable(state)).toBe(true);
    state = editorReducer(state, { type: "redo" });
    expect(graphOf(state).nodes).toHaveLength(4);
    state = editorReducer(state, { type: "paste" });
    expect(graphOf(state).nodes).toHaveLength(4);
    state = editorReducer(state, { type: "select", ids: [] });
    expect(editorReducer(state, { type: "copy" })).toBe(state);
    state = editorReducer(state, { type: "select", ids: ["n-thresh01", "n-debug001"] });
    state = editorReducer(state, { type: "copy" });
    state = editorReducer(state, { type: "paste" });
    expect(graphOf(state).nodes).toHaveLength(6);
    expect(graphOf(state).wires).toHaveLength(3);
    expect(state.selected).toHaveLength(2);
    const before = state.history.past.length;
    state = editorReducer(state, { type: "replace", graph: { ...graphOf(state), nodes: graphOf(state).nodes.slice(0, 5) } });
    expect(state.history.past.length).toBe(before);
    state = editorReducer(state, { type: "server", result: { errors: [{ code: "UNCONNECTED", nodeId: "n-gone0001" }], warnings: [] } });
    expect(combinedValidation(state, catalog).errors.some((e) => e.nodeId === "n-gone0001")).toBe(false);
    state = editorReducer(state, { type: "diff", diff: { added: ["n-debug002"], removed: [], changed: [] } });
    expect(state.diff?.added).toEqual(["n-debug002"]);
    state = editorReducer(state, { type: "load", detail: null, name: "새 플로우" });
    expect(state.name).toBe("새 플로우");
    expect(state.flowId).toBeNull();
    // change에서 지워진 노드는 선택에서도 빠진다
    state = editorReducer(state, { type: "select", ids: ["n-x"] });
    state = editorReducer(state, { type: "change", graph: graphOf(state) });
    expect(state.selected).toEqual([]);
  });
});
