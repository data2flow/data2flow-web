/**
 * 위젯 데이터(API-DSH-09 `{type, data}`)를 화면 모양으로 바꾼다.
 * - 시계열(line·area·bar): 공통 차트 계열(ChartSeries)로
 * - 모든 위젯의 "데이터 표로 보기"(DSH-11.03)와 CSV(DSH-06.01)는 같은 표 모양 `{columns, rows}`을 쓴다. 시각 열은 사용자 시간대
 * - 막대·게이지·히트맵 ECharts option(색은 색약 친화 팔레트, DSH-11.04)
 */
import type { ChartSeries } from "~/lib/chart-model";
import { formatDateTime } from "~/lib/format";
import { seriesColor } from "~/lib/palette";
import { tokens } from "~/lib/tokens";
import type { WidgetState, AlarmItem, FloorplanPayload, GaugePayload, HeatmapPayload, SeriesPayload, StatPayload, StatusItem, TablePayload, WidgetData } from "./types";

export function isForbidden(data: unknown): boolean {
  return typeof data === "object" && data !== null && (data as { forbidden?: unknown }).forbidden === true;
}

/** 위젯 요청 결과 → 화면 상태. 권한 밖은 `{forbidden: true}` 또는 403(BR-DSH-09) */
export function stateFromResult(result: { ok: true; status: number; data: WidgetData } | { ok: false; status: number; code: string }): WidgetState {
  if (result.ok) return isForbidden(result.data?.data) ? { status: "forbidden" } : { status: "ok", data: result.data };
  if (result.status === 403 || result.code === "WIDGET_DATA_FORBIDDEN") return { status: "forbidden" };
  return { status: "error", code: result.code };
}

export function toChartSeries(payload: SeriesPayload | null | undefined): ChartSeries[] {
  return (payload?.series ?? []).map((s) => ({
    key: s.key,
    label: s.label,
    unit: s.unit ?? null,
    virtual: Boolean(s.virtual),
    raw: true,
    points: (s.points ?? []).map((p) => [p[0], p[1] ?? null, p[2] ?? null] as [string, number | null, number | null]),
  }));
}

/** 현재값의 추세(직전 대비 화살표) */
export function trendOf(stat: StatPayload): "up" | "down" | "flat" | null {
  if (stat.value === null || stat.value === undefined || stat.previous === null || stat.previous === undefined) return null;
  if (stat.value > stat.previous) return "up";
  if (stat.value < stat.previous) return "down";
  return "flat";
}

/** 임계 색 구간 `[{value, tone}]`: 값 이상인 마지막 구간의 tone */
export function thresholdTone(value: number | null | undefined, thresholds: unknown): "good" | "warn" | "bad" | null {
  if (value === null || value === undefined || !Array.isArray(thresholds)) return null;
  let tone: "good" | "warn" | "bad" | null = null;
  for (const t of thresholds as { value?: unknown; tone?: unknown }[]) {
    if (typeof t?.value === "number" && value >= t.value && (t.tone === "good" || t.tone === "warn" || t.tone === "bad")) tone = t.tone;
  }
  return tone;
}

export interface TableView {
  columns: string[];
  rows: (string | number | null)[][];
}

export interface TableLabels {
  time: string;
  value: string;
  unit: string;
  name: string;
  connection: string;
  battery: string;
  rssi: string;
  alarms: string;
  severity: string;
  title: string;
  state: string;
  device: string;
  x: string;
  y: string;
  min: string;
  max: string;
  content: string;
}

const cell = (v: unknown): string | number | null => (v === null || v === undefined ? null : typeof v === "number" ? v : String(v));

/** 위젯 종류별 표(차트 요약 표·CSV 공용). 시각은 표시 시간대로 */
export function widgetTable(widget: { type: string }, data: WidgetData | null | undefined, labels: TableLabels, timezone: string, lang = "ko"): TableView {
  const payload = data?.data as unknown;
  const time = (iso: string | null | undefined) => (iso ? formatDateTime(iso, timezone, lang, true) : null);
  if (!payload || isForbidden(payload)) return { columns: [], rows: [] };
  switch (widget.type) {
    case "line":
    case "area":
    case "bar": {
      const series = (payload as SeriesPayload).series ?? [];
      const byTime = new Map<string, (number | null)[]>();
      series.forEach((s, i) => {
        for (const [t, v] of s.points ?? []) {
          const row = byTime.get(t) ?? Array<number | null>(series.length).fill(null);
          row[i] = v ?? null;
          byTime.set(t, row);
        }
      });
      const rows = [...byTime.entries()].sort(([a], [b]) => Date.parse(a) - Date.parse(b)).map(([t, values]) => [time(t), ...values]);
      return { columns: [labels.time, ...series.map((s) => (s.unit ? `${s.label} (${s.unit})` : s.label))], rows };
    }
    case "stat": {
      const s = payload as StatPayload;
      return { columns: [labels.time, labels.value, labels.unit], rows: [[time(s.at), cell(s.value), cell(s.unit)]] };
    }
    case "gauge": {
      const g = payload as GaugePayload;
      return { columns: [labels.value, labels.unit, labels.min, labels.max], rows: [[cell(g.value), cell(g.unit), cell(g.min), cell(g.max)]] };
    }
    case "heatmap": {
      const h = payload as HeatmapPayload;
      return { columns: ["", ...(h.xLabels ?? [])], rows: (h.yLabels ?? []).map((y, i) => [y, ...((h.values ?? [])[i] ?? []).map(cell)]) };
    }
    case "table": {
      const t = payload as TablePayload;
      return { columns: t.columns ?? [], rows: (t.rows ?? []).map((r) => r.map(cell)) };
    }
    case "status-list": {
      const items = ((payload as { items?: StatusItem[] }).items ?? []) as StatusItem[];
      return { columns: [labels.name, labels.connection, labels.battery, labels.rssi, labels.alarms], rows: items.map((i) => [i.name, cell(i.connection), cell(i.battery), cell(i.rssi), cell(i.alarms)]) };
    }
    case "alarm-list": {
      const items = ((payload as { items?: AlarmItem[] }).items ?? []) as AlarmItem[];
      return { columns: [labels.time, labels.severity, labels.title, labels.state], rows: items.map((a) => [time(a.at), a.severity, a.title, a.state]) };
    }
    case "floorplan": {
      const f = payload as FloorplanPayload;
      return { columns: [labels.device, labels.value, labels.unit, labels.state, labels.x, labels.y], rows: (f.markers ?? []).map((m) => [m.deviceId, cell(m.value), cell(m.unit), cell(m.state), m.x, m.y]) };
    }
    default:
      return { columns: [], rows: [] };
  }
}

/** CSV(UTF-8 BOM, RFC 4180 따옴표) — DSH-06.01 */
export function toCsv(view: TableView): string {
  const esc = (v: string | number | null) => {
    if (v === null) return "";
    const s = String(v);
    return /[",\r\n]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [view.columns, ...view.rows].map((row) => row.map(esc).join(","));
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

/** 내려받기 파일 이름(OS에서 쓸 수 없는 글자 제거) */
export function exportFileName(name: string, ext: string, now = Date.now()): string {
  const stamp = new Date(now).toISOString().slice(0, 16).replace(/[-:T]/g, "");
  const base = (name || "dashboard").replace(/[\\/:*?"<>|\s]+/g, "_").slice(0, 80);
  return `${base}_${stamp}.${ext}`;
}

/** 막대 위젯 option: 계열별 마지막 값(또는 옵션 집계)을 막대 하나로 */
export function barOption(payload: SeriesPayload | null | undefined, options: Record<string, unknown>, dark: boolean): Record<string, unknown> {
  const series = payload?.series ?? [];
  const agg = String(options.agg ?? "last");
  const values = series.map((s) => aggregate((s.points ?? []).map((p) => p[1]), agg));
  let order = series.map((_, i) => i);
  if (options.sort === "asc") order = order.sort((a, b) => (values[a] ?? -Infinity) - (values[b] ?? -Infinity));
  if (options.sort === "desc") order = order.sort((a, b) => (values[b] ?? -Infinity) - (values[a] ?? -Infinity));
  const horizontal = options.orientation === "horizontal";
  const categories = order.map((i) => series[i].label);
  const text = tokens(dark).text2;
  const category = { type: "category", data: categories, axisLabel: { color: text } };
  const value = { type: "value", axisLabel: { color: text } };
  return {
    animation: false,
    grid: { left: horizontal ? 96 : 40, right: 16, top: 16, bottom: 32 },
    tooltip: { trigger: "axis" },
    xAxis: horizontal ? value : category,
    yAxis: horizontal ? category : value,
    series: [{ type: "bar", data: order.map((i, n) => ({ value: values[i], itemStyle: { color: seriesColor(n, dark) } })) }],
  };
}

export function aggregate(values: (number | null)[], agg: string): number | null {
  const nums = values.filter((v): v is number => typeof v === "number");
  if (nums.length === 0) return null;
  switch (agg) {
    case "avg":
      return nums.reduce((a, b) => a + b, 0) / nums.length;
    case "min":
      return Math.min(...nums);
    case "max":
      return Math.max(...nums);
    case "sum":
      return nums.reduce((a, b) => a + b, 0);
    default:
      return nums[nums.length - 1];
  }
}

export function gaugeOption(g: GaugePayload | null | undefined, dark: boolean): Record<string, unknown> {
  const min = g?.min ?? 0;
  const max = g?.max ?? 100;
  return {
    animation: false,
    series: [
      {
        type: "gauge",
        min,
        max,
        progress: { show: true, itemStyle: { color: seriesColor(0, dark) } },
        detail: { valueAnimation: false, formatter: `{value}${g?.unit ? ` ${g.unit}` : ""}`, color: tokens(dark).text, fontSize: 18 },
        data: [{ value: g?.value ?? null }],
      },
    ],
  };
}

export function heatmapOption(h: HeatmapPayload | null | undefined, dark: boolean): Record<string, unknown> {
  const data: [number, number, number | null][] = [];
  (h?.values ?? []).forEach((row, y) => row.forEach((v, x) => data.push([x, y, v])));
  const nums = data.map((d) => d[2]).filter((v): v is number => typeof v === "number");
  const text = tokens(dark).text2;
  return {
    animation: false,
    grid: { left: 48, right: 16, top: 8, bottom: 56 },
    tooltip: { position: "top" },
    xAxis: { type: "category", data: h?.xLabels ?? [], axisLabel: { color: text } },
    yAxis: { type: "category", data: h?.yLabels ?? [], axisLabel: { color: text } },
    // 단일 색상 명도 계단(색약에도 밝기로 구분)
    visualMap: { min: nums.length ? Math.min(...nums) : 0, max: nums.length ? Math.max(...nums) : 1, calculable: false, orient: "horizontal", left: "center", bottom: 0, inRange: { color: [tokens(dark).accentSoft, seriesColor(0, dark)] }, textStyle: { color: text } },
    series: [{ type: "heatmap", data, emphasis: { itemStyle: { borderColor: tokens(dark).text, borderWidth: 1 } } }],
  };
}
