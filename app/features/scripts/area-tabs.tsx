/**
 * 수집 > 스크립트 안의 구역 탭(UI-SCR 메뉴 위치: 스크립트 목록 · 공유 모듈 · 수식 항목, 00-navigation.md §2)
 */
import { useTranslation } from "react-i18next";
import { Tabs } from "~/components/ui";

export type ScriptArea = "scripts" | "modules" | "formulas";

export function ScriptAreaTabs({ current }: { current: ScriptArea }) {
  const { t } = useTranslation();
  return (
    <Tabs
      current={current}
      items={[
        { key: "scripts", label: t("scripts.area.scripts"), to: "/scripts" },
        { key: "modules", label: t("scripts.area.modules"), to: "/scripts/modules" },
        { key: "formulas", label: t("scripts.area.formulas"), to: "/scripts/formulas" },
      ]}
    />
  );
}
