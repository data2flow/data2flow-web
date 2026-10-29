/**
 * UI-ANA-09 데이터셋 목록(`/analytics/datasets`, UC-ANA-11, ANA-10.01). 조회 ANALYTICS_READ(V 이상), 만들기 ANALYTICS_RUN(A 이상).
 * API: API-ANA-20 목록, 새 데이터셋의 바인딩을 가져올 분석 목록 API-ANA-07.
 */
import { useTranslation } from "react-i18next";
import { useRouteLoaderData } from "react-router";
import { callList } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { PageHeader } from "~/components/ui";
import type { DatasetSummary } from "~/features/analytics/admin-api";
import { AnalyticsAreaTabs } from "~/features/analytics/components/area-tabs";
import { DatasetList } from "~/features/analytics/components/datasets";
import type { AnalysisSummary } from "~/features/analytics/model/types";
import { hasAny } from "~/lib/permissions";
import type { RootData } from "~/root";
import type { Route } from "./+types/analytics-datasets";

export function meta() {
  return [{ title: "data2flow" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = bff(context);
  const [datasets, analyses] = await Promise.all([
    callList<DatasetSummary>(ctx, request, "/api/v1/core/analytics/datasets?size=100"),
    callList<AnalysisSummary>(ctx, request, "/api/v1/core/analytics/analyses?owner=all&size=100"),
  ]);
  return {
    datasets: datasets.ok ? datasets.list.responses.map((d) => ({ ...d, datasetId: String(d.datasetId) })) : [],
    failed: datasets.ok ? null : { code: datasets.code, message: datasets.message },
    analyses: analyses.ok ? analyses.list.responses.map((a) => ({ id: String(a.analysisId ?? a.id), name: a.name })) : [],
  };
}

export default function AnalyticsDatasets({ loaderData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const root = useRouteLoaderData("root") as RootData | undefined;
  return (
    <>
      <PageHeader crumb={t("analytics.crumb")} title={t("analytics.datasets.title")} />
      <AnalyticsAreaTabs current="datasets" />
      <DatasetList
        initial={loaderData.datasets}
        failed={loaderData.failed}
        analyses={loaderData.analyses}
        canEdit={hasAny(root?.me?.permissions, ["ANALYTICS_RUN"])}
        timezone={root?.timezone ?? "Asia/Seoul"}
        lang={i18n.language}
      />
    </>
  );
}
