/**
 * UI-DSH-09 사이트 지도(DSH-09.01): SVG 위에 사이트 마커(상태 색 + 기호, 툴팁)와 사이트 카드(열린 알람·오프라인·쾌적도·[들어가기]),
 * [지도/목록] 토글. 지도 타일은 쓰지 않는다(CSP `img-src 'self'`, 외부 타일 서비스 미연결). 위치 없는 사이트는 목록에만 나온다.
 */
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Card, cx } from "~/components/ui";
import { projectSites, STATUS_STYLE, type SiteView } from "../model/site-map";

const WIDTH = 640;
const HEIGHT = 360;

export function SiteCard({ site }: { site: SiteView }) {
  const { t } = useTranslation();
  const style = STATUS_STYLE[site.status];
  return (
    <Card
      title={
        <span className="inline-flex items-center gap-2">
          <span aria-hidden style={{ color: style.color }}>
            {style.icon}
          </span>
          {site.name}
        </span>
      }
      actions={
        <Link to={`/spaces/${encodeURIComponent(site.id)}`} className="inline-flex min-h-[44px] items-center text-[12.5px] text-accent hover:underline">
          {t("sites.enter")}
        </Link>
      }
    >
      <p className="text-[13px]" data-site-status={site.status}>
        {t(`sites.status.${site.status}`)}
      </p>
      <p className="text-[13px]">
        {site.devices !== null ? t("sites.stats", { devices: site.devices, offline: site.offline, alarms: site.alarms }) : t("sites.mapStats", { offline: site.offline, alarms: site.alarms })}
      </p>
      {site.comfortScore !== null && <p className="text-[13px]">{t("sites.comfort", { score: site.comfortScore })}</p>}
      {site.comfortSummary && <p className="text-[12.5px] text-muted">{t("sites.comfortSummary", { summary: site.comfortSummary })}</p>}
      <p className="font-mono text-[12px] text-muted">{site.lat !== null ? `${site.lat}, ${site.lng}` : t("sites.noLocation")}</p>
    </Card>
  );
}

export function SiteMap({ sites }: { sites: SiteView[] }) {
  const { t } = useTranslation();
  const points = projectSites(sites, WIDTH, HEIGHT);
  const missing = sites.length - points.length;
  return (
    <figure className="m-0">
      {points.length === 0 ? (
        <p className="rounded-lg border border-line bg-panel p-6 text-center text-[13px] text-muted">{t("sites.noLocations")}</p>
      ) : (
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={t("sites.mapLabel")} className="h-auto w-full max-w-full rounded-lg border border-line bg-panel">
          {points.map(({ site, x, y }) => {
            const style = STATUS_STYLE[site.status];
            return (
              <a key={site.id} href={`/spaces/${encodeURIComponent(site.id)}`} aria-label={`${site.name} · ${t(`sites.status.${site.status}`)}`} data-marker={site.id}>
                <title>{`${site.name} · ${t("sites.mapStats", { offline: site.offline, alarms: site.alarms })}`}</title>
                <circle cx={x} cy={y} r={11} fill={style.color} stroke="var(--color-panel)" strokeWidth={2} />
                <text x={x} y={y + 4} textAnchor="middle" fontSize={11} fill="#fff" aria-hidden>
                  {style.icon}
                </text>
                <text x={x} y={y + 26} textAnchor="middle" fontSize={12} fill="var(--color-text)">
                  {site.name}
                </text>
              </a>
            );
          })}
        </svg>
      )}
      <figcaption className="mt-2 flex flex-wrap gap-3 text-[12px] text-muted">
        {(["ALARM", "OFFLINE", "OK"] as const).map((status) => (
          <span key={status} className="inline-flex items-center gap-1">
            <span aria-hidden style={{ color: STATUS_STYLE[status].color }}>
              {STATUS_STYLE[status].icon}
            </span>
            {t(`sites.status.${status}`)}
          </span>
        ))}
        {missing > 0 && <span>{t("sites.missingLocation", { n: missing })}</span>}
      </figcaption>
    </figure>
  );
}

export function SiteViewToggle({ view }: { view: "map" | "list" }) {
  const { t } = useTranslation();
  return (
    <div role="group" aria-label={t("sites.viewToggle")} className="inline-flex overflow-hidden rounded-md border border-line text-[13px]">
      {(["map", "list"] as const).map((key) => (
        <Link key={key} to={key === "map" ? "/sites" : "/sites?view=list"} aria-current={view === key ? "page" : undefined} className={cx("inline-flex min-h-[44px] items-center px-3", view === key ? "bg-accent text-white" : "bg-panel text-text")}>
          {t(`sites.view.${key}`)}
        </Link>
      ))}
    </div>
  );
}
