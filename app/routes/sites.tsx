/**
 * /sites 사이트 지도·요약(UI-DSH-09 + UI-DEV-15, DSH-09.01, DEV-10.01·10.02). 상태(알람·오프라인·쾌적도 요약)는 API-DSH-17,
 * 기기 수·쾌적 점수는 API-DEV-25. 지도는 위·경도를 SVG에 찍는다(외부 타일 없음, CSP·운영 정책). [지도/목록] 토글은 `?view=list`.
 * 위치 정보가 없는 사이트는 목록에만 나오고, 둘 다 실패하면 오류 안내.
 */
import { useTranslation } from "react-i18next";
import { Link, useLoaderData } from "react-router";
import { callApi } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { Alert, EmptyState, PageHeader, Tabs } from "~/components/ui";
import { SiteCard, SiteMap, SiteViewToggle } from "~/features/spaces/components/site-map";
import { mergeSites, type SiteMapRow, type SiteSummaryRow } from "~/features/spaces/model/site-map";
import type { Route } from "./+types/sites";

export function meta() {
  return [{ title: "data2flow" }];
}

const rows = <T,>(data: T[] | { sites?: T[]; responses?: T[] } | null | undefined): T[] => (Array.isArray(data) ? data : (data?.sites ?? data?.responses ?? []));

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = bff(context);
  const url = new URL(request.url);
  const [map, summary] = await Promise.all([
    callApi<SiteMapRow[] | { sites?: SiteMapRow[] }>(ctx, request, "/api/v1/core/sites/map"),
    callApi<SiteSummaryRow[] | { responses?: SiteSummaryRow[] }>(ctx, request, "/api/v1/core/sites/summary"),
  ]);
  const error = !map.ok && !summary.ok ? map.code : undefined;
  const sites = mergeSites(map.ok ? rows(map.data) : null, summary.ok ? rows(summary.data) : null);
  return { sites, error, view: url.searchParams.get("view") === "list" ? ("list" as const) : ("map" as const) };
}

export default function Sites() {
  const { t } = useTranslation();
  const { sites, error, view } = useLoaderData<typeof loader>();
  return (
    <>
      <PageHeader title={t("sites.title")} crumb={t("nav.spaces")} actions={sites.length > 0 && <SiteViewToggle view={view} />} />
      <Tabs section current="sites" items={[{ key: "spaces", label: t("nav.spaces"), to: "/spaces" }, { key: "sites", label: t("sites.title"), to: "/sites" }, { key: "calendar", label: t("calendar.title"), to: "/calendar" }]} />
      {error && <Alert tone="danger">{t(`errors.${error}`, { defaultValue: t("errors.UNKNOWN") })}</Alert>}
      {!error && sites.length === 0 && <EmptyState title={t("sites.empty")} action={<Link className="text-accent underline" to="/spaces">{t("sites.goSpaces")}</Link>} />}
      {sites.length > 0 && view === "map" && (
        <div className="mb-4">
          <SiteMap sites={sites} />
        </div>
      )}
      <ul className="grid gap-3 md:grid-cols-2">
        {sites.map((site) => (
          <li key={site.id} className="min-w-0">
            <SiteCard site={site} />
          </li>
        ))}
      </ul>
    </>
  );
}
