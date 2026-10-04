/**
 * 여러 측정 항목·기기 비교(TSD-03.03, UI-TSD-07 "단위별 y축 최대 2개, 3개 이상이면 정규화 보기 제안").
 * 정규화 보기는 계열마다 기간 안 최솟값~최댓값을 0~100%로 바꿔 모양만 비교한다(값은 [표로 보기]·툴팁에서 % 로 보인다).
 */
import type { ChartSeries } from "~/lib/chart-model";
import type { ExploreState } from "./state";

/** 단위 목록(나온 순서, 단위 없음은 "") */
export function distinctUnits(series: Pick<ChartSeries, "unit">[]): string[] {
  return [...new Set(series.map((s) => s.unit ?? ""))];
}

/** 단위가 3개 이상이면 축 2개로 다 그릴 수 없으니 정규화 보기를 권한다 */
export function suggestNormalize(series: Pick<ChartSeries, "unit">[]): boolean {
  return distinctUnits(series).length >= 3;
}

/** 계열마다 최솟값~최댓값을 0~100으로(값이 하나뿐이거나 모두 같으면 50) */
export function normalizeSeries(series: ChartSeries[]): ChartSeries[] {
  return series.map((s) => {
    const values = s.points.map((p) => p[1]).filter((v): v is number => typeof v === "number");
    const min = values.length ? Math.min(...values) : 0;
    const max = values.length ? Math.max(...values) : 0;
    const span = max - min;
    return {
      ...s,
      unit: "%",
      precision: 1,
      label: s.unit ? `${s.label} [${s.unit}]` : s.label,
      points: s.points.map(([t, v, q]) => [t, typeof v === "number" ? (span === 0 ? 50 : Math.round(((v - min) / span) * 1000) / 10) : v, q]),
    };
  });
}

/** 내보내기 조회 조건: 보이는 계열을 API-TSD-04 본문으로(단일 기기여도 같은 모양) */
export function exportQuery(state: ExploreState, range: { from: string; to: string }, timezone: string) {
  const specs = state.series.filter((s) => !s.hidden);
  return {
    series: specs.map((s) => ({ ...(s.kind === "device" ? { deviceId: s.id } : { spaceId: s.id }), metric: s.metric, ...(s.agg ? { agg: s.agg } : {}), label: s.label })),
    from: range.from,
    to: range.to,
    resolution: state.resolution,
    fill: state.fill,
    quality: state.quality,
    virtual: state.includeVirtual,
    tz: timezone,
  };
}
