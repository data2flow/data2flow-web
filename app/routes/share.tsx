/**
 * UI-DSH-07 공유 링크 보기(`/share/{token}`·`/share/d/{token}`, DSH-06.03, API-DSH-15). 로그인 없이 연다(세션을 쓰지 않음).
 * 읽기 전용: 제어·편집·내보내기 메뉴 없음(제어 위젯은 core가 이미 뺌), 상단에 "읽기 전용 공유 화면 · 만료 {날짜}".
 * 만료·폐기·없는 토큰은 "유효하지 않은 링크입니다"(404). 주소가 새지 않게 Referrer-Policy no-referrer, 검색 제외 noindex.
 * 위젯 데이터는 BFF 공개 경로 `GET /share/{token}/widgets/{widget-id}/data`(share-widget-data.ts)로 받는다.
 */
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { data, useRouteLoaderData } from "react-router";
import { bff } from "~/bff/middleware.server";
import { Logo } from "~/components/logo";
import { sharedWidgetData } from "~/features/dashboards/api";
import { DashboardView } from "~/features/dashboards/components/dashboard-view";
import { toBffUrl } from "~/features/dashboards/components/widget-body";
import type { WidgetFetcher } from "~/features/dashboards/components/use-dashboard-data";
import { loadShared } from "~/features/dashboards/server";
import { formatDateTime } from "~/lib/format";
import type { RootData } from "~/root";
import type { Route } from "./+types/share";

export function meta() {
  return [{ title: "data2flow" }, { name: "robots", content: "noindex" }, { name: "referrer", content: "no-referrer" }];
}

export function headers() {
  return { "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex", "Cache-Control": "no-store" };
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const ctx = bff(context);
  const token = params.token ?? "";
  const r = await loadShared(ctx, request, token);
  if (!r.ok) throw data({ code: "SHARE_LINK_INVALID" }, { status: 404, headers: { "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex" } });
  return { token, shared: r.shared };
}

export default function Share({ loaderData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const root = useRouteLoaderData("root") as RootData | undefined;
  const { token, shared } = loaderData;
  const d = shared.dashboard;
  const timezone = root?.timezone ?? "Asia/Seoul";
  const fetcher: WidgetFetcher = useCallback((widgetId, req, signal) => sharedWidgetData(token, widgetId, req, signal), [token]);
  const logo = toBffUrl(shared.branding?.logoUrl ?? shared.branding?.logoLightUrl ?? null);
  const color = shared.branding?.primaryColor;
  return (
    <div className="min-h-screen" style={color ? ({ "--d2f-accent": color } as React.CSSProperties) : undefined}>
      <header className="flex flex-wrap items-center gap-3 border-b border-line bg-panel px-4 py-2">
        {logo ? <img src={logo} alt="" className="h-6" /> : <Logo to="#" />}
        <h1 className="text-[15px] font-semibold">{d.name}</h1>
        <p role="note" className="ml-auto rounded bg-fair-soft px-2 py-0.5 text-[12px] text-fair-ink">
          {t("dashboards.shareView.banner", { date: formatDateTime(shared.expiresAt, timezone, i18n.language) })}
        </p>
      </header>
      <main className="p-4">
        <DashboardView
          name={d.name}
          widgets={d.layout?.widgets ?? []}
          variables={d.variables ?? []}
          timeRange={d.timeRange}
          resolution={d.resolution}
          refresh={d.refresh}
          fetcher={fetcher}
          timezone={timezone}
          live={false}
          noExport
        />
      </main>
    </div>
  );
}

export function ErrorBoundary() {
  const { t } = useTranslation();
  return (
    <main className="mx-auto max-w-md p-8 text-center">
      <p role="alert" className="text-[16px] font-semibold">
        {t("dashboards.shareView.invalid")}
      </p>
    </main>
  );
}
