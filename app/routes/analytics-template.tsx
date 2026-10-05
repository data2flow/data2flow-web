/**
 * UI-ANA-02 템플릿 설명서(`/analytics/templates/{key}?version=`, ANA-01.06). 없으면 404 TEMPLATE_NOT_FOUND.
 */
import { useTranslation } from "react-i18next";
import { useRouteLoaderData } from "react-router";
import { callApi, orThrow } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { PageHeader } from "~/components/ui";
import { TemplateGuideView } from "~/features/analytics/components/template-guide";
import type { TemplateDetail } from "~/features/analytics/model/types";
import { hasAny } from "~/lib/permissions";
import type { RootData } from "~/root";
import type { Route } from "./+types/analytics-template";

export function meta() {
  return [{ title: "data2flow" }];
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const ctx = bff(context);
  const version = new URL(request.url).searchParams.get("version");
  const query = version ? `?version=${encodeURIComponent(version)}` : "";
  const template = orThrow(await callApi<TemplateDetail>(ctx, request, `/api/v1/core/analytics/templates/${encodeURIComponent(params.templateKey)}${query}`));
  return { template };
}

export default function AnalyticsTemplate({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const root = useRouteLoaderData("root") as RootData | undefined;
  const { template } = loaderData;
  return (
    <>
      <PageHeader crumb={t("analytics.gallery.title")} title={`${template.name} (${template.key}) v${template.version}`} />
      <TemplateGuideView template={template} canRun={hasAny(root?.me?.permissions, ["ANALYTICS_RUN"])} />
    </>
  );
}
