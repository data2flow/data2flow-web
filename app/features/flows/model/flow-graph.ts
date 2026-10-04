/**
 * 플로우 그래프 모델(FLW-01.01·01.03, BR-FLW-01·03). React Flow와 무관한 순수 함수라 노드 50개 규모에서도 단위 테스트로 검증한다.
 * - 노드 ID는 `n-` + 영숫자 8자 이상으로 만들고 바꾸지 않는다(BR-FLW-01)
 * - 와이어는 같은 플로우 안 노드끼리만, 출력 포트 타입과 입력 포트 타입이 호환될 때만 잇는다(BR-FLW-03)
 */
import { FLOW_DEFINITION_SCHEMA, type FlowDefinition, type FlowGraph, type FlowNode, type NodeType, type PortSpec, type Wire } from "./types";

export const GRID = 16;
export const NODE_ID_PATTERN = /^n-[a-z0-9]{8,}$/;
const ID_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";

export type Catalog = ReadonlyMap<string, NodeType>;

export function catalogOf(types: NodeType[]): Catalog {
  return new Map(types.map((t) => [t.type, t]));
}

/** 노드 ID(`n-` + 8자). 이미 있는 ID와 겹치면 다시 만든다 */
export function newNodeId(existing: Iterable<string> = [], random: () => number = Math.random): string {
  const taken = new Set(existing);
  for (;;) {
    let id = "n-";
    for (let i = 0; i < 8; i += 1) id += ID_CHARS[Math.floor(random() * ID_CHARS.length) % ID_CHARS.length];
    if (!taken.has(id)) return id;
  }
}

export function categoryOf(type: string, catalog?: Catalog): string {
  return catalog?.get(type)?.category ?? type.split(".")[0];
}

export function isTrigger(type: string, catalog?: Catalog) {
  return categoryOf(type, catalog) === "trigger";
}

/** 제어 배포 권한이 필요한 노드(IAM-04.04): 제어·장면 */
export function isControlNode(type: string, catalog?: Catalog) {
  const nodeType = catalog?.get(type);
  if (nodeType?.permissions?.includes("FLOW_DEPLOY_CONTROL")) return true;
  return type === "action.control" || type === "action.scene";
}

/** 노드의 출력 포트: 카탈로그 출력 + JS 노드의 출력 수(out1..n) + 공통 error(트리거 포함 모든 노드, contracts flow-node-type.v1) */
export function outputPorts(node: Pick<FlowNode, "type" | "config">, catalog?: Catalog): PortSpec[] {
  const nodeType = catalog?.get(node.type);
  let ports: PortSpec[] = [...(nodeType?.outputs ?? [{ name: "out", type: "any" }])];
  if (node.type === "transform.js") {
    const n = Math.min(10, Math.max(1, Number(node.config?.outputs) || 1));
    ports = Array.from({ length: n }, (_, i) => ({ name: `out${i + 1}`, type: "message" }));
  }
  const error = nodeType?.outputs.find((p) => p.name === "error");
  ports = ports.filter((p) => p.name !== "error");
  ports.push(error ? { ...error, type: error.type ?? "error" } : { name: "error", type: "error" });
  return ports;
}

export function inputPorts(node: Pick<FlowNode, "type">, catalog?: Catalog): PortSpec[] {
  const nodeType = catalog?.get(node.type);
  if (nodeType) return nodeType.inputs;
  return isTrigger(node.type) ? [] : [{ name: "in", type: "any" }];
}

/** 포트 타입 호환(BR-FLW-03) */
export function compatible(outType: string, inType: string): boolean {
  if (outType === inType) return true;
  if (outType === "any" || inType === "any") return true;
  return outType === "error" && inType === "message";
}

export function emptyGraph(): FlowGraph {
  return { nodes: [], wires: [], extra: { mode: { concurrency: "queued", keyBy: "deviceId", max: 10 }, variables: [] } };
}

export function fromDefinition(definition: FlowDefinition | null | undefined): FlowGraph {
  if (!definition) return emptyGraph();
  const { schema: _schema, nodes, wires, ...extra } = definition;
  void _schema;
  return {
    nodes: (nodes ?? []).map((n) => ({ ...n, config: { ...(n.config ?? {}) }, position: { ...(n.position ?? { x: 0, y: 0 }) } })),
    wires: (wires ?? []).map((w) => ({ ...w })),
    extra,
  };
}

export function toDefinition(graph: FlowGraph): FlowDefinition {
  return {
    schema: FLOW_DEFINITION_SCHEMA,
    ...graph.extra,
    nodes: graph.nodes.map((n) => {
      // 편집기가 모르는 필드(outputs·disabled 등)도 그대로 둔다
      const { id, type, typeVersion, name, config, position, description, retry, ...rest } = n;
      const out: FlowNode = { id, type, typeVersion, name, config, position, ...rest };
      if (description) out.description = description;
      if (retry) out.retry = retry;
      return out;
    }),
    wires: graph.wires,
  };
}

export const wireKey = (w: Wire) => `${w.from}:${w.port}->${w.to}`;

export function defaultConfig(nodeType: NodeType | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, prop] of Object.entries(nodeType?.configSchema?.properties ?? {})) {
    if (prop.default !== undefined) out[key] = prop.default;
  }
  return out;
}

export function snap(value: number, grid = GRID) {
  return Math.round(value / grid) * grid;
}

/** 팔레트에서 노드 추가(키보드 추가 포함). 위치를 주지 않으면 마지막 노드 오른쪽 */
export function addNode(graph: FlowGraph, type: string, catalog: Catalog, options: { position?: { x: number; y: number }; id?: string; random?: () => number } = {}): { graph: FlowGraph; node: FlowNode } {
  const nodeType = catalog.get(type);
  const last = graph.nodes.at(-1);
  const position = options.position ?? (last ? { x: last.position.x + 224, y: last.position.y } : { x: 64, y: 96 });
  const node: FlowNode = {
    id: options.id ?? newNodeId(graph.nodes.map((n) => n.id), options.random),
    type,
    typeVersion: nodeType?.typeVersion ?? 1,
    name: nodeType?.name ?? type,
    config: defaultConfig(nodeType),
    position: { x: snap(position.x), y: snap(position.y) },
  };
  return { graph: { ...graph, nodes: [...graph.nodes, node] }, node };
}

export type ConnectFailure = "SELF" | "DUPLICATE" | "UNKNOWN_NODE" | "NO_PORT" | "NO_INPUT" | "TYPE_MISMATCH";
export type ConnectResult = { ok: true; graph: FlowGraph } | { ok: false; reason: ConnectFailure };

/** 와이어 잇기(BR-FLW-03): 자기 자신, 같은 포트 쌍 중복, 타입 불일치는 거부 */
export function connect(graph: FlowGraph, wire: Wire, catalog?: Catalog): ConnectResult {
  if (wire.from === wire.to) return { ok: false, reason: "SELF" };
  const from = graph.nodes.find((n) => n.id === wire.from);
  const to = graph.nodes.find((n) => n.id === wire.to);
  if (!from || !to) return { ok: false, reason: "UNKNOWN_NODE" };
  const out = outputPorts(from, catalog).find((p) => p.name === wire.port);
  if (!out) return { ok: false, reason: "NO_PORT" };
  const input = inputPorts(to, catalog)[0];
  if (!input) return { ok: false, reason: "NO_INPUT" };
  if (graph.wires.some((w) => w.from === wire.from && w.port === wire.port && w.to === wire.to)) return { ok: false, reason: "DUPLICATE" };
  if (!compatible(out.type, input.type)) return { ok: false, reason: "TYPE_MISMATCH" };
  return { ok: true, graph: { ...graph, wires: [...graph.wires, { from: wire.from, port: wire.port, to: wire.to }] } };
}

/** 연결 가능 여부만(끄는 동안 포트 색, 스토리보드 "포트를 이어 와이어 연결") */
export function canConnect(graph: FlowGraph, wire: Wire, catalog?: Catalog): boolean {
  return connect(graph, wire, catalog).ok;
}

export function removeWire(graph: FlowGraph, wire: Wire): FlowGraph {
  return { ...graph, wires: graph.wires.filter((w) => wireKey(w) !== wireKey(wire)) };
}

/**
 * 노드 삭제. `reconnect`면 "앞뒤를 이을까요?"에 예: 들어오던 와이어의 출발 포트를 나가던 대상에 다시 잇는다(호환·중복 검사).
 */
export function removeNodes(graph: FlowGraph, ids: string[], options: { reconnect?: boolean; catalog?: Catalog } = {}): FlowGraph {
  const gone = new Set(ids);
  let next: FlowGraph = { ...graph, nodes: graph.nodes.filter((n) => !gone.has(n.id)), wires: graph.wires.filter((w) => !gone.has(w.from) && !gone.has(w.to)) };
  if (options.reconnect) {
    for (const id of ids) {
      const incoming = graph.wires.filter((w) => w.to === id && !gone.has(w.from));
      const outgoing = graph.wires.filter((w) => w.from === id && w.port !== "error" && !gone.has(w.to));
      for (const a of incoming) {
        for (const b of outgoing) {
          const result = connect(next, { from: a.from, port: a.port, to: b.to }, options.catalog);
          if (result.ok) next = result.graph;
        }
      }
    }
  }
  return next;
}

/** 앞뒤를 이을 수 있는 노드인지(들어오고 나가는 와이어가 모두 있음) */
export function hasThroughWires(graph: FlowGraph, id: string): boolean {
  return graph.wires.some((w) => w.to === id) && graph.wires.some((w) => w.from === id && w.port !== "error");
}

/** 와이어 위에 노드 놓기 → 자동 재연결(from → node → to). 노드의 첫 출력 포트로 잇는다 */
export function insertOnWire(graph: FlowGraph, wire: Wire, nodeId: string, catalog?: Catalog): ConnectResult {
  const node = graph.nodes.find((n) => n.id === nodeId);
  if (!node || nodeId === wire.from || nodeId === wire.to) return { ok: false, reason: "UNKNOWN_NODE" };
  const firstOut = outputPorts(node, catalog).find((p) => p.name !== "error");
  if (!firstOut) return { ok: false, reason: "NO_PORT" };
  const base = removeWire(graph, wire);
  const a = connect(base, { from: wire.from, port: wire.port, to: nodeId }, catalog);
  if (!a.ok) return a;
  const b = connect(a.graph, { from: nodeId, port: firstOut.name, to: wire.to }, catalog);
  if (!b.ok) return b;
  return b;
}

/** 점과 선분 사이 거리(와이어 위 드롭 판정) */
export function distanceToSegment(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** 노드를 놓은 위치가 어떤 와이어 위인지(노드 중심 기준, 노드 크기 180×72 가정). 그 노드와 이어진 와이어는 제외 */
export function wireUnder(graph: FlowGraph, nodeId: string, tolerance = 28): Wire | undefined {
  const node = graph.nodes.find((n) => n.id === nodeId);
  if (!node) return undefined;
  if (graph.wires.some((w) => w.from === nodeId || w.to === nodeId)) return undefined;
  const center = { x: node.position.x + 90, y: node.position.y + 36 };
  const pos = (id: string) => graph.nodes.find((n) => n.id === id)?.position;
  return graph.wires.find((w) => {
    const a = pos(w.from);
    const b = pos(w.to);
    if (!a || !b) return false;
    return distanceToSegment(center, { x: a.x + 180, y: a.y + 36 }, { x: b.x, y: b.y + 36 }) <= tolerance;
  });
}

export function moveNodes(graph: FlowGraph, ids: string[], dx: number, dy: number): FlowGraph {
  const set = new Set(ids);
  return { ...graph, nodes: graph.nodes.map((n) => (set.has(n.id) ? { ...n, position: { x: n.position.x + dx, y: n.position.y + dy } } : n)) };
}

export function setPosition(graph: FlowGraph, id: string, position: { x: number; y: number }): FlowGraph {
  return { ...graph, nodes: graph.nodes.map((n) => (n.id === id ? { ...n, position: { x: position.x, y: position.y } } : n)) };
}

/** 정렬 도구: 선택 노드(없으면 전체)를 16px 격자에 맞춘다 */
export function alignToGrid(graph: FlowGraph, ids?: string[], grid = GRID): FlowGraph {
  const set = ids && ids.length > 0 ? new Set(ids) : null;
  return { ...graph, nodes: graph.nodes.map((n) => (!set || set.has(n.id) ? { ...n, position: { x: snap(n.position.x, grid), y: snap(n.position.y, grid) } } : n)) };
}

export function updateNode(graph: FlowGraph, id: string, patch: Partial<Omit<FlowNode, "id">>): FlowGraph {
  return { ...graph, nodes: graph.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) };
}

export interface Clipboard {
  nodes: FlowNode[];
  wires: Wire[];
}

/** 복사: 선택 노드와, 선택 노드끼리 잇는 와이어만 */
export function copySelection(graph: FlowGraph, ids: string[]): Clipboard {
  const set = new Set(ids);
  return {
    nodes: graph.nodes.filter((n) => set.has(n.id)).map((n) => ({ ...n, config: structuredClone(n.config), position: { ...n.position } })),
    wires: graph.wires.filter((w) => set.has(w.from) && set.has(w.to)).map((w) => ({ ...w })),
  };
}

/** 붙여넣기: 새 `n-…` ID 발급(BR-FLW-01), 위치는 32px 옆으로 */
export function paste(graph: FlowGraph, clip: Clipboard, options: { offset?: number; random?: () => number } = {}): { graph: FlowGraph; ids: string[] } {
  const offset = options.offset ?? 2 * GRID;
  const taken = new Set(graph.nodes.map((n) => n.id));
  const mapping = new Map<string, string>();
  for (const n of clip.nodes) {
    const id = newNodeId(taken, options.random);
    taken.add(id);
    mapping.set(n.id, id);
  }
  const nodes = clip.nodes.map((n) => ({ ...n, id: mapping.get(n.id) as string, config: structuredClone(n.config), position: { x: n.position.x + offset, y: n.position.y + offset } }));
  const wires = clip.wires.map((w) => ({ from: mapping.get(w.from) as string, port: w.port, to: mapping.get(w.to) as string }));
  return { graph: { ...graph, nodes: [...graph.nodes, ...nodes], wires: [...graph.wires, ...wires] }, ids: nodes.map((n) => n.id) };
}

/**
 * 테스트·시연용 그래프 빌더(test-plan `createFlowGraph()`): `.node(type, id?)`로 노드를 놓고 `.wire(from, port, to)`로 잇는다.
 * 잇기가 거부되면 예외를 던진다.
 */
export function createFlowGraph(catalog: Catalog = new Map()) {
  let graph = emptyGraph();
  let seq = 0;
  const builder = {
    node(type: string, id?: string, config: Record<string, unknown> = {}) {
      seq += 1;
      const result = addNode(graph, type, catalog, { id: id ?? `n-node${String(seq).padStart(4, "0")}`, position: { x: 64 + seq * 224, y: 96 } });
      graph = updateNode(result.graph, result.node.id, { config: { ...result.node.config, ...config } });
      return builder;
    },
    wire(from: string, port: string, to: string) {
      const result = connect(graph, { from, port, to }, catalog);
      if (!result.ok) throw new Error(`connect ${from}:${port}->${to} ${result.reason}`);
      graph = result.graph;
      return builder;
    },
    build(): FlowGraph {
      return graph;
    },
  };
  return builder;
}

/** 한 줄 설정 요약(노드 카드) */
export function configSummary(node: FlowNode): string {
  const c = node.config ?? {};
  const s = (v: unknown) => (v === undefined || v === null || v === "" ? "?" : typeof v === "object" ? JSON.stringify(v) : String(v));
  switch (node.type) {
    case "condition.threshold":
      return `${s(c.metric)} ${s(c.op)} ${c.range ? s(c.range) : s(c.value)}${c.for ? ` · ${c.for}` : ""}`;
    case "action.control":
      return `${s(c.capability)}.${s(c.command)}(${c.args ? Object.values(c.args as Record<string, unknown>).map(s).join(", ") : ""})`;
    case "trigger.telemetry":
      return Array.isArray(c.metrics) ? (c.metrics as unknown[]).map(s).join(", ") : "";
    case "transform.aggregate":
      return `${s(c.fn)} · ${s(c.window)}`;
    case "transform.js":
      return `JS · ${Number(c.outputs) || 1} out`;
    case "flow.delay":
      return s(c.duration);
    case "trigger.schedule":
      return s(c.cron);
    default: {
      const first = Object.entries(c).find(([, v]) => typeof v !== "object");
      return first ? `${first[0]}=${s(first[1])}` : "";
    }
  }
}

/** 설정이 참조하는 공간 ID(대상 위젯·템플릿) — 가상 공간 표시(FLW-03.07)에 쓴다 */
export function referencedSpaceIds(graph: FlowGraph): string[] {
  const out = new Set<string>();
  for (const n of graph.nodes) {
    const target = n.config?.target as { spaceId?: unknown } | undefined;
    if (target?.spaceId) out.add(String(target.spaceId));
    if (n.config?.spaceId) out.add(String(n.config.spaceId));
  }
  return [...out];
}
