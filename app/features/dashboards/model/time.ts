/**
 * 대시보드 시간 범위·새로고침·확대 동기화(DSH-04.06·DSH-11.01, UI-DSH-04 상단 바).
 * - 범위: 최근 1h/6h/24h/7d/30d 또는 기간 지정. 저장 형식은 `{relative}` 또는 `{from, to}`(UTC)
 * - 확대(드래그): 차트 하나에서 고른 구간을 같은 대시보드의 모든 시계열 차트 x축에 맞춘다. [초기화]는 대시보드 범위로
 * - 새로고침: LIVE(실시간 + 2초 묶음 재조회), 30s/1m/5m 주기, OFF
 */
import type { TimeRange } from "./types";

export const RANGE_PRESETS = ["1h", "6h", "24h", "7d", "30d"] as const;
export const RESOLUTIONS = ["AUTO", "RAW", "1h", "1d"] as const;
export const REFRESHES = ["LIVE", "30s", "1m", "5m", "OFF"] as const;

const RELATIVE = /^(\d{1,4})([mhdwy])$/;
const UNIT_MS: Record<string, number> = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 7 * 86_400_000, y: 365 * 86_400_000 };
const MAX_SPAN_MS = 400 * 86_400_000;

export function relativeMs(relative: string): number | null {
  const m = RELATIVE.exec(relative);
  return m ? Number(m[1]) * UNIT_MS[m[2]] : null;
}

export function isRelative(range: TimeRange): range is { relative: string } {
  return "relative" in range && typeof range.relative === "string";
}

/** 범위 → 절대 구간(ms). 형식이 틀리면 null */
export function resolveRange(range: TimeRange, now: number): { from: number; to: number } | null {
  if (isRelative(range)) {
    const span = relativeMs(range.relative);
    return span === null ? null : { from: now - span, to: now };
  }
  const from = Date.parse(range.from);
  const to = range.to ? Date.parse(range.to) : now;
  if (Number.isNaN(from) || Number.isNaN(to)) return null;
  return { from, to };
}

/** core TimeRanges와 같은 규칙: 1분 이상 400일 이하 */
export function rangeValid(range: TimeRange, now: number): boolean {
  const r = resolveRange(range, now);
  if (!r) return false;
  const span = r.to - r.from;
  return span >= 60_000 && span <= MAX_SPAN_MS;
}

/** 기간 지정 입력(datetime-local 두 개, 표시 시간대가 아닌 브라우저 기준 ISO) → 범위 */
export function customRange(fromIso: string, toIso: string): TimeRange | null {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (Number.isNaN(from) || Number.isNaN(to) || from >= to) return null;
  return { from: new Date(from).toISOString(), to: new Date(to).toISOString() };
}

/** 같은 범위인지(요청을 다시 보낼지) */
export function sameRange(a: TimeRange, b: TimeRange): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** 새로고침 주기(ms). LIVE·OFF는 주기 조회 없음 */
export function refreshIntervalMs(refresh: string): number | null {
  return { "30s": 30_000, "1m": 60_000, "5m": 300_000 }[refresh] ?? null;
}

/** 확대 구간(차트 x축 min·max, ms) */
export interface ZoomWindow {
  from: number;
  to: number;
}

/** ECharts `datazoom` 이벤트에서 구간을 꺼낸다(dataZoomSelect는 batch[0].startValue·endValue) */
export function zoomFromEvent(event: unknown): ZoomWindow | null {
  const e = event as { batch?: { startValue?: number; endValue?: number }[]; startValue?: number; endValue?: number } | null;
  const item = e?.batch?.[0] ?? e;
  const from = Number(item?.startValue);
  const to = Number(item?.endValue);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) return null;
  return { from, to };
}

/** 확대 구간을 저장할 수 있는 기간 지정 범위로 */
export function zoomToRange(zoom: ZoomWindow): TimeRange {
  return { from: new Date(zoom.from).toISOString(), to: new Date(zoom.to).toISOString() };
}
