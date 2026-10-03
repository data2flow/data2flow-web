/**
 * 플로우 캔버스(UI-FLW-02, FLW-01.01): React Flow(@xyflow/react, MIT). 그래프 상태는 편집기 상태가 갖고, 캔버스는 보여 주고 사건만 알린다.
 * - 연결: 끄는 동안 연결 가능 여부를 표시(isValidConnection = BR-FLW-03), 거부되면 onReject
 * - 끌기: 끄는 동안은 이력 없이 위치만, 놓으면 이력에 남기고 와이어 위면 자동 재연결(편집기가 판단)
 * - 삭제 키는 편집기가 직접 처리한다("앞뒤를 이을까요?" 확인)
 */
import "@xyflow/react/dist/style.css";
import { Background, Controls, MiniMap, ReactFlow, ReactFlowProvider, type Connection, type Edge, type EdgeChange, type NodeChange } from "@xyflow/react";
import { useCallback, useMemo, type DragEvent } from "react";
import { useTranslation } from "react-i18next";
import { canConnect, categoryOf, configSummary, inputPorts, outputPorts, wireKey, type Catalog } from "../model/flow-graph";
import type { FlowGraph, VersionDiff, Wire } from "../model/types";
import type { NodeBadge } from "../store/flow-editor-store";
import { FlowNodeCard, type FlowNodeView } from "./flow-node-card";
import { DRAG_TYPE } from "./palette";

const NODE_TYPES = { flowNode: FlowNodeCard };

export interface FlowCanvasProps {
  graph: FlowGraph;
  catalog: Catalog;
  selected: string[];
  badges: Map<string, NodeBadge>;
  errorCounts?: Map<string, number>;
  diff?: VersionDiff | null;
  readOnly: boolean;
  onConnect: (wire: Wire) => void;
  onDrag: (id: string, position: { x: number; y: number }) => void;
  onDragEnd: (id: string, position: { x: number; y: number }) => void;
  onSelect: (ids: string[]) => void;
  onRemoveWire: (wire: Wire) => void;
  onDropType: (type: string, position: { x: number; y: number }) => void;
}

function diffOf(diff: VersionDiff | null | undefined, id: string): "added" | "changed" | "removed" | undefined {
  if (!diff) return undefined;
  if (diff.added.includes(id)) return "added";
  if (diff.removed.includes(id)) return "removed";
  if (diff.changed.some((c) => c.nodeId === id)) return "changed";
  return undefined;
}

type CanvasHandlers = Pick<FlowCanvasProps, "onDrag" | "onDragEnd" | "onSelect" | "onRemoveWire">;

/** React Flow 노드 변경 → 편집기 사건(끄는 중 위치, 끌기 끝, 선택) */
export function handleNodeChanges(changes: NodeChange<FlowNodeView>[], graph: FlowGraph, selected: string[], handlers: CanvasHandlers) {
  let selection: string[] | null = null;
  for (const change of changes) {
    if (change.type === "position" && change.position) {
      if (change.dragging) handlers.onDrag(change.id, change.position);
      else handlers.onDragEnd(change.id, change.position);
    } else if (change.type === "position" && change.dragging === false) {
      const node = graph.nodes.find((n) => n.id === change.id);
      if (node) handlers.onDragEnd(change.id, node.position);
    } else if (change.type === "select") {
      selection ??= [...selected];
      selection = change.selected ? [...new Set([...selection, change.id])] : selection.filter((id) => id !== change.id);
    }
  }
  if (selection) handlers.onSelect(selection);
}

/** React Flow 와이어 삭제 → 편집기 사건 */
export function handleEdgeChanges(changes: EdgeChange[], graph: FlowGraph, handlers: CanvasHandlers) {
  for (const change of changes) {
    if (change.type !== "remove") continue;
    const wire = graph.wires.find((w) => wireKey(w) === change.id);
    if (wire) handlers.onRemoveWire(wire);
  }
}

export function FlowCanvas(props: FlowCanvasProps) {
  const { t } = useTranslation();
  const { graph, catalog, selected, badges, errorCounts, diff, readOnly } = props;
  const nodes: FlowNodeView[] = useMemo(
    () =>
      graph.nodes.map((node) => ({
        id: node.id,
        type: "flowNode",
        position: node.position,
        selected: selected.includes(node.id),
        draggable: !readOnly,
        connectable: !readOnly,
        data: { node, category: categoryOf(node.type, catalog), summary: configSummary(node), inputs: inputPorts(node, catalog), outputs: outputPorts(node, catalog), badge: badges.get(node.id), errorCount: errorCounts?.get(node.id), diff: diffOf(diff, node.id) },
      })),
    [graph.nodes, catalog, selected, badges, errorCounts, diff, readOnly],
  );
  const edges: Edge[] = useMemo(
    () => graph.wires.map((w) => ({ id: wireKey(w), source: w.from, sourceHandle: w.port, target: w.to, label: w.port === "out" ? undefined : w.port, className: w.port === "error" ? "text-bad" : undefined, deletable: !readOnly })),
    [graph.wires, readOnly],
  );
  const nameOf = (id: string) => graph.nodes.find((n) => n.id === id)?.name ?? id;

  const toWire = (c: Connection | Edge): Wire => ({ from: c.source, port: c.sourceHandle ?? "out", to: c.target });
  const isValidConnection = useCallback((c: Connection | Edge) => canConnect(graph, toWire(c), catalog), [graph, catalog]);

  const handlers = { onDrag: props.onDrag, onDragEnd: props.onDragEnd, onSelect: props.onSelect, onRemoveWire: props.onRemoveWire };
  const onNodesChange = (changes: NodeChange<FlowNodeView>[]) => handleNodeChanges(changes, graph, selected, handlers);
  const onEdgesChange = (changes: EdgeChange[]) => handleEdgeChanges(changes, graph, handlers);

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    const type = event.dataTransfer?.getData(DRAG_TYPE);
    if (!type || readOnly) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    props.onDropType(type, { x: event.clientX - rect.left, y: event.clientY - rect.top });
  };

  return (
    <div className="relative h-full min-h-[420px] flex-1" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <ReactFlowProvider>
        <ReactFlow<FlowNodeView>
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={(c) => props.onConnect(toWire(c))}
          isValidConnection={isValidConnection}
          nodesDraggable={!readOnly}
          nodesConnectable={!readOnly}
          deleteKeyCode={null}
          selectionKeyCode={null}
          multiSelectionKeyCode="Shift"
          snapToGrid
          snapGrid={[16, 16]}
          fitView
          minZoom={0.2}
          maxZoom={2}
        >
          <Background gap={16} />
          <MiniMap pannable zoomable ariaLabel={t("flows.canvas.minimap")} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </ReactFlowProvider>
      {graph.nodes.length === 0 && <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-[13px] text-muted">{readOnly ? t("flows.canvas.emptyReadOnly") : t("flows.canvas.empty")}</p>}
      <ul aria-label={t("flows.canvas.wires")} className="sr-only">
        {graph.wires.map((w) => (
          <li key={wireKey(w)}>{t("flows.canvas.wire", { from: nameOf(w.from), port: w.port, to: nameOf(w.to) })}</li>
        ))}
      </ul>
    </div>
  );
}
