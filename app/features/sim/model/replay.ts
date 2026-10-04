/**
 * 실제 데이터 재생(UI-SIM-11, SIM-06.03): 파일 크기 검사(≤10MB, API-SIM-23·BFF 본문 한도와 같다), 열 매핑 검사, 재생 요청 본문(API-SIM-22).
 */
import type { Problem } from "./sim";

export const MAX_REPLAY_MB = 10;
export const MAX_REPLAY_BYTES = MAX_REPLAY_MB * 1024 * 1024;
export const REPLAY_EXTENSIONS = [".csv", ".jsonl", ".ndjson", ".json"];
export const TIME_FORMATS = ["ISO8601", "EPOCH_MS", "EPOCH_SEC", "yyyy-MM-dd HH:mm:ss"] as const;

export function checkReplayFile(file: { name: string; size: number } | null | undefined): Problem | undefined {
  if (!file || !file.name) return { key: "fileRequired" };
  if (file.size > MAX_REPLAY_BYTES) return { key: "fileTooLarge", values: { max: MAX_REPLAY_MB } };
  const lower = file.name.toLowerCase();
  if (!REPLAY_EXTENSIONS.some((ext) => lower.endsWith(ext))) return { key: "fileType" };
  return undefined;
}

export interface ColumnMapping {
  time: string;
  deviceId: string;
  /** 열 이름 → 측정 키 */
  metrics: Record<string, string>;
}

/** 측정 열(시각·기기 열과 빈 키는 뺀다) */
export function metricColumns(mapping: ColumnMapping): [string, string][] {
  return Object.entries(mapping.metrics)
    .filter(([column, key]) => column !== mapping.time && column !== mapping.deviceId && key.trim() !== "")
    .map(([column, key]) => [column, key.trim()]);
}

/** 시각·기기 열은 필수, 측정 열은 1개 이상, 측정 키는 영문 소문자·숫자·`_` */
export function checkMapping(mapping: ColumnMapping, columns: string[]): Record<string, Problem> {
  const out: Record<string, Problem> = {};
  if (!mapping.time || !columns.includes(mapping.time)) out.time = { key: "columnRequired" };
  if (!mapping.deviceId || !columns.includes(mapping.deviceId)) out.deviceId = { key: "columnRequired" };
  const metrics = metricColumns(mapping);
  if (metrics.length === 0) out.metrics = { key: "metricRequired" };
  for (const [column, key] of metrics) {
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(key.trim())) out[`metric.${column}`] = { key: "metricKey" };
  }
  return out;
}

/** 열 이름으로 첫 매핑 추측(시각: time·timestamp·measuredAt, 기기: device·deviceId·devEui) */
export function guessMapping(columns: string[]): ColumnMapping {
  const find = (names: string[]) => columns.find((c) => names.includes(c.toLowerCase())) ?? "";
  const time = find(["time", "timestamp", "measuredat", "measured_at", "ts"]);
  const deviceId = find(["deviceid", "device", "device_id", "deveui", "externalid"]);
  const metrics: Record<string, string> = {};
  for (const c of columns) if (c !== time && c !== deviceId) metrics[c] = /^[a-z][a-z0-9_]*$/.test(c) ? c : "";
  return { time, deviceId, metrics };
}

export interface ReplayOptions {
  fileId: string;
  mapping: ColumnMapping;
  timeFormat: string;
  basis: "NOW" | "AT";
  at?: string;
  acceleration: number;
  cloneSpaceId: string;
  cloneSuffix?: string;
}

export function replayBody(options: ReplayOptions): { body?: Record<string, unknown>; problems: Record<string, Problem> } {
  const problems: Record<string, Problem> = {};
  if (!options.cloneSpaceId) problems.cloneSpaceId = { key: "spaceRequired" };
  if (!Number.isInteger(options.acceleration) || options.acceleration < 1 || options.acceleration > 60) problems.acceleration = { key: "range", values: { min: 1, max: 60 } };
  if (options.basis === "AT" && (!options.at || Number.isNaN(Date.parse(options.at)))) problems.at = { key: "dateTime" };
  if (Object.keys(problems).length) return { problems };
  const metrics = Object.fromEntries(metricColumns(options.mapping));
  const body: Record<string, unknown> = {
    source: { type: "FILE", fileId: options.fileId, columnMapping: { time: options.mapping.time, deviceId: options.mapping.deviceId, metrics }, timeFormat: options.timeFormat },
    timeShift: options.basis === "AT" ? { basis: "AT", at: new Date(options.at as string).toISOString() } : { basis: "NOW" },
    acceleration: options.acceleration,
    cloneSpaceId: options.cloneSpaceId,
  };
  if (options.cloneSuffix) body.cloneSuffix = options.cloneSuffix;
  return { body, problems };
}
