/**
 * 분석(ANA) 화면이 쓰는 API 모양(design/api/ANA-api.md §1·§4·부록 A, spec/detail/ANA/domain-model.md). ID는 JSON 문자열이다.
 * core는 analytics 응답을 그대로 넘기므로 화면은 없는 필드를 견딘다(모두 선택).
 */

export type TemplateKind = "GENERAL" | "DOMAIN";
export type TemplateCategory = "ENV_QUALITY" | "SPACE_USAGE" | "ASSET_HEALTH" | "PREDICTION" | "GENERAL";
export const CATEGORIES: TemplateCategory[] = ["ENV_QUALITY", "SPACE_USAGE", "ASSET_HEALTH", "PREDICTION", "GENERAL"];

/** 입력 역할 선언(RoleSpec) */
export interface RoleSpec {
  name: string;
  type?: "series" | "multi_series" | "event" | "group";
  min?: number;
  max?: number;
  semantic?: string | null;
  required?: boolean;
  description?: string | null;
}

export interface Requirements {
  minPeriodDays?: number;
  minPoints?: number;
  missingWarn?: number;
  missingFail?: number;
  maxPoints?: number;
  maxPeriodDays?: number;
  recommendedResolution?: string;
}

/** API-ANA-01 항목 + API-ANA-03(score·matchedQuestion·mode) + API-ANA-04(runnable·missingRoles) */
export interface Template {
  key: string;
  version: string;
  name: string;
  kind: TemplateKind;
  category: TemplateCategory | string;
  summary?: string;
  questions?: string[];
  roles?: RoleSpec[];
  requirements?: Requirements;
  sampleImageUrl?: string | null;
  fast?: boolean;
  realtime?: boolean;
  trainable?: boolean;
  enabled?: boolean;
  score?: number;
  matchedQuestion?: string | null;
  mode?: "SEMANTIC" | "KEYWORD";
  runnable?: boolean;
  missingRoles?: { role: string; semantic?: string | null }[];
}

export interface GuideParam {
  name?: string;
  key?: string;
  label?: string;
  description?: string;
  default?: unknown;
  range?: string;
}

/** 설명서 9항목(ANA-01.06, API-ANA-02 `guide`) */
export interface TemplateGuide {
  summary?: string;
  whenToUse?: string[];
  whenNotToUse?: string[];
  dataRequirements?: (string | Record<string, unknown>)[];
  params?: GuideParam[];
  howToRead?: string;
  caveats?: string[];
  examples?: (string | Record<string, unknown>)[];
  algorithm?: string;
  references?: string[];
}

export interface JsonSchemaProperty {
  type?: "number" | "integer" | "string" | "boolean" | "array" | "object";
  title?: string;
  description?: string;
  default?: unknown;
  minimum?: number;
  maximum?: number;
  multipleOf?: number;
  enum?: (string | number)[];
  minLength?: number;
  maxLength?: number;
}

export interface ParamsSchema {
  type?: "object";
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
}

export interface TemplateDetail extends Template {
  paramsSchema?: ParamsSchema;
  guide?: TemplateGuide;
  guideMarkdown?: string;
  versions?: string[];
}

export type SourceKind = "DEVICE_METRIC" | "SPACE_AGGREGATE" | "DERIVED_METRIC";

/** 역할 후보(API-ANA-19) */
export interface Candidate {
  kind: SourceKind;
  deviceId?: string | null;
  spaceId?: string | null;
  metricKey: string;
  label: string;
  semantic?: string | null;
  unit?: string | null;
  lastSeenAt?: string | null;
}

export interface BindingSource {
  kind: SourceKind;
  deviceId?: string | null;
  spaceId?: string | null;
  metricKey: string;
  agg?: "avg" | "max" | "min";
  label: string;
}

export interface Binding {
  role: string;
  sources: BindingSource[];
}

export type Period = { type: "RELATIVE"; days: number } | { type: "FIXED"; from: string; to: string };
export type Resolution = "AUTO" | "RAW" | "1m" | "1h" | "1d";
export const RESOLUTIONS: Resolution[] = ["AUTO", "RAW", "1m", "1h", "1d"];
export type QualityFilter = "NORMAL_ONLY" | "INCLUDE_ALL";

export interface CheckIssue {
  code: string;
  severity?: "INFO" | "WARN" | "FAIL" | "ERROR" | string;
  message?: string;
  fix?: { type: "SET_RESOLUTION" | string; value?: string } | null;
}

/** API-ANA-05 충분성 확인 */
export interface CheckResult {
  level: "OK" | "WARN" | "FAIL";
  issues?: CheckIssue[];
  stats?: {
    points?: number;
    estimatedRawPoints?: number;
    missingRate?: number;
    qualityDistribution?: Record<string, number>;
    virtualPoints?: number;
    seriesCount?: number;
    effectiveResolution?: string;
  };
  limits?: { maxPoints?: number; maxSeries?: number; timeoutSec?: number };
}

export type Schedule = { preset: "DAILY" | "WEEKLY"; at: string; weekday?: number } | { cron: string };

/** API-ANA-06 응답(Analysis) */
export interface Analysis {
  analysisId: string;
  id?: string;
  name: string;
  templateKey: string;
  templateVersion?: string;
  bindings?: Binding[];
  period?: Period;
  resolution?: Resolution;
  qualityFilter?: QualityFilter;
  includeVirtual?: boolean;
  params?: Record<string, unknown>;
  schedule?: Schedule | null;
  scheduleState?: "ACTIVE" | "PAUSED" | "STOPPED_BY_FAILURE" | null;
  realtime?: boolean;
  owner?: { userId?: string; id?: string; name?: string };
  status?: "ACTIVE" | "ARCHIVED";
  version?: number;
  retrainPolicy?: string | null;
}

export type RunStatus = "QUEUED" | "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "TIMEOUT" | "CANCELLED";
export const ACTIVE_STATUSES: RunStatus[] = ["QUEUED", "PENDING", "RUNNING"];

/** API-ANA-07 목록 항목(core는 `id`와 `analysisId`를 함께 싣는다) */
export interface AnalysisSummary {
  id: string;
  analysisId?: string;
  name: string;
  templateKey: string;
  templateVersion?: string;
  targetSummary?: string | null;
  lastRun?: { id?: string; runId?: string; status: RunStatus; finishedAt?: string | null } | null;
  nextScheduledAt?: string | null;
  scheduleState?: string | null;
  realtime?: boolean;
  owner?: { id?: string; userId?: string; name?: string };
}

export interface Run {
  runId: string;
  analysisId?: string;
  status: RunStatus;
  trigger?: "MANUAL" | "SCHEDULE" | "API";
  progress?: number | null;
  stage?: "LOAD" | "COMPUTE" | "SAVE" | null;
  queuePosition?: number | null;
  estimatedStartAt?: string | null;
  periodFrom?: string | null;
  periodTo?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  errorDetail?: string | null;
  templateVersion?: string | null;
}

export interface Metric {
  key: string;
  label?: string;
  value: number | string | null;
  unit?: string | null;
  level?: "OK" | "WARN" | "FAIL" | "INFO" | string | null;
  /** 추정치·신뢰구간(ANA-08.02) */
  estimate?: boolean;
  lower?: number | null;
  upper?: number | null;
}

export interface TableColumn {
  key: string;
  label?: string;
  type?: "datetime" | "number" | "string" | string;
  unit?: string | null;
}

export interface TableSpec {
  id: string;
  title?: string;
  columns: TableColumn[];
  rows: Record<string, unknown>[];
}

export type ChartType = "line" | "band" | "scatter" | "bar" | "heatmap" | "calendar" | "gauge" | "table" | "timeline";

export interface ChartSeriesSpec {
  key: string;
  label?: string;
  data: [string | number, number | null][] | { x: (string | number)[]; y: (number | null)[] };
  style?: "line" | "area" | "dashed";
  color?: string;
}

/** 공통 렌더러 계약(ANA-api §4.2, ANA-05.02) */
export interface ChartSpec {
  id: string;
  type: ChartType;
  title?: string;
  xAxis?: { type?: "time" | "category" | "value"; label?: string; unit?: string };
  yAxis?: { type?: "time" | "category" | "value"; label?: string; unit?: string };
  series?: ChartSeriesSpec[];
  bands?: { key: string; lower: (number | null)[]; upper: (number | null)[]; label?: string; level?: number }[];
  markers?: { x: string | number; y: number; label?: string; severity?: string }[];
  regions?: { from: string | number; to: string | number; label?: string; severity?: string }[];
  thresholds?: { value: number; label?: string }[];
  heatmap?: { xLabels: string[]; yLabels: string[]; values: (number | null)[][]; unit?: string };
  calendar?: { days: [string, number | null, (number | string)?][] };
  gauge?: { value: number; min: number; max: number; ranges?: { from: number; to: number; level?: string }[] };
  timeline?: { items: { from: string; to: string; label?: string; state?: string }[] };
  table?: TableSpec;
  gaps?: boolean;
}

export interface Provenance {
  template?: string;
  bindings?: Binding[];
  period?: { from?: string; to?: string };
  resolution?: string;
  points?: number;
  missingRate?: number;
  qualityFilter?: QualityFilter;
  virtual?: boolean;
  seed?: number | null;
  datasetId?: string | null;
  datasetVersion?: number | null;
  algorithm?: string | null;
}

export interface Result {
  summary?: { headline?: string; level?: string; metrics?: Metric[]; estimate?: boolean };
  charts?: ChartSpec[];
  tables?: TableSpec[];
  evidence?: { baseline?: unknown; threshold?: number | null; contributors?: { seriesKey: string; weight: number }[] } | null;
  caveats?: string[];
  provenance?: Provenance;
  aiCommentaryId?: string | null;
  expiresAt?: string | null;
}

/** API-ANA-09 */
export interface RunWithResult {
  run: Run;
  result?: Result | null;
  resultExpired?: boolean;
}

/** API-ANA-13 */
export interface CompareResult {
  metrics?: { key: string; label?: string; base: number | null; target: number | null; diff: number | null; diffPct: number | null; direction?: "UP" | "DOWN" | "SAME" | string }[];
  versionMismatch?: boolean;
  charts?: ChartSpec[];
}

/** API-ANA-23 */
export interface ModelItem {
  modelId: string;
  analysisId: string;
  analysisName?: string;
  templateKey?: string;
  version: number;
  status: "TRAINING" | "CANDIDATE" | "ACTIVE" | "RETIRED" | "FAILED";
  trainFrom?: string | null;
  trainTo?: string | null;
  metrics?: Record<string, number | null>;
  trainedAt?: string | null;
  drift?: boolean;
}

/** API-ANA-12 */
export interface ExportResult {
  exportId?: string;
  downloadPath?: string;
  expiresAt?: string;
  exportJobId?: string;
}

/** 실행 상태 스트림(API-ANA-16) */
export interface RunStatusEvent {
  runId: string;
  status: RunStatus;
  progress?: number | null;
  stage?: string | null;
  queuePosition?: number | null;
}
