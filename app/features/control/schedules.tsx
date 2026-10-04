/**
 * UI-ACT-05 예약 제어(ACT-02.07, API-ACT-15). 목록(이름, 대상, 일정 요약, 다음 실행, 마지막 결과, 활성 토글)과 편집 폼.
 * 일정 종류: 한 번(일시) / 반복(요일·시각 또는 cron) / 공간 운영 시간 기준(공간, 시작·끝, ±분). 유효 기간, 휴일 제외, 시간대(기본 조직 시간대).
 * 시각 입력은 조직 시간대로 받고 UTC로 보낸다. 오류 SCHEDULE_INVALID는 서버 문구를 보인다.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { SpaceSelect } from "~/components/space-picker";
import { Alert, Badge, Button, Card, Checkbox, EmptyState, SelectField, Table, TextField } from "~/components/ui";
import { errorText } from "~/lib/error-text";
import { formatDateTime } from "~/lib/format";
import type { SpaceNode } from "~/lib/spaces";
import { controlAdminApi, type ControlAdminApi } from "./admin-api";
import { localToUtc } from "./model/control";
import { emptyScheduleForm, scheduleBody, scheduleProblems, scheduleToForm, type Schedule, type ScheduleForm, type ScheduleSummary } from "./model/admin";

const DAYS = [1, 2, 3, 4, 5, 6, 7];

/** UTC ISO → 조직 시간대 `YYYY-MM-DDTHH:mm`(datetime-local 값) */
export function utcToLocalInput(iso: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(
    new Date(iso),
  );
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

/** 저장 응답(API-ACT-15)에는 targetSummary가 없어 화면에서 대상 이름을 만든다 */
function summaryOf(s: Schedule, scenes: { sceneId: string; name: string }[], devices: { id: string; name: string }[]): ScheduleSummary {
  const target = s.target.sceneId
    ? (scenes.find((x) => x.sceneId === s.target.sceneId)?.name ?? s.target.sceneId)
    : `${devices.find((d) => d.id === s.target.deviceId)?.name ?? s.target.deviceId ?? ""} ${s.target.capability ?? ""}.${s.target.command ?? ""}`;
  return {
    controlScheduleId: s.controlScheduleId,
    name: s.name,
    kind: s.kind,
    targetSummary: s.targetSummary ?? target,
    enabled: s.enabled,
    nextRunAt: s.nextRunAt ?? null,
    lastRun: s.lastRun ?? null,
  };
}

export interface ScheduleManagerProps {
  initial: ScheduleSummary[];
  failed?: boolean;
  scenes: { sceneId: string; name: string }[];
  devices: { id: string; name: string }[];
  spaces: SpaceNode[];
  timezone: string;
  lang: string;
  api?: ControlAdminApi;
}

export function ScheduleManager({ initial, failed, scenes, devices, spaces, timezone, lang, api = controlAdminApi }: ScheduleManagerProps) {
  const { t } = useTranslation();
  const [rows, setRows] = useState(initial);
  const [editing, setEditing] = useState<{ id: string | null; version: number; form: ScheduleForm } | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const problems = editing ? scheduleProblems(editing.form) : [];
  const set = (patch: Partial<ScheduleForm>) => setEditing((e) => (e ? { ...e, form: { ...e.form, ...patch } } : e));
  const err = (key: string, text: string) => (submitted && problems.includes(key) ? text : undefined);

  const open = async (id: string | null) => {
    setNotice(null);
    setSubmitted(false);
    if (!id) {
      setEditing({ id: null, version: 0, form: emptyScheduleForm(timezone) });
      return;
    }
    const result = await api.schedule(id);
    if (result.ok) setEditing({ id, version: result.data.version, form: scheduleToForm(result.data, timezone, (iso) => utcToLocalInput(iso, result.data.timezone ?? timezone)) });
    else setNotice({ tone: "danger", text: errorText(t, result) ?? "" });
  };

  const save = async () => {
    if (!editing) return;
    setSubmitted(true);
    if (problems.length > 0) return;
    const body = scheduleBody(editing.form, (local) => localToUtc(local, editing.form.timezone || timezone));
    const result = editing.id ? await api.updateSchedule(editing.id, { ...body, baseVersion: editing.version }) : await api.createSchedule(body);
    if (!result.ok) {
      setNotice({ tone: "danger", text: errorText(t, result) ?? "" });
      return;
    }
    const row = summaryOf(result.data, scenes, devices);
    setRows((list) => (list.some((r) => r.controlScheduleId === row.controlScheduleId) ? list.map((r) => (r.controlScheduleId === row.controlScheduleId ? row : r)) : [row, ...list]));
    setEditing(null);
    setNotice({ tone: "success", text: t("control.schedules.saved", { at: row.nextRunAt ? formatDateTime(row.nextRunAt, timezone, lang) : "–" }) });
  };

  const toggle = async (row: ScheduleSummary) => {
    const result = await api.setScheduleEnabled(row.controlScheduleId, !row.enabled);
    if (result.ok) setRows((list) => list.map((r) => (r.controlScheduleId === row.controlScheduleId ? { ...r, enabled: result.data.enabled, nextRunAt: result.data.nextRunAt ?? null } : r)));
    else setNotice({ tone: "danger", text: errorText(t, result) ?? "" });
  };

  const remove = async (row: ScheduleSummary) => {
    if (!window.confirm(t("control.schedules.deleteConfirm", { name: row.name }))) return;
    const result = await api.deleteSchedule(row.controlScheduleId);
    if (result.ok) setRows((list) => list.filter((r) => r.controlScheduleId !== row.controlScheduleId));
    else setNotice({ tone: "danger", text: errorText(t, result) ?? "" });
  };

  const form = editing?.form;
  return (
    <div className="flex flex-col gap-4">
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      <Card
        title={t("control.schedules.title")}
        actions={
          <Button variant="primary" onClick={() => void open(null)}>
            {t("control.schedules.new")}
          </Button>
        }
      >
        {failed && <Alert tone="warning">{t("control.common.loadFailed")}</Alert>}
        {rows.length === 0 && !failed ? (
          <EmptyState title={t("control.schedules.empty")} />
        ) : (
          <Table>
            <thead>
              <tr>
                <th>{t("control.schedules.name")}</th>
                <th>{t("control.schedules.target")}</th>
                <th>{t("control.schedules.kind")}</th>
                <th>{t("control.schedules.nextRun")}</th>
                <th>{t("control.schedules.lastRun")}</th>
                <th>{t("control.common.enabled")}</th>
                <th>{t("control.history.col.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.controlScheduleId}>
                  <td>
                    <button type="button" className="text-accent hover:underline" onClick={() => void open(row.controlScheduleId)}>
                      {row.name}
                    </button>
                  </td>
                  <td>{row.targetSummary ?? "–"}</td>
                  <td>{t(`control.schedules.kinds.${row.kind}`)}</td>
                  <td>{row.nextRunAt ? t("control.schedules.nextRunAt", { at: formatDateTime(row.nextRunAt, timezone, lang) }) : "–"}</td>
                  <td>
                    {row.lastRun?.status ? (
                      <Badge tone={row.lastRun.status === "SUCCEEDED" ? "success" : row.lastRun.status === "SKIPPED" ? "neutral" : "warning"}>
                        {t(`control.schedules.result.${row.lastRun.status}`, { defaultValue: row.lastRun.status })}
                      </Badge>
                    ) : (
                      "–"
                    )}
                  </td>
                  <td>
                    <input type="checkbox" role="switch" aria-label={t("control.schedules.toggle", { name: row.name })} checked={row.enabled} onChange={() => void toggle(row)} />
                  </td>
                  <td>
                    <Button variant="ghost" onClick={() => void remove(row)}>
                      {t("common.delete")}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {editing && form && (
        <Card title={editing.id ? t("control.schedules.edit") : t("control.schedules.new")} actions={<Button onClick={() => setEditing(null)}>{t("common.close")}</Button>}>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField label={t("control.schedules.name")} value={form.name} maxLength={100} onChange={(e) => set({ name: e.target.value })} error={err("name", t("control.schedules.nameRequired"))} />
            <SelectField label={t("control.schedules.targetType")} value={form.targetType} onChange={(e) => set({ targetType: e.target.value as ScheduleForm["targetType"] })}>
              <option value="scene">{t("control.schedules.targetScene")}</option>
              <option value="device">{t("control.schedules.targetDevice")}</option>
            </SelectField>
            {form.targetType === "scene" ? (
              <SelectField label={t("control.schedules.scene")} value={form.sceneId} onChange={(e) => set({ sceneId: e.target.value })} error={err("scene", t("control.schedules.sceneRequired"))}>
                <option value="">{t("control.schedules.chooseScene")}</option>
                {scenes.map((s) => (
                  <option key={s.sceneId} value={s.sceneId}>
                    {s.name}
                  </option>
                ))}
              </SelectField>
            ) : (
              <>
                <SelectField
                  label={t("control.schedules.device")}
                  value={form.deviceId}
                  onChange={(e) => set({ deviceId: e.target.value })}
                  error={err("device", t("control.schedules.deviceRequired"))}
                >
                  <option value="">{t("control.scenes.chooseDevice")}</option>
                  {devices.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </SelectField>
                <TextField label={t("control.scenes.capability")} value={form.capability} placeholder="Thermostat" onChange={(e) => set({ capability: e.target.value })} />
                <TextField label={t("control.schedules.command")} value={form.command} onChange={(e) => set({ command: e.target.value })} />
                <TextField
                  label={t("control.schedules.args")}
                  value={form.args}
                  className="font-mono"
                  onChange={(e) => set({ args: e.target.value })}
                  error={err("args", t("control.schedules.argsInvalid"))}
                />
              </>
            )}
            <SelectField label={t("control.schedules.kind")} value={form.kind} onChange={(e) => set({ kind: e.target.value as ScheduleForm["kind"] })}>
              {(["ONCE", "RECURRING", "SPACE_HOURS"] as const).map((k) => (
                <option key={k} value={k}>
                  {t(`control.schedules.kinds.${k}`)}
                </option>
              ))}
            </SelectField>
            {form.kind === "ONCE" && (
              <TextField label={t("control.schedules.at")} type="datetime-local" value={form.at} onChange={(e) => set({ at: e.target.value })} error={err("at", t("control.schedules.atRequired"))} />
            )}
            {form.kind === "RECURRING" && (
              <div className="flex flex-col gap-2 sm:col-span-2">
                <fieldset className="flex flex-wrap gap-2 text-[13px]">
                  <legend className="text-[12.5px] font-medium text-muted">{t("control.schedules.days")}</legend>
                  {DAYS.map((d) => (
                    <label key={d} className="inline-flex items-center gap-1">
                      <input type="checkbox" checked={form.days.includes(d)} onChange={() => set({ days: form.days.includes(d) ? form.days.filter((x) => x !== d) : [...form.days, d] })} />
                      {t(`control.schedules.dow.${d}`)}
                    </label>
                  ))}
                </fieldset>
                <div className="grid gap-3 sm:grid-cols-2">
                  <TextField label={t("control.schedules.time")} type="time" value={form.time} onChange={(e) => set({ time: e.target.value })} />
                  <TextField
                    label={t("control.schedules.cron")}
                    value={form.cron}
                    placeholder="50 8 * * 1-5"
                    hint={t("control.schedules.cronHint")}
                    onChange={(e) => set({ cron: e.target.value })}
                    error={err("cron", t("control.schedules.cronInvalid"))}
                  />
                </div>
              </div>
            )}
            {form.kind === "SPACE_HOURS" && (
              <>
                <SpaceSelect
                  spaces={spaces}
                  label={t("control.schedules.space")}
                  value={form.spaceId}
                  onChange={(e) => set({ spaceId: e.target.value })}
                  error={err("spaceHours", t("control.schedules.spaceHoursInvalid"))}
                />
                <SelectField label={t("control.schedules.edge")} value={form.edge} onChange={(e) => set({ edge: e.target.value as "START" | "END" })}>
                  <option value="START">{t("control.schedules.edgeStart")}</option>
                  <option value="END">{t("control.schedules.edgeEnd")}</option>
                </SelectField>
                <TextField label={t("control.schedules.offset")} type="number" value={form.offsetMinutes} onChange={(e) => set({ offsetMinutes: e.target.value })} />
              </>
            )}
            <TextField label={t("control.schedules.validFrom")} type="date" value={form.validFrom} onChange={(e) => set({ validFrom: e.target.value })} />
            <TextField
              label={t("control.schedules.validTo")}
              type="date"
              value={form.validTo}
              onChange={(e) => set({ validTo: e.target.value })}
              error={err("validRange", t("control.schedules.validRangeInvalid"))}
            />
            <TextField label={t("control.schedules.timezone")} value={form.timezone} onChange={(e) => set({ timezone: e.target.value })} />
            <Checkbox label={t("control.schedules.skipHolidays")} checked={form.skipHolidays} onChange={(e) => set({ skipHolidays: e.target.checked })} />
          </div>
          <div className="mt-3 flex justify-end">
            <Button variant="primary" onClick={() => void save()}>
              {t("common.save")}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
