/**
 * generic-json 디코더 매핑(ING-02.03, DSC-01.06, UI-DSC-02 4단계 매핑 편집기).
 * 매핑(spec/detail/DSC/domain-model §2.1, core SourceConfigValidator):
 * `{deviceIdFrom: "topic[1]" | "$.dev", timePath?: "$.ts", timeFormat?: AUTO|EPOCH_S|EPOCH_MS|ISO8601, metrics: [{path: "$.temp", key: "temperature", unit?: "°C"}]}`
 * 측정 항목은 1~200개, key 중복 금지, unit은 16자 이하
 * 화면은 붙여 넣은 테스트 메시지로 결과를 바로 미리 보여 준다(TC-DSC-045). 서버(pipeline)가 같은 규칙으로 다시 검사한다(TC-ING-040).
 */

export interface MetricMapping {
  path: string;
  key: string;
  unit?: string;
}

export const TIME_FORMATS = ["AUTO", "EPOCH_S", "EPOCH_MS", "ISO8601"] as const;
export type TimeFormat = (typeof TIME_FORMATS)[number];
export const MAX_MAPPED_METRICS = 200;

export interface GenericJsonMapping {
  deviceIdFrom: string;
  timePath?: string;
  timeFormat?: TimeFormat;
  metrics: MetricMapping[];
}

export type PathSegment = { kind: "key"; name: string } | { kind: "index"; index: number } | { kind: "wildcard" };

/** JSONPath 일부(`$`, `.name`, `['name']`, `[0]`, `[*]`)를 해석한다. 틀리면 문자 위치(1부터)를 돌려준다 */
export function parseJsonPath(path: string): { ok: true; segments: PathSegment[] } | { ok: false; position: number } {
  if (!path.startsWith("$")) return { ok: false, position: 1 };
  const segments: PathSegment[] = [];
  let i = 1;
  while (i < path.length) {
    const c = path[i];
    if (c === ".") {
      const match = /^[A-Za-z_][A-Za-z0-9_-]*/.exec(path.slice(i + 1));
      if (!match) return { ok: false, position: i + 2 };
      segments.push({ kind: "key", name: match[0] });
      i += 1 + match[0].length;
    } else if (c === "[") {
      const rest = path.slice(i);
      const index = /^\[(\d+)\]/.exec(rest);
      const star = /^\[\*\]/.exec(rest);
      const quoted = /^\['([^']+)'\]/.exec(rest);
      if (index) {
        segments.push({ kind: "index", index: Number(index[1]) });
        i += index[0].length;
      } else if (star) {
        segments.push({ kind: "wildcard" });
        i += star[0].length;
      } else if (quoted) {
        segments.push({ kind: "key", name: quoted[1] });
        i += quoted[0].length;
      } else return { ok: false, position: i + 1 };
    } else return { ok: false, position: i + 1 };
  }
  return { ok: true, segments };
}

/** 경로가 가리키는 값들(와일드카드는 여러 개). 없으면 빈 배열 */
export function evaluate(root: unknown, segments: PathSegment[]): unknown[] {
  let current: unknown[] = [root];
  for (const segment of segments) {
    const next: unknown[] = [];
    for (const value of current) {
      if (segment.kind === "key" && value && typeof value === "object" && !Array.isArray(value) && segment.name in value) next.push((value as Record<string, unknown>)[segment.name]);
      if (segment.kind === "index" && Array.isArray(value) && segment.index < value.length) next.push(value[segment.index]);
      if (segment.kind === "wildcard" && Array.isArray(value)) next.push(...value);
    }
    current = next;
  }
  return current;
}

const TOPIC_REF = /^topic\[(\d+)\]$/;
export const METRIC_KEY = /^[a-z][a-z0-9_]{0,63}$/i;

export interface MappingProblem {
  field: string;
  /** 문구 키(sources.mapping.*) */
  code: "path" | "topicIndex" | "duplicate" | "metricKey" | "required" | "json" | "tooMany" | "unit";
  position?: number;
  value?: string;
}

/** 매핑 검증(TC-ING-040 규칙: 잘못된 JSONPath, 키 중복, 기기 ID 위치 없음) */
export function validateMapping(mapping: GenericJsonMapping): MappingProblem[] {
  const problems: MappingProblem[] = [];
  const pathProblem = (field: string, path: string) => {
    const parsed = parseJsonPath(path);
    if (!parsed.ok) problems.push({ field, code: "path", position: parsed.position, value: path });
  };
  if (!mapping.deviceIdFrom?.trim()) problems.push({ field: "deviceIdFrom", code: "required" });
  else if (!TOPIC_REF.test(mapping.deviceIdFrom)) pathProblem("deviceIdFrom", mapping.deviceIdFrom);
  if (mapping.timePath) pathProblem("timePath", mapping.timePath);
  if (mapping.metrics.length === 0) problems.push({ field: "metrics", code: "required" });
  if (mapping.metrics.length > MAX_MAPPED_METRICS) problems.push({ field: "metrics", code: "tooMany" });
  const seen = new Set<string>();
  mapping.metrics.forEach((m, i) => {
    pathProblem(`metrics.${i}.path`, m.path);
    if (!METRIC_KEY.test(m.key)) problems.push({ field: `metrics.${i}.key`, code: "metricKey", value: m.key });
    else if (seen.has(m.key)) problems.push({ field: `metrics.${i}.key`, code: "duplicate", value: m.key });
    if (m.unit && m.unit.length > 16) problems.push({ field: `metrics.${i}.unit`, code: "unit", value: m.unit });
    seen.add(m.key);
  });
  return problems;
}

/** 저장된 decoderConfig(JSON 문자열) → 매핑. 형식이 아니면 기본 매핑 */
export function mappingFromConfig(raw: string): GenericJsonMapping {
  try {
    const parsed = JSON.parse(raw) as Partial<GenericJsonMapping>;
    const timeFormat = (TIME_FORMATS as readonly string[]).includes(String(parsed.timeFormat)) ? (parsed.timeFormat as TimeFormat) : "AUTO";
    return {
      deviceIdFrom: parsed.deviceIdFrom ?? "",
      timePath: parsed.timePath ?? "",
      timeFormat,
      metrics: Array.isArray(parsed.metrics) ? parsed.metrics.map((m) => ({ path: String(m.path ?? ""), key: String(m.key ?? ""), unit: m.unit ? String(m.unit) : "" })) : [],
    };
  } catch {
    return { deviceIdFrom: "topic[1]", timePath: "$.ts", metrics: [{ path: "$.temp", key: "temperature" }] };
  }
}

export function mappingToConfig(mapping: GenericJsonMapping): string {
  const out: GenericJsonMapping = {
    deviceIdFrom: mapping.deviceIdFrom.trim(),
    metrics: mapping.metrics.map((m) => (m.unit?.trim() ? { path: m.path.trim(), key: m.key.trim(), unit: m.unit.trim() } : { path: m.path.trim(), key: m.key.trim() })),
  };
  if (mapping.timePath?.trim()) {
    out.timePath = mapping.timePath.trim();
    if (mapping.timeFormat && mapping.timeFormat !== "AUTO") out.timeFormat = mapping.timeFormat;
  }
  return JSON.stringify(out, null, 2);
}

export interface MappingPreview {
  externalId: string | null;
  measuredAt: string | null;
  metrics: { key: string; value: unknown }[];
  error?: "json";
}

/** 시각 해석(timeFormat). AUTO는 숫자면 크기로 초·밀리초를 가르고, 문자열이면 ISO-8601 */
export function toIso(value: unknown, format: TimeFormat = "AUTO"): string | null {
  const numeric = typeof value === "number" ? value : typeof value === "string" && /^\d+(\.\d+)?$/.test(value) ? Number(value) : undefined;
  if (format === "EPOCH_S") return numeric === undefined ? null : new Date(numeric * 1000).toISOString();
  if (format === "EPOCH_MS") return numeric === undefined ? null : new Date(numeric).toISOString();
  if (format === "ISO8601") return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : null;
  if (typeof value === "number") return new Date(value > 1e12 ? value : value * 1000).toISOString();
  if (typeof value === "string" && !Number.isNaN(Date.parse(value))) return new Date(value).toISOString();
  return null;
}

/** 테스트 메시지 미리 보기(TC-DSC-045, TC-ING-039): 토픽 단계·JSON 경로로 기기 ID·시각·측정 항목을 꺼낸다. 경로가 없는 항목은 건너뛴다 */
export function previewMapping(mapping: GenericJsonMapping, topic: string, payloadText: string): MappingPreview {
  let payload: unknown;
  try {
    payload = JSON.parse(payloadText);
  } catch {
    return { externalId: null, measuredAt: null, metrics: [], error: "json" };
  }
  let externalId: string | null = null;
  const topicRef = TOPIC_REF.exec(mapping.deviceIdFrom ?? "");
  if (topicRef) externalId = topic.split("/")[Number(topicRef[1])] ?? null;
  else {
    const parsed = parseJsonPath(mapping.deviceIdFrom ?? "");
    if (parsed.ok) {
      const found = evaluate(payload, parsed.segments)[0];
      externalId = found === undefined || found === null ? null : String(found);
    }
  }
  let measuredAt: string | null = null;
  if (mapping.timePath) {
    const parsed = parseJsonPath(mapping.timePath);
    if (parsed.ok) measuredAt = toIso(evaluate(payload, parsed.segments)[0], mapping.timeFormat ?? "AUTO");
  }
  const metrics: { key: string; value: unknown }[] = [];
  for (const m of mapping.metrics) {
    const parsed = parseJsonPath(m.path);
    if (!parsed.ok || !m.key) continue;
    for (const value of evaluate(payload, parsed.segments)) if (value !== undefined) metrics.push({ key: m.key, value });
  }
  return { externalId, measuredAt, metrics };
}
