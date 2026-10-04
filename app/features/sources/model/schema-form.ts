/**
 * 커넥터 설정 스키마 폼 모델(UI-DSC-08, DSC-09.01·09.05·09.06, BR-DSC-22). 커넥터가 선언한 JSON Schema(2020-12 부분집합, API-DSC-56)로
 * 탭·필드를 만들고, core `JsonSchemaLite`와 같은 키워드(type·required·properties·additionalProperties(false)·enum·const·pattern·
 * minLength·maxLength·minimum·maximum·minItems·maxItems·items)로 브라우저에서 먼저 검사한다. 서버는 같은 스키마로 다시 검사한다.
 * 새 커넥터가 생겨도 웹 코드를 바꾸지 않고 폼이 나온다(카탈로그 보고 EVT-DSC-09 → 스키마).
 */

export interface JsonSchema {
  type?: string | string[];
  title?: string;
  description?: string;
  enum?: unknown[];
  const?: unknown;
  default?: unknown;
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
  items?: JsonSchema;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean | JsonSchema;
  format?: string;
  writeOnly?: boolean;
  "x-secret"?: boolean;
  "x-ui"?: UiHints;
}

export interface UiTab {
  name: string;
  fields: string[];
}

export interface UiHints {
  tabs?: UiTab[];
  /** 조건부 표시: 필드 → {field, in[]} (다른 필드 값이 목록에 있을 때만 보인다) */
  conditions?: Record<string, { field: string; in: unknown[] }>;
}

/** API-DSC-56 응답 */
export interface ConnectorSchema {
  key: string;
  version?: string;
  jsonSchema: JsonSchema;
  uiHints?: UiHints | null;
  /** 인증 방식 → {required[], optional[]} 비밀값 종류(DSC-09.05 인증 방식 매트릭스) */
  authSecretKinds?: Record<string, { required: string[]; optional: string[] }> | null;
}

export type SchemaValue = Record<string, unknown>;
export type SchemaErrors = Record<string, string>;

/** 서버가 만드는 필드(화면에서 숨기고 필수 검사에서 뺀다). Webhook 수신 키는 core가 32자 난수로 만든다(DSC-01.03) */
export const SERVER_FIELDS: Record<string, string[]> = { webhook: ["sourceKey"] };

/**
 * 스키마에 조건이 없을 때 쓰는 기본 조건(커넥터 스키마 공통 이름). 값이 맞지 않으면 필드를 숨기고 저장 본문에서 뺀다.
 * 인증 방식별 사용자·헤더 필드, Kafka SASL, Modbus 기록 모드.
 */
export const DEFAULT_CONDITIONS: Record<string, { field: string; in: unknown[] }> = {
  username: { field: "auth", in: ["USERPASS", "USER_PASSWORD", "BASIC"] },
  headerName: { field: "auth", in: ["HEADER", "WS_HEADER"] },
  headerScheme: { field: "auth", in: ["HEADER", "WS_HEADER"] },
  saslMechanism: { field: "securityProtocol", in: ["SASL_SSL", "SASL_PLAINTEXT"] },
  log: { field: "mode", in: ["log"] },
  points: { field: "mode", in: ["snapshot", undefined] },
};

/** 비밀값 종류(domain-model §2.4). 여러 줄(PEM·JSON) 입력은 textarea와 파일 올리기 */
export const SECRET_KINDS = ["PASSWORD", "HEADER_VALUE", "CLIENT_CERT", "CLIENT_KEY", "CA_CERT", "TOKEN", "SAS_KEY", "API_KEY", "OAUTH2_CLIENT", "AWS_KEYS", "GCP_SERVICE_ACCOUNT", "HMAC_KEY"] as const;
export const MULTILINE_SECRETS = new Set(["CLIENT_CERT", "CLIENT_KEY", "CA_CERT", "GCP_SERVICE_ACCOUNT", "OAUTH2_CLIENT", "AWS_KEYS"]);

/** core SourceSecrets.AUTH_MATRIX와 같은 기본값(스키마 응답에 authSecretKinds가 없을 때) */
export const AUTH_MATRIX: Record<string, { required: string[]; optional: string[] }> = {
  NONE: { required: [], optional: [] },
  USER_PASSWORD: { required: ["PASSWORD"], optional: [] },
  USERPASS: { required: ["PASSWORD"], optional: [] },
  BASIC: { required: ["PASSWORD"], optional: [] },
  SASL_PLAIN: { required: ["PASSWORD"], optional: [] },
  SASL_SCRAM_256: { required: ["PASSWORD"], optional: [] },
  SASL_SCRAM_512: { required: ["PASSWORD"], optional: [] },
  WS_HEADER: { required: ["HEADER_VALUE"], optional: [] },
  HEADER: { required: ["HEADER_VALUE"], optional: [] },
  MTLS: { required: ["CLIENT_CERT", "CLIENT_KEY"], optional: [] },
  TOKEN: { required: [], optional: ["TOKEN", "SAS_KEY"] },
  BEARER: { required: ["TOKEN"], optional: [] },
  API_KEY: { required: ["API_KEY"], optional: [] },
  OAUTH2_CC: { required: ["OAUTH2_CLIENT"], optional: [] },
  OAUTH2: { required: ["OAUTH2_CLIENT"], optional: [] },
  AWS_SIGV4: { required: [], optional: ["AWS_KEYS", "PASSWORD"] },
  GCP_SERVICE_ACCOUNT: { required: ["GCP_SERVICE_ACCOUNT"], optional: [] },
};

export function typeOf(schema: JsonSchema): string {
  const t = Array.isArray(schema.type) ? schema.type.find((x) => x !== "null") : schema.type;
  if (t) return t;
  if (schema.properties) return "object";
  if (schema.enum) return typeof schema.enum[0] === "number" ? "integer" : "string";
  return "string";
}

export function isSecretField(schema: JsonSchema): boolean {
  return schema.writeOnly === true || schema["x-secret"] === true || schema.format === "password";
}

/** 폼 탭: 스키마 `x-ui.tabs`(응답 uiHints 우선) 순서, 탭에 없는 필드는 "기타" 탭. 서버 필드와 인증 방식 필드(auth)는 빠진다 */
export function schemaTabs(connector: ConnectorSchema): UiTab[] {
  const schema = connector.jsonSchema;
  const props = Object.keys(schema.properties ?? {});
  const hidden = new Set([...(SERVER_FIELDS[connector.key] ?? []), "auth", "tls", "tlsInsecure"]);
  const hints = connector.uiHints?.tabs?.length ? connector.uiHints.tabs : (schema["x-ui"]?.tabs ?? []);
  const seen = new Set<string>();
  const tabs: UiTab[] = [];
  for (const tab of hints) {
    const fields = tab.fields.filter((f) => props.includes(f) && !hidden.has(f) && !seen.has(f));
    fields.forEach((f) => seen.add(f));
    if (fields.length > 0) tabs.push({ name: tab.name, fields });
  }
  const rest = props.filter((f) => !seen.has(f) && !hidden.has(f));
  if (rest.length > 0) tabs.push({ name: tabs.length === 0 ? "connection" : "other", fields: rest });
  return tabs;
}

export function conditionsOf(connector: ConnectorSchema): Record<string, { field: string; in: unknown[] }> {
  const declared = connector.uiHints?.conditions ?? connector.jsonSchema["x-ui"]?.conditions ?? {};
  const props = connector.jsonSchema.properties ?? {};
  const defaults = Object.fromEntries(Object.entries(DEFAULT_CONDITIONS).filter(([field, c]) => field in props && c.field in props));
  return { ...defaults, ...declared };
}

/** 조건에 맞아 보이는 필드인가 */
export function isVisible(field: string, value: SchemaValue, conditions: Record<string, { field: string; in: unknown[] }>): boolean {
  const c = conditions[field];
  if (!c) return true;
  return c.in.includes(value[c.field] as never);
}

/** 기본값으로 채운 시작 값. 템플릿 preset이 있으면 덮어쓴다 */
export function defaultsOf(schema: JsonSchema, preset: SchemaValue = {}): SchemaValue {
  const out: SchemaValue = {};
  for (const [key, sub] of Object.entries(schema.properties ?? {})) {
    if (sub.default !== undefined) out[key] = structuredClone(sub.default);
    else if (typeOf(sub) === "object" && sub.properties) {
      const nested = defaultsOf(sub);
      if (Object.keys(nested).length > 0 && (schema.required ?? []).includes(key)) out[key] = nested;
    }
  }
  return { ...out, ...structuredClone(preset) };
}

function emptyValue(v: unknown): boolean {
  return v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0) || (typeof v === "object" && !Array.isArray(v) && v !== null && Object.keys(v).length === 0);
}

/** 저장 본문용: 빈 문자열·빈 배열·빈 객체, 숨겨진 조건부 필드, 서버 필드를 뺀다 */
export function prune(connector: ConnectorSchema, value: SchemaValue): SchemaValue {
  const conditions = conditionsOf(connector);
  const server = new Set(SERVER_FIELDS[connector.key] ?? []);
  const out: SchemaValue = {};
  for (const [key, v] of Object.entries(value)) {
    if (server.has(key) || !isVisible(key, value, conditions)) continue;
    const cleaned = cleanDeep(v);
    if (!emptyValue(cleaned)) out[key] = cleaned;
  }
  return out;
}

function cleanDeep(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(cleanDeep).filter((x) => !emptyValue(x));
  if (v && typeof v === "object") {
    const o: SchemaValue = {};
    for (const [k, x] of Object.entries(v)) {
      const c = cleanDeep(x);
      if (!emptyValue(c)) o[k] = c;
    }
    return o;
  }
  return v;
}

function matchesType(t: string, v: unknown): boolean {
  switch (t) {
    case "string":
      return typeof v === "string";
    case "integer":
      return typeof v === "number" && Number.isInteger(v);
    case "number":
      return typeof v === "number" && Number.isFinite(v);
    case "boolean":
      return typeof v === "boolean";
    case "array":
      return Array.isArray(v);
    case "object":
      return Boolean(v) && typeof v === "object" && !Array.isArray(v);
    default:
      return true;
  }
}

const join = (path: string, key: string) => (path ? `${path}.${key}` : key);

/**
 * 값 검사(core JsonSchemaLite와 같은 규칙). 결과는 경로 → 오류 코드(NotNull·Type·INVALID·Pattern·Size·Min·Max·UNKNOWN_FIELD).
 * 경로는 `a.b`, 배열은 `a[0].b`.
 */
export function validateSchema(schema: JsonSchema, value: unknown, path = "", errors: SchemaErrors = {}): SchemaErrors {
  if (value === undefined || value === null) return errors;
  const t = typeOf(schema);
  if (!matchesType(t, value)) {
    errors[path] = "Type";
    return errors;
  }
  if (schema.enum && !schema.enum.some((e) => e === value)) errors[path] = "INVALID";
  if (schema.const !== undefined && schema.const !== value) errors[path] = "INVALID";
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors[path] = "Size";
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors[path] = "Size";
    if (schema.pattern && !safeRegex(schema.pattern).test(value)) errors[path] = "Pattern";
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) errors[path] = "Min";
    if (schema.maximum !== undefined && value > schema.maximum) errors[path] = "Max";
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors[path] = "Size";
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors[path] = "Size";
    if (schema.items) value.forEach((item, i) => validateSchema(schema.items as JsonSchema, item, `${path}[${i}]`, errors));
  }
  if (t === "object") {
    const obj = value as SchemaValue;
    for (const r of schema.required ?? []) if (emptyValue(obj[r]) && typeof obj[r] !== "boolean" && typeof obj[r] !== "number") errors[join(path, r)] = "NotNull";
    for (const [key, v] of Object.entries(obj)) {
      const sub = schema.properties?.[key];
      if (!sub) {
        if (schema.additionalProperties === false) errors[join(path, key)] = "UNKNOWN_FIELD";
        continue;
      }
      validateSchema(sub, v, join(path, key), errors);
    }
  }
  return errors;
}

const regexCache = new Map<string, RegExp>();
function safeRegex(pattern: string): RegExp {
  let re = regexCache.get(pattern);
  if (!re) {
    try {
      re = new RegExp(pattern, "u");
    } catch {
      re = /[\s\S]*/;
    }
    regexCache.set(pattern, re);
  }
  return re;
}

/** 커넥터 값 검사: 서버 필드는 필수에서 빼고, 숨겨진 필드는 보지 않는다 */
export function validateConnection(connector: ConnectorSchema, value: SchemaValue): SchemaErrors {
  const server = new Set(SERVER_FIELDS[connector.key] ?? []);
  const schema: JsonSchema = { ...connector.jsonSchema, required: (connector.jsonSchema.required ?? []).filter((r) => !server.has(r) && isVisible(r, value, conditionsOf(connector))) };
  return validateSchema(schema, prune(connector, value));
}

/** 서버 오류 `errors[{field}]`(`connection.url`, `connection.topics[0]`)를 폼 경로로 */
export function serverErrorsToPaths(errors: { field: string; code: string }[] | undefined): SchemaErrors {
  const out: SchemaErrors = {};
  for (const e of errors ?? []) {
    const path = e.field.startsWith("connection.") ? e.field.slice("connection.".length) : e.field;
    out[path] = e.code;
  }
  return out;
}

/** 경로(`a.b[0].c`)의 값을 바꾼 새 객체 */
export function setPath(value: SchemaValue, path: string, next: unknown): SchemaValue {
  const keys = path.replace(/\[(\d+)\]/g, ".$1").split(".");
  const root: SchemaValue = structuredClone(value);
  let cur: Record<string, unknown> | unknown[] = root;
  keys.forEach((key, i) => {
    const last = i === keys.length - 1;
    const index = /^\d+$/.test(key) ? Number(key) : key;
    const container = cur as Record<string | number, unknown>;
    if (last) {
      if (next === undefined) {
        if (Array.isArray(cur)) cur.splice(Number(index), 1);
        else delete container[index];
      } else container[index] = next;
      return;
    }
    if (container[index] === undefined || container[index] === null) container[index] = /^\d+$/.test(keys[i + 1]) ? [] : {};
    cur = container[index] as Record<string, unknown>;
  });
  return root;
}

export function getPath(value: unknown, path: string): unknown {
  return path
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .reduce<unknown>((acc, key) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[key] : undefined), value);
}

/** 숫자 입력 칸 문자열 → 값. 빈 칸은 undefined, 숫자가 아니면 문자열 그대로(형식 오류로 보인다) */
export function parseNumberInput(raw: string, integer: boolean): number | string | undefined {
  const s = raw.trim();
  if (s === "") return undefined;
  const n = Number(s);
  if (!Number.isFinite(n) || (integer && !Number.isInteger(n))) return s;
  return n;
}

/** 새 배열 항목 기본값 */
export function newItem(items: JsonSchema | undefined): unknown {
  if (!items) return "";
  const t = typeOf(items);
  if (t === "object") return defaultsOf(items);
  if (items.default !== undefined) return items.default;
  if (items.enum) return items.enum[0];
  if (t === "integer" || t === "number") return undefined;
  if (t === "boolean") return false;
  return "";
}

// ---------------------------------------------------------------- 인증 방식 매트릭스(DSC-09.05)

/**
 * 인증 방식이 저장되는 위치: 스키마 `auth`가 enum이면 `auth`, 객체면 `auth.type`(HTTP 폴링·SSE: `{type, username, headerName, tokenUrl, clientId, scope}`,
 * core SourceModels.authOf와 같음). 없으면 null
 */
export function authField(connector: ConnectorSchema): { path: "auth" | "auth.type"; methods: string[]; fields: Record<string, JsonSchema> } | null {
  const auth = connector.jsonSchema.properties?.auth;
  if (!auth) return null;
  if (auth.enum?.length) return { path: "auth", methods: auth.enum.map(String), fields: {} };
  const type = auth.properties?.type;
  if (type?.enum?.length) {
    const { type: _type, ...fields } = auth.properties ?? {};
    void _type;
    return { path: "auth.type", methods: type.enum.map(String), fields };
  }
  return null;
}

/** 화면에서 고를 인증 방식: 스키마 `auth`(또는 `auth.type`) enum이 있으면 그것(저장됨), 없으면 커넥터가 지원하는 방식(비밀값 칸만 바꾼다) */
export function authChoices(connector: ConnectorSchema, supported: string[]): { methods: string[]; stored: boolean } {
  const field = authField(connector);
  if (field) return { methods: field.methods, stored: true };
  return { methods: supported.length > 0 ? supported : ["NONE"], stored: false };
}

/** 고른 방식의 비밀값 종류. 응답 매트릭스 → 기본 매트릭스. CA_CERT(사설 CA)는 언제나 선택(core allowedKinds) */
export function secretKindsFor(connector: ConnectorSchema, method: string): { required: string[]; optional: string[] } {
  const m = connector.authSecretKinds?.[method] ?? AUTH_MATRIX[method] ?? { required: [], optional: [] };
  const optional = Array.from(new Set([...m.optional, "CA_CERT"])).filter((k) => !m.required.includes(k));
  return { required: [...m.required], optional };
}

/** 인증 방식 매트릭스 표 행(지원 방식마다 필수·선택 비밀값) */
export function authMatrixRows(connector: ConnectorSchema, supported: string[]): { method: string; required: string[]; optional: string[] }[] {
  const { methods } = authChoices(connector, supported);
  const all = Array.from(new Set([...methods, ...supported]));
  return all.map((method) => ({ method, ...secretKindsFor(connector, method) }));
}

/** 필수 비밀값이 비었나(새 소스, 또는 아직 저장된 적 없는 종류) */
export function missingSecrets(required: string[], values: Record<string, string>, configured: string[] = []): string[] {
  return required.filter((k) => !values[k]?.trim() && !configured.includes(k));
}

/**
 * 비밀값 요청 나누기: API-DSC-02 `secret`은 한 건(`{kind, value}` 또는 mTLS `{cert, key, ca}`)이라 첫 필수 값을 넣고,
 * 나머지는 저장 뒤 API-DSC-58 `PUT …/secrets/{kind}`로 하나씩 보낸다.
 */
export function splitSecrets(method: string, values: Record<string, string>): { primary: Record<string, string> | null; extras: { kind: string; value: string }[] } {
  const filled = Object.entries(values).filter(([, v]) => v && v.trim() !== "");
  if (filled.length === 0) return { primary: null, extras: [] };
  const get = (k: string) => filled.find(([kind]) => kind === k)?.[1];
  if (method === "MTLS" && get("CLIENT_CERT") && get("CLIENT_KEY")) {
    const primary: Record<string, string> = { cert: get("CLIENT_CERT") as string, key: get("CLIENT_KEY") as string };
    if (get("CA_CERT")) primary.ca = get("CA_CERT") as string;
    return { primary, extras: filled.filter(([k]) => !["CLIENT_CERT", "CLIENT_KEY", "CA_CERT"].includes(k)).map(([kind, value]) => ({ kind, value })) };
  }
  const required = AUTH_MATRIX[method]?.required ?? [];
  const first = filled.find(([k]) => required.includes(k)) ?? filled[0];
  return { primary: { kind: first[0], value: first[1] }, extras: filled.filter(([k]) => k !== first[0]).map(([kind, value]) => ({ kind, value })) };
}

// ---------------------------------------------------------------- TLS(DSC-09.06, BR-DSC-29)

export interface TlsSettings {
  minVersion: "" | "1.2" | "1.3";
  sni: string;
  pinnedSha256: string[];
}

export const EMPTY_TLS: TlsSettings = { minVersion: "", sni: "", pinnedSha256: [] };
const PIN = /^(sha256\/)?([A-Fa-f0-9]{64}|[A-Za-z0-9+/]{43}=)$/;
const HOST = /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;

export function tlsFrom(raw: unknown): TlsSettings {
  if (!raw || typeof raw !== "object") return { ...EMPTY_TLS };
  const t = raw as Record<string, unknown>;
  return {
    minVersion: t.minVersion === "1.2" || t.minVersion === "1.3" ? t.minVersion : "",
    sni: typeof t.sni === "string" ? t.sni : "",
    pinnedSha256: Array.isArray(t.pinnedSha256) ? t.pinnedSha256.map(String) : [],
  };
}

/** core SourceConfigValidator.tls와 같은 규칙: 최소 1.2·1.3, SNI는 호스트 이름, 고정 지문은 SHA-256(hex 64 또는 Base64) 최대 5개 */
export function validateTls(tls: TlsSettings): Record<string, string> {
  const errors: Record<string, string> = {};
  if (tls.sni.trim() && !HOST.test(tls.sni.trim())) errors.sni = "sni";
  const pins = tls.pinnedSha256.filter((p) => p.trim());
  if (pins.length > 5) errors.pinnedSha256 = "pinCount";
  pins.forEach((p, i) => {
    if (!PIN.test(p.trim())) errors[`pinnedSha256[${i}]`] = "pin";
  });
  return errors;
}

/** 저장 본문 `connection.tls`. 비었으면 undefined */
export function tlsBody(tls: TlsSettings): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  if (tls.minVersion) out.minVersion = tls.minVersion;
  if (tls.sni.trim()) out.sni = tls.sni.trim();
  const pins = tls.pinnedSha256.map((p) => p.trim()).filter(Boolean);
  if (pins.length > 0) out.pinnedSha256 = pins;
  return Object.keys(out).length > 0 ? out : undefined;
}

/** PEM 인증서 블록 수(CA 묶음 미리 보기). PEM이 아니면 0 */
export function pemCount(value: string): number {
  return (value.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? []).length;
}

export function isPrivateKeyPem(value: string): boolean {
  return /-----BEGIN ([A-Z ]*)PRIVATE KEY-----[\s\S]+?-----END \1PRIVATE KEY-----/.test(value);
}
