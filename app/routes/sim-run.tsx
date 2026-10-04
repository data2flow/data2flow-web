/**
 * UI-SIM-09 실행 제어 패널 + UI-SIM-10 장애 주입(SIM-04.02, SIM-05.03). 조회 SIM_READ, 제어·장애 주입 SIM_RUN.
 * API: 상태 API-SIM-16, 실시간 API-SIM-31(`/bff/stream/sim/runs/{id}` SSE), 제어 API-SIM-15, 장애 API-SIM-20·21.
 * 시나리오 이름·대상 공간은 API-SIM-12, 공간 이름은 API-SIM-01, 가상 기기는 API-DEV-11(virtual=true)로 채운다.
 */
import { useTranslation } from "react-i18next";
import { useRouteLoaderData } from "react-router";
import { callApi, callList, orThrow } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { PageHeader } from "~/components/ui";
import { simApi } from "~/features/sim/api";
import { SimAreaTabs, VirtualBadge } from "~/features/sim/components/common";
import { RunPanel } from "~/features/sim/components/run-panel";
import type { Scenario, SimRun, SimSpace } from "~/features/sim/model/types";
import { hasAny } from "~/lib/permissions";
import type { RootData } from "~/root";
import type { Route } from "./+types/sim-run";

export function meta() {
  return [{ title: "data2flow" }];
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const ctx = bff(context);
  const run = orThrow(await callApi<SimRun>(ctx, request, `/api/v1/core/sim/runs/${encodeURIComponent(params.runId)}`));
  const [scenario, spaces, devices] = await Promise.all([
    run.scenarioId ? callApi<Scenario>(ctx, request, `/api/v1/core/sim/scenarios/${encodeURIComponent(run.scenarioId)}`) : Promise.resolve(null),
    callList<SimSpace>(ctx, request, "/api/v1/core/sim/spaces"),
    callList<{ id: string; name: string; virtual?: boolean; kind?: string }>(ctx, request, "/api/v1/core/devices?virtual=true&size=100"),
  ]);
  const deviceRows = devices.ok ? devices.list.responses : [];
  return {
    run,
    scenarioName: scenario?.ok ? scenario.data.name : null,
    spaceNames: spaces.ok ? Object.fromEntries(spaces.list.responses.map((s) => [String(s.spaceId), s.name])) : {},
    devices: deviceRows.map((d) => ({ deviceId: d.id, name: d.name, virtual: d.virtual !== false })),
  };
}

export default function SimRunPage({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const root = useRouteLoaderData("root") as RootData | undefined;
  const { run, scenarioName, spaceNames, devices } = loaderData;
  const title = `R-${run.runId}${scenarioName ? ` ${scenarioName}` : ""}`;
  return (
    <>
      <PageHeader
        crumb={t("sim.area.scenarios")}
        title={
          <span className="inline-flex items-center gap-2">
            {t("sim.run.title", { title })} <VirtualBadge />
          </span>
        }
      />
      <SimAreaTabs current="scenarios" />
      <RunPanel
        run={run}
        title={title}
        spaceNames={spaceNames}
        actuatorNames={Object.fromEntries(devices.map((d) => [d.deviceId, d.name]))}
        targets={devices}
        canRun={hasAny(root?.me?.permissions, ["SIM_RUN"])}
        timezone={root?.timezone ?? "Asia/Seoul"}
        api={simApi}
      />
    </>
  );
}
