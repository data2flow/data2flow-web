/** API-DEV-40~56 응답 모양(design/api/DEV-api.md §3~§5) */
export interface ModelSummary {
  id: string;
  code: string;
  vendor?: string;
  name: string;
  protocol?: string;
  kind?: string;
  builtin?: boolean;
  status?: "ACTIVE" | "DEPRECATED";
  deviceCount?: number;
  metricCount?: number;
  updatedAt?: string;
}

export interface ModelDetail extends ModelSummary {
  defaultIntervalSec?: number | null;
  defaultOfflineMultiplier?: number | null;
  description?: string | null;
  metrics?: { key: string; required: boolean }[];
  capabilities?: { capability: string; constraints?: unknown }[];
  package?: { transformScriptId?: string | null; decodeScriptId?: string | null; driverKey?: string | null; defaultDashboardId?: string | null; defaultRuleTemplateIds?: string[]; attributeSchema?: unknown } | null;
  attributeSchema?: unknown;
  version: number;
}

export interface MetricRow {
  id: string;
  key: string;
  displayName?: string;
  unit?: string | null;
  valueType?: string;
  enumMap?: Record<string, number> | null;
  validMin?: number | null;
  validMax?: number | null;
  precision?: number | null;
  aggDefault?: string;
  status?: "VERIFIED" | "UNVERIFIED" | "IGNORED";
  builtin?: boolean;
  aliases?: string[];
  firstSeen?: { at: string; deviceId: string } | null;
  sample?: { deviceId: string; value: number; at: string }[];
  version: number;
}

export interface AliasRow {
  id: string;
  alias: string;
  metricKey: string;
  metricId?: string;
  createdAt?: string;
}

export interface GroupRow {
  id: string;
  name: string;
  type: "STATIC" | "DYNAMIC";
  description?: string | null;
  criteria?: Record<string, unknown> | null;
  memberCount?: number;
  usage?: { rules?: number; flows?: number; dashboards?: number };
  version?: number;
  updatedAt?: string;
}

export interface DeviceLite {
  id: string;
  name: string;
  externalId?: string;
  status?: string;
  model?: { code?: string; name?: string } | null;
  space?: { name?: string; path?: string[] } | null;
}

export interface ScriptLite {
  id: string;
  name: string;
  kind?: string;
}
