/**
 * 사용자 정의 대시보드 계약 모양(design/api/DSH-api.md API-DSH-06·07·09·10·13·15, core `board/dto/BoardDtos`).
 * 위젯 배치는 24열 격자 좌표 {x, y, w, h}이고, 대상의 deviceId·spaceId·metricKey는 ID 문자열 또는 변수 참조 `${이름}`이다(DSH-04.05).
 */

export type TargetKind = "DEVICE_METRIC" | "SPACE_AGGREGATE" | "DEVICE" | "SPACE";

export interface WidgetTarget {
  kind: TargetKind | string;
  deviceId?: string | null;
  spaceId?: string | null;
  metricKey?: string | null;
  agg?: string | null;
  label?: string | null;
}

export interface Widget {
  id: string;
  type: string;
  title?: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
  targets?: WidgetTarget[];
  options?: Record<string, unknown>;
}

export type VariableType = "SPACE" | "DEVICE" | "METRIC";

export interface DashboardVariable {
  name: string;
  type: VariableType | string;
  label?: string | null;
  default?: string | null;
}

/** 최근 N(`{relative: "24h"}`) 또는 기간 지정(`{from, to?}`, ISO-8601 UTC) */
export type TimeRange = { relative: string } | { from: string; to?: string | null };

export type Visibility = "PRIVATE" | "ORG";
export type Resolution = "AUTO" | "RAW" | "1h" | "1d";
export type Refresh = "LIVE" | "30s" | "1m" | "5m" | "OFF";

export interface Dashboard {
  id: string;
  name: string;
  description?: string | null;
  visibility: Visibility | string;
  ownerUserId?: string | null;
  layout: { widgets: Widget[] };
  variables: DashboardVariable[];
  timeRange: TimeRange;
  resolution: Resolution | string;
  refresh: Refresh | string;
  templateSource?: string | null;
  editable?: boolean;
  version: number;
  updatedBy?: string | null;
  updatedAt?: string | null;
}

export interface DashboardSummary {
  id: string;
  name: string;
  description?: string | null;
  visibility: string;
  ownerUserId?: string | null;
  ownerName?: string | null;
  favorite: boolean;
  widgetCount: number;
  updatedAt?: string | null;
}

/** API-DSH-13 */
export interface WidgetTypeInfo {
  type: string;
  label: string;
  optionsSchema: { type?: string; properties?: Record<string, OptionRule> };
  targetRule: { min: number; max: number; kinds: string[] };
}

export interface OptionRule {
  type?: string;
  enum?: string[];
  minimum?: number;
  maximum?: number;
  maxLength?: number;
}

/** API-DSH-09 요청 */
export interface WidgetDataRequest {
  timeRange?: TimeRange;
  resolution?: string;
  variables?: Record<string, string>;
}

/** API-DSH-09 응답 {type, data}. 권한 밖이면 data가 `{forbidden: true}`일 수 있다(BR-DSH-09) */
export interface WidgetData {
  type: string;
  data: unknown;
}

export interface SeriesPayload {
  series: { key: string; label: string; unit?: string | null; virtual?: boolean; points: [string, number | null, number | null][] }[];
  effectiveResolution?: string | null;
  annotations?: { t: string; type: string; label: string; link?: string | null }[];
}

export interface StatPayload {
  value: number | null;
  unit?: string | null;
  quality?: number | null;
  at?: string | null;
  previous?: number | null;
  sparkline?: [string, number | null][];
}

export interface GaugePayload {
  value: number | null;
  unit?: string | null;
  min?: number | null;
  max?: number | null;
}

export interface HeatmapPayload {
  xLabels: string[];
  yLabels: string[];
  values: (number | null)[][];
  unit?: string | null;
}

export interface TablePayload {
  columns: string[];
  rows: unknown[][];
}

export interface StatusItem {
  deviceId: string;
  name: string;
  connection?: string | null;
  battery?: number | null;
  rssi?: number | null;
  alarms?: number | null;
}

export interface AlarmItem {
  alarmId: string;
  severity: string;
  title: string;
  state: string;
  at: string;
}

export interface FloorplanPayload {
  spaceId?: string | null;
  imageUrl?: string | null;
  width?: number | null;
  height?: number | null;
  markers: { deviceId: string; x: number; y: number; value?: number | null; unit?: string | null; state?: string | null }[];
}

/** API-DSH-10 */
export interface ShareLink {
  id: string;
  expiresAt: string;
  revokedAt?: string | null;
  lastUsedAt?: string | null;
  createdBy?: string | null;
  createdAt?: string | null;
}

export interface ShareLinkCreated {
  id: string;
  url: string;
  expiresAt: string;
}

/** API-DSH-15 */
export interface SharedDashboard {
  dashboard: Pick<Dashboard, "name" | "layout" | "variables" | "timeRange" | "resolution" | "refresh">;
  expiresAt: string;
  branding?: { logoUrl?: string | null; logoLightUrl?: string | null; primaryColor?: string | null; publicTheme?: string | null } | null;
}

/** 위젯 하나의 화면 상태 */
export type WidgetState =
  | { status: "idle" | "loading"; data?: WidgetData | null }
  | { status: "ok"; data: WidgetData }
  | { status: "forbidden" }
  | { status: "error"; code: string };
