/**
 * 분석 상세(`/analytics/{analysisId}`): 실행이 있으면 가장 최근 실행 결과(UI-ANA-05)로 보내고, 없으면 [실행] 안내.
 */
import { useTranslation } from "react-i18next";
import { redirect, useRouteLoaderData } from "react-router";
import { callApi, callList, orThrow } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { PageHeader } from "~/components/ui";
import { defaultAnalyticsApi } from "~/features/analytics/api";
import { AnalysisEmpty } from "~/features/analytics/components/analyses-list";
import { AnalyticsAreaTabs } from "~/features/analytics/components/area-tabs";
import type { Analysis, Run } from "~/features/analytics/model/types";
import { hasAny } from "~/lib/permissions";
import type { RootData } from "~/root";
import type { Route } from "./+types/analytics-detail";

export function meta() {
  return [{ title: "data2flow" }];
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const ctx = bff(context);
  const id = encodeURIComponent(params.analysisId);
  const [analysis, runs] = await Promise.all([callApi<Analysis>(ctx, request, `/api/v1/core/analytics/analyses/${id}`), callList<Run>(ctx, request, `/api/v1/core/analytics/analyses/${id}/runs?page=1&size=1`)]);
  const found = orThrow(analysis);
  const latest = runs.ok ? runs.list.responses[0] : undefined;
  const url = new URL(request.url);
  if (latest) throw redirect(`/analytics/${id}/runs/${encodeURIComponent(latest.runId)}`);
  return { analysis: { ...found, analysisId: found.analysisId ?? found.id ?? params.analysisId }, saved: url.searchParams.get("saved") === "1" };
}

export default function AnalysisDetail({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const root = useRouteLoaderData("root") as RootData | undefined;
  const { analysis, saved } = loaderData;
  return (
    <>
      <PageHeader crumb={t("analytics.list.title")} title={analysis.name} />
      <AnalyticsAreaTabs current="analyses" />
      <AnalysisEmpty analysis={analysis} canRun={hasAny(root?.me?.permissions, ["ANALYTICS_RUN"])} saved={saved} api={defaultAnalyticsApi} />
    </>
  );
}
