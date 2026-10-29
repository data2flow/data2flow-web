/**
 * UI-CMP-03 기준 프로필 편집(CMP-01.01, TC-CMP-007). 상태는 화면에 두고 [저장] 때 JSON 한 덩어리(payload)로 보낸다.
 * 고친 칸의 오류는 바로 보여 주고, 오류가 하나라도 있으면 [저장]을 막는다. 서버 오류(serverErrors)는 늘 보여 준다.
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Form } from "react-router";
import { Alert, Button, ButtonLink, Card, Checkbox, CsrfField, SelectField, TextArea, TextField } from "~/components/ui";
import { MAX_BANDS, checkDraft, emptyMetric, type MetricDraft, type ProfileDraft } from "../model/profile-form";
import { EVAL_WINDOWS, REQUIREMENTS } from "../model/types";

export interface MetricOption {
  key: string;
  displayName?: string;
  unit?: string | null;
}

export type EditorMode = "create" | "version" | "update";

export function ProfileEditor({
  mode,
  initial,
  metrics,
  serverErrors = {},
  error,
  cancelTo,
  baseVersion,
  versionNo,
  idempotencyKey,
}: {
  mode: EditorMode;
  initial: ProfileDraft;
  metrics: MetricOption[];
  serverErrors?: Record<string, string>;
  error?: string;
  cancelTo: string;
  baseVersion?: number;
  versionNo?: number;
  idempotencyKey?: string;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<ProfileDraft>(initial);
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const errors = useMemo(() => checkDraft(draft, mode), [draft, mode]);
  const errorCount = Object.keys(errors).length;
  const touch = (key: string) => setTouched((s) => (s.has(key) ? s : new Set(s).add(key)));
  const msg = (key: string) => {
    const server = serverErrors[key];
    if (server) return t(`compliance.validation.${server}`, { defaultValue: t("compliance.validation.threshold") });
    return touched.has(key) && errors[key] ? t(`compliance.validation.${errors[key]}`) : undefined;
  };
  const set = (patch: Partial<ProfileDraft>, key: string) => {
    setDraft((d) => ({ ...d, ...patch }));
    touch(key);
  };
  const setMetric = (i: number, patch: Partial<MetricDraft>, key: string) => {
    setDraft((d) => ({ ...d, metrics: d.metrics.map((m, j) => (j === i ? { ...m, ...patch } : m)) }));
    touch(`metrics.${i}.${key}`);
    // 하한·상한은 서로 엮여 있어 한쪽을 고치면 다른 쪽 오류도 보여 준다
    if (key === "lower" || key === "upper") {
      touch(`metrics.${i}.lower`);
      touch(`metrics.${i}.upper`);
    }
  };
  const submitLabel = mode === "version" ? t("compliance.editor.saveVersion") : t("common.save");
  return (
    <Form method="post" className="flex flex-col gap-4" aria-label={t("compliance.editor.title")}>
      <CsrfField />
      <input type="hidden" name="payload" value={JSON.stringify(draft)} />
      <input type="hidden" name="mode" value={mode} />
      {baseVersion !== undefined && <input type="hidden" name="baseVersion" value={baseVersion} />}
      {versionNo !== undefined && <input type="hidden" name="versionNo" value={versionNo} />}
      {idempotencyKey && <input type="hidden" name="idempotencyKey" value={idempotencyKey} />}
      {error && <Alert tone="danger">{error}</Alert>}
      <Card title={t("compliance.editor.basics")}>
        <div className="grid gap-3 sm:grid-cols-2">
          {mode === "create" && <TextField label={t("compliance.editor.name")} value={draft.name} maxLength={100} onChange={(e) => set({ name: e.target.value }, "name")} error={msg("name")} />}
          <TextField label={t("compliance.editor.sourceTitle")} value={draft.sourceTitle} maxLength={200} onChange={(e) => set({ sourceTitle: e.target.value }, "sourceTitle")} error={msg("sourceTitle")} />
          <TextField label={t("compliance.editor.sourceUrl")} value={draft.sourceUrl} placeholder="https://" onChange={(e) => set({ sourceUrl: e.target.value }, "sourceUrl")} error={msg("sourceUrl")} />
          <TextField label={t("compliance.editor.effectiveDate")} type="date" value={draft.effectiveDate} onChange={(e) => set({ effectiveDate: e.target.value }, "effectiveDate")} error={msg("effectiveDate")} />
          <TextField label={t("compliance.editor.streakDays")} inputMode="numeric" value={draft.streakDays} onChange={(e) => set({ streakDays: e.target.value }, "streakDays")} error={msg("streakDays")} hint={t("compliance.editor.streakHint")} />
          <TextField label={t("compliance.editor.streakRatio")} inputMode="decimal" value={draft.streakRatio} onChange={(e) => set({ streakRatio: e.target.value }, "streakRatio")} error={msg("streakRatio")} />
        </div>
        <div className="mt-3">
          <TextArea label={t("compliance.editor.description")} rows={2} value={draft.description} onChange={(e) => set({ description: e.target.value }, "description")} />
        </div>
      </Card>
      <Card title={t("compliance.editor.metrics")} actions={<Button onClick={() => setDraft((d) => ({ ...d, metrics: [...d.metrics, emptyMetric()] }))}>{t("compliance.editor.addMetric")}</Button>}>
        {msg("metrics") && <Alert tone="danger">{msg("metrics")}</Alert>}
        <ol className="flex flex-col gap-3">
          {draft.metrics.map((m, i) => (
            <MetricRow
              key={i}
              index={i}
              metric={m}
              metrics={metrics}
              msg={msg}
              onChange={(patch, key) => setMetric(i, patch, key)}
              onRemove={draft.metrics.length > 1 ? () => setDraft((d) => ({ ...d, metrics: d.metrics.filter((_, j) => j !== i) })) : undefined}
            />
          ))}
        </ol>
      </Card>
      <div className="flex flex-wrap items-end justify-end gap-3">
        {mode !== "create" && (
          <div className="min-w-[280px] flex-1">
            <TextField label={t("compliance.editor.changeNote")} value={draft.changeNote} maxLength={500} onChange={(e) => set({ changeNote: e.target.value }, "changeNote")} error={msg("changeNote")} />
          </div>
        )}
        {errorCount > 0 && (
          <p className="text-[12px] text-muted" role="status">
            {t("compliance.editor.fixFirst", { n: errorCount })}
          </p>
        )}
        <ButtonLink to={cancelTo}>{t("common.cancel")}</ButtonLink>
        <Button type="submit" variant="primary" disabled={errorCount > 0}>
          {submitLabel}
        </Button>
      </div>
    </Form>
  );
}

function MetricRow({
  index,
  metric,
  metrics,
  msg,
  onChange,
  onRemove,
}: {
  index: number;
  metric: MetricDraft;
  metrics: MetricOption[];
  msg: (key: string) => string | undefined;
  onChange: (patch: Partial<MetricDraft>, key: string) => void;
  onRemove?: () => void;
}) {
  const { t } = useTranslation();
  const at = `metrics.${index}`;
  const continuous = metric.requirement === "CONTINUOUS_MONITORING_ONLY";
  const known = metrics.some((o) => o.key === metric.metricKey);
  return (
    <li className="rounded-md border border-line p-3" data-metric-row={index}>
      <div className="grid gap-3 sm:grid-cols-4">
        <SelectField
          label={t("compliance.criteria.metric")}
          value={metric.metricKey}
          onChange={(e) => {
            const option = metrics.find((o) => o.key === e.target.value);
            onChange({ metricKey: e.target.value, unit: metric.unit || option?.unit || "" }, "metricKey");
          }}
          error={msg(`${at}.metricKey`)}
        >
          <option value="">{t("compliance.editor.chooseMetric")}</option>
          {!known && metric.metricKey && <option value={metric.metricKey}>{metric.metricKey}</option>}
          {metrics.map((o) => (
            <option key={o.key} value={o.key}>
              {o.displayName ? `${o.displayName} (${o.key})` : o.key}
            </option>
          ))}
        </SelectField>
        <SelectField label={t("compliance.criteria.requirement")} value={metric.requirement} onChange={(e) => onChange({ requirement: e.target.value }, "requirement")}>
          {REQUIREMENTS.map((r) => (
            <option key={r} value={r}>
              {t(`compliance.requirement.${r}`)}
            </option>
          ))}
        </SelectField>
        <SelectField label={t("compliance.criteria.evalWindow")} value={metric.evalWindow} onChange={(e) => onChange({ evalWindow: e.target.value }, "evalWindow")} error={msg(`${at}.evalWindow`)}>
          {EVAL_WINDOWS.map((w) => (
            <option key={w} value={w}>
              {t(`compliance.window.${w}`)}
            </option>
          ))}
        </SelectField>
        <TextField label={t("compliance.criteria.unit")} value={metric.unit} maxLength={16} onChange={(e) => onChange({ unit: e.target.value }, "unit")} error={msg(`${at}.unit`)} />
      </div>
      {!continuous && (
        <div className="mt-3 grid gap-3 sm:grid-cols-4">
          <TextField label={t("compliance.criteria.lower")} inputMode="decimal" value={metric.lower} onChange={(e) => onChange({ lower: e.target.value }, "lower")} error={msg(`${at}.lower`)} />
          <TextField label={t("compliance.criteria.upper")} inputMode="decimal" value={metric.upper} onChange={(e) => onChange({ upper: e.target.value }, "upper")} error={msg(`${at}.upper`)} />
          <TextField label={t("compliance.editor.baseName")} value={metric.baseName} maxLength={30} placeholder={t("compliance.editor.baseNamePlaceholder")} onChange={(e) => onChange({ baseName: e.target.value }, "baseName")} />
          <div className="flex items-end pb-2">
            <Checkbox label={t("compliance.editor.inclusive")} checked={metric.inclusive} onChange={(e) => onChange({ inclusive: e.target.checked }, "inclusive")} />
          </div>
        </div>
      )}
      {!continuous && (
        <div className="mt-3 flex flex-col gap-2">
          <p className="text-[12.5px] font-medium">{t("compliance.criteria.bands")}</p>
          {metric.bands.map((b, j) => (
            <div key={j} className="grid items-end gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]" data-band={j}>
              <TextField label={t("compliance.editor.bandName")} value={b.name} maxLength={30} onChange={(e) => onChange({ bands: metric.bands.map((x, k) => (k === j ? { ...x, name: e.target.value } : x)) }, `bands.${j}.name`)} error={msg(`${at}.bands.${j}.name`)} />
              <TextField label={t("compliance.criteria.lower")} inputMode="decimal" value={b.lower} onChange={(e) => onChange({ bands: metric.bands.map((x, k) => (k === j ? { ...x, lower: e.target.value } : x)) }, `bands.${j}.upper`)} />
              <TextField label={t("compliance.criteria.upper")} inputMode="decimal" value={b.upper} onChange={(e) => onChange({ bands: metric.bands.map((x, k) => (k === j ? { ...x, upper: e.target.value } : x)) }, `bands.${j}.upper`)} error={msg(`${at}.bands.${j}.upper`)} />
              <Button onClick={() => onChange({ bands: metric.bands.filter((_, k) => k !== j) }, "bands")}>{t("compliance.editor.removeBand")}</Button>
            </div>
          ))}
          {msg(`${at}.bands`) && <p className="text-[11.5px] text-bad-ink">{msg(`${at}.bands`)}</p>}
          {metric.bands.length + 1 < MAX_BANDS && (
            <div>
              <Button onClick={() => onChange({ bands: [...metric.bands, { name: "", lower: "", upper: "" }] }, "bands")}>{t("compliance.editor.addBand")}</Button>
            </div>
          )}
        </div>
      )}
      <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
        <TextField label={t("compliance.criteria.facilityType")} value={metric.facilityType} maxLength={64} placeholder={t("compliance.editor.facilityPlaceholder")} onChange={(e) => onChange({ facilityType: e.target.value.toUpperCase() }, "facilityType")} />
        <TextField label={t("compliance.criteria.note")} value={metric.note} maxLength={300} onChange={(e) => onChange({ note: e.target.value }, "note")} />
        {onRemove && (
          <div className="flex items-end">
            <Button onClick={onRemove}>{t("compliance.editor.removeMetric")}</Button>
          </div>
        )}
      </div>
    </li>
  );
}
