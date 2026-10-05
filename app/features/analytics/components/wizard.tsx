/**
 * UI-ANA-03 분석 만들기 마법사(ANA-01.05·03.01~03.04·04.01·08.01). ① 템플릿 → ② 데이터 연결 → ③ 기간 → ④ 파라미터 → ⑤ 확인·실행.
 * - ② 역할마다 후보(API-ANA-19: 의미 조건·공간 권한으로 거른 기기×측정 항목·공간 집계·파생 항목)를 골라 연결한다
 * - ④ 파라미터 폼은 템플릿 JSON Schema로 만든다(number→슬라이더+입력, enum→선택, boolean→스위치)
 * - ⑤ 들어오면 충분성 확인(API-ANA-05). FAIL이면 [저장 후 실행]을 막고, WARN이면 "경고를 확인했습니다"를 체크해야 연다.
 *   해결 버튼(예: [1h로 바꾸기])은 ③ 값을 바꾸고 다시 확인한다
 * - 입력은 단계를 오가도 유지하고 sessionStorage 초안으로 새로고침을 견딘다(TC-ANA-079)
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router";
import { Alert, Badge, Button, ButtonLink, Card, Checkbox, Dialog, SelectField, TextField, cx } from "~/components/ui";
import { errorText } from "~/lib/error-text";
import { formatNumber } from "~/lib/format";
import type { AnalyticsApi } from "../api";
import {
  STEPS,
  addSource,
  analysisBody,
  checkBody,
  clearDraft,
  defaultParams,
  loadDraft,
  newDraft,
  removeSource,
  renameSource,
  saveDraft,
  schemaFields,
  validateBindings,
  validateConfirm,
  validateParams,
  validatePeriod,
  type FieldError,
  type Step,
  type WizardDraft,
} from "../model/wizard";
import { RESOLUTIONS, type Candidate, type CheckResult, type RoleSpec, type SourceKind, type TemplateDetail } from "../model/types";

const SOURCE_KINDS: SourceKind[] = ["DEVICE_METRIC", "SPACE_AGGREGATE", "DERIVED_METRIC"];

function useErrorMessage() {
  const { t } = useTranslation();
  return (e: FieldError | undefined) => (e ? t(`analytics.wizard.errors.${e.code}`, e.params ?? {}) : undefined);
}

function CandidateDialog({ open, onClose, template, role, api, onPick }: { open: boolean; onClose: () => void; template: TemplateDetail; role: RoleSpec; api: AnalyticsApi; onPick: (c: Candidate, agg?: "avg" | "max" | "min") => void }) {
  const { t } = useTranslation();
  const [kind, setKind] = useState<SourceKind>("DEVICE_METRIC");
  const [keyword, setKeyword] = useState("");
  const [agg, setAgg] = useState<"avg" | "max" | "min">("avg");
  const [items, setItems] = useState<Candidate[] | null>(null);
  const [error, setError] = useState<{ code: string; message?: string } | null>(null);
  useEffect(() => {
    if (!open) return;
    let live = true;
    setItems(null);
    const timer = setTimeout(() => {
      void api.candidates(template.key, role.name, { kind, keyword: keyword.trim() || undefined }).then((result) => {
        if (!live) return;
        if (result.ok) {
          setItems(result.data.responses);
          setError(null);
        } else setError({ code: result.code, message: result.message });
      });
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [open, kind, keyword, api, template.key, role.name]);
  return (
    <Dialog title={t("analytics.wizard.pickTitle", { role: role.name })} open={open} onClose={onClose}>
      <div className="flex gap-1 border-b border-line" role="tablist">
        {SOURCE_KINDS.map((k) => (
          <button key={k} type="button" role="tab" aria-selected={kind === k} onClick={() => setKind(k)} className={cx("-mb-px border-b-2 px-2 py-1.5 text-[12.5px]", kind === k ? "border-accent font-semibold text-accent" : "border-transparent text-muted")}>
            {t(`analytics.sourceKind.${k}`)}
          </button>
        ))}
      </div>
      {role.semantic && <p className="text-[12px] text-muted">{t("analytics.wizard.semanticOnly", { semantic: role.semantic })}</p>}
      <TextField label={t("common.search")} value={keyword} onChange={(e) => setKeyword(e.target.value)} />
      {kind === "SPACE_AGGREGATE" && (
        <SelectField label={t("analytics.wizard.agg")} value={agg} onChange={(e) => setAgg(e.target.value as "avg")}>
          {(["avg", "max", "min"] as const).map((a) => (
            <option key={a} value={a}>
              {t(`analytics.agg.${a}`)}
            </option>
          ))}
        </SelectField>
      )}
      {error && <Alert tone="danger">{errorText(t, error)}</Alert>}
      {items === null && !error && <p className="text-[12px] text-muted">{t("common.loading")}</p>}
      {items && items.length === 0 && <p className="text-[12.5px] text-muted">{t("analytics.wizard.noCandidates")}</p>}
      {items && items.length > 0 && (
        <ul className="flex max-h-72 flex-col overflow-auto rounded border border-line" aria-label={t("analytics.wizard.candidates")}>
          {items.map((c) => (
            <li key={`${c.kind}:${c.deviceId ?? ""}:${c.spaceId ?? ""}:${c.metricKey}`} className="border-b border-line last:border-b-0">
              <button type="button" className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[13px] hover:bg-bg" onClick={() => onPick(c, kind === "SPACE_AGGREGATE" ? agg : undefined)}>
                <span>{c.label}</span>
                <span className="text-[11.5px] text-muted">{[c.semantic, c.unit].filter(Boolean).join(" · ")}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

function StepBar({ step, onGo }: { step: Step; onGo: (s: Step) => void }) {
  const { t } = useTranslation();
  const index = STEPS.indexOf(step);
  return (
    <ol className="mb-4 flex flex-wrap gap-2 text-[12.5px]" aria-label={t("analytics.wizard.steps")}>
      {STEPS.map((s, i) => (
        <li key={s}>
          <button
            type="button"
            aria-current={s === step ? "step" : undefined}
            disabled={i > index}
            onClick={() => onGo(s)}
            className={cx("rounded-full border px-3 py-1", s === step ? "border-accent bg-accent-soft font-semibold text-accent" : i < index ? "border-line text-text" : "border-line text-muted")}
          >
            {`${i + 1}. ${t(`analytics.wizard.step.${s}`)}`}
          </button>
        </li>
      ))}
    </ol>
  );
}

function CheckCard({ check, onFix, checking, onRecheck }: { check: CheckResult | null; onFix: (value: string) => void; checking: boolean; onRecheck: () => void }) {
  const { t, i18n } = useTranslation();
  if (checking) return <p role="status" className="text-[13px] text-muted">{t("analytics.wizard.checking")}</p>;
  if (!check) return <Button onClick={onRecheck}>{t("analytics.wizard.recheck")}</Button>;
  const tone = check.level === "OK" ? "success" : check.level === "WARN" ? "warning" : "danger";
  const points = check.stats?.points ?? 0;
  const max = check.limits?.maxPoints ?? 0;
  const ratio = max > 0 ? Math.min(1, points / max) : 0;
  const dist = check.stats?.qualityDistribution ?? {};
  const distTotal = Object.values(dist).reduce((a, b) => a + (b ?? 0), 0);
  return (
    <Card title={t("analytics.wizard.sufficiency")} actions={<Badge tone={tone}>{t(`analytics.level.${check.level}`)}</Badge>}>
      <div className="flex flex-col gap-2 text-[13px]">
        <div>
          <p>{t("analytics.wizard.points", { points: formatNumber(points, i18n.language), max: formatNumber(max, i18n.language) })}</p>
          <div className="mt-1 h-2 w-full rounded bg-bg" role="meter" aria-valuemin={0} aria-valuemax={max} aria-valuenow={points} aria-label={t("analytics.wizard.limitBar")}>
            <div className={cx("h-2 rounded", ratio >= 1 ? "bg-bad" : "bg-accent")} style={{ width: `${Math.max(1, ratio * 100)}%` }} />
          </div>
        </div>
        <p>
          {t("analytics.wizard.missing", { rate: Math.round((check.stats?.missingRate ?? 0) * 1000) / 10 })}
          {" · "}
          {t("analytics.wizard.virtualPoints", { n: formatNumber(check.stats?.virtualPoints ?? 0, i18n.language) })}
          {check.stats?.effectiveResolution ? ` · ${t("analytics.wizard.effectiveResolution", { value: check.stats.effectiveResolution })}` : ""}
        </p>
        {distTotal > 0 && (
          <p className="text-[12px] text-muted">
            {t("analytics.wizard.quality")}{" "}
            {Object.entries(dist)
              .filter(([, v]) => (v ?? 0) > 0)
              .map(([code, v]) => `${t(`analytics.qualityCode.${code}`, { defaultValue: code })} ${Math.round(((v ?? 0) / distTotal) * 1000) / 10}%`)
              .join(" · ")}
          </p>
        )}
        {(check.issues ?? []).length > 0 && (
          <ul className="flex flex-col gap-1" aria-label={t("analytics.wizard.issues")}>
            {check.issues!.map((issue, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2">
                <Badge tone={issue.severity === "FAIL" || issue.severity === "ERROR" ? "danger" : "warning"}>{issue.code}</Badge>
                <span>{issue.message ?? t(`analytics.issue.${issue.code}`, { defaultValue: issue.code })}</span>
                {issue.fix?.type === "SET_RESOLUTION" && issue.fix.value && (
                  <Button onClick={() => onFix(issue.fix!.value!)}>{t("analytics.wizard.fixResolution", { value: issue.fix.value })}</Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

export interface WizardProps {
  template: TemplateDetail;
  api: AnalyticsApi;
  /** 기간 검증 기준 시각(테스트는 고정) */
  now?: () => number;
  storage?: Storage;
}

export function Wizard({ template, api, now = Date.now, storage }: WizardProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const message = useErrorMessage();
  const restored = useMemo(() => loadDraft(template.key, storage), [template.key, storage]);
  const [draft, setDraft] = useState<WizardDraft>(restored?.draft ?? newDraft(template));
  const [step, setStep] = useState<Step>(restored?.step ?? "template");
  const [picking, setPicking] = useState<RoleSpec | null>(null);
  const [check, setCheck] = useState<CheckResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<{ code: string; message?: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<{ code: string; message?: string; analysisId?: string } | null>(null);
  const [attempted, setAttempted] = useState(false);
  const roles = template.roles ?? [];

  useEffect(() => saveDraft(draft, step, storage), [draft, step, storage]);
  const update = (patch: Partial<WizardDraft>) => setDraft((d) => ({ ...d, ...patch }));

  const runCheck = useCallback(
    async (current: WizardDraft) => {
      setChecking(true);
      setCheckError(null);
      const result = await api.check(template.key, checkBody(current));
      setChecking(false);
      if (result.ok) setCheck(result.data);
      else {
        setCheck(null);
        setCheckError({ code: result.code, message: result.message });
      }
    },
    [api, template.key],
  );

  const errorsOf = (s: Step): FieldError[] => {
    if (s === "bindings") return validateBindings(roles, draft.bindings);
    if (s === "period") return validatePeriod(draft, template, now());
    if (s === "params") return validateParams(template.paramsSchema, draft.params);
    return [];
  };
  const stepErrors = errorsOf(step);
  const go = (s: Step) => {
    setStep(s);
    setAttempted(false);
    if (s === "confirm") void runCheck(draft);
  };
  const next = () => {
    if (stepErrors.length > 0) {
      setAttempted(true);
      return;
    }
    go(STEPS[STEPS.indexOf(step) + 1]);
  };

  const submit = async (run: boolean) => {
    setAttempted(true);
    if (validateConfirm(draft, check, run).length > 0) return;
    setSubmitting(true);
    setSubmitError(null);
    const created = await api.createAnalysis(analysisBody(draft));
    if (!created.ok) {
      setSubmitting(false);
      setSubmitError({ code: created.code, message: created.message });
      return;
    }
    const analysisId = created.data.analysisId ?? created.data.id ?? "";
    clearDraft(template.key, storage);
    if (!run) {
      navigate(`/analytics/${encodeURIComponent(analysisId)}?saved=1`);
      return;
    }
    const requested = await api.runAnalysis(analysisId, draft.ackWarnings);
    setSubmitting(false);
    if (!requested.ok) {
      setSubmitError({ code: requested.code, message: requested.message, analysisId });
      return;
    }
    const runId = requested.data.runId ?? requested.data.run?.runId;
    navigate(runId ? `/analytics/${encodeURIComponent(analysisId)}/runs/${encodeURIComponent(runId)}` : `/analytics/${encodeURIComponent(analysisId)}`);
  };

  const confirmErrors = validateConfirm(draft, check, true);
  const confirmErrorOf = (field: string) => (attempted ? message(confirmErrors.find((e) => e.field === field)) : undefined);
  const runBlocked = check?.level === "FAIL" || (check?.level === "WARN" && !draft.ackWarnings) || checking || !check;

  return (
    <div>
      <StepBar step={step} onGo={go} />
      {step === "template" && (
        <Card title={template.name} actions={<ButtonLink to="/analytics/templates">{t("analytics.wizard.otherTemplate")}</ButtonLink>}>
          <p className="text-[13px]">{template.guide?.summary ?? template.summary}</p>
          <p className="mt-2 text-[12px] text-muted">
            {`${template.key} v${template.version}`} · <Link to={`/analytics/templates/${encodeURIComponent(template.key)}`} className="text-accent hover:underline">{t("analytics.gallery.guide")}</Link>
          </p>
        </Card>
      )}

      {step === "bindings" && (
        <div className="flex flex-col gap-3">
          {roles.map((role) => {
            const binding = draft.bindings.find((b) => b.role === role.name);
            const error = stepErrors.find((e) => e.field === `bindings.${role.name}`);
            const range = `${role.min ?? (role.required ? 1 : 0)}~${role.max ?? 50}`;
            return (
              <Card
                key={role.name}
                title={
                  <span>
                    <span className="font-mono">{role.name}</span>{" "}
                    <span className="text-[12px] font-normal text-muted">{t("analytics.wizard.roleRange", { range })}</span>
                    {role.semantic && <span className="ml-2 text-[12px] font-normal text-muted">{t("analytics.wizard.semantic", { semantic: role.semantic })}</span>}
                  </span>
                }
                actions={<Button onClick={() => setPicking(role)}>{t("analytics.wizard.addData")}</Button>}
              >
                {role.description && <p className="mb-2 text-[12.5px] text-muted">{role.description}</p>}
                {(binding?.sources.length ?? 0) === 0 ? (
                  <p className="text-[12.5px] text-muted">{t("analytics.wizard.noSources")}</p>
                ) : (
                  <ul className="flex flex-wrap gap-2" aria-label={t("analytics.wizard.connected", { role: role.name })}>
                    {binding!.sources.map((s, i) => (
                      <li key={`${s.kind}:${s.deviceId ?? ""}:${s.spaceId ?? ""}:${s.metricKey}:${s.agg ?? ""}`} className="inline-flex items-center gap-1 rounded-full border border-line bg-bg px-2 py-0.5 text-[12.5px]">
                        <input
                          aria-label={t("analytics.wizard.sourceLabel")}
                          value={s.label}
                          onChange={(e) => update({ bindings: renameSource(draft.bindings, role.name, i, e.target.value) })}
                          className="w-40 bg-transparent outline-none"
                        />
                        {s.agg && <Badge tone="neutral">{t(`analytics.agg.${s.agg}`)}</Badge>}
                        <button type="button" aria-label={t("analytics.wizard.removeSource", { label: s.label })} className="text-muted hover:text-bad" onClick={() => update({ bindings: removeSource(draft.bindings, role.name, i) })}>
                          ×
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {error && (attempted || (binding?.sources.length ?? 0) > 0) && (
                  <p role="alert" className="mt-2 text-[12px] text-bad">
                    {message(error)}
                  </p>
                )}
              </Card>
            );
          })}
          {picking && (
            <CandidateDialog
              open
              onClose={() => setPicking(null)}
              template={template}
              role={picking}
              api={api}
              onPick={(c, agg) => {
                update({ bindings: addSource(draft.bindings, picking.name, { kind: c.kind, deviceId: c.deviceId ?? null, spaceId: c.spaceId ?? null, metricKey: c.metricKey, label: c.label, ...(agg ? { agg } : {}) }) });
                setPicking(null);
              }}
            />
          )}
        </div>
      )}

      {step === "period" && (
        <Card>
          <div className="grid gap-3 md:grid-cols-2">
            <fieldset className="flex flex-col gap-2">
              <legend className="text-[12.5px] font-medium text-muted">{t("analytics.wizard.periodType")}</legend>
              {(["RELATIVE", "FIXED"] as const).map((type) => (
                <label key={type} className="flex items-center gap-2 text-[13px]">
                  <input type="radio" name="periodType" checked={draft.periodType === type} onChange={() => update({ periodType: type })} />
                  {t(`analytics.wizard.period.${type}`)}
                </label>
              ))}
            </fieldset>
            {draft.periodType === "RELATIVE" ? (
              <TextField label={t("analytics.wizard.days")} type="number" min={1} value={String(draft.days)} onChange={(e) => update({ days: Number(e.target.value) })} error={message(stepErrors.find((e) => e.field === "days"))} />
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <TextField label={t("analytics.wizard.from")} type="datetime-local" value={draft.from} onChange={(e) => update({ from: e.target.value })} />
                <TextField label={t("analytics.wizard.to")} type="datetime-local" value={draft.to} onChange={(e) => update({ to: e.target.value })} error={message(stepErrors.find((e) => e.field === "to"))} />
              </div>
            )}
            <SelectField label={t("analytics.wizard.resolution")} value={draft.resolution} onChange={(e) => update({ resolution: e.target.value as WizardDraft["resolution"] })}>
              {RESOLUTIONS.map((r) => (
                <option key={r} value={r}>
                  {t(`analytics.resolution.${r}`)}
                </option>
              ))}
            </SelectField>
            <div className="flex flex-col gap-2 pt-5">
              <Checkbox label={t("analytics.wizard.normalOnly")} checked={draft.qualityFilter === "NORMAL_ONLY"} onChange={(e) => update({ qualityFilter: e.target.checked ? "NORMAL_ONLY" : "INCLUDE_ALL" })} />
              <Checkbox label={t("analytics.wizard.includeVirtual")} checked={draft.includeVirtual} onChange={(e) => update({ includeVirtual: e.target.checked })} />
            </div>
          </div>
        </Card>
      )}

      {step === "params" && (
        <Card actions={<Button onClick={() => update({ params: defaultParams(template.paramsSchema) })}>{t("analytics.wizard.defaults")}</Button>}>
          {schemaFields(template.paramsSchema).length === 0 && <p className="text-[13px] text-muted">{t("analytics.wizard.noParams")}</p>}
          <div className="grid gap-3 md:grid-cols-2">
            {schemaFields(template.paramsSchema).map((field) => {
              const value = draft.params[field.key];
              const label = field.prop.title ?? field.key;
              const err = message(stepErrors.find((e) => e.field === `params.${field.key}`));
              const set = (v: unknown) => update({ params: { ...draft.params, [field.key]: v } });
              if (field.control === "switch") return <Checkbox key={field.key} label={label} checked={Boolean(value)} onChange={(e) => set(e.target.checked)} title={field.prop.description} />;
              if (field.control === "select")
                return (
                  <SelectField key={field.key} label={label} value={value === undefined ? "" : String(value)} onChange={(e) => set(typeof field.prop.enum?.[0] === "number" ? Number(e.target.value) : e.target.value)} error={err} title={field.prop.description}>
                    {(field.prop.enum ?? []).map((o) => (
                      <option key={String(o)} value={String(o)}>
                        {String(o)}
                      </option>
                    ))}
                  </SelectField>
                );
              if (field.control === "slider")
                return (
                  <div key={field.key} className="flex flex-col gap-1">
                    <TextField label={label} type="number" value={value === undefined || value === null ? "" : String(value)} onChange={(e) => set(e.target.value === "" ? null : Number(e.target.value))} error={err} hint={field.prop.description} />
                    {field.prop.minimum !== undefined && field.prop.maximum !== undefined && (
                      <input
                        type="range"
                        aria-label={t("analytics.wizard.slider", { label })}
                        min={field.prop.minimum}
                        max={field.prop.maximum}
                        step={field.prop.multipleOf ?? (field.prop.type === "integer" ? 1 : (field.prop.maximum - field.prop.minimum) / 100)}
                        value={typeof value === "number" ? value : field.prop.minimum}
                        onChange={(e) => set(Number(e.target.value))}
                        className="accent-[var(--d2f-accent)]"
                      />
                    )}
                  </div>
                );
              return <TextField key={field.key} label={label} value={value === undefined || value === null ? "" : String(value)} onChange={(e) => set(e.target.value)} error={err} hint={field.prop.description} />;
            })}
          </div>
        </Card>
      )}

      {step === "confirm" && (
        <div className="flex flex-col gap-3">
          {checkError && <Alert tone="danger">{errorText(t, checkError)}</Alert>}
          <CheckCard
            check={check}
            checking={checking}
            onRecheck={() => void runCheck(draft)}
            onFix={(value) => {
              const nextDraft = { ...draft, resolution: value as WizardDraft["resolution"] };
              setDraft(nextDraft);
              void runCheck(nextDraft);
            }}
          />
          {check?.level === "FAIL" && <Alert tone="danger">{t("analytics.wizard.failBlocked")}</Alert>}
          {check?.level === "WARN" && <Checkbox label={t("analytics.wizard.ack")} checked={draft.ackWarnings} onChange={(e) => update({ ackWarnings: e.target.checked })} error={confirmErrorOf("ackWarnings")} />}
          <Card>
            <div className="grid gap-3 md:grid-cols-2">
              <TextField label={t("analytics.wizard.name")} value={draft.name} maxLength={100} onChange={(e) => update({ name: e.target.value })} error={confirmErrorOf("name")} />
              <fieldset className="flex flex-col gap-2">
                <legend className="text-[12.5px] font-medium text-muted">{t("analytics.wizard.runMode")}</legend>
                <div className="flex gap-4">
                  {(["NOW", "SCHEDULE"] as const).map((mode) => (
                    <label key={mode} className="flex items-center gap-2 text-[13px]">
                      <input type="radio" name="runMode" checked={draft.runMode === mode} onChange={() => update({ runMode: mode })} />
                      {t(`analytics.wizard.mode.${mode}`)}
                    </label>
                  ))}
                </div>
              </fieldset>
              {draft.runMode === "SCHEDULE" && (
                <>
                  <SelectField label={t("analytics.wizard.schedule")} value={draft.schedulePreset} onChange={(e) => update({ schedulePreset: e.target.value as WizardDraft["schedulePreset"] })} error={confirmErrorOf("schedule")}>
                    {(["DAILY", "WEEKLY", "CRON"] as const).map((p) => (
                      <option key={p} value={p}>
                        {t(`analytics.wizard.preset.${p}`)}
                      </option>
                    ))}
                  </SelectField>
                  {draft.schedulePreset === "CRON" ? (
                    <TextField label={t("analytics.wizard.cron")} value={draft.cron} placeholder="0 6 * * 1" onChange={(e) => update({ cron: e.target.value })} hint={t("analytics.wizard.cronHint")} />
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      <TextField label={t("analytics.wizard.at")} type="time" value={draft.scheduleAt} onChange={(e) => update({ scheduleAt: e.target.value })} />
                      {draft.schedulePreset === "WEEKLY" && (
                        <SelectField label={t("analytics.wizard.weekday")} value={String(draft.scheduleWeekday)} onChange={(e) => update({ scheduleWeekday: Number(e.target.value) })}>
                          {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                            <option key={d} value={d}>
                              {t(`analytics.weekday.${d}`)}
                            </option>
                          ))}
                        </SelectField>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </Card>
          {submitError && (
            <Alert tone="danger">
              {errorText(t, submitError)}
              {submitError.analysisId && (
                <>
                  {" "}
                  <Link className="underline" to={`/analytics/${encodeURIComponent(submitError.analysisId)}`}>
                    {t("analytics.wizard.openSaved")}
                  </Link>
                </>
              )}
            </Alert>
          )}
        </div>
      )}

      <div className="mt-4 flex flex-wrap justify-end gap-2">
        {step !== "template" && (
          <Button onClick={() => go(STEPS[STEPS.indexOf(step) - 1])} disabled={submitting}>
            {t("common.prev")}
          </Button>
        )}
        {step !== "confirm" ? (
          <Button variant="primary" onClick={next} disabled={attempted && stepErrors.length > 0 ? true : step === "params" && stepErrors.length > 0}>
            {t("common.next")}
          </Button>
        ) : (
          <>
            <Button onClick={() => void submit(false)} disabled={submitting}>
              {t("analytics.wizard.saveOnly")}
            </Button>
            <Button variant="primary" onClick={() => void submit(true)} disabled={submitting || runBlocked}>
              {submitting ? t("common.processing") : t("analytics.wizard.saveAndRun")}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
