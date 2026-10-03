import { act, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FlowCanvasProps } from "../components/flow-canvas";
import { coolingGraph, detailOf, renderEditor } from "./helpers";

let canvas: FlowCanvasProps;
vi.mock("../components/flow-canvas", () => ({
  FlowCanvas: (props: FlowCanvasProps) => {
    canvas = props;
    return <ul aria-label="nodes">{props.graph.nodes.map((n) => <li key={n.id}>{`${n.id}@${n.position.x},${n.position.y}`}</li>)}</ul>;
  },
}));

beforeEach(() => vi.clearAllMocks());

describe("FLW-01.01 편집기 캔버스 사건 처리", () => {
  it("연결 거부 토스트, 와이어 삭제, 끌기(이력 한 번)와 와이어 위 드롭 자동 재연결", async () => {
    await renderEditor({ detail: detailOf(coolingGraph()) });
    await screen.findByRole("list", { name: "nodes" });
    act(() => canvas.onConnect({ from: "n-thr00001", port: "true", to: "n-thr00001" }));
    expect(screen.getByText("노드를 자기 자신에게 이을 수 없습니다")).toBeInTheDocument();
    act(() => canvas.onConnect({ from: "n-thr00001", port: "false", to: "n-act00001" }));
    expect(canvas.graph.wires).toHaveLength(4);
    act(() => canvas.onRemoveWire({ from: "n-thr00001", port: "false", to: "n-act00001" }));
    expect(canvas.graph.wires).toHaveLength(3);
    // 새 디버그 노드를 trigger→aggregate 와이어 가운데로 끌어 놓기
    act(() => canvas.onDropType("debug.log", { x: 0, y: 400 }));
    const added = canvas.graph.nodes.at(-1)!;
    const trg = canvas.graph.nodes[0].position;
    const agg = canvas.graph.nodes[1].position;
    act(() => canvas.onDrag(added.id, { x: 10, y: 380 }));
    act(() => canvas.onDrag(added.id, { x: 20, y: 300 }));
    act(() => canvas.onDragEnd(added.id, { x: (trg.x + 180 + agg.x) / 2 - 90, y: trg.y }));
    expect(screen.getByText("디버그 노드를 와이어 사이에 끼워 넣었습니다")).toBeInTheDocument();
    expect(canvas.graph.wires).toContainEqual({ from: "n-trg00001", port: "out", to: added.id });
    expect(canvas.graph.wires).toContainEqual({ from: added.id, port: "out", to: "n-agg00001" });
    act(() => canvas.onSelect([added.id]));
    expect(canvas.selected).toEqual([added.id]);
  });

  it("읽기 전용이면 연결·와이어 삭제·추가가 바뀌지 않는다", async () => {
    await renderEditor({ role: "ANALYST", detail: detailOf(coolingGraph(), { status: "ACTIVE", activeVersion: 2, draftVersion: null }) });
    await screen.findByRole("list", { name: "nodes" });
    act(() => canvas.onConnect({ from: "n-thr00001", port: "false", to: "n-act00001" }));
    act(() => canvas.onRemoveWire({ from: "n-thr00001", port: "true", to: "n-act00001" }));
    act(() => canvas.onDropType("debug.log", { x: 0, y: 0 }));
    expect(canvas.graph.wires).toHaveLength(3);
    expect(canvas.graph.nodes).toHaveLength(4);
  });
});
