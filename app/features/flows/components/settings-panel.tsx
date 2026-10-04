/**
 * 하단 [설정] 탭: 플로우 설명서(UI-FLW-22, FLW-11.06: 목적·책임자·관련 공간·설명)와 플로우 설정(UI-FLW-09, FLW-05.07·05.08·08.02~04).
 * - 설명서·태그·일시 정지 동작·DEGRADED 자동 정지·오류율 기준·catch 플로우는 바로 저장(API-FLW-10 PATCH, 온 키만)
 * - 실행 모드·변수 정의는 버전에 들어가므로 정의를 바꾸고 다음 [저장]·[적용] 때 반영(BR-FLW-14)
 * - 변수 현재 값은 [초기화]로 따로(API-FLW-21)
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, Checkbox, SelectField, Table, TextArea, TextField } from "~/components/ui";
import { errorText } from "~/lib/error-text";
import { flattenSpaces, type SpaceNode } from "~/lib/spaces";
import type { FlowApi } from "../api";
import { CONCURRENCY, DESCRIPTION_MAX, KEY_BY, PURPOSE_MAX, VARIABLE_LIMIT, VARIABLE_TYPES, checkSettings, initialText, modeOf, modeProblem, parseInitial, settingsFormOf, settingsPatch, toMode, variableProblems, variablesOf, type ModeForm, type SettingsForm, type VariableDef } from "../model/settings";
import type { FlowDetail, FlowVariable } from "../model/types";

export interface SettingsPanelProps {
  flowId: string;
  flow: FlowDetail["flow"] | undefined;
  extra: { mode?: Record<string, unknown>; variables?: unknown[] };
  spaces: SpaceNode[];
  me?: { userId: string; name: string };
  canWrite: boolean;
  api: Pick<FlowApi, "updateSettings" | "variables" | "resetVariable">;
  onExtraChange: (extra: { mode: Record<string, unknown>; variables: unknown[] }) => void;
  onSaved: () => void;
}

export function SettingsPanel(props: SettingsPanelProps) {
  const { t } = useTranslation();
  const { flowId, canWrite, api } = props;
  const readOnly = !canWrite;
  const [saved, setSaved] = useState<SettingsForm>(() => settingsFormOf(props.flow));
  const [form, setForm] = useState<SettingsForm>(saved);
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [values, setValues] = useState<FlowVariable[] | null>(null);
  const mode = modeOf(props.extra.mode);
  const vars = variablesOf(props.extra.variables);
  const problems = checkSettings(form, flowId);
  const varProblems = variableProblems(vars);
  const spaces = flattenSpaces(props.spaces);

  useEffect(() => {
    let cancelled = false;
    void api.variables(flowId).then((result) => {
      if (!cancelled) setValues(result.ok ? (result.data.responses ?? []) : []);
    });
    return () => {
      cancelled = true;
    };
  }, [api, flowId]);

  const set = <K extends keyof SettingsForm>(key: K, value: SettingsForm[K]) => setForm((f) => ({ ...f, [key]: value }));
  const patch = settingsPatch(saved, form);
  const changed = Object.keys(patch).length > 0;

  const save = async () => {
    if (Object.keys(problems).length > 0 || !changed) return;
    setBusy(true);
    const result = await api.updateSettings(flowId, patch);
    setBusy(false);
    if (!result.ok) {
      const field = result.errors?.[0]?.field;
      setNotice({ tone: "danger", text: field ? `${t(`flows.settings.field.${field}`, { defaultValue: field })}: ${result.errors![0].message || errorText(t, result)}` : (errorText(t, result) ?? "") });
      return;
    }
    setSaved(form);
    setNotice({ tone: "success", text: t("flows.settings.saved") });
    props.onSaved();
  };

  const setMode = (next: Partial<ModeForm>) => props.onExtraChange({ mode: toMode({ ...mode, ...next }), variables: vars });
  const setVars = (next: VariableDef[]) => props.onExtraChange({ mode: props.extra.mode ?? toMode(mode), variables: next });

  const reset = async (name: string) => {
    const result = await api.resetVariable(flowId, name);
    setNotice(result.ok ? { tone: "success", text: t("flows.settings.variableReset", { name }) } : { tone: "danger", text: errorText(t, result) ?? "" });
    if (result.ok) {
      const refreshed = await api.variables(flowId);
      if (refreshed.ok) setValues(refreshed.data.responses ?? []);
    }
  };

  const ruleText = (rule: string) => t(`flows.settings.rule.${rule}`, { purposeMax: PURPOSE_MAX, descriptionMax: DESCRIPTION_MAX, limit: VARIABLE_LIMIT });

  return (
    <div className="grid gap-4 text-[12.5px] lg:grid-cols-2">
      <section aria-label={t("flows.settings.docs")} className="flex flex-col gap-2">
        <p className="font-semibold">{t("flows.settings.docs")}</p>
        <TextField label={t("flows.settings.purpose")} value={form.purpose} maxLength={PURPOSE_MAX + 1} disabled={readOnly} error={problems.purpose ? ruleText("purpose") : undefined} onChange={(e) => set("purpose", e.target.value)} />
        <div className="flex items-end gap-2">
          <TextField label={t("flows.settings.owner")} value={form.ownerUserId ? (form.ownerUserId === props.me?.userId ? props.me.name : form.ownerUserId) : t("flows.settings.noOwner")} readOnly disabled />
          {!readOnly && props.me && form.ownerUserId !== props.me.userId && <Button onClick={() => set("ownerUserId", props.me!.userId)}>{t("flows.settings.assignMe")}</Button>}
        </div>
        <SelectField label={t("flows.settings.relatedSpaces")} multiple size={Math.min(6, Math.max(2, spaces.length))} value={form.relatedSpaceIds} disabled={readOnly} onChange={(e) => set("relatedSpaceIds", [...e.target.selectedOptions].map((o) => o.value))}>
          {spaces.map((s) => (
            <option key={s.id} value={s.id}>
              {" ".repeat(Math.max(0, s.depth - 1) * 2)}
              {s.node.name}
            </option>
          ))}
        </SelectField>
        <TextArea label={t("flows.settings.description")} rows={5} value={form.description} disabled={readOnly} error={problems.description ? ruleText("description") : undefined} onChange={(e) => set("description", e.target.value)} />
        <p className="text-[11.5px] text-muted">{t("flows.settings.count", { n: form.description.length, max: DESCRIPTION_MAX })}</p>
        <TextField label={t("flows.settings.tags")} hint={t("flows.field.commaHint")} value={form.tags} disabled={readOnly} onChange={(e) => set("tags", e.target.value)} />
        <p className="pt-2 font-semibold">{t("flows.settings.errorHandling")}</p>
        <TextField label={t("flows.settings.catchFlow")} value={form.catchFlowId} disabled={readOnly} error={problems.catchFlowId ? ruleText("catchSelf") : undefined} onChange={(e) => set("catchFlowId", e.target.value)} />
        <Checkbox label={t("flows.settings.autoPause")} checked={form.autoPauseOnDegraded} disabled={readOnly} onChange={(e) => set("autoPauseOnDegraded", e.target.checked)} />
        <TextField label={t("flows.settings.errorRate")} type="number" min={1} max={100} value={form.errorRatePercent} disabled={readOnly} error={problems.errorRatePercent ? ruleText("errorRate") : undefined} onChange={(e) => set("errorRatePercent", e.target.value)} />
        <div role="radiogroup" aria-label={t("flows.settings.pauseMode")} className="flex flex-col gap-1">
          <span className="text-muted">{t("flows.settings.pauseMode")}</span>
          {(["DROP", "BUFFER"] as const).map((m) => (
            <label key={m} className="flex items-center gap-1">
              <input type="radio" name="pause-mode" checked={form.pauseMode === m} disabled={readOnly} onChange={() => set("pauseMode", m)} />
              {t(`flows.settings.pause.${m}`)}
            </label>
          ))}
        </div>
        {!readOnly && (
          <div>
            <Button variant="primary" onClick={() => void save()} disabled={busy || !changed || Object.keys(problems).length > 0}>
              {busy ? t("common.processing") : t("flows.settings.save")}
            </Button>
          </div>
        )}
        {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      </section>
      <section aria-label={t("flows.settings.execution")} className="flex flex-col gap-2">
        <p className="font-semibold">{t("flows.settings.execution")}</p>
        <p className="text-[11.5px] text-muted">{t("flows.settings.versioned")}</p>
        <div role="radiogroup" aria-label={t("flows.settings.mode")} className="flex flex-wrap gap-3">
          {CONCURRENCY.map((c) => (
            <label key={c} className="flex items-center gap-1">
              <input type="radio" name="flow-mode" checked={mode.concurrency === c} disabled={readOnly} onChange={() => setMode({ concurrency: c })} />
              {t(`flows.settings.concurrency.${c}`)}
            </label>
          ))}
        </div>
        <SelectField label={t("flows.settings.keyBy")} value={mode.keyBy} disabled={readOnly} onChange={(e) => setMode({ keyBy: e.target.value as ModeForm["keyBy"] })}>
          {KEY_BY.map((k) => (
            <option key={k} value={k}>
              {t(`flows.settings.key.${k}`)}
            </option>
          ))}
        </SelectField>
        {mode.concurrency === "parallel" && <TextField label={t("flows.settings.max")} type="number" min={1} max={50} value={mode.max} disabled={readOnly} error={modeProblem(mode) ? ruleText("max") : undefined} onChange={(e) => setMode({ max: e.target.value })} />}
        <p className="pt-2 font-semibold">{t("flows.settings.variables")}</p>
        <Table>
          <thead>
            <tr>
              <th>{t("flows.settings.varName")}</th>
              <th>{t("flows.settings.varType")}</th>
              <th>{t("flows.settings.varInitial")}</th>
              <th>{t("flows.settings.varValue")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {vars.map((v, i) => {
              const problem = varProblems.find((p) => p.index === i);
              const current = values?.find((x) => x.name === v.name);
              const update = (patch: Partial<VariableDef>) => setVars(vars.map((x, j) => (j === i ? { ...x, ...patch } : x)));
              return (
                <tr key={i}>
                  <td>
                    <TextField label={<span className="sr-only">{t("flows.settings.varName")}</span>} value={v.name} disabled={readOnly} error={problem ? ruleText(`var.${problem.rule}`) : undefined} onChange={(e) => update({ name: e.target.value })} />
                  </td>
                  <td>
                    <SelectField label={<span className="sr-only">{t("flows.settings.varType")}</span>} value={v.type} disabled={readOnly} onChange={(e) => update({ type: e.target.value as VariableDef["type"] })}>
                      {VARIABLE_TYPES.map((ty) => (
                        <option key={ty} value={ty}>
                          {ty}
                        </option>
                      ))}
                    </SelectField>
                  </td>
                  <td>
                    <TextField label={<span className="sr-only">{t("flows.settings.varInitial")}</span>} defaultValue={initialText(v.initial)} disabled={readOnly} onChange={(e) => update({ initial: parseInitial(v.type, e.target.value) })} />
                  </td>
                  <td className="font-mono">{current ? initialText(current.value) : "–"}</td>
                  <td className="flex gap-1">
                    {!readOnly && current && <Button onClick={() => void reset(v.name)}>{t("flows.settings.resetValue")}</Button>}
                    {!readOnly && (
                      <Button variant="danger" onClick={() => setVars(vars.filter((_, j) => j !== i))}>
                        {t("flows.settings.removeVar")}
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
        {vars.length === 0 && <p className="text-muted">{t("flows.settings.noVariables")}</p>}
        {!readOnly && (
          <div>
            <Button onClick={() => setVars([...vars, { name: `var${vars.length + 1}`, type: "string", initial: "" }])} disabled={vars.length >= VARIABLE_LIMIT}>
              {t("flows.settings.addVar")}
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}
