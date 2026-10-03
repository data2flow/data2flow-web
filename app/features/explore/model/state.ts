/**
 * 데이터 탐색기 조회 조건(UI-TSD-01 `/explore?q=…`). 주소에 그대로 담아 [링크 복사]로 공유한다.
 * 시각은 UTC ISO로 보관하고(TSD-01.05) 화면에서만 사용자 시간대로 바꾼다.
 */
export const RANGE_KEYS = ["1h", "24h", "7d", "30d", "90d"] as const;
export const RESOLUTIONS = ["auto", "raw", "1m", "1h", "1d"] as const;
export const FILLS = ["none", "previous", "linear"] as const;
export const QUALITIES = ["normal", "all"] as const;
export const AGGS = ["avg", "min", "max", "sum", "last", "count", "twa"] as const;
export const ANNOTATION_TYPES = ["ALARM", "OFFLINE", "SCRIPT_ERROR", "ANOMALY", "USER"] as const;
export const MAX_SERIES = 50;

export type Resolution = (typeof RESOLUTIONS)[number];

export interface SeriesSpec {
  kind: "device" | "space";
  id: string;
  metric: string;
  label: string;
  agg?: string;
  unit?: string;
  hidden?: boolean;
}

export interface ExploreState {
  series: SeriesSpec[];
  /** 기간 키 또는 "custom"(from·to 사용) */
  range: string;
  from?: string;
  to?: string;
  resolution: Resolution;
  fill: (typeof FILLS)[number];
  quality: (typeof QUALITIES)[number];
  includeVirtual: boolean;
  /** 표시할 주석 종류(TSD-01.04) */
  annotations: string[];
}

export function defaultState(): ExploreState {
  return { series: [], range: "24h", resolution: "auto", fill: "none", quality: "normal", includeVirtual: false, annotations: [...ANNOTATION_TYPES] };
}

const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(value as T) ? (value as T) : fallback);

/** 주소의 q 값을 조회 조건으로. 잘못된 값은 기본값으로 바꾼다 */
export function decodeState(raw: string | null | undefined): ExploreState {
  const base = defaultState();
  if (!raw) return base;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return base;
  }
  if (!parsed || typeof parsed !== "object") return base;
  const series = Array.isArray(parsed.series)
    ? (parsed.series as Record<string, unknown>[])
        .filter((s) => s && (s.kind === "device" || s.kind === "space") && s.id && typeof s.metric === "string")
        .slice(0, MAX_SERIES)
        .map((s) => ({
          kind: s.kind as "device" | "space",
          id: String(s.id),
          metric: String(s.metric),
          label: typeof s.label === "string" && s.label ? s.label : `${s.id} ${s.metric}`,
          ...(typeof s.agg === "string" && (AGGS as readonly string[]).includes(s.agg) ? { agg: s.agg } : {}),
          ...(typeof s.unit === "string" ? { unit: s.unit } : {}),
          ...(s.hidden ? { hidden: true } : {}),
        }))
    : [];
  const range = parsed.range === "custom" && typeof parsed.from === "string" && typeof parsed.to === "string" ? "custom" : pick(parsed.range, RANGE_KEYS, "24h");
  return {
    series,
    range,
    ...(range === "custom" ? { from: parsed.from as string, to: parsed.to as string } : {}),
    resolution: pick(parsed.resolution, RESOLUTIONS, "auto"),
    fill: pick(parsed.fill, FILLS, "none"),
    quality: pick(parsed.quality, QUALITIES, "normal"),
    includeVirtual: parsed.includeVirtual === true,
    annotations: Array.isArray(parsed.annotations) ? (parsed.annotations as string[]).filter((t) => (ANNOTATION_TYPES as readonly string[]).includes(t)) : [...ANNOTATION_TYPES],
  };
}

export function encodeState(state: ExploreState): string {
  const { from, to, ...rest } = state;
  return JSON.stringify(state.range === "custom" ? { ...rest, from, to } : rest);
}

/** `/explore?q=…` 주소 */
export function exploreHref(state: ExploreState): string {
  return `/explore?${new URLSearchParams({ q: encodeState(state) })}`;
}

/** 다른 화면에서 여는 짧은 주소(`?deviceId=1042&metrics=co2,temperature&label=AM107`)를 조건으로 */
export function stateFromShortcut(params: URLSearchParams): ExploreState | undefined {
  const deviceId = params.get("deviceId");
  const metrics = (params.get("metrics") ?? "").split(",").filter(Boolean);
  if (!deviceId || metrics.length === 0) return undefined;
  const name = params.get("label") ?? deviceId;
  return { ...defaultState(), series: metrics.slice(0, MAX_SERIES).map((metric) => ({ kind: "device", id: deviceId, metric, label: `${name} ${metric}` })) };
}

/** 시계열 추가. 50개를 넘으면 거부(UI-TSD-01 입력 검증), 같은 대상·항목은 다시 넣지 않는다 */
export function addSeries(state: ExploreState, spec: SeriesSpec): { state: ExploreState; error?: "TOO_MANY_SERIES" } {
  if (state.series.some((s) => s.kind === spec.kind && s.id === spec.id && s.metric === spec.metric)) return { state };
  if (state.series.length >= MAX_SERIES) return { state, error: "TOO_MANY_SERIES" };
  return { state: { ...state, series: [...state.series, spec] } };
}

export function removeSeries(state: ExploreState, index: number): ExploreState {
  return { ...state, series: state.series.filter((_, i) => i !== index) };
}

export function updateSeries(state: ExploreState, index: number, patch: Partial<SeriesSpec>): ExploreState {
  return { ...state, series: state.series.map((s, i) => (i === index ? { ...s, ...patch } : s)) };
}

export function seriesKey(spec: SeriesSpec): string {
  return `${spec.kind === "device" ? "d" : "s"}${spec.id}.${spec.metric}`;
}
