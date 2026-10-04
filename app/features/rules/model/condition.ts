/**
 * 규칙 조건 빌더 모델(UI-RUL-02 "조건"·"복합 조건", domain-model §2.1, BR-RUL-04·05·21).
 * 편집 중에는 항상 최상위 그룹 하나로 다루고(노드마다 화면용 uid), 저장할 때 조건이 하나뿐이면 그 조건만 보낸다.
 * 한도: 조건 10개, 중첩 2단계(최상위 그룹 안의 그룹까지), 지속 시간 0초~24시간, 반복 1~100회.
 */
import { isoToSeconds } from "~/features/flows/model/duration";
import type { GroupCondition, LeafCondition, MetricInfo, RuleCondition, ThresholdCondition, ThresholdOp } from "./types";

export const MAX_CONDITIONS = 10;
export const MAX_DEPTH = 2;
export const MAX_FOR_SEC = 24 * 3600;
export const MAX_REPEAT = 100;

export type EditorLeaf = LeafCondition & { uid: string };
export interface EditorGroup {
  kind: "group";
  uid: string;
  op: "AND" | "OR";
  items: EditorNode[];
}
export type EditorNode = EditorLeaf | EditorGroup;

let counter = 0;
/** 서버 렌더와 브라우저가 따로 세므로 겹치지 않게 모듈마다 다른 접두사를 붙인다 */
const prefix = Math.random().toString(36).slice(2, 6);
export function nextUid(): string {
  counter += 1;
  return `c${prefix}${counter}`;
}

export function isGroup(node: EditorNode | RuleCondition): node is EditorGroup {
  return node.kind === "group";
}

function attach(condition: RuleCondition): EditorNode {
  if (condition.kind === "group") {
    return { kind: "group", uid: nextUid(), op: condition.op === "OR" ? "OR" : "AND", items: (condition.items ?? []).map(attach) };
  }
  return { ...condition, uid: nextUid() } as EditorLeaf;
}

/** 받은 조건을 편집 트리로. 그룹이 아니면 AND 그룹 하나로 감싼다 */
export function toEditor(condition: RuleCondition | null | undefined): EditorGroup {
  if (!condition) return { kind: "group", uid: nextUid(), op: "AND", items: [newThreshold()] };
  const node = attach(condition);
  return isGroup(node) ? node : { kind: "group", uid: nextUid(), op: "AND", items: [node] };
}

function detach(node: EditorNode): RuleCondition {
  if (isGroup(node)) return { kind: "group", op: node.op, items: node.items.map(detach) };
  const { uid: _uid, ...rest } = node;
  void _uid;
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rest)) if (value !== undefined && value !== null && value !== "") clean[key] = value;
  return clean as unknown as LeafCondition;
}

/** 저장 본문의 조건. 최상위에 조건이 하나뿐이면 그 조건만 */
export function fromEditor(root: EditorGroup): RuleCondition {
  if (root.items.length === 1 && !isGroup(root.items[0])) return detach(root.items[0]);
  return detach(root);
}

export function newThreshold(metric = ""): EditorLeaf {
  return { kind: "threshold", uid: nextUid(), metric, op: ">", value: null, aggregate: "perDevice" } as EditorLeaf;
}

export function newLeaf(kind: LeafCondition["kind"], metric = ""): EditorLeaf {
  if (kind === "rateOfChange") return { kind, uid: nextUid(), metric, window: "PT10M", delta: 0, direction: "UP", aggregate: "perDevice" } as EditorLeaf;
  if (kind === "noData") return { kind, uid: nextUid(), metric, window: "PT30M" } as EditorLeaf;
  if (kind === "anomaly") return { kind, uid: nextUid(), minScore: 3, metric } as EditorLeaf;
  return newThreshold(metric);
}

/** 트리 전체의 조건(그룹 제외) 수 */
export function leafCount(node: EditorNode): number {
  return isGroup(node) ? node.items.reduce((n, item) => n + leafCount(item), 0) : 1;
}

export function canAddCondition(root: EditorGroup): boolean {
  return leafCount(root) < MAX_CONDITIONS;
}

/** 그룹 안에 그룹을 더 넣을 수 있는지(최상위 깊이 1 → 안쪽 그룹 깊이 2까지) */
export function canAddGroup(root: EditorGroup, groupUid: string): boolean {
  const depth = depthOf(root, groupUid);
  return depth !== null && depth < MAX_DEPTH && canAddCondition(root);
}

export function depthOf(node: EditorNode, uid: string, depth = 1): number | null {
  if (node.uid === uid) return depth;
  if (!isGroup(node)) return null;
  for (const item of node.items) {
    const found = depthOf(item, uid, depth + 1);
    if (found !== null) return found;
  }
  return null;
}

function mapTree(node: EditorNode, fn: (node: EditorNode) => EditorNode | null): EditorNode | null {
  const mapped = fn(node);
  if (!mapped) return null;
  if (!isGroup(mapped)) return mapped;
  return { ...mapped, items: mapped.items.map((item) => mapTree(item, fn)).filter((item): item is EditorNode => item !== null) };
}

export function addToGroup(root: EditorGroup, groupUid: string, node: EditorNode): EditorGroup {
  if (!canAddCondition(root)) return root;
  if (isGroup(node) && !canAddGroup(root, groupUid)) return root;
  return mapTree(root, (n) => (isGroup(n) && n.uid === groupUid ? { ...n, items: [...n.items, node] } : n)) as EditorGroup;
}

export function removeNode(root: EditorGroup, uid: string): EditorGroup {
  if (root.uid === uid) return root;
  const next = mapTree(root, (n) => (n.uid === uid ? null : n)) as EditorGroup;
  // 비어 버린 안쪽 그룹은 지운다. 최상위가 비면 빈 조건 하나를 둔다
  const pruned = mapTree(next, (n) => (isGroup(n) && n.uid !== root.uid && n.items.length === 0 ? null : n)) as EditorGroup;
  return pruned.items.length === 0 ? { ...pruned, items: [newThreshold()] } : pruned;
}

export function updateNode(root: EditorGroup, uid: string, patch: Partial<EditorLeaf> | Partial<EditorGroup>): EditorGroup {
  return mapTree(root, (n) => (n.uid === uid ? ({ ...n, ...patch } as EditorNode) : n)) as EditorGroup;
}

/** 연산자를 바꿀 때 맞지 않는 필드를 비운다(범위 연산자 ↔ 단일 값, 해제 기준은 크기 비교 연산자만) */
export function changeOp(leaf: ThresholdCondition, op: ThresholdOp): Partial<ThresholdCondition> {
  const ranged = op === "outside" || op === "inside";
  return { op, range: ranged ? (leaf.range ?? null) : null, value: ranged ? null : leaf.value, clear: supportsClear(op) ? leaf.clear : null };
}

export function supportsClear(op: ThresholdOp): boolean {
  return op === ">" || op === ">=" || op === "<" || op === "<=";
}

/** 화면 오류: 경로는 `${uid}.${필드}`, 문구 키와 보간 값 */
export interface FieldProblem {
  key: string;
  params?: Record<string, string | number>;
}
export type ConditionProblems = Record<string, FieldProblem>;

function metricOf(metrics: MetricInfo[], key: string | null | undefined) {
  return metrics.find((m) => m.key === key);
}

function inRange(metric: MetricInfo | undefined, value: number): FieldProblem | undefined {
  if (!metric) return undefined;
  const min = metric.validMin;
  const max = metric.validMax;
  if ((min != null && value < min) || (max != null && value > max)) {
    return { key: "rules.v.valueRange", params: { metric: metric.key, min: min ?? "-∞", max: max ?? "∞" } };
  }
  return undefined;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

/**
 * 해제 기준 검사(BR-RUL-04): 발생 기준과 같은 방향의 안쪽이어야 한다.
 * `>`·`>=`이면 clear < value, `<`·`<=`이면 clear > value. 맞지 않으면 문구 키를 돌려준다
 */
export function checkClear(op: ThresholdOp, value: number, clear: number): FieldProblem | undefined {
  if (op === ">" || op === ">=") return clear < value ? undefined : { key: "rules.v.clearBelow", params: { value } };
  if (op === "<" || op === "<=") return clear > value ? undefined : { key: "rules.v.clearAbove", params: { value } };
  return undefined;
}

function checkWindow(path: string, value: unknown, problems: ConditionProblems, minSec = 1) {
  const seconds = isoToSeconds(value);
  if (seconds === null || seconds < minSec || seconds > MAX_FOR_SEC) problems[path] = { key: "rules.v.windowRange" };
}

function checkLeaf(leaf: EditorLeaf, metrics: MetricInfo[], problems: ConditionProblems) {
  if (leaf.kind === "anomaly") return;
  if (leaf.kind !== "noData" && !leaf.metric) problems[`${leaf.uid}.metric`] = { key: "rules.v.metricRequired" };
  if (leaf.kind === "noData") return checkWindow(`${leaf.uid}.window`, leaf.window, problems, 60);
  if (leaf.kind === "rateOfChange") {
    checkWindow(`${leaf.uid}.window`, leaf.window, problems);
    const delta = toNumber(leaf.delta);
    if (delta === null || delta <= 0) problems[`${leaf.uid}.delta`] = { key: "rules.v.deltaPositive" };
    return;
  }
  const metric = metricOf(metrics, leaf.metric);
  if (leaf.op === "outside" || leaf.op === "inside") {
    const low = toNumber(leaf.range?.[0]);
    const high = toNumber(leaf.range?.[1]);
    if (low === null || high === null) problems[`${leaf.uid}.range`] = { key: "rules.v.valueRequired" };
    else if (low >= high) problems[`${leaf.uid}.range`] = { key: "rules.v.rangeOrder" };
    else {
      const out = inRange(metric, low) ?? inRange(metric, high);
      if (out) problems[`${leaf.uid}.range`] = out;
    }
  } else if (metric?.valueType === "BOOLEAN") {
    if (typeof leaf.value !== "boolean") problems[`${leaf.uid}.value`] = { key: "rules.v.valueRequired" };
  } else if (metric?.valueType === "ENUM") {
    if (leaf.value === null || leaf.value === undefined || leaf.value === "") problems[`${leaf.uid}.value`] = { key: "rules.v.valueRequired" };
  } else {
    const value = toNumber(leaf.value);
    if (value === null) problems[`${leaf.uid}.value`] = { key: "rules.v.valueRequired" };
    else {
      const out = inRange(metric, value);
      if (out) problems[`${leaf.uid}.value`] = out;
      const clear = toNumber(leaf.clear);
      if (clear !== null && supportsClear(leaf.op)) {
        const bad = checkClear(leaf.op, value, clear);
        if (bad) problems[`${leaf.uid}.clear`] = bad;
      }
    }
  }
  if (leaf.for) {
    const seconds = isoToSeconds(leaf.for);
    if (seconds === null || seconds < 0 || seconds > MAX_FOR_SEC) problems[`${leaf.uid}.for`] = { key: "rules.v.forRange" };
  }
  if (leaf.repeat !== undefined && leaf.repeat !== null) {
    const repeat = toNumber(leaf.repeat);
    if (repeat === null || !Number.isInteger(repeat) || repeat < 1 || repeat > MAX_REPEAT) problems[`${leaf.uid}.repeat`] = { key: "rules.v.repeatRange" };
  }
}

/** 조건 트리 검사. 문제가 없으면 빈 객체 */
export function validateCondition(root: EditorGroup, metrics: MetricInfo[]): ConditionProblems {
  const problems: ConditionProblems = {};
  const walk = (node: EditorNode, depth: number) => {
    if (isGroup(node)) {
      if (depth > MAX_DEPTH) problems[`${node.uid}.depth`] = { key: "rules.v.depthLimit", params: { n: MAX_DEPTH } };
      node.items.forEach((item) => walk(item, depth + 1));
    } else checkLeaf(node, metrics, problems);
  };
  walk(root, 1);
  if (leafCount(root) > MAX_CONDITIONS) problems[`${root.uid}.count`] = { key: "rules.v.countLimit", params: { n: MAX_CONDITIONS } };
  return problems;
}

/** 조건을 쓰는 측정 항목(템플릿 requiredMetrics·범위 대상 계산에 쓴다) */
export function metricsOf(condition: RuleCondition | EditorNode): string[] {
  if (condition.kind === "group") return [...new Set(condition.items.flatMap((item) => metricsOf(item)))];
  return condition.metric ? [condition.metric] : [];
}

/** 조건 요약의 조각(목록·튜닝 제안·시뮬레이션 비교 표시). 문구는 화면이 i18n으로 붙인다 */
export interface SummaryPart {
  kind: LeafCondition["kind"] | "group";
  text: string;
}

function formatDuration(iso: string | null | undefined, units: { s: string; m: string; h: string }): string {
  const seconds = isoToSeconds(iso);
  if (!seconds) return "";
  if (seconds % 3600 === 0) return `${seconds / 3600}${units.h}`;
  if (seconds % 60 === 0) return `${seconds / 60}${units.m}`;
  return `${seconds}${units.s}`;
}

/**
 * "co2 > 1000ppm 5분" 같은 한 줄 요약. units는 화면 언어의 단위 이름, words는 연결어
 */
export function summarize(
  condition: RuleCondition | null | undefined,
  metrics: MetricInfo[],
  words: { s: string; m: string; h: string; and: string; or: string; noData: string; rate: string; clear: string; repeat: string; anomaly: string },
): string {
  if (!condition) return "";
  if (condition.kind === "group") {
    const inner = condition.items.map((item) => {
      const text = summarize(item, metrics, words);
      return item.kind === "group" ? `(${text})` : text;
    });
    return inner.join(` ${condition.op === "OR" ? words.or : words.and} `);
  }
  const unit = metricOf(metrics, condition.metric)?.unit ?? "";
  if (condition.kind === "noData") return `${condition.metric ?? ""} ${words.noData} ${formatDuration(condition.window, words)}`.trim();
  if (condition.kind === "rateOfChange") {
    const sign = condition.direction === "DOWN" ? "-" : condition.direction === "UP" ? "+" : "±";
    return `${condition.metric} ${words.rate} ${sign}${condition.delta}${unit} / ${formatDuration(condition.window, words)}`;
  }
  if (condition.kind === "anomaly") return `${words.anomaly} ≥ ${condition.minScore}`;
  const value = condition.op === "outside" || condition.op === "inside" ? `[${condition.range?.[0] ?? "?"}, ${condition.range?.[1] ?? "?"}]` : `${condition.value ?? "?"}${typeof condition.value === "number" ? unit : ""}`;
  const parts = [`${condition.metric} ${condition.op} ${value}`];
  const duration = formatDuration(condition.for ?? null, words);
  if (duration) parts.push(duration);
  if (condition.clear !== null && condition.clear !== undefined) parts.push(`${words.clear} ${condition.clear}${unit}`);
  if (condition.repeat && condition.repeat > 1) parts.push(`${words.repeat} ${condition.repeat}`);
  return parts.join(" ");
}

/** 첫 번째 임계값 조건(시뮬레이션 비교 열 머리 "기준 1200"에 쓴다) */
export function firstThreshold(condition: RuleCondition | null | undefined): ThresholdCondition | undefined {
  if (!condition) return undefined;
  if (condition.kind === "threshold") return condition;
  if (condition.kind === "group") {
    for (const item of condition.items) {
      const found = firstThreshold(item);
      if (found) return found;
    }
  }
  return undefined;
}

export type { GroupCondition };
