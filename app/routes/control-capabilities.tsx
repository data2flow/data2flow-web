/**
 * UI-ACT-10 기능 카탈로그(`/control/capabilities`, ACT-01.04). 조회 DEVICE_CONTROL·CAPABILITY_MANAGE(경로 가드), 사용자 정의 기능 편집 CAPABILITY_MANAGE.
 * API: API-ACT-25 `GET /api/v1/core/capabilities`
 */
import { useTranslation } from "react-i18next";
import { useRouteLoaderData } from "react-router";
import { callList } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { PageHeader } from "~/components/ui";
import { ControlAreaTabs } from "~/features/control/area-tabs";
import { CapabilityCatalog } from "~/features/control/capability-catalog";
import type { CapabilitySummaryRow } from "~/features/control/model/admin";
import { hasAny } from "~/lib/permissions";
import type { RootData } from "~/root";
import type { Route } from "./+types/control-capabilities";

export function meta() {
  return [{ title: "data2flow" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = bff(context);
  const result = await callList<CapabilitySummaryRow>(ctx, request, "/api/v1/core/capabilities?size=100");
  return { rows: result.ok ? result.list.responses : [], failed: !result.ok };
}

export default function ControlCapabilities({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const root = useRouteLoaderData("root") as RootData | undefined;
  return (
    <>
      <PageHeader crumb={t("nav.control")} title={t("control.capabilities.title")} />
      <ControlAreaTabs current="capabilities" permissions={root?.me?.permissions} />
      <CapabilityCatalog initial={loaderData.rows} failed={loaderData.failed} canManage={hasAny(root?.me?.permissions, ["CAPABILITY_MANAGE"])} />
    </>
  );
}
