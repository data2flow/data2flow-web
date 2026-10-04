/**
 * UI-DSH-14 알람 탭(`/m/alarms`): 데스크톱 알람 목록(UI-RUL-07, 360px 대응)과 같은 부품·API(API-RUL-10, 실시간 API-RUL-14). ALARM_READ.
 */
import { useMemo } from "react";
import { useRouteLoaderData } from "react-router";
import { callApi, callList, listOrThrow } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { AlarmListView } from "~/features/alarms/components/alarm-list-view";
import { apiQuery, filterFromParams, type Alarm, type AlarmCounts } from "~/features/alarms/model/alarms";
import { hasAny } from "~/lib/permissions";
import type { SpaceNode } from "~/lib/spaces";
import type { RootData } from "~/root";
import type { Route } from "./+types/m-alarms";

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = bff(context);
  const filter = filterFromParams(new URL(request.url).searchParams);
  const [alarms, spaces] = await Promise.all([callList<Alarm>(ctx, request, `/api/v1/core/alarms?${apiQuery(filter, ctx.runtime.now(), 30)}`), callApi<SpaceNode[]>(ctx, request, "/api/v1/core/spaces")]);
  const list = listOrThrow(alarms) as ReturnType<typeof listOrThrow<Alarm>> & { counts?: AlarmCounts };
  return {
    filter,
    alarms: list.responses.map((a) => ({ ...a, id: String(a.id) })),
    counts: { byStatus: list.counts?.byStatus ?? {}, bySeverity: list.counts?.bySeverity ?? {} },
    totalPages: list.totalPages,
    spaces: spaces.ok ? (spaces.data ?? []) : [],
  };
}

export default function MobileAlarms({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData("root") as RootData | undefined;
  const counts = useMemo(() => loaderData.counts, [loaderData.counts]);
  return (
    <AlarmListView alarms={loaderData.alarms} counts={counts} filter={loaderData.filter} totalPages={loaderData.totalPages} spaces={loaderData.spaces} canHandle={hasAny(root?.me?.permissions, ["ALARM_HANDLE"])} timezone={root?.timezone ?? "Asia/Seoul"} />
  );
}
