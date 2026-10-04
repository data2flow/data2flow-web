/**
 * UI-TSD-03 데이터 가져오기 목록(`/imports`, TSD-04.02): 작업(출처, 기간, 상태, 결과, 출처 라벨, 실행 시각). TS_IMPORT(ADMIN·INTEGRATOR).
 * API: API-TSD-31 목록(`GET /core/imports`).
 */
import { useTranslation } from "react-i18next";
import { Link, useRouteLoaderData } from "react-router";
import { callList } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { Alert, Badge, ButtonLink, Card, EmptyState, PageHeader, Pager, Table } from "~/components/ui";
import { importTone, type ImportJob } from "~/features/data/model/imports";
import { formatDateTime, formatNumber } from "~/lib/format";
import type { RootData } from "~/root";
import type { Route } from "./+types/imports";

export function meta() {
  return [{ title: "data2flow" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = bff(context);
  const page = Math.max(1, Number(new URL(request.url).searchParams.get("page")) || 1);
  const jobs = await callList<ImportJob>(ctx, request, `/api/v1/core/imports?page=${page}&size=20`);
  return { jobs: jobs.ok ? jobs.list.responses : [], totalPages: jobs.ok ? jobs.list.totalPages : 1, page, failed: !jobs.ok };
}

export default function Imports({ loaderData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const root = useRouteLoaderData("root") as RootData | undefined;
  const timezone = root?.timezone ?? "Asia/Seoul";
  const { jobs, failed, page, totalPages } = loaderData;
  return (
    <>
      <PageHeader
        crumb={t("explore.crumb")}
        title={t("data.imports.title")}
        actions={
          <ButtonLink to="/imports/new" variant="primary">
            {t("data.imports.new")}
          </ButtonLink>
        }
      />
      <Card>
        {failed && <Alert tone="warning">{t("data.common.loadFailed")}</Alert>}
        {jobs.length === 0 && !failed ? (
          <EmptyState title={t("data.imports.empty")} body={t("data.imports.emptyBody")} />
        ) : (
          <Table>
            <thead>
              <tr>
                <th>{t("data.imports.originLabel")}</th>
                <th>{t("data.imports.sourceKind")}</th>
                <th>{t("data.retention.period")}</th>
                <th>{t("data.common.status")}</th>
                <th>{t("data.imports.result")}</th>
                <th>{t("data.jobs.createdAt")}</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.id}>
                  <td>
                    <Link to={`/imports/${encodeURIComponent(job.id)}`} className="text-accent hover:underline">
                      {job.originLabel || `#${job.id}`}
                    </Link>
                  </td>
                  <td>{t(`data.imports.kinds.${job.sourceKind}`)}</td>
                  <td>{job.rangeFrom && job.rangeTo ? `${formatDateTime(job.rangeFrom, timezone, i18n.language)} ~ ${formatDateTime(job.rangeTo, timezone, i18n.language)}` : "–"}</td>
                  <td>
                    <Badge tone={importTone(job.status)}>{t(`data.imports.statuses.${job.status}`, { defaultValue: job.status })}</Badge>
                  </td>
                  <td className="text-[12.5px]">{t("data.imports.resultLine", { inserted: formatNumber(job.inserted ?? 0, i18n.language), skipped: formatNumber(job.skippedDuplicate ?? 0, i18n.language), failed: formatNumber(job.failed ?? 0, i18n.language) })}</td>
                  <td>{formatDateTime(job.createdAt, timezone, i18n.language)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <Pager page={page} totalPages={totalPages} />
      </Card>
    </>
  );
}
