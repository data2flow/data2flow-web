/**
 * 규칙 시뮬레이션 결과 모델(UI-RUL-03, API-RUL-06, BR-RUL-23): 기간 검사(최대 30일), 결과 비교(이번·이전), 데이터 부족 판정,
 * 시간대 히트맵(요일 × 시) ECharts 옵션.
 */
import type { SimulationResult } from "./types";
import { tokens } from "~/lib/tokens";

export const MAX_SIM_DAYS = 30;
export const SIM_PERIODS = [1, 7, 14, 30] as const;
export const LOW_COVERAGE = 0.1;
const DAY = 86_400_000;

export function simulationRange(days: number, nowMs: number): { from: string; to: string } {
  const to = new Date(nowMs);
  return { from: new Date(nowMs - days * DAY).toISOString(), to: to.toISOString() };
}

/** 기간이 0보다 크고 30일 이하인지(RULE_SIMULATION_RANGE_INVALID를 미리 막는다) */
export function validRange(from: string, to: string): boolean {
  const a = Date.parse(from);
  const b = Date.parse(to);
  return Number.isFinite(a) && Number.isFinite(b) && b > a && b - a <= MAX_SIM_DAYS * DAY;
}

export function lowCoverage(result: SimulationResult | null | undefined): boolean {
  return result?.coverage?.dataRatio != null && result.coverage.dataRatio < LOW_COVERAGE;
}

export interface CompareRow {
  key: "alarms" | "notifications" | "avgDurationSec";
  current: number | null;
  previous: number | null;
}

export function compareRows(current: SimulationResult, previous?: SimulationResult | null): CompareRow[] {
  return (["alarms", "notifications", "avgDurationSec"] as const).map((key) => ({ key, current: current[key] ?? null, previous: previous ? (previous[key] ?? null) : null }));
}

/** 기기별 표: 발생 수 내림차순, 같으면 최장 지속 내림차순 */
export function sortedDevices(result: SimulationResult) {
  return [...(result.byDevice ?? [])].sort((a, b) => b.count - a.count || (b.longestSec ?? 0) - (a.longestSec ?? 0));
}

/** 요일(1=월 … 7=일) × 시(0~23) 히트맵 옵션. dowLabels는 월~일 순서의 화면 언어 이름 */
export function heatmapOption(result: SimulationResult, dowLabels: string[], dark = false): Record<string, unknown> {
  const data = (result.heatmap ?? []).filter((c) => c.dow >= 1 && c.dow <= 7 && c.hour >= 0 && c.hour <= 23).map((c) => [c.hour, c.dow - 1, c.count]);
  const max = Math.max(1, ...data.map((d) => d[2]));
  return {
    backgroundColor: "transparent",
    tooltip: { position: "top" },
    grid: { left: 48, right: 16, top: 8, bottom: 48 },
    xAxis: { type: "category", data: Array.from({ length: 24 }, (_, h) => String(h)), splitArea: { show: true } },
    yAxis: { type: "category", data: dowLabels, splitArea: { show: true } },
    visualMap: { min: 0, max, calculable: false, orient: "horizontal", left: "center", bottom: 0, itemHeight: 80, textStyle: { color: tokens(dark).text2 } },
    series: [{ type: "heatmap", data, label: { show: false } }],
  };
}

/** 일별 추이 막대(UI-RUL-10 알람 통계) */
export function dailyBarOption(daily: { date: string; raised: number }[], label: string): Record<string, unknown> {
  return {
    backgroundColor: "transparent",
    tooltip: { trigger: "axis" },
    grid: { left: 40, right: 16, top: 16, bottom: 32 },
    xAxis: { type: "category", data: daily.map((d) => d.date.slice(5)) },
    yAxis: { type: "value", minInterval: 1 },
    series: [{ type: "bar", name: label, data: daily.map((d) => d.raised) }],
  };
}
