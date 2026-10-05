/**
 * 분석 영역 탭(00-navigation.md 분석 메뉴): 템플릿 갤러리 · 분석 목록 · 모델 · MCP 연결. 모델 관리(UI-ANA-06)는 ANALYTICS_RUN(A 이상),
 * MCP 연결(UI-AIA-07)은 토큰 발급 권한(API_TOKEN_ISSUE)이 있을 때만.
 */
import { useTranslation } from "react-i18next";
import { useRouteLoaderData } from "react-router";
import { Tabs } from "~/components/ui";
import { hasAny } from "~/lib/permissions";
import type { RootData } from "~/root";

export function AnalyticsAreaTabs({ current }: { current: "templates" | "analyses" | "models" | "mcp" }) {
  const { t } = useTranslation();
  const root = useRouteLoaderData("root") as RootData | undefined;
  const canRun = hasAny(root?.me?.permissions, ["ANALYTICS_RUN"]);
  const items = [
    { key: "templates", label: t("analytics.area.templates"), to: "/analytics/templates" },
    { key: "analyses", label: t("analytics.area.analyses"), to: "/analytics" },
    ...(canRun ? [{ key: "models", label: t("analytics.area.models"), to: "/analytics/models" }] : []),
    ...(hasAny(root?.me?.permissions, ["API_TOKEN_ISSUE"]) ? [{ key: "mcp", label: t("analytics.area.mcp"), to: "/ai/mcp" }] : []),
  ];
  return <Tabs items={items} current={current} section />;
}
