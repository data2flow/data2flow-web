/**
 * UI-AIA-06 AI 설정·사용량·평가(`/settings/ai?tab=settings|usage|eval`, AIA-07.04~07.07). ADMIN.
 * AI가 꺼져 있어도 설정 탭은 연다(API-AIA-07은 AI_DISABLED가 없다).
 */
import { useTranslation } from "react-i18next";
import { useRouteLoaderData } from "react-router";
import { callApi, orThrow } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { PageHeader, Tabs } from "~/components/ui";
import { defaultAiApi } from "~/features/ai/api";
import { EvalTab, SettingsTab, UsageTab } from "~/features/ai/components/ai-admin";
import type { AiSettings } from "~/features/ai/model/types";
import type { RootData } from "~/root";
import type { Route } from "./+types/settings-ai";

const TABS = ["settings", "usage", "eval"] as const;

export function meta() {
  return [{ title: "data2flow" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = bff(context);
  const asked = new URL(request.url).searchParams.get("tab");
  const tab = (TABS as readonly string[]).includes(asked ?? "") ? (asked as (typeof TABS)[number]) : "settings";
  const settings = orThrow(await callApi<AiSettings>(ctx, request, "/api/v1/ai/settings"));
  return { tab, settings };
}

export default function SettingsAi({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const root = useRouteLoaderData("root") as RootData | undefined;
  const timezone = root?.timezone ?? "Asia/Seoul";
  const { tab, settings } = loaderData;
  return (
    <>
      <PageHeader crumb={t("nav.admin")} title={t("ai.admin.title")} />
      <Tabs current={tab} items={TABS.map((key) => ({ key, label: t(`ai.admin.tabs.${key}`), to: `/settings/ai?tab=${key}` }))} />
      {tab === "settings" && <SettingsTab initial={settings} api={defaultAiApi} timezone={timezone} />}
      {tab === "usage" && <UsageTab api={defaultAiApi} />}
      {tab === "eval" && <EvalTab api={defaultAiApi} model={settings.model} timezone={timezone} />}
    </>
  );
}
