/**
 * 기기 모델·측정 항목·그룹 화면의 입력 검증과 요청 본문 만들기(UI-DEV-08·09·11).
 * - 모델: DEV-03.01(BR-DEV-15), 속성 스키마 DEV-07.05
 * - 측정 항목: DEV-04.01(BR-DEV-18), 미검증 승인 DEV-04.02(BR-DEV-16·17)
 * - 그룹: DEV-06.01(BR-DEV-12)
 * 오류 값은 문구 키(`catalog.validation.*`)다. 화면이 4개 언어로 바꾼다.
 */

export const MODEL_CODE_PATTERN = /^[A-Z0-9][A-Z0-9._-]{1,49}$/;
export const METRIC_KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
export const PROTOCOLS = ["LORAWAN", "MQTT", "HTTP", "VIRTUAL", "OTHER"] as const;
export const DEVICE_KINDS = ["SENSOR", "ACTUATOR", "GATEWAY", "HYBRID"] as const;
export const VALUE_TYPES = ["NUMBER", "BOOLEAN", "ENUM"] as const;
export const AGGREGATIONS = ["AVG", "SUM", "MAX", "MIN", "LAST", "COUNT"] as const;
export const DEVICE_STATUSES = ["PENDING", "ACTIVE", "INACTIVE"] as const;
export const GROUP_LIMIT = 1000;

export type Errors = Record<string, string>;

/** 쉼표·줄바꿈으로 나눈 목록(빈 값 제거, 중복 제거) */
export function parseList(raw: string | null | undefined): string[] {
  return [...new Set((raw ?? "").split(/[\n,]+/).map((s) => s.trim()).filter(Boolean))];
}

function numberOrNull(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined || raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : Number.NaN;
}

export interface ModelInput {
  code: string;
  vendor: string;
  name: string;
  protocol: string;
  kind: string;
  defaultIntervalSec: string;
  description?: string;
  metrics: string[];
  requiredMetrics?: string[];
  capabilities: string[];
}

/** 폼 값 → 모델 입력 */
export function readModelForm(form: FormData): ModelInput {
  const get = (name: string) => {
    const value = form.get(name);
    return typeof value === "string" ? value : "";
  };
  return {
    code: get("code"),
    vendor: get("vendor"),
    name: get("name"),
    protocol: get("protocol"),
    kind: get("kind"),
    defaultIntervalSec: get("defaultIntervalSec"),
    description: get("description"),
    metrics: form.getAll("metrics").map(String),
    requiredMetrics: form.has("requiredMetrics") ? form.getAll("requiredMetrics").map(String) : undefined,
    capabilities: parseList(get("capabilities")),
  };
}

export function checkModelInput(input: ModelInput, options: { creating: boolean }): Errors {
  const errors: Errors = {};
  if (options.creating && !MODEL_CODE_PATTERN.test(input.code.trim())) errors.code = "modelCode";
  if (!input.name.trim() || input.name.trim().length > 100) errors.name = "nameRequired";
  if (!input.vendor.trim()) errors.vendor = "vendorRequired";
  if (!(PROTOCOLS as readonly string[]).includes(input.protocol)) errors.protocol = "required";
  if (!(DEVICE_KINDS as readonly string[]).includes(input.kind)) errors.kind = "required";
  if (input.kind === "SENSOR" && input.metrics.length === 0) errors.metrics = "sensorMetric";
  const interval = numberOrNull(input.defaultIntervalSec);
  if (interval !== null && !(Number.isInteger(interval) && interval >= 10 && interval <= 86400)) errors.defaultIntervalSec = "interval";
  return errors;
}

/** API-DEV-40/41 본문. 기능(Capability)은 이름만 저장한다(검증은 M3, ACT-01.03) */
export function modelBody(input: ModelInput, creating: boolean): Record<string, unknown> {
  const required = new Set(input.requiredMetrics ?? input.metrics);
  const body: Record<string, unknown> = {
    vendor: input.vendor.trim(),
    name: input.name.trim(),
    protocol: input.protocol,
    kind: input.kind,
    defaultIntervalSec: numberOrNull(input.defaultIntervalSec),
    description: input.description?.trim() || null,
    metrics: input.metrics.map((key) => ({ key, required: required.has(key) })),
    capabilities: input.capabilities.map((capability) => ({ capability, constraints: null })),
  };
  if (creating) body.code = input.code.trim();
  return body;
}

export interface MetricInput {
  key?: string;
  displayName: string;
  unit?: string;
  valueType: string;
  enumMap?: string;
  validMin?: string;
  validMax?: string;
  precision?: string;
  aggDefault: string;
}

/** `열림=1, 닫힘=0` 또는 JSON 객체 → {라벨: 숫자} */
export function parseEnumMap(raw: string | null | undefined): Record<string, number> | null {
  const text = (raw ?? "").trim();
  if (!text) return null;
  if (text.startsWith("{")) {
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      const out: Record<string, number> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v !== "number") return null;
        out[k] = v;
      }
      return Object.keys(out).length ? out : null;
    } catch {
      return null;
    }
  }
  const out: Record<string, number> = {};
  for (const part of text.split(/[\n,]+/)) {
    const [label, value] = part.split("=").map((s) => s?.trim());
    if (!label || value === undefined || value === "" || !Number.isFinite(Number(value))) return null;
    out[label] = Number(value);
  }
  return out;
}

export function checkMetricInput(input: MetricInput, options: { creating: boolean }): Errors {
  const errors: Errors = {};
  if (options.creating && !METRIC_KEY_PATTERN.test((input.key ?? "").trim())) errors.key = "metricKey";
  if (!input.displayName.trim()) errors.displayName = "nameRequired";
  if (!(VALUE_TYPES as readonly string[]).includes(input.valueType)) errors.valueType = "required";
  if (!(AGGREGATIONS as readonly string[]).includes(input.aggDefault)) errors.aggDefault = "required";
  const min = numberOrNull(input.validMin);
  const max = numberOrNull(input.validMax);
  if (Number.isNaN(min)) errors.validMin = "number";
  if (Number.isNaN(max)) errors.validMax = "number";
  if (min !== null && max !== null && !Number.isNaN(min) && !Number.isNaN(max) && min >= max) errors.validMin = "minMax";
  const precision = numberOrNull(input.precision);
  if (precision !== null && !(Number.isInteger(precision) && precision >= 0 && precision <= 6)) errors.precision = "precision";
  if (input.valueType === "ENUM" && !parseEnumMap(input.enumMap)) errors.enumMap = "enumMap";
  return errors;
}

export function metricBody(input: MetricInput, creating: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {
    displayName: input.displayName.trim(),
    unit: input.unit?.trim() || null,
    valueType: input.valueType,
    enumMap: input.valueType === "ENUM" ? parseEnumMap(input.enumMap) : null,
    validMin: numberOrNull(input.validMin),
    validMax: numberOrNull(input.validMax),
    precision: numberOrNull(input.precision),
    aggDefault: input.aggDefault,
  };
  if (creating) body.key = (input.key ?? "").trim();
  return body;
}

/** 편집 거리(레벤슈타인) */
export function editDistance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = temp;
    }
  }
  return prev[b.length];
}

/** 0~1 문자열 유사도(대소문자·`_` 무시) */
export function similarity(a: string, b: string): number {
  const x = a.toLowerCase().replace(/_/g, "");
  const y = b.toLowerCase().replace(/_/g, "");
  if (!x && !y) return 1;
  return 1 - editDistance(x, y) / Math.max(x.length, y.length);
}

/** 미검증 키와 비슷한 표준 키 추천(UI-DEV-09 미검증 탭). 60% 이상, 높은 순 최대 3개 */
export function recommendKeys(key: string, standardKeys: string[], threshold = 0.6): { key: string; score: number }[] {
  return standardKeys
    .filter((k) => k !== key)
    .map((k) => ({ key: k, score: Math.round(similarity(key, k) * 100) / 100 }))
    .filter((r) => r.score >= threshold)
    .sort((a, b) => b.score - a.score || a.key.localeCompare(b.key))
    .slice(0, 3);
}

export const ATTRIBUTE_TYPES = ["string", "number", "integer", "boolean"] as const;

export interface AttributeField {
  key: string;
  type: string;
  unit?: string;
  default?: unknown;
  required: boolean;
  title?: string;
}

/**
 * 모델의 속성 스키마(DEV-07.05, API-DEV-42 `attributeSchema`)를 읽는다. JSON Schema의 작은 부분집합:
 * `{type:"object", properties:{key:{type, unit?, default?, title?}}, required:[…]}`.
 * 반환: 필드 목록 또는 오류 키(`json`=문법, `schema`=형식)
 */
export function parseAttributeSchema(raw: string): { ok: true; fields: AttributeField[]; schema: Record<string, unknown> | null } | { ok: false; error: "json" | "schema"; detail?: string } {
  const text = raw.trim();
  if (!text) return { ok: true, fields: [], schema: null };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { ok: false, error: "json", detail: error instanceof Error ? error.message : undefined };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ok: false, error: "schema" };
  const schema = parsed as { type?: unknown; properties?: unknown; required?: unknown };
  if (schema.type !== undefined && schema.type !== "object") return { ok: false, error: "schema", detail: "type" };
  if (!schema.properties || typeof schema.properties !== "object" || Array.isArray(schema.properties)) return { ok: false, error: "schema", detail: "properties" };
  const required = schema.required ?? [];
  if (!Array.isArray(required) || required.some((r) => typeof r !== "string")) return { ok: false, error: "schema", detail: "required" };
  const fields: AttributeField[] = [];
  for (const [key, value] of Object.entries(schema.properties as Record<string, unknown>)) {
    const prop = (value ?? {}) as { type?: unknown; unit?: unknown; default?: unknown; title?: unknown };
    if (typeof prop.type !== "string" || !(ATTRIBUTE_TYPES as readonly string[]).includes(prop.type)) return { ok: false, error: "schema", detail: key };
    if (prop.default !== undefined && typeOf(prop.default) !== prop.type && !(prop.type === "number" && typeOf(prop.default) === "integer")) {
      return { ok: false, error: "schema", detail: key };
    }
    fields.push({ key, type: prop.type, unit: typeof prop.unit === "string" ? prop.unit : undefined, default: prop.default, required: (required as string[]).includes(key), title: typeof prop.title === "string" ? prop.title : undefined });
  }
  if ((required as string[]).some((r) => !fields.some((f) => f.key === r))) return { ok: false, error: "schema", detail: "required" };
  return { ok: true, fields, schema: parsed as Record<string, unknown> };
}

function typeOf(value: unknown): string {
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "string") return "string";
  return "other";
}

/** 기기 속성값을 스키마로 검사(필수·타입). 반환: 키별 오류(`required`·`type`·`unknown`) */
export function validateAttributes(fields: AttributeField[], values: Record<string, unknown>): Record<string, "required" | "type" | "unknown"> {
  const errors: Record<string, "required" | "type" | "unknown"> = {};
  for (const field of fields) {
    const value = values[field.key];
    if (value === undefined || value === null || value === "") {
      if (field.required && field.default === undefined) errors[field.key] = "required";
      continue;
    }
    const actual = typeOf(value);
    const fits = actual === field.type || (field.type === "number" && actual === "integer");
    if (!fits) errors[field.key] = "type";
  }
  for (const key of Object.keys(values)) if (!fields.some((f) => f.key === key)) errors[key] = "unknown";
  return errors;
}

/** 화면 입력 문자열을 필드 타입 값으로(숫자·참거짓). 바꿀 수 없으면 문자열 그대로 둬서 타입 오류가 나게 한다 */
export function coerceAttribute(field: AttributeField, raw: string): unknown {
  if (raw === "") return undefined;
  if (field.type === "number" || field.type === "integer") return Number.isFinite(Number(raw)) ? Number(raw) : raw;
  if (field.type === "boolean") return raw === "true" ? true : raw === "false" ? false : raw;
  return raw;
}

export interface GroupCriteriaInput {
  modelIds: string[];
  spaceIds: string[];
  includeDescendants: boolean;
  tags: string[];
  tagMatch: "any" | "all";
  statuses: string[];
}

/** 동적 그룹 조건(API-DEV-30 `criteria`). 빈 조건은 넣지 않는다 */
export function buildCriteria(input: GroupCriteriaInput): Record<string, unknown> {
  const criteria: Record<string, unknown> = {};
  if (input.modelIds.length) criteria.modelIds = input.modelIds;
  if (input.spaceIds.length) {
    criteria.spaceIds = input.spaceIds;
    criteria.includeDescendants = input.includeDescendants;
  }
  if (input.tags.length) criteria.tags = { match: input.tagMatch, values: input.tags };
  if (input.statuses.length) criteria.statuses = input.statuses;
  return criteria;
}

export function criteriaSize(criteria: Record<string, unknown> | null | undefined): number {
  return Object.keys(criteria ?? {}).filter((k) => k !== "includeDescendants").length;
}

/** 저장 전 조건 → 화면 입력값(편집 화면 기본값) */
export function criteriaToInput(criteria: Record<string, unknown> | null | undefined): GroupCriteriaInput {
  const c = (criteria ?? {}) as { modelIds?: string[]; spaceIds?: string[]; includeDescendants?: boolean; tags?: { match?: "any" | "all"; values?: string[] }; statuses?: string[] };
  return {
    modelIds: (c.modelIds ?? []).map(String),
    spaceIds: (c.spaceIds ?? []).map(String),
    includeDescendants: c.includeDescendants ?? true,
    tags: c.tags?.values ?? [],
    tagMatch: c.tags?.match ?? "any",
    statuses: c.statuses ?? [],
  };
}

export function checkGroupInput(input: { name: string; type: string; criteria?: Record<string, unknown>; deviceIds?: string[]; previewCount?: number | null }): Errors {
  const errors: Errors = {};
  if (!input.name.trim() || input.name.trim().length > 100) errors.name = "nameRequired";
  if (input.type !== "STATIC" && input.type !== "DYNAMIC") errors.type = "required";
  if (input.type === "DYNAMIC" && criteriaSize(input.criteria) === 0) errors.criteria = "criteriaRequired";
  if (input.type === "STATIC" && (input.deviceIds?.length ?? 0) > GROUP_LIMIT) errors.deviceIds = "groupLimit";
  if (input.previewCount != null && input.previewCount > GROUP_LIMIT) errors.criteria = "groupLimit";
  return errors;
}

/** 숨은 필드의 조건 JSON. 객체가 아니면 undefined */
export function parseCriteria(raw: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(raw || "{}") as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}
