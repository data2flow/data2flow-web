/**
 * UI-DSH-14 작업 화면(`/m/work-orders/{id}`, DSH-13.04): 체크리스트·사진 첨부·[완료], 하단 [QR 스캔]·[사진]·[완료](44px 이상, AT-DSH-16.1).
 * 오프라인이면 체크·사진·완료를 기기에 보관했다가 연결되면 순서대로 보낸다(AT-DSH-16.3, BR-DSH-22).
 */
import { useNavigate, useRouteLoaderData } from "react-router";
import { callApi, orThrow } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { WorkOrderPanel } from "~/features/field/components/work-order-detail";
import type { WorkOrderDetail } from "~/features/field/model/work-orders";
import { hasAny } from "~/lib/permissions";
import type { RootData } from "~/root";
import type { Route } from "./+types/m-work-order-detail";

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const order = orThrow(await callApi<WorkOrderDetail>(bff(context), request, `/api/v1/core/work-orders/${encodeURIComponent(params.workOrderId)}`));
  return { order: { ...order, attachments: order.attachments ?? [], comments: order.comments ?? [], checklist: order.checklist ?? [], targets: order.targets ?? [] } };
}

export default function MobileWorkOrderDetail({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData("root") as RootData | undefined;
  const navigate = useNavigate();
  return <WorkOrderPanel compact key={loaderData.order.id} initial={loaderData.order} canWrite={hasAny(root?.me?.permissions, ["WORKORDER_WRITE"])} meId={root?.me?.id} timezone={root?.timezone ?? "Asia/Seoul"} onScan={() => navigate("/m/scan")} />;
}
