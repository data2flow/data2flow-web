/**
 * 수집 메뉴 안의 구역 탭(00-navigation.md §2 "수집"): 수집 모니터 · 데이터 소스 · 스크립트 · 실패 메시지 · 재처리(M5, INGEST_REPROCESS) · 데이터 품질(M5)
 */
import { useTranslation } from "react-i18next";
import { useRouteLoaderData } from "react-router";
import { Tabs } from "~/components/ui";
import { hasAny } from "~/lib/permissions";
import type { RootData } from "~/root";

export type IngestArea = "monitor" | "sources" | "scripts" | "failures" | "reprocess" | "quality";

export function IngestAreaTabs({ current }: { current: IngestArea }) {
  const { t } = useTranslation();
  const root = useRouteLoaderData("root") as RootData | undefined;
  const permissions = root?.me?.permissions;
  return (
    <Tabs
      section
      current={current}
      items={[
        { key: "monitor", label: t("ingest.area.monitor"), to: "/ingest/monitor" },
        { key: "sources", label: t("ingest.area.sources"), to: "/sources" },
        { key: "scripts", label: t("ingest.area.scripts"), to: "/scripts" },
        { key: "failures", label: t("ingest.area.failures"), to: "/ingest/failures" },
        ...(hasAny(permissions, ["INGEST_REPROCESS"]) ? [{ key: "reprocess", label: t("ingest.area.reprocess"), to: "/ingest/reprocess" }] : []),
        ...(hasAny(permissions, ["INGEST_READ", "ANALYTICS_RUN"]) ? [{ key: "quality", label: t("ingest.area.quality"), to: "/ingest/quality" }] : []),
      ]}
    />
  );
}
