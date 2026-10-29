/**
 * UI-CMP-07 새 리포트 마법사(`/compliance/reports/new`, CMP-02.02). CMP_REPORT(OPERATOR·ANALYST+)만.
 * 1 유형 → 2 대상(공간 여러 개, 시설 유형) → 3 기간(최대 400일, 미래 불가, 조직 시간대) → 4 옵션. 한 화면에 단계로 나눠 보여 준다.
 * [미리 보기 생성]은 API-CMP-16(202)을 부르고 리포트 화면(UI-CMP-08)으로 가서 진행률을 본다.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Form, data, redirect, useNavigation } from "react-router";
import { callApi, field, newIdempotencyKey, requirePermission } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { getMe } from "~/bff/user.server";
import { Alert, Button, ButtonLink, Card, Checkbox, CsrfField, PageHeader, SelectField, TextField } from "~/components/ui";
import { FACILITY_TYPES, previousMonth, REPORT_TYPES, reportBody, SUPPORTED_REPORT_TYPES, validateReportForm, type ReportCreated, type ReportForm } from "~/features/compliance/model/reports";
import { todayIn } from "~/features/compliance/model/status";
import { errorText } from "~/lib/error-text";
import { resolveTimezone } from "~/lib/format";
import { flattenSpaces, type SpaceNode } from "~/lib/spaces";
import type { Route } from "./+types/compliance-report-new";

export function meta() {
  return [{ title: "data2flow" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = bff(context);
  const me = await getMe(ctx, request);
  requirePermission(me.ok ? me.data.permissions : [], "CMP_REPORT");
  const timezone = resolveTimezone(me.ok ? me.data.timezone : undefined);
  const spaces = await callApi<SpaceNode[]>(ctx, request, "/api/v1/core/spaces");
  const today = todayIn(timezone);
  return { spaces: spaces.ok ? spaces.data : [], spacesFailed: !spaces.ok, timezone, today, defaults: previousMonth(today), idempotencyKey: newIdempotencyKey() };
}

type ActionResult = { fieldErrors?: Record<string, string>; error?: { code: string; message?: string }; values: ReportForm };

/** 서버 오류 코드를 고칠 단계의 필드로 */
const FIELD_OF: Record<string, [string, string]> = {
  CMP_PROFILE_NOT_APPLIED: ["spaceIds", "profileNotApplied"],
  CMP_VIRTUAL_DATA_NOT_ALLOWED: ["spaceIds", "virtualOnly"],
  SPACE_NOT_FOUND: ["spaceIds", "spaceRequired"],
  CMP_FACILITY_TYPE_REQUIRED: ["facilityType", "facilityRequired"],
  CMP_REPORT_PERIOD_INVALID: ["period", "periodTooLong"],
};

export async function action({ request, context }: Route.ActionArgs) {
  const ctx = bff(context);
  const form = await request.formData();
  const me = await getMe(ctx, request);
  const values: ReportForm = {
    type: field(form, "type"),
    title: field(form, "title"),
    spaceIds: form.getAll("spaceIds").filter((v): v is string => typeof v === "string" && v !== ""),
    facilityType: field(form, "facilityType"),
    periodFrom: field(form, "periodFrom"),
    periodTo: field(form, "periodTo"),
    includeRawCsv: field(form, "includeRawCsv") === "true",
    includeActions: field(form, "includeActions") === "true",
    branding: field(form, "branding") === "true",
  };
  const fieldErrors = validateReportForm(values, todayIn(resolveTimezone(me.ok ? me.data.timezone : undefined)));
  if (Object.keys(fieldErrors).length) return data<ActionResult>({ fieldErrors, values }, { status: 400 });
  const result = await callApi<ReportCreated>(ctx, request, "/api/v1/core/compliance/reports", {
    method: "POST",
    body: reportBody(values),
    idempotencyKey: field(form, "idempotencyKey") || newIdempotencyKey(),
  });
  if (result.ok) throw redirect(`/compliance/reports/${result.data.reportId}?rev=${result.data.revisionNo}`);
  const mapped = FIELD_OF[result.code];
  return data<ActionResult>({ values, error: mapped ? undefined : { code: result.code, message: result.message }, fieldErrors: mapped ? { [mapped[0]]: mapped[1] } : undefined }, { status: result.status });
}

export default function ComplianceReportNew({ loaderData, actionData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const { spaces, spacesFailed, timezone, today, defaults, idempotencyKey } = loaderData;
  const result = actionData as ActionResult | undefined;
  const values = result?.values;
  const errors = result?.fieldErrors ?? {};
  const [type, setType] = useState(values?.type ?? "KR_SELF_CHECK");
  const [selected, setSelected] = useState<string[]>(values?.spaceIds ?? []);
  const flat = flattenSpaces(spaces);
  const toggle = (id: string) => setSelected((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));
  const v = (key: string) => (errors[key] ? t(`compliance.reports.validation.${errors[key]}`) : undefined);
  return (
    <>
      <PageHeader title={t("compliance.reports.new")} crumb={t("compliance.reports.title")} />
      {result?.error && (
        <div className="mb-3">
          <Alert tone="danger">{errorText(t, result.error)}</Alert>
        </div>
      )}
      <Form method="post" className="flex max-w-3xl flex-col gap-4">
        <CsrfField />
        <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
        <Card title={t("compliance.reports.wizard.step1")}>
          <fieldset className="flex flex-col gap-2">
            <legend className="sr-only">{t("compliance.reports.type")}</legend>
            {REPORT_TYPES.map((value) => {
              const supported = SUPPORTED_REPORT_TYPES.includes(value);
              return (
                <label key={value} className="flex items-center gap-2 text-[13px]">
                  <input type="radio" name="type" value={value} checked={type === value} disabled={!supported} onChange={() => setType(value)} />
                  {t(`compliance.reports.types.${value}`)}
                  {!supported && <span className="text-[12px] text-muted">{t("compliance.reports.wizard.soon")}</span>}
                </label>
              );
            })}
            {v("type") && <p className="text-[11.5px] text-bad-ink">{v("type")}</p>}
          </fieldset>
          <div className="mt-3">
            <TextField label={t("compliance.reports.wizard.title")} name="title" defaultValue={values?.title ?? ""} maxLength={200} hint={t("compliance.reports.wizard.titleHint")} error={v("title")} />
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
          {type === "KR_SELF_CHECK" && (
            <div className="mt-3">
              <SelectField label={t("compliance.reports.wizard.facility")} name="facilityType" defaultValue={values?.facilityType ?? ""} error={v("facilityType")}>
                <option value="">{t("compliance.reports.wizard.facilityAuto")}</option>
                {FACILITY_TYPES.map((f) => (
                  <option key={f} value={f}>
                    {t(`compliance.facility.${f}`)}
                  </option>
                ))}
              </SelectField>
            </div>
          )}
        </Card>
        <Card title={t("compliance.reports.wizard.step3")}>
          <div className="flex flex-wrap items-end gap-3">
            <TextField type="date" label={t("compliance.reports.wizard.from")} name="periodFrom" defaultValue={values?.periodFrom ?? defaults.from} max={today} />
            <TextField type="date" label={t("compliance.reports.wizard.to")} name="periodTo" defaultValue={values?.periodTo ?? defaults.to} max={today} />
          </div>
          <p className="mt-2 text-[12px] text-muted">{t("compliance.reports.wizard.periodHint", { timezone })}</p>
          {v("period") && <p className="text-[11.5px] text-bad-ink">{v("period")}</p>}
        </Card>
        <Card title={t("compliance.reports.wizard.step4")}>
          <div className="flex flex-col gap-2">
            <Checkbox name="includeActions" value="true" defaultChecked={values ? values.includeActions : true} label={t("compliance.reports.wizard.includeActions")} />
            <Checkbox name="includeRawCsv" value="true" defaultChecked={values?.includeRawCsv ?? false} label={t("compliance.reports.wizard.includeRawCsv")} />
            <Checkbox name="branding" value="true" defaultChecked={values?.branding ?? false} label={t("compliance.reports.wizard.branding")} />
          </div>
        </Card>
        <div className="flex gap-2">
          <Button type="submit" variant="primary" disabled={navigation.state === "submitting"}>
            {t("compliance.reports.wizard.submit")}
          </Button>
          <ButtonLink to="/compliance/reports">{t("common.cancel")}</ButtonLink>
        </div>
      </Form>
    </>
  );
}
