/**
 * UI-ACT-08 조직 제어 한계·보호 설정(`/settings/control`, ACT-06.04·06.01·02.05, API-ACT-17). 권한 CONTROL_SETTINGS(ADMIN).
 * 기능별 절대 한계 표(표준 범위 참고), 수동 우선 시간, 명령 최소 간격, 진동 감지, 명령 기본 유효 시간, 제어 노드 배포 승인(FLW-05.06).
 * 한계는 모델 제약보다 좁게만 둘 수 있다(BR-ACT-09) — 넓으면 서버가 LIMIT_WIDER_THAN_MODEL로 거절하고 그 줄에 표시한다.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, Card, Checkbox, EmptyState, SelectField, Table, TextField } from "~/components/ui";
import { bffJson, type BffJsonResult } from "~/lib/bff-client";
import { errorText } from "~/lib/error-text";
import { formatDateTime } from "~/lib/format";
import { settingsBody, settingsProblems, settingsToForm, type ControlSettings, type ControlSettingsForm, type LimitTarget } from "./model/settings";

export interface ControlSettingsApi {
  save(body: ReturnType<typeof settingsBody>): Promise<BffJsonResult<ControlSettings>>;
}

export const controlSettingsApi: ControlSettingsApi = {
  save: (body) => bffJson("/bff/api/core/settings/control", { method: "PUT", body }),
};

export interface ControlSettingsEditorProps {
  initial: ControlSettings;
  targets: LimitTarget[];
  timezone: string;
  lang: string;
  api?: ControlSettingsApi;
}

export function ControlSettingsEditor({ initial, targets, timezone, lang, api = controlSettingsApi }: ControlSettingsEditorProps) {
  const { t } = useTranslation();
  const [saved, setSaved] = useState(initial);
  const [form, setForm] = useState<ControlSettingsForm>(() => settingsToForm(initial));
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [serverFields, setServerFields] = useState<string[]>([]);
  const problems = settingsProblems(form, targets);
  const has = (key: string) => submitted && problems.includes(key);
  const set = (patch: Partial<ControlSettingsForm>) => setForm((f) => ({ ...f, ...patch }));
  const setRow = (i: number, patch: Partial<ControlSettingsForm["limits"][number]>) => setForm((f) => ({ ...f, limits: f.limits.map((r, j) => (j === i ? { ...r, ...patch } : r)) }));
  const attrOf = (capability: string, attribute: string) => targets.find((x) => x.capability === capability)?.attributes.find((a) => a.name === attribute);

  const addRow = () => {
    const first = targets[0];
    set({ limits: [...form.limits, { capability: first?.capability ?? "", attribute: first?.attributes[0]?.name ?? "", min: "", max: "" }] });
  };

  const rowError = (i: number) => {
    const row = form.limits[i];
    if (serverFields.includes(`absoluteLimits.${row.capability}.${row.attribute}`)) return t("control.settings.limits.widerThanModel");
    if (!submitted) return undefined;
    for (const kind of ["target", "duplicate", "range", "min", "max", "standard"]) {
      if (problems.includes(`limits.${i}.${kind}`)) return t(`control.settings.limits.problems.${kind}`);
    }
    return undefined;
  };

  const save = async () => {
    setSubmitted(true);
    setNotice(null);
    setServerFields([]);
    if (problems.length > 0) return;
    setBusy(true);
    const result = await api.save(settingsBody(form, saved.version));
    setBusy(false);
    if (!result.ok) {
      setServerFields((result.errors ?? []).map((e) => e.field));
      setNotice({ tone: "danger", text: errorText(t, result) ?? "" });
      return;
    }
    setSaved(result.data);
    setForm(settingsToForm(result.data));
    setSubmitted(false);
    setNotice({ tone: "success", text: t("control.settings.saved") });
  };

  const intField = (key: "manualOverrideMinutes" | "minIntervalSec" | "oscillationWindowSec" | "oscillationFlips" | "defaultValiditySec", hint?: string) => (
    <TextField
      label={t(`control.settings.fields.${key}`)}
      inputMode="numeric"
      value={form[key]}
      onChange={(e) => set({ [key]: e.target.value } as Partial<ControlSettingsForm>)}
      hint={hint ?? t(`control.settings.hints.${key}`)}
      error={has(key) ? t(`control.settings.problems.${key}`) : undefined}
    />
  );

  return (
    <div className="flex flex-col gap-4">
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      <Card
        title={t("control.settings.limits.title")}
        actions={
          <Button onClick={addRow} disabled={targets.length === 0}>
            {t("control.settings.limits.add")}
          </Button>
        }
      >
        <p className="mb-3 text-[12.5px] text-muted">{t("control.settings.limits.help")}</p>
        {form.limits.length === 0 ? (
          <EmptyState title={t("control.settings.limits.empty")} />
        ) : (
          <Table>
            <thead>
              <tr>
                <th>{t("control.settings.limits.capability")}</th>
                <th>{t("control.settings.limits.attribute")}</th>
                <th>{t("control.settings.limits.min")}</th>
                <th>{t("control.settings.limits.max")}</th>
                <th>{t("control.settings.limits.standard")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {form.limits.map((row, i) => {
                const attr = attrOf(row.capability, row.attribute);
                const error = rowError(i);
                const n = i + 1;
                return (
                  <tr key={i}>
                    <td>
                      <SelectField
                        label={<span className="sr-only">{t("control.settings.limits.capabilityOf", { n })}</span>}
                        value={row.capability}
                        onChange={(e) => setRow(i, { capability: e.target.value, attribute: targets.find((x) => x.capability === e.target.value)?.attributes[0]?.name ?? "" })}
                      >
                        {!targets.some((x) => x.capability === row.capability) && <option value={row.capability}>{row.capability}</option>}
                        {targets.map((x) => (
                          <option key={x.capability} value={x.capability}>
                            {x.capability}
                          </option>
                        ))}
                      </SelectField>
                    </td>
                    <td>
                      <SelectField label={<span className="sr-only">{t("control.settings.limits.attributeOf", { n })}</span>} value={row.attribute} onChange={(e) => setRow(i, { attribute: e.target.value })}>
                        {!attr && <option value={row.attribute}>{row.attribute}</option>}
                        {(targets.find((x) => x.capability === row.capability)?.attributes ?? []).map((a) => (
                          <option key={a.name} value={a.name}>
                            {a.name}
                          </option>
                        ))}
                      </SelectField>
                    </td>
                    <td>
                      <TextField label={<span className="sr-only">{t("control.settings.limits.minOf", { n })}</span>} inputMode="decimal" value={row.min} onChange={(e) => setRow(i, { min: e.target.value })} />
                    </td>
                    <td>
                      <TextField label={<span className="sr-only">{t("control.settings.limits.maxOf", { n })}</span>} inputMode="decimal" value={row.max} onChange={(e) => setRow(i, { max: e.target.value })} />
                    </td>
                    <td className="font-mono text-[12px] text-muted">
                      {attr ? `${attr.min ?? "–"} ~ ${attr.max ?? "–"}${attr.unit ? ` ${attr.unit}` : ""}` : "–"}
                      {error && (
                        <p role="alert" className="font-sans text-[11.5px] text-bad-ink">
                          {error}
                        </p>
                      )}
                    </td>
                    <td>
                      <Button variant="ghost" aria-label={t("control.settings.limits.removeOf", { n })} onClick={() => set({ limits: form.limits.filter((_, j) => j !== i) })}>
                        {t("common.delete")}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>

      <Card title={t("control.settings.protection.title")}>
        <div className="grid gap-3 sm:grid-cols-2">
          {intField("manualOverrideMinutes")}
          {intField("minIntervalSec")}
          {intField("oscillationWindowSec")}
          {intField("oscillationFlips")}
          {intField("defaultValiditySec")}
        </div>
        <div className="mt-3 flex flex-col gap-2">
          <Checkbox label={t("control.settings.fields.scheduleRespectsManualOverride")} checked={form.scheduleRespectsManualOverride} onChange={(e) => set({ scheduleRespectsManualOverride: e.target.checked })} />
          <Checkbox label={t("control.settings.fields.requireApprovalForControlNodes")} checked={form.requireApprovalForControlNodes} onChange={(e) => set({ requireApprovalForControlNodes: e.target.checked })} />
        </div>
      </Card>

      <div className="flex items-center justify-between gap-2">
        <p className="text-[12px] text-muted">
          {saved.updatedAt ? t("control.settings.updated", { at: formatDateTime(saved.updatedAt, timezone, lang), name: saved.updatedBy?.name ?? "–" }) : t("control.settings.defaults")}
        </p>
        <Button variant="primary" onClick={() => void save()} disabled={busy}>
          {t("common.save")}
        </Button>
      </div>
    </div>
  );
}
