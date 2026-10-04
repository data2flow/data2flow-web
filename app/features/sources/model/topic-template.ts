/**
 * 토픽 템플릿(DSC-09.08, BR-DSC-28): `site/{site}/room/{room}/{deviceId}/{metric}`처럼 토픽 단계 이름을 붙여 기기 ID·공간·측정 항목을 뽑는다.
 * 화면은 표본 토픽으로 바로 미리 보고, 기기 ID·측정 항목 위치를 디코더 설정의 토픽 참조(`deviceIdFrom: "topic[i]"`, single-value
 * `metricFrom`)로 옮긴다(core SourceConfigValidator.topicRef, 0부터 셈). 템플릿과 맞지 않는 토픽은 미처리(UNMATCHED_TOPIC)다.
 */

export type TemplateLevel = { kind: "literal"; value: string } | { kind: "var"; name: string };

export type TemplateParse = { ok: true; levels: TemplateLevel[] } | { ok: false; error: "empty" | "wildcard" | "variable" | "duplicate"; level?: number };

const VAR = /^\{([A-Za-z][A-Za-z0-9_]{0,31})\}$/;
/** 기기 ID로 보는 변수 이름 */
export const DEVICE_VARS = ["deviceId", "externalId", "devEui", "device"];
/** 측정 항목으로 보는 변수 이름 */
export const METRIC_VARS = ["metric", "measurement"];
/** 공간으로 보는 변수 이름(미리 보기만, 공간 지정은 기기 기본 공간으로) */
export const SPACE_VARS = ["site", "building", "floor", "room", "space", "spaceCode"];

export function parseTopicTemplate(template: string): TemplateParse {
  const t = template.trim();
  if (!t) return { ok: false, error: "empty" };
  const names = new Set<string>();
  const levels: TemplateLevel[] = [];
  const parts = t.split("/");
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part.includes("+") || part.includes("#")) return { ok: false, error: "wildcard", level: i };
    if (part.includes("{") || part.includes("}")) {
      const m = VAR.exec(part);
      if (!m) return { ok: false, error: "variable", level: i };
      if (names.has(m[1])) return { ok: false, error: "duplicate", level: i };
      names.add(m[1]);
      levels.push({ kind: "var", name: m[1] });
    } else levels.push({ kind: "literal", value: part });
  }
  return { ok: true, levels };
}

/** 토픽에서 변수 값을 뽑는다. 단계 수가 다르거나 고정 단계가 다르면 null(미처리) */
export function matchTopic(levels: TemplateLevel[], topic: string): Record<string, string> | null {
  const parts = topic.split("/");
  if (parts.length !== levels.length) return null;
  const out: Record<string, string> = {};
  for (let i = 0; i < levels.length; i++) {
    const level = levels[i];
    if (level.kind === "literal") {
      if (level.value !== parts[i]) return null;
    } else {
      if (!parts[i]) return null;
      out[level.name] = parts[i];
    }
  }
  return out;
}

/** 구독 토픽 필터: 변수 단계를 `+`로 */
export function subscriptionFilter(levels: TemplateLevel[]): string {
  return levels.map((l) => (l.kind === "var" ? "+" : l.value)).join("/");
}

function indexOf(levels: TemplateLevel[], names: string[]): number {
  return levels.findIndex((l) => l.kind === "var" && names.includes(l.name));
}

/** 디코더 설정의 토픽 참조. 해당 변수가 없으면 null */
export function topicRefs(levels: TemplateLevel[]): { deviceIdFrom: string | null; metricFrom: string | null } {
  const d = indexOf(levels, DEVICE_VARS);
  const m = indexOf(levels, METRIC_VARS);
  return { deviceIdFrom: d >= 0 ? `topic[${d}]` : null, metricFrom: m >= 0 ? `topic[${m}]` : null };
}

/** 변수 이름의 역할(미리 보기 표 색·설명) */
export function roleOf(name: string): "device" | "metric" | "space" | "other" {
  if (DEVICE_VARS.includes(name)) return "device";
  if (METRIC_VARS.includes(name)) return "metric";
  if (SPACE_VARS.includes(name)) return "space";
  return "other";
}

/** 디코더 설정(JSON 문자열)에 토픽 참조를 넣는다. generic-json은 deviceIdFrom, single-value는 deviceIdFrom·metricFrom */
export function applyTopicRefs(decoderKey: string, config: string, levels: TemplateLevel[]): string {
  let parsed: Record<string, unknown> = {};
  try {
    const raw = config.trim() ? JSON.parse(config) : {};
    if (raw && typeof raw === "object" && !Array.isArray(raw)) parsed = raw as Record<string, unknown>;
  } catch {
    parsed = {};
  }
  const refs = topicRefs(levels);
  if (refs.deviceIdFrom) parsed.deviceIdFrom = refs.deviceIdFrom;
  if (decoderKey === "single-value" && refs.metricFrom) parsed.metricFrom = refs.metricFrom;
  return JSON.stringify(parsed, null, 2);
}
