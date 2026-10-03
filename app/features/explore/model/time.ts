/**
 * 기간 계산과 사용자 시간대 ↔ UTC 변환(TSD-01.05, DSH-07.04). API에는 UTC ISO만 보낸다.
 */
import { rangeOf, resolveTimezone } from "~/lib/format";
import type { ExploreState } from "./state";

const HOUR = 3600_000;
const DAY = 24 * HOUR;

export const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

/** 조회 구간(UTC). 직접 지정이 아니면 끝이 "지금"이다 */
export function resolveRange(state: ExploreState, nowMs: number): { from: string; to: string; live: boolean } {
  if (state.range === "custom" && state.from && state.to) return { from: state.from, to: state.to, live: false };
  return { ...rangeOf(state.range, nowMs), live: true };
}

export type RangeProblem = "START_AFTER_END" | "END_TOO_LATE" | "RAW_TOO_LONG" | "INVALID";

/** 입력 검증(UI-TSD-01): 시작 < 종료, 종료 ≤ 지금 + 1일, 원본은 31일까지 */
export function checkRange(state: ExploreState, nowMs: number): RangeProblem | undefined {
  const { from, to } = resolveRange(state, nowMs);
  const f = Date.parse(from);
  const t = Date.parse(to);
  if (Number.isNaN(f) || Number.isNaN(t)) return "INVALID";
  if (f >= t) return "START_AFTER_END";
  if (t > nowMs + DAY) return "END_TOO_LATE";
  if (state.resolution === "raw" && t - f > 31 * DAY) return "RAW_TOO_LONG";
  return undefined;
}

function offsetMs(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(utcMs));
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second")) - utcMs;
}

/** `2026-10-03T10:00`(사용자 시간대) → UTC ISO */
export function localToUtc(local: string, timeZone: string): string | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) return undefined;
  const zone = resolveTimezone(timeZone);
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  let utc = guess - offsetMs(guess, zone);
  utc = guess - offsetMs(utc, zone);
  return iso(utc);
}

/** UTC ISO → `datetime-local` 입력값(사용자 시간대) */
export function utcToLocal(value: string | undefined, timeZone: string): string {
  if (!value) return "";
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return "";
  return new Date(ms + offsetMs(ms, resolveTimezone(timeZone))).toISOString().slice(0, 16);
}
