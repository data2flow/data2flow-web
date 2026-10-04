/**
 * UI-DSH-14 작업 탭(`/m/work-orders?view=`): 내 작업 기본, 카드 목록(API-DEV-91). DEV_READ.
 */
import { useTranslation } from "react-i18next";
import { useRouteLoaderData } from "react-router";
import { callList } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { Alert } from "~/components/ui";
import type { WorkOrderList } from "~/features/field/api";
import { WorkOrderTable, WorkOrderViewTabs } from "~/features/field/components/work-order-list";
import { countQuery, parseView, workOrderQuery, type WorkOrder } from "~/features/field/model/work-orders";
import type { RootData } from "~/root";
import type { Route } from "./+types/m-work-orders";

const BASE = "/api/v1/core/work-orders";

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = bff(context);
  const view = parseView(new URL(request.url).searchParams.get("view"));
  const nowMs = ctx.runtime.now();
  const [list, dueSoon, overdue] = await Promise.all([
    callList<WorkOrder>(ctx, request, `${BASE}?${workOrderQuery(view, { nowMs, size: 50 })}`),
    callList<WorkOrder>(ctx, request, `${BASE}?${countQuery("dueSoon", { nowMs })}`),
    callList<WorkOrder>(ctx, request, `${BASE}?${countQuery("overdue", { nowMs })}`),
  ]);
  return {
    view,
    nowMs,
    failed: !list.ok,
    orders: list.ok ? (list.list as unknown as WorkOrderList).responses : [],
    counts: { dueSoon: dueSoon.ok ? (dueSoon.list.totalCount ?? null) : null, overdue: overdue.ok ? (overdue.list.totalCount ?? null) : null },
  };
}

export default function MobileWorkOrders({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const root = useRouteLoaderData("root") as RootData | undefined;
  return (
    <>
      <WorkOrderViewTabs view={loaderData.view} counts={loaderData.counts} base="/m/work-orders" />
      {loaderData.failed && <Alert tone="warning">{t("field.loadFailed")}</Alert>}
      <WorkOrderTable compact base="/m/work-orders" orders={loaderData.orders} timezone={root?.timezone ?? "Asia/Seoul"} nowMs={loaderData.nowMs} emptyText={t(`field.list.emptyView.${loaderData.view}`)} />
    </>
  );
}
