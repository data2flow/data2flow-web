/**
 * UI-RUL-04 알람 목록(RUL-02.06, RUL-04.01~03, DSH-07.01). 조회 ALARM_READ(VIEWER+), 일괄 확인·무음 ALARM_HANDLE(OPERATOR+).
 * API: 목록 API-RUL-10(필터·counts, 공간 범위는 서버가 거름), 실시간 API-RUL-14(`/bff/stream/alarms`), 일괄 확인 API-RUL-12, 무음 API-RUL-25.
 */
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useRouteLoaderData } from "react-router";
import { callApi, callList, listOrThrow } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { ButtonLink, PageHeader } from "~/components/ui";
import { AlarmListView } from "~/features/alarms/components/alarm-list-view";
import { apiQuery, filterFromParams, type Alarm, type AlarmCounts } from "~/features/alarms/model/alarms";
import { hasAny } from "~/lib/permissions";
import type { SpaceNode } from "~/lib/spaces";
import type { RootData } from "~/root";
import type { Route } from "./+types/alarms";

const PAGE_SIZE = 50;

export function meta() {
  return [{ title: "data2flow" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = bff(context);
  const url = new URL(request.url);
  const filter = filterFromParams(url.searchParams);
  const [alarms, spaces] = await Promise.all([
    callList<Alarm>(ctx, request, `/api/v1/core/alarms?${apiQuery(filter, ctx.runtime.now(), PAGE_SIZE)}`),
    callApi<SpaceNode[]>(ctx, request, "/api/v1/core/spaces"),
  ]);
  const list = listOrThrow(alarms) as ReturnType<typeof listOrThrow<Alarm>> & { counts?: AlarmCounts };
  return {
    filter,
    alarms: list.responses.map((a) => ({ ...a, id: String(a.id) })),
    counts: { byStatus: list.counts?.byStatus ?? {}, bySeverity: list.counts?.bySeverity ?? {} },
    totalPages: list.totalPages,
    spaces: spaces.ok ? (spaces.data ?? []) : [],
  };
}

export default function Alarms({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const root = useRouteLoaderData("root") as RootData | undefined;
  const permissions = root?.me?.permissions;
  const counts = useMemo(() => loaderData.counts, [loaderData.counts]);
  return (
    <>
      <PageHeader
        crumb={t("alarms.crumb")}
        title={t("alarms.title")}
        actions={
          <>
            {hasAny(permissions, ["RULE_READ"]) && <ButtonLink to="/rules">{t("rules.title")}</ButtonLink>}
            {hasAny(permissions, ["RULE_READ"]) && <ButtonLink to="/alarms/stats">{t("alarmStats.title")}</ButtonLink>}
            {hasAny(permissions, ["ALARM_HANDLE", "NOTIFY_POLICY_WRITE"]) && <ButtonLink to="/notifications/silences">{t("silences.title")}</ButtonLink>}
          </>
        }
      />
      <AlarmListView
        alarms={loaderData.alarms}
        counts={counts}
        filter={loaderData.filter}
        totalPages={loaderData.totalPages}
        spaces={loaderData.spaces}
        canHandle={hasAny(permissions, ["ALARM_HANDLE"])}
        timezone={root?.timezone ?? "Asia/Seoul"}
      />
    </>
  );
}
