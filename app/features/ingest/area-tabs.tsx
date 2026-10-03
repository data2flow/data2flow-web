/**
 * 수집 메뉴 안의 구역 탭(00-navigation.md §2 "수집"): 수집 모니터 · 데이터 소스 · 스크립트 · 실패 메시지
 */
import { useTranslation } from "react-i18next";
import { Tabs } from "~/components/ui";

export type IngestArea = "monitor" | "sources" | "scripts" | "failures";

export function IngestAreaTabs({ current }: { current: IngestArea }) {
  const { t } = useTranslation();
  return (
    <Tabs
      current={current}
      items={[
        { key: "monitor", label: t("ingest.area.monitor"), to: "/ingest/monitor" },
        { key: "sources", label: t("ingest.area.sources"), to: "/sources" },
        { key: "scripts", label: t("ingest.area.scripts"), to: "/scripts" },
        { key: "failures", label: t("ingest.area.failures"), to: "/ingest/failures" },
      ]}
    />
  );
}
