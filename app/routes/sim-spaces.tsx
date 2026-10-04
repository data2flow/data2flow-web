/**
 * UI-SIM-06 가상 공간 목록(SIM-01.01): 가상 공간 카드(기기 수·현재 상태·실행 중), [새 가상 공간]. 조회 SIM_READ, 만들기 SIM_MANAGE.
 * 목록은 API-SIM-10 `GET /core/sim/spaces`(기기 수·현재 값, 사용자 공간 범위 안만)이고, 센서·장비 수와 실행 중 표시는 API-SIM-01 `spaces`에서 더한다.
 */
import { useTranslation } from "react-i18next";
import { Link, useRouteLoaderData } from "react-router";
import { callApi, callList, listOrThrow } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { Badge, ButtonLink, Card, EmptyState, PageHeader, Table } from "~/components/ui";
import { SimAreaTabs, VirtualBadge } from "~/features/sim/components/common";
import type { SimOverview, SimSpace } from "~/features/sim/model/types";
import { hasAny } from "~/lib/permissions";
import type { RootData } from "~/root";
import type { Route } from "./+types/sim-spaces";

export function meta() {
  return [{ title: "data2flow" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = bff(context);
  const [list, overview] = await Promise.all([callList<SimSpace>(ctx, request, "/api/v1/core/sim/spaces"), callApi<SimOverview>(ctx, request, "/api/v1/core/sim/overview")]);
  const summary = new Map((overview.ok ? overview.data.spaces : []).map((s) => [String(s.spaceId), s]));
  const spaces = listOrThrow(list).responses.map((s) => {
    const o = summary.get(String(s.spaceId));
    return { spaceId: String(s.spaceId), name: s.name, sandbox: Boolean(s.sandbox), deviceCount: s.deviceCount ?? null, sensors: o?.sensors ?? null, actuators: o?.actuators ?? null, current: s.current ?? o?.current ?? null, running: Boolean(o?.running) };
  });
  return { spaces };
}

export default function SimSpacesPage({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const root = useRouteLoaderData("root") as RootData | undefined;
  const canManage = hasAny(root?.me?.permissions, ["SIM_MANAGE"]);
  const newButton = canManage && (
    <ButtonLink to="/sim/spaces/new" variant="primary">
      {t("sim.space.new")}
    </ButtonLink>
  );
  return (
    <>
      <PageHeader crumb={t("nav.sim")} title={t("sim.space.listTitle")} actions={newButton} />
      <SimAreaTabs current="spaces" />
      <Card>
        {loaderData.spaces.length === 0 ? (
          <EmptyState title={t("sim.home.noSpaces")} action={newButton} />
        ) : (
          <Table>
            <thead>
              <tr>
                <th>{t("sim.space.name")}</th>
                <th>{t("sim.space.devices")}</th>
                <th>{t("sim.space.current")}</th>
                <th>{t("sim.space.state")}</th>
              </tr>
            </thead>
            <tbody>
              {loaderData.spaces.map((s) => (
                <tr key={s.spaceId}>
                  <td>
                    <Link className="text-accent hover:underline" to={`/sim/spaces/${encodeURIComponent(s.spaceId)}`}>
                      {s.name}
                    </Link>{" "}
                    <VirtualBadge />
                    {s.sandbox && (
                      <>
                        {" "}
                        <Badge tone="warning">{t("sim.space.sandbox")}</Badge>
                      </>
                    )}
                  </td>
                  <td>{s.sensors !== null && s.actuators !== null ? t("sim.home.spaceDevices", { sensors: s.sensors, actuators: s.actuators }) : (s.deviceCount ?? "–")}</td>
                  <td className="font-mono">{`${s.current?.temperature ?? "–"}℃ · ${s.current?.co2 ?? "–"}ppm`}</td>
                  <td>{s.running ? <Badge tone="info">{t("sim.home.spaceRunning")}</Badge> : <Badge tone="neutral">{t("sim.space.idle")}</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
