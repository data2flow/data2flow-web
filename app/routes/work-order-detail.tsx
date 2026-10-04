/**
 * UI-DEV-13 작업 지시 상세(`/work-orders/{id}`, DEV-08.02): 체크리스트·첨부·댓글·출처·상태 버튼(API-DEV-92~94).
 * `?linked=1`은 생성 요청이 같은 출처의 열린 작업 지시에 연결됐다는 안내(API-DEV-90 `linkedToExisting`).
 */
import { useTranslation } from "react-i18next";
import { useRouteLoaderData } from "react-router";
import { callApi, orThrow } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { Alert, PageHeader } from "~/components/ui";
import { DeviceAreaTabs } from "~/features/devices/area-tabs";
import { WorkOrderPanel } from "~/features/field/components/work-order-detail";
import type { WorkOrderDetail } from "~/features/field/model/work-orders";
import { hasAny } from "~/lib/permissions";
import type { RootData } from "~/root";
import type { Route } from "./+types/work-order-detail";

export function meta() {
  return [{ title: "data2flow" }];
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const ctx = bff(context);
  const order = orThrow(await callApi<WorkOrderDetail>(ctx, request, `/api/v1/core/work-orders/${encodeURIComponent(params.workOrderId)}`));
  return { order: { ...order, attachments: order.attachments ?? [], comments: order.comments ?? [], checklist: order.checklist ?? [], targets: order.targets ?? [] }, linked: new URL(request.url).searchParams.get("linked") === "1" };
}

export default function WorkOrderDetailRoute({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const root = useRouteLoaderData("root") as RootData | undefined;
  return (
    <>
      <PageHeader crumb={t("field.title")} title={t("field.detail.title")} />
      <DeviceAreaTabs current="workOrders" />
      {loaderData.linked && <Alert tone="info">{t("field.create.linked")}</Alert>}
      <WorkOrderPanel key={loaderData.order.id} initial={loaderData.order} canWrite={hasAny(root?.me?.permissions, ["WORKORDER_WRITE"])} meId={root?.me?.id} timezone={root?.timezone ?? "Asia/Seoul"} />
    </>
  );
}
