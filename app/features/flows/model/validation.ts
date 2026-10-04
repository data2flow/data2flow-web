/**
 * 화면 검증(UI-FLW-02 입력 검증 표, BR-FLW-02·05). 서버 검증(API-FLW-06)이 최종이고, 화면은 같은 규칙으로 먼저 알려 준다.
 * - NO_TRIGGER: 트리거 노드가 하나도 없음
 * - UNCONNECTED: 트리거를 뺀 노드에 들어오는 와이어가 없음
 * - CYCLE: 와이어가 순환함
 * - INVALID_CONFIG: 노드 설정이 카탈로그 JSON 스키마(부분 집합)에 맞지 않음 → 저장은 되지만 적용은 막힘(BR-FLW-05)
 */
import { checkDuration } from "./duration";
import { isTrigger, type Catalog } from "./flow-graph";
import type { ConfigSchema, FlowGraph, FlowNode, ValidationIssue, ValidationResult } from "./types";

export const JS_CODE_LIMIT_BYTES = 64 * 1024;
/** 플로우당 노드 수 한도(FLW-10.01, BR-FLW-16). 넘으면 저장은 서버가 FLOW_NODE_LIMIT_EXCEEDED로 거절한다 */
export const FLOW_NODE_LIMIT = 200;
export const NODE_NAME_MAX = 60;

export interface ConfigProblem {
  path: string;
  /** required · type · minimum · maximum · enum · minLength · maxLength · minItems · maxItems · duration */
  rule: string;
  limit?: number | string;
}

const typeOk = (value: unknown, type: string) => {
  switch (type) {
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "string":
      return typeof value === "string";
    case "boolean":
      return typeof value === "boolean";
    case "array":
      return Array.isArray(value);
    case "object":
      return typeof value === "object" && value !== null && !Array.isArray(value);
    default:
      return true;
  }
};

const isEmpty = (v: unknown) => v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);

/** JSON 스키마 부분 집합 검사(required·type·minimum·maximum·enum·minLength·maxLength·items·format=duration) */
export function validateConfig(schema: ConfigSchema | undefined, value: unknown, path = ""): ConfigProblem[] {
  if (!schema) return [];
  const problems: ConfigProblem[] = [];
  if (value === undefined || value === null || value === "") return problems;
  const types = schema.type === undefined ? [] : Array.isArray(schema.type) ? schema.type : [schema.type];
  if (types.length > 0 && !types.some((t) => typeOk(value, t))) return [{ path, rule: "type", limit: types.join("|") }];
  if (schema.enum && !schema.enum.includes(value as never)) problems.push({ path, rule: "enum" });
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) problems.push({ path, rule: "minimum", limit: schema.minimum });
    if (schema.maximum !== undefined && value > schema.maximum) problems.push({ path, rule: "maximum", limit: schema.maximum });
  }
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) problems.push({ path, rule: "minLength", limit: schema.minLength });
    if (schema.maxLength !== undefined && value.length > schema.maxLength) problems.push({ path, rule: "maxLength", limit: schema.maxLength });
    if ((schema.format === "duration" || schema["x-widget"] === "duration") && checkDuration(value)) problems.push({ path, rule: "duration" });
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) problems.push({ path, rule: "minItems", limit: schema.minItems });
    if (schema.maxItems !== undefined && value.length > schema.maxItems) problems.push({ path, rule: "maxItems", limit: schema.maxItems });
    if (schema.items) value.forEach((item, i) => problems.push(...validateConfig(schema.items, item, `${path}[${i}]`)));
  }
  if (typeOk(value, "object") && schema.properties) {
    const obj = value as Record<string, unknown>;
    for (const key of schema.required ?? []) {
      if (isEmpty(obj[key])) problems.push({ path: path ? `${path}.${key}` : key, rule: "required" });
    }
    for (const [key, prop] of Object.entries(schema.properties)) {
      problems.push(...validateConfig(prop, obj[key], path ? `${path}.${key}` : key));
    }
  }
  return problems;
}

/** 노드 하나의 설정·이름 문제(설정 패널 필드 아래 문구) */
export function nodeProblems(node: FlowNode, catalog: Catalog): ConfigProblem[] {
  const problems: ConfigProblem[] = [];
  const name = node.name?.trim() ?? "";
  if (!name) problems.push({ path: "name", rule: "required" });
  else if (name.length > NODE_NAME_MAX) problems.push({ path: "name", rule: "maxLength", limit: NODE_NAME_MAX });
  const schema = catalog.get(node.type)?.configSchema;
  problems.push(...validateConfig(schema ? { ...schema, type: "object" } : undefined, node.config ?? {}));
  if (node.type === "transform.js" && typeof node.config?.code === "string" && new TextEncoder().encode(node.config.code).length > JS_CODE_LIMIT_BYTES) {
    problems.push({ path: "code", rule: "maxBytes", limit: JS_CODE_LIMIT_BYTES });
  }
  const retry = node.retry?.maxAttempts;
  if (retry !== undefined && (retry < 0 || retry > 10)) problems.push({ path: "retry.maxAttempts", rule: retry < 0 ? "minimum" : "maximum", limit: retry < 0 ? 0 : 10 });
  return problems;
}

function findCycleNodes(graph: FlowGraph): string[] {
  const adjacency = new Map<string, string[]>();
  for (const w of graph.wires) adjacency.set(w.from, [...(adjacency.get(w.from) ?? []), w.to]);
  const state = new Map<string, 1 | 2>();
  const stack: string[] = [];
  let cycle: string[] = [];
  const visit = (id: string): boolean => {
    state.set(id, 1);
    stack.push(id);
    for (const next of adjacency.get(id) ?? []) {
      if (state.get(next) === 1) {
        cycle = stack.slice(stack.indexOf(next));
        return true;
      }
      if (!state.has(next) && visit(next)) return true;
    }
    stack.pop();
    state.set(id, 2);
    return false;
  };
  for (const n of graph.nodes) if (!state.has(n.id) && visit(n.id)) break;
  return cycle;
}

/** 화면 검증 전체 */
export function validateGraph(graph: FlowGraph, catalog: Catalog): ValidationResult {
  const errors: ValidationIssue[] = [];
  if (graph.nodes.length > 0 && !graph.nodes.some((n) => isTrigger(n.type, catalog))) errors.push({ code: "NO_TRIGGER" });
  if (graph.nodes.length > FLOW_NODE_LIMIT) errors.push({ code: "LIMIT", field: "nodes", message: `${graph.nodes.length}/${FLOW_NODE_LIMIT}` });
  const hasInput = new Set(graph.wires.map((w) => w.to));
  for (const n of graph.nodes) {
    if (!isTrigger(n.type, catalog) && !hasInput.has(n.id)) errors.push({ code: "UNCONNECTED", nodeId: n.id });
  }
  const cycle = findCycleNodes(graph);
  if (cycle.length > 0) errors.push({ code: "CYCLE", nodeIds: cycle });
  for (const n of graph.nodes) {
    for (const p of nodeProblems(n, catalog)) errors.push({ code: "INVALID_CONFIG", nodeId: n.id, path: p.path, message: p.rule });
  }
  return { errors, warnings: [] };
}

const NODE_FIELD = /^nodes\[([^\]]+)\](?:\.(.+))?$/;
const WIRE_FIELD = /^wires\[(\d+)\](?:\.(.+))?$/;

/** 서버 문제 위치(`field`)에서 노드 ID를 읽는다: `nodes[n-abc].config.value` → `n-abc`. 노드가 아니면 undefined */
export function nodeIdOfField(field: string | undefined): string | undefined {
  return field ? NODE_FIELD.exec(field)?.[1] : undefined;
}

/**
 * 서버 문제(`{field, code, message}`, ADR-044)를 편집기 모양으로: `nodes[<id>].config.<p>` → nodeId + path `<p>`,
 * `nodes[<id>].<p>` → nodeId + path `<p>`, `wires[<i>]` → 그 연결선(graph의 i번째 와이어, 저장한 정의와 순서가 같다)과 양 끝 노드.
 * 이미 nodeId·nodeIds가 있는 문제(화면 검증)는 그대로 둔다.
 */
export function normalizeIssue(issue: ValidationIssue, graph?: Pick<FlowGraph, "wires">): ValidationIssue {
  if (issue.nodeId || issue.nodeIds || !issue.field) return issue;
  const node = NODE_FIELD.exec(issue.field);
  if (node) {
    const rest = node[2]?.replace(/^config\./, "");
    return { ...issue, nodeId: node[1], path: issue.path ?? (rest && rest !== "id" ? rest : undefined) };
  }
  const wire = WIRE_FIELD.exec(issue.field);
  if (wire) {
    const w = graph?.wires[Number(wire[1])];
    return w ? { ...issue, wire: w, nodeIds: [w.from, w.to], path: issue.path ?? wire[2] } : { ...issue, path: issue.path ?? issue.field };
  }
  return issue;
}

export function normalizeIssues(result: Partial<ValidationResult> | null | undefined, graph?: Pick<FlowGraph, "wires">): ValidationResult | null {
  if (!result) return null;
  return { errors: (result.errors ?? []).map((i) => normalizeIssue(i, graph)), warnings: (result.warnings ?? []).map((i) => normalizeIssue(i, graph)) };
}

/** 문제 목록의 노드 ID들(nodeId 또는 nodeIds, 없으면 서버 field `nodes[<id>]…`) */
export function issueNodeIds(issue: ValidationIssue): string[] {
  if (issue.nodeIds) return issue.nodeIds;
  const id = issue.nodeId ?? nodeIdOfField(issue.field);
  return id ? [id] : [];
}
