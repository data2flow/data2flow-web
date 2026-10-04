/**
 * 서브플로우(FLW-01.04, UI-FLW-11, API-FLW-22·23, BR-FLW-17): 캔버스에서 고른 노드 묶음 → 서브플로우 정의 초안.
 * - 트리거 노드는 넣을 수 없다(서브플로우는 트리거를 가질 수 없다)
 * - 입력 포트 = 바깥에서 들어오는 와이어가 닿는 노드 수(1~5), 출력 포트 = 바깥으로 나가는 와이어(1~10, 이름은 바꿀 수 있음)
 * - 노출 파라미터 = 고른 노드 설정 중 사용자가 고른 경로(`n-thr-1.value`)와 표시 이름·기본값
 * 서브플로우 노드는 정의에서 `type: "subflow"`, `config: {subflowId, version, params}`로 쓰고, 새 버전은 쓰는 쪽이 명시적으로 올린다
 */
import { isTrigger, type Catalog } from "./flow-graph";
import type { FlowGraph, FlowNode, Wire } from "./types";

export const SUBFLOW_TYPE = "subflow";
export const SUBFLOW_MAX_INPUTS = 5;
export const SUBFLOW_MAX_OUTPUTS = 10;

export interface SubflowParam {
  path: string;
  label: string;
  default: unknown;
}

export interface SubflowDraft {
  nodes: FlowNode[];
  wires: Wire[];
  inputs: { name: string; nodeId: string }[];
  outputs: { name: string; from: string; port: string }[];
  /** 노출할 수 있는 설정 경로(노드 ID.설정 키) */
  candidates: SubflowParam[];
}

export type SubflowCheck = { ok: true; draft: SubflowDraft } | { ok: false; reason: "empty" | "trigger" | "noInput" | "tooManyInputs" | "noOutput" | "tooManyOutputs" };

export function subflowDraft(graph: FlowGraph, selected: string[], catalog: Catalog): SubflowCheck {
  const ids = new Set(selected);
  const nodes = graph.nodes.filter((n) => ids.has(n.id));
  if (nodes.length === 0) return { ok: false, reason: "empty" };
  if (nodes.some((n) => isTrigger(n.type, catalog))) return { ok: false, reason: "trigger" };
  const wires = graph.wires.filter((w) => ids.has(w.from) && ids.has(w.to));
  const entry = [...new Set(graph.wires.filter((w) => !ids.has(w.from) && ids.has(w.to)).map((w) => w.to))];
  const exits = graph.wires.filter((w) => ids.has(w.from) && !ids.has(w.to) && w.port !== "error");
  const exitKeys = [...new Map(exits.map((w) => [`${w.from}:${w.port}`, w])).values()];
  if (entry.length === 0) return { ok: false, reason: "noInput" };
  if (entry.length > SUBFLOW_MAX_INPUTS) return { ok: false, reason: "tooManyInputs" };
  if (exitKeys.length === 0) return { ok: false, reason: "noOutput" };
  if (exitKeys.length > SUBFLOW_MAX_OUTPUTS) return { ok: false, reason: "tooManyOutputs" };
  return {
    ok: true,
    draft: {
      nodes,
      wires,
      inputs: entry.map((nodeId, i) => ({ name: `in${i + 1}`, nodeId })),
      outputs: exitKeys.map((w) => ({ name: w.port === "out" ? `out${exitKeys.indexOf(w) + 1}` : w.port, from: w.from, port: w.port })),
      candidates: nodes.flatMap((n) => Object.entries(n.config ?? {}).filter(([, v]) => ["string", "number", "boolean"].includes(typeof v)).map(([key, value]) => ({ path: `${n.id}.${key}`, label: `${n.name} · ${key}`, default: value }))),
    },
  };
}

/** API-FLW-22 요청 본문 */
export function subflowRequest(draft: SubflowDraft, form: { name: string; description: string; outputNames: string[]; params: SubflowParam[] }, flowId: string) {
  return {
    name: form.name.trim(),
    description: form.description.trim(),
    definition: {
      nodes: draft.nodes,
      wires: draft.wires,
      inputs: draft.inputs,
      outputs: draft.outputs.map((o, i) => ({ ...o, name: form.outputNames[i]?.trim() || o.name })),
      params: form.params,
    },
    fromFlow: { flowId, nodeIds: draft.nodes.map((n) => n.id) },
  };
}

export function subflowNameProblem(name: string): boolean {
  const v = name.trim();
  return v.length < 1 || v.length > 100;
}

/** 서브플로우 노드(정의 `type: subflow`)가 쓰는 서브플로우 ID와 고정 버전 */
export function subflowRefs(graph: FlowGraph): { nodeId: string; subflowId: string; version: number }[] {
  return graph.nodes
    .filter((n) => n.type === SUBFLOW_TYPE && typeof n.config.subflowId === "string")
    .map((n) => ({ nodeId: n.id, subflowId: n.config.subflowId as string, version: Number(n.config.version ?? 1) }));
}
