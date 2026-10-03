import { describe, expect, it } from "vitest";
import { NODE_ID_PATTERN, addNode, alignToGrid, catalogOf, copySelection, createFlowGraph, emptyGraph, moveNodes, paste } from "../flow-graph";
import { HISTORY_LIMIT, canRedo, canUndo, history, record, redo, resetHistory, undo } from "../flow-graph-history";
import { M3_NODE_TYPES } from "./catalog-fixture";

const catalog = catalogOf(M3_NODE_TYPES);

describe("FLW-01.01 TC-FLW-006 실행 취소 50단계·복사 붙여넣기·정렬", () => {
  it("실행 취소·다시 실행은 50단계까지, 새 변경은 다시 실행 목록을 비운다", () => {
    let h = history(emptyGraph());
    for (let i = 0; i < 60; i += 1) h = record(h, addNode(h.present, "debug.log", catalog, { id: `n-node${String(i).padStart(4, "0")}` }).graph);
    expect(h.present.nodes).toHaveLength(60);
    expect(h.past).toHaveLength(HISTORY_LIMIT);
    for (let i = 0; i < 55; i += 1) h = undo(h);
    expect(h.present.nodes).toHaveLength(10);
    expect(canUndo(h)).toBe(false);
    h = redo(redo(h));
    expect(h.present.nodes).toHaveLength(12);
    expect(canRedo(h)).toBe(true);
    h = record(h, emptyGraph());
    expect(canRedo(h)).toBe(false);
    expect(redo(h)).toBe(h);
    expect(record(h, h.present)).toBe(h);
    expect(resetHistory(h.present).past).toEqual([]);
  });

  it("복사·붙여넣기: 새 n- ID, 선택 노드 사이의 와이어만 복제, 위치는 32px 옆", () => {
    const graph = createFlowGraph(catalog).node("trigger.telemetry", "n-trigger01").node("transform.aggregate", "n-agg00001").node("condition.threshold", "n-thresh01").wire("n-trigger01", "out", "n-agg00001").wire("n-agg00001", "out", "n-thresh01").build();
    const clip = copySelection(graph, ["n-agg00001", "n-thresh01"]);
    expect(clip.wires).toEqual([{ from: "n-agg00001", port: "out", to: "n-thresh01" }]);
    const result = paste(graph, clip);
    expect(result.ids).toHaveLength(2);
    for (const id of result.ids) {
      expect(id).toMatch(NODE_ID_PATTERN);
      expect(["n-agg00001", "n-thresh01"]).not.toContain(id);
    }
    expect(result.graph.nodes).toHaveLength(5);
    expect(result.graph.wires.at(-1)).toEqual({ from: result.ids[0], port: "out", to: result.ids[1] });
    const original = graph.nodes.find((n) => n.id === "n-agg00001")!;
    const copied = result.graph.nodes.find((n) => n.id === result.ids[0])!;
    expect(copied.position).toEqual({ x: original.position.x + 32, y: original.position.y + 32 });
    // 복사본 설정을 바꿔도 원본은 그대로(깊은 복사)
    (copied.config as Record<string, unknown>).fn = "max";
    expect(original.config.fn).toBe("avg");
  });

  it("전체 선택 이동 후 좌표를 16px 격자에 맞춘다", () => {
    const graph = createFlowGraph(catalog).node("trigger.telemetry", "n-trigger01").node("debug.log", "n-debug001").build();
    const moved = moveNodes(graph, graph.nodes.map((n) => n.id), 5, 9);
    expect(moved.nodes[0].position).toEqual({ x: 293, y: 105 });
    const aligned = alignToGrid(moved);
    for (const n of aligned.nodes) {
      expect(n.position.x % 16).toBe(0);
      expect(n.position.y % 16).toBe(0);
    }
    expect(alignToGrid(moved, ["n-debug001"]).nodes[0].position).toEqual({ x: 293, y: 105 });
  });
});
