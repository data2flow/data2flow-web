/**
 * 수집 M5 화면 모델: 재처리 작업(UI-ING-05, ING-01.04)과 데이터 품질(UI-ING-06, ING-06.02).
 */
import type { ChartSeries } from "~/lib/chart-model";

// ---------------------------------------------------------------- 재처리(API-ING-09·10·12·14)

/** 재처리 기간 최대(UI-ING-05: 31일) */
export const REPROCESS_MAX_DAYS = 31;
export const REPROCESS_STATUSES = ["PENDING", "QUEUED", "RUNNING", "COMPLETED", "FAILED", "CANCELLED"] as const;
/** 진행 중으로 보고 주기적으로 다시 읽는 상태 */
export const ACTIVE_STATUSES = new Set(["PENDING", "QUEUED", "RUNNING"]);
/** 진행 중 작업이 있을 때 목록을 다시 읽는 간격(core에 실시간 토픽이 없어 조회로 대신한다) */
export const REPROCESS_POLL_MS = 5000;

export interface ReprocessJob {
  jobId: string;
  sourceId?: string | null;
  sourceName?: string | null;
  deviceIds?: string[] | null;
  from: string;
  to: string;
  status: string;
  total: number;
  processed: number;
  failed: number;
  skipped?: number | null;
  progressPercent?: number | null;
  requestedBy?: string | null;
  requestedByName?: string | null;
  memo?: string | null;
  error?: string | null;
  createdAt?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
}

export interface ReprocessPreview {
  total: number;
  byStatus?: Record<string, number> | null;
  estimatedSeconds?: number | null;
  decoder?: { key?: string | null; version?: string | null } | null;
  scripts?: { scope?: string | null; scriptId?: string | null; name?: string | null; version?: number | null }[] | null;
}

export interface ReprocessForm {
  sourceId: string;
  deviceIds: string[];
  from: string;
  to: string;
  memo: string;
}

export interface ReprocessBody {
  sourceId: number;
  deviceIds?: number[];
  from: string;
  to: string;
  memo?: string;
}

/** 폼 검증: 소스 필수, 기간 필수·순서, 31일 이하, 메모 200자 이하. 오류는 문구 키(`ingest.reprocess.validation.{코드}`) */
export function checkReprocessForm(form: ReprocessForm): { errors: Partial<Record<"sourceId" | "period" | "memo", string>>; body?: ReprocessBody } {
  const errors: Partial<Record<"sourceId" | "period" | "memo", string>> = {};
  if (!/^\d+$/.test(form.sourceId)) errors.sourceId = "source";
  const from = Date.parse(form.from);
  const to = Date.parse(form.to);
  if (!Number.isFinite(from) || !Number.isFinite(to)) errors.period = "periodRequired";
  else if (from >= to) errors.period = "periodOrder";
  else if (to - from > REPROCESS_MAX_DAYS * 86_400_000) errors.period = "periodTooLong";
  if (form.memo.trim().length > 200) errors.memo = "memo";
  if (Object.keys(errors).length > 0) return { errors };
  const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
  const devices = form.deviceIds.filter((d) => /^\d+$/.test(d)).map(Number);
  return {
    errors,
    body: { sourceId: Number(form.sourceId), ...(devices.length > 0 ? { deviceIds: devices } : {}), from: iso(from), to: iso(to), ...(form.memo.trim() ? { memo: form.memo.trim() } : {}) },
  };
}

/** 진행률(%): 서버 값이 있으면 그것, 없으면 처리/대상(소수 1자리) */
export function progressOf(job: Pick<ReprocessJob, "progressPercent" | "processed" | "total" | "status">): number {
  if (job.status === "COMPLETED") return 100;
  if (job.progressPercent != null) return Math.min(100, Math.max(0, job.progressPercent));
  if (!job.total) return 0;
  return Math.min(100, Math.round((job.processed / job.total) * 1000) / 10);
}

export function jobTone(status: string): "info" | "success" | "danger" | "warning" | "neutral" {
  if (status === "COMPLETED") return "success";
  if (status === "FAILED") return "danger";
  if (status === "CANCELLED") return "neutral";
  if (status === "RUNNING") return "info";
  return "warning";
}

export function hasActiveJob(jobs: readonly Pick<ReprocessJob, "status">[]): boolean {
  return jobs.some((j) => ACTIVE_STATUSES.has(j.status));
}

/** datetime-local 입력값(조직 시간대 벽시계)을 UTC ISO로. 시간대 계산은 Intl로 한다 */
export function zonedLocalToIso(local: string, timeZone: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!match) return null;
  const [, y, mo, d, h, mi] = match.map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const offset = zoneOffsetMs(guess, timeZone);
  const first = guess - offset;
  // 서머타임 경계 보정(한 번 더)
  const second = guess - zoneOffsetMs(first, timeZone);
  return new Date(second).toISOString().replace(/\.\d{3}Z$/, "Z");
}

function zoneOffsetMs(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/** UTC ISO를 조직 시간대의 datetime-local 값으로 */
export function isoToZonedLocal(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return "";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  const local = new Date(ms + zoneOffsetMs(ms, timeZone));
  return local.toISOString().slice(0, 16);
}

export function formatDuration(seconds: number | null | undefined): { unit: "s" | "m" | "h"; n: number } {
  const s = Math.max(0, Math.round(seconds ?? 0));
  if (s < 60) return { unit: "s", n: s };
  if (s < 3600) return { unit: "m", n: Math.ceil(s / 60) };
  return { unit: "h", n: Math.round((s / 3600) * 10) / 10 };
}

// ---------------------------------------------------------------- 데이터 품질(API-ING-13, quality/summary·trend)

export const QUALITY_GROUPS = ["device", "space", "model"] as const;
export type QualityGroup = (typeof QUALITY_GROUPS)[number];

export interface QualityItem {
  targetId: string;
  targetName?: string | null;
  score: number;
  completeness: number;
  timeliness: number;
  validity: number;
  stability: number;
  gaps: number;
  clockSkewSuspect: boolean;
  evidence?: { expected?: number; received?: number; late?: number; outOfRange?: number; suspect?: number } | null;
}

export interface QualitySummary {
  day?: string | null;
  devices?: number | null;
  averageScore?: number | null;
  bottom10?: QualityItem[] | null;
  distribution?: { gaps: number; outOfRange: number; suspect: number; late: number; expected: number; received: number } | null;
}

export interface QualityTrendPoint {
  day: string;
  score: number;
  completeness?: number;
  timeliness?: number;
  validity?: number;
  stability?: number;
}

export function sortByScore(items: readonly QualityItem[]): QualityItem[] {
  return [...items].sort((a, b) => a.score - b.score || String(a.targetName ?? "").localeCompare(String(b.targetName ?? "")));
}

export function scoreTone(score: number): "bad" | "warn" | "good" {
  return score < 60 ? "bad" : score < 85 ? "warn" : "good";
}

/** 점수 클릭 → 기기 상세의 문제 구간 차트(TC-ING-072). 기기 묶음일 때만 */
export function qualityLink(group: QualityGroup, item: Pick<QualityItem, "targetId">): string | null {
  if (group !== "device") return null;
  return `/devices/${encodeURIComponent(item.targetId)}?tab=chart&highlight=gap,range`;
}

/** 문제 유형 분포(공백·범위 초과·값 멈춤 의심·지연 도착) 비율(%, 기대 건수 대비) */
export function distributionRows(distribution: QualitySummary["distribution"]): { key: "gaps" | "outOfRange" | "suspect" | "late"; count: number; percent: number }[] {
  if (!distribution) return [];
  const base = distribution.expected > 0 ? distribution.expected : Math.max(1, distribution.received);
  return (["gaps", "outOfRange", "suspect", "late"] as const).map((key) => ({ key, count: distribution[key], percent: Math.round((distribution[key] / base) * 1000) / 10 }));
}

export function trendSeries(points: readonly QualityTrendPoint[], label: string): ChartSeries[] {
  return [{ key: "score", label, unit: "score", points: points.map((p) => [`${p.day}T00:00:00Z`, p.score, null]) }];
}
