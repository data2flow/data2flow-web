/**
 * 데이터 가져오기 화면 모델(UI-TSD-03, TSD-04.02). API-TSD-30 만들기(CSV multipart: file·mapping·dryRun·originLabel / InfluxDB JSON),
 * API-TSD-31 상세·오류, API-TSD-32 실행. 가져오기는 먼저 미리 실행(dryRun)하고, 결과를 보고 실행한다.
 * 매핑 모양은 core `ImportMapping`(넓은 형식 metricColumns[{column, metricKey}] 또는 긴 형식 metricColumn·valueColumn)과 같다.
 */
import { localToUtc } from "~/features/explore/model/time";

export type ImportStatus = "QUEUED" | "VALIDATING" | "DRY_RUN_DONE" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";

export interface ImportJob {
  id: string;
  sourceKind: "CSV" | "INFLUXDB";
  status: ImportStatus;
  dryRun: boolean;
  total?: number | null;
  inserted?: number | null;
  skippedDuplicate?: number | null;
  failed?: number | null;
  originLabel?: string | null;
  sample?: Record<string, unknown>[] | null;
  error?: string | null;
  rangeFrom?: string | null;
  rangeTo?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  createdAt: string;
}

export interface ImportError {
  lineOrPoint: string;
  errorCode: string;
  message?: string | null;
}

export const TIME_FORMATS = ["ISO", "EPOCH_S", "EPOCH_MS", "CUSTOM"] as const;
export const DEVICE_KEYS = ["EXTERNAL_ID", "ID", "NAME"] as const;
/** 미리 보기 줄 수(UI-TSD-03 "앞 20행 미리 보기") */
export const PREVIEW_ROWS = 20;
/** UI-TSD-03 "≤2GB" */
export const MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024;

const RUNNING: ReadonlySet<string> = new Set(["QUEUED", "VALIDATING", "RUNNING"]);
export const isRunningImport = (job: Pick<ImportJob, "status">) => RUNNING.has(job.status);
/** 미리 실행이 끝나 실제 실행을 기다린다 */
export const canRun = (job: Pick<ImportJob, "status" | "dryRun">) => job.status === "DRY_RUN_DONE";

export function importTone(status: string): "success" | "warning" | "danger" | "info" | "neutral" {
  if (status === "SUCCEEDED") return "success";
  if (status === "FAILED") return "danger";
  if (status === "CANCELLED") return "neutral";
  if (status === "DRY_RUN_DONE") return "info";
  return "warning";
}

/** CSV 몇 줄을 칸으로 나눈다(큰따옴표 안의 구분자·줄바꿈·"" 처리) */
export function parseCsv(text: string, delimiter = ",", maxRows = PREVIEW_ROWS + 1): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const body = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < body.length && rows.length < maxRows; i += 1) {
    const ch = body[i];
    if (quoted) {
      if (ch === '"' && body[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cell += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && body[i + 1] === "\n") i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if ((cell !== "" || row.length > 0) && rows.length < maxRows) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

export interface CsvMappingForm {
  delimiter: string;
  timeColumn: string;
  timeFormat: (typeof TIME_FORMATS)[number];
  customPattern: string;
  tz: string;
  deviceColumn: string;
  deviceKey: (typeof DEVICE_KEYS)[number];
  shape: "WIDE" | "LONG";
  metricColumns: { column: string; metricKey: string }[];
  metricColumn: string;
  valueColumn: string;
}

/** 머리 줄로 매핑을 짐작한다: time·timestamp → 시각, device·devEui → 기기, metric+value가 있으면 긴 형식, 나머지는 측정 항목 열 */
export function guessMapping(header: string[], tz: string): CsvMappingForm {
  const find = (re: RegExp) => header.find((h) => re.test(h.trim())) ?? "";
  const timeColumn = find(/^(time|timestamp|measured_?at|_time)$/i) || header[0] || "";
  const deviceColumn = find(/^(device(_?id)?|dev_?eui|device_name|external_?id)$/i);
  const metricColumn = find(/^(metric|metric_?key|field|_field)$/i);
  const valueColumn = find(/^(value|_value)$/i);
  const long = Boolean(metricColumn && valueColumn);
  const rest = header.filter((h) => h && ![timeColumn, deviceColumn, metricColumn, valueColumn].includes(h));
  return {
    delimiter: ",",
    timeColumn,
    timeFormat: "ISO",
    customPattern: "",
    tz,
    deviceColumn,
    deviceKey: /name/i.test(deviceColumn) ? "NAME" : "EXTERNAL_ID",
    shape: long ? "LONG" : "WIDE",
    metricColumns: long ? [] : rest.map((column) => ({ column, metricKey: column.trim() })),
    metricColumn,
    valueColumn,
  };
}

export type CsvErrors = Partial<Record<"file" | "originLabel" | "timeColumn" | "deviceColumn" | "metricColumns" | "customPattern" | "delimiter", string>>;

/** 입력 검증(UI-TSD-03): 출처 라벨 필수, 파일, 시각·기기·측정 항목 열 */
export function validateCsv(form: CsvMappingForm, originLabel: string, file: { size: number } | null | undefined): CsvErrors {
  const errors: CsvErrors = {};
  if (!file) errors.file = "required";
  else if (file.size > MAX_FILE_BYTES) errors.file = "tooLarge";
  if (!originLabel.trim()) errors.originLabel = "required";
  if (form.delimiter.length !== 1) errors.delimiter = "required";
  if (!form.timeColumn) errors.timeColumn = "required";
  if (form.timeFormat === "CUSTOM" && !form.customPattern.trim()) errors.customPattern = "required";
  if (!form.deviceColumn) errors.deviceColumn = "required";
  if (form.shape === "LONG" ? !form.metricColumn || !form.valueColumn : form.metricColumns.filter((m) => m.metricKey.trim()).length === 0) errors.metricColumns = "required";
  return errors;
}

/** API-TSD-30 `mapping`(JSON 문자열로 보낸다) */
export function mappingOf(form: CsvMappingForm) {
  return {
    timeColumn: form.timeColumn,
    timeFormat: form.timeFormat === "CUSTOM" ? form.customPattern.trim() : form.timeFormat,
    tz: form.tz || null,
    deviceColumn: form.deviceColumn,
    deviceKey: form.deviceKey,
    ...(form.shape === "LONG"
      ? { metricColumn: form.metricColumn, valueColumn: form.valueColumn }
      : { metricColumns: form.metricColumns.filter((m) => m.column && m.metricKey.trim()).map((m) => ({ column: m.column, metricKey: m.metricKey.trim() })) }),
    delimiter: form.delimiter,
  };
}

/** ISO-8601 날짜·시각(`T` 구분, 초·소수·오프셋 선택) — core `ImportMapping` ISO와 같은 범위 */
const ISO_TIME = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

/** 미리 보기 행 중 시각을 읽을 수 없는 줄 번호(머리 줄이 1번, UI-TSD-03 "시각 형식 파싱 실패 줄 표시"). 사용자 형식은 서버가 판단한다 */
export function badTimeLines(rows: string[][], form: Pick<CsvMappingForm, "timeColumn" | "timeFormat">): number[] {
  const [header, ...data] = rows;
  const index = header?.indexOf(form.timeColumn) ?? -1;
  if (index < 0 || form.timeFormat === "CUSTOM") return [];
  const bad: number[] = [];
  data.forEach((row, i) => {
    const value = (row[index] ?? "").trim();
    const ok = form.timeFormat === "ISO" ? ISO_TIME.test(value) && !Number.isNaN(Date.parse(value)) : /^\d+(\.\d+)?$/.test(value);
    if (!ok) bad.push(i + 2);
  });
  return bad;
}

export interface InfluxForm {
  url: string;
  org: string;
  bucket: string;
  token: string;
  measurement: string;
  /** 표시 시간대 `YYYY-MM-DDTHH:mm` */
  from: string;
  to: string;
  deviceTag: string;
  fields: { field: string; metricKey: string }[];
}

export function emptyInfluxForm(): InfluxForm {
  return { url: "", org: "", bucket: "", token: "", measurement: "", from: "", to: "", deviceTag: "device_id", fields: [{ field: "", metricKey: "" }] };
}

export type InfluxErrors = Partial<Record<"url" | "org" | "bucket" | "token" | "range" | "originLabel", string>>;

/** 입력 검증(UI-TSD-03): InfluxDB URL은 http/https, 필수 값, 기간 시작 < 끝 */
export function validateInflux(form: InfluxForm, originLabel: string, timezone: string): InfluxErrors {
  const errors: InfluxErrors = {};
  if (!/^https?:\/\/[^\s/]+/i.test(form.url.trim())) errors.url = "url";
  if (!form.org.trim()) errors.org = "required";
  if (!form.bucket.trim()) errors.bucket = "required";
  if (!form.token.trim()) errors.token = "required";
  if (!originLabel.trim()) errors.originLabel = "required";
  const from = localToUtc(form.from, timezone);
  const to = localToUtc(form.to, timezone);
  if (!from || !to || Date.parse(from) >= Date.parse(to)) errors.range = "order";
  return errors;
}

/** API-TSD-30 InfluxDB 본문. 토큰은 쓰기 전용이다 */
export function influxBody(form: InfluxForm, originLabel: string, timezone: string, dryRun = true) {
  const fieldMapping: Record<string, string> = {};
  for (const f of form.fields) if (f.field.trim() && f.metricKey.trim()) fieldMapping[f.field.trim()] = f.metricKey.trim();
  return {
    url: form.url.trim(),
    org: form.org.trim(),
    bucket: form.bucket.trim(),
    token: form.token,
    ...(form.measurement.trim() ? { measurement: form.measurement.trim() } : {}),
    from: localToUtc(form.from, timezone),
    to: localToUtc(form.to, timezone),
    tagMapping: { deviceTag: form.deviceTag.trim() || "device_id" },
    ...(Object.keys(fieldMapping).length ? { fieldMapping } : {}),
    dryRun,
    originLabel: originLabel.trim(),
  };
}

/** 진행률(%): 처리(삽입+중복+실패) / 전체 */
export function importPercent(job: Pick<ImportJob, "total" | "inserted" | "skippedDuplicate" | "failed" | "status">): number {
  if (job.status === "SUCCEEDED") return 100;
  const total = job.total ?? 0;
  if (total <= 0) return 0;
  const done = (job.inserted ?? 0) + (job.skippedDuplicate ?? 0) + (job.failed ?? 0);
  return Math.max(0, Math.min(100, Math.round((done / total) * 100)));
}

/** 오류 목록을 CSV로(UI-TSD-03 "오류 목록 내려받기") */
export function errorsCsv(errors: ImportError[]): string {
  const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return ["line,code,message", ...errors.map((e) => [e.lineOrPoint, e.errorCode, e.message ?? ""].map((v) => cell(String(v))).join(","))].join("\n");
}
