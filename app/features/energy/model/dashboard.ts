/**
 * 에너지 대시보드(UI-ENE-03) 응답 모양과 화면 계산: API-ENE-10 지표, API-ENE-11 하위 단위. core-api가 analytics 롤업(API-ENE-85)을 그대로 전한다.
 * 기간은 조직 시간대 날짜(`YYYY-MM-DD`, 끝 날 포함). 비교는 기준선·직전 기간·작년 같은 기간.
 */
import { seriesColor } from "~/lib/palette";

export const PERIODS = ["thisMonth", "lastMonth", "thisYear", "custom"] as const;
export type Period = (typeof PERIODS)[number];
export const COMPARES = ["BASELINE", "PREVIOUS_PERIOD", "SAME_PERIOD_LAST_YEAR"] as const;
export type Compare = (typeof COMPARES)[number];

export interface EnergyTotals {
  kwh: number;
  krw?: number | null;
  tco2?: number | null;
  euiKwhPerM2?: number | null;
  euiReason?: string | null;
  kwhPerOccupiedHour?: number | null;
  occupiedHoursSource?: string | null;
  estimatedRatio?: number | null;
  otherCommonKwh?: number | null;
}

export interface EnergyPoint {
  t: string;
  kwh: number;
  krw?: number | null;
  tco2?: number | null;
  estimatedKwh?: number | null;
  baselineKwh?: number | null;
}

export interface EnergyMetrics {
  scope: { spaceId: string | null; name?: string | null; kind?: string | null; areaM2?: number | null };
  totals: EnergyTotals;
  compare?: { kind: Compare; kwh?: number | null; krw?: number | null; diffRatio?: number | null; reason?: string | null } | null;
  series: EnergyPoint[];
}

export interface BreakdownItem {
  id: string;
  name: string;
  kind?: string | null;
  kwh: number;
  krw?: number | null;
  tco2?: number | null;
  euiKwhPerM2?: number | null;
  estimatedRatio?: number | null;
  estimated: boolean;
  share?: number | null;
  diffRatio?: number | null;
  hasData?: boolean;
}

export interface Breakdown {
  items: BreakdownItem[];
  other?: { kwh: number } | null;
  page: number;
  size: number;
  totalCount: number;
}

const iso = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);

/** 기간 키 → [from, to](끝 날 포함). today는 조직 시간대 오늘. custom은 받은 값이 날짜일 때만 쓰고 아니면 이번 달 */
export function periodRange(period: string, today: string, custom: { from?: string | null; to?: string | null } = {}): { period: Period; from: string; to: string } {
  const [y, m] = today.split("-").map(Number);
  const date = /^\d{4}-\d{2}-\d{2}$/;
  if (period === "custom" && custom.from && custom.to && date.test(custom.from) && date.test(custom.to) && custom.from <= custom.to) {
    return { period: "custom", from: custom.from, to: custom.to };
  }
  if (period === "lastMonth") return { period, from: iso(y, m - 2, 1), to: iso(y, m - 1, 0) };
  if (period === "thisYear") return { period, from: iso(y, 0, 1), to: today };
  return { period: "thisMonth", from: iso(y, m - 1, 1), to: today };
}

/** 일 수가 많으면(93일 넘게) 월 칸으로 묶는다 */
export function granularityOf(from: string, to: string): "DAY" | "MONTH" {
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;
  return days > 93 ? "MONTH" : "DAY";
}

/** 비교 증감(+4.1% / −6.5%). 값이 없으면 null */
export function diffText(ratio: number | null | undefined): string | null {
  if (ratio === null || ratio === undefined || Number.isNaN(ratio)) return null;
  const pct = (ratio * 100).toFixed(1);
  return ratio > 0 ? `+${pct}%` : ratio < 0 ? `−${pct.slice(1)}%` : "0.0%";
}

/** 증감 색: 사용량은 줄수록 좋다 */
export function diffTone(ratio: number | null | undefined): "success" | "danger" | "neutral" {
  if (ratio === null || ratio === undefined || ratio === 0) return "neutral";
  return ratio < 0 ? "success" : "danger";
}

/** 추이 차트(ECharts option): 측정분·추정분(빗금) 쌓은 막대 + 기준선 선 */
export function trendOption(series: EnergyPoint[], labels: { measured: string; estimated: string; baseline: string; unit: string }, dark: boolean): Record<string, unknown> {
  const measured = series.map((p) => Math.max(0, p.kwh - (p.estimatedKwh ?? 0)));
  const estimated = series.map((p) => p.estimatedKwh ?? 0);
  const hasBaseline = series.some((p) => p.baselineKwh !== null && p.baselineKwh !== undefined);
  const color = seriesColor(0, dark);
  return {
    animation: false,
    tooltip: { trigger: "axis" },
    legend: { top: 0, data: [labels.measured, labels.estimated, ...(hasBaseline ? [labels.baseline] : [])] },
    grid: { left: 48, right: 16, top: 32, bottom: 28 },
    xAxis: { type: "category", data: series.map((p) => p.t) },
    yAxis: { type: "value", name: labels.unit },
    series: [
      { type: "bar", name: labels.measured, stack: "kwh", data: measured, itemStyle: { color } },
      { type: "bar", name: labels.estimated, stack: "kwh", data: estimated, itemStyle: { color, opacity: 0.45, decal: { symbol: "rect", dashArrayX: [1, 0], dashArrayY: [2, 4], rotation: -Math.PI / 4 } } },
      ...(hasBaseline ? [{ type: "line", name: labels.baseline, data: series.map((p) => p.baselineKwh ?? null), symbol: "none", lineStyle: { color: seriesColor(1, dark), type: "dashed" } }] : []),
    ],
  };
}
