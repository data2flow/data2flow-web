/**
 * 데이터 보관 설정 화면 모델(UI-TSD-04, TSD-05.01·02.01·05.03). API-TSD-40 유효 정책, API-TSD-41 미리 보기, API-TSD-42 저장, API-TSD-43 저장 현황.
 * 저장 규칙(core RetentionRules): ORG 항목은 보낸 종류만 바뀌고, MODEL·METRIC 재정의는 보낸 목록이 전체다(빠진 재정의는 지운다).
 * 그래서 화면은 조직 기본 전부 + 재정의 표 전체를 함께 보낸다. 기간이 줄면 미리 보기 응답의 confirmToken을 붙여야 저장된다(BR-TSD-03).
 */

export const DATA_CLASSES = [
  "RAW_MESSAGE",
  "TELEMETRY",
  "LINK",
  "AGG_1M",
  "AGG_1H",
  "AGG_1D",
  "FLOW_EXECUTION",
  "ANALYSIS_RESULT",
  "AUDIT_LOG",
  "NOTIFICATION_DELIVERY",
  "COMMAND",
  "DEVICE_STATE_HISTORY",
  "WEBHOOK_DELIVERY",
] as const;
export type DataClass = (typeof DATA_CLASSES)[number];

/** MODEL·METRIC 재정의를 받는 종류(시계열과 집계) */
export const OVERRIDABLE: readonly DataClass[] = ["TELEMETRY", "AGG_1M", "AGG_1H", "AGG_1D"];
/** 시스템 최소 일수(core DataClass, NFR-04.03). API 응답 minDays가 있으면 그것을 쓴다 */
export const MIN_DAYS: Record<DataClass, number> = {
  RAW_MESSAGE: 7,
  TELEMETRY: 30,
  LINK: 7,
  AGG_1M: 30,
  AGG_1H: 365,
  AGG_1D: 0,
  FLOW_EXECUTION: 7,
  ANALYSIS_RESULT: 30,
  AUDIT_LOG: 365,
  NOTIFICATION_DELIVERY: 30,
  COMMAND: 90,
  DEVICE_STATE_HISTORY: 90,
  WEBHOOK_DELIVERY: 30,
};

export const maxDays = (dc: DataClass) => (dc === "ANALYSIS_RESULT" ? 1095 : 3650);

export interface EffectivePolicy {
  scope: "ORG" | "MODEL" | "METRIC";
  scopeRef?: string | null;
  dataClass: DataClass;
  retainDays: number;
  compressAfterDays?: number | null;
  archiveBeforeDelete: boolean;
  storeMode?: "ALL" | "ON_CHANGE" | null;
  minDays?: number;
  inherited?: boolean;
  version?: number;
}

export interface PoliciesResponse {
  effective: EffectivePolicy[];
  version?: number;
}

export interface PreviewResponse {
  affectedRows: number;
  affectedBytes: number;
  byMetric: { scope: string; scopeRef?: string | null; dataClass: string; rows: number; bytes: number }[];
  shortened: boolean;
  confirmToken?: string | null;
  expiresAt?: string | null;
}

export interface SaveResponse {
  effective: EffectivePolicy[];
  version?: number;
  appliesAt?: string | null;
}

export interface PartitionStat {
  table: string;
  name: string;
  range?: { from?: string | null; to?: string | null } | null;
  state?: string | null;
  rows?: number | null;
  bytes?: number | null;
  compressionRatio?: number | null;
}

export interface StorageStats {
  partitions: PartitionStat[];
  totalBytes: number;
}

export interface ArchiveFile {
  id: string;
  dataClass: string;
  rangeFrom: string;
  rangeTo: string;
  objectKey: string;
  format: string;
  rowsCount: number;
  bytes: number;
  checksum?: string | null;
  restoredJobId?: string | null;
  createdAt: string;
}

export interface OrgRow {
  dataClass: DataClass;
  /** 입력 중인 값(문자열) */
  retainDays: string;
  archiveBeforeDelete: boolean;
  compressAfterDays?: number | null;
  minDays: number;
}

export interface OverrideRow {
  key: string;
  scope: "MODEL" | "METRIC";
  scopeRef: string;
  dataClass: DataClass;
  retainDays: string;
  archiveBeforeDelete: boolean;
  storeMode: "ALL" | "ON_CHANGE";
}

const isClass = (v: string): v is DataClass => (DATA_CLASSES as readonly string[]).includes(v);

/** 유효 정책을 조직 기본(종류마다 한 줄)과 재정의 표로 나눈다 */
export function splitPolicies(effective: EffectivePolicy[]): { org: OrgRow[]; overrides: OverrideRow[] } {
  const org = DATA_CLASSES.map((dc): OrgRow => {
    const p = effective.find((e) => e.scope === "ORG" && e.dataClass === dc);
    return { dataClass: dc, retainDays: String(p?.retainDays ?? ""), archiveBeforeDelete: Boolean(p?.archiveBeforeDelete), compressAfterDays: p?.compressAfterDays ?? null, minDays: p?.minDays ?? MIN_DAYS[dc] };
  });
  const overrides = effective
    .filter((e) => e.scope !== "ORG" && isClass(e.dataClass))
    .map((e, i): OverrideRow => ({ key: `o${i}`, scope: e.scope as "MODEL" | "METRIC", scopeRef: e.scopeRef ?? "", dataClass: e.dataClass, retainDays: String(e.retainDays), archiveBeforeDelete: e.archiveBeforeDelete, storeMode: e.storeMode ?? "ALL" }));
  return { org, overrides };
}

export type RetentionErrors = Record<string, "range" | "duplicate" | "required">;

function inRange(dc: DataClass, raw: string, min: number): boolean {
  if (!/^\d+$/.test(raw.trim())) return false;
  const days = Number(raw);
  return days >= min && days <= maxDays(dc);
}

/**
 * 입력 검증(UI-TSD-04): 종류별 허용 범위, 같은 범위·대상·종류 중복 금지. 키는 `org.{종류}`·`ov.{행 키}`.
 * 1일 집계는 0(무기한)이 기본이다. core는 AGG_1D 재정의도 0만 받으므로 재정의 행은 0만 허용한다
 */
export function validateRetention(org: OrgRow[], overrides: OverrideRow[]): RetentionErrors {
  const errors: RetentionErrors = {};
  for (const row of org) {
    const ok = row.dataClass === "AGG_1D" ? row.retainDays.trim() === "0" : inRange(row.dataClass, row.retainDays, row.minDays);
    if (!ok) errors[`org.${row.dataClass}`] = "range";
  }
  const seen = new Set<string>();
  for (const row of overrides) {
    const key = `ov.${row.key}`;
    if (!row.scopeRef.trim()) {
      errors[key] = "required";
      continue;
    }
    const ok = row.dataClass === "AGG_1D" ? row.retainDays.trim() === "0" : inRange(row.dataClass, row.retainDays, MIN_DAYS[row.dataClass]);
    if (!ok) {
      errors[key] = "range";
      continue;
    }
    const identity = `${row.scope}|${row.scopeRef.trim()}|${row.dataClass}`;
    if (seen.has(identity)) errors[key] = "duplicate";
    seen.add(identity);
  }
  return errors;
}

/** API-TSD-41·42 items: 조직 기본 전부 + 재정의 전체 */
export function policyItems(org: OrgRow[], overrides: OverrideRow[]) {
  return [
    ...org.map((r) => ({
      scope: "ORG",
      scopeRef: null,
      dataClass: r.dataClass,
      retainDays: Number(r.retainDays),
      archiveBeforeDelete: r.archiveBeforeDelete,
      ...(r.dataClass === "TELEMETRY" && r.compressAfterDays ? { compressAfterDays: Math.min(r.compressAfterDays, Number(r.retainDays)) } : {}),
    })),
    ...overrides.map((r) => ({
      scope: r.scope,
      scopeRef: r.scopeRef.trim(),
      dataClass: r.dataClass,
      retainDays: Number(r.retainDays),
      archiveBeforeDelete: r.archiveBeforeDelete,
      // 저장 방식(값 변화만)은 측정 항목 범위의 측정값 원본만(BR-TSD-05·TSD-05.03)
      ...(r.scope === "METRIC" && r.dataClass === "TELEMETRY" && r.storeMode === "ON_CHANGE" ? { storeMode: "ON_CHANGE" } : {}),
    })),
  ];
}

let rowSeq = 0;
export function newOverride(): OverrideRow {
  rowSeq += 1;
  return { key: `n${rowSeq}`, scope: "METRIC", scopeRef: "", dataClass: "TELEMETRY", retainDays: "90", archiveBeforeDelete: false, storeMode: "ALL" };
}

/** 데이터 종류별 사용량(저장 현황 파티션을 표 이름으로 묶음) */
export function usageByTable(stats: StorageStats | null | undefined): { table: string; rows: number; bytes: number; partitions: number }[] {
  const map = new Map<string, { table: string; rows: number; bytes: number; partitions: number }>();
  for (const p of stats?.partitions ?? []) {
    const entry = map.get(p.table) ?? { table: p.table, rows: 0, bytes: 0, partitions: 0 };
    entry.rows += p.rows ?? 0;
    entry.bytes += p.bytes ?? 0;
    entry.partitions += 1;
    map.set(p.table, entry);
  }
  return [...map.values()].sort((a, b) => b.bytes - a.bytes);
}
