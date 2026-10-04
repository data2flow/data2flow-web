/**
 * UI-ACT-06 인터락 규칙(`/control/interlocks`, ACT-06.02). 권한 INTERLOCK_MANAGE(ADMIN·INTEGRATOR). API: API-ACT-16, 공간 트리(API-DEV-01), 조건 기기 후보(API-DEV-11)
 */
import { useTranslation } from "react-i18next";
import { useRouteLoaderData } from "react-router";
import { callApi, callList } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { PageHeader } from "~/components/ui";
import { ControlAreaTabs } from "~/features/control/area-tabs";
import { InterlockManager } from "~/features/control/interlocks";
import type { InterlockSummary } from "~/features/control/model/admin";
import type { SpaceNode } from "~/lib/spaces";
import type { RootData } from "~/root";
import type { Route } from "./+types/control-interlocks";

export function meta() {
  return [{ title: "data2flow" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = bff(context);
  const [interlocks, spaces, devices] = await Promise.all([
    callList<InterlockSummary>(ctx, request, "/api/v1/core/interlocks?size=100"),
    callApi<SpaceNode[]>(ctx, request, "/api/v1/core/spaces"),
    callList<{ id: string; name: string }>(ctx, request, "/api/v1/core/devices?status=ACTIVE&size=100"),
  ]);
  return {
    interlocks: interlocks.ok ? interlocks.list.responses : [],
    failed: !interlocks.ok,
    spaces: spaces.ok ? (spaces.data ?? []) : [],
    devices: devices.ok ? devices.list.responses.map((d) => ({ id: String(d.id), name: d.name })) : [],
  };
}

export default function ControlInterlocks({ loaderData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const root = useRouteLoaderData("root") as RootData | undefined;
  return (
    <>
      <PageHeader crumb={t("nav.control")} title={t("control.interlocks.title")} />
      <ControlAreaTabs current="interlocks" permissions={root?.me?.permissions} />
      <InterlockManager
        initial={loaderData.interlocks}
        failed={loaderData.failed}
        spaces={loaderData.spaces}
        devices={loaderData.devices}
        timezone={root?.timezone ?? "Asia/Seoul"}
        lang={i18n.language}
      />
    </>
  );
}
