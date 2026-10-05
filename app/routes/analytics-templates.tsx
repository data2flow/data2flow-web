/**
 * UI-ANA-01 템플릿 갤러리(`/analytics/templates`, ANA-01.01·01.04·01.07). 조회는 ANALYTICS_READ(VIEWER 이상),
 * [이 템플릿으로 분석]은 ANALYTICS_RUN. 첫 목록은 서버에서 읽고(API-ANA-01), 검색·실행 가능성은 화면에서 부른다(API-ANA-03·04).
 */
import { useTranslation } from "react-i18next";
import { useRouteLoaderData } from "react-router";
import { callApi, callList } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { PageHeader } from "~/components/ui";
import { defaultAnalyticsApi } from "~/features/analytics/api";
import { AnalyticsAreaTabs } from "~/features/analytics/components/area-tabs";
import { Gallery } from "~/features/analytics/components/gallery";
import type { Template } from "~/features/analytics/model/types";
import { hasAny } from "~/lib/permissions";
import type { SpaceNode } from "~/lib/spaces";
import type { RootData } from "~/root";
import type { Route } from "./+types/analytics-templates";

export function meta() {
  return [{ title: "data2flow" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = bff(context);
  const [templates, spaces] = await Promise.all([callList<Template>(ctx, request, "/api/v1/core/analytics/templates?size=100"), callApi<SpaceNode[]>(ctx, request, "/api/v1/core/spaces")]);
  return {
    templates: templates.ok ? templates.list.responses : [],
    failed: templates.ok ? null : { code: templates.code, message: templates.message },
    spaces: spaces.ok ? (spaces.data ?? []) : [],
  };
}

export default function AnalyticsTemplates({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const root = useRouteLoaderData("root") as RootData | undefined;
  return (
    <>
      <PageHeader crumb={t("analytics.crumb")} title={t("analytics.gallery.title")} />
      <AnalyticsAreaTabs current="templates" />
      <Gallery initial={loaderData.templates} failed={loaderData.failed} canRun={hasAny(root?.me?.permissions, ["ANALYTICS_RUN"])} spaces={loaderData.spaces} api={defaultAnalyticsApi} />
    </>
  );
}
