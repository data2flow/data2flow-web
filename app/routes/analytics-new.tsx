/**
 * UI-ANA-03 분석 만들기 마법사(`/analytics/new?template={key}`, ANA-03·04.01). ANALYTICS_RUN(ANALYST 이상).
 * 템플릿이 없거나 꺼져 있으면 갤러리로 안내한다.
 */
import { useTranslation } from "react-i18next";
import { callApi } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { Alert, ButtonLink, PageHeader } from "~/components/ui";
import { defaultAnalyticsApi } from "~/features/analytics/api";
import { Wizard } from "~/features/analytics/components/wizard";
import type { TemplateDetail } from "~/features/analytics/model/types";
import { errorText } from "~/lib/error-text";
import type { Route } from "./+types/analytics-new";

export function meta() {
  return [{ title: "data2flow" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = bff(context);
  const key = new URL(request.url).searchParams.get("template");
  if (!key) return { template: null, failure: { code: "TEMPLATE_REQUIRED" } };
  const template = await callApi<TemplateDetail>(ctx, request, `/api/v1/core/analytics/templates/${encodeURIComponent(key)}`);
  if (!template.ok) return { template: null, failure: { code: template.code, message: template.message } };
  if (template.data.enabled === false) return { template: null, failure: { code: "TEMPLATE_DISABLED" } };
  return { template: template.data, failure: null };
}

export default function AnalyticsNew({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const { template, failure } = loaderData;
  return (
    <>
      <PageHeader crumb={t("analytics.crumb")} title={template ? t("analytics.wizard.title", { name: template.name }) : t("analytics.wizard.titleEmpty")} />
      {template ? (
        <Wizard key={template.key} template={template} api={defaultAnalyticsApi} />
      ) : (
        <div className="flex flex-col gap-3">
          <Alert tone={failure?.code === "TEMPLATE_REQUIRED" ? "info" : "danger"}>{failure?.code === "TEMPLATE_REQUIRED" ? t("analytics.wizard.pickTemplate") : errorText(t, failure)}</Alert>
          <div>
            <ButtonLink variant="primary" to="/analytics/templates">
              {t("analytics.list.toGallery")}
            </ButtonLink>
          </div>
        </div>
      )}
    </>
  );
}
