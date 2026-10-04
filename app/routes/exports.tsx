/**
 * UI-TSD-02 내보내기 작업 · UI-TSD-08 정기 내보내기·데이터 사전(`/exports?tab=jobs|schedules|dictionary`, TSD-04.01·04.03·07.02·07.04).
 * 작업·정기 내보내기는 TS_EXPORT(ANALYST 이상), 데이터 사전은 TS_READ(VIEWER 이상). BI 계정·피드 탭은 범위 밖이라 없다(ADR-028).
 * API: API-TSD-21 목록, API-TSD-23 정기 목록, API-TSD-59 데이터 사전.
 */
import { useTranslation } from "react-i18next";
import { useRouteLoaderData } from "react-router";
import { callApi, callList } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { getMe } from "~/bff/user.server";
import { PageHeader, Tabs } from "~/components/ui";
import { DictionaryPanel, ExportJobsPanel, SchedulesPanel } from "~/features/data/components/exports-panels";
import type { DataDictionary } from "~/features/data/model/dictionary";
import type { ExportJob, ExportSchedule } from "~/features/data/model/exports";
import type { RootData } from "~/root";
import type { Route } from "./+types/exports";

export function meta() {
  return [{ title: "data2flow" }];
}

const TABS = ["jobs", "schedules", "dictionary"] as const;

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = bff(context);
  const url = new URL(request.url);
  const me = await getMe(ctx, request);
  const canExport = me.ok && me.data.permissions.includes("TS_EXPORT");
  const asked = url.searchParams.get("tab");
  const tab = (TABS as readonly string[]).includes(asked ?? "") && (canExport || asked === "dictionary") ? (asked as (typeof TABS)[number]) : canExport ? "jobs" : "dictionary";
  if (tab === "jobs") {
    const jobs = await callList<ExportJob>(ctx, request, "/api/v1/core/exports?page=1&size=20");
    return { tab, canExport, jobs: jobs.ok ? jobs.list.responses : [], failed: !jobs.ok, schedules: [] as ExportSchedule[], dictionary: null };
  }
  if (tab === "schedules") {
    const schedules = await callList<ExportSchedule>(ctx, request, "/api/v1/core/export-schedules?size=100");
    return { tab, canExport, jobs: [] as ExportJob[], schedules: schedules.ok ? schedules.list.responses : [], failed: !schedules.ok, dictionary: null };
  }
  const dictionary = await callApi<DataDictionary>(ctx, request, "/api/v1/core/data-dictionary?format=json");
  return { tab, canExport, jobs: [] as ExportJob[], schedules: [] as ExportSchedule[], dictionary: dictionary.ok ? dictionary.data : null, failed: !dictionary.ok };
}

export default function Exports({ loaderData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const root = useRouteLoaderData("root") as RootData | undefined;
  const timezone = root?.timezone ?? "Asia/Seoul";
  const { tab, canExport } = loaderData;
  const tabs = [...(canExport ? (["jobs", "schedules"] as const) : []), "dictionary" as const].map((key) => ({ key, label: t(`data.tabs.${key}`), to: `/exports?tab=${key}` }));
  return (
    <>
      <PageHeader crumb={t("explore.crumb")} title={t("data.jobs.title")} />
      <Tabs items={tabs} current={tab} />
      {tab === "jobs" && <ExportJobsPanel initial={loaderData.jobs} failed={loaderData.failed} timezone={timezone} lang={i18n.language} />}
      {tab === "schedules" && <SchedulesPanel initial={loaderData.schedules} failed={loaderData.failed} timezone={timezone} lang={i18n.language} />}
      {tab === "dictionary" && <DictionaryPanel dictionary={loaderData.dictionary} failed={loaderData.failed} timezone={timezone} lang={i18n.language} />}
    </>
  );
}
