/**
 * 시계열 차트 모델(UI-TSD-07 공통 차트 컴포넌트, DSH-05.02, DSH-05.03, TSD-01.04, TSD-01.05).
 * API 응답(API-TSD-02 `series[]`, SSE `point`)을 ECharts option으로 바꾼다. 화면 부품은 이 결과를 그리기만 한다.
 * - 공백(BR-DSH-05): 보고 주기의 3배를 넘는 간격과 API `gaps[]`에 null을 넣어 선을 끊는다. 값을 보간하지 않는다
 * - 품질(BR-DSH-06): 1(범위 초과)은 삼각형, 3(의심)은 다이아몬드 점의 별도 계열. 가상 데이터는 점선 + "가상" 범례
 * - 주석(TSD-01.04): 시점은 세로선, 구간은 반투명 영역
 * - 알람·제어 주석(DSH-05.04): 알람 발생·해제는 빨간 실선 세로선, 제어 이벤트는 아이콘 마커(핀)가 달린 파란 세로선. 툴팁에 내용과 시각(표시 시간대)
 * - 시각: 축과 툴팁은 표시 시간대(TSD-01.05). 저장·API는 UTC
 */
import { resolveTimezone } from "./format";

/** [시각(ISO), 값, 품질(원본) 또는 표본 수(집계)] */
export type SeriesPoint = [string, number | null, number | null];

export interface ChartSeries {
  key: string;
  label: string;
  unit?: string | null;
  points: SeriesPoint[];
  gaps?: { from: string; to: string }[];
  virtual?: boolean;
  /** 점의 세 번째 값이 품질 코드인지(원본) 표본 수인지(집계) */
  raw?: boolean;
  /** 이 간격(초)의 3배를 넘으면 공백으로 본다 */
  expectedIntervalSec?: number | null;
  /** 이 계열을 불러오지 못했다(범례에 경고 표시) */
  error?: boolean;
  precision?: number | null;
}

export interface ChartAnnotation {
  id?: string;
  timeFrom: string;
  timeTo?: string | null;
  /** TSD 주석 종류(ALARM·OFFLINE·SCRIPT_ERROR·ANOMALY·USER) 또는 위젯 주석(ALARM·CONTROL, ALARM_RAISED·ALARM_CLEARED) */
  type: string;
  title: string;
  link?: string | null;
}

/** API-DSH-09 선 차트 위젯 응답의 `annotations[]{t, type: ALARM|CONTROL, label, link}` */
export interface WidgetAnnotation {
  t: string;
  type: string;
  label: string;
  link?: string | null;
}

/** 위젯 주석을 차트 주석으로(DSH-05.04). 시각이 잘못된 항목은 버린다 */
export function fromWidgetAnnotations(items: WidgetAnnotation[] | null | undefined): ChartAnnotation[] {
  return (items ?? []).filter((a) => !Number.isNaN(Date.parse(a.t))).map((a, i) => ({ id: `w${i}`, timeFrom: a.t, type: a.type, title: a.label, link: a.link ?? null }));
}

/** 이 주석이 알람 이벤트(빨간 실선)인지, 제어 이벤트(아이콘 마커)인지 */
export function annotationKind(type: string): "alarm" | "control" | "note" {
  if (type === "ALARM" || type === "ALARM_RAISED" || type === "ALARM_CLEARED") return "alarm";
  if (type === "CONTROL") return "control";
  return "note";
}

const ANNOTATION_ICON: Record<string, string> = { ALARM: "▲", ALARM_RAISED: "▲", ALARM_CLEARED: "✔", CONTROL: "⚙" };

export interface ChartLabels {
  outOfRange: string;
  suspect: string;
  virtual: string;
  noData: string;
  gap: string;
}

export interface ChartOptions {
  timezone: string;
  lang?: string;
  labels: ChartLabels;
  annotations?: ChartAnnotation[];
  /** 목표 범위 띠(DEV-01.04) */
  target?: { min?: number | null; max?: number | null } | null;
  dark?: boolean;
}

export const QUALITY = { NORMAL: 0, OUT_OF_RANGE: 1, UNVERIFIED: 2, SUSPECT: 3, TIME_CORRECTED: 4, FORECAST: 5 } as const;

const PALETTE = ["#206bc4", "#2f9e44", "#b7791f", "#ae3ec9", "#d63939", "#0ca678", "#f76707", "#4263eb"];

type Pair = [number, number | null];

/** 공백에 null을 끼워 넣는다(값 보간 없음, TC-DSH-057) */
export function withGaps(series: Pick<ChartSeries, "points" | "gaps" | "expectedIntervalSec">): Pair[] {
  const gaps = (series.gaps ?? []).map((g) => [Date.parse(g.from), Date.parse(g.to)] as const);
  const limit = series.expectedIntervalSec ? series.expectedIntervalSec * 3 * 1000 : undefined;
  const out: Pair[] = [];
  let previous: number | undefined;
  for (const [iso, value] of series.points) {
    const t = Date.parse(iso);
    if (Number.isNaN(t)) continue;
    if (previous !== undefined) {
      const longGap = limit !== undefined && t - previous > limit;
      const declared = gaps.some(([from, to]) => from >= previous! && to <= t && to > from);
      if (longGap || declared) out.push([previous + 1, null]);
    }
    out.push([t, value === undefined ? null : value]);
    previous = t;
  }
  return out;
}

/** 품질 코드가 붙은 점만(원본 계열에서만 의미가 있다) */
export function qualityPoints(series: ChartSeries, quality: number): Pair[] {
  if (!series.raw) return [];
  return series.points.filter((p) => p[2] === quality && p[1] !== null).map((p) => [Date.parse(p[0]), p[1]]);
}

/** 단위별 y축(최대 2개). 세 번째 단위부터는 첫 축을 함께 쓴다 */
export function axisIndexByUnit(series: ChartSeries[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const s of series) {
    const unit = s.unit ?? "";
    if (!map.has(unit)) map.set(unit, Math.min(map.size, 1));
  }
  return map;
}

/** 툴팁 시각(표시 시간대, 초까지) */
export function tooltipTime(timezone: string, lang = "ko") {
  const tz = resolveTimezone(timezone);
  const fmt = new Intl.DateTimeFormat(lang === "ko" ? "ko-KR" : lang, { timeZone: tz, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  return (ms: number) => fmt.format(new Date(ms));
}

/** 시각을 표시 시간대의 `MM-DD HH:mm`으로(축 라벨) */
export function axisLabel(ms: number, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: resolveTimezone(timezone), month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(ms));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

export function roundTo(value: number | null | undefined, precision?: number | null): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "–";
  if (precision === null || precision === undefined) return String(value);
  return value.toFixed(Math.max(0, Math.min(6, precision)));
}

export function hasData(series: ChartSeries[]): boolean {
  return series.some((s) => s.points.some((p) => p[1] !== null));
}

/** ECharts option(직렬화 가능한 객체만, 테스트에서 그대로 비교한다) */
export function buildChartOption(series: ChartSeries[], options: ChartOptions): Record<string, unknown> {
  const axes = axisIndexByUnit(series);
  const units = [...axes.keys()].slice(0, 2);
  const text = options.dark ? "#94a3b5" : "#66768a";
  const line = options.dark ? "#2c3a4b" : "#e1e6ee";
  const out: Record<string, unknown>[] = [];
  const legend: string[] = [];
  series.forEach((s, index) => {
    const color = PALETTE[index % PALETTE.length];
    const name = s.unit ? `${s.label} (${s.unit})` : s.label;
    legend.push(name);
    const yAxisIndex = axes.get(s.unit ?? "") ?? 0;
    out.push({
      id: s.key,
      name,
      type: "line",
      yAxisIndex,
      showSymbol: false,
      connectNulls: false,
      color,
      lineStyle: { width: 1.5, type: s.virtual ? "dashed" : "solid" },
      data: withGaps(s),
      ...(index === 0 ? markings(series, options) : {}),
    });
    const outOfRange = qualityPoints(s, QUALITY.OUT_OF_RANGE);
    if (outOfRange.length) {
      out.push({ id: `${s.key}:q1`, name: options.labels.outOfRange, type: "scatter", yAxisIndex, symbol: "triangle", symbolSize: 9, color: "#f76707", data: outOfRange });
      if (!legend.includes(options.labels.outOfRange)) legend.push(options.labels.outOfRange);
    }
    const suspect = qualityPoints(s, QUALITY.SUSPECT);
    if (suspect.length) {
      out.push({ id: `${s.key}:q3`, name: options.labels.suspect, type: "scatter", yAxisIndex, symbol: "diamond", symbolSize: 9, color: "#ae3ec9", data: suspect });
      if (!legend.includes(options.labels.suspect)) legend.push(options.labels.suspect);
    }
  });
  if (series.some((s) => s.virtual)) {
    out.push({ id: "virtual-legend", name: options.labels.virtual, type: "line", data: [], lineStyle: { type: "dashed" }, color: "#ae3ec9" });
    legend.push(options.labels.virtual);
  }
  return {
    animation: false,
    grid: { left: 48, right: units.length > 1 ? 48 : 16, top: 32, bottom: 48 },
    legend: { data: legend, top: 0, textStyle: { color: text } },
    tooltip: { trigger: "axis" },
    dataZoom: [{ type: "inside" }],
    xAxis: { type: "time", axisLabel: { color: text, hideOverlap: true }, axisLine: { lineStyle: { color: line } }, splitLine: { show: false }, timezone: resolveTimezone(options.timezone) },
    yAxis: (units.length ? units : [""]).map((unit, i) => ({ type: "value", name: unit, position: i === 0 ? "left" : "right", scale: true, axisLabel: { color: text }, splitLine: { lineStyle: { color: line } } })),
    series: out,
  };
}

function markings(series: ChartSeries[], options: ChartOptions): Record<string, unknown> {
  const areas: unknown[] = [];
  const lines: unknown[] = [];
  for (const s of series) {
    for (const gap of s.gaps ?? []) {
      areas.push([{ name: options.labels.gap, xAxis: Date.parse(gap.from), itemStyle: { color: "rgba(102,118,138,0.12)" } }, { xAxis: Date.parse(gap.to) }]);
    }
  }
  for (const a of options.annotations ?? []) {
    const at = Date.parse(a.timeFrom);
    if (Number.isNaN(at)) continue;
    if (a.timeTo) {
      areas.push([{ name: a.title, xAxis: at, itemStyle: { color: "rgba(32,107,196,0.10)" } }, { xAxis: Date.parse(a.timeTo) }]);
      continue;
    }
    const kind = annotationKind(a.type);
    const icon = ANNOTATION_ICON[a.type];
    const text = icon ? `${icon} ${a.title}` : a.title;
    const tooltip = { show: true, formatter: `${text} · ${axisLabel(at, options.timezone)}` };
    if (kind === "alarm") lines.push({ name: a.title, xAxis: at, label: { formatter: text }, lineStyle: { type: "solid", color: "#d63939", width: 1.5 }, tooltip });
    else if (kind === "control") lines.push({ name: a.title, xAxis: at, symbol: ["none", "pin"], symbolSize: 14, label: { formatter: text, position: "end" }, lineStyle: { type: "dashed", color: "#206bc4" }, itemStyle: { color: "#206bc4" }, tooltip });
    else lines.push({ name: a.title, xAxis: at, label: { formatter: a.title }, tooltip });
  }
  const result: Record<string, unknown> = {};
  if (areas.length) result.markArea = { silent: true, data: areas };
  if (lines.length) result.markLine = { symbol: "none", data: lines, lineStyle: { type: "dotted", color: "#d63939" } };
  if (options.target && (options.target.min != null || options.target.max != null)) {
    const band = [{ yAxis: options.target.min ?? "min", itemStyle: { color: "rgba(47,158,68,0.08)" } }, { yAxis: options.target.max ?? "max" }];
    result.markArea = { silent: true, data: [...((result.markArea as { data: unknown[] } | undefined)?.data ?? []), band] };
  }
  return result;
}

/** 실시간 점(API-DSH-20 `point`)을 계열 끝에 붙인다. 최대 개수를 넘으면 앞에서 버린다 */
export function appendPoint(series: ChartSeries, point: { t: string; v: number | null; quality?: number | null }, maxPoints = 2000): ChartSeries {
  const last = series.points[series.points.length - 1];
  if (last && Date.parse(last[0]) >= Date.parse(point.t)) return series;
  const points = [...series.points, [point.t, point.v, point.quality ?? 0] as SeriesPoint];
  return { ...series, points: points.length > maxPoints ? points.slice(points.length - maxPoints) : points };
}

/** 표로 보기(접근성 대체 표): 시각 × 계열 값 */
export function toTable(series: ChartSeries[]): { time: string; values: (number | null)[] }[] {
  const times = new Set<string>();
  for (const s of series) for (const p of s.points) times.add(p[0]);
  const sorted = [...times].sort((a, b) => Date.parse(a) - Date.parse(b));
  const lookup = series.map((s) => new Map(s.points.map((p) => [p[0], p[1]])));
  return sorted.map((time) => ({ time, values: lookup.map((m) => (m.has(time) ? (m.get(time) ?? null) : null)) }));
}
