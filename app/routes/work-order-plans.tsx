/**
 * UI-DEV-13 계획 탭(`/work-orders/plans`, DEV-08.05, API-DEV-95): 정기 점검 계획 목록·편집. DEV_ADMIN(INTEGRATOR 이상)만.
 */
import { useTranslation } from "react-i18next";
import { useRouteLoaderData } from "react-router";
import { callList } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { Alert, PageHeader } from "~/components/ui";
import { DeviceAreaTabs } from "~/features/devices/area-tabs";
import { PlanManager } from "~/features/field/components/plans";
import type { MaintenancePlan } from "~/features/field/model/work-orders";
import { zonedDate } from "~/lib/format";
import { hasAny } from "~/lib/permissions";
import type { RootData } from "~/root";
import type { Route } from "./+types/work-order-plans";

export function meta() {
  return [{ title: "data2flow" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = bff(context);
  const [plans, groups] = await Promise.all([
    callList<MaintenancePlan>(ctx, request, "/api/v1/core/maintenance-plans?size=100"),
    callList<{ id: string; name: string }>(ctx, request, "/api/v1/core/device-groups?size=100"),
  ]);
  return {
    plans: plans.ok ? plans.list.responses.map((p) => ({ ...p, id: String(p.id), targetGroupId: String(p.targetGroupId), checklistTemplate: p.checklistTemplate ?? [] })) : [],
    failed: !plans.ok,
    groups: groups.ok ? groups.list.responses.map((g) => ({ id: String(g.id), name: g.name })) : [],
    nowMs: ctx.runtime.now(),
  };
}

export default function WorkOrderPlans({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const root = useRouteLoaderData("root") as RootData | undefined;
  return (
    <>
      <PageHeader crumb={t("field.title")} title={t("field.plans.title")} />
      <DeviceAreaTabs current="workOrders" />
      {loaderData.failed && <Alert tone="warning">{t("field.loadFailed")}</Alert>}
      <PlanManager initial={loaderData.plans} groups={loaderData.groups} canManage={hasAny(root?.me?.permissions, ["DEV_ADMIN"])} today={zonedDate(loaderData.nowMs, root?.timezone ?? "Asia/Seoul")} />
    </>
  );
}
