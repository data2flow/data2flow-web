/**
 * 공간 가상 센서(UI-ENE-05, ENE-02.01 환기율 ACH). API-ENE-20 설정·상태, API-ENE-21 일별 ACH·환기량.
 * ACH 설정: 실외 CO2 기준 300~600ppm(기본 420), 최소 감쇠 구간 15~240분(기본 30). 부피(면적 × 층고)가 없으면 켤 수 없다(409 ENE_SPACE_VOLUME_REQUIRED)
 */
import { seriesColor } from "~/lib/palette";

export type SensorKind = "ACH" | "OCCUPANCY" | "THERMAL_COMFORT";
export type SensorStatus = "OK" | "INPUT_MISSING" | "DISABLED";

export interface SensorInput {
  metricKey: string;
  available: boolean;
  deviceIds: string[];
}

export interface SensorView {
  kind: SensorKind;
  enabled: boolean;
  params: { outdoorCo2Mode?: string; outdoorCo2Ppm?: number; minDecayMinutes?: number } & Record<string, unknown>;
  outputMetrics: string[];
  inputs: SensorInput[];
  lastComputedAt?: string | null;
  status: SensorStatus;
  missing?: string[] | null;
  volumeM3?: number | null;
}

export interface AchDay {
  day: string;
  ach: number;
  ciLow?: number | null;
  ciHigh?: number | null;
  ventilationM3h?: number | null;
  decayWindow?: { from?: string | null; to?: string | null } | null;
  fitR2?: number | null;
}

export interface AchSeries {
  spaceId: string;
  volumeM3?: number | null;
  outdoorCo2Ppm: number;
  items: AchDay[];
}

export interface AchForm {
  outdoorCo2Ppm: string;
  minDecayMinutes: string;
}

export const ACH_DEFAULTS = { outdoorCo2Ppm: 420, minDecayMinutes: 30 } as const;

export function achFormOf(sensor: SensorView | null | undefined): AchForm {
  return {
    outdoorCo2Ppm: String(sensor?.params.outdoorCo2Ppm ?? ACH_DEFAULTS.outdoorCo2Ppm),
    minDecayMinutes: String(sensor?.params.minDecayMinutes ?? ACH_DEFAULTS.minDecayMinutes),
  };
}

/** 범위 검사. 오류 키: outdoorRange, minutesRange */
export function validateAchForm(form: AchForm): Record<string, string> {
  const errors: Record<string, string> = {};
  const ppm = Number(form.outdoorCo2Ppm);
  if (form.outdoorCo2Ppm.trim() === "" || !Number.isFinite(ppm) || ppm < 300 || ppm > 600) errors.outdoorCo2Ppm = "outdoorRange";
  const minutes = Number(form.minDecayMinutes);
  if (form.minDecayMinutes.trim() === "" || !Number.isInteger(minutes) || minutes < 15 || minutes > 240) errors.minDecayMinutes = "minutesRange";
  return errors;
}

/** PUT …/virtual-sensors/ach 본문 */
export function achBody(enabled: boolean, form: AchForm) {
  return enabled ? { enabled, params: { outdoorCo2Mode: "FIXED", outdoorCo2Ppm: Number(form.outdoorCo2Ppm), minDecayMinutes: Number(form.minDecayMinutes) } } : { enabled };
}

/** 가장 최근 추정값 */
export function latest(series: AchSeries | null | undefined): AchDay | null {
  const items = series?.items ?? [];
  return items.length ? items[items.length - 1] : null;
}

/** 409 응답이 어떤 안내를 띄우는지: 부피 없음(공간 편집 링크), 입력 없음(없는 측정 항목) */
export function failureKind(error: { code: string; errors?: { field?: string; code?: string }[] } | null | undefined): { kind: "volume" } | { kind: "input"; missing: string[] } | null {
  if (!error) return null;
  if (error.code === "ENE_SPACE_VOLUME_REQUIRED") return { kind: "volume" };
  if (error.code === "ENE_VIRTUAL_SENSOR_INPUT_MISSING") return { kind: "input", missing: (error.errors ?? []).map((e) => e.code ?? "").filter(Boolean) };
  return null;
}

/** 일별 ACH 막대 + 신뢰 구간(오차 막대 대신 위·아래 선) */
export function achOption(items: AchDay[], labels: { ach: string; ci: string }, dark: boolean): Record<string, unknown> {
  return {
    animation: false,
    tooltip: { trigger: "axis" },
    legend: { data: [labels.ach, labels.ci], bottom: 0 },
    grid: { left: 40, right: 16, top: 16, bottom: 40 },
    xAxis: { type: "category", data: items.map((i) => i.day) },
    yAxis: { type: "value", name: "1/h" },
    series: [
      { type: "bar", name: labels.ach, data: items.map((i) => i.ach), itemStyle: { color: seriesColor(0, dark) } },
      { type: "line", name: labels.ci, data: items.map((i) => i.ciHigh ?? null), symbol: "none", lineStyle: { type: "dashed", color: seriesColor(1, dark) } },
      { type: "line", name: labels.ci, data: items.map((i) => i.ciLow ?? null), symbol: "none", lineStyle: { type: "dashed", color: seriesColor(1, dark) } },
    ],
  };
}
