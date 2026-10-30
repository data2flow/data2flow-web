/**
 * 기준선(UI-ENE-04, ENE-01.04) 응답 모양과 화면 계산: API-ENE-12 기준선·버전 목록·버전 상세·학습 요청·적용.
 * 학습은 analytics가 비동기로 하고(TRAINING → READY·FAILED), READY 버전을 [적용]하면 대시보드 기준선 비교가 그 버전을 쓴다.
 */
import { seriesColor } from "~/lib/palette";

export const METHODS = ["PERIOD_AVERAGE", "DEGREE_DAY_REGRESSION"] as const;
export type Method = (typeof METHODS)[number];
export const LOW_FIT_R2 = 0.5;
export const MIN_DAYS = 30;
export const MAX_DAYS = 730;

export interface BaselineSummary {
  baselineId: string;
  scopeSpace: { id: string; name: string };
  activeVersion?: { versionId: string; method: Method; r2?: number | null; trainFrom: string; trainTo: string } | null;
  updatedAt?: string;
}

export type VersionStatus = "TRAINING" | "READY" | "FAILED" | "ACTIVE" | "RETIRED";

export interface BaselineVersion {
  versionId: string;
  baselineId: string;
  method: Method;
  trainFrom: string;
  trainTo: string;
  status: VersionStatus;
  r2?: number | null;
  warning?: string | null;
  errorCode?: string | null;
  neededDays?: number | null;
  createdBy?: { userId: string; name?: string | null } | null;
  createdAt?: string;
}

export interface Residual {
  date: string;
  actual: number;
  predicted: number;
}

export interface BaselineDetail extends BaselineVersion {
  scopeSpaceId: string;
  params?: { coolingBaseC?: number; heatingBaseC?: number; splitWeekday?: boolean; temperatureSource?: { deviceId: number | string; metricKey: string } | null } | null;
  coefficients?: Record<string, number> | null;
  residuals: Residual[];
}

export interface BaselineForm {
  method: string;
  trainFrom: string;
  trainTo: string;
  coolingBaseC: string;
  heatingBaseC: string;
  splitWeekday: boolean;
  temperatureDeviceId: string;
  temperatureMetricKey: string;
}

/** R²가 0.5보다 낮으면 적합도 낮음 경고(LOW_FIT) */
export function lowFit(v: { r2?: number | null; warning?: string | null }): boolean {
  return (v.warning ?? "").includes("LOW_FIT") || (v.r2 !== null && v.r2 !== undefined && v.r2 < LOW_FIT_R2);
}

/** 학습 기간 일 수(끝 날 포함). 날짜가 아니면 null */
export function periodDays(from: string, to: string): number | null {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86_400_000) + 1;
}

/** 화면 검사. 30일 미만은 서버가 409(neededDays)로 답하므로 여기서는 형식만 본다 */
export function validateBaselineForm(f: BaselineForm): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!(METHODS as readonly string[]).includes(f.method)) errors.method = "required";
  const days = periodDays(f.trainFrom, f.trainTo);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.trainFrom)) errors.trainFrom = "date";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.trainTo)) errors.trainTo = "date";
  else if (days !== null && days < 1) errors.trainTo = "order";
  else if (days !== null && days > MAX_DAYS) errors.trainTo = "tooLong";
  for (const key of ["coolingBaseC", "heatingBaseC"] as const) {
    if (f[key] !== "" && Number.isNaN(Number(f[key]))) errors[key] = "number";
  }
  if (f.method === "DEGREE_DAY_REGRESSION" && !f.temperatureDeviceId) errors.temperatureDeviceId = "required";
  return errors;
}

export function baselineBody(scopeSpaceId: string, f: BaselineForm) {
  return {
    scopeSpaceId,
    method: f.method,
    trainFrom: f.trainFrom,
    trainTo: f.trainTo,
    params: {
      coolingBaseC: f.coolingBaseC === "" ? undefined : Number(f.coolingBaseC),
      heatingBaseC: f.heatingBaseC === "" ? undefined : Number(f.heatingBaseC),
      splitWeekday: f.splitWeekday,
    },
    temperatureSource: f.method === "DEGREE_DAY_REGRESSION" && f.temperatureDeviceId ? { deviceId: f.temperatureDeviceId, metricKey: f.temperatureMetricKey || "temperature" } : null,
  };
}

/** 409 ENE_BASELINE_INSUFFICIENT_DATA의 더 필요한 일 수(errors[0].message) */
export function neededDaysOf(failure: { code: string; errors?: { field?: string; message?: string }[] } | null | undefined): number | null {
  if (!failure || failure.code !== "ENE_BASELINE_INSUFFICIENT_DATA") return null;
  const n = Number(failure.errors?.find((e) => e.field === "neededDays")?.message);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** 실측 vs 예측 선 그래프(ECharts option) */
export function residualOption(residuals: Residual[], labels: { actual: string; predicted: string; unit: string }, dark: boolean): Record<string, unknown> {
  return {
    animation: false,
    tooltip: { trigger: "axis" },
    legend: { top: 0, data: [labels.actual, labels.predicted] },
    grid: { left: 48, right: 16, top: 32, bottom: 28 },
    xAxis: { type: "category", data: residuals.map((r) => r.date) },
    yAxis: { type: "value", name: labels.unit },
    series: [
      { type: "line", name: labels.actual, data: residuals.map((r) => r.actual), symbol: "none", lineStyle: { color: seriesColor(0, dark) }, itemStyle: { color: seriesColor(0, dark) } },
      { type: "line", name: labels.predicted, data: residuals.map((r) => r.predicted), symbol: "none", lineStyle: { color: seriesColor(1, dark), type: "dashed" }, itemStyle: { color: seriesColor(1, dark) } },
    ],
  };
}
