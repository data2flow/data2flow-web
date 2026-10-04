/**
 * UI-ACT-09 드라이버 관리(`/control/drivers`, ACT-03.03~06, ACT-07.03). 권한 DRIVER_MANAGE(목록·상세 조회 포함, ADR-043).
 * API: 목록 API-ACT-30, 행마다 최근 1시간 지표 API-ACT-32(실패하면 "–")
 */
import { useTranslation } from "react-i18next";
import { useRouteLoaderData } from "react-router";
import { callApi, callList } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { PageHeader } from "~/components/ui";
import { ControlAreaTabs } from "~/features/control/area-tabs";
import { DriverManager, type DriverRow } from "~/features/control/drivers";
import type { DriverMetrics, DriverSummary } from "~/features/control/model/admin";
import type { RootData } from "~/root";
import type { Route } from "./+types/control-drivers";

export function meta() {
  return [{ title: "data2flow" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = bff(context);
  const drivers = await callList<DriverSummary>(ctx, request, "/api/v1/core/drivers?size=100");
  const rows: DriverRow[] = drivers.ok ? drivers.list.responses : [];
  const metrics = await Promise.all(rows.map((d) => callApi<DriverMetrics>(ctx, request, `/api/v1/core/drivers/${encodeURIComponent(d.driverId)}/metrics?window=1h`)));
  return { drivers: rows.map((d, i) => ({ ...d, metrics: metrics[i].ok ? metrics[i].data : null })), failed: !drivers.ok };
}

export default function ControlDrivers({ loaderData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const root = useRouteLoaderData("root") as RootData | undefined;
  return (
    <>
      <PageHeader crumb={t("nav.control")} title={t("control.drivers.title")} />
      <ControlAreaTabs current="drivers" permissions={root?.me?.permissions} />
      <DriverManager initial={loaderData.drivers} failed={loaderData.failed} timezone={root?.timezone ?? "Asia/Seoul"} lang={i18n.language} />
    </>
  );
}
