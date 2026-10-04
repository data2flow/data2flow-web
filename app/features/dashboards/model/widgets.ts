/**
 * 위젯 종류와 스키마 검사(DSH-04.01 "위젯 스키마 검증(core-api·web 양쪽)", UI-DSH-05, API-DSH-13).
 * 종류별 대상 수·대상 종류(`targetRule`)와 옵션(`optionsSchema.properties`의 알려진 속성만)을 core와 같은 방식으로 본다.
 * 대상 수 오류 문구는 UI-DSH-04 "데이터를 1~20개 고르세요".
 */
import { variableRef } from "./variables";
import type { OptionRule, Widget, WidgetTarget, WidgetTypeInfo } from "./types";

export const MAX_TARGETS = 20;
const ID = /^\d{1,18}$/;
const METRIC = /^[A-Za-z0-9_.:-]{1,64}$/;
const AGGS = ["avg", "min", "max", "sum", "last", "count"];

export type WidgetErrorCode = "TYPE_UNSUPPORTED" | "TARGET_COUNT" | "TARGET_KIND" | "TARGET_REF" | "METRIC_REQUIRED" | "AGG_INVALID" | "OPTION_INVALID" | "OPTION_ORDER";

export interface WidgetError {
  field: string;
  code: WidgetErrorCode;
  /** 대상 수 오류의 범위 */
  min?: number;
  max?: number;
}

/** 대상 종류별로 확인할 ID 필드 */
export function idFieldOf(kind: string): "deviceId" | "spaceId" {
  return kind === "DEVICE_METRIC" || kind === "DEVICE" ? "deviceId" : "spaceId";
}

export function isMetricKind(kind: string): boolean {
  return kind === "DEVICE_METRIC" || kind === "SPACE_AGGREGATE";
}

function refOk(raw: string | null | undefined, variables: ReadonlySet<string>): boolean {
  const value = raw ?? "";
  if (ID.test(value)) return true;
  const name = variableRef(value);
  return name !== null && variables.has(name);
}

export function validateWidget(widget: Widget, types: readonly WidgetTypeInfo[], variables: ReadonlySet<string>): WidgetError[] {
  const info = types.find((t) => t.type === widget.type);
  if (!info) return [{ field: "type", code: "TYPE_UNSUPPORTED" }];
  const errors: WidgetError[] = [];
  const targets = widget.targets ?? [];
  const max = Math.min(info.targetRule.max, MAX_TARGETS);
  if (targets.length < info.targetRule.min || targets.length > max) {
    errors.push({ field: "targets", code: "TARGET_COUNT", min: info.targetRule.min, max });
  } else {
    targets.forEach((t, i) => errors.push(...validateTarget(t, `targets[${i}]`, info, variables)));
  }
  errors.push(...validateOptions(widget.options, info));
  return errors;
}

function validateTarget(t: WidgetTarget, field: string, info: WidgetTypeInfo, variables: ReadonlySet<string>): WidgetError[] {
  if (!info.targetRule.kinds.includes(t.kind)) return [{ field: `${field}.kind`, code: "TARGET_KIND" }];
  const errors: WidgetError[] = [];
  const idField = idFieldOf(t.kind);
  if (!refOk(t[idField], variables)) errors.push({ field: `${field}.${idField}`, code: "TARGET_REF" });
  if (isMetricKind(t.kind)) {
    const metric = t.metricKey ?? "";
    const name = variableRef(metric);
    if (!METRIC.test(metric) && !(name && variables.has(name))) errors.push({ field: `${field}.metricKey`, code: "METRIC_REQUIRED" });
    if (t.agg && !AGGS.includes(t.agg)) errors.push({ field: `${field}.agg`, code: "AGG_INVALID" });
  }
  return errors;
}

export function optionValid(value: unknown, rule: OptionRule): boolean {
  switch (rule.type) {
    case "string":
      return typeof value === "string" && (rule.maxLength === undefined || value.length <= rule.maxLength) && (!rule.enum || rule.enum.includes(value));
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return Number.isInteger(value) && (rule.minimum === undefined || (value as number) >= rule.minimum) && (rule.maximum === undefined || (value as number) <= rule.maximum);
    case "boolean":
      return typeof value === "boolean";
    case "array":
      return Array.isArray(value);
    case "object":
      return typeof value === "object" && value !== null && !Array.isArray(value);
    default:
      return true;
  }
}

export function validateOptions(options: Record<string, unknown> | undefined, info: WidgetTypeInfo): WidgetError[] {
  if (!options) return [];
  const errors: WidgetError[] = [];
  for (const [key, rule] of Object.entries(info.optionsSchema.properties ?? {})) {
    const value = options[key];
    if (value === undefined || value === null) continue;
    if (!optionValid(value, rule)) errors.push({ field: `options.${key}`, code: "OPTION_INVALID" });
  }
  if (typeof options.min === "number" && typeof options.max === "number" && options.min >= options.max) errors.push({ field: "options.max", code: "OPTION_ORDER" });
  return errors;
}

/** 종류별 기본 크기(24열 격자 칸) */
export const DEFAULT_SIZE: Record<string, { w: number; h: number }> = {
  stat: { w: 4, h: 4 },
  line: { w: 12, h: 8 },
  area: { w: 12, h: 8 },
  bar: { w: 8, h: 8 },
  gauge: { w: 4, h: 5 },
  heatmap: { w: 12, h: 8 },
  table: { w: 12, h: 6 },
  "status-list": { w: 8, h: 6 },
  "alarm-list": { w: 8, h: 6 },
  floorplan: { w: 12, h: 10 },
  markdown: { w: 6, h: 4 },
};

/** 라이브러리 아이콘(UI-DSH-04 와이어프레임) */
export const WIDGET_ICON: Record<string, string> = {
  stat: "▣",
  line: "📈",
  area: "📈",
  bar: "▥",
  gauge: "◔",
  heatmap: "▦",
  table: "☰",
  "status-list": "☰",
  "alarm-list": "▲",
  floorplan: "⌂",
  markdown: "✎",
};

/** 차트 위젯(ECharts로 그리고 PNG를 차트 이미지로 만든다) */
export const CHART_TYPES = new Set(["line", "area", "bar", "gauge", "heatmap"]);

/** 라이브러리에서 고른 종류의 새 위젯(대상은 변수가 있으면 첫 변수로 미리 채운다) */
export function newWidget(info: WidgetTypeInfo, title: string, defaults: { space?: string | null; device?: string | null; metric?: string | null } = {}): Omit<Widget, "id" | "x" | "y"> {
  const size = DEFAULT_SIZE[info.type] ?? { w: 6, h: 6 };
  const targets: WidgetTarget[] = [];
  if (info.targetRule.min > 0) {
    const kind = info.targetRule.kinds[0] ?? "DEVICE_METRIC";
    const target: WidgetTarget = { kind };
    if (idFieldOf(kind) === "deviceId") target.deviceId = defaults.device ?? "";
    else target.spaceId = defaults.space ?? "";
    if (isMetricKind(kind)) target.metricKey = defaults.metric ?? "";
    targets.push(target);
  }
  return { type: info.type, title, ...size, targets, options: {} };
}

/** 실시간(LIVE) 구독 토픽: 값이 정해진 기기 측정 항목만(API-DSH-20 `telemetry:{deviceId}.{metric}`) */
export function liveTopicsOf(widget: Widget, values: Record<string, string>): string[] {
  const topics: string[] = [];
  for (const t of widget.targets ?? []) {
    if (t.kind !== "DEVICE_METRIC") continue;
    const device = variableRef(t.deviceId) ? values[variableRef(t.deviceId) as string] : t.deviceId;
    const metric = variableRef(t.metricKey) ? values[variableRef(t.metricKey) as string] : t.metricKey;
    if (device && metric && ID.test(device)) topics.push(`telemetry:${device}.${metric}`);
  }
  return topics;
}
