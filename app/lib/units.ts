/**
 * 단위 체계 변환 표시(DEV-04.04, API-DEV-57, API-DSH-12 `temperatureUnit`). 저장값은 언제나 저장 단위(℃) 그대로이고,
 * 화면에서만 표시 단위(℉)로 바꾼다. 22.0℃ → 71.6℉. 규칙은 core `UnitConversion`과 같다(소수 첫째 자리 반올림).
 * 사용자 설정(effectiveTemperatureUnit)이 조직 기본보다 앞선다.
 */
import { createContext, createElement, useContext, type ReactNode } from "react";
import type { ChartSeries, SeriesPoint } from "./chart-model";

export type TemperatureUnit = "C" | "F";

/** 섭씨 표기인가(℃·°C·C·celsius·degC) */
export function isCelsius(unit: string | null | undefined): boolean {
  if (!unit) return false;
  return ["℃", "°c", "c", "celsius", "degc"].includes(unit.trim().toLowerCase());
}

/** 설정 값(C·F, 대소문자·null 허용)을 표시 단위로. 모르면 C */
export function normalizeTemperatureUnit(value: unknown): TemperatureUnit {
  return typeof value === "string" && value.trim().toUpperCase() === "F" ? "F" : "C";
}

/** 내 화면 설정 응답(API-DSH-12)에서 실제로 쓸 단위: 사용자 값 → 조직 값(effective) → C */
export function effectiveTemperatureUnit(prefs: { temperatureUnit?: string | null; effectiveTemperatureUnit?: string | null } | null | undefined): TemperatureUnit {
  return normalizeTemperatureUnit(prefs?.effectiveTemperatureUnit ?? prefs?.temperatureUnit);
}

/** 표시 단위 기호. 온도가 아니면 저장 단위 그대로 */
export function displayUnit(stored: string | null | undefined, unit: TemperatureUnit): string | null | undefined {
  return isCelsius(stored) && unit === "F" ? "℉" : stored;
}

/** 표시 값(℉면 v×9/5+32, 소수 첫째 자리). 온도가 아니거나 C면 그대로 */
export function toDisplay(value: number | null | undefined, stored: string | null | undefined, unit: TemperatureUnit): number | null | undefined {
  if (value === null || value === undefined || Number.isNaN(value)) return value;
  if (!isCelsius(stored) || unit !== "F") return value;
  return Math.round(((value * 9) / 5 + 32) * 10) / 10;
}

/** 내보내기 머리글 단위 표기: 다르면 "℉ (stored: ℃)" — 저장 단위와 표시 단위를 함께 적는다 */
export function exportUnitLabel(stored: string | null | undefined, unit: TemperatureUnit): string {
  if (!stored) return "";
  const shown = displayUnit(stored, unit) as string;
  return shown === stored ? stored : `${shown} (stored: ${stored})`;
}

/** 차트 계열 하나를 표시 단위로(값·단위). 온도가 아니거나 C면 같은 객체를 돌려준다 */
export function toDisplaySeries(series: ChartSeries, unit: TemperatureUnit): ChartSeries {
  if (!isCelsius(series.unit) || unit !== "F") return series;
  const points = series.points.map(([t, v, q]) => [t, toDisplay(v, series.unit, unit) ?? null, q] as SeriesPoint);
  return { ...series, unit: "℉", points, precision: series.precision ?? 1 };
}

export function toDisplaySeriesList(list: ChartSeries[], unit: TemperatureUnit): ChartSeries[] {
  return unit === "C" ? list : list.map((s) => toDisplaySeries(s, unit));
}

/** 현재값 카드용({value, unit}이 있는 항목) */
export function toDisplayLatest<T extends { value: number | null; unit?: string | null }>(items: T[], unit: TemperatureUnit): T[] {
  if (unit === "C") return items;
  return items.map((item) => (isCelsius(item.unit) ? { ...item, value: toDisplay(item.value, item.unit, unit) ?? null, unit: "℉" } : item));
}

const TemperatureUnitContext = createContext<TemperatureUnit>("C");

/** 화면 단위 설정을 하위 부품(현재값 카드·차트)에 넘긴다 */
export function TemperatureUnitProvider({ unit, children }: { unit: TemperatureUnit; children: ReactNode }) {
  return createElement(TemperatureUnitContext.Provider, { value: unit }, children);
}

export function useTemperatureUnit(): TemperatureUnit {
  return useContext(TemperatureUnitContext);
}
