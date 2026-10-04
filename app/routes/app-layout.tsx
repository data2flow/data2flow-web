/**
 * 로그인 뒤 화면 틀(상단 내비게이션 + 권한별 메뉴, IAM-04.05). 가드는 미들웨어에서 먼저 한다(user.server.ts).
 * 전역 띠(00-navigation.md §1.3): 진행 중인 자동화 비상 정지(API-ACT-21 `?active=true`, UI-ACT-07)와 유지보수(API-OPS-23 `status=ACTIVE`)를
 * 서버에서 먼저 읽어 그리고, 화면에서는 5초마다 다시 읽는다. 읽기에 실패하면 띠 없이 화면을 연다.
 */
import { useEffect, useState } from "react";
import { Outlet, useNavigate, useRouteLoaderData } from "react-router";
import { callApi, callList } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { guardUser } from "~/bff/user.server";
import { AppShell } from "~/components/app-shell";
import { EmergencyStopButton, GlobalBands } from "~/features/control/emergency-stop";
import type { EmergencyStop, MaintenanceWindow } from "~/features/control/model/admin";
import { hasAny } from "~/lib/permissions";
import { onLogout } from "~/lib/session-broadcast";
import type { SpaceNode } from "~/lib/spaces";
import type { RootData } from "~/root";
import type { Route } from "./+types/app-layout";

export const middleware: Route.MiddlewareFunction[] = [
  async ({ request, context }, next) => {
    await guardUser(bff(context), request);
    return next();
  },
];

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = bff(context);
  if (!ctx.session.authenticated) return { stops: [] as EmergencyStop[], maintenance: [] as MaintenanceWindow[], spaces: [] as SpaceNode[] };
  const [stops, maintenance] = await Promise.all([
    callList<EmergencyStop>(ctx, request, "/api/v1/core/emergency-stops?active=true", { noGuards: true }),
    callList<MaintenanceWindow>(ctx, request, "/api/v1/core/maintenance-windows?status=ACTIVE", { noGuards: true }),
  ]);
  const activeStops = stops.ok ? stops.list.responses.filter((s) => s.active !== false) : [];
  // 공간 범위 비상 정지가 있을 때만 공간 이름을 찾으려고 트리를 읽는다
  const spaces = activeStops.some((s) => s.scope?.type === "SPACE") ? await callApi<SpaceNode[]>(ctx, request, "/api/v1/core/spaces", { noGuards: true }) : null;
  return {
    stops: activeStops,
    maintenance: maintenance.ok ? maintenance.list.responses.filter((m) => m.status === "ACTIVE") : [],
    spaces: spaces?.ok ? (spaces.data ?? []) : [],
  };
}

export default function AppLayout({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData("root") as RootData | undefined;
  const navigate = useNavigate();
  const [refreshKey, setRefreshKey] = useState(0);
  useEffect(
    () =>
      // 다른 탭에서 로그아웃·세션 종료가 일어나면 이 탭도 로그인 화면으로(UI-IAM-13)
      onLogout((message) => {
        navigate(`/login?reason=${encodeURIComponent(message.reason === "logout" ? "logout" : "revoked")}`, { replace: true });
      }),
    [navigate],
  );
  const permissions = root?.me?.permissions;
  const timezone = root?.timezone ?? "Asia/Seoul";
  const lang = root?.lang ?? "ko";
  return (
    <AppShell
      me={root?.me ?? null}
      theme={root?.theme}
      headerActions={hasAny(permissions, ["EMERGENCY_STOP"]) ? <EmergencyStopButton onStarted={() => setRefreshKey((n) => n + 1)} /> : undefined}
      bands={
        <GlobalBands
          initialStops={loaderData?.stops ?? []}
          initialMaintenance={loaderData?.maintenance ?? []}
          spaces={loaderData?.spaces}
          canRelease={hasAny(permissions, ["EMERGENCY_RELEASE"])}
          canEndMaintenance={hasAny(permissions, ["DEV_PLACE"])}
          timezone={timezone}
          lang={lang}
          refreshKey={refreshKey}
        />
      }
    >
      <Outlet />
    </AppShell>
  );
}
