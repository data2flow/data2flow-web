/**
 * UI-DSC-04 외부 맥락 데이터 — 사이트 고르기(`/sources/context`, DSC-06). 사이트가 하나면 바로 그 사이트 화면으로 간다.
 * 조회 SRC_READ(OPERATOR+). 사이트는 공간 트리(API-DEV-01)의 SITE.
 */
import { useTranslation } from "react-i18next";
import { Link, redirect } from "react-router";
import { callApi } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { Card, EmptyState, PageHeader } from "~/components/ui";
import { IngestTabs } from "~/features/sources/components/common";
import type { SpaceNode } from "~/lib/spaces";
import type { Route } from "./+types/sources-context";

export function meta() {
  return [{ title: "data2flow" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = bff(context);
  const tree = await callApi<SpaceNode[]>(ctx, request, "/api/v1/core/spaces");
  const sites = (tree.ok ? (tree.data ?? []) : []).filter((s) => s.type === "SITE" && s.accessible !== false).map((s) => ({ id: String(s.id), name: s.name }));
  if (sites.length === 1) throw redirect(`/sources/context/${encodeURIComponent(sites[0].id)}`);
  return { sites, failed: !tree.ok };
}

export default function SourcesContext({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader title={t("context.title")} />
      <IngestTabs current="context" />
      {loaderData.sites.length === 0 ? (
        <EmptyState title={loaderData.failed ? t("context.loadFailed") : t("context.noSites")} />
      ) : (
        <Card title={t("context.chooseSite")}>
          <ul className="flex flex-col gap-1">
            {loaderData.sites.map((s) => (
              <li key={s.id}>
                <Link to={`/sources/context/${s.id}`} className="text-accent hover:underline">
                  {s.name}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
