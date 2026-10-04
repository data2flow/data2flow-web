/**
 * UI-FLW-18 스냅샷(FLW-11.02, API-FLW-60~63, BR-FLW-32): 입력 검증, 비교·복원 응답 정리.
 */
export const SNAPSHOT_NAME_MAX = 80;
export const SNAPSHOT_MEMO_MAX = 500;
export const SNAPSHOT_FLOWS_MAX = 50;

export interface SnapshotRow {
  snapshotId: string;
  name: string;
  memo?: string | null;
  flowCount: number;
  createdBy?: { userId: string; name: string };
  createdAt: string;
}

export interface SnapshotDetail {
  snapshotId: string;
  name: string;
  memo?: string | null;
  flows: { flowId: string; flowName?: string; version: number }[];
  scripts: { scriptId: string; version: number }[];
  subflows: { subflowId: string; version: number }[];
  variables?: Record<string, unknown>;
  sinkConnections: { sinkConnectionId: string; name: string }[];
  createdBy?: { userId: string; name: string };
  createdAt?: string;
}

export interface SnapshotErrors {
  name?: "required" | "tooLong" | "duplicated";
  memo?: "tooLong";
  flowIds?: "required" | "tooMany";
}

/** UI-FLW-18 입력 검증 표: 이름 1~80자·조직 안 고유, 플로우 1~50개 */
export function validateSnapshot(input: { name: string; memo: string; flowIds: string[] }, existingNames: readonly string[] = []): SnapshotErrors {
  const errors: SnapshotErrors = {};
  const name = input.name.trim();
  if (!name) errors.name = "required";
  else if (name.length > SNAPSHOT_NAME_MAX) errors.name = "tooLong";
  else if (existingNames.includes(name)) errors.name = "duplicated";
  if (input.memo.length > SNAPSHOT_MEMO_MAX) errors.memo = "tooLong";
  const unique = new Set(input.flowIds.filter(Boolean));
  if (unique.size === 0) errors.flowIds = "required";
  else if (unique.size > SNAPSHOT_FLOWS_MAX) errors.flowIds = "tooMany";
  return errors;
}

export interface FlowChange {
  nodeId: string;
  field: string;
  from?: unknown;
  to?: unknown;
}

export interface FlowCompare {
  flowId: string;
  flowName?: string;
  added: string[];
  removed: string[];
  changed: FlowChange[];
}

export interface VersionChange {
  id: string;
  from: number | null;
  to: number | null;
}

export interface SnapshotCompare {
  flows: FlowCompare[];
  scripts: VersionChange[];
  subflows: VersionChange[];
}

type Raw = Record<string, unknown>;
const arr = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const num = (value: unknown): number | null => (typeof value === "number" ? value : value == null ? null : Number(value));

function versionChanges(value: unknown, idKey: string): VersionChange[] {
  return arr(value).map((item) => {
    const raw = item as Raw;
    return { id: String(raw[idKey] ?? raw.id ?? ""), from: num(raw.from ?? raw.fromVersion), to: num(raw.to ?? raw.toVersion) };
  });
}

/**
 * API-FLW-62 응답 정리. 문서는 "플로우별 {added[], removed[], changed:[{nodeId, field, from, to}]}, 스크립트·서브플로우 버전 차이"만 정하므로
 * `{flows:[…], scripts:[{scriptId, from, to}], subflows:[{subflowId, from, to}]}`를 기본으로 읽고, 플로우 ID를 키로 둔 객체도 받는다.
 */
export function normalizeCompare(response: unknown): SnapshotCompare {
  const raw = (response ?? {}) as Raw;
  let flows: FlowCompare[];
  if (Array.isArray(raw.flows)) {
    flows = raw.flows.map((f) => {
      const item = f as Raw;
      return { flowId: String(item.flowId ?? ""), flowName: typeof item.flowName === "string" ? item.flowName : undefined, added: arr(item.added).map(String), removed: arr(item.removed).map(String), changed: arr(item.changed) as FlowChange[] };
    });
  } else if (raw.flows && typeof raw.flows === "object") {
    flows = Object.entries(raw.flows as Record<string, Raw>).map(([flowId, item]) => ({ flowId, added: arr(item.added).map(String), removed: arr(item.removed).map(String), changed: arr(item.changed) as FlowChange[] }));
  } else flows = [];
  return { flows, scripts: versionChanges(raw.scripts, "scriptId"), subflows: versionChanges(raw.subflows, "subflowId") };
}

/** 비교 요약 수(노드 추가·삭제·변경, 스크립트 버전 차이) — AT-FLW-26.2 "노드 추가 1, 설정 변경 2, 스크립트 v3→v4" */
export function compareTotals(compare: SnapshotCompare) {
  return {
    added: compare.flows.reduce((n, f) => n + f.added.length, 0),
    removed: compare.flows.reduce((n, f) => n + f.removed.length, 0),
    changed: compare.flows.reduce((n, f) => n + f.changed.length, 0),
    scripts: compare.scripts.filter((s) => s.from !== s.to).length,
  };
}

export interface RestorePreview {
  affectedFlows: { flowId: string; flowName: string; fromVersion?: number | null; toVersion?: number | null }[];
  resetNodeStates: { flowId?: string; nodeId: string }[];
  appliedVersions: Record<string, number>;
}

/** API-FLW-63 응답 정리: 항목이 ID 문자열이어도, 객체여도 받는다 */
export function normalizeRestore(response: unknown): RestorePreview {
  const raw = (response ?? {}) as Raw;
  const affectedFlows = arr(raw.affectedFlows).map((item) => {
    if (typeof item === "string") return { flowId: item, flowName: item };
    const f = item as Raw;
    const flowId = String(f.flowId ?? f.id ?? "");
    return { flowId, flowName: String(f.flowName ?? f.name ?? flowId), fromVersion: num(f.fromVersion ?? f.currentVersion), toVersion: num(f.toVersion ?? f.version) };
  });
  const resetNodeStates = arr(raw.resetNodeStates).map((item) => {
    if (typeof item === "string") return { nodeId: item };
    const s = item as Raw;
    return { flowId: s.flowId == null ? undefined : String(s.flowId), nodeId: String(s.nodeId ?? "") };
  });
  const appliedVersions = raw.appliedVersions && typeof raw.appliedVersions === "object" ? (raw.appliedVersions as Record<string, number>) : {};
  return { affectedFlows, resetNodeStates, appliedVersions };
}

/** 비교할 두 스냅샷(체크한 순서대로 앞 두 개). 두 개가 아니면 undefined */
export function comparePair(selected: string[]): [string, string] | undefined {
  const unique = [...new Set(selected.filter(Boolean))];
  return unique.length === 2 ? [unique[0], unique[1]] : undefined;
}
