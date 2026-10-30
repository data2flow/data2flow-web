/**
 * 대시보드 위젯 `energy-kpi`·`energy-trend`(ENE-01.05, DSH API-DSH-09) 응답 모양. core-api가 API-ENE-10 totals·series를 그대로 넣는다.
 * kpi는 하위 공간 상위 N개(사용량 순)를 같이 실어 건물 → 공간으로 내려갈 수 있다.
 */
import { seriesColor } from "~/lib/palette";
import { trendOption, type EnergyMetrics, type EnergyPoint, type EnergyTotals } from "./dashboard";

export interface EnergyWidgetChild {
  id: string;
  name: string;
  kind?: string | null;
  kwh: number;
  share?: number | null;
  estimatedRatio?: number | null;
}

export interface EnergyKpiPayload {
  scope: EnergyMetrics["scope"] | null;
  from: string;
  to: string;
  totals: EnergyTotals | null;
  compare?: EnergyMetrics["compare"];
  children: EnergyWidgetChild[];
}

export type EnergyMeasure = "kwh" | "krw" | "tco2";

export interface EnergyTrendPayload {
  scope: EnergyMetrics["scope"] | null;
  from: string;
  to: string;
  granularity: "DAY" | "MONTH";
  measure: EnergyMeasure;
  series: EnergyPoint[];
}

/** 집계된 사용량이 없다(0kWh이고 하위도 비었다) */
export function kpiEmpty(p: EnergyKpiPayload | null | undefined): boolean {
  return !p?.totals || (!p.totals.kwh && p.children.length === 0);
}

/** 대시보드 범위 링크(드릴다운). 범위가 없으면 포트폴리오 */
export function energyHref(spaceId: string | null | undefined): string {
  return spaceId ? `/energy?scope=${encodeURIComponent(spaceId)}` : "/energy";
}

/** 추이 위젯 option: 사용량이면 대시보드와 같은 차트(추정분 빗금·기준선), 비용·탄소는 막대 하나 */
export function energyTrendOption(p: EnergyTrendPayload, labels: { measured: string; estimated: string; baseline: string; unit: string }, dark: boolean): Record<string, unknown> {
  if (p.measure === "kwh") return trendOption(p.series, labels, dark);
  return {
    animation: false,
    tooltip: { trigger: "axis" },
    grid: { left: 48, right: 16, top: 16, bottom: 28 },
    xAxis: { type: "category", data: p.series.map((s) => s.t) },
    yAxis: { type: "value", name: labels.unit },
    series: [{ type: "bar", name: labels.measured, data: p.series.map((s) => s[p.measure] ?? null), itemStyle: { color: seriesColor(0, dark) } }],
  };
}

export const MEASURE_UNIT: Record<EnergyMeasure, string> = { kwh: "kWh", krw: "KRW", tco2: "tCO2eq" };
