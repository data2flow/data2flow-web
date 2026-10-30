/**
 * UI-ANA-09 데이터셋 상세(`/analytics/datasets/{datasetId}`, UC-ANA-11, ANA-10.01). 조회 ANALYTICS_READ, 이름 바꾸기·지우기·최신 버전으로 올리기 ANALYTICS_RUN.
 * API: API-ANA-20 상세·버전 이력·upgrade-dataset. 분석 목록에는 데이터셋이 없어 분석 상세(API-ANA-07, `datasetId`·`datasetVersion`)를 읽어 이 데이터셋을 쓰는 분석을 찾는다(최대 50건).
 */
import { useTranslation } from "react-i18next";
import { useRouteLoaderData } from "react-router";
import { callApi, callList, orThrow } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { PageHeader } from "~/components/ui";
import type { Dataset, DatasetVersion } from "~/features/analytics/admin-api";
import { AnalyticsAreaTabs } from "~/features/analytics/components/area-tabs";
import { DatasetDetail, type DatasetUsage } from "~/features/analytics/components/datasets";
import type { Analysis, AnalysisSummary } from "~/features/analytics/model/types";
import { hasAny } from "~/lib/permissions";
import type { RootData } from "~/root";
import type { Route } from "./+types/analytics-dataset-detail";

export function meta() {
  return [{ title: "data2flow" }];
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const ctx = bff(context);
  const id = encodeURIComponent(params.datasetId);
  const [dataset, versions, analyses] = await Promise.all([
    callApi<Dataset>(ctx, request, `/api/v1/core/analytics/datasets/${id}`),
    callList<DatasetVersion>(ctx, request, `/api/v1/core/analytics/datasets/${id}/versions?size=50`),
    callList<AnalysisSummary>(ctx, request, "/api/v1/core/analytics/analyses?owner=all&size=50"),
  ]);
  const found = orThrow(dataset);
  const details = analyses.ok
    ? await Promise.all(analyses.list.responses.map((a) => callApi<Analysis & { datasetId?: string | null; datasetVersion?: number | null }>(ctx, request, `/api/v1/core/analytics/analyses/${encodeURIComponent(String(a.analysisId ?? a.id))}`)))
    : [];
  const usage: DatasetUsage[] = details.flatMap((d) => (d.ok && d.data && String(d.data.datasetId ?? "") === String(found.datasetId) ? [{ analysisId: String(d.data.analysisId), name: d.data.name, datasetVersion: d.data.datasetVersion ?? null }] : []));
  return { dataset: { ...found, datasetId: String(found.datasetId) }, versions: versions.ok ? versions.list.responses : [], usage };
}

export default function AnalyticsDatasetDetail({ loaderData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const root = useRouteLoaderData("root") as RootData | undefined;
  return (
    <>
      <PageHeader crumb={t("analytics.datasets.title")} title={loaderData.dataset.name} />
      <AnalyticsAreaTabs current="datasets" />
      <DatasetDetail
        dataset={loaderData.dataset}
        versions={loaderData.versions}
        usage={loaderData.usage}
        canEdit={hasAny(root?.me?.permissions, ["ANALYTICS_RUN"])}
        timezone={root?.timezone ?? "Asia/Seoul"}
        lang={i18n.language}
      />
    </>
  );
}
