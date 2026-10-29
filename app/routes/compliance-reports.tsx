/**
 * UI-CMP-07 리포트 목록(`/compliance/reports?type=&status=&page=`, CMP-02.02). 조회 CMP_READ(VIEWER+), [새 리포트]는 CMP_REPORT.
 * 생성 중인 판이 있으면 3초마다 다시 읽는다(API-CMP-17 폴링).
 * API: 목록 API-CMP-17.
 */
import { useTranslation } from "react-i18next";
import { Form, Link, useRouteLoaderData, useSearchParams } from "react-router";
import { callList } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { getMe } from "~/bff/user.server";
import { Alert, Button, ButtonLink, Card, EmptyState, PageHeader, Pager, SelectField, Table } from "~/components/ui";
import { ReportStatusBadge, usePolling } from "~/features/compliance/components/report-views";
import { needsPolling, REPORT_STATUSES, REPORT_TYPES, type Report } from "~/features/compliance/model/reports";
import { errorText } from "~/lib/error-text";
import { formatDate, resolveTimezone } from "~/lib/format";
import { hasAny } from "~/lib/permissions";
import type { RootData } from "~/root";
import type { Route } from "./+types/compliance-reports";

export function meta() {
  return [{ title: "data2flow" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = bff(context);
  const url = new URL(request.url);
  const query = new URLSearchParams({ size: "20" });
  for (const key of ["type", "status", "page"]) {
    const value = url.searchParams.get(key);
    if (value) query.set(key, value);
  }
  const [reports, me] = await Promise.all([callList<Report>(ctx, request, `/api/v1/core/compliance/reports?${query}`), getMe(ctx, request)]);
  return {
    reports: reports.ok ? reports.list.responses : [],
    page: reports.ok ? (reports.list.page ?? 1) : 1,
    totalPages: reports.ok ? reports.list.totalPages : undefined,
    failed: reports.ok ? null : { code: reports.code, message: reports.message },
    timezone: resolveTimezone(me.ok ? me.data.timezone : undefined),
  };
}

export default function ComplianceReports({ loaderData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const root = useRouteLoaderData("root") as RootData | undefined;
  const [params] = useSearchParams();
  const canReport = hasAny(root?.me?.permissions, ["CMP_REPORT"]);
  const { reports, page, totalPages, failed } = loaderData;
  const timezone = root?.timezone ?? loaderData.timezone;
  usePolling(needsPolling(reports.map((r) => r.latest)));
  return (
    <>
      <PageHeader
        title={t("compliance.reports.title")}
        crumb={t("nav.compliance")}
        actions={
          canReport && (
            <ButtonLink to="/compliance/reports/new" variant="primary">
              {t("compliance.reports.new")}
            </ButtonLink>
          )
        }
      />
      <Form method="get" className="mb-4 flex flex-wrap items-end gap-3">
        <SelectField label={t("compliance.reports.type")} name="type" defaultValue={params.get("type") ?? ""}>
          <option value="">{t("common.all")}</option>
          {REPORT_TYPES.map((type) => (
            <option key={type} value={type}>
              {t(`compliance.reports.types.${type}`)}
            </option>
          ))}
        </SelectField>
        <SelectField label={t("compliance.reports.statusLabel")} name="status" defaultValue={params.get("status") ?? ""}>
          <option value="">{t("common.all")}</option>
          {REPORT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`compliance.reports.status.${s}`)}
            </option>
          ))}
        </SelectField>
        <Button type="submit">{t("common.filter")}</Button>
      </Form>
      {failed ? (
        <Alert tone="warning">{errorText(t, failed)}</Alert>
      ) : reports.length === 0 ? (
        <EmptyState
          title={t("compliance.reports.empty")}
          body={t("compliance.reports.emptyBody")}
          action={
            canReport && (
              <ButtonLink to="/compliance/reports/new" variant="primary">
                {t("compliance.reports.new")}
              </ButtonLink>
            )
          }
        />
      ) : (
        <Card>
          <Table>
            <thead>
              <tr>
                <th>{t("compliance.reports.col.title")}</th>
                <th>{t("compliance.reports.col.type")}</th>
                <th>{t("compliance.reports.col.period")}</th>
                <th>{t("compliance.reports.col.revision")}</th>
                <th>{t("compliance.reports.col.status")}</th>
                <th>{t("compliance.reports.col.published")}</th>
              </tr>
            </thead>
            <tbody>
              {reports.map((r) => (
                <tr key={r.reportId}>
                  <td>
                    <Link className="text-accent hover:underline" to={`/compliance/reports/${r.reportId}`}>
                      {r.title}
                    </Link>
                  </td>
                  <td>{t(`compliance.reports.types.${r.type}`, { defaultValue: r.type })}</td>
                  <td className="whitespace-nowrap">
                    {r.periodFrom} ~ {r.periodTo}
                  </td>
                  <td>{r.latest ? `r${r.latest.revisionNo}` : "–"}</td>
                  <td>
                    <ReportStatusBadge revision={r.latest} />
                  </td>
                  <td className="whitespace-nowrap">
                    {r.latest?.publishedAt ? `${formatDate(r.latest.publishedAt, timezone, i18n.language)}${r.latest.publishedBy?.name ? ` · ${r.latest.publishedBy.name}` : ""}` : "–"}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pager page={page} totalPages={totalPages} />
        </Card>
      )}
    </>
  );
}
