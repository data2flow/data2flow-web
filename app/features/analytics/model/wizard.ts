/**
 * 분석 만들기 마법사 모델(UI-ANA-03, ANA-03.01~03.04·04.01). 단계 ① 템플릿 → ② 데이터 연결 → ③ 기간 → ④ 파라미터 → ⑤ 확인·실행.
 * 입력은 단계를 오가도 유지하고 새로고침에 대비해 sessionStorage에 초안을 둔다(TC-ANA-079). 검증 규칙은 화면 명세 "입력 검증" 표.
 */
import type { Binding, BindingSource, CheckResult, JsonSchemaProperty, ParamsSchema, Period, QualityFilter, Resolution, RoleSpec, Schedule, TemplateDetail } from "./types";

export const STEPS = ["template", "bindings", "period", "params", "confirm"] as const;
export type Step = (typeof STEPS)[number];

export interface WizardDraft {
  templateKey: string;
  templateVersion?: string;
  bindings: Binding[];
  periodType: "RELATIVE" | "FIXED";
  days: number;
  from: string;
  to: string;
  resolution: Resolution;
  qualityFilter: QualityFilter;
  includeVirtual: boolean;
  params: Record<string, unknown>;
  name: string;
  runMode: "NOW" | "SCHEDULE";
  schedulePreset: "DAILY" | "WEEKLY" | "CRON";
  scheduleAt: string;
  scheduleWeekday: number;
  cron: string;
  ackWarnings: boolean;
}

export type FieldError = { field: string; code: string; params?: Record<string, string | number> };

export function defaultParams(schema: ParamsSchema | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, prop] of Object.entries(schema?.properties ?? {})) if (prop.default !== undefined) out[key] = prop.default;
  return out;
}

export function newDraft(template: TemplateDetail): WizardDraft {
  return {
    templateKey: template.key,
    templateVersion: template.version,
    bindings: (template.roles ?? []).map((r) => ({ role: r.name, sources: [] })),
    periodType: "RELATIVE",
    days: Math.max(template.requirements?.minPeriodDays ?? 14, 14),
    from: "",
    to: "",
    resolution: "AUTO",
    qualityFilter: "NORMAL_ONLY",
    includeVirtual: false,
    params: defaultParams(template.paramsSchema),
    name: "",
    runMode: "NOW",
    schedulePreset: "DAILY",
    scheduleAt: "06:00",
    scheduleWeekday: 1,
    cron: "",
    ackWarnings: false,
  };
}

/** 같은 소스가 이미 연결돼 있는가 */
export function sameSource(a: BindingSource, b: BindingSource): boolean {
  return a.kind === b.kind && (a.deviceId ?? null) === (b.deviceId ?? null) && (a.spaceId ?? null) === (b.spaceId ?? null) && a.metricKey === b.metricKey && (a.agg ?? null) === (b.agg ?? null);
}

export function addSource(bindings: Binding[], role: string, source: BindingSource): Binding[] {
  const has = bindings.some((b) => b.role === role);
  const list = has ? bindings : [...bindings, { role, sources: [] }];
  return list.map((b) => (b.role === role && !b.sources.some((s) => sameSource(s, source)) ? { ...b, sources: [...b.sources, source] } : b));
}

export function removeSource(bindings: Binding[], role: string, index: number): Binding[] {
  return bindings.map((b) => (b.role === role ? { ...b, sources: b.sources.filter((_, i) => i !== index) } : b));
}

export function renameSource(bindings: Binding[], role: string, index: number, label: string): Binding[] {
  return bindings.map((b) => (b.role === role ? { ...b, sources: b.sources.map((s, i) => (i === index ? { ...s, label } : s)) } : b));
}

function roleRange(role: RoleSpec): { min: number; max: number } {
  const min = role.min ?? (role.required ? 1 : 0);
  const max = role.max ?? 50;
  return { min, max };
}

export function validateBindings(roles: RoleSpec[], bindings: Binding[]): FieldError[] {
  const errors: FieldError[] = [];
  for (const role of roles) {
    const { min, max } = roleRange(role);
    const n = bindings.find((b) => b.role === role.name)?.sources.length ?? 0;
    if (n < min || n > max) errors.push({ field: `bindings.${role.name}`, code: "ROLE_COUNT", params: { role: role.name, min, max } });
  }
  return errors;
}

export function validatePeriod(draft: WizardDraft, template: TemplateDetail, nowMs: number): FieldError[] {
  const max = template.requirements?.maxPeriodDays ?? 365;
  if (draft.periodType === "RELATIVE") {
    if (!Number.isInteger(draft.days) || draft.days < 1 || draft.days > max) return [{ field: "days", code: "DAYS_RANGE", params: { max } }];
    return [];
  }
  const from = Date.parse(draft.from);
  const to = Date.parse(draft.to);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) return [{ field: "to", code: "FIXED_ORDER" }];
  if (to > nowMs) return [{ field: "to", code: "FIXED_FUTURE" }];
  return [];
}

export interface SchemaField {
  key: string;
  prop: JsonSchemaProperty;
  control: "slider" | "select" | "switch" | "text";
  required: boolean;
}

/** JSON Schema → 폼 칸(number→슬라이더+입력, enum→선택, boolean→스위치, 그 밖→글자) */
export function schemaFields(schema: ParamsSchema | undefined): SchemaField[] {
  const required = new Set(schema?.required ?? []);
  return Object.entries(schema?.properties ?? {}).map(([key, prop]) => ({
    key,
    prop,
    required: required.has(key),
    control: prop.enum ? "select" : prop.type === "boolean" ? "switch" : prop.type === "number" || prop.type === "integer" ? "slider" : "text",
  }));
}

export function validateParams(schema: ParamsSchema | undefined, params: Record<string, unknown>): FieldError[] {
  const errors: FieldError[] = [];
  for (const field of schemaFields(schema)) {
    const value = params[field.key];
    const { prop } = field;
    if (value === undefined || value === null || value === "") {
      if (field.required) errors.push({ field: `params.${field.key}`, code: "REQUIRED" });
      continue;
    }
    if (prop.type === "number" || prop.type === "integer") {
      const n = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(n) || (prop.type === "integer" && !Number.isInteger(n))) errors.push({ field: `params.${field.key}`, code: "NUMBER" });
      else if ((prop.minimum !== undefined && n < prop.minimum) || (prop.maximum !== undefined && n > prop.maximum))
        errors.push({ field: `params.${field.key}`, code: "RANGE", params: { min: prop.minimum ?? "", max: prop.maximum ?? "" } });
    } else if (prop.enum && !prop.enum.includes(value as string | number)) {
      errors.push({ field: `params.${field.key}`, code: "ENUM" });
    } else if (prop.type === "string" && typeof value === "string" && prop.maxLength !== undefined && value.length > prop.maxLength) {
      errors.push({ field: `params.${field.key}`, code: "LENGTH", params: { max: prop.maxLength } });
    }
  }
  return errors;
}

/** 5필드 cron, 최소 간격 1시간(분 칸은 숫자 하나여야 한다) */
export function validCron(cron: string): boolean {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  if (!/^([0-5]?\d)$/.test(parts[0])) return false;
  const field = /^(\*|\d+(-\d+)?(,\d+(-\d+)?)*)(\/\d+)?$/;
  return parts.slice(1).every((p) => field.test(p));
}

/** ⑤ 확인: willRun이면(저장 후 실행) 충분성 FAIL은 막고 WARN은 확인 체크가 있어야 한다(BR-ANA-04, TC-ANA-089) */
export function validateConfirm(draft: WizardDraft, check: CheckResult | null, willRun: boolean): FieldError[] {
  const errors: FieldError[] = [];
  const name = draft.name.trim();
  if (name.length < 1 || name.length > 100) errors.push({ field: "name", code: "NAME" });
  if (draft.runMode === "SCHEDULE") {
    if (draft.schedulePreset === "CRON" ? !validCron(draft.cron) : !/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.scheduleAt)) errors.push({ field: "schedule", code: "SCHEDULE" });
  }
  if (willRun && check?.level === "FAIL") errors.push({ field: "check", code: "CHECK_FAIL" });
  if (willRun && check?.level === "WARN" && !draft.ackWarnings) errors.push({ field: "ackWarnings", code: "ACK" });
  return errors;
}

export function periodOf(draft: WizardDraft): Period {
  return draft.periodType === "RELATIVE" ? { type: "RELATIVE", days: draft.days } : { type: "FIXED", from: new Date(draft.from).toISOString(), to: new Date(draft.to).toISOString() };
}

export function scheduleOf(draft: WizardDraft): Schedule | null {
  if (draft.runMode !== "SCHEDULE") return null;
  if (draft.schedulePreset === "CRON") return { cron: draft.cron.trim() };
  return draft.schedulePreset === "WEEKLY" ? { preset: "WEEKLY", at: draft.scheduleAt, weekday: draft.scheduleWeekday } : { preset: "DAILY", at: draft.scheduleAt };
}

/** 빈 역할은 보내지 않는다 */
function usedBindings(draft: WizardDraft): Binding[] {
  return draft.bindings.filter((b) => b.sources.length > 0);
}

/** API-ANA-05 요청 */
export function checkBody(draft: WizardDraft) {
  return { version: draft.templateVersion, bindings: usedBindings(draft), period: periodOf(draft), resolution: draft.resolution, qualityFilter: draft.qualityFilter, includeVirtual: draft.includeVirtual, params: draft.params };
}

/** API-ANA-06 요청 */
export function analysisBody(draft: WizardDraft) {
  const schedule = scheduleOf(draft);
  return {
    name: draft.name.trim(),
    templateKey: draft.templateKey,
    templateVersion: draft.templateVersion,
    bindings: usedBindings(draft),
    period: periodOf(draft),
    resolution: draft.resolution,
    qualityFilter: draft.qualityFilter,
    includeVirtual: draft.includeVirtual,
    params: draft.params,
    ...(schedule ? { schedule } : {}),
  };
}

const STORAGE_PREFIX = "data2flow:analytics:draft:";

/** 새로고침 복구용 초안(템플릿마다 하나). 저장소가 없거나 막혀 있으면 조용히 넘어간다 */
export function saveDraft(draft: WizardDraft, step: Step, storage: Storage | undefined = typeof sessionStorage === "undefined" ? undefined : sessionStorage) {
  try {
    storage?.setItem(STORAGE_PREFIX + draft.templateKey, JSON.stringify({ draft, step }));
  } catch {
    /* 저장소를 쓸 수 없으면 복구만 못 한다 */
  }
}

export function loadDraft(templateKey: string, storage: Storage | undefined = typeof sessionStorage === "undefined" ? undefined : sessionStorage): { draft: WizardDraft; step: Step } | null {
  try {
    const raw = storage?.getItem(STORAGE_PREFIX + templateKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { draft?: WizardDraft; step?: Step };
    if (!parsed.draft || parsed.draft.templateKey !== templateKey || !STEPS.includes(parsed.step as Step)) return null;
    return { draft: parsed.draft, step: parsed.step as Step };
  } catch {
    return null;
  }
}

export function clearDraft(templateKey: string, storage: Storage | undefined = typeof sessionStorage === "undefined" ? undefined : sessionStorage) {
  try {
    storage?.removeItem(STORAGE_PREFIX + templateKey);
  } catch {
    /* 무시 */
  }
}
