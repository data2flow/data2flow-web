/**
 * UI-DEV-22 설치 현황판(`/devices/installation?siteId=`, DEV-13.06, API-DEV-138). DEV_READ.
 * 사이트는 공간 트리의 SITE. 층별 숫자는 `space:{사이트}` 실시간 `commissioning` 이벤트로 다시 읽는다(AT-DEV-28.2).
 */
import { useTranslation } from "react-i18next";
import { useRouteLoaderData } from "react-router";
import { callApi } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { ButtonLink, PageHeader } from "~/components/ui";
import { DeviceAreaTabs } from "~/features/devices/area-tabs";
import { InstallationBoard } from "~/features/field/components/installation-board";
import type { BoardFloor } from "~/features/field/model/commissioning";
import { hasAny } from "~/lib/permissions";
import { flattenSpaces, type SpaceNode } from "~/lib/spaces";
import type { RootData } from "~/root";
import type { Route } from "./+types/devices-installation";

export function meta() {
  return [{ title: "data2flow" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = bff(context);
  const url = new URL(request.url);
  const spaces = await callApi<SpaceNode[]>(ctx, request, "/api/v1/core/spaces");
  const sites = spaces.ok ? flattenSpaces(spaces.data ?? []).filter((s) => s.type === "SITE").map((s) => ({ id: s.id, name: s.name })) : [];
  const siteId = url.searchParams.get("siteId") || sites[0]?.id || null;
  const board = await callApi<{ siteId?: string; floors: BoardFloor[] }>(ctx, request, `/api/v1/core/installation-board${siteId ? `?siteId=${encodeURIComponent(siteId)}` : ""}`);
  return { sites, siteId, floors: board.ok ? (board.data.floors ?? []) : [], failed: !board.ok };
}

export default function DevicesInstallation({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const root = useRouteLoaderData("root") as RootData | undefined;
  const canPlace = hasAny(root?.me?.permissions, ["DEV_PLACE"]);
  const site = loaderData.sites.find((s) => s.id === loaderData.siteId);
  return (
    <>
      <PageHeader title={site ? t("field.board.titleSite", { site: site.name }) : t("field.board.title")} actions={canPlace && <ButtonLink to="/m/commission">{t("field.board.commission")}</ButtonLink>} />
      <DeviceAreaTabs current="installation" />
      <InstallationBoard key={loaderData.siteId ?? ""} sites={loaderData.sites} siteId={loaderData.siteId} initial={loaderData.floors} failed={loaderData.failed} timezone={root?.timezone ?? "Asia/Seoul"} canPrint={canPlace} />
    </>
  );
}
