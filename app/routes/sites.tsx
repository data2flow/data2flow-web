/**
 * /sites 사이트 요약(UI-DEV-15, DEV-10.01·10.02, API-DEV-25). 지도 타일은 외부 서비스라 CSP·운영 정책상 M2에서 쓰지 않고,
 * 사이트 카드(기기·오프라인·열린 알람·쾌적도 점수, 좌표)만 보여 준다.
 */
import { useTranslation } from "react-i18next";
import { Link, useLoaderData } from "react-router";
import { callApi } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { Alert, Card, EmptyState, PageHeader, Tabs } from "~/components/ui";
import type { Route } from "./+types/sites";

interface SiteSummary {
  siteId: string;
  name: string;
  lat?: number | null;
  lng?: number | null;
  devices?: number;
  offline?: number;
  openAlarms?: number;
  comfortScore?: number | null;
}

export function meta() {
  return [{ title: "data2flow" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const result = await callApi<SiteSummary[] | { responses?: SiteSummary[] }>(bff(context), request, "/api/v1/core/sites/summary");
  if (!result.ok) return { sites: [] as SiteSummary[], error: result.code };
  const sites = Array.isArray(result.data) ? result.data : (result.data?.responses ?? []);
  return { sites, error: undefined as string | undefined };
}

export default function Sites() {
  const { t } = useTranslation();
  const { sites, error } = useLoaderData<typeof loader>();
  return (
    <>
      <PageHeader title={t("sites.title")} crumb={t("nav.spaces")} />
      <Tabs current="sites" items={[{ key: "spaces", label: t("nav.spaces"), to: "/spaces" }, { key: "sites", label: t("sites.title"), to: "/sites" }]} />
      {error && <Alert tone="danger">{t(`errors.${error}`, { defaultValue: t("errors.UNKNOWN") })}</Alert>}
      {!error && sites.length === 0 && <EmptyState title={t("sites.empty")} action={<Link className="text-accent underline" to="/spaces">{t("sites.goSpaces")}</Link>} />}
      <ul className="grid gap-3 md:grid-cols-2">
        {sites.map((site) => (
          <li key={site.siteId}>
            <Card title={<Link to={`/spaces/${site.siteId}`} className="text-accent hover:underline">{site.name}</Link>}>
              <p className="text-[13px]">{t("sites.stats", { devices: site.devices ?? 0, offline: site.offline ?? 0, alarms: site.openAlarms ?? 0 })}</p>
              {site.comfortScore !== null && site.comfortScore !== undefined && <p className="text-[13px]">{t("sites.comfort", { score: site.comfortScore })}</p>}
              <p className="font-mono text-[12px] text-muted">{site.lat !== null && site.lat !== undefined ? `${site.lat}, ${site.lng}` : t("sites.noLocation")}</p>
            </Card>
          </li>
        ))}
      </ul>
    </>
  );
}
