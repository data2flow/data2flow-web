/**
 * 월간 에너지 리포트(`/energy/reports?scope=`, ENE-01.05, UC-ENE-05). 조회 ENE_READ, 생성 ENE_ANALYZE.
 * 범위(포트폴리오·공간)와 달을 골라 만들면 생성 중(진행률)으로 보이고 3초마다 다시 읽는다. 다 되면 [PDF 받기].
 * 리포트 장: 지표, 기준선 대비, 상위 사용 공간, 절감 조치 결과(VERIFIED만).
 * API: API-ENE-13 생성·목록·파일, 공간 트리 API-DEV-01.
 */
import { useTranslation } from "react-i18next";
import { Form, Link, data, redirect, useRouteLoaderData } from "react-router";
import { callApi, callList, field } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { getMe } from "~/bff/user.server";
import { Alert, Badge, Button, Card, EmptyState, PageHeader, SelectField, Table, TextField } from "~/components/ui";
import { usePolling } from "~/features/compliance/components/report-views";
import { fileHref, lastMonth, needsPolling, validateReportMonth, type EnergyReport } from "~/features/energy/model/reports";
import { errorText } from "~/lib/error-text";
import { formatDateTime, resolveTimezone, zonedDate } from "~/lib/format";
import { hasAny } from "~/lib/permissions";
import { flattenSpaces, type SpaceNode } from "~/lib/spaces";
import type { RootData } from "~/root";
import type { Route } from "./+types/energy-reports";

export function meta() {
  return [{ title: "data2flow" }];
}

const STATUS_TONE = { GENERATING: "info", READY: "success", FAILED: "danger" } as const;

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = bff(context);
  const url = new URL(request.url);
  const scope = url.searchParams.get("scope") ?? "";
  const query = new URLSearchParams({ size: "20" });
  if (scope) query.set("scopeSpaceId", scope);
  const [me, spaces, reports] = await Promise.all([
    getMe(ctx, request),
    callApi<SpaceNode[]>(ctx, request, "/api/v1/core/spaces"),
    callList<EnergyReport>(ctx, request, `/api/v1/core/energy/reports?${query}`),
  ]);
  const timezone = resolveTimezone(me.ok ? me.data.timezone : undefined);
  const today = zonedDate(ctx.runtime.now(), timezone);
  return {
    scope,
    today,
    defaultMonth: lastMonth(today),
    timezone,
    spaces: spaces.ok ? flattenSpaces(spaces.data).map((s) => ({ id: s.id, name: s.name, depth: s.depth })) : [],
    reports: reports.ok ? reports.list.responses : [],
    failed: reports.ok ? null : { code: reports.code, message: reports.message },
  };
}

type ActionResult = { error?: { code: string; message?: string }; fieldErrors?: Record<string, string>; values?: { scopeSpaceId: string; month: string } };

export async function action({ request, context }: Route.ActionArgs) {
  const ctx = bff(context);
  const form = await request.formData();
  const values = { scopeSpaceId: field(form, "scopeSpaceId"), month: field(form, "month").trim() };
  const me = await getMe(ctx, request);
  const today = zonedDate(ctx.runtime.now(), resolveTimezone(me.ok ? me.data.timezone : undefined));
  const monthError = validateReportMonth(values.month, today);
  if (monthError) return data<ActionResult>({ fieldErrors: { month: monthError }, values }, { status: 400 });
  const result = await callApi<{ jobId: string; reportId: string }>(ctx, request, "/api/v1/core/energy/reports", {
    method: "POST",
    body: { scopeSpaceId: values.scopeSpaceId || null, month: values.month, format: "PDF" },
  });
  if (!result.ok) return data<ActionResult>({ error: { code: result.code, message: result.message }, values }, { status: result.status });
  throw redirect(`/energy/reports${values.scopeSpaceId ? `?scope=${encodeURIComponent(values.scopeSpaceId)}` : ""}`);
}

export default function EnergyReports({ loaderData, actionData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const root = useRouteLoaderData("root") as RootData | undefined;
  const canCreate = hasAny(root?.me?.permissions, ["ENE_ANALYZE"]);
  const { scope, spaces, reports, failed, defaultMonth } = loaderData;
  const timezone = root?.timezone ?? loaderData.timezone;
  const result = actionData as ActionResult | undefined;
  usePolling(needsPolling(reports));
  return (
    <>
      <PageHeader title={t("energy.reports.title")} crumb={<Link to={scope ? `/energy?scope=${encodeURIComponent(scope)}` : "/energy"}>{t("nav.energy")}</Link>} />
      {canCreate && (
        <Card title={t("energy.reports.create")}>
          <Form method="post" className="flex flex-wrap items-end gap-3 p-3">
            <SelectField label={t("energy.dashboard.scope")} name="scopeSpaceId" defaultValue={result?.values?.scopeSpaceId ?? scope}>
              <option value="">{t("energy.dashboard.portfolio")}</option>
              {spaces.map((s) => (
                <option key={s.id} value={s.id}>
                  {`${"  ".repeat(Math.max(0, s.depth - 1))}${s.name}`}
                </option>
              ))}
            </SelectField>
            <TextField label={t("energy.reports.month")} type="month" name="month" defaultValue={result?.values?.month ?? defaultMonth} error={result?.fieldErrors?.month ? t(`energy.reports.errors.${result.fieldErrors.month}`) : undefined} />
            <Button type="submit" variant="primary">
              {t("energy.reports.generate")}
            </Button>
          </Form>
          <p className="px-3 pb-3 text-[12px] text-muted">{t("energy.reports.hint")}</p>
        </Card>
      )}
      {result?.error && (
        <div className="mt-3">
          <Alert tone="danger">{errorText(t, result.error)}</Alert>
        </div>
      )}
      <div className="mt-4">
        {failed ? (
          <Alert tone="warning">{errorText(t, failed)}</Alert>
        ) : reports.length === 0 ? (
          <EmptyState title={t("energy.reports.empty")} />
        ) : (
          <Card>
            <Table>
              <thead>
                <tr>
                  <th>{t("energy.reports.columns.scope")}</th>
                  <th>{t("energy.reports.columns.month")}</th>
                  <th>{t("energy.reports.columns.status")}</th>
                  <th>{t("energy.reports.columns.createdBy")}</th>
                  <th>{t("energy.reports.columns.createdAt")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {reports.map((r) => (
                  <tr key={r.reportId} data-report={r.reportId}>
                    <td>{r.scopeName ?? t("energy.dashboard.portfolio")}</td>
                    <td>{r.month}</td>
                    <td>
                      <Badge tone={STATUS_TONE[r.status]}>{r.status === "GENERATING" ? t("energy.reports.generating", { progress: r.progress }) : t(`energy.reports.statuses.${r.status}`)}</Badge>
                      {r.status === "FAILED" && r.failureReason && <span className="ml-2 text-[12px] text-muted">{t(`energy.reports.failures.${r.failureReason}`, { defaultValue: r.failureReason })}</span>}
                    </td>
                    <td>{r.createdBy?.name ?? "–"}</td>
                    <td className="whitespace-nowrap">{formatDateTime(r.createdAt, timezone, i18n.language)}</td>
                    <td>
                      {r.status === "READY" && r.fileUrl && (
                        <a href={fileHref(r.fileUrl) ?? undefined} className="text-accent hover:underline" download>
                          {t("energy.reports.download")}
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        )}
      </div>
    </>
  );
}
