/**
 * UI-CMP-09 정기 발행 일정 만들기·고치기(`/compliance/reports/schedules/new`, `/compliance/reports/schedules/{id}`, CMP-02.04). CMP_REPORT(OPERATOR+)만.
 * 리포트 유형·대상은 새 리포트 마법사(UI-CMP-07) 1~2단계와 같다. 주기(매월 N일·분기 첫 달 N일, 1~28), 발행 시각(HH:mm, 조직 시간대),
 * 대상 기간(직전 달·직전 분기), 수신자(사용자 여러 명·이메일 여러 개, 최소 1), 형식(PDF·PDF+CSV), 사용 여부.
 * API: 저장·삭제 API-CMP-21(수정은 version이 맞아야 한다).
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Form, data, redirect, useNavigation } from "react-router";
import { callApi, field, newIdempotencyKey, orThrow, requirePermission } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { getMe } from "~/bff/user.server";
import { Alert, Button, ButtonLink, Card, Checkbox, CsrfField, PageHeader, SelectField, TextArea, TextField } from "~/components/ui";
import { FACILITY_TYPES, REPORT_TYPES, SUPPORTED_REPORT_TYPES } from "~/features/compliance/model/reports";
import { CADENCES, EMPTY_FORM, formOf, PERIOD_RULES, SCHEDULE_FORMATS, scheduleBody, serverFieldError, validateScheduleForm, type ReportSchedule, type ScheduleForm } from "~/features/compliance/model/schedules";
import { loadUsers } from "~/features/notify/server";
import { errorText } from "~/lib/error-text";
import { resolveTimezone } from "~/lib/format";
import { flattenSpaces, type SpaceNode } from "~/lib/spaces";
import type { Route } from "./+types/compliance-report-schedule-edit";

export function meta() {
  return [{ title: "data2flow" }];
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const ctx = bff(context);
  const me = await getMe(ctx, request);
  requirePermission(me.ok ? me.data.permissions : [], "CMP_REPORT");
  const id = params.scheduleId;
  const [spaces, users, schedule] = await Promise.all([
    callApi<SpaceNode[]>(ctx, request, "/api/v1/core/spaces"),
    loadUsers(ctx, request),
    id ? callApi<ReportSchedule>(ctx, request, `/api/v1/core/compliance/report-schedules/${encodeURIComponent(id)}`) : Promise.resolve(null),
  ]);
  return {
    schedule: schedule ? orThrow(schedule) : null,
    spaces: spaces.ok ? spaces.data : [],
    spacesFailed: !spaces.ok,
    users: users.users,
    usersAvailable: users.available,
    timezone: resolveTimezone(me.ok ? me.data.timezone : undefined),
    idempotencyKey: newIdempotencyKey(),
  };
}

type ActionResult = { fieldErrors?: Record<string, string>; error?: { code: string; message?: string }; values?: ScheduleForm };

function readForm(form: FormData): ScheduleForm {
  const all = (name: string) => form.getAll(name).filter((v): v is string => typeof v === "string" && v !== "");
  return {
    name: field(form, "name"),
    type: field(form, "type"),
    title: field(form, "title"),
    spaceIds: all("spaceIds"),
    facilityType: field(form, "facilityType"),
    cadence: field(form, "cadence"),
    dayOfPeriod: field(form, "dayOfPeriod").trim(),
    publishTime: field(form, "publishTime").trim(),
    periodRule: field(form, "periodRule"),
    userIds: all("userIds"),
    emails: field(form, "emails"),
    format: field(form, "format"),
    enabled: field(form, "enabled") === "true",
  };
}

/** 서버 오류 코드를 고칠 필드로 */
const FIELD_OF: Record<string, [string, string]> = {
  CMP_PROFILE_NOT_APPLIED: ["spaceIds", "profileNotApplied"],
  SPACE_NOT_FOUND: ["spaceIds", "spaceRequired"],
  CMP_FACILITY_TYPE_REQUIRED: ["facilityType", "facilityRequired"],
};

export async function action({ request, context, params }: Route.ActionArgs) {
  const ctx = bff(context);
  const form = await request.formData();
  const intent = field(form, "intent");
  const id = params.scheduleId;
  const path = id ? `/api/v1/core/compliance/report-schedules/${encodeURIComponent(id)}` : "/api/v1/core/compliance/report-schedules";
  if (intent === "delete" && id) {
    const result = await callApi(ctx, request, path, { method: "DELETE" });
    if (!result.ok) return data<ActionResult>({ error: { code: result.code, message: result.message } }, { status: result.status });
    throw redirect("/compliance/reports/schedules");
  }
  const values = readForm(form);
  const fieldErrors = validateScheduleForm(values);
  if (Object.keys(fieldErrors).length) return data<ActionResult>({ fieldErrors, values }, { status: 400 });
  const version = id ? Number(field(form, "version")) : undefined;
  const result = await callApi<ReportSchedule>(ctx, request, path, {
    method: id ? "PUT" : "POST",
    body: scheduleBody(values, version),
    idempotencyKey: id ? undefined : field(form, "idempotencyKey") || newIdempotencyKey(),
  });
  if (result.ok) throw redirect("/compliance/reports/schedules");
  const mapped = FIELD_OF[result.code];
  if (mapped) return data<ActionResult>({ values, fieldErrors: { [mapped[0]]: mapped[1] } }, { status: result.status });
  const server = (result.errors ?? []).map((e) => serverFieldError(e.field, e.code)).filter(([key]) => key !== "form");
  if (result.code === "CMP_SCHEDULE_INVALID" && server.length) return data<ActionResult>({ values, fieldErrors: Object.fromEntries(server) }, { status: result.status });
  return data<ActionResult>({ values, error: { code: result.code, message: result.message } }, { status: result.status });
}

export default function ComplianceReportScheduleEdit({ loaderData, actionData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const { schedule, spaces, spacesFailed, users, usersAvailable, timezone, idempotencyKey } = loaderData;
  const result = actionData as ActionResult | undefined;
  const values = result?.values ?? (schedule ? formOf(schedule) : EMPTY_FORM);
  const errors = result?.fieldErrors ?? {};
  const v = (key: string) => (errors[key] ? t(`compliance.schedules.validation.${errors[key]}`, { max: 50 }) : undefined);
  const [selected, setSelected] = useState<string[]>(values.spaceIds);
  const [cadence, setCadence] = useState(values.cadence);
  const [rule, setRule] = useState(values.periodRule);
  const flat = flattenSpaces(spaces);
  const toggle = (id: string) => setSelected((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));
  const title = schedule ? t("compliance.schedules.editTitle") : t("compliance.schedules.new");
  return (
    <>
      <PageHeader title={title} crumb={t("compliance.schedules.title")} />
      {result?.error && (
        <div className="mb-3">
          <Alert tone="danger">{errorText(t, result.error)}</Alert>
        </div>
      )}
      <Form method="post" className="flex max-w-3xl flex-col gap-4">
        <CsrfField />
        <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
        {schedule && <input type="hidden" name="version" value={schedule.version} />}
        <Card title={t("compliance.schedules.basics")}>
          <div className="flex flex-col gap-3">
            <TextField label={t("compliance.schedules.name")} name="name" defaultValue={values.name} maxLength={100} error={v("name")} required />
            <SelectField label={t("compliance.reports.type")} name="type" defaultValue={values.type} error={v("type")}>
              {REPORT_TYPES.map((type) => (
                <option key={type} value={type} disabled={!SUPPORTED_REPORT_TYPES.includes(type)}>
                  {t(`compliance.reports.types.${type}`)}
                </option>
              ))}
            </SelectField>
            <TextField label={t("compliance.reports.wizard.title")} name="title" defaultValue={values.title} maxLength={200} hint={t("compliance.reports.wizard.titleHint")} error={v("title")} />
          </div>
        </Card>
        <Card title={t("compliance.reports.wizard.step2")}>
          <fieldset className="flex flex-col gap-1">
            <legend className="text-[12.5px] font-medium text-muted">{t("compliance.reports.wizard.spaces")}</legend>
            {selected.map((id) => (
              <input key={id} type="hidden" name="spaceIds" value={id} />
            ))}
            {spacesFailed && <Alert tone="warning">{t("compliance.reports.wizard.spacesFailed")}</Alert>}
            <div className="max-h-56 overflow-y-auto rounded-md border border-line p-2">
              {flat.map((s) => (
                <label key={s.id} className="flex items-center gap-2 py-0.5 text-[13px]" style={{ paddingLeft: (s.depth - 1) * 14 }}>
                  <input type="checkbox" checked={selected.includes(s.id)} disabled={s.node.accessible === false} onChange={() => toggle(s.id)} aria-label={s.path.join(" › ")} />
                  {s.name}
                </label>
              ))}
            </div>
            <p className="text-[12px] text-muted">{t("compliance.reports.wizard.spacesHint", { n: selected.length })}</p>
            {v("spaceIds") && <p className="text-[11.5px] text-bad-ink">{v("spaceIds")}</p>}
          </fieldset>
          <div className="mt-3">
            <SelectField label={t("compliance.reports.wizard.facility")} name="facilityType" defaultValue={values.facilityType} error={v("facilityType")}>
              <option value="">{t("compliance.reports.wizard.facilityAuto")}</option>
              {FACILITY_TYPES.map((f) => (
                <option key={f} value={f}>
                  {t(`compliance.facility.${f}`)}
                </option>
              ))}
            </SelectField>
          </div>
        </Card>
        <Card title={t("compliance.schedules.timing")}>
          <div className="flex flex-wrap items-end gap-3">
            <SelectField
              label={t("compliance.schedules.cadence")}
              name="cadence"
              value={cadence}
              onChange={(e) => {
                setCadence(e.target.value);
                setRule(e.target.value === "QUARTERLY" ? "PREVIOUS_QUARTER" : "PREVIOUS_MONTH");
              }}
              error={v("cadence")}
            >
              {CADENCES.map((c) => (
                <option key={c} value={c}>
                  {t(`compliance.schedules.cadences.${c}`)}
                </option>
              ))}
            </SelectField>
            <TextField type="number" label={t("compliance.schedules.day")} name="dayOfPeriod" defaultValue={values.dayOfPeriod} min={1} max={28} error={v("dayOfPeriod")} />
            <TextField type="time" label={t("compliance.schedules.time")} name="publishTime" defaultValue={values.publishTime} error={v("publishTime")} />
            <SelectField label={t("compliance.schedules.periodRule")} name="periodRule" value={rule} onChange={(e) => setRule(e.target.value)} error={v("periodRule")}>
              {PERIOD_RULES.map((r) => (
                <option key={r} value={r}>
                  {t(`compliance.schedules.periodRules.${r}`)}
                </option>
              ))}
            </SelectField>
          </div>
          <p className="mt-2 text-[12px] text-muted">{t(`compliance.schedules.dayHint.${cadence === "QUARTERLY" ? "QUARTERLY" : "MONTHLY"}`, { timezone })}</p>
        </Card>
        <Card title={t("compliance.schedules.recipients")}>
          <fieldset className="flex flex-col gap-1">
            <legend className="text-[12.5px] font-medium text-muted">{t("compliance.schedules.users")}</legend>
            {!usersAvailable && <Alert tone="warning">{t("compliance.schedules.usersFailed")}</Alert>}
            <div className="max-h-48 overflow-y-auto rounded-md border border-line p-2">
              {users.map((u) => (
                <label key={u.id} className="flex items-center gap-2 py-0.5 text-[13px]">
                  <input type="checkbox" name="userIds" value={u.id} defaultChecked={values.userIds.includes(u.id)} />
                  {u.name}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="mt-3">
            <TextArea label={t("compliance.schedules.emails")} name="emails" defaultValue={values.emails} rows={2} />
            <p className="mt-1 text-[12px] text-muted">{t("compliance.schedules.emailsHint")}</p>
          </div>
          {v("recipients") && <p className="text-[11.5px] text-bad-ink">{v("recipients")}</p>}
        </Card>
        <Card title={t("compliance.schedules.output")}>
          <fieldset className="flex flex-col gap-1.5">
            <legend className="sr-only">{t("compliance.schedules.format")}</legend>
            {SCHEDULE_FORMATS.map((f) => (
              <label key={f} className="flex items-center gap-2 text-[13px]">
                <input type="radio" name="format" value={f} defaultChecked={values.format === f} />
                {t(`compliance.schedules.formats.${f}`)}
              </label>
            ))}
          </fieldset>
          <div className="mt-3">
            <Checkbox name="enabled" value="true" defaultChecked={values.enabled} label={t("compliance.schedules.enabled")} />
          </div>
        </Card>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" name="intent" value="save" variant="primary" disabled={navigation.state === "submitting"}>
            {t("common.save")}
          </Button>
          <ButtonLink to="/compliance/reports/schedules">{t("common.cancel")}</ButtonLink>
          {schedule && (
            <Button type="submit" name="intent" value="delete" variant="danger" formNoValidate>
              {t("common.delete")}
            </Button>
          )}
        </div>
      </Form>
    </>
  );
}
