/**
 * 층 전환 바(DSH-12.04, AT-DSH-13.1): 건물의 층을 위·아래 버튼으로 바꾸고 URL에 층(`?floor={층 공간 ID}`)을 남긴다.
 * 층 목록은 GET /core/buildings/{id}/floors. 현재 층 이름과 "n / 전체"를 함께 보인다.
 */
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { cx } from "~/components/ui";
import type { FloorNav } from "../model/location";

const LINK = "inline-flex h-8 items-center rounded-md border border-line px-3 text-[13px]";

export function FloorSwitcher({ nav, total, hrefFor }: { nav: FloorNav; total: number; hrefFor: (floorId: string) => string }) {
  const { t } = useTranslation();
  if (!nav.current) return null;
  return (
    <div role="group" aria-label={t("floor.switch.label")} className="mb-3 flex flex-wrap items-center gap-2">
      {nav.up ? (
        <Link to={hrefFor(nav.up.spaceId)} className={cx(LINK, "hover:bg-accent-soft")} aria-label={t("floor.switch.up", { name: nav.up.name })}>
          ▲
        </Link>
      ) : (
        <span aria-disabled className={cx(LINK, "text-muted opacity-50")}>
          ▲
        </span>
      )}
      {nav.down ? (
        <Link to={hrefFor(nav.down.spaceId)} className={cx(LINK, "hover:bg-accent-soft")} aria-label={t("floor.switch.down", { name: nav.down.name })}>
          ▼
        </Link>
      ) : (
        <span aria-disabled className={cx(LINK, "text-muted opacity-50")}>
          ▼
        </span>
      )}
      <strong className="text-[14px]" aria-live="polite">
        {nav.current.name}
      </strong>
      <span className="text-[12px] text-muted">{t("floor.switch.position", { n: nav.index + 1, total })}</span>
      {!nav.current.hasFloorplan && <span className="text-[12px] text-fair-ink">{t("floor.switch.noPlan")}</span>}
    </div>
  );
}
