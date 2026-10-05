/**
 * 정기 내보내기 설정(UI-TSD-02 "정기 설정", UI-TSD-08 [추가]): 이름, 반복(매일·매주 요일·매월 날짜 + 시각), 기간(전날·지난주·지난달),
 * 형식(CSV·Excel·Parquet), 전달(메일 수신자 / 저장소 S3·SFTP + [연결 테스트] API-TSD-56), 사용.
 * 저장: 새 일정 POST, 고치기 PATCH(온 키 + baseVersion) — API-TSD-23.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, Checkbox, SelectField, TextField } from "~/components/ui";
import { errorText } from "~/lib/error-text";
import { defaultDataApi, type DataApi } from "../api";
import {
  RELATIVE_PERIODS,
  REPEAT_KINDS,
  SCHEDULE_FORMATS,
  TARGET_FIELDS,
  TARGET_TYPES,
  emptyScheduleForm,
  formOfSchedule,
  scheduleBody,
  testTargetBody,
  validateSchedule,
  type ExportSchedule,
  type ScheduleErrors,
  type ScheduleForm,
  type TargetTestResult,
  type TelemetryQuery,
} from "../model/exports";

export interface ScheduleEditorProps {
  /** 고칠 일정(없으면 새 일정) */
  schedule?: ExportSchedule | null;
  /** 새 일정의 조회 조건(탐색기에서 넘어온 API-TSD-04 본문) */
  query?: Partial<TelemetryQuery> | null;
  api?: DataApi;
  onSaved: (schedule: ExportSchedule) => void;
  onCancel: () => void;
}

const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

export function ScheduleEditor({ schedule, query, api = defaultDataApi, onSaved, onCancel }: ScheduleEditorProps) {
  const { t } = useTranslation();
  const [form, setForm] = useState<ScheduleForm>(() => (schedule ? formOfSchedule(schedule) : emptyScheduleForm()));
  const [errors, setErrors] = useState<ScheduleErrors>({});
  const [failure, setFailure] = useState<{ code: string; message?: string }>();
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState<TargetTestResult | { error: string }>();
  const set = (patch: Partial<ScheduleForm>) => setForm((f) => ({ ...f, ...patch }));
  const effectiveQuery = schedule ? schedule.query : query;

  const save = async () => {
    const found = validateSchedule(form, Boolean(effectiveQuery?.series?.length));
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    setFailure(undefined);
    const body = scheduleBody(form, schedule ? undefined : effectiveQuery);
    const result = schedule ? await api.updateSchedule(schedule.id, { ...body, baseVersion: schedule.version }) : await api.createSchedule(body);
    setBusy(false);
    if (result.ok) onSaved(result.data);
    else setFailure({ code: result.code, message: result.message });
  };

  const runTest = async () => {
    setTest(undefined);
    const result = await api.testTarget(testTargetBody(form));
    setTest(result.ok ? result.data : { error: errorText(t, { code: result.code, message: result.message }) ?? "" });
  };

  const err = (key: keyof ScheduleErrors) => (errors[key] ? t(`data.schedule.errors.${key}.${errors[key]}`) : undefined);
  const fields = TARGET_FIELDS[form.targetType];

  return (
    <section aria-label={t("data.schedule.editorTitle")} className="flex flex-col gap-3">
      <TextField label={t("data.schedule.name")} value={form.name} maxLength={100} onChange={(e) => set({ name: e.target.value })} error={err("name")} />
      {errors.query && <Alert tone="danger">{err("query")}</Alert>}
      <fieldset className="flex flex-col gap-2">
        <legend className="text-[12.5px] font-medium text-muted">{t("data.schedule.repeat")}</legend>
        <div className="flex flex-wrap items-end gap-2">
          <SelectField label={t("data.schedule.repeatKind")} value={form.repeat.kind} onChange={(e) => set({ repeat: { ...form.repeat, kind: e.target.value as ScheduleForm["repeat"]["kind"] } })}>
            <option value="">{t("data.schedule.choose")}</option>
            {REPEAT_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`data.schedule.repeatKinds.${k}`)}
              </option>
            ))}
          </SelectField>
          {form.repeat.kind === "WEEKLY" && (
            <SelectField label={t("data.schedule.weekday")} value={form.repeat.weekday} onChange={(e) => set({ repeat: { ...form.repeat, weekday: Number(e.target.value) } })}>
              {WEEKDAYS.map((d) => (
                <option key={d} value={d}>
                  {t(`data.schedule.weekdays.${d}`)}
                </option>
              ))}
            </SelectField>
          )}
          {form.repeat.kind === "MONTHLY" && (
            <TextField label={t("data.schedule.day")} type="number" min={1} max={28} value={form.repeat.day} onChange={(e) => set({ repeat: { ...form.repeat, day: Math.max(1, Math.min(28, Number(e.target.value) || 1)) } })} />
          )}
          <TextField label={t("data.schedule.time")} type="time" value={form.repeat.time} onChange={(e) => set({ repeat: { ...form.repeat, time: e.target.value } })} />
        </div>
        {errors.repeat && (
          <p role="alert" className="text-[12px] text-bad-ink">
            {err("repeat")}
          </p>
        )}
      </fieldset>
      <div className="grid gap-2 sm:grid-cols-2">
        <SelectField label={t("data.schedule.period")} value={form.relativePeriod} onChange={(e) => set({ relativePeriod: e.target.value as ScheduleForm["relativePeriod"] })}>
          {RELATIVE_PERIODS.map((p) => (
            <option key={p} value={p}>
              {t(`data.schedule.periods.${p}`)}
            </option>
          ))}
        </SelectField>
        <SelectField label={t("data.export.format")} value={form.format} onChange={(e) => set({ format: e.target.value as ScheduleForm["format"] })}>
          {SCHEDULE_FORMATS.map((f) => (
            <option key={f} value={f}>
              {t(`data.export.formats.${f}`)}
            </option>
          ))}
        </SelectField>
      </div>
      <SelectField label={t("data.schedule.delivery")} value={form.delivery} onChange={(e) => set({ delivery: e.target.value as ScheduleForm["delivery"] })}>
        <option value="EMAIL">{t("data.schedule.deliveries.EMAIL")}</option>
        <option value="STORAGE">{t("data.schedule.deliveries.STORAGE")}</option>
      </SelectField>
      {form.delivery === "EMAIL" ? (
        <TextField label={t("data.schedule.recipients")} hint={t("data.schedule.recipientsHint")} value={form.recipients} onChange={(e) => set({ recipients: e.target.value })} error={err("recipients")} />
      ) : (
        <div className="flex flex-col gap-2 rounded-md border border-line p-3">
          <SelectField label={t("data.schedule.targetType")} value={form.targetType} onChange={(e) => set({ targetType: e.target.value as ScheduleForm["targetType"], target: {}, credential: {} })}>
            {TARGET_TYPES.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </SelectField>
          <div className="grid gap-2 sm:grid-cols-2">
            {fields.target.map((f) => (
              <TextField
                key={f.key}
                label={`${t(`data.schedule.target.${f.key}`)}${f.required ? " *" : ""}`}
                value={form.target[f.key] ?? ""}
                onChange={(e) => set({ target: { ...form.target, [f.key]: e.target.value } })}
              />
            ))}
            {fields.credential.map((key) => (
              <TextField
                key={key}
                type="password"
                autoComplete="off"
                label={t(`data.schedule.credential.${key}`)}
                hint={schedule?.credentialConfigured ? t("data.schedule.credentialKept") : undefined}
                value={form.credential[key] ?? ""}
                onChange={(e) => set({ credential: { ...form.credential, [key]: e.target.value } })}
              />
            ))}
          </div>
          {errors.target && (
            <p role="alert" className="text-[12px] text-bad-ink">
              {err("target")}
            </p>
          )}
          <div>
            <Button onClick={() => void runTest()}>{t("data.schedule.testTarget")}</Button>
          </div>
          {test && "error" in test && <Alert tone="danger">{test.error}</Alert>}
          {test && "steps" in test && (
            <ul aria-label={t("data.schedule.testResult")} className="flex flex-col gap-1 text-[12.5px]">
              {test.steps.map((s) => (
                <li key={s.name} className={s.ok ? "text-good-ink" : "text-bad-ink"}>
                  {`${s.ok ? "✔" : "✖"} ${t(`data.schedule.steps.${s.name}`, { defaultValue: s.name })}${s.detail ? ` — ${s.detail}` : ""}`}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <Checkbox label={t("data.schedule.enabled")} checked={form.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
      {failure && <Alert tone="danger">{errorText(t, failure)}</Alert>}
      <div className="flex justify-end gap-2">
        <Button onClick={onCancel}>{t("common.cancel")}</Button>
        <Button variant="primary" disabled={busy} onClick={() => void save()}>
          {t("common.save")}
        </Button>
      </div>
    </section>
  );
}
