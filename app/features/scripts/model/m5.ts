/**
 * 스크립트 M5 화면 모델: 테스트 케이스(UI-SCR-04, SCR-03.03), 설정값(SCR-04.02), 운영 지표·성능 경고(UI-SCR-05, SCR-03.05·05.03),
 * 로그 수집(SCR-05.02), 배포 후 재처리 제안(SCR-03.06), 공유 모듈 이름(UI-SCR-06). 화면 부품은 이 결과를 그리기만 한다.
 */
import type { ChartSeries } from "~/lib/chart-model";
import { byteSize, INPUT_LIMIT_BYTES, parseJsonInput } from "./script-model";

// ---------------------------------------------------------------- 테스트 케이스(API-SCR-10·11)

export const COMPARE_MODES = ["EXACT", "FIELDS", "TOLERANCE"] as const;
export type CompareMode = (typeof COMPARE_MODES)[number];
/** 스크립트당 테스트 케이스 한도(UI-SCR-04) */
export const MAX_TEST_CASES = 50;

export interface TestCase {
  id: string;
  name: string;
  input: unknown;
  context?: unknown;
  expected: unknown;
  compareMode: CompareMode;
  compareFields?: string[] | null;
  tolerance?: number | null;
  lastResult?: { passed: boolean; at?: string; diff?: unknown; versionNo?: number | null } | null;
  updatedAt?: string;
}

export interface CaseRunResult {
  caseId: string;
  name?: string;
  passed: boolean;
  diff?: unknown;
  durationMs?: number;
  error?: { code?: string; message?: string } | null;
}

export interface RunCasesResult {
  passed: number;
  failed: number;
  results: CaseRunResult[];
}

export interface TestCaseDraft {
  name: string;
  input: string;
  context: string;
  expected: string;
  compareMode: CompareMode;
  compareFields: string;
  tolerance: string;
}

export type CaseErrors = Partial<Record<keyof TestCaseDraft | "quota", string>>;

export interface TestCaseBody {
  name: string;
  input: unknown;
  context?: unknown;
  expected: unknown;
  compareMode: CompareMode;
  compareFields?: string[];
  tolerance?: number;
}

export function emptyCaseDraft(): TestCaseDraft {
  return { name: "", input: "{}", context: "", expected: "{}", compareMode: "EXACT", compareFields: "", tolerance: "0.01" };
}

export function caseDraftOf(testCase: TestCase): TestCaseDraft {
  const pretty = (value: unknown) => (value === undefined || value === null ? "" : JSON.stringify(value, null, 2));
  return {
    name: testCase.name,
    input: pretty(testCase.input) || "{}",
    context: pretty(testCase.context),
    expected: testCase.expected === null ? "null" : pretty(testCase.expected),
    compareMode: testCase.compareMode,
    compareFields: (testCase.compareFields ?? []).join(", "),
    tolerance: testCase.tolerance == null ? "0.01" : String(testCase.tolerance),
  };
}

/**
 * 케이스 입력 검증(UI-SCR-04): 이름 1~80자·고유, JSON 각 256KB 이하, 허용 오차 0~1000, 필드 지정이면 필드 하나 이상, 최대 50개.
 * 오류는 문구 키 이름(`scripts.cases.validation.{코드}`)으로 돌려준다
 */
export function checkTestCase(draft: TestCaseDraft, others: readonly { id: string; name: string }[], editingId: string | null): { errors: CaseErrors; body?: TestCaseBody } {
  const errors: CaseErrors = {};
  const name = draft.name.trim();
  if (name.length < 1 || name.length > 80) errors.name = "name";
  else if (others.some((c) => c.id !== editingId && c.name.trim() === name)) errors.name = "nameDuplicated";
  if (editingId === null && others.length >= MAX_TEST_CASES) errors.quota = "quota";
  const parse = (text: string, key: "input" | "context" | "expected", optional = false): unknown => {
    if (optional && !text.trim()) return undefined;
    const parsed = parseJsonInput(text, INPUT_LIMIT_BYTES);
    if (parsed.ok) return parsed.value;
    errors[key] = parsed.reason === "tooLarge" ? "jsonTooLarge" : "json";
    return undefined;
  };
  const input = parse(draft.input, "input");
  const context = parse(draft.context, "context", true);
  const expected = parse(draft.expected, "expected");
  const fields = draft.compareFields
    .split(",")
    .map((f) => f.trim())
    .filter(Boolean);
  if (draft.compareMode === "FIELDS" && fields.length === 0) errors.compareFields = "fields";
  let tolerance: number | undefined;
  if (draft.compareMode === "TOLERANCE") {
    tolerance = Number(draft.tolerance);
    if (!draft.tolerance.trim() || !Number.isFinite(tolerance) || tolerance < 0 || tolerance > 1000) errors.tolerance = "tolerance";
  }
  if (Object.keys(errors).length > 0) return { errors };
  return {
    errors,
    body: {
      name,
      input,
      ...(context === undefined ? {} : { context }),
      expected,
      compareMode: draft.compareMode,
      ...(draft.compareMode === "FIELDS" ? { compareFields: fields } : {}),
      ...(draft.compareMode === "TOLERANCE" ? { tolerance } : {}),
    },
  };
}

/** 실패 케이스 차이를 한 줄로("temperature 기대 85 / 실제 85.5"). 서버 diff는 {changed[{key, expected|from, actual|to}], missing[], extra[]} 등 */
export function caseDiffLines(diff: unknown): { key: string; expected?: unknown; actual?: unknown; kind: "changed" | "missing" | "extra" }[] {
  if (!diff || typeof diff !== "object") return [];
  const d = diff as Record<string, unknown>;
  const out: { key: string; expected?: unknown; actual?: unknown; kind: "changed" | "missing" | "extra" }[] = [];
  const arr = (value: unknown) => (Array.isArray(value) ? value : []);
  for (const item of arr(d.changed)) {
    const c = item as Record<string, unknown>;
    out.push({ key: String(c.key ?? c.path ?? ""), expected: "expected" in c ? c.expected : c.from, actual: "actual" in c ? c.actual : c.to, kind: "changed" });
  }
  for (const item of [...arr(d.missing), ...arr(d.removed)]) {
    const c = (typeof item === "object" && item ? item : { key: item }) as Record<string, unknown>;
    out.push({ key: String(c.key ?? c.path ?? ""), expected: c.expected ?? c.value, kind: "missing" });
  }
  for (const item of [...arr(d.extra), ...arr(d.added)]) {
    const c = (typeof item === "object" && item ? item : { key: item }) as Record<string, unknown>;
    out.push({ key: String(c.key ?? c.path ?? ""), actual: c.actual ?? c.value, kind: "extra" });
  }
  return out;
}

/** 저장할 케이스 이름 제안: "케이스 n" 형태로 겹치지 않게 */
export function nextCaseName(base: string, existing: readonly { name: string }[]): string {
  const names = new Set(existing.map((c) => c.name));
  for (let n = existing.length + 1; ; n += 1) {
    const candidate = `${base} ${n}`;
    if (!names.has(candidate)) return candidate;
  }
}

/** 강제 배포 사유 최소 길이(TC-SCR-049, 10자 이상) */
export const FORCE_REASON_MIN = 10;
export function checkForceReason(reason: string): boolean {
  const length = reason.trim().length;
  return length >= FORCE_REASON_MIN && length <= 200;
}

// ---------------------------------------------------------------- 설정값(API-SCR-22, SCR-04.02)

export type ConfigType = "string" | "number" | "boolean";
export interface ConfigRow {
  name: string;
  type: ConfigType;
  value: string;
}

export const MAX_CONFIG_ENTRIES = 50;
export const CONFIG_VALUE_LIMIT = 1024;
const CONFIG_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
/** 비밀값으로 보이는 이름(TC-SCR-070): apiToken, password, secret, *_key — 대소문자 무시 */
const SECRET_NAME = /(token|password|passwd|secret|_key$|apikey)/i;

export function configRowsOf(config: Record<string, unknown> | null | undefined): ConfigRow[] {
  return Object.entries(config ?? {}).map(([name, value]) => ({
    name,
    type: typeof value === "number" ? "number" : typeof value === "boolean" ? "boolean" : "string",
    value: typeof value === "string" ? value : String(value),
  }));
}

export function isSecretName(name: string): boolean {
  return SECRET_NAME.test(name);
}

/** 설정값 검증. 오류는 행 번호별 문구 키(`scripts.config.validation.{코드}`) */
export function checkConfig(rows: readonly ConfigRow[]): { errors: Record<number, string>; tooMany: boolean; config?: Record<string, string | number | boolean> } {
  const errors: Record<number, string> = {};
  const seen = new Set<string>();
  const config: Record<string, string | number | boolean> = {};
  rows.forEach((row, index) => {
    const name = row.name.trim();
    if (!CONFIG_NAME.test(name)) errors[index] = "name";
    else if (isSecretName(name)) errors[index] = "secret";
    else if (seen.has(name)) errors[index] = "duplicated";
    else if (byteSize(row.value) > CONFIG_VALUE_LIMIT) errors[index] = "tooLarge";
    else if (row.type === "number" && (!row.value.trim() || !Number.isFinite(Number(row.value)))) errors[index] = "number";
    else if (row.type === "boolean" && row.value !== "true" && row.value !== "false") errors[index] = "boolean";
    seen.add(name);
    if (!errors[index]) config[name] = row.type === "number" ? Number(row.value) : row.type === "boolean" ? row.value === "true" : row.value;
  });
  const tooMany = rows.length > MAX_CONFIG_ENTRIES;
  if (tooMany || Object.keys(errors).length > 0) return { errors, tooMany };
  return { errors, tooMany, config };
}

// ---------------------------------------------------------------- 운영 지표(API-SCR-12, SCR-03.05·05.03)

export interface StatsPoint {
  t: string;
  versionNo?: number | null;
  processed?: number | null;
  errors?: number | null;
  timeouts?: number | null;
  avgMs?: number | null;
  p95Ms?: number | null;
}

export interface StatsWarning {
  type: "ERROR_RATE" | "SLOW" | string;
  value?: number | null;
  hints?: string[] | null;
}

export interface ScriptStats {
  points: StatsPoint[];
  warnings: StatsWarning[];
  deployMarks: { versionNo: number; at: string }[];
}

/** 성능 경고 기준(SCR-05.03): 예열 후 p95 20ms 초과 */
export const SLOW_P95_MS = 20;

/** 목록 성능 경고 배지(SCR-05.03): 24시간 p95가 20ms 초과 */
export function isSlow(p95Ms: number | null | undefined): boolean {
  return p95Ms != null && p95Ms > SLOW_P95_MS;
}

export const STATS_PERIODS = { "1h": { hours: 1, step: "1m" }, "24h": { hours: 24, step: "1m" }, "7d": { hours: 168, step: "1h" } } as const;
export type StatsPeriod = keyof typeof STATS_PERIODS;

export function statsRange(period: StatsPeriod, nowMs: number): { from: string; to: string; step: string } {
  const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
  return { from: iso(nowMs - STATS_PERIODS[period].hours * 3600_000), to: iso(nowMs), step: STATS_PERIODS[period].step };
}

export interface VersionStats {
  versionNo: number;
  processed: number;
  errors: number;
  errorRate: number;
  avgMs: number | null;
  p95Ms: number | null;
}

/** 버전별 합계: 처리·오류는 합, 평균은 처리 건수 가중 평균, p95는 구간 최댓값(보수적) */
export function statsByVersion(points: readonly StatsPoint[]): VersionStats[] {
  const map = new Map<number, { processed: number; errors: number; weighted: number; weight: number; p95: number | null }>();
  for (const p of points) {
    const version = p.versionNo ?? 0;
    const row = map.get(version) ?? { processed: 0, errors: 0, weighted: 0, weight: 0, p95: null };
    const processed = p.processed ?? 0;
    row.processed += processed;
    row.errors += (p.errors ?? 0) + (p.timeouts ?? 0);
    if (p.avgMs != null && processed > 0) {
      row.weighted += p.avgMs * processed;
      row.weight += processed;
    }
    if (p.p95Ms != null) row.p95 = row.p95 == null ? p.p95Ms : Math.max(row.p95, p.p95Ms);
    map.set(version, row);
  }
  return [...map.entries()]
    .sort(([a], [b]) => b - a)
    .map(([versionNo, r]) => ({
      versionNo,
      processed: r.processed,
      errors: r.errors,
      errorRate: r.processed > 0 ? r.errors / r.processed : 0,
      avgMs: r.weight > 0 ? Math.round((r.weighted / r.weight) * 100) / 100 : null,
      p95Ms: r.p95,
    }));
}

/**
 * 경고 배지(UI-SCR-05). 서버(pipeline) 경고를 그대로 쓰고, 서버가 SLOW를 주지 않았는데 가장 최근 p95가 20ms를 넘으면 SLOW를 더한다.
 * 최근 p95가 20ms 이하이면 SLOW 배지는 사라진다(SCR-05.03)
 */
export function effectiveWarnings(stats: Pick<ScriptStats, "points" | "warnings">): StatsWarning[] {
  const latest = [...stats.points].reverse().find((p) => p.p95Ms != null);
  const warnings = stats.warnings.filter((w) => w.type !== "SLOW" || latest == null || (latest.p95Ms ?? 0) > SLOW_P95_MS);
  if (latest && (latest.p95Ms ?? 0) > SLOW_P95_MS && !warnings.some((w) => w.type === "SLOW")) warnings.push({ type: "SLOW", value: latest.p95Ms, hints: [] });
  return warnings;
}

/** 오류율 경고 값: 0~1 비율이면 %로, 이미 %면 그대로 */
export function asPercent(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return 0;
  return value <= 1 ? value * 100 : value;
}

/** 원인 후보 코드(pipeline 힌트 LARGE_LOOP·LARGE_INPUT 등)를 문구 키로. 모르는 힌트는 원문 */
export const KNOWN_HINTS = ["LARGE_LOOP", "LARGE_INPUT"] as const;

export function statsSeries(points: readonly StatsPoint[], labels: { processed: string; errors: string; avg: string; p95: string }): ChartSeries[] {
  const series = (key: string, label: string, unit: string, pick: (p: StatsPoint) => number | null | undefined): ChartSeries => ({
    key,
    label,
    unit,
    points: points.map((p) => [p.t, pick(p) ?? null, null]),
  });
  return [
    series("processed", labels.processed, "count", (p) => p.processed),
    series("errors", labels.errors, "count", (p) => (p.errors ?? 0) + (p.timeouts ?? 0)),
    series("avgMs", labels.avg, "ms", (p) => p.avgMs),
    series("p95Ms", labels.p95, "ms", (p) => p.p95Ms),
  ];
}

// ---------------------------------------------------------------- 로그 수집(API-SCR-14, SCR-05.02)

/** 남은 시간(초). 지났거나 없으면 0 */
export function remainingSeconds(until: string | null | undefined, nowMs: number): number {
  if (!until) return 0;
  const end = Date.parse(until);
  return Number.isFinite(end) ? Math.max(0, Math.ceil((end - nowMs) / 1000)) : 0;
}

export function formatRemaining(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// ---------------------------------------------------------------- 배포 후 재처리(API-SCR-05 reprocessSuggestion, SCR-03.06)

export interface ReprocessRequestBody {
  sourceId?: string | number | null;
  deviceIds?: (string | number)[] | null;
  from?: string | null;
  to?: string | null;
  memo?: string | null;
}

export interface ReprocessSuggestion {
  from?: string | null;
  to?: string | null;
  requests?: ReprocessRequestBody[] | null;
}

/** 재처리 화면(UI-ING-05) 미리 채움 주소 */
export function reprocessLink(request: ReprocessRequestBody): string {
  const query = new URLSearchParams();
  if (request.sourceId != null) query.set("sourceId", String(request.sourceId));
  if (request.deviceIds && request.deviceIds.length > 0) query.set("deviceIds", request.deviceIds.join(","));
  if (request.from) query.set("from", request.from);
  if (request.to) query.set("to", request.to);
  if (request.memo) query.set("memo", request.memo);
  return `/ingest/reprocess?${query}`;
}

// ---------------------------------------------------------------- 공유 모듈(API-SCR-18·19, UI-SCR-06)

const MODULE_NAME = /^[a-z0-9-]{3,40}$/;
export function checkModuleName(name: string): boolean {
  return MODULE_NAME.test(name.trim());
}

/** 모듈 코드 예시(export function 형식) */
export const MODULE_TEMPLATE = "export function parseChannels(bytes) {\n  // 채널 ID·유형·값을 해석합니다\n  return [];\n}\n";

/** 이 모듈 버전을 가져오는 import 줄(편집기 안내용) */
export function moduleImportLine(name: string, versionNo: number | null | undefined): string {
  return `import { … } from 'module:${name}@${versionNo ?? 1}';`;
}
