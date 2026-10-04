/**
 * 대시보드 편집(UI-DSH-04 편집 구성, UI-DSH-05): 왼쪽 위젯 라이브러리, 가운데 격자(끌어 놓기·크기 조정·복제·삭제),
 * 오른쪽 위젯 설정 패널(제목·대상·옵션 스키마 폼), 상단 [대시보드 설정] [취소] [저장].
 * 저장 전 검사는 core와 같은 규칙(DSH-04.01 "위젯 스키마 검증 양쪽"), 저장은 baseVersion(409면 충돌 모달, AT-DSH-04.6).
 * 미리 보기 데이터는 API-DSH-09 `POST /widgets/preview`(저장 전 정의로 조회).
 */
import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ChartFactory } from "~/components/charts/timeseries-chart";
import { Alert, Button, Card, Checkbox, Dialog, SelectField, TextArea, TextField } from "~/components/ui";
import { dashboardsApi, type SaveResult } from "../api";
import { MAX_WIDGETS, addWidget, updateWidget } from "../model/layout";
import { RANGE_PRESETS, RESOLUTIONS, REFRESHES, isRelative } from "../model/time";
import { hasErrors, saveBody, validateDraft, type ConflictInfo, type Draft, type DraftErrors } from "../model/transfer";
import { VARIABLE_TYPES, refOf, resolveValues, type VariableOption } from "../model/variables";
import { MAX_TARGETS, WIDGET_ICON, idFieldOf, isMetricKind, newWidget } from "../model/widgets";
import type { Dashboard, DashboardVariable, OptionRule, Widget, WidgetDataRequest, WidgetTarget, WidgetTypeInfo } from "../model/types";
import { DashboardGrid } from "./dashboard-grid";
import { useDashboardData, type WidgetFetcher } from "./use-dashboard-data";

export interface EditorProps {
  dashboard: Dashboard;
  draft: Draft;
  types: WidgetTypeInfo[];
  timezone: string;
  /** 대상 입력 도움 목록(종류별 공간·기기·측정 항목) */
  targetOptions?: Partial<Record<"SPACE" | "DEVICE" | "METRIC", VariableOption[]>>;
  onSaved: (dashboard: Dashboard) => void;
  onCancel: () => void;
  onReload: () => void;
  /** 테스트에서 저장·미리 보기를 바꾼다 */
  save?: (id: string, body: Record<string, unknown>) => Promise<SaveResult>;
  preview?: WidgetFetcher;
  chartFactory?: ChartFactory;
}

export function DashboardEditor({ dashboard, types, timezone, targetOptions, onSaved, onCancel, onReload, chartFactory, ...props }: EditorProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<Draft>(props.draft);
  const [baseVersion, setBaseVersion] = useState(dashboard.version);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [errors, setErrors] = useState<DraftErrors | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<ConflictInfo | null>(null);
  const [saving, setSaving] = useState(false);
  const widgets = draft.layout.widgets;
  const selected = widgets.find((w) => w.id === selectedId) ?? null;
  const values = useMemo(() => resolveValues(draft.variables, {}), [draft.variables]);

  const draftRef = useRef(draft);
  draftRef.current = draft;
  const previewFetcher: WidgetFetcher = useCallback(
    (widgetId: string, req: WidgetDataRequest, signal: AbortSignal) => {
      const widget = draftRef.current.layout.widgets.find((w) => w.id === widgetId);
      if (props.preview) return props.preview(widgetId, req, signal);
      return dashboardsApi.preview({ widget, variableDefinitions: draftRef.current.variables, timeRange: req.timeRange, resolution: req.resolution, variables: req.variables }, signal);
    },
    [props],
  );
  const { states } = useDashboardData({ widgets, timeRange: draft.timeRange, resolution: draft.resolution, values, fetcher: previewFetcher });

  const setWidgets = (next: Widget[]) => setDraft((d) => ({ ...d, layout: { widgets: next } }));
  const add = (info: WidgetTypeInfo) => {
    const firstOf = (type: string) => draft.variables.find((v) => v.type === type);
    const space = firstOf("SPACE");
    const device = firstOf("DEVICE");
    const metric = firstOf("METRIC");
    const next = addWidget(widgets, newWidget(info, t(`dashboards.types.${info.type}`, { defaultValue: info.label }), { space: space && refOf(space.name), device: device && refOf(device.name), metric: metric && refOf(metric.name) }));
    if (!next) {
      setServerError(t("dashboards.errors.tooMany"));
      return;
    }
    setWidgets(next);
    setSelectedId(next[next.length - 1].id);
  };

  const submit = async (base = baseVersion) => {
    const found = validateDraft(draft, types);
    setErrors(found);
    setServerError(null);
    if (hasErrors(found)) return;
    setSaving(true);
    const result = await (props.save ?? dashboardsApi.save)(dashboard.id, saveBody(draft, base));
    setSaving(false);
    if (result.ok) {
      onSaved(result.dashboard);
      return;
    }
    if (result.status === 409) {
      setConflict(result.conflict ?? { version: base });
      return;
    }
    setServerError(result.message || t(`dashboards.errors.${result.code}`, { defaultValue: result.code }));
  };

  const widgetErrors = (id: string) => errors?.widgets.find((w) => w.id === id)?.errors ?? [];
  const typeOf = (type: string) => types.find((x) => x.type === type);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="w-72">
          <TextField label={t("dashboards.fields.name")} value={draft.name} maxLength={100} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} error={errors?.name ? t("dashboards.errors.nameRequired") : undefined} />
        </div>
        <div className="ml-auto flex gap-2">
          <Button onClick={() => setSettingsOpen(true)}>{t("dashboards.edit.settings")}</Button>
          <Button onClick={onCancel}>{t("dashboards.edit.cancel")}</Button>
          <Button variant="primary" disabled={saving} onClick={() => void submit()}>
            {t("dashboards.edit.save")}
          </Button>
        </div>
      </div>
      {serverError && <Alert tone="danger">{serverError}</Alert>}
      {errors && hasErrors(errors) && (
        <Alert tone="danger">
          <ul className="list-inside list-disc">
            {errors.layout.map((e, i) => (
              <li key={`l${i}`}>{e.code === "TOO_MANY_WIDGETS" ? t("dashboards.errors.tooMany") : t(`dashboards.errors.layout.${e.code}`, { n: e.index + 1 })}</li>
            ))}
            {errors.variables.map((e, i) => (
              <li key={`v${i}`}>{t("dashboards.errors.variableName")}</li>
            ))}
            {errors.widgets.map((w) =>
              w.errors.map((e, i) => (
                <li key={`${w.id}${i}`}>
                  {widgets.find((x) => x.id === w.id)?.title || w.id}: {e.code === "TARGET_COUNT" ? t("dashboards.errors.targetCount", { min: e.min, max: e.max }) : t(`dashboards.errors.widget.${e.code}`, { field: e.field })}
                </li>
              )),
            )}
          </ul>
        </Alert>
      )}
      <div className="grid gap-3 lg:grid-cols-[180px_minmax(0,1fr)_260px]">
        <Card title={t("dashboards.edit.library")}>
          <ul className="flex flex-col gap-1">
            {types.map((info) => (
              <li key={info.type}>
                <Button className="w-full justify-start" disabled={widgets.length >= MAX_WIDGETS} onClick={() => add(info)} aria-label={t("dashboards.edit.add", { type: t(`dashboards.types.${info.type}`, { defaultValue: info.label }) })}>
                  <span aria-hidden>{WIDGET_ICON[info.type] ?? "▢"}</span> {t(`dashboards.types.${info.type}`, { defaultValue: info.label })}
                </Button>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[12px] text-muted">{t("dashboards.edit.count", { n: widgets.length, max: MAX_WIDGETS })}</p>
          <p className="mt-2 text-[12px] text-muted">{t("dashboards.edit.keyboardHint")}</p>
        </Card>
        <DashboardGrid widgets={widgets} states={states} timezone={timezone} editing onChange={setWidgets} selectedId={selectedId} onSelect={setSelectedId} chartFactory={chartFactory} dashboardName={draft.name} />
        <Card title={t("dashboards.edit.widgetSettings")}>
          {selected ? (
            <WidgetSettings
              key={selected.id}
              widget={selected}
              info={typeOf(selected.type)}
              variables={draft.variables}
              targetOptions={targetOptions}
              errors={widgetErrors(selected.id).map((e) => e.field)}
              onChange={(patch) => setWidgets(updateWidget(widgets, selected.id, patch))}
            />
          ) : (
            <p className="text-[13px] text-muted">{t("dashboards.edit.selectWidget")}</p>
          )}
        </Card>
      </div>
      <SettingsDialog open={settingsOpen} draft={draft} onClose={() => setSettingsOpen(false)} onApply={(patch) => setDraft((d) => ({ ...d, ...patch }))} />
      <Dialog
        open={conflict !== null}
        onClose={() => setConflict(null)}
        title={t("dashboards.conflict.title")}
        footer={
          <>
            <Button onClick={onReload}>{t("dashboards.conflict.reload")}</Button>
            <Button
              variant="primary"
              onClick={() => {
                const next = conflict?.version ?? baseVersion;
                setBaseVersion(next);
                setConflict(null);
                void submit(next);
              }}
            >
              {t("dashboards.conflict.keepMine")}
            </Button>
          </>
        }
      >
        <p className="text-[13px]">{t("dashboards.conflict.body", { name: conflict?.updatedByName ?? "–" })}</p>
      </Dialog>
    </div>
  );
}

function WidgetSettings({ widget, info, variables, targetOptions, errors, onChange }: { widget: Widget; info?: WidgetTypeInfo; variables: DashboardVariable[]; targetOptions?: EditorProps["targetOptions"]; errors: string[]; onChange: (patch: Partial<Widget>) => void }) {
  const { t } = useTranslation();
  const targets = widget.targets ?? [];
  const max = Math.min(info?.targetRule.max ?? MAX_TARGETS, MAX_TARGETS);
  const setTarget = (i: number, patch: Partial<WidgetTarget>) => onChange({ targets: targets.map((x, n) => (n === i ? { ...x, ...patch } : x)) });
  const refsOf = (type: string) => variables.filter((v) => v.type === type).map((v) => refOf(v.name));
  const optionsOf = (type: "SPACE" | "DEVICE" | "METRIC") => targetOptions?.[type] ?? [];
  const err = (field: string) => (errors.includes(field) ? t("dashboards.errors.field") : undefined);
  return (
    <div className="flex flex-col gap-2 text-[13px]">
      <TextField label={t("dashboards.fields.title")} value={widget.title ?? ""} maxLength={100} onChange={(e) => onChange({ title: e.target.value })} />
      {info && info.targetRule.max > 0 && (
        <fieldset className="flex flex-col gap-2">
          <legend className="font-semibold">{t("dashboards.fields.targets", { min: info.targetRule.min, max })}</legend>
          {errors.includes("targets") && <p className="text-bad">{t("dashboards.errors.targetCount", { min: info.targetRule.min, max })}</p>}
          {targets.map((target, i) => {
            const idField = idFieldOf(target.kind);
            const listId = `${widget.id}-t${i}-${idField}`;
            const idType = idField === "deviceId" ? "DEVICE" : "SPACE";
            return (
              <div key={i} className="rounded-md border border-line p-2">
                <SelectField label={t("dashboards.fields.kind")} value={target.kind} onChange={(e) => setTarget(i, { kind: e.target.value })}>
                  {info.targetRule.kinds.map((k) => (
                    <option key={k} value={k}>
                      {t(`dashboards.kinds.${k}`, { defaultValue: k })}
                    </option>
                  ))}
                </SelectField>
                <TextField label={t(`dashboards.fields.${idField}`)} list={listId} value={(target[idField] as string) ?? ""} onChange={(e) => setTarget(i, { [idField]: e.target.value })} error={err(`targets[${i}].${idField}`)} hint={t("dashboards.fields.refHint")} />
                <datalist id={listId}>
                  {refsOf(idType).map((r) => (
                    <option key={r} value={r} />
                  ))}
                  {optionsOf(idType).map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </datalist>
                {isMetricKind(target.kind) && (
                  <TextField label={t("dashboards.fields.metricKey")} list={`${widget.id}-metrics`} value={target.metricKey ?? ""} onChange={(e) => setTarget(i, { metricKey: e.target.value })} error={err(`targets[${i}].metricKey`)} />
                )}
                <Button variant="ghost" onClick={() => onChange({ targets: targets.filter((_, n) => n !== i) })}>
                  {t("dashboards.fields.removeTarget")}
                </Button>
              </div>
            );
          })}
          <datalist id={`${widget.id}-metrics`}>
            {refsOf("METRIC").map((r) => (
              <option key={r} value={r} />
            ))}
            {optionsOf("METRIC").map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </datalist>
          {targets.length < max && (
            <Button onClick={() => onChange({ targets: [...targets, { kind: info.targetRule.kinds[0] ?? "DEVICE_METRIC" }] })}>{t("dashboards.fields.addTarget")}</Button>
          )}
        </fieldset>
      )}
      {info && <OptionsForm widget={widget} rules={info.optionsSchema.properties ?? {}} errors={errors} onChange={(options) => onChange({ options })} />}
    </div>
  );
}

/** 옵션 JSON Schema(API-DSH-13)로 만든 폼: 문자열·숫자·정수·참거짓·목록(enum), 배열·객체는 JSON 글상자 */
export function OptionsForm({ widget, rules, errors, onChange }: { widget: Widget; rules: Record<string, OptionRule>; errors: string[]; onChange: (options: Record<string, unknown>) => void }) {
  const { t } = useTranslation();
  const options = widget.options ?? {};
  const set = (key: string, value: unknown) => {
    const next = { ...options };
    if (value === undefined || value === "") delete next[key];
    else next[key] = value;
    onChange(next);
  };
  const label = (key: string) => t(`dashboards.options.${key}`, { defaultValue: key });
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="font-semibold">{t("dashboards.fields.options")}</legend>
      {Object.entries(rules).map(([key, rule]) => {
        const error = errors.includes(`options.${key}`) ? t("dashboards.errors.field") : undefined;
        const value = options[key];
        if (rule.enum)
          return (
            <SelectField key={key} label={label(key)} value={(value as string) ?? ""} onChange={(e) => set(key, e.target.value || undefined)} error={error}>
              <option value="">–</option>
              {rule.enum.map((v) => (
                <option key={v} value={v}>
                  {t(`dashboards.optionValues.${v}`, { defaultValue: v })}
                </option>
              ))}
            </SelectField>
          );
        if (rule.type === "boolean") return <Checkbox key={key} label={label(key)} checked={value === true} onChange={(e) => set(key, e.target.checked ? true : undefined)} />;
        if (rule.type === "number" || rule.type === "integer")
          return (
            <TextField
              key={key}
              label={label(key)}
              type="number"
              min={rule.minimum}
              max={rule.maximum}
              step={rule.type === "integer" ? 1 : "any"}
              value={typeof value === "number" ? String(value) : ""}
              onChange={(e) => set(key, e.target.value === "" ? undefined : Number(e.target.value))}
              error={error}
            />
          );
        if (rule.type === "array" || rule.type === "object") return <JsonOption key={key} label={label(key)} value={value} onChange={(v) => set(key, v)} error={error} array={rule.type === "array"} />;
        if (key === "content") return <TextArea key={key} label={label(key)} maxLength={rule.maxLength} value={(value as string) ?? ""} onChange={(e) => set(key, e.target.value)} error={error} />;
        return <TextField key={key} label={label(key)} maxLength={rule.maxLength} value={(value as string) ?? ""} onChange={(e) => set(key, e.target.value)} error={error} />;
      })}
    </fieldset>
  );
}

function JsonOption({ label, value, onChange, error, array }: { label: string; value: unknown; onChange: (v: unknown) => void; error?: string; array: boolean }) {
  const { t } = useTranslation();
  const [text, setText] = useState(value === undefined ? "" : JSON.stringify(value));
  const [invalid, setInvalid] = useState(false);
  return (
    <TextArea
      label={label}
      value={text}
      rows={2}
      onChange={(e) => {
        setText(e.target.value);
        if (e.target.value.trim() === "") {
          setInvalid(false);
          onChange(undefined);
          return;
        }
        try {
          const parsed = JSON.parse(e.target.value) as unknown;
          const ok = array ? Array.isArray(parsed) : typeof parsed === "object" && parsed !== null && !Array.isArray(parsed);
          setInvalid(!ok);
          if (ok) onChange(parsed);
        } catch {
          setInvalid(true);
        }
      }}
      error={invalid ? t("dashboards.errors.json") : error}
    />
  );
}

function SettingsDialog({ open, draft, onClose, onApply }: { open: boolean; draft: Draft; onClose: () => void; onApply: (patch: Partial<Draft>) => void }) {
  const { t } = useTranslation();
  const [local, setLocal] = useState<Draft>(draft);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setLocal(draft);
  }
  const vars = local.variables;
  const setVar = (i: number, patch: Partial<DashboardVariable>) => setLocal((l) => ({ ...l, variables: l.variables.map((v, n) => (n === i ? { ...v, ...patch } : v)) }));
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("dashboards.edit.settings")}
      footer={
        <>
          <Button onClick={onClose}>{t("dashboards.edit.cancel")}</Button>
          <Button
            variant="primary"
            onClick={() => {
              onApply({ description: local.description, visibility: local.visibility, variables: local.variables, timeRange: local.timeRange, resolution: local.resolution, refresh: local.refresh });
              onClose();
            }}
          >
            {t("dashboards.edit.apply")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2 text-[13px]">
        <TextArea label={t("dashboards.fields.description")} maxLength={500} value={local.description ?? ""} onChange={(e) => setLocal((l) => ({ ...l, description: e.target.value }))} />
        <SelectField label={t("dashboards.fields.visibility")} value={local.visibility} onChange={(e) => setLocal((l) => ({ ...l, visibility: e.target.value }))}>
          <option value="PRIVATE">{t("dashboards.visibility.PRIVATE")}</option>
          <option value="ORG">{t("dashboards.visibility.ORG")}</option>
        </SelectField>
        <SelectField label={t("dashboards.view.range")} value={isRelative(local.timeRange) ? local.timeRange.relative : "24h"} onChange={(e) => setLocal((l) => ({ ...l, timeRange: { relative: e.target.value } }))}>
          {RANGE_PRESETS.map((r) => (
            <option key={r} value={r}>
              {t(`dashboards.ranges.${r}`)}
            </option>
          ))}
        </SelectField>
        <SelectField label={t("dashboards.view.resolution")} value={local.resolution} onChange={(e) => setLocal((l) => ({ ...l, resolution: e.target.value }))}>
          {RESOLUTIONS.map((r) => (
            <option key={r} value={r}>
              {t(`dashboards.resolutions.${r}`)}
            </option>
          ))}
        </SelectField>
        <SelectField label={t("dashboards.view.refresh")} value={local.refresh} onChange={(e) => setLocal((l) => ({ ...l, refresh: e.target.value }))}>
          {REFRESHES.map((r) => (
            <option key={r} value={r}>
              {t(`dashboards.refreshes.${r}`)}
            </option>
          ))}
        </SelectField>
        <fieldset className="flex flex-col gap-2">
          <legend className="font-semibold">{t("dashboards.fields.variables")}</legend>
          {vars.map((v, i) => (
            <div key={i} className="flex items-end gap-2">
              <TextField label={t("dashboards.fields.variableName")} value={v.name} onChange={(e) => setVar(i, { name: e.target.value })} />
              <SelectField label={t("dashboards.fields.variableType")} value={v.type} onChange={(e) => setVar(i, { type: e.target.value })}>
                {VARIABLE_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {t(`dashboards.variableTypes.${type}`)}
                  </option>
                ))}
              </SelectField>
              <TextField label={t("dashboards.fields.variableDefault")} value={v.default ?? ""} onChange={(e) => setVar(i, { default: e.target.value || null })} />
              <Button variant="ghost" onClick={() => setLocal((l) => ({ ...l, variables: l.variables.filter((_, n) => n !== i) }))} aria-label={t("dashboards.fields.removeVariable", { name: v.name })}>
                ✕
              </Button>
            </div>
          ))}
          <Button onClick={() => setLocal((l) => ({ ...l, variables: [...l.variables, { name: `var${l.variables.length + 1}`, type: "SPACE", default: null }] }))}>{t("dashboards.fields.addVariable")}</Button>
        </fieldset>
      </div>
    </Dialog>
  );
}
