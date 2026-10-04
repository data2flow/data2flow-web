/**
 * 사용자 정의 가상 기기 유형(UI-SIM-14, SIM-09.06, API-SIM-03): 편집 값, 입력 검증, 요청 본문.
 * 검증(UI-SIM-14): 이름 2~80자, 특성 키 `^[a-z][a-zA-Z0-9]{1,39}$` 고유, 기본값은 최소~최대 안, 특성 50개 이하,
 * 센서는 측정 항목 1개 이상, 장비는 기능 1개 이상, 물리 영향은 정의한 특성(숫자)만 연결.
 */
import type { Problem } from "./sim";
import type { PropertyDef, SimCategory, SimType } from "./types";

export const MAX_PROPERTY_DEFS = 50;
export const PROPERTY_KEY = /^[a-z][a-zA-Z0-9]{1,39}$/;
/** 물리 영향 종류(냉방·난방·환기·청정·가습·제습·조도·전력) */
export const PHYSICS_EFFECTS = ["COOLING", "HEATING", "VENTILATION", "PURIFICATION", "HUMIDIFICATION", "DEHUMIDIFICATION", "LIGHTING", "POWER"] as const;
/** 측정 항목 기본 출처: 물리 모델 또는 생성기 */
export const METRIC_SOURCES = ["PHYSICS", "GENERATOR"] as const;

export interface DefRow {
  key: string;
  name: string;
  type: PropertyDef["type"];
  unit: string;
  min: string;
  max: string;
  enumValues: string;
  default: string;
  description: string;
}

export interface TypeDraft {
  name: string;
  category: SimCategory;
  icon: string;
  description: string;
  linkedModelCode: string;
  metrics: { key: string; source: (typeof METRIC_SOURCES)[number] }[];
  capabilities: string[];
  defs: DefRow[];
  effects: { effect: string; propertyKey: string }[];
}

const text = (v: unknown) => (v === null || v === undefined ? "" : String(v));

export function emptyDef(): DefRow {
  return { key: "", name: "", type: "number", unit: "", min: "", max: "", enumValues: "", default: "", description: "" };
}

/** 카탈로그 유형(API-SIM-02) → 편집 값. 새 유형은 type 없이 */
export function draftFromType(type?: SimType | null, category: SimCategory = "SENSOR"): TypeDraft {
  if (!type) return { name: "", category, icon: "", description: "", linkedModelCode: "", metrics: [], capabilities: [], defs: [], effects: [] };
  const extra = type;
  return {
    name: type.name,
    category: type.category,
    icon: text(extra.icon),
    description: text(extra.description),
    linkedModelCode: text(type.linkedModelCode),
    metrics: (type.metrics ?? []).map((m) => (typeof m === "string" ? { key: m, source: "PHYSICS" as const } : { key: m.key, source: (m.defaultSource as { kind?: string } | undefined)?.kind === "GENERATOR" ? ("GENERATOR" as const) : ("PHYSICS" as const) })),
    capabilities: [...(type.capabilities ?? [])],
    defs: type.propertyDefs.map((d) => ({ key: d.key, name: d.name, type: d.type, unit: text(d.unit), min: text(d.min), max: text(d.max), enumValues: (d.enumValues ?? []).join(", "), default: text(d.default), description: text(d.description) })),
    effects: (extra.physicsEffects ?? []).map((e) => ({ effect: e.effect, propertyKey: e.propertyKey })),
  };
}

const parseNumber = (raw: string): number | null | undefined => {
  if (raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
};

/** 문제 위치 키: `name`, `metrics`, `capabilities`, `defs`, `defs.<i>.key|min|max|default|enumValues|name`, `effects.<i>` */
export function validateDraft(draft: TypeDraft): Record<string, Problem> {
  const problems: Record<string, Problem> = {};
  const name = draft.name.trim();
  if (name.length < 2 || name.length > 80) problems.name = { key: "length", values: { min: 2, max: 80 } };
  if (draft.category === "SENSOR" && draft.metrics.length === 0) problems.metrics = { key: "metricsRequired" };
  if (draft.category === "ACTUATOR" && draft.capabilities.length === 0) problems.capabilities = { key: "capabilitiesRequired" };
  if (draft.defs.length > MAX_PROPERTY_DEFS) problems.defs = { key: "tooManyDefs", values: { max: MAX_PROPERTY_DEFS } };
  const seen = new Set<string>();
  draft.defs.forEach((d, i) => {
    const at = `defs.${i}`;
    if (!PROPERTY_KEY.test(d.key)) problems[`${at}.key`] = { key: "propertyKey" };
    else if (seen.has(d.key)) problems[`${at}.key`] = { key: "duplicateKey" };
    seen.add(d.key);
    if (!d.name.trim()) problems[`${at}.name`] = { key: "length", values: { min: 1, max: 80 } };
    if (d.type === "number") {
      const min = parseNumber(d.min);
      const max = parseNumber(d.max);
      const value = parseNumber(d.default);
      if (min === undefined) problems[`${at}.min`] = { key: "number" };
      if (max === undefined) problems[`${at}.max`] = { key: "number" };
      if (typeof min === "number" && typeof max === "number" && min > max) problems[`${at}.max`] = { key: "minMax" };
      if (value === undefined || value === null) problems[`${at}.default`] = { key: "number" };
      else if ((typeof min === "number" && value < min) || (typeof max === "number" && value > max)) problems[`${at}.default`] = { key: "range", values: { min: d.min || "-∞", max: d.max || "∞" } };
    } else if (d.type === "enum") {
      const values = enumList(d.enumValues);
      if (values.length === 0) problems[`${at}.enumValues`] = { key: "enumRequired" };
      else if (!values.includes(d.default.trim())) problems[`${at}.default`] = { key: "enum" };
    } else if (d.default !== "true" && d.default !== "false") problems[`${at}.default`] = { key: "boolean" };
  });
  draft.effects.forEach((e, i) => {
    const def = draft.defs.find((d) => d.key === e.propertyKey);
    if (!e.effect || !def || def.type !== "number") problems[`effects.${i}`] = { key: "effectProperty" };
  });
  return problems;
}

export function enumList(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** API-SIM-03 요청 본문(POST·PUT 공통, PUT은 baseVersion을 더한다) */
export function typeBody(draft: TypeDraft): Record<string, unknown> {
  const body: Record<string, unknown> = {
    name: draft.name.trim(),
    category: draft.category,
    propertyDefs: draft.defs.map((d) => {
      const def: Record<string, unknown> = { key: d.key, name: d.name.trim(), type: d.type };
      if (d.unit.trim()) def.unit = d.unit.trim();
      if (d.description.trim()) def.description = d.description.trim();
      if (d.type === "number") {
        const min = parseNumber(d.min);
        const max = parseNumber(d.max);
        if (typeof min === "number") def.min = min;
        if (typeof max === "number") def.max = max;
        def.default = Number(d.default);
      } else if (d.type === "enum") {
        def.enumValues = enumList(d.enumValues);
        def.default = d.default.trim();
      } else def.default = d.default === "true";
      return def;
    }),
  };
  if (draft.icon.trim()) body.icon = draft.icon.trim();
  if (draft.description.trim()) body.description = draft.description.trim();
  if (draft.linkedModelCode) body.linkedModelCode = draft.linkedModelCode;
  if (draft.category === "SENSOR") body.metrics = draft.metrics.map((m) => ({ key: m.key, defaultSource: { kind: m.source } }));
  else {
    body.capabilities = [...draft.capabilities];
    body.physicsEffects = draft.effects.map((e) => ({ effect: e.effect, propertyKey: e.propertyKey }));
  }
  return body;
}
