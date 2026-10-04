/**
 * 출력 연결(UI-DSC-05, DSC-04.01, API-DSC-30~33, BR-DSC-19): 표준 텔레메트리를 외부 MQTT·Webhook으로 전달한다.
 * core OutputConnectionRules와 같은 규칙으로 먼저 검사한다: 토픽 템플릿 변수는 `{spaceCode}`·`{deviceName}`·`{deviceId}`·`{metric}`만,
 * 공용 브로커 `iot-data.java21.net`으로는 보내지 않는다(CLAUDE.md §5), 비밀 헤더(Authorization·토큰)는 헤더가 아니라 비밀값으로.
 */

export const OUTPUT_TYPES = ["MQTT_PUBLISH", "WEBHOOK"] as const;
export type OutputType = (typeof OUTPUT_TYPES)[number];
export const OUTPUT_FORMATS = ["CANONICAL", "TEMPLATE"] as const;
export const TOPIC_VARS = ["spaceCode", "deviceName", "deviceId", "metric"] as const;
/** 본문 템플릿(로직 없는 Mustache 부분집합 `{{이름}}`) 변수(action OutputRenderer.templateValues) */
export const TEMPLATE_VARS = ["deviceId", "deviceName", "spaceCode", "organizationId", "metric", "value", "unit", "quality", "measuredAt"] as const;
export const FORBIDDEN_HOST = "iot-data.java21.net";
export const SECRET_KINDS_BY_TYPE: Record<OutputType, string[]> = { MQTT_PUBLISH: ["PASSWORD", "CA_CERT"], WEBHOOK: ["HEADER_VALUE", "HMAC_KEY"] };

export interface OutputFilter {
  deviceIds: string[];
  groupIds: string[];
  spaceIds: string[];
  metrics: string[];
  qualityMin: number | null;
}

export interface OutputConnection {
  id: string;
  name: string;
  type: OutputType;
  target: Record<string, unknown>;
  filter?: Partial<OutputFilter> | null;
  format: "CANONICAL" | "TEMPLATE";
  template?: string | null;
  secretConfigured?: boolean;
  secretKinds?: string[];
  enabled: boolean;
  version: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface OutputStat {
  t: string;
  sent: number;
  failed: number;
  retried: number;
  lagMs?: number | null;
}

export interface OutputTestResult {
  ok: boolean;
  failureKind?: string | null;
  rendered?: unknown;
  response?: { status?: number | null; bodyPreview?: string | null } | null;
}

export interface OutputFormValues {
  name: string;
  type: OutputType;
  url: string;
  topicTemplate: string;
  qos: number;
  retain: boolean;
  username: string;
  method: "POST" | "PUT";
  headers: { name: string; value: string }[];
  authHeaderName: string;
  batchSize: string;
  batchWaitMs: string;
  deviceIds: string;
  groupIds: string;
  spaceIds: string;
  metrics: string;
  qualityMin: string;
  format: "CANONICAL" | "TEMPLATE";
  template: string;
  enabled: boolean;
  secrets: Record<string, string>;
}

export function emptyOutput(type: OutputType = "MQTT_PUBLISH"): OutputFormValues {
  return {
    name: "",
    type,
    url: "",
    topicTemplate: "d2f/{spaceCode}/{deviceName}/{metric}",
    qos: 1,
    retain: false,
    username: "",
    method: "POST",
    headers: [],
    authHeaderName: "Authorization",
    batchSize: "100",
    batchWaitMs: "1000",
    deviceIds: "",
    groupIds: "",
    spaceIds: "",
    metrics: "",
    qualityMin: "",
    format: "CANONICAL",
    template: '{"device":"{{deviceName}}","metric":"{{metric}}","value":{{value}},"at":"{{measuredAt}}"}',
    enabled: true,
    secrets: {},
  };
}

const csv = (raw: string) =>
  raw
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);

export function outputForm(o: OutputConnection): OutputFormValues {
  const t = o.target ?? {};
  const f = o.filter ?? {};
  const str = (v: unknown, d = "") => (v === undefined || v === null ? d : String(v));
  return {
    ...emptyOutput(o.type),
    name: o.name,
    url: str(t.url),
    topicTemplate: str(t.topicTemplate, ""),
    qos: Number(t.qos ?? 1),
    retain: Boolean(t.retain),
    username: str(t.username),
    method: t.method === "PUT" ? "PUT" : "POST",
    headers: Object.entries((t.headers as Record<string, string> | undefined) ?? {}).map(([name, value]) => ({ name, value: String(value) })),
    authHeaderName: str(t.authHeaderName, "Authorization"),
    batchSize: str(t.batchSize, "100"),
    batchWaitMs: str(t.batchWaitMs, "1000"),
    deviceIds: (f.deviceIds ?? []).join(", "),
    groupIds: (f.groupIds ?? []).join(", "),
    spaceIds: (f.spaceIds ?? []).join(", "),
    metrics: (f.metrics ?? []).join(", "),
    qualityMin: f.qualityMin === null || f.qualityMin === undefined ? "" : String(f.qualityMin),
    format: o.format,
    template: o.template ?? emptyOutput().template,
    enabled: o.enabled,
  };
}

/** 토픽 템플릿 검사: 모르는 변수 목록과 와일드카드 */
export function checkTopicTemplate(template: string): { ok: boolean; unknown: string[]; wildcard: boolean } {
  const vars = Array.from(template.matchAll(/\{([^{}]*)\}/g)).map((m) => m[1]);
  const unknown = vars.filter((v) => !(TOPIC_VARS as readonly string[]).includes(v));
  const wildcard = /[+#]/.test(template);
  return { ok: template.trim().length > 0 && unknown.length === 0 && !wildcard, unknown, wildcard };
}

/** 표본 기기로 토픽 미리 보기 */
export function renderTopic(template: string, sample: Partial<Record<(typeof TOPIC_VARS)[number], string>>): string {
  return template.replace(/\{(spaceCode|deviceName|deviceId|metric)\}/g, (_, name: string) => sample[name as keyof typeof sample] ?? `{${name}}`);
}

/** 본문 템플릿에서 모르는 변수(모르는 변수는 빈 문자열로 바뀌므로 미리 알린다) */
export function unknownTemplateVars(template: string): string[] {
  return Array.from(template.matchAll(/\{\{\{?\s*([A-Za-z][A-Za-z0-9_]*)\s*\}?\}\}/g))
    .map((m) => m[1])
    .filter((v) => !(TEMPLATE_VARS as readonly string[]).includes(v));
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

const SENSITIVE_HEADER = (name: string) => {
  const n = name.toLowerCase();
  return n === "authorization" || n === "proxy-authorization" || n.includes("token") || n.includes("secret") || n.includes("api-key") || n.includes("apikey");
};

export function validateOutput(v: OutputFormValues): Record<string, string> {
  const e: Record<string, string> = {};
  if (!v.name.trim() || v.name.trim().length > 100) e.name = "name";
  const scheme = /^([a-z]+):\/\//i.exec(v.url.trim())?.[1]?.toLowerCase();
  const allowed = v.type === "MQTT_PUBLISH" ? ["mqtt", "mqtts", "ws", "wss", "tcp", "ssl"] : ["http", "https"];
  const host = hostOf(v.url.trim().replace(/^(mqtt|mqtts|tcp|ssl):/i, "http:"));
  if (!scheme || !allowed.includes(scheme) || !host) e.url = "url";
  else if (host === FORBIDDEN_HOST) e.url = "forbiddenHost";
  if (v.type === "MQTT_PUBLISH") {
    const check = checkTopicTemplate(v.topicTemplate);
    if (!v.topicTemplate.trim()) e.topicTemplate = "required";
    else if (!check.ok) e.topicTemplate = "topicVars";
  } else {
    v.headers.forEach((h, i) => {
      if (!/^[A-Za-z0-9-]{1,64}$/.test(h.name)) e[`headers${i}`] = "headerName";
      else if (SENSITIVE_HEADER(h.name)) e[`headers${i}`] = "useSecret";
    });
    const bs = Number(v.batchSize);
    if (!Number.isInteger(bs) || bs < 1 || bs > 500) e.batchSize = "batchSize";
    const bw = Number(v.batchWaitMs);
    if (!Number.isInteger(bw) || bw < 0 || bw > 10000) e.batchWaitMs = "batchWait";
  }
  if (v.qualityMin.trim() !== "") {
    const q = Number(v.qualityMin);
    if (!Number.isInteger(q) || q < 0 || q > 2) e.qualityMin = "quality";
  }
  if (v.format === "TEMPLATE") {
    if (!v.template.trim()) e.template = "required";
    else if (new TextEncoder().encode(v.template).length > 8 * 1024) e.template = "templateSize";
  }
  return e;
}

/** API-DSC-30 본문. 비밀값은 값이 있는 종류만(`{"PASSWORD": "값"}`, core OutputConnectionRules.secrets) */
export function outputBody(v: OutputFormValues): Record<string, unknown> {
  const target: Record<string, unknown> =
    v.type === "MQTT_PUBLISH"
      ? { url: v.url.trim(), topicTemplate: v.topicTemplate.trim(), qos: v.qos, retain: v.retain, ...(v.username.trim() ? { username: v.username.trim() } : {}) }
      : {
          url: v.url.trim(),
          method: v.method,
          headers: Object.fromEntries(v.headers.filter((h) => h.name.trim()).map((h) => [h.name.trim(), h.value])),
          authHeaderName: v.authHeaderName.trim() || "Authorization",
          batchSize: Number(v.batchSize),
          batchWaitMs: Number(v.batchWaitMs),
        };
  const secret = Object.fromEntries(Object.entries(v.secrets).filter(([k, val]) => val && SECRET_KINDS_BY_TYPE[v.type].includes(k)));
  return {
    name: v.name.trim(),
    type: v.type,
    target,
    filter: { deviceIds: csv(v.deviceIds), groupIds: csv(v.groupIds), spaceIds: csv(v.spaceIds), metrics: csv(v.metrics), qualityMin: v.qualityMin.trim() === "" ? null : Number(v.qualityMin) },
    format: v.format,
    template: v.format === "TEMPLATE" ? v.template : null,
    enabled: v.enabled,
    ...(Object.keys(secret).length > 0 ? { secret } : {}),
  };
}

/** 필터 요약(목록 칸) */
export function filterSummary(f: Partial<OutputFilter> | null | undefined): { devices: number; groups: number; spaces: number; metrics: string[]; qualityMin: number | null } {
  return { devices: f?.deviceIds?.length ?? 0, groups: f?.groupIds?.length ?? 0, spaces: f?.spaceIds?.length ?? 0, metrics: f?.metrics ?? [], qualityMin: f?.qualityMin ?? null };
}

/** 지표 합계(분당 전송, 실패, 마지막 지연) */
export function statTotals(stats: OutputStat[]): { sent: number; failed: number; retried: number; lagMs: number | null; perMin: number } {
  const sent = stats.reduce((a, s) => a + s.sent, 0);
  const failed = stats.reduce((a, s) => a + s.failed, 0);
  const retried = stats.reduce((a, s) => a + s.retried, 0);
  const lag = [...stats].reverse().find((s) => s.lagMs !== null && s.lagMs !== undefined)?.lagMs ?? null;
  return { sent, failed, retried, lagMs: lag, perMin: stats.length > 0 ? Math.round((sent / stats.length) * 10) / 10 : 0 };
}
