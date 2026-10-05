/**
 * UI-RUL-02 규칙 만들기·수정 폼(RUL-01.01~10·01.12, RUL-03.02 정책 선택, RUL-06.03 상태, BR-RUL-21 한도, BR-RUL-24 변환된 규칙).
 * 템플릿 → 기본 → 범위(현재 대상 N대) → 조건 빌더 → 시간 조건 → 알람 → 알림 정책 → [시뮬레이션][취소][저장].
 * 저장은 onSave(본문)로 넘기고(라우트 action이 API-RUL-02/03을 부른다), 시뮬레이션은 오른쪽 패널(UI-RUL-03)에서 바로 부른다.
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import type { ChartFactory } from "~/components/charts/timeseries-chart";
import { Alert, Badge, Button, ButtonLink, Card, Checkbox, SelectField, TextField, cx } from "~/components/ui";
import { flattenSpaces, type SpaceNode } from "~/lib/spaces";
import type { RulesApi } from "../api";
import type { FieldProblem } from "../model/condition";
import { applyTemplate, estimateTargets, hasProblems, toPayload, validateForm, type FormProblems, type RuleFormState } from "../model/rule-form";
import { SCOPE_TYPES, SEVERITIES, type MetricInfo, type RulePayload, type RuleStatus, type RuleTemplate, type ScopeDevice, type ScopeType, type Severity } from "../model/types";
import { ConditionBuilder } from "./condition-builder";
import { SimulationPanel } from "./simulation-panel";

export interface PolicyOption {
  notificationPolicyId: string;
  name: string;
}

export interface RuleEditorProps {
  initial: RuleFormState;
  rule?: { ruleId: string; version: number; status: RuleStatus; errorReason?: string | null; targetCount?: number | null; flowId?: string | null } | null;
  templates: RuleTemplate[];
  policies: PolicyOption[];
  spaces: SpaceNode[];
  devices: ScopeDevice[];
  models: { code: string; name: string }[];
  metrics: MetricInfo[];
  canWrite: boolean;
  serverProblems?: FormProblems;
  serverError?: string | null;
  warnings?: string[];
  busy?: boolean;
  onSave: (payload: RulePayload) => void;
  api: RulesApi;
  chartFactory?: ChartFactory;
  now?: () => number;
  /** 목록 행 메뉴 [시뮬레이션]으로 열면 패널을 열고 바로 실행 */
  openSimulation?: boolean;
}

const DAYS = [1, 2, 3, 4, 5, 6, 7];

export function RuleEditor(props: RuleEditorProps) {
  const { t } = useTranslation();
  const { rule, templates, policies, spaces, devices, models, metrics, canWrite, api } = props;
  const [form, setForm] = useState<RuleFormState>(props.initial);
  const [touched, setTouched] = useState(false);
  const [simOpen, setSimOpen] = useState(Boolean(props.openSimulation));
  const converted = rule?.status === "CONVERTED";
  const readOnly = !canWrite || converted;

  const targetCount = useMemo(() => estimateTargets(form, devices, spaces), [form, devices, spaces]);
  const problems = useMemo(() => validateForm(form, metrics, targetCount), [form, metrics, targetCount]);
  const shown = touched ? problems : { fields: {}, condition: {} };
  const fieldError = (key: string) => {
    const problem: FieldProblem | undefined = shown.fields[key] ?? props.serverProblems?.[key];
    return problem ? t(problem.key, { defaultValue: problem.params?.message || t("errors.INVALID_REQUEST"), ...(problem.params ?? {}) }) : undefined;
  };
  const set = <K extends keyof RuleFormState>(key: K, value: RuleFormState[K]) => setForm((f) => ({ ...f, [key]: value }));

  const payloadIfValid = (): RulePayload | null => {
    setTouched(true);
    return hasProblems(problems) ? null : toPayload(form, rule ? rule.version : undefined);
  };

  const save = () => {
    const payload = payloadIfValid();
    if (payload) props.onSave(payload);
  };

  const tags = useMemo(() => [...new Set(devices.flatMap((d) => d.tags))].sort(), [devices]);

  return (
    <div className={cx("grid gap-4", simOpen && "lg:grid-cols-[minmax(0,1fr)_380px]")}>
      <div className="flex min-w-0 flex-col gap-3">
        {rule?.status === "ERROR" && <Alert tone="danger">{t("rules.errorReason", { reason: t(`rules.errorReasons.${rule.errorReason ?? "FLOW_ERROR"}`, { defaultValue: rule.errorReason ?? "" }) })}</Alert>}
        {converted && (
          <Alert tone="info">
            {t("rules.convertedNotice")} {rule?.flowId && <Link className="text-accent underline" to={`/automation/flows/${encodeURIComponent(rule.flowId)}`}>{t("rules.openFlow")}</Link>}
          </Alert>
        )}
        {props.serverError && <Alert tone="danger">{props.serverError}</Alert>}
        {props.warnings && props.warnings.length > 0 && (
          <Alert tone="warning">
            {props.warnings.map((w) => (
              <span key={w} className="block">
                {w}
              </span>
            ))}
          </Alert>
        )}
        {touched && hasProblems(problems) && <Alert tone="danger">{t("rules.form.fixErrors")}</Alert>}
        <Card>
          <fieldset disabled={readOnly} className="flex flex-col gap-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <SelectField
                label={t("rules.form.template")}
                value={form.templateKey}
                onChange={(e) => setForm((f) => applyTemplate(f, templates.find((tpl) => tpl.key === e.target.value)))}
              >
                <option value="">{t("rules.form.custom")}</option>
                {templates.map((tpl) => (
                  <option key={tpl.key} value={tpl.key}>
                    {tpl.name}
                  </option>
                ))}
              </SelectField>
              <TextField label={t("rules.form.name")} value={form.name} maxLength={120} onChange={(e) => set("name", e.target.value)} error={fieldError("name")} />
            </div>

            <ScopeFields form={form} setForm={setForm} spaces={spaces} devices={devices} models={models} tags={tags} error={fieldError("scope")} targetCount={targetCount} savedCount={rule?.targetCount ?? null} />

            <ConditionBuilder root={form.condition} metrics={metrics} problems={shown.condition} onChange={(condition) => set("condition", condition)} />
            {fieldError("condition") && (
              <p role="alert" className="text-[12px] text-bad-ink">
                {fieldError("condition")}
              </p>
            )}

            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-[12.5px] font-medium text-muted">{t("rules.form.time")}</legend>
              <Checkbox label={t("rules.form.timeEnabled")} checked={form.timeEnabled} onChange={(e) => set("timeEnabled", e.target.checked)} />
              {form.timeEnabled && (
                <div className="flex flex-wrap items-end gap-3">
                  <div role="group" aria-label={t("rules.form.days")} className="flex flex-wrap gap-1">
                    {DAYS.map((d) => (
                      <label key={d} className="flex items-center gap-1 text-[13px]">
                        <input type="checkbox" checked={form.time.days.includes(d)} onChange={(e) => set("time", { ...form.time, days: e.target.checked ? [...form.time.days, d] : form.time.days.filter((x) => x !== d) })} />
                        {t(`rules.dow.${d}`)}
                      </label>
                    ))}
                  </div>
                  <TextField label={t("rules.form.timeFrom")} type="time" value={form.time.from ?? ""} onChange={(e) => set("time", { ...form.time, from: e.target.value })} />
                  <TextField label={t("rules.form.timeTo")} type="time" value={form.time.to ?? ""} onChange={(e) => set("time", { ...form.time, to: e.target.value })} />
                  <SelectField label={t("rules.form.schedule")} value={form.time.spaceSchedule ?? ""} onChange={(e) => set("time", { ...form.time, spaceSchedule: (e.target.value || null) as "INSIDE" | "OUTSIDE" | null })}>
                    <option value="">{t("rules.form.scheduleNone")}</option>
                    <option value="INSIDE">{t("rules.form.scheduleInside")}</option>
                    <option value="OUTSIDE">{t("rules.form.scheduleOutside")}</option>
                  </SelectField>
                </div>
              )}
              {fieldError("time") && (
                <p role="alert" className="text-[12px] text-bad-ink">
                  {fieldError("time")}
                </p>
              )}
            </fieldset>

            <div className="grid gap-3 sm:grid-cols-2">
              <SelectField label={t("rules.form.severity")} value={form.severity} onChange={(e) => set("severity", e.target.value as Severity)}>
                {SEVERITIES.map((s) => (
                  <option key={s} value={s}>
                    {t(`alarms.severity.${s}`)}
                  </option>
                ))}
              </SelectField>
              <TextField label={t("rules.form.titleTemplate")} value={form.titleTemplate} maxLength={220} hint={t("rules.form.titleHint")} onChange={(e) => set("titleTemplate", e.target.value)} error={fieldError("titleTemplate")} />
              <Checkbox label={t("rules.form.autoClear")} checked={form.autoClear} onChange={(e) => set("autoClear", e.target.checked)} />
              <SelectField label={t("rules.form.policy")} value={form.policyId} onChange={(e) => set("policyId", e.target.value)} error={fieldError("policyId")}>
                <option value="">{t("rules.form.noPolicy")}</option>
                {policies.map((p) => (
                  <option key={p.notificationPolicyId} value={p.notificationPolicyId}>
                    {p.name}
                  </option>
                ))}
              </SelectField>
            </div>
          </fieldset>
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <Button onClick={() => setSimOpen((v) => !v)} aria-expanded={simOpen}>
              {t("rules.form.simulate")}
            </Button>
            <ButtonLink to="/rules">{t("common.cancel")}</ButtonLink>
            {!readOnly && (
              <Button variant="primary" onClick={save} disabled={props.busy}>
                {t("common.save")}
              </Button>
            )}
          </div>
        </Card>
      </div>
      {simOpen && (
        <aside aria-label={t("rules.sim.panel")}>
          <SimulationPanel api={api} payload={payloadIfValid} ruleId={rule?.ruleId} now={props.now} chartFactory={props.chartFactory} autoRun={Boolean(props.openSimulation)} />
        </aside>
      )}
    </div>
  );
}

function ScopeFields({
  form,
  setForm,
  spaces,
  devices,
  models,
  tags,
  error,
  targetCount,
  savedCount,
}: {
  form: RuleFormState;
  setForm: (fn: (f: RuleFormState) => RuleFormState) => void;
  spaces: SpaceNode[];
  devices: ScopeDevice[];
  models: { code: string; name: string }[];
  tags: string[];
  error?: string;
  targetCount: number;
  savedCount: number | null;
}) {
  const { t } = useTranslation();
  const options: { id: string; label: string; indent?: number }[] =
    form.scopeType === "SPACE"
      ? flattenSpaces(spaces).map((s) => ({ id: s.id, label: s.name, indent: s.depth - 1 }))
      : form.scopeType === "DEVICE"
        ? devices.map((d) => ({ id: d.id, label: d.name }))
        : form.scopeType === "MODEL"
          ? models.map((m) => ({ id: m.code, label: m.name === m.code ? m.code : `${m.name} (${m.code})` }))
          : tags.map((tag) => ({ id: tag, label: tag }));
  const toggle = (id: string) => setForm((f) => ({ ...f, scopeIds: f.scopeIds.includes(id) ? f.scopeIds.filter((x) => x !== id) : [...f.scopeIds, id] }));
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-[12.5px] font-medium text-muted">{t("rules.form.scope")}</legend>
      <div role="radiogroup" aria-label={t("rules.form.scopeType")} className="flex flex-wrap gap-3">
        {SCOPE_TYPES.map((type: ScopeType) => (
          <label key={type} className="flex items-center gap-1 text-[13px]">
            <input type="radio" name="scopeType" checked={form.scopeType === type} onChange={() => setForm((f) => ({ ...f, scopeType: type, scopeIds: [] }))} />
            {t(`rules.scope.${type}`)}
          </label>
        ))}
      </div>
      <div className="max-h-48 overflow-y-auto rounded-md border border-line p-2" role="group" aria-label={t("rules.form.targets")}>
        {options.length === 0 && <p className="text-[12px] text-muted">{t("rules.form.noTargets")}</p>}
        {options.map((o) => (
          <label key={o.id} className="flex items-center gap-2 py-0.5 text-[13px]" style={{ paddingLeft: (o.indent ?? 0) * 14 }}>
            <input type="checkbox" checked={form.scopeIds.includes(o.id)} onChange={() => toggle(o.id)} />
            {o.label}
          </label>
        ))}
      </div>
      {form.scopeType === "SPACE" && <Checkbox label={t("rules.form.includeChildren")} checked={form.includeChildren} onChange={(e) => setForm((f) => ({ ...f, includeChildren: e.target.checked }))} />}
      <p className="text-[12.5px]" role="status" aria-label={t("rules.form.targetCountLabel")}>
        {t("rules.form.targetCount", { n: targetCount })} {savedCount !== null && <Badge tone="neutral">{t("rules.form.savedCount", { n: savedCount })}</Badge>}
        {targetCount === 0 && form.scopeIds.length > 0 && <span className="ml-2 text-fair-ink">{t("rules.form.noTargetWarn")}</span>}
      </p>
      {error && (
        <p role="alert" className="text-[12px] text-bad-ink">
          {error}
        </p>
      )}
    </fieldset>
  );
}
