/**
 * 위치 경로(DSH-09.02): 사이트 › 건물 › 층 › 실, 각 단계는 그 단계 화면으로 가는 링크. 마지막(현재) 단계는 글자만.
 * 포트폴리오에서 내려오면 맨 앞에 "포트폴리오"를 둔다(AT-DSH-12.4).
 */
import { Fragment } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import type { Crumb } from "~/features/floorplan/model/location";

export function LocationPath({ crumbs, from }: { crumbs: readonly Crumb[]; from?: string | null }) {
  const { t } = useTranslation();
  const items: { key: string; label: string; to?: string }[] = [];
  if (from === "portfolio") items.push({ key: "portfolio", label: t("floor.path.portfolio"), to: "/portfolio" });
  crumbs.forEach((c, i) => items.push({ key: c.id, label: c.name, to: i === crumbs.length - 1 ? undefined : c.to }));
  return (
    <nav aria-label={t("floor.path.label")} className="text-[12.5px] text-muted">
      {items.map((item, i) => (
        <Fragment key={item.key}>
          {i > 0 && <span aria-hidden> › </span>}
          {item.to ? (
            <Link to={item.to} className="hover:text-accent hover:underline">
              {item.label}
            </Link>
          ) : (
            <span aria-current="page">{item.label}</span>
          )}
        </Fragment>
      ))}
    </nav>
  );
}
