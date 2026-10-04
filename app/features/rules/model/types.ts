/**
 * 규칙(RUL) 화면이 주고받는 모양(design/api/RUL-api.md API-RUL-01~08, spec/detail/RUL/domain-model.md §2).
 */
export const SEVERITIES = ["CRITICAL", "MAJOR", "MINOR", "WARNING", "INFO"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const RULE_STATUSES = ["ACTIVE", "INACTIVE", "ERROR"] as const;
export type RuleStatus = "ACTIVE" | "INACTIVE" | "ERROR" | "CONVERTED" | "DELETED";

export const SCOPE_TYPES = ["SPACE", "DEVICE", "MODEL", "TAG"] as const;
export type ScopeType = (typeof SCOPE_TYPES)[number];

export interface RuleScope {
  type: ScopeType;
  ids: string[];
  includeChildren: boolean;
  targetCount?: number;
}

export type ThresholdOp = ">" | ">=" | "<" | "<=" | "==" | "!=" | "outside" | "inside";
export const THRESHOLD_OPS: ThresholdOp[] = [">", ">=", "<", "<=", "==", "!=", "outside", "inside"];
export const AGGREGATES = ["perDevice", "spaceAvg", "spaceMax", "spaceMin", "any", "all"] as const;
export type Aggregate = (typeof AGGREGATES)[number];

export interface ThresholdCondition {
  kind: "threshold";
  metric: string;
  op: ThresholdOp;
  value?: number | boolean | string | null;
  /** outside·inside의 범위 [아래, 위] */
  range?: [number, number] | null;
  /** 지속 시간 ISO-8601(PT5M). 없으면 즉시 */
  for?: string | null;
  /** 해제 기준(히스테리시스, BR-RUL-04) */
  clear?: number | null;
  /** 연속 만족 횟수(BR-RUL-05) */
  repeat?: number | null;
  aggregate?: Aggregate;
}

export interface RateOfChangeCondition {
  kind: "rateOfChange";
  metric: string;
  window: string;
  delta: number;
  /** core 계약은 소문자(RuleCondition.DIRECTIONS) */
  direction: "up" | "down" | "any";
  aggregate?: Aggregate;
}

export interface NoDataCondition {
  kind: "noData";
  metric?: string | null;
  window: string;
}

/** 이상 점수(RUL-01.08, M7). 편집기는 만들지 않고 받은 것만 그대로 보여 준다 */
export interface AnomalyCondition {
  kind: "anomaly";
  minScore: number;
  analysisId?: string | null;
  metric?: string | null;
}

export interface GroupCondition {
  kind: "group";
  op: "AND" | "OR";
  items: RuleCondition[];
}

export type LeafCondition = ThresholdCondition | RateOfChangeCondition | NoDataCondition | AnomalyCondition;
export type RuleCondition = LeafCondition | GroupCondition;

export interface TimeCondition {
  /** 1(월)~7(일) */
  days: number[];
  from?: string | null;
  to?: string | null;
  spaceSchedule?: "INSIDE" | "OUTSIDE" | null;
}

/** API-RUL-02/03 요청 본문 */
export interface RulePayload {
  name: string;
  templateKey?: string | null;
  scope: { type: ScopeType; ids: string[]; includeChildren: boolean };
  condition: RuleCondition;
  timeCondition?: TimeCondition | null;
  severity: Severity;
  titleTemplate: string;
  autoClear: boolean;
  policyId?: string | null;
  baseVersion?: number;
}

/** 규칙 상세(편집 화면). 문서에 상세 조회 API가 없어 API-RUL-02 요청 + 목록 필드 모양으로 받는다 */
export interface RuleDetail extends Omit<RulePayload, "baseVersion"> {
  ruleId: string;
  status: RuleStatus;
  errorReason?: string | null;
  version: number;
  flowId?: string | null;
  scope: RuleScope;
  updatedBy?: { userId: string; name: string } | null;
  updatedAt?: string | null;
}

/** API-RUL-01 목록 행 */
export interface RuleRow {
  ruleId: string;
  name: string;
  status: RuleStatus;
  errorReason?: string | null;
  conditionSummary?: string | null;
  scope: RuleScope;
  severity: Severity;
  stats7d?: { raised: number } | null;
  openAlarms?: number | null;
  updatedBy?: { userId: string; name: string } | null;
  updatedAt?: string | null;
}

/** API-RUL-05 */
export interface RuleTemplate {
  key: string;
  name: string;
  defaults: { condition: RuleCondition; severity: Severity; titleTemplate: string };
  requiredMetrics?: string[];
}

/** API-RUL-02/03 응답 */
export interface RuleSaveResult {
  ruleId: string;
  version: number;
  status: RuleStatus;
  targetCount: number;
  flowId?: string | null;
  warnings?: (string | { code: string; message?: string })[];
}

/** API-RUL-06 결과 */
export interface SimulationResult {
  alarms: number;
  notifications: number;
  avgDurationSec: number | null;
  byDevice: { deviceId: string; name: string; count: number; longestSec: number | null }[];
  heatmap: { dow: number; hour: number; count: number }[];
  coverage?: { dataRatio: number } | null;
}

/** API-RUL-08 */
export interface TuningSuggestion {
  tuningSuggestionId: string;
  ruleId: string;
  ruleName: string;
  problem: "TOO_FREQUENT" | "FLAPPING" | "UNACKNOWLEDGED";
  current: Record<string, unknown>;
  proposed: Record<string, unknown>;
  simulation: { alarmsBefore: number; alarmsAfter: number };
  status: "OPEN" | "APPLIED" | "DISMISSED";
  createdAt: string;
}

/** 측정 항목(API-DEV-50) 중 편집기가 쓰는 것 */
export interface MetricInfo {
  key: string;
  displayName?: string | null;
  unit?: string | null;
  valueType?: "NUMBER" | "BOOLEAN" | "ENUM" | string;
  validMin?: number | null;
  validMax?: number | null;
}

/** 범위 미리보기용 기기(API-DEV-11) */
export interface ScopeDevice {
  id: string;
  name: string;
  spaceId: string | null;
  modelCode: string | null;
  tags: string[];
  metrics: string[];
}
