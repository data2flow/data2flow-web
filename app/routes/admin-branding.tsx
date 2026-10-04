/**
 * UI-DSH-13 브랜딩 설정(`/admin/branding`, DSH-13.01, API-DSH-25). ADMIN(BRANDING_MANAGE)만 — 다른 역할은 403 화면(AT-DSH-14.4).
 */
import { useTranslation } from "react-i18next";
import { callApi } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { Alert, PageHeader } from "~/components/ui";
import { BrandingForm } from "~/features/branding/components/branding-form";
import type { Branding } from "~/features/branding/model/branding";
import type { Route } from "./+types/admin-branding";

export function meta() {
  return [{ title: "data2flow" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const r = await callApi<Branding>(bff(context), request, "/api/v1/core/branding");
  return { branding: r.ok ? r.data : null, failed: !r.ok };
}

export default function AdminBranding({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader title={t("branding.title")} crumb={t("nav.admin")} />
      {loaderData.failed && <Alert tone="warning">{t("branding.loadFailed")}</Alert>}
      <BrandingForm initial={loaderData.branding} />
    </>
  );
}
