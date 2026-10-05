/**
 * 실행 결과 화면 모델(UI-ANA-05, ANA-04.02·05.01·05.05·08.02). 상태 → 색, 비교 차이 문구, 결과 배지 판정.
 */
import { formatNumber } from "~/lib/format";
import type { StatusTone } from "~/lib/palette";
import { ACTIVE_STATUSES, type Analysis, type Metric, type Result, type Run, type RunStatus } from "./types";

export function isActive(status: RunStatus | string | undefined): boolean {
  return (ACTIVE_STATUSES as string[]).includes(status ?? "");
}

export function statusTone(status: RunStatus | string | undefined): StatusTone {
  if (status === "SUCCEEDED") return "good";
  if (status === "FAILED" || status === "TIMEOUT") return "bad";
  if (status === "CANCELLED") return "muted";
  return "warn";
}

export function levelTone(level: string | null | undefined): "success" | "warning" | "danger" | "neutral" {
  if (level === "OK") return "success";
  if (level === "WARN") return "warning";
  if (level === "FAIL") return "danger";
  return "neutral";
}

/** 비교 차이 "+4.2 (▲6%)" (TC-ANA-127) */
export function diffText(diff: number | null | undefined, diffPct: number | null | undefined, lang: string): string {
  if (diff === null || diff === undefined) return "–";
  const sign = diff > 0 ? "+" : diff < 0 ? "−" : "±";
  const abs = formatNumber(Math.abs(Math.round(diff * 10) / 10), lang);
  if (diffPct === null || diffPct === undefined) return `${sign}${abs}`;
  const arrow = diffPct > 0 ? "▲" : diffPct < 0 ? "▼" : "–";
  return `${sign}${abs} (${arrow}${formatNumber(Math.abs(Math.round(diffPct * 10) / 10), lang)}%)`;
}

export interface ResultBadges {
  virtual: boolean;
  versionMismatch: boolean;
  estimate: boolean;
}

/** 헤더 배지: 가상 데이터 포함(TC-ANA-094), 템플릿 버전 다름, 추정치(ANA-08.02) */
export function resultBadges(analysis: Pick<Analysis, "templateVersion">, run: Run, result: Result | null | undefined): ResultBadges {
  const template = result?.provenance?.template ?? "";
  const runVersion = run.templateVersion ?? (template.includes("@") ? template.split("@")[1] : null);
  return {
    virtual: Boolean(result?.provenance?.virtual),
    versionMismatch: Boolean(runVersion && analysis.templateVersion && runVersion !== analysis.templateVersion),
    estimate: Boolean(result?.summary?.estimate || result?.summary?.metrics?.some((m) => m.estimate || m.lower != null || m.upper != null)),
  };
}

/** 카드 값 "22.4 ℃ (21.8~23.0)" */
export function metricText(metric: Metric, lang: string): { value: string; range: string | null } {
  const value = typeof metric.value === "number" ? formatNumber(metric.value, lang, { unit: metric.unit }) : metric.value === null || metric.value === undefined ? "–" : `${metric.value}${metric.unit ? ` ${metric.unit}` : ""}`;
  const range = metric.lower != null && metric.upper != null ? `${formatNumber(metric.lower, lang)}~${formatNumber(metric.upper, lang)}` : null;
  return { value, range };
}

/** 이상 표 행에서 피드백 대상(시각·계열)을 찾는다(UC-ANA-06, API-ANA-15) */
export function feedbackTarget(row: Record<string, unknown>): { occurredAt: string; seriesKey: string } | null {
  const occurredAt = row.occurredAt ?? row.time ?? row.at;
  const seriesKey = row.seriesKey ?? row.series;
  if (typeof occurredAt !== "string" || typeof seriesKey !== "string") return null;
  return { occurredAt, seriesKey };
}
