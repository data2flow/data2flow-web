/**
 * UI-ING-05 재처리 작업(`/ingest/reprocess`, ING-01.04, SCR-03.06). 권한 INGEST_REPROCESS(INTEGRATOR·ADMIN).
 * API: 소스 API-DSC-01, 기기 API-DEV-01(소스로 거르기), 작업 목록 API-ING-14. 미리 보기·생성·취소는 브라우저에서 BFF로(API-ING-09·10·12).
 * 미리 채움 `?sourceId=&deviceIds=1,2&from=&to=&memo=`(스크립트 배포 뒤 [지난 데이터 재처리], API-SCR-05 reprocessSuggestion)
 */
import { useTranslation } from "react-i18next";
import { useRouteLoaderData } from "react-router";
import { callList } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { PageHeader } from "~/components/ui";
import { IngestAreaTabs } from "~/features/ingest/area-tabs";
import { reprocessApi } from "~/features/ingest/m5-api";
import type { ReprocessJob } from "~/features/ingest/model/m5";
import { ReprocessView } from "~/features/ingest/reprocess";
import { hasAny } from "~/lib/permissions";
import type { RootData } from "~/root";
import type { Route } from "./+types/ingest-reprocess";

export function meta() {
  return [{ title: "data2flow" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = bff(context);
  const url = new URL(request.url);
  const [sources, devices, jobs] = await Promise.all([
    callList<{ id: string | number; name: string }>(ctx, request, "/api/v1/core/sources?size=100"),
    callList<{ id: string | number; name: string; source?: { id: string | number } | null }>(ctx, request, "/api/v1/core/devices?size=100&sort=name"),
    callList<ReprocessJob>(ctx, request, "/api/v1/core/ingest/reprocess-jobs?page=1&size=20"),
  ]);
  const deviceIds = (url.searchParams.get("deviceIds") ?? "")
    .split(",")
    .map((d) => d.trim())
    .filter((d) => /^\d+$/.test(d));
  return {
    sources: sources.ok ? sources.list.responses.map((s) => ({ id: String(s.id), name: s.name })) : [],
    devices: devices.ok ? devices.list.responses.map((d) => ({ id: String(d.id), name: d.name, sourceId: d.source?.id == null ? null : String(d.source.id) })) : [],
    jobs: jobs.ok ? jobs.list.responses.map((j) => ({ ...j, jobId: String(j.jobId) })) : [],
    jobsFailed: !jobs.ok,
    prefill: { sourceId: url.searchParams.get("sourceId"), deviceIds, from: url.searchParams.get("from"), to: url.searchParams.get("to"), memo: url.searchParams.get("memo") },
    nowMs: ctx.runtime.now(),
  };
}

export default function IngestReprocess({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const root = useRouteLoaderData("root") as RootData | undefined;
  return (
    <>
      <PageHeader crumb={t("ingest.crumb")} title={t("ingest.reprocess.title")} />
      <IngestAreaTabs current="reprocess" />
      {loaderData.jobsFailed && <p className="mb-2 text-[12.5px] text-warn">{t("ingest.reprocess.jobsFailed")}</p>}
      <ReprocessView
        sources={loaderData.sources}
        devices={loaderData.devices}
        jobs={loaderData.jobs}
        prefill={loaderData.prefill}
        canWrite={hasAny(root?.me?.permissions, ["INGEST_REPROCESS"])}
        timezone={root?.timezone ?? "Asia/Seoul"}
        nowMs={loaderData.nowMs}
        api={reprocessApi}
      />
    </>
  );
}
