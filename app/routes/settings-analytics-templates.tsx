/**
 * UI-ANA-07 분석 템플릿 설정(`/settings/analytics-templates`, UC-ANA-07, ANA-01.03·05.08). 권한 ADMIN(IAM_MANAGE로 가린다, core는 ADMIN 역할 확인).
 * API: 목록 API-ANA-17, 스위치 API-ANA-18, 결과 보관 기간 API-ANA-25(GET·PUT `/core/analytics/settings`).
 */
import { useTranslation } from "react-i18next";
import { callApi, callList } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { PageHeader } from "~/components/ui";
import type { TemplateSetting } from "~/features/analytics/admin-api";
import { TemplateSettings } from "~/features/analytics/components/template-settings";
import type { Route } from "./+types/settings-analytics-templates";

export function meta() {
  return [{ title: "data2flow" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = bff(context);
  const [list, settings] = await Promise.all([
    callList<TemplateSetting>(ctx, request, "/api/v1/core/analytics/template-settings?size=100"),
    callApi<{ resultRetentionDays: number }>(ctx, request, "/api/v1/core/analytics/settings"),
  ]);
  return {
    rows: list.ok ? list.list.responses : [],
    failed: list.ok ? null : { code: list.code, message: list.message },
    retentionDays: settings.ok ? (settings.data?.resultRetentionDays ?? null) : null,
  };
}

export default function SettingsAnalyticsTemplates({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader crumb={t("nav.admin")} title={t("analytics.templateSettings.title")} />
      <TemplateSettings initial={loaderData.rows} failed={loaderData.failed} retentionDays={loaderData.retentionDays} />
    </>
  );
}
