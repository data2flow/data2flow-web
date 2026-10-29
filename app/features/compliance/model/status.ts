/** 종합 점수(API-CMP-10)와 준수 현황(API-CMP-13·14) 응답 모양. core-api ComplianceStatusDtos와 같다. 비율은 모두 %(0~100) */

export type Grade = "GOOD" | "MODERATE" | "POOR" | "BAD";

export interface Boundary {
  lower?: number | null;
  upper?: number | null;
}

export interface ScoreInput {
  metricKey: string;
  avg5m?: number | null;
  unit?: string | null;
  weight: number;
  boundary: Boundary;
}

export interface ScoreView {
  spaceId: string;
  time: string;
  score?: number | null;
  grade?: Grade | null;
  /** 최근 10분 데이터가 없는 항목은 null */
  indices: Record<string, number | null>;
  topPenaltyMetric?: string | null;
  topPenaltyValue?: number | null;
  basis: "PROFILE" | "DEFAULT";
  excludedMetrics: string[];
  partial: boolean;
  profileVersions: string[];
  formulaVersion: string;
  inputs?: ScoreInput[];
}

export interface MetricHours {
  metricKey: string;
  hours: number;
}

export interface StatusRow {
  space: { id: string; name?: string | null; path?: string | null };
  profile: { id: string; name: string; versionNo: number };
  ratio?: number | null;
  exceededByMetric: MetricHours[];
  missingRatio?: number | null;
  qualityWarning: boolean;
  streak: { currentDays: number; requiredDays?: number | null; brokenOn?: string | null; brokenMetric?: string | null };
  score?: number | null;
}

export interface StatusView {
  summary: { avgRatio?: number | null; exceededHours: number; streakingSpaces: number; qualityWarnings: number };
  rows: StatusRow[];
}

export interface MetricDay {
  metricKey: string;
  ratio?: number | null;
  metMinutes: number;
  exceededMinutes: number;
  missingMinutes: number;
  qualityWarning: boolean;
}

export interface DailyStatus extends Omit<MetricDay, "metricKey"> {
  day: string;
  byMetric: MetricDay[];
}

export interface Excursion {
  id: string;
  metricKey: string;
  startedAt: string;
  endedAt?: string | null;
  peakValue: number;
  alarmId?: string | null;
  hasAction: boolean;
}

export interface SpaceStatus {
  daily: DailyStatus[];
  excursions: Excursion[];
}

export const PERIODS = ["7", "30", "90", "custom"] as const;
export type Period = (typeof PERIODS)[number];

/** 점수 색(UI-CMP-05): 80↑ 초록, 60~79 노랑, 40~59 주황, 40 미만 빨강 */
export function gradeOf(score: number | null | undefined): Grade | null {
  if (score === null || score === undefined) return null;
  if (score >= 80) return "GOOD";
  if (score >= 60) return "MODERATE";
  if (score >= 40) return "POOR";
  return "BAD";
}

export const GRADE_TEXT: Record<Grade, string> = {
  GOOD: "text-good-ink",
  MODERATE: "text-fair-ink",
  POOR: "text-poor-ink",
  BAD: "text-bad-ink",
};

export const GRADE_BAR: Record<Grade, string> = {
  GOOD: "bg-good",
  MODERATE: "bg-fair",
  POOR: "bg-poor",
  BAD: "bg-bad",
};

/** 시간대 기준 오늘(YYYY-MM-DD) */
export function todayIn(timezone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** YYYY-MM-DD에 날 수를 더한다 */
export function addDays(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** 기간 고르기: 최근 n일(오늘 포함) 또는 사용자 지정. 잘못된 지정은 최근 30일 */
export function resolvePeriod(period: string | null, from: string | null, to: string | null, today: string): { period: Period; from: string; to: string } {
  if (period === "custom" && from && to && DAY.test(from) && DAY.test(to) && from <= to) return { period: "custom", from, to };
  const n = period === "7" || period === "90" ? Number(period) : 30;
  return { period: String(n) as Period, from: addDays(today, 1 - n), to: today };
}

/** 52.5 → "52.5", 90.909 → "90.9", null → "–" */
export function percent(v: number | null | undefined): string {
  return v === null || v === undefined ? "–" : `${Math.round(v * 10) / 10}`;
}
