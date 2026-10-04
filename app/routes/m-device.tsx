/**
 * UI-DEV-17 모바일 기기 상세(`/m/devices/{id}`, QR 현장 조회 도착지, AT-DSH-16.2): 연결 상태·마지막 수신·배터리·현재값(API-DEV-23),
 * 최근 알람(공간 알람에서 이 기기만), 열린 작업 지시(기기 공간 범위 목록에서 대상에 이 기기가 있는 것 — API-DEV-91에 기기 필터가 없음).
 */
import { useRouteLoaderData } from "react-router";
import { callApi, callList, orThrow } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import type { FieldDevice } from "~/features/field/api";
import { MobileDevice, type MobileAlarm } from "~/features/field/components/mobile";
import { OPEN_STATUSES, targetDeviceIds, type WorkOrder } from "~/features/field/model/work-orders";
import { hasAny } from "~/lib/permissions";
import type { RootData } from "~/root";
import type { Route } from "./+types/m-device";

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const ctx = bff(context);
  const device = orThrow(await callApi<FieldDevice>(ctx, request, `/api/v1/core/devices/${encodeURIComponent(params.deviceId)}`));
  const spaceId = device.space?.id;
  const statuses = OPEN_STATUSES.map((s) => `status=${s}`).join("&");
  const [orders, alarms] = await Promise.all([
    callList<WorkOrder>(ctx, request, `/api/v1/core/work-orders?${statuses}${spaceId ? `&spaceId=${encodeURIComponent(spaceId)}` : ""}&size=100`),
    spaceId ? callList<MobileAlarm & { device?: { id: string } | null }>(ctx, request, `/api/v1/core/alarms?spaceId=${encodeURIComponent(spaceId)}&size=50`) : Promise.resolve(null),
  ]);
  const id = String(device.id);
  return {
    device: { ...device, id },
    orders: orders.ok ? orders.list.responses.filter((o) => targetDeviceIds(o).map(String).includes(id)) : [],
    alarms: alarms?.ok ? alarms.list.responses.filter((a) => String(a.device?.id ?? "") === id).map((a) => ({ id: String(a.id), severity: a.severity, status: a.status, title: a.title, raisedAt: a.raisedAt })) : [],
  };
}

export default function MobileDeviceRoute({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData("root") as RootData | undefined;
  return <MobileDevice key={loaderData.device.id} device={loaderData.device} orders={loaderData.orders} alarms={loaderData.alarms} canWrite={hasAny(root?.me?.permissions, ["WORKORDER_WRITE"])} timezone={root?.timezone ?? "Asia/Seoul"} />;
}
