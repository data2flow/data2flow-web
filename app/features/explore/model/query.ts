/**
 * 조회 경로 결정과 응답 → 차트 계열 변환(UI-TSD-01 "조회": 단일 기기면 API-TSD-02, 그 외 API-TSD-04).
 */
import type { ChartAnnotation, ChartSeries, SeriesPoint } from "~/lib/chart-model";
import { seriesKey, type ExploreState, type SeriesSpec } from "./state";

export type TelemetryRequest =
  | { kind: "series"; path: string; specs: SeriesSpec[] }
  | { kind: "query"; path: string; body: Record<string, unknown>; specs: SeriesSpec[] }
  | { kind: "none"; specs: SeriesSpec[] };

/** 보이는 계열만 조회한다 */
export function buildTelemetryRequest(state: ExploreState, range: { from: string; to: string }, timezone: string): TelemetryRequest {
  const specs = state.series.filter((s) => !s.hidden);
  if (specs.length === 0) return { kind: "none", specs };
  const devices = new Set(specs.filter((s) => s.kind === "device").map((s) => s.id));
  const onlyOneDevice = devices.size === 1 && specs.every((s) => s.kind === "device") && !specs.some((s) => s.agg);
  if (onlyOneDevice) {
    const params = new URLSearchParams({
      deviceId: specs[0].id,
      metrics: specs.map((s) => s.metric).join(","),
      from: range.from,
      to: range.to,
      resolution: state.resolution,
      fill: state.fill,
      quality: state.quality,
      virtual: String(state.includeVirtual),
      tz: timezone,
    });
    return { kind: "series", path: `/api/v1/core/telemetry/series?${params}`, specs };
  }
  return {
    kind: "query",
    path: "/api/v1/core/telemetry/query",
    specs,
    body: {
      series: specs.map((s) => ({ ...(s.kind === "device" ? { deviceId: s.id } : { spaceId: s.id }), metric: s.metric, ...(s.agg ? { agg: s.agg } : {}), label: s.label })),
      from: range.from,
      to: range.to,
      resolution: state.resolution,
      fill: state.fill,
      quality: state.quality,
      virtual: state.includeVirtual,
      tz: timezone,
    },
  };
}

export interface ApiSeries {
  metric?: string;
  unit?: string | null;
  agg?: string;
  label?: string;
  deviceId?: string | number;
  spaceId?: string | number;
  virtual?: boolean;
  points?: SeriesPoint[];
  gaps?: { from: string; to: string }[];
}

export interface TelemetryResult {
  resolutionUsed?: string;
  reason?: string;
  truncated?: boolean;
  series?: ApiSeries[];
}

/**
 * 응답 계열을 요청 순서에 맞춘다. API-TSD-02는 측정 항목 이름으로, API-TSD-04는 순서(없으면 대상·항목)로 맞춘다.
 * 응답에 없는 계열은 오류 표시(범례 경고, UI-TSD-07)
 */
export function toChartSeries(request: TelemetryRequest, result: TelemetryResult | undefined): ChartSeries[] {
  const raw = result?.resolutionUsed === "raw";
  const items = result?.series ?? [];
  return request.specs.map((spec, index) => {
    const match =
      request.kind === "series"
        ? items.find((s) => s.metric === spec.metric)
        : (items.find((s) => s.metric === spec.metric && String(s.deviceId ?? s.spaceId ?? "") === spec.id) ?? (items.length === request.specs.length ? items[index] : undefined));
    return {
      key: seriesKey(spec),
      label: spec.label,
      unit: match?.unit ?? spec.unit ?? null,
      raw,
      virtual: Boolean(match?.virtual),
      points: match?.points ?? [],
      gaps: match?.gaps ?? [],
      error: !match,
    };
  });
}

/** 주석을 불러올 대상(기기·공간, 최대 10곳) */
export function annotationTargets(state: ExploreState): { param: "deviceId" | "spaceId"; id: string }[] {
  const seen = new Set<string>();
  const out: { param: "deviceId" | "spaceId"; id: string }[] = [];
  for (const s of state.series) {
    const key = `${s.kind}:${s.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ param: s.kind === "device" ? "deviceId" : "spaceId", id: s.id });
  }
  return out.slice(0, 10);
}

export interface ApiAnnotation {
  id: string;
  timeFrom: string;
  timeTo?: string | null;
  type: string;
  title: string;
  deviceId?: string | null;
  spaceId?: string | null;
  createdBy?: string | null;
}

/** 여러 대상의 주석을 합치고(같은 ID는 한 번), 고른 종류만 남긴다 */
export function mergeAnnotations(lists: ApiAnnotation[][], types: string[]): (ApiAnnotation & ChartAnnotation)[] {
  const byId = new Map<string, ApiAnnotation>();
  for (const list of lists) for (const a of list) byId.set(String(a.id), a);
  return [...byId.values()].filter((a) => types.includes(a.type)).sort((a, b) => Date.parse(a.timeFrom) - Date.parse(b.timeFrom));
}

/** 실시간 구독 토픽(API-DSH-20 `telemetry:{deviceId}.{metric}`). 기기 계열만 */
export function liveTopics(state: ExploreState): string[] {
  return state.series.filter((s) => s.kind === "device" && !s.hidden).map((s) => `telemetry:${s.id}.${s.metric}`);
}

/** 끝이 "지금"이고 원본·1분 단위일 때만 실시간으로 이어 그린다(UI-TSD-01 "실시간") */
export function shouldGoLive(live: boolean, resolutionUsed: string | undefined): boolean {
  return live && (resolutionUsed === "raw" || resolutionUsed === "1m");
}
