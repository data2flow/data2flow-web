/**
 * UI-ACT-05 예약 제어(`/control/schedules`, ACT-02.07). 권한 SCHEDULE_MANAGE(경로 가드). API: API-ACT-15, 대상 후보 장면(API-ACT-10)·기기(API-DEV-11)·공간(API-DEV-01)
 */
import { useTranslation } from "react-i18next";
import { useRouteLoaderData } from "react-router";
import { callApi, callList } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { PageHeader } from "~/components/ui";
import { ControlAreaTabs } from "~/features/control/area-tabs";
import type { SceneSummary, ScheduleSummary } from "~/features/control/model/admin";
import { ScheduleManager } from "~/features/control/schedules";
import type { SpaceNode } from "~/lib/spaces";
import type { RootData } from "~/root";
import type { Route } from "./+types/control-schedules";

export function meta() {
  return [{ title: "data2flow" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = bff(context);
  const [schedules, scenes, devices, spaces] = await Promise.all([
    callList<ScheduleSummary>(ctx, request, "/api/v1/core/control-schedules?size=100"),
    callList<SceneSummary>(ctx, request, "/api/v1/core/scenes?size=100"),
    callList<{ id: string; name: string }>(ctx, request, "/api/v1/core/devices?status=ACTIVE&size=100"),
    callApi<SpaceNode[]>(ctx, request, "/api/v1/core/spaces"),
  ]);
  return {
    schedules: schedules.ok ? schedules.list.responses : [],
    failed: !schedules.ok,
    scenes: scenes.ok ? scenes.list.responses.map((s) => ({ sceneId: s.sceneId, name: s.name })) : [],
    devices: devices.ok ? devices.list.responses.map((d) => ({ id: String(d.id), name: d.name })) : [],
    spaces: spaces.ok ? (spaces.data ?? []) : [],
  };
}

export default function ControlSchedules({ loaderData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const root = useRouteLoaderData("root") as RootData | undefined;
  return (
    <>
      <PageHeader crumb={t("nav.control")} title={t("control.schedules.title")} />
      <ControlAreaTabs current="schedules" permissions={root?.me?.permissions} />
      <ScheduleManager initial={loaderData.schedules} failed={loaderData.failed} scenes={loaderData.scenes} devices={loaderData.devices} spaces={loaderData.spaces} timezone={root?.timezone ?? "Asia/Seoul"} lang={i18n.language} />
    </>
  );
}
