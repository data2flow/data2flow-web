/**
 * UI-DEV-13 작업 지시 목록(`/work-orders?view=mine|all|dueSoon|overdue&spaceId=&deviceId=`, DEV-08.02·08.06).
 * 조회 VIEWER 이상(API-DEV-91), 생성·처리 WORKORDER_WRITE(OPERATOR 이상), 계획 관리 DEV_ADMIN(`/work-orders/plans`).
 * 통계 카드: 열린 건수·지연 건수(같은 API를 size=1로 세어 봄)·평균 처리 시간(`stats.avgLeadTimeHours`).
 * 기기별 보기(`deviceId`, 자산 탭 링크)는 API에 기기 필터가 없어 그 기기 공간으로 거른 뒤 대상 기기로 다시 거른다.
 */
import { useTranslation } from "react-i18next";
import { useNavigate, useRouteLoaderData } from "react-router";
import { callApi, callList } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { Alert, ButtonLink, Card, PageHeader, Pager } from "~/components/ui";
import { DeviceAreaTabs } from "~/features/devices/area-tabs";
import type { WorkOrderList } from "~/features/field/api";
import { NewWorkOrderButton, SpaceFilter, WorkOrderStats, WorkOrderTable, WorkOrderViewTabs } from "~/features/field/components/work-order-list";
import { countQuery, parseView, targetDeviceIds, workOrderQuery, type WorkOrder } from "~/features/field/model/work-orders";
import { hasAny } from "~/lib/permissions";
import type { SpaceNode } from "~/lib/spaces";
import type { RootData } from "~/root";
import type { Route } from "./+types/work-orders";

export function meta() {
  return [{ title: "data2flow" }];
}

const BASE = "/api/v1/core/work-orders";

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = bff(context);
  const url = new URL(request.url);
  const view = parseView(url.searchParams.get("view"));
  const deviceId = url.searchParams.get("deviceId");
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const nowMs = ctx.runtime.now();
  const device = deviceId ? await callApi<{ id: string; name: string; space?: { id: string } | null }>(ctx, request, `/api/v1/core/devices/${encodeURIComponent(deviceId)}`) : null;
  const spaceId = url.searchParams.get("spaceId") ?? (device?.ok ? (device.data.space?.id ?? null) : null);
  const count = (kind: "dueSoon" | "overdue" | "open") => callList<WorkOrder>(ctx, request, `${BASE}?${countQuery(kind, { spaceId, nowMs })}`);
  const [list, dueSoon, overdue, open, spaces, devices] = await Promise.all([
    callList<WorkOrder>(ctx, request, `${BASE}?${workOrderQuery(view, { spaceId, nowMs, page: deviceId ? 1 : page, size: deviceId ? 100 : 20 })}`),
    count("dueSoon"),
    count("overdue"),
    count("open"),
    callApi<SpaceNode[]>(ctx, request, "/api/v1/core/spaces"),
    callList<{ id: string; name: string }>(ctx, request, "/api/v1/core/devices?size=100"),
  ]);
  const envelope = list.ok ? (list.list as unknown as WorkOrderList) : null;
  const orders = (envelope?.responses ?? []).filter((o) => !deviceId || targetDeviceIds(o).includes(deviceId));
  return {
    view,
    spaceId,
    deviceId,
    deviceName: device?.ok ? device.data.name : null,
    page,
    nowMs,
    failed: !list.ok,
    orders,
    totalPages: deviceId ? 1 : (envelope?.totalPages ?? 1),
    stats: envelope?.stats ?? null,
    counts: {
      open: open.ok ? (open.list.totalCount ?? null) : null,
      dueSoon: dueSoon.ok ? (dueSoon.list.totalCount ?? null) : null,
      overdue: overdue.ok ? (overdue.list.totalCount ?? null) : null,
    },
    spaces: spaces.ok ? (spaces.data ?? []) : [],
    devices: devices.ok ? devices.list.responses.map((d) => ({ id: String(d.id), name: d.name })) : [],
  };
}

export default function WorkOrders({ loaderData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const root = useRouteLoaderData("root") as RootData | undefined;
  const permissions = root?.me?.permissions;
  const timezone = root?.timezone ?? "Asia/Seoul";
  const d = loaderData;
  const deviceNames = Object.fromEntries(d.devices.map((x) => [x.id, x.name]));
  return (
    <>
      <PageHeader
        title={t("field.title")}
        actions={
          <>
            {hasAny(permissions, ["DEV_ADMIN"]) && <ButtonLink to="/work-orders/plans">{t("field.plans.title")}</ButtonLink>}
            {hasAny(permissions, ["WORKORDER_WRITE"]) && (
              <NewWorkOrderButton devices={d.devices} spaces={d.spaces} meId={root?.me?.id} defaultDeviceIds={d.deviceId ? [d.deviceId] : []} onCreated={(o) => navigate(`/work-orders/${encodeURIComponent(o.id)}${o.linkedToExisting ? "?linked=1" : ""}`)} />
            )}
          </>
        }
      />
      <DeviceAreaTabs current="workOrders" />
      {d.deviceName && <Alert tone="info">{t("field.list.forDevice", { name: d.deviceName })}</Alert>}
      <WorkOrderViewTabs view={d.view} counts={d.counts} base="/work-orders" spaceId={d.deviceId ? null : d.spaceId} />
      <WorkOrderStats counts={d.counts} avgLeadTimeHours={d.stats?.avgLeadTimeHours} lang={i18n.language} />
      {!d.deviceId && <SpaceFilter spaces={d.spaces} value={d.spaceId ?? ""} onChange={(id) => navigate(`?view=${d.view}${id ? `&spaceId=${encodeURIComponent(id)}` : ""}`)} />}
      <Card>
        {d.failed && <Alert tone="warning">{t("field.loadFailed")}</Alert>}
        <WorkOrderTable orders={d.orders} timezone={timezone} nowMs={d.nowMs} deviceNames={deviceNames} emptyText={t(`field.list.emptyView.${d.view}`)} />
        <Pager page={d.page} totalPages={d.totalPages} />
      </Card>
    </>
  );
}
