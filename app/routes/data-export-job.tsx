/**
 * 정기 내보내기 메일 링크(`/data/exports/{jobId}`, design/api/TSD-api.md §API-TSD-23 "웹 경로", TSD-04.03·07.02).
 * 로그인 뒤 그 작업 하나를 보여 주고, 진행 중이면 5초마다 그 작업만 다시 읽는다. 다운로드는 서명 주소를 BFF 경로로 바꿔 연다(API-TSD-21).
 */
import { useTranslation } from "react-i18next";
import { data, Link, useRouteLoaderData } from "react-router";
import { callApi } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { PageHeader } from "~/components/ui";
import { ExportJobsPanel } from "~/features/data/components/exports-panels";
import type { ExportJob } from "~/features/data/model/exports";
import type { RootData } from "~/root";
import type { Route } from "./+types/data-export-job";

export function meta() {
  return [{ title: "data2flow" }];
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const ctx = bff(context);
  const job = await callApi<ExportJob>(ctx, request, `/api/v1/core/exports/${encodeURIComponent(params.exportId)}`);
  if (!job.ok) throw data(null, { status: job.status === 403 ? 403 : 404 });
  return { job: job.data };
}

export default function DataExportJob({ loaderData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const root = useRouteLoaderData("root") as RootData | undefined;
  const { job } = loaderData;
  return (
    <>
      <PageHeader
        crumb={t("explore.crumb")}
        title={t("data.jobs.title")}
        actions={
          <Link to="/exports?tab=jobs" className="text-accent hover:underline">
            {t("data.jobs.allJobs")}
          </Link>
        }
      />
      <ExportJobsPanel initial={[job]} only={job.id} timezone={root?.timezone ?? "Asia/Seoul"} lang={i18n.language} />
    </>
  );
}
