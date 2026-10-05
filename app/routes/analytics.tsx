/**
 * UI-ANA-04 분석 목록(`/analytics?owner=me|all&keyword=&templateKey=`, ANA-04). 조회 ANALYTICS_READ(권한 범위 안의 분석만, BR-ANA-03).
 */
import { useTranslation } from "react-i18next";
import { Form, useRouteLoaderData } from "react-router";
import { callList } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { Alert, ButtonLink, PageHeader, Pager, SelectField, TextField } from "~/components/ui";
import { defaultAnalyticsApi } from "~/features/analytics/api";
import { AnalysesList } from "~/features/analytics/components/analyses-list";
import { AnalyticsAreaTabs } from "~/features/analytics/components/area-tabs";
import type { AnalysisSummary } from "~/features/analytics/model/types";
import { errorText } from "~/lib/error-text";
import { hasAny } from "~/lib/permissions";
import type { RootData } from "~/root";
import type { Route } from "./+types/analytics";

export function meta() {
  return [{ title: "data2flow" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = bff(context);
  const url = new URL(request.url);
  const owner = url.searchParams.get("owner") === "all" ? "all" : "me";
  const keyword = (url.searchParams.get("keyword") ?? "").slice(0, 100);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const q = new URLSearchParams({ owner, page: String(page), size: "50" });
  if (keyword) q.set("keyword", keyword);
  const list = await callList<AnalysisSummary>(ctx, request, `/api/v1/core/analytics/analyses?${q}`);
  return { owner, keyword, page, items: list.ok ? list.list.responses : [], totalPages: list.ok ? list.list.totalPages : 1, failure: list.ok ? null : { code: list.code, message: list.message } };
}

export default function Analyses({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const root = useRouteLoaderData("root") as RootData | undefined;
  const permissions = root?.me?.permissions;
  const canRun = hasAny(permissions, ["ANALYTICS_RUN"]);
  return (
    <>
      <PageHeader crumb={t("analytics.crumb")} title={t("analytics.list.title")} actions={canRun ? <ButtonLink variant="primary" to="/analytics/templates">{t("analytics.list.new")}</ButtonLink> : undefined} />
      <AnalyticsAreaTabs current="analyses" />
      <Form method="get" className="mb-3 flex flex-wrap items-end gap-2">
        <div className="w-32">
          <SelectField label={t("analytics.list.owner")} name="owner" defaultValue={loaderData.owner}>
            <option value="me">{t("analytics.list.ownerMe")}</option>
            <option value="all">{t("analytics.list.ownerAll")}</option>
          </SelectField>
        </div>
        <TextField label={t("analytics.list.name")} name="keyword" defaultValue={loaderData.keyword} />
        <button type="submit" className="rounded-md border border-line bg-panel px-3 py-1.5 text-[13px]">
          {t("common.search")}
        </button>
      </Form>
      {loaderData.failure && <Alert tone="danger">{errorText(t, loaderData.failure)}</Alert>}
      <AnalysesList key={`${loaderData.owner}:${loaderData.keyword}:${loaderData.page}`} initial={loaderData.items} canRun={canRun} isAdmin={root?.me?.role === "ADMIN"} meId={root?.me?.id} api={defaultAnalyticsApi} timezone={root?.timezone ?? "Asia/Seoul"} />
      <Pager page={loaderData.page} totalPages={loaderData.totalPages} />
    </>
  );
}
