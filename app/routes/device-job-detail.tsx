/**
 * UI-DEV-12 일괄 작업 상세(`/device-jobs/{id}`, DEV-02.09): 진행률, 기기별 결과(실패만 보기), 실패분 다시 실행(API-DEV-73), 취소(API-DEV-74).
 * API: API-DEV-72 상세·항목. 진행 중이면 화면에서 3초마다 다시 읽는다.
 */
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useRouteLoaderData } from "react-router";
import { callApi, callList, orThrow } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { PageHeader } from "~/components/ui";
import { DeviceAreaTabs } from "~/features/devices/area-tabs";
import { JobDetail } from "~/features/devices/device-jobs";
import type { DeviceJob, DeviceJobItem } from "~/features/devices/model/jobs";
import { hasAny } from "~/lib/permissions";
import type { RootData } from "~/root";
import type { Route } from "./+types/device-job-detail";

export function meta() {
  return [{ title: "data2flow" }];
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const ctx = bff(context);
  const id = encodeURIComponent(params.jobId);
  const [job, items] = await Promise.all([callApi<DeviceJob>(ctx, request, `/api/v1/core/device-jobs/${id}`), callList<DeviceJobItem>(ctx, request, `/api/v1/core/device-jobs/${id}/items?size=100`)]);
  return { job: orThrow(job), items: items.ok ? items.list.responses : [] };
}

export default function DeviceJobDetail({ loaderData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const root = useRouteLoaderData("root") as RootData | undefined;
  const navigate = useNavigate();
  const { job, items } = loaderData;
  return (
    <>
      <PageHeader
        crumb={
          <Link to="/device-jobs" className="hover:underline">
            {t("devices.jobs.title")}
          </Link>
        }
        title={`#${job.id}`}
      />
      <DeviceAreaTabs current="jobs" />
      <JobDetail
        key={`${job.id}`}
        initial={job}
        initialItems={items}
        canAdmin={hasAny(root?.me?.permissions, ["DEV_ADMIN"])}
        timezone={root?.timezone ?? "Asia/Seoul"}
        lang={i18n.language}
        onRetried={(next) => navigate(`/device-jobs/${encodeURIComponent(next.id)}`)}
      />
    </>
  );
}
