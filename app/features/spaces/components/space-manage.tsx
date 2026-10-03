/**
 * 공간 관리 탭(UI-DEV-02): 속성(DEV-01.02, DEV-10.01), 목표 환경(DEV-01.04), 운영 시간표(DEV-11.01), 운영 모드 카드(DEV-11.02).
 * 수정은 DEV_ADMIN만, 모드 수동 지정은 DEV_PLACE. 권한이 없으면 읽기 전용으로 보인다.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Form } from "react-router";
import { Alert, Badge, Button, Card, Checkbox, CsrfField, SelectField, Table, TextField } from "~/components/ui";
import { formatDateTime } from "~/lib/format";
import { checkOverrideUntil, checkSlots, checkTargets, sortSlots, type Slot, type TargetRow } from "../model/space-forms";

export interface SpaceDetail {
  id: string;
  parentId?: string | null;
  type: string;
  name: string;
  code?: string | null;
  usage?: string | null;
  areaM2?: number | null;
  capacity?: number | null;
  timezone?: string | null;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  kmaNx?: number | null;
  kmaNy?: number | null;
  version?: number;
}

export interface FormResult {
  intent?: string;
  ok?: boolean;
  error?: { code: string; message?: string };
  fieldErrors?: Record<string, string>;
}

function ResultLine({ result, intent }: { result?: FormResult; intent: string }) {
  const { t } = useTranslation();
  if (!result || result.intent !== intent) return null;
  if (result.ok) return <Alert tone="success">{t("common.saved")}</Alert>;
  if (result.error) return <Alert tone="danger">{t(`errors.${result.error.code}`, { defaultValue: result.error.message || t("errors.UNKNOWN") })}</Alert>;
  return null;
}

const USAGES = ["CLASSROOM", "OFFICE", "MEETING", "LAB", "HALLWAY", "OTHER"];

export function PropsForm({ space, canEdit, result }: { space: SpaceDetail; canEdit: boolean; result?: FormResult }) {
  const { t } = useTranslation();
  const fe = result?.intent === "props" ? (result.fieldErrors ?? {}) : {};
  return (
    <Card title={t("spaces.tab.props")}>
      <Form method="post" className="grid gap-3 md:grid-cols-2">
        <CsrfField />
        <input type="hidden" name="intent" value="props" />
        <input type="hidden" name="baseVersion" value={space.version ?? 0} />
        <TextField label={t("spaces.field.name")} name="name" defaultValue={space.name} disabled={!canEdit} required />
        <TextField label={t("spaces.field.code")} name="code" defaultValue={space.code ?? ""} disabled={!canEdit} error={fe.code ? t(`spaces.validation.${fe.code}`) : undefined} />
        <SelectField label={t("spaces.field.usage")} name="usage" defaultValue={space.usage ?? ""} disabled={!canEdit}>
          <option value="">–</option>
          {USAGES.map((u) => (
            <option key={u} value={u}>
              {t(`spaces.usage.${u}`)}
            </option>
          ))}
        </SelectField>
        <TextField label={t("spaces.field.areaM2")} name="areaM2" type="number" min={0} step="0.1" defaultValue={space.areaM2 ?? ""} disabled={!canEdit} error={fe.areaM2 ? t(`spaces.validation.${fe.areaM2}`) : undefined} />
        <TextField label={t("spaces.field.capacity")} name="capacity" type="number" min={0} step="1" defaultValue={space.capacity ?? ""} disabled={!canEdit} error={fe.capacity ? t(`spaces.validation.${fe.capacity}`) : undefined} />
        {space.type === "SITE" && (
          <>
            <TextField label={t("spaces.field.timezone")} name="timezone" defaultValue={space.timezone ?? "Asia/Seoul"} disabled={!canEdit} />
            <TextField label={t("spaces.field.address")} name="address" defaultValue={space.address ?? ""} disabled={!canEdit} />
            <TextField label={t("spaces.field.latitude")} name="latitude" defaultValue={space.latitude ?? ""} disabled={!canEdit} error={fe.latitude ? t(`spaces.validation.${fe.latitude}`) : undefined} />
            <TextField label={t("spaces.field.longitude")} name="longitude" defaultValue={space.longitude ?? ""} disabled={!canEdit} error={fe.longitude ? t(`spaces.validation.${fe.longitude}`) : undefined} />
            <p className="text-[12.5px] text-muted md:col-span-2">{t("spaces.field.grid", { nx: space.kmaNx ?? "–", ny: space.kmaNy ?? "–" })}</p>
          </>
        )}
        <div className="md:col-span-2">
          <ResultLine result={result} intent="props" />
        </div>
        {canEdit && (
          <div className="flex justify-end md:col-span-2">
            <Button type="submit" variant="primary">
              {t("common.save")}
            </Button>
          </div>
        )}
      </Form>
    </Card>
  );
}

export interface TargetsData {
  inherit: boolean;
  inheritedFromSpaceId?: string | null;
  inheritedFromSpaceName?: string | null;
  items?: { metricKey: string; min?: number | null; max?: number | null }[];
  effective?: { metricKey: string; min?: number | null; max?: number | null; inheritedFromSpaceId?: string | null; inheritedFromSpaceName?: string | null }[];
}

const asText = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(v));

export function TargetsEditor({ data, metrics, canEdit, result }: { data: TargetsData; metrics: { key: string; displayName?: string; unit?: string | null }[]; canEdit: boolean; result?: FormResult }) {
  const { t } = useTranslation();
  const [inherit, setInherit] = useState(data.inherit);
  const [rows, setRows] = useState<TargetRow[]>((data.items ?? []).map((i) => ({ metricKey: i.metricKey, min: asText(i.min), max: asText(i.max) })));
  const { items, errors } = checkTargets(rows);
  const hasErrors = !inherit && Object.keys(errors).length > 0;
  const update = (index: number, patch: Partial<TargetRow>) => setRows((current) => current.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  const inherited = (data.effective ?? []).filter((e) => e.inheritedFromSpaceId);
  return (
    <Card title={t("spaces.tab.targets")}>
      <Form method="post" className="flex flex-col gap-3">
        <CsrfField />
        <input type="hidden" name="intent" value="targets" />
        <input type="hidden" name="items" value={JSON.stringify(items)} />
        <Checkbox label={t("spaces.targets.inherit")} name="inherit" value="true" checked={inherit} onChange={(e) => setInherit(e.target.checked)} disabled={!canEdit} />
        <Table>
          <thead>
            <tr>
              <th scope="col">{t("spaces.targets.metric")}</th>
              <th scope="col">{t("spaces.targets.min")}</th>
              <th scope="col">{t("spaces.targets.max")}</th>
              <th scope="col">{t("spaces.targets.source")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {!inherit &&
              rows.map((row, index) => (
                <tr key={index}>
                  <td>
                    <select aria-label={t("spaces.targets.metric")} value={row.metricKey} onChange={(e) => update(index, { metricKey: e.target.value })} disabled={!canEdit} className="rounded border border-line bg-panel px-1 py-1">
                      <option value="">–</option>
                      {metrics.map((m) => (
                        <option key={m.key} value={m.key}>
                          {m.displayName ? `${m.displayName} (${m.key})` : m.key}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input aria-label={t("spaces.targets.min")} value={row.min} onChange={(e) => update(index, { min: e.target.value })} disabled={!canEdit} className="w-24 rounded border border-line bg-panel px-1 py-1 font-mono" />
                  </td>
                  <td>
                    <input aria-label={t("spaces.targets.max")} value={row.max} onChange={(e) => update(index, { max: e.target.value })} disabled={!canEdit} className="w-24 rounded border border-line bg-panel px-1 py-1 font-mono" />
                  </td>
                  <td>
                    {t("spaces.targets.direct")}
                    {errors[index] && (
                      <p role="alert" className="text-[12px] text-bad">
                        {t(`spaces.validation.${errors[index]}`)}
                      </p>
                    )}
                  </td>
                  <td>
                    {canEdit && (
                      <Button variant="ghost" onClick={() => setRows((c) => c.filter((_, i) => i !== index))}>
                        {t("common.remove")}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            {(inherit ? (data.effective ?? []) : inherited).map((e) => (
              <tr key={`inh-${e.metricKey}`} className="text-muted">
                <td>{e.metricKey}</td>
                <td className="font-mono">{asText(e.min) || "–"}</td>
                <td className="font-mono">{asText(e.max) || "–"}</td>
                <td>{t("spaces.targets.inheritedFrom", { name: e.inheritedFromSpaceName ?? data.inheritedFromSpaceName ?? e.inheritedFromSpaceId ?? "–" })}</td>
                <td />
              </tr>
            ))}
          </tbody>
        </Table>
        <ResultLine result={result} intent="targets" />
        {canEdit && (
          <div className="flex justify-between">
            <Button onClick={() => setRows((c) => [...c, { metricKey: "", min: "", max: "" }])} disabled={inherit}>
              {t("spaces.targets.addRow")}
            </Button>
            <Button type="submit" variant="primary" disabled={hasErrors}>
              {t("common.save")}
            </Button>
          </div>
        )}
      </Form>
    </Card>
  );
}

export interface ScheduleData {
  inherit: boolean;
  inheritedFromSpaceId?: string | null;
  inheritedFromSpaceName?: string | null;
  slots?: Slot[];
}

export function ScheduleEditor({ data, canEdit, result }: { data: ScheduleData; canEdit: boolean; result?: FormResult }) {
  const { t } = useTranslation();
  const [inherit, setInherit] = useState(data.inherit);
  const [slots, setSlots] = useState<Slot[]>(sortSlots(data.slots ?? []));
  const errors = inherit ? {} : checkSlots(slots);
  const update = (index: number, patch: Partial<Slot>) => setSlots((c) => c.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  return (
    <Card title={t("spaces.tab.schedule")}>
      <Form method="post" className="flex flex-col gap-3">
        <CsrfField />
        <input type="hidden" name="intent" value="schedule" />
        <input type="hidden" name="slots" value={JSON.stringify(inherit ? [] : slots)} />
        <Checkbox label={t("spaces.schedule.inherit")} name="inherit" value="true" checked={inherit} onChange={(e) => setInherit(e.target.checked)} disabled={!canEdit} />
        {inherit && <p className="text-[12.5px] text-muted">{t("spaces.schedule.inheritedFrom", { name: data.inheritedFromSpaceName ?? data.inheritedFromSpaceId ?? "–" })}</p>}
        <ul className="flex flex-col gap-1">
          {slots.map((slot, index) => (
            <li key={index} className="flex flex-wrap items-center gap-2">
              <select aria-label={t("spaces.schedule.day")} value={slot.dayOfWeek} onChange={(e) => update(index, { dayOfWeek: Number(e.target.value) })} disabled={!canEdit || inherit} className="rounded border border-line bg-panel px-1 py-1">
                {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                  <option key={d} value={d}>
                    {t(`spaces.day.${d}`)}
                  </option>
                ))}
              </select>
              <input aria-label={t("spaces.schedule.start")} value={slot.start} onChange={(e) => update(index, { start: e.target.value })} disabled={!canEdit || inherit} className="w-20 rounded border border-line bg-panel px-1 py-1 font-mono" />
              <span>~</span>
              <input aria-label={t("spaces.schedule.end")} value={slot.end} onChange={(e) => update(index, { end: e.target.value })} disabled={!canEdit || inherit} className="w-20 rounded border border-line bg-panel px-1 py-1 font-mono" />
              {canEdit && !inherit && (
                <Button variant="ghost" onClick={() => setSlots((c) => c.filter((_, i) => i !== index))}>
                  {t("common.remove")}
                </Button>
              )}
              {errors[index] && (
                <span role="alert" className="text-[12px] text-bad">
                  {t(`spaces.validation.${errors[index]}`)}
                </span>
              )}
            </li>
          ))}
          {slots.length === 0 && !inherit && <li className="text-[12.5px] text-muted">{t("spaces.schedule.empty")}</li>}
        </ul>
        <ResultLine result={result} intent="schedule" />
        {canEdit && (
          <div className="flex justify-between">
            <Button onClick={() => setSlots((c) => [...c, { dayOfWeek: 1, start: "09:00", end: "18:00" }])} disabled={inherit}>
              {t("spaces.schedule.addSlot")}
            </Button>
            <Button type="submit" variant="primary" disabled={Object.keys(errors).length > 0}>
              {t("common.save")}
            </Button>
          </div>
        )}
      </Form>
    </Card>
  );
}

export interface ModeData {
  mode?: string | null;
  source?: string | null;
  until?: string | null;
  nextChangeAt?: string | null;
}

const MODES = ["OCCUPIED", "UNOCCUPIED", "HOLIDAY", "MAINTENANCE"];

export function ModeCard({ data, canOverride, timezone, lang, now, result }: { data: ModeData | null; canOverride: boolean; timezone: string; lang: string; now: number; result?: FormResult }) {
  const { t } = useTranslation();
  const [until, setUntil] = useState("");
  const untilIso = until ? new Date(until).toISOString() : "";
  const problem = checkOverrideUntil(untilIso, now);
  return (
    <Card title={t("spaces.mode.title")}>
      {data?.mode ? (
        <div className="flex flex-col gap-1 text-[13px]">
          <p>
            <Badge tone="info">{t(`spaces.mode.value.${data.mode}`, { defaultValue: data.mode })}</Badge>
          </p>
          <p className="text-muted">{t("spaces.mode.source", { source: t(`spaces.mode.sourceValue.${data.source ?? "SCHEDULE"}`, { defaultValue: data.source ?? "" }) })}</p>
          {data.nextChangeAt && <p className="text-muted">{t("spaces.mode.next", { at: formatDateTime(data.nextChangeAt, timezone, lang) })}</p>}
        </div>
      ) : (
        <p className="text-[13px] text-muted">{t("spaces.mode.none")}</p>
      )}
      {canOverride && (
        <Form method="post" className="mt-3 flex flex-col gap-2">
          <CsrfField />
          <input type="hidden" name="intent" value="override" />
          <input type="hidden" name="until" value={untilIso} />
          <SelectField label={t("spaces.mode.override")} name="mode" defaultValue="">
            <option value="">{t("spaces.mode.clear")}</option>
            {MODES.map((m) => (
              <option key={m} value={m}>
                {t(`spaces.mode.value.${m}`)}
              </option>
            ))}
          </SelectField>
          <TextField label={t("spaces.mode.until")} type="datetime-local" value={until} onChange={(e) => setUntil(e.target.value)} error={problem ? t(`spaces.validation.${problem}`) : undefined} />
          <ResultLine result={result} intent="override" />
          <div className="flex justify-end">
            <Button type="submit" disabled={Boolean(problem)}>
              {t("common.apply")}
            </Button>
          </div>
        </Form>
      )}
    </Card>
  );
}
