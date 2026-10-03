/**
 * 수집 모니터·실패 메시지 화면 모델(UI-DSH-03, UI-ING-01, UI-ING-04).
 * API: API-ING-01 요약, API-DSH-05 흐름 스냅샷, API-ING-08 실패 목록, 실시간 API-DSH-20(topic `ingest`)·API-DSH-21(topic `ingest-messages`).
 */
import type { ChartSeries } from "~/lib/chart-model";

export const PIPELINE_STAGES = ["SOURCE", "DECODE", "SCRIPT", "VALIDATE", "STORE", "EVENT"] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

/** 실패 메시지 단계(API-ING-08 stage) */
export const FAILURE_STAGES = ["DECODE", "SCRIPT", "STORE", "PUBLISH"] as const;
export type FailureStage = (typeof FAILURE_STAGES)[number];

export const RESULT_CODES = ["OK", "DECODE_ERROR", "SCRIPT_ERROR", "DUPLICATE", "UNKNOWN_DEVICE_REJECTED", "INVALID"] as const;

/** 재처리 한 번의 상한(API-ING-07, UI-ING-04) */
export const MAX_REPROCESS = 5000;

export interface StageSnapshot {
  key: string;
  inPerMin?: number | null;
  failPerMin?: number | null;
  latencyP95Ms?: number | null;
  failureLink?: string | null;
}

export interface SourceSnapshot {
  id: string;
  name: string;
  state?: string | null;
  perMin?: number | null;
  lastMessageAt?: string | null;
}

export interface MonitorSnapshot {
  stages: StageSnapshot[];
  sources: SourceSnapshot[];
  throughput?: { sourceId: string; points: [string, number | null][] }[];
}

export interface IngestAlert {
  level: "WARNING" | "CRITICAL";
  code: string;
  message?: string;
  causeHints?: string[];
}

export interface IngestSummary {
  perMinute?: number | null;
  latencyP50Ms?: number | null;
  latencyP95Ms?: number | null;
  streamLagSec?: number | null;
  heartbeat?: { lastPassedAt?: string | null; totalMs?: number | null; stages?: { name: string; ms: number }[] } | null;
  failuresToday?: number | null;
  alerts?: IngestAlert[];
  sources?: { sourceId: string; name: string; type?: string; connection?: string; perMinute?: number | null; counts?: Record<string, number>; lastReceivedAt?: string | null }[];
}

/** 처리 흐름 단계 → 실패 메시지 단계. SOURCE·VALIDATE는 실패 보관함 단계가 없다 */
export function failureStageOf(stage: string): FailureStage | undefined {
  if (stage === "EVENT") return "PUBLISH";
  return (FAILURE_STAGES as readonly string[]).includes(stage) ? (stage as FailureStage) : undefined;
}

const STAGE_CODE: Record<string, string> = { DECODE: "DECODE_ERROR", SCRIPT: "SCRIPT_ERROR" };

/** 단계를 누르면 갈 실패 메시지 주소(DSH-03.04, TC-DSH-021). 서버가 준 failureLink를 먼저 쓴다 */
export function failureLinkOf(stage: StageSnapshot): string | undefined {
  if (stage.failureLink) return stage.failureLink.replace(/^https?:\/\/[^/]+/, "");
  const failure = failureStageOf(stage.key);
  if (!failure) return undefined;
  const params = new URLSearchParams({ stage: failure });
  const code = STAGE_CODE[stage.key];
  if (code) params.set("code", code);
  return `/ingest/failures?${params}`;
}

export function stageFailing(stage: StageSnapshot): boolean {
  return (stage.failPerMin ?? 0) > 0;
}

/** 스냅샷의 단계를 정해진 순서로(빠진 단계는 빈 값) */
export function orderedStages(stages: StageSnapshot[] | undefined): StageSnapshot[] {
  return PIPELINE_STAGES.map((key) => stages?.find((s) => s.key === key) ?? { key });
}

/** 실시간 `ingest-stats`(stages[], sources[])를 스냅샷에 합친다. 처리량 차트는 그대로 둔다 */
export function mergeLive(snapshot: MonitorSnapshot, event: unknown): MonitorSnapshot {
  if (!event || typeof event !== "object") return snapshot;
  const e = event as Partial<MonitorSnapshot>;
  return {
    ...snapshot,
    stages: Array.isArray(e.stages) ? e.stages : snapshot.stages,
    sources: Array.isArray(e.sources) ? e.sources : snapshot.sources,
  };
}

export type Tone = "good" | "warn" | "bad" | "muted";

/** 요약 카드 색: 경고 코드가 이 카드에 걸리면 주황(WARNING)·빨강(CRITICAL) */
export const CARD_ALERT_CODES: Record<string, string[]> = {
  perMinute: ["INGEST_NO_DATA", "INGEST_STOPPED"],
  latencyP95Ms: ["INGEST_LATENCY_HIGH", "INGEST_LAG_HIGH"],
  streamLagSec: ["INGEST_LAG_HIGH", "STREAM_LAG_HIGH"],
  heartbeat: ["HEARTBEAT_DELAYED", "HEARTBEAT_MISSING"],
  failuresToday: ["DLQ_GROWING"],
};

export function cardTone(card: string, alerts: IngestAlert[] | undefined): Tone {
  const codes = CARD_ALERT_CODES[card] ?? [];
  const hits = (alerts ?? []).filter((a) => codes.includes(a.code));
  if (hits.some((a) => a.level === "CRITICAL")) return "bad";
  if (hits.length > 0) return "warn";
  return "good";
}

export function alertTone(level: string): "warning" | "danger" {
  return level === "CRITICAL" ? "danger" : "warning";
}

/** 연결 상태 → 점 색 */
export function connectionTone(state: string | null | undefined): Tone {
  if (state === "CONNECTED" || state === "RUNNING") return "good";
  if (state === "CONNECTING") return "warn";
  if (state === "ERROR" || state === "DISCONNECTED") return "bad";
  return "muted";
}

export interface StreamFilter {
  sourceId?: string;
  deviceId?: string;
  result?: string;
}

/** 수집 메시지 스트림 토픽(API-DSH-21): `ingest-messages?sourceId=&deviceId=&result=` */
export function messageTopic(filter: StreamFilter): string {
  const params = new URLSearchParams();
  params.set("sourceId", filter.sourceId ?? "");
  params.set("deviceId", filter.deviceId ?? "");
  params.set("result", filter.result ?? "");
  return `ingest-messages?${params}`;
}

/** 처리량 차트 계열(DSH-03.02): 소스마다 한 계열 */
export function throughputSeries(snapshot: MonitorSnapshot, unit: string): ChartSeries[] {
  return (snapshot.throughput ?? []).map((t) => ({
    key: `src-${t.sourceId}`,
    label: snapshot.sources.find((s) => s.id === t.sourceId)?.name ?? t.sourceId,
    unit,
    points: t.points.map(([time, value]) => [time, value, null]),
  }));
}

export interface MetricPoint {
  t: string;
  received?: number | null;
  latencyP50Ms?: number | null;
  latencyP95Ms?: number | null;
}

/** 지연 p50/p95 계열(OPS-01.02) */
export function latencySeries(points: MetricPoint[], labels: { p50: string; p95: string }): ChartSeries[] {
  return [
    { key: "p50", label: labels.p50, unit: "ms", points: points.map((p) => [p.t, p.latencyP50Ms ?? null, null]) },
    { key: "p95", label: labels.p95, unit: "ms", points: points.map((p) => [p.t, p.latencyP95Ms ?? null, null]) },
  ];
}

/** 재처리 선택 검사: 1~5,000건 */
export function reprocessProblem(count: number): "none" | "tooMany" | undefined {
  if (count < 1) return "none";
  if (count > MAX_REPROCESS) return "tooMany";
  return undefined;
}

export function checkDiscardReason(reason: string): boolean {
  const n = reason.trim().length;
  return n >= 2 && n <= 200;
}

export interface Thresholds {
  lagWarnSec: number;
  lagCriticalSec: number;
  heartbeatCriticalSec: number;
}

/** 알람 기준 검증(API-ING-04, UI-ING-01) */
export function checkThresholds(t: Thresholds): Record<string, string> {
  const errors: Record<string, string> = {};
  const int = (v: number) => Number.isInteger(v);
  if (!int(t.lagWarnSec) || t.lagWarnSec < 10 || t.lagWarnSec > 3600) errors.lagWarnSec = "range";
  if (!int(t.lagCriticalSec) || t.lagCriticalSec > 7200) errors.lagCriticalSec = "range";
  else if (!errors.lagWarnSec && t.lagWarnSec >= t.lagCriticalSec) errors.lagWarnSec = "order";
  if (!int(t.heartbeatCriticalSec) || t.heartbeatCriticalSec < 10 || t.heartbeatCriticalSec > 600) errors.heartbeatCriticalSec = "range";
  return errors;
}

export interface ReprocessResult {
  results: { id: string; outcome: string; errorCode?: string | null }[];
  summary?: { resolved?: number; sameError?: number; otherError?: number };
}

/** 결과별 건수(LOCKED 포함) */
export function summarize(result: ReprocessResult): Record<string, number> {
  const counts: Record<string, number> = { RESOLVED: 0, SAME_ERROR: 0, OTHER_ERROR: 0, LOCKED: 0 };
  for (const r of result.results) counts[r.outcome] = (counts[r.outcome] ?? 0) + 1;
  return counts;
}

/** 실패 목록 필터의 기간(일) */
export const PERIOD_DAYS = [1, 7, 14] as const;

export function periodRange(days: number, nowMs: number): { from: string; to: string } {
  const d = (PERIOD_DAYS as readonly number[]).includes(days) ? days : 7;
  const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
  return { from: iso(nowMs - d * 86400_000), to: iso(nowMs) };
}

/** 마지막 갱신 경과 초 */
export function secondsSince(atMs: number | null, nowMs: number): number | null {
  if (atMs === null) return null;
  return Math.max(0, Math.floor((nowMs - atMs) / 1000));
}
