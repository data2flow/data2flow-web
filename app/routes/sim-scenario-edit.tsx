/**
 * UI-SIM-08 시나리오 타임라인 편집기(SIM-04.01, SIM-05.03). `/sim/scenarios/new/edit`는 새 시나리오(저장하면 POST 후 이 주소로 바뀜).
 * 조회 SIM_READ, 저장 SIM_MANAGE, [실행] SIM_RUN. API: API-SIM-12(조회·저장), API-SIM-14(실행), 대상 공간 API-SIM-10 목록, 가상 기기 API-DEV-11(virtual=true).
 */
import { useTranslation } from "react-i18next";
import { useNavigate, useRouteLoaderData } from "react-router";
import { callApi, callList, orThrow } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { PageHeader } from "~/components/ui";
import { simApi } from "~/features/sim/api";
import { SimAreaTabs } from "~/features/sim/components/common";
import { ScenarioEditor } from "~/features/sim/components/scenario-editor";
import { emptyScenario, fromScenario } from "~/features/sim/model/scenario";
import type { Scenario, SimSpace } from "~/features/sim/model/types";
import { hasAny } from "~/lib/permissions";
import type { RootData } from "~/root";
import type { Route } from "./+types/sim-scenario-edit";

export function meta() {
  return [{ title: "data2flow" }];
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const ctx = bff(context);
  const isNew = params.scenarioId === "new";
  const [scenario, spaces, devices] = await Promise.all([
    isNew ? Promise.resolve(null) : callApi<Scenario>(ctx, request, `/api/v1/core/sim/scenarios/${encodeURIComponent(params.scenarioId)}`),
    callList<SimSpace>(ctx, request, "/api/v1/core/sim/spaces"),
    callList<{ id: string; name: string }>(ctx, request, "/api/v1/core/devices?virtual=true&size=100"),
  ]);
  const hour = Math.floor(ctx.runtime.now() / 3_600_000) * 3_600_000;
  return {
    scenario: scenario ? orThrow(scenario) : null,
    defaultStart: new Date(hour).toISOString().replace(/\.000Z$/, "Z"),
    spaces: spaces.ok ? spaces.list.responses.map((s) => ({ spaceId: String(s.spaceId), name: s.name })) : [],
    devices: devices.ok ? devices.list.responses.map((d) => ({ deviceId: d.id, name: d.name })) : [],
  };
}

export default function SimScenarioEditPage({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const root = useRouteLoaderData("root") as RootData | undefined;
  const permissions = root?.me?.permissions;
  const { scenario, spaces, devices, defaultStart } = loaderData;
  const initial = scenario ? fromScenario(scenario) : emptyScenario(defaultStart, spaces[0] ? [spaces[0].spaceId] : []);
  return (
    <>
      <PageHeader crumb={t("sim.scenario.listTitle")} title={scenario?.name ?? t("sim.scenario.new")} />
      <SimAreaTabs current="scenarios" />
      <ScenarioEditor
        key={scenario?.scenarioId ?? "new"}
        initial={initial}
        spaces={spaces}
        devices={devices}
        canEdit={hasAny(permissions, ["SIM_MANAGE"])}
        canRun={hasAny(permissions, ["SIM_RUN"])}
        api={simApi}
        navigate={(to, options) => navigate(to, options)}
      />
    </>
  );
}
