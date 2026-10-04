/**
 * UI-DSH-04 대시보드 보기(`/dashboards/{id}?var-space=31`, DSH-04·06·11).
 * 첫 화면(NFR-01.09): loader가 정의(API-DSH-06)와 앞쪽 위젯 12개 데이터(API-DSH-09)를 병렬로 받아 서버에서 그리고,
 * 브라우저는 나머지 위젯·실시간만 맡는다. 상단 메뉴: [편집](편집 권한), PNG(대시보드), 공유 링크(DASHBOARD_WRITE), 키오스크.
 * PRIVATE 대시보드를 남이 열면 core가 404 `DASHBOARD_NOT_FOUND`(BR-DSH-08).
 */
import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, data, useRouteLoaderData } from "react-router";
import { callApi } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { FeatureTour } from "~/components/feature-tour";
import { Button, PageHeader } from "~/components/ui";
import { dashboardsApi } from "~/features/dashboards/api";
import { DashboardView } from "~/features/dashboards/components/dashboard-view";
import { ShareLinksDialog } from "~/features/dashboards/components/share-links";
import type { WidgetFetcher } from "~/features/dashboards/components/use-dashboard-data";
import { exportFileName } from "~/features/dashboards/model/data";
import { kioskUrl } from "~/features/dashboards/model/kiosk";
import { valuesFromSearch } from "~/features/dashboards/model/variables";
import type { Dashboard } from "~/features/dashboards/model/types";
import { firstPaintData, variableOptions } from "~/features/dashboards/server";
import { downloadDataUrl, nodeToPng } from "~/lib/download";
import { hasAny } from "~/lib/permissions";
import type { RootData } from "~/root";
import type { Route } from "./+types/dashboard-detail";

export function meta() {
  return [{ title: "data2flow" }];
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const ctx = bff(context);
  const id = params.dashboardId;
  const r = await callApi<Dashboard>(ctx, request, `/api/v1/core/dashboards/${encodeURIComponent(id)}`);
  if (!r.ok) throw data({ code: r.code }, { status: r.status === 404 ? 404 : r.status });
  const dashboard = r.data;
  const values = valuesFromSearch(new URL(request.url).searchParams);
  const [initial, options, prefs] = await Promise.all([
    firstPaintData(ctx, request, dashboard, values),
    variableOptions(ctx, request, dashboard.variables ?? []),
    callApi<{ toursDismissed?: string[] }>(ctx, request, "/api/v1/core/accounts/me/preferences", { noGuards: true }),
    // 최근 본 항목(DSH-07.05). 실패해도 화면에는 영향 없음
    callApi(ctx, request, "/api/v1/core/accounts/me/recent", { method: "POST", body: { type: "DASHBOARD", id }, noGuards: true }),
  ]);
  return { dashboard, initial, values, options, toursDismissed: prefs.ok ? (prefs.data?.toursDismissed ?? []) : [] };
}

export const TOUR_ID = "dashboard-view";

export default function DashboardDetail({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const root = useRouteLoaderData("root") as RootData | undefined;
  const { dashboard, initial, values, options, toursDismissed } = loaderData;
  const [shareOpen, setShareOpen] = useState(false);
  const grid = useRef<HTMLDivElement>(null);
  const timezone = root?.timezone ?? "Asia/Seoul";
  const canShare = hasAny(root?.me?.permissions, ["DASHBOARD_WRITE"]);
  const fetcher: WidgetFetcher = useCallback((widgetId, req, signal) => dashboardsApi.widgetData(dashboard.id, widgetId, req, signal), [dashboard.id]);
  const onValues = useCallback((next: Record<string, string>) => {
    // 주소만 바꾼다(loader를 다시 돌리지 않음). 새로고침·링크 공유에 같은 변수 값이 남는다
    const url = new URL(window.location.href);
    [...url.searchParams.keys()].filter((k) => k.startsWith("var-")).forEach((k) => url.searchParams.delete(k));
    for (const [k, v] of Object.entries(next)) url.searchParams.set(`var-${k}`, v);
    window.history.replaceState(window.history.state, "", url);
  }, []);
  const png = async () => {
    if (!grid.current) return;
    const background = getComputedStyle(document.documentElement).getPropertyValue("--d2f-bg").trim() || "#ffffff";
    try {
      downloadDataUrl(await nodeToPng(grid.current, background), exportFileName(dashboard.name, "png"));
    } catch {
      // 브라우저 제한으로 그리지 못하면 넘어간다
    }
  };
  return (
    <>
      <PageHeader title={dashboard.name} crumb={<Link to="/dashboards">{t("dashboards.title")}</Link>} />
      {dashboard.description && <p className="-mt-2 mb-3 text-[13px] text-muted">{dashboard.description}</p>}
      <DashboardView
        key={`${dashboard.id}:${dashboard.version}`}
        name={dashboard.name}
        widgets={dashboard.layout?.widgets ?? []}
        variables={dashboard.variables ?? []}
        timeRange={dashboard.timeRange}
        resolution={dashboard.resolution}
        refresh={dashboard.refresh}
        fetcher={fetcher}
        timezone={timezone}
        initialStates={initial}
        initialValues={values}
        variableOptions={options}
        onValuesChange={onValues}
        gridRef={grid}
        actions={
          <>
            <Button onClick={() => void png()}>PNG</Button>
            <Link to={kioskUrl([dashboard.id])} className="rounded-md border border-line px-3 py-1.5 text-[13px]">
              {t("dashboards.kiosk.open")}
            </Link>
            {canShare && <Button onClick={() => setShareOpen(true)}>{t("dashboards.share.title")}</Button>}
            {dashboard.editable && (
              <Link to={`/dashboards/${encodeURIComponent(dashboard.id)}/edit`} className="rounded-md border border-accent bg-accent px-3 py-1.5 text-[13px] text-white">
                {t("dashboards.edit.title")}
              </Link>
            )}
          </>
        }
      />
      {canShare && <ShareLinksDialog dashboardId={dashboard.id} open={shareOpen} onClose={() => setShareOpen(false)} timezone={timezone} />}
      <FeatureTour
        tourId={TOUR_ID}
        dismissed={toursDismissed}
        steps={[1, 2, 3, 4].map((n) => ({ title: t(`dashboards.tour.s${n}.title`), body: t(`dashboards.tour.s${n}.body`) }))}
        onDismiss={(id) => dashboardsApi.savePreferences({ toursDismissed: [...new Set([...toursDismissed, id])] })}
      />
    </>
  );
}
