/**
 * UI-ACT-08 조직 제어 한계·보호 설정(`/settings/control`, ACT-06.04·06.01·02.05). 권한 CONTROL_SETTINGS(ADMIN).
 * API: API-ACT-17 조회·저장, 기능 카탈로그(API-ACT-25)에서 한계를 둘 수 있는 숫자 속성과 표준 범위를 읽는다.
 */
import { useTranslation } from "react-i18next";
import { useRouteLoaderData } from "react-router";
import { callApi, callList, orThrow } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { PageHeader } from "~/components/ui";
import { ControlSettingsEditor } from "~/features/control/control-settings";
import type { CapabilityDefinition } from "~/features/control/model/admin";
import { limitTargets, type ControlSettings } from "~/features/control/model/settings";
import type { RootData } from "~/root";
import type { Route } from "./+types/settings-control";

export function meta() {
  return [{ title: "data2flow" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = bff(context);
  const [settings, catalog] = await Promise.all([
    callApi<ControlSettings>(ctx, request, "/api/v1/core/settings/control"),
    callList<{ name: string }>(ctx, request, "/api/v1/core/capabilities?size=100"),
  ]);
  const names = catalog.ok ? catalog.list.responses.map((c) => c.name) : [];
  const definitions = await Promise.all(names.map((name) => callApi<CapabilityDefinition>(ctx, request, `/api/v1/core/capabilities/${encodeURIComponent(name)}`)));
  return {
    settings: orThrow(settings),
    targets: limitTargets(definitions.flatMap((d) => (d.ok && d.data ? [d.data] : []))),
  };
}

export default function SettingsControl({ loaderData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const root = useRouteLoaderData("root") as RootData | undefined;
  return (
    <>
      <PageHeader crumb={t("nav.admin")} title={t("control.settings.title")} />
      <ControlSettingsEditor initial={loaderData.settings} targets={loaderData.targets} timezone={root?.timezone ?? "Asia/Seoul"} lang={i18n.language} />
    </>
  );
}
