/**
 * 데이터 소스 구역 하위 탭(00-navigation §2): 소스 목록 · 출력 연결(`/sources?tab=outputs`, UI-DSC-05) · 엣지 게이트웨이(`/sources/edges`, UI-DSC-10).
 */
import { useTranslation } from "react-i18next";
import { Tabs } from "~/components/ui";

export function SourcesSubTabs({ current }: { current: "sources" | "outputs" | "edges" }) {
  const { t } = useTranslation();
  return (
    <Tabs
      current={current}
      items={[
        { key: "sources", label: t("sources.sub.sources"), to: "/sources" },
        { key: "outputs", label: t("sources.sub.outputs"), to: "/sources?tab=outputs" },
        { key: "edges", label: t("sources.sub.edges"), to: "/sources/edges" },
      ]}
    />
  );
}
