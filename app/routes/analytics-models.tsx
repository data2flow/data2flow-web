/**
 * UI-ANA-06 모델 관리(`/analytics/models`, ANA-07). 조회 ANALYTICS_RUN(A 이상), [재학습]·[적용] INTEGRATOR 이상(서버가 다시 판정).
 */
import { useTranslation } from "react-i18next";
import { useRouteLoaderData } from "react-router";
import { callList } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { Alert, PageHeader } from "~/components/ui";
import { defaultAnalyticsApi } from "~/features/analytics/api";
import { AnalyticsAreaTabs } from "~/features/analytics/components/area-tabs";
import { ModelsPanel } from "~/features/analytics/components/models-panel";
import type { ModelItem } from "~/features/analytics/model/types";
import { errorText } from "~/lib/error-text";
import type { RootData } from "~/root";
import type { Route } from "./+types/analytics-models";

export function meta() {
  return [{ title: "data2flow" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = bff(context);
  const models = await callList<ModelItem>(ctx, request, "/api/v1/core/analytics/models?size=100");
  return { models: models.ok ? models.list.responses : [], failure: models.ok ? null : { code: models.code, message: models.message } };
}

export default function AnalyticsModels({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const root = useRouteLoaderData("root") as RootData | undefined;
  const role = root?.me?.role;
  return (
    <>
      <PageHeader crumb={t("analytics.crumb")} title={t("analytics.models.title")} />
      <AnalyticsAreaTabs current="models" />
      {loaderData.failure && <Alert tone="danger">{errorText(t, loaderData.failure)}</Alert>}
      <ModelsPanel initial={loaderData.models} canManage={role === "ADMIN" || role === "INTEGRATOR"} api={defaultAnalyticsApi} timezone={root?.timezone ?? "Asia/Seoul"} />
    </>
  );
}
