/**
 * ChartSpec → ECharts option(ANA-05.02 공통 렌더러, ANA-api §4.2, TC-ANA-118). 결과 화면과 대시보드 분석 위젯(DSH-04.04)이 함께 쓴다.
 * - 색을 정하지 않은 계열은 색약 친화 팔레트 순서(DSH-11.04)
 * - gaps=true(기본)면 null을 이어 그리지 않는다(DSH-05.03)
 * - band는 신뢰구간 띠(ANA-08.02), markers·regions·thresholds는 이상 지점·구간·기준선(ANA-05.03)
 * - calendar·timeline·table은 ECharts가 아니라 화면 부품이 그린다(htmlChart)
 */
import { seriesColor } from "~/lib/palette";
import { tokens } from "~/lib/tokens";
import type { ChartSeriesSpec, ChartSpec } from "./types";

export const ECHARTS_TYPES = ["line", "band", "scatter", "bar", "heatmap", "gauge"] as const;

export function isEchartsType(type: string): boolean {
  return (ECHARTS_TYPES as readonly string[]).includes(type);
}

/** 계열 데이터를 [x, y] 쌍으로 */
export function pairs(series: ChartSeriesSpec): [string | number, number | null][] {
  const data = series.data;
  if (Array.isArray(data)) return data;
  return (data?.x ?? []).map((x, i) => [x, data.y?.[i] ?? null]);
}

/** 심각도 → 토큰 색(위험 bad, 주의 fair, 낮음 text3). 캔버스라 CSS 변수 대신 lib/tokens 값을 쓴다 */
function severityColor(severity: string | undefined, fallback: "bad" | "fair", dark: boolean): string {
  const t = tokens(dark);
  const s = (severity ?? "").toUpperCase();
  if (s === "HIGH" || s === "CRITICAL") return t.bad;
  if (s === "WARN" || s === "MEDIUM") return t.fair;
  if (s === "LOW" || s === "INFO") return t.text3;
  return t[fallback];
}

function axisType(spec: ChartSpec, axis: "x" | "y"): "time" | "category" | "value" {
  const a = axis === "x" ? spec.xAxis : spec.yAxis;
  if (a?.type) return a.type;
  if (axis === "y") return "value";
  const first = spec.series?.[0] ? pairs(spec.series[0])[0]?.[0] : undefined;
  return typeof first === "string" && !Number.isNaN(Date.parse(first)) ? "time" : typeof first === "number" ? "value" : "category";
}

function axisName(a: ChartSpec["xAxis"]): string | undefined {
  if (!a?.label && !a?.unit) return undefined;
  return [a.label, a.unit ? `(${a.unit})` : null].filter(Boolean).join(" ");
}

function cartesian(spec: ChartSpec, dark: boolean): Record<string, unknown> {
  const xType = axisType(spec, "x");
  const kind = spec.type === "bar" ? "bar" : spec.type === "scatter" ? "scatter" : "line";
  const connectNulls = spec.gaps === false;
  const series: Record<string, unknown>[] = (spec.series ?? []).map((s, i) => {
    const color = s.color ?? seriesColor(i, dark);
    return {
      id: s.key,
      name: s.label ?? s.key,
      type: kind,
      data: pairs(s),
      showSymbol: kind === "scatter",
      connectNulls,
      itemStyle: { color },
      lineStyle: kind === "line" ? { color, type: s.style === "dashed" ? "dashed" : "solid" } : undefined,
      areaStyle: s.style === "area" ? { opacity: 0.15 } : undefined,
    };
  });
  // 신뢰구간 띠: 아래 경계(투명) + 폭(반투명)을 쌓는다
  (spec.bands ?? []).forEach((band, i) => {
    const base = spec.series?.[0] ? pairs(spec.series[0]).map((p) => p[0]) : band.lower.map((_, j) => j);
    const color = seriesColor(i, dark);
    const stack = `band-${band.key}`;
    series.push({ id: `${band.key}-lower`, name: band.label ?? band.key, type: "line", stack, data: base.map((x, j) => [x, band.lower[j] ?? null]), lineStyle: { opacity: 0 }, showSymbol: false, connectNulls });
    series.push({
      id: `${band.key}-width`,
      name: band.label ?? band.key,
      type: "line",
      stack,
      data: base.map((x, j) => [x, band.upper[j] != null && band.lower[j] != null ? (band.upper[j] as number) - (band.lower[j] as number) : null]),
      lineStyle: { opacity: 0 },
      areaStyle: { color, opacity: 0.2 },
      showSymbol: false,
      connectNulls,
    });
  });
  const first = series[0];
  if (first) {
    if (spec.markers?.length) first.markPoint = { symbol: "circle", symbolSize: 10, data: spec.markers.map((m) => ({ coord: [m.x, m.y], name: m.label ?? "", itemStyle: { color: severityColor(m.severity, "bad", dark) } })) };
    if (spec.thresholds?.length) first.markLine = { symbol: "none", data: spec.thresholds.map((th) => ({ yAxis: th.value, name: th.label ?? "", label: { formatter: th.label ?? String(th.value) } })) };
    if (spec.regions?.length)
      first.markArea = { data: spec.regions.map((r) => [{ xAxis: r.from, name: r.label ?? "", itemStyle: { color: severityColor(r.severity, "fair", dark), opacity: 0.15 } }, { xAxis: r.to }]) };
  }
  return {
    animation: false,
    tooltip: { trigger: kind === "scatter" ? "item" : "axis" },
    legend: { show: (spec.series?.length ?? 0) > 1 || (spec.bands?.length ?? 0) > 0, type: "scroll", bottom: 0 },
    grid: { left: 48, right: 16, top: 24, bottom: 40 },
    xAxis: { type: xType, name: axisName(spec.xAxis), nameLocation: "middle", nameGap: 26 },
    yAxis: { type: axisType(spec, "y"), name: axisName(spec.yAxis), scale: true },
    series,
  };
}

function heatmap(spec: ChartSpec, dark: boolean): Record<string, unknown> {
  const h = spec.heatmap ?? { xLabels: [], yLabels: [], values: [] };
  const data: [number, number, number | null][] = [];
  let min = Infinity;
  let max = -Infinity;
  h.values.forEach((row, y) =>
    row.forEach((v, x) => {
      data.push([x, y, v]);
      if (typeof v === "number") {
        min = Math.min(min, v);
        max = Math.max(max, v);
      }
    }),
  );
  return {
    animation: false,
    tooltip: { position: "top" },
    grid: { left: 64, right: 16, top: 16, bottom: 56 },
    xAxis: { type: "category", data: h.xLabels },
    yAxis: { type: "category", data: h.yLabels },
    visualMap: { min: Number.isFinite(min) ? min : 0, max: Number.isFinite(max) ? max : 1, calculable: true, orient: "horizontal", left: "center", bottom: 0, inRange: { color: [tokens(dark).accentSoft, seriesColor(0, dark)] } },
    series: [{ type: "heatmap", data, label: { show: false } }],
  };
}

function gauge(spec: ChartSpec, dark: boolean): Record<string, unknown> {
  const g = spec.gauge ?? { value: 0, min: 0, max: 100 };
  return {
    animation: false,
    series: [{ type: "gauge", min: g.min, max: g.max, progress: { show: true, itemStyle: { color: seriesColor(0, dark) } }, detail: { valueAnimation: false, fontSize: 18 }, data: [{ value: g.value, name: spec.title ?? "" }] }],
  };
}

/** ECharts로 그리는 차트의 option. 그 밖의 타입이면 null */
export function chartOption(spec: ChartSpec, dark = false): Record<string, unknown> | null {
  switch (spec.type) {
    case "line":
    case "band":
    case "scatter":
    case "bar":
      return cartesian(spec, dark);
    case "heatmap":
      return heatmap(spec, dark);
    case "gauge":
      return gauge(spec, dark);
    default:
      return null;
  }
}

/** "데이터 표로 보기"(접근성·CSV): 차트를 표 한 장으로 */
export function chartTable(spec: ChartSpec): { columns: string[]; rows: (string | number | null)[][] } {
  if (spec.type === "heatmap" && spec.heatmap) {
    const h = spec.heatmap;
    return { columns: ["", ...h.xLabels], rows: h.yLabels.map((y, i) => [y, ...(h.values[i] ?? [])]) };
  }
  if (spec.type === "gauge" && spec.gauge) return { columns: ["value", "min", "max"], rows: [[spec.gauge.value, spec.gauge.min, spec.gauge.max]] };
  if (spec.type === "calendar" && spec.calendar) return { columns: ["date", "value", "cluster"], rows: spec.calendar.days.map((d) => [d[0], d[1], d[2] ?? null]) };
  if (spec.type === "timeline" && spec.timeline) return { columns: ["from", "to", "label", "state"], rows: spec.timeline.items.map((it) => [it.from, it.to, it.label ?? null, it.state ?? null]) };
  if (spec.type === "table" && spec.table) return { columns: spec.table.columns.map((c) => c.label ?? c.key), rows: spec.table.rows.map((r) => spec.table!.columns.map((c) => (r[c.key] as string | number | null) ?? null)) };
  const series = spec.series ?? [];
  const xs: (string | number)[] = [];
  const seen = new Set<string>();
  for (const s of series)
    for (const [x] of pairs(s))
      if (!seen.has(String(x))) {
        seen.add(String(x));
        xs.push(x);
      }
  const lookup = series.map((s) => new Map(pairs(s).map(([x, y]) => [String(x), y])));
  return { columns: ["x", ...series.map((s) => s.label ?? s.key)], rows: xs.map((x) => [x, ...lookup.map((m) => m.get(String(x)) ?? null)]) };
}

/** 표 → CSV(머리 + 행). 쉼표·따옴표·줄바꿈은 따옴표로 감싼다 */
export function toCsv(columns: string[], rows: (string | number | null | undefined)[][]): string {
  const cell = (v: string | number | null | undefined) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns, ...rows].map((r) => r.map(cell).join(",")).join("\n");
}

/** 달력 칸 색: 군집 번호가 있으면 팔레트, 없으면 값 크기로 진하기 */
export function calendarColor(value: number | null, cluster: number | string | undefined, min: number, max: number, dark = false): { color: string; opacity: number } {
  if (cluster !== undefined && cluster !== null && cluster !== "") return { color: seriesColor(Number(cluster) || 0, dark), opacity: 1 };
  if (value === null) return { color: "transparent", opacity: 1 };
  const ratio = max > min ? (value - min) / (max - min) : 1;
  return { color: seriesColor(0, dark), opacity: 0.2 + 0.8 * ratio };
}
