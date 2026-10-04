/**
 * 내보내기 작업·정기 내보내기 화면 모델(UI-TSD-02, UI-TSD-08, TSD-04.01, TSD-04.03, TSD-07.02).
 * API: API-TSD-20 내보내기 만들기, API-TSD-21·22 작업 목록·취소, API-TSD-23 정기 내보내기, API-TSD-56 전달 대상 연결 테스트.
 * 내보내기 `query`는 API-TSD-04 본문 그대로다(탐색기 조회 조건을 그대로 넘긴다).
 */

export const EXPORT_FORMATS = ["CSV", "XLSX"] as const;
export const SCHEDULE_FORMATS = ["CSV", "XLSX", "PARQUET"] as const;
export const EXPORT_COLUMNS = ["LONG", "WIDE"] as const;
export const RELATIVE_PERIODS = ["PREVIOUS_DAY", "PREVIOUS_WEEK", "PREVIOUS_MONTH"] as const;
export const REPEAT_KINDS = ["DAILY", "WEEKLY", "MONTHLY"] as const;
export const TARGET_TYPES = ["S3", "SFTP"] as const;
/** 동시에 진행할 수 있는 비동기 내보내기(UI-TSD-02 입력 검증) */
export const MAX_ACTIVE_JOBS = 3;
/** BR-TSD-14: 예상 100만 행 이하면 바로 내려받는다(30초 안에 끝나면) */
export const SYNC_ROW_LIMIT = 1_000_000;

export type ExportFormat = (typeof SCHEDULE_FORMATS)[number];
export type ExportColumns = (typeof EXPORT_COLUMNS)[number];
export type ExportStatus = "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "EXPIRED" | "CANCELLED";

/** API-TSD-04 본문(탐색기 조회 조건) */
export interface TelemetryQuery {
  series: { deviceId?: string; spaceId?: string; metric: string; agg?: string; label?: string }[];
  from: string;
  to: string;
  resolution?: string;
  fill?: string;
  quality?: string;
  virtual?: boolean;
  tz?: string;
}

/** API-TSD-21 작업 */
export interface ExportJob {
  id: string;
  status: ExportStatus;
  format: string;
  query?: Partial<TelemetryQuery> | null;
  rows?: number | null;
  bytes?: number | null;
  dictionaryVersion?: number | null;
  expiresAt?: string | null;
  downloadUrl?: string | null;
  error?: string | null;
  requestedBy?: string | null;
  scheduleId?: string | null;
  estimatedRows?: number | null;
  createdAt: string;
  finishedAt?: string | null;
}

/** API-TSD-20 응답 */
export interface ExportCreated {
  mode: "SYNC" | "ASYNC";
  jobId?: string | null;
  downloadUrl?: string | null;
  estimatedRows?: number;
}

export interface ExportOptions {
  format: (typeof EXPORT_FORMATS)[number];
  columns: ExportColumns;
  includeQuality: boolean;
  tz: string;
}

/** API-TSD-23 일정 */
export interface ExportSchedule {
  id: string;
  name: string;
  query: Partial<TelemetryQuery> | null;
  format: string;
  cron: string;
  relativePeriod: string;
  delivery: "EMAIL" | "STORAGE";
  recipients: string[];
  targetType?: "S3" | "SFTP" | null;
  target?: Record<string, unknown> | null;
  credentialRef?: string | null;
  credentialConfigured?: boolean;
  enabled: boolean;
  lastRunAt?: string | null;
  lastStatus?: string | null;
  lastError?: string | null;
  nextRunAt?: string | null;
  lastFileVersion?: number;
  version: number;
  createdBy?: string;
}

/** API-TSD-56 응답 */
export interface TargetTestResult {
  ok: boolean;
  steps: { name: string; ok: boolean; detail?: string | null }[];
}

const ACTIVE: ReadonlySet<string> = new Set(["QUEUED", "RUNNING"]);

export const isActiveJob = (job: Pick<ExportJob, "status">) => ACTIVE.has(job.status);
export const activeJobCount = (jobs: Pick<ExportJob, "status">[]) => jobs.filter(isActiveJob).length;

export function statusTone(status: string): "success" | "warning" | "danger" | "info" | "neutral" {
  if (status === "SUCCEEDED") return "success";
  if (status === "FAILED") return "danger";
  if (status === "CANCELLED" || status === "EXPIRED") return "neutral";
  if (status === "RUNNING") return "info";
  return "warning";
}

/** core가 주는 다운로드 주소(`/api/v1/core/exports/{id}/file?expires=&signature=`)를 브라우저가 부를 BFF 주소로 */
export function bffDownloadUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  const replaced = url.replace(/^(https?:\/\/[^/]+)?\/api\/v1\//, "/bff/api/");
  return replaced.startsWith("/bff/api/") ? replaced : undefined;
}

export function exportBody(query: TelemetryQuery, options: ExportOptions) {
  return { query: { ...query, tz: options.tz }, format: options.format, columns: options.columns, includeQuality: options.includeQuality, tz: options.tz };
}

const STEP_SEC: Record<string, number> = { raw: 60, "1m": 60, "1h": 3600, "1d": 86400 };

/**
 * 예상 행 수(대화상자 안내). 원본은 1분 간격으로 어림한다. 긴 형식은 계열 수만큼 곱하고, 넓은 형식은 시각 수만 센다.
 * 실제 값은 API-TSD-20 응답 `estimatedRows`가 정한다
 */
export function estimateRows(query: Pick<TelemetryQuery, "series" | "from" | "to" | "resolution">, columns: ExportColumns, resolutionUsed?: string): number {
  const span = Math.max(0, (Date.parse(query.to) - Date.parse(query.from)) / 1000);
  if (!Number.isFinite(span) || query.series.length === 0) return 0;
  const resolution = resolutionUsed ?? (query.resolution && query.resolution !== "auto" ? query.resolution : autoResolution(span));
  const buckets = Math.ceil(span / (STEP_SEC[resolution] ?? 3600));
  return columns === "LONG" ? buckets * query.series.length : buckets;
}

/** BR-TSD-08 자동 단위(기간 6시간 이하 원본, 2일 이하 1분, 60일 이하 1시간, 그 밖은 1일) */
export function autoResolution(spanSec: number): string {
  if (spanSec <= 6 * 3600) return "raw";
  if (spanSec <= 2 * 86400) return "1m";
  if (spanSec <= 60 * 86400) return "1h";
  return "1d";
}

/** CSV 열 머리(API-TSD-20 "CSV 형식") */
export function exportHeader(columns: ExportColumns, includeQuality: boolean, labels: string[]): string[] {
  if (columns === "WIDE") return ["time", ...labels];
  return ["time", "device_id", "device_name", "space_path", "metric", "value", "unit", ...(includeQuality ? ["quality"] : [])];
}

/** 예시 미리 보기 3행(UI-TSD-02 "열 형태 … 예시 미리 보기 3행") */
export function previewLines(columns: ExportColumns, includeQuality: boolean, series: { id: string; label: string; metric: string; unit?: string | null }[]): string[] {
  const head = exportHeader(
    columns,
    includeQuality,
    series.map((s) => `${s.label}`),
  );
  const times = ["2026-10-03T00:00:00+09:00", "2026-10-03T01:00:00+09:00", "2026-10-03T02:00:00+09:00"];
  const lines = [head.join(",")];
  if (columns === "WIDE") {
    times.forEach((time, i) => lines.push([time, ...series.map((_, j) => (21.5 + i * 0.3 + j).toFixed(1))].join(",")));
  } else {
    const rows = times.map((time, i) => ({ time, s: series[i % Math.max(1, series.length)] }));
    for (const { time, s } of rows) {
      if (!s) continue;
      lines.push([time, s.id, csvCell(s.label), "", s.metric, "21.5", s.unit ?? "", ...(includeQuality ? ["0"] : [])].join(","));
    }
  }
  return lines;
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

// ---------- 정기 내보내기(API-TSD-23) ----------

export interface Repeat {
  kind: (typeof REPEAT_KINDS)[number] | "";
  /** HH:mm(조직 시간대) */
  time: string;
  /** 0=일 … 6=토 */
  weekday: number;
  /** 1~28 */
  day: number;
}

/** 반복 → cron 5필드(분 시 일 월 요일). core는 5필드면 초 0을 붙인다 */
export function cronOf(repeat: Repeat): string | undefined {
  const match = /^(\d{1,2}):(\d{2})$/.exec(repeat.time);
  if (!repeat.kind || !match) return undefined;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return undefined;
  if (repeat.kind === "DAILY") return `${minute} ${hour} * * *`;
  if (repeat.kind === "WEEKLY") return `${minute} ${hour} * * ${repeat.weekday}`;
  return `${minute} ${hour} ${repeat.day} * *`;
}

/** cron → 반복(화면에서 고칠 수 있는 모양만). 모르는 모양이면 null */
export function repeatOf(cron: string | null | undefined): Repeat | null {
  const parts = (cron ?? "").trim().split(/\s+/);
  const fields = parts.length === 6 ? parts.slice(1) : parts;
  if (fields.length !== 5) return null;
  const [minute, hour, day, month, weekday] = fields;
  if (!/^\d+$/.test(minute) || !/^\d+$/.test(hour) || month !== "*") return null;
  const time = `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
  if (day === "*" && weekday === "*") return { kind: "DAILY", time, weekday: 1, day: 1 };
  if (day === "*" && /^[0-6]$/.test(weekday)) return { kind: "WEEKLY", time, weekday: Number(weekday), day: 1 };
  if (/^\d+$/.test(day) && weekday === "*") return { kind: "MONTHLY", time, weekday: 1, day: Number(day) };
  return null;
}

export interface ScheduleForm {
  name: string;
  repeat: Repeat;
  relativePeriod: (typeof RELATIVE_PERIODS)[number];
  format: ExportFormat;
  delivery: "EMAIL" | "STORAGE";
  recipients: string;
  targetType: "S3" | "SFTP";
  target: Record<string, string>;
  credential: Record<string, string>;
  enabled: boolean;
}

export function emptyScheduleForm(): ScheduleForm {
  return {
    name: "",
    repeat: { kind: "DAILY", time: "07:00", weekday: 1, day: 1 },
    relativePeriod: "PREVIOUS_DAY",
    format: "CSV",
    delivery: "EMAIL",
    recipients: "",
    targetType: "S3",
    target: {},
    credential: {},
    enabled: true,
  };
}

export function formOfSchedule(s: ExportSchedule): ScheduleForm {
  const base = emptyScheduleForm();
  const target: Record<string, string> = {};
  for (const [k, v] of Object.entries(s.target ?? {})) if (v !== null && v !== undefined) target[k] = String(v);
  return {
    ...base,
    name: s.name,
    repeat: repeatOf(s.cron) ?? base.repeat,
    relativePeriod: (RELATIVE_PERIODS as readonly string[]).includes(s.relativePeriod) ? (s.relativePeriod as ScheduleForm["relativePeriod"]) : base.relativePeriod,
    format: (SCHEDULE_FORMATS as readonly string[]).includes(s.format) ? (s.format as ExportFormat) : "CSV",
    delivery: s.delivery,
    recipients: s.recipients.join(", "),
    targetType: s.targetType ?? "S3",
    target,
    enabled: s.enabled,
  };
}

/** 대상 종류별 설정·자격 필드(core DeliveryTargets: S3 {endpoint, bucket, region?, prefix?} + {accessKey, secretKey}, SFTP {host, port?, username, directory?, hostKeySha256?} + {password}) */
export const TARGET_FIELDS: Record<"S3" | "SFTP", { target: { key: string; required: boolean }[]; credential: string[] }> = {
  S3: {
    target: [
      { key: "endpoint", required: true },
      { key: "bucket", required: true },
      { key: "region", required: false },
      { key: "prefix", required: false },
    ],
    credential: ["accessKey", "secretKey"],
  },
  SFTP: {
    target: [
      { key: "host", required: true },
      { key: "port", required: false },
      { key: "username", required: true },
      { key: "directory", required: false },
      { key: "hostKeySha256", required: false },
    ],
    credential: ["password"],
  },
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function splitRecipients(value: string): string[] {
  return value
    .split(/[,;\s]+/)
    .map((v) => v.trim())
    .filter(Boolean);
}

export type ScheduleErrors = Partial<Record<"name" | "repeat" | "recipients" | "target" | "query", string>>;

/** 입력 검증(UI-TSD-02): 이름, 반복 규칙 필수, 수신자 메일 형식, 저장소 대상 필수 값 */
export function validateSchedule(form: ScheduleForm, hasQuery: boolean): ScheduleErrors {
  const errors: ScheduleErrors = {};
  if (!form.name.trim() || form.name.trim().length > 100) errors.name = "required";
  if (!cronOf(form.repeat)) errors.repeat = "required";
  if (!hasQuery) errors.query = "required";
  if (form.delivery === "EMAIL") {
    const list = splitRecipients(form.recipients);
    if (list.length === 0) errors.recipients = "required";
    else if (list.length > 20 || list.some((m) => !EMAIL.test(m))) errors.recipients = "email";
  } else if (TARGET_FIELDS[form.targetType].target.some((f) => f.required && !(form.target[f.key] ?? "").trim())) {
    errors.target = "required";
  }
  return errors;
}

function cleanTarget(form: ScheduleForm): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of TARGET_FIELDS[form.targetType].target) {
    const v = (form.target[f.key] ?? "").trim();
    if (!v) continue;
    out[f.key] = f.key === "port" ? Number(v) : v;
  }
  return out;
}

function cleanCredential(form: ScheduleForm): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const key of TARGET_FIELDS[form.targetType].credential) if ((form.credential[key] ?? "").trim()) out[key] = form.credential[key].trim();
  return Object.keys(out).length ? out : undefined;
}

/** API-TSD-23 본문. 자격은 입력했을 때만 보낸다(저장된 자격은 다시 받지 않는다) */
export function scheduleBody(form: ScheduleForm, query: Partial<TelemetryQuery> | null | undefined): Record<string, unknown> {
  const body: Record<string, unknown> = {
    name: form.name.trim(),
    format: form.format,
    cron: cronOf(form.repeat),
    relativePeriod: form.relativePeriod,
    delivery: form.delivery,
    enabled: form.enabled,
  };
  if (query) body.query = withoutRange(query);
  if (form.delivery === "EMAIL") {
    body.recipients = splitRecipients(form.recipients);
  } else {
    body.targetType = form.targetType;
    body.target = cleanTarget(form);
    const credential = cleanCredential(form);
    if (credential) body.credential = credential;
  }
  return body;
}

/** 정기 내보내기는 기간을 실행 때 정하므로(relativePeriod) 조회 조건에서 from·to를 뺀다 */
export function withoutRange(query: Partial<TelemetryQuery>): Partial<TelemetryQuery> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- 기간은 일정이 정한다
  const { from, to, ...rest } = query;
  return rest;
}

/** API-TSD-56 본문 */
export function testTargetBody(form: ScheduleForm) {
  return { targetType: form.targetType, target: cleanTarget(form), credential: cleanCredential(form) ?? null };
}

/** 조회 조건 요약(계열 수·기간·단위) */
export function querySummary(query: Partial<TelemetryQuery> | null | undefined): { series: number; from?: string; to?: string; resolution?: string } {
  return { series: query?.series?.length ?? 0, from: query?.from, to: query?.to, resolution: query?.resolution };
}
