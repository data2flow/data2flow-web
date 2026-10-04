/**
 * 규칙 폼 상태(UI-RUL-02): 받은 규칙·템플릿·차트 초안 → 편집 상태 → API-RUL-02/03 본문.
 * 검사: 이름 1~100자, 범위 대상 1개 이상·5,000대 이하(BR-RUL-21), 제목 템플릿 1~200자, 시간 조건 시각 형식.
 */
import { descendantIds, type SpaceNode } from "~/lib/spaces";
import { fromEditor, metricsOf, toEditor, validateCondition, type ConditionProblems, type EditorGroup, type FieldProblem } from "./condition";
import type { MetricInfo, RuleCondition, RuleDetail, RulePayload, RuleRow, RuleTemplate, ScopeDevice, ScopeType, Severity, TimeCondition } from "./types";

export const MAX_TARGETS = 5000;
export const MAX_RULES = 1000;
/** 한도 근접 배너(UI-RUL-01 "900개 이상") */
export const RULE_LIMIT_WARN = 900;

export interface RuleFormState {
  name: string;
  templateKey: string;
  scopeType: ScopeType;
  scopeIds: string[];
  includeChildren: boolean;
  condition: EditorGroup;
  timeEnabled: boolean;
  time: TimeCondition;
  severity: Severity;
  titleTemplate: string;
  autoClear: boolean;
  policyId: string;
}

export function emptyForm(): RuleFormState {
  return {
    name: "",
    templateKey: "",
    scopeType: "SPACE",
    scopeIds: [],
    includeChildren: true,
    condition: toEditor(null),
    timeEnabled: false,
    time: { days: [1, 2, 3, 4, 5], from: "", to: "", spaceSchedule: null },
    severity: "MAJOR",
    titleTemplate: "",
    autoClear: true,
    policyId: "",
  };
}

/** 받은 규칙(수정·복제) 또는 API-RUL-07 초안 → 폼 */
export function formFromRule(rule: Partial<RuleDetail> & { condition?: RuleCondition | null }, options: { copySuffix?: string } = {}): RuleFormState {
  const base = emptyForm();
  return {
    ...base,
    name: options.copySuffix ? `${rule.name ?? ""}${options.copySuffix}`.slice(0, 100) : (rule.name ?? ""),
    templateKey: rule.templateKey ?? "",
    scopeType: rule.scope?.type ?? base.scopeType,
    scopeIds: (rule.scope?.ids ?? []).map(String),
    includeChildren: rule.scope?.includeChildren ?? true,
    condition: toEditor(rule.condition ?? null),
    timeEnabled: Boolean(rule.timeCondition),
    time: rule.timeCondition ? { days: rule.timeCondition.days ?? [], from: rule.timeCondition.from ?? "", to: rule.timeCondition.to ?? "", spaceSchedule: rule.timeCondition.spaceSchedule ?? null } : base.time,
    severity: rule.severity ?? base.severity,
    titleTemplate: rule.titleTemplate ?? "",
    autoClear: rule.autoClear ?? true,
    policyId: rule.policyId ? String(rule.policyId) : "",
  };
}

/** 템플릿을 고르면 조건·심각도·제목을 채운다(이름·범위는 그대로) */
export function applyTemplate(form: RuleFormState, template: RuleTemplate | undefined): RuleFormState {
  if (!template) return { ...form, templateKey: "" };
  return {
    ...form,
    templateKey: template.key,
    name: form.name || template.name,
    condition: toEditor(template.defaults.condition),
    severity: template.defaults.severity,
    titleTemplate: template.defaults.titleTemplate,
  };
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function timePayload(form: RuleFormState): TimeCondition | null {
  if (!form.timeEnabled) return null;
  const out: TimeCondition = { days: [...form.time.days].sort((a, b) => a - b) };
  if (form.time.from) out.from = form.time.from;
  if (form.time.to) out.to = form.time.to;
  if (form.time.spaceSchedule) out.spaceSchedule = form.time.spaceSchedule;
  return out;
}

export function toPayload(form: RuleFormState, baseVersion?: number): RulePayload {
  const payload: RulePayload = {
    name: form.name.trim(),
    scope: { type: form.scopeType, ids: form.scopeIds, includeChildren: form.scopeType === "SPACE" ? form.includeChildren : false },
    condition: fromEditor(form.condition),
    timeCondition: timePayload(form),
    severity: form.severity,
    titleTemplate: form.titleTemplate.trim(),
    autoClear: form.autoClear,
  };
  if (form.templateKey) payload.templateKey = form.templateKey;
  if (form.policyId) payload.policyId = form.policyId;
  if (baseVersion !== undefined) payload.baseVersion = baseVersion;
  return payload;
}

export type FormProblems = Record<string, FieldProblem>;

export function validateForm(form: RuleFormState, metrics: MetricInfo[], targetCount: number | null): { fields: FormProblems; condition: ConditionProblems } {
  const fields: FormProblems = {};
  const name = form.name.trim();
  if (!name) fields.name = { key: "rules.v.nameRequired" };
  else if (name.length > 100) fields.name = { key: "rules.v.nameLength" };
  if (form.scopeIds.length === 0) fields.scope = { key: "rules.v.scopeRequired" };
  else if (targetCount !== null && targetCount > MAX_TARGETS) fields.scope = { key: "rules.v.targetLimit", params: { n: MAX_TARGETS } };
  const title = form.titleTemplate.trim();
  if (!title) fields.titleTemplate = { key: "rules.v.titleRequired" };
  else if (title.length > 200) fields.titleTemplate = { key: "rules.v.titleLength" };
  if (form.timeEnabled) {
    if (form.time.days.length === 0 && !form.time.spaceSchedule) fields.time = { key: "rules.v.daysRequired" };
    const from = form.time.from ?? "";
    const to = form.time.to ?? "";
    if ((from && !TIME.test(from)) || (to && !TIME.test(to)) || Boolean(from) !== Boolean(to)) fields.time = { key: "rules.v.timeFormat" };
  }
  return { fields, condition: validateCondition(form.condition, metrics) };
}

export function hasProblems(problems: { fields: FormProblems; condition: ConditionProblems }): boolean {
  return Object.keys(problems.fields).length > 0 || Object.keys(problems.condition).length > 0;
}

/**
 * 현재 대상 수 추정(UI-RUL-02 "현재 대상 N대"). 불러온 기기 목록 중 범위에 들고 조건의 측정 항목을 내는 기기를 센다.
 * 정확한 수는 저장 응답의 targetCount(서버 계산)다
 */
export function estimateTargets(form: Pick<RuleFormState, "scopeType" | "scopeIds" | "includeChildren" | "condition">, devices: ScopeDevice[], spaces: SpaceNode[]): number {
  if (form.scopeIds.length === 0) return 0;
  const needed = metricsOf(form.condition);
  const measures = (d: ScopeDevice) => needed.length === 0 || needed.some((m) => d.metrics.includes(m));
  const ids = new Set(form.scopeIds.map(String));
  let inScope: (d: ScopeDevice) => boolean;
  if (form.scopeType === "DEVICE") return devices.filter((d) => ids.has(d.id)).length || ids.size;
  if (form.scopeType === "SPACE") {
    const spaceIds = new Set(form.includeChildren ? [...ids].flatMap((id) => [id, ...descendantIds(spaces, id)]) : [...ids]);
    inScope = (d) => d.spaceId !== null && spaceIds.has(d.spaceId);
  } else if (form.scopeType === "MODEL") inScope = (d) => d.modelCode !== null && ids.has(d.modelCode);
  else inScope = (d) => d.tags.some((tag) => ids.has(tag));
  return devices.filter((d) => inScope(d) && measures(d)).length;
}

/** 서버 검증 오류(api-rules §5 `errors[{field, code, message}]`)를 폼 필드로 */
export function serverFieldProblems(errors: { field: string; code: string; message?: string }[] | undefined): FormProblems {
  const out: FormProblems = {};
  for (const error of errors ?? []) {
    const head = error.field.split(/[.[]/)[0];
    const key = head === "scope" ? "scope" : head === "timeCondition" ? "time" : head === "condition" ? "condition" : head;
    out[key] = { key: `errors.${error.code}`, params: { message: error.message ?? "" } };
  }
  return out;
}

/** 목록 정렬(UI-RUL-01): ERROR 먼저, 그다음 수정 시각 내림차순 */
export function sortRules(rows: RuleRow[]): RuleRow[] {
  return [...rows].sort((a, b) => Number(b.status === "ERROR") - Number(a.status === "ERROR") || Date.parse(b.updatedAt ?? "0") - Date.parse(a.updatedAt ?? "0"));
}
