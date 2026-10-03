import { describe, expect, it, vi } from "vitest";
import { handleEdgeChanges, handleNodeChanges } from "../flow-canvas";
import { createFlowGraph, catalogOf } from "../../model/flow-graph";
import { M3_NODE_TYPES } from "../../model/__tests__/catalog-fixture";

const graph = createFlowGraph(catalogOf(M3_NODE_TYPES)).node("trigger.telemetry", "n-a0000001").node("debug.log", "n-b0000001").wire("n-a0000001", "out", "n-b0000001").build();
const handlers = () => ({ onDrag: vi.fn(), onDragEnd: vi.fn(), onSelect: vi.fn(), onRemoveWire: vi.fn() });

describe("FLW-01.01 캔버스 사건 변환", () => {
  it("끄는 중·끌기 끝·선택 추가·해제", () => {
    const h = handlers();
    handleNodeChanges(
      [
        { type: "position", id: "n-a0000001", position: { x: 10, y: 20 }, dragging: true },
        { type: "position", id: "n-a0000001", position: { x: 16, y: 32 }, dragging: false },
        { type: "position", id: "n-b0000001", dragging: false },
        { type: "position", id: "n-zzzzzzzz", dragging: false },
        { type: "select", id: "n-b0000001", selected: true },
        { type: "select", id: "n-a0000001", selected: false },
        { type: "dimensions", id: "n-a0000001" },
      ],
      graph,
      ["n-a0000001"],
      h,
    );
    expect(h.onDrag).toHaveBeenCalledWith("n-a0000001", { x: 10, y: 20 });
    expect(h.onDragEnd).toHaveBeenCalledWith("n-a0000001", { x: 16, y: 32 });
    expect(h.onDragEnd).toHaveBeenCalledWith("n-b0000001", graph.nodes[1].position);
    expect(h.onDragEnd).toHaveBeenCalledTimes(2);
    expect(h.onSelect).toHaveBeenCalledWith(["n-b0000001"]);
    const none = handlers();
    handleNodeChanges([{ type: "dimensions", id: "n-a0000001" }], graph, [], none);
    expect(none.onSelect).not.toHaveBeenCalled();
  });

  it("와이어 삭제만 전달", () => {
    const h = handlers();
    handleEdgeChanges([{ type: "remove", id: "n-a0000001:out->n-b0000001" }, { type: "remove", id: "x" }, { type: "select", id: "n-a0000001:out->n-b0000001", selected: true }], graph, h);
    expect(h.onRemoveWire).toHaveBeenCalledTimes(1);
    expect(h.onRemoveWire).toHaveBeenCalledWith({ from: "n-a0000001", port: "out", to: "n-b0000001" });
  });
});
