/**
 * 홈(UI-DSH-01 뼈대, DSH-01.02 공간 쾌적도, DSH-08.02 빈 화면 안내). 요약(API-DSH-01)이 실패해도 화면은 보여 주고 안내만 띄운다.
 * 실시간 갱신은 API-DSH-20 `home` 토픽. 홈 요약 카드의 알람 수 완성은 M4(DSH-01.01)다.
 */
import { useTranslation } from "react-i18next";
import { Link, redirect, useLoaderData, useRouteLoaderData } from "react-router";
import { callApi } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { Alert, EmptyState, PageHeader } from "~/components/ui";
import { LiveHome } from "~/features/home/components/home-panels";
import { isEmptyOrganization, type HomeSummary } from "~/features/home/model/home";
import { hasAny } from "~/lib/permissions";
import type { SpaceNode } from "~/lib/spaces";
import type { RootData } from "~/root";
import type { Route } from "./+types/home";

export function meta() {
  return [{ title: "data2flow" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = bff(context);
  // 첫 화면을 기본 대시보드로 정했으면(DSH-04.07, API-DSH-12 `home: DASHBOARD`) 그 대시보드로. `/?summary`는 홈 요약을 그대로 연다
  if (!new URL(request.url).searchParams.has("summary")) {
    const prefs = await callApi<{ home?: string; defaultDashboardId?: string | null }>(ctx, request, "/api/v1/core/accounts/me/preferences", { noGuards: true });
    if (prefs.ok && prefs.data?.home === "DASHBOARD" && prefs.data.defaultDashboardId) throw redirect(`/dashboards/${encodeURIComponent(prefs.data.defaultDashboardId)}`);
  }
  const [summary, spaces] = await Promise.all([callApi<HomeSummary>(ctx, request, "/api/v1/core/home/summary"), callApi<SpaceNode[]>(ctx, request, "/api/v1/core/spaces")]);
  return {
    summary: summary.ok ? (summary.data ?? {}) : null,
    error: summary.ok ? undefined : summary.code,
    spaceCount: spaces.ok ? (spaces.data ?? []).length : 0,
  };
}

export default function Home() {
  const { t, i18n } = useTranslation();
  const { summary, error, spaceCount } = useLoaderData<typeof loader>();
  const root = useRouteLoaderData("root") as RootData | undefined;
  const me = root?.me;
  const canSource = hasAny(me?.permissions, ["SRC_ADMIN"]);
  const canSpace = hasAny(me?.permissions, ["DEV_ADMIN"]);
  const empty = !error && isEmptyOrganization(summary, spaceCount);
  return (
    <>
      <PageHeader title={t("home.welcome", { name: me?.name || me?.loginId || "" })} />
      {error && <Alert tone="warning">{t("home.summaryFailed")}</Alert>}
      {empty && (
        <EmptyState
          title={t("home.empty.title")}
          body={canSource || canSpace ? t("home.empty.body") : t("home.empty.askAdmin")}
          action={
            (canSource || canSpace) && (
              <>
                {canSource && (
                  <Link to="/sources/new" className="rounded-md border border-accent bg-accent px-3 py-1.5 text-[13px] text-white">
                    {t("home.empty.connectSource")}
                  </Link>
                )}
                {canSpace && (
                  <Link to="/spaces" className="rounded-md border border-line px-3 py-1.5 text-[13px]">
                    {t("home.empty.createSpace")}
                  </Link>
                )}
              </>
            )
          }
        />
      )}
      {summary && !empty && <div className="mt-4"><LiveHome initial={summary} timezone={root?.timezone ?? "Asia/Seoul"} lang={i18n.language} /></div>}
    </>
  );
}
