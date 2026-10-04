/**
 * UI-ACT-02 명령 이력 — 조직 전체 보기(`/control/commands`, ACT-04.03). 기기 상세 [명령 이력] 탭과 같은 화면이다.
 * 권한: 조회 DEV_READ(VIEWER 이상, 메뉴는 DEVICE_CONTROL), 취소 DEVICE_CONTROL. API: API-ACT-02 `GET /api/v1/core/commands?spaceId&cursor&size`(커서 목록)
 */
import { useTranslation } from "react-i18next";
import { useRouteLoaderData, useSearchParams } from "react-router";
import { callList } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { Card, PageHeader } from "~/components/ui";
import { ControlAreaTabs } from "~/features/control/area-tabs";
import { CommandHistory, HistoryFilters } from "~/features/control/command-history";
import { historyQuery, type Command } from "~/features/control/model/control";
import { hasAny } from "~/lib/permissions";
import type { RootData } from "~/root";
import type { Route } from "./+types/control-commands";

export function meta() {
  return [{ title: "data2flow" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = bff(context);
  const url = new URL(request.url);
  const query = historyQuery(url.searchParams, 50, { spaceId: url.searchParams.get("spaceId") });
  const result = await callList<Command>(ctx, request, `/api/v1/core/commands?${query}`);
  return { rows: result.ok ? result.list.responses : [], nextCursor: result.ok ? (result.list.nextCursor ?? null) : null, failed: !result.ok };
}

export default function ControlCommands({ loaderData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const [params] = useSearchParams();
  const root = useRouteLoaderData("root") as RootData | undefined;
  const { rows, nextCursor, failed } = loaderData;
  const more = new URLSearchParams(params);
  if (nextCursor) more.set("cursor", nextCursor);
  const spaceId = params.get("spaceId");
  return (
    <>
      <PageHeader crumb={t("nav.control")} title={t("control.history.title")} />
      <ControlAreaTabs current="commands" permissions={root?.me?.permissions} />
      <Card>
        <HistoryFilters hidden={spaceId ? { spaceId } : {}} />
        <CommandHistory
          key={rows.map((r) => r.id).join(",")}
          rows={rows}
          failed={failed}
          moreHref={nextCursor ? `?${more}` : null}
          showDevice
          canControl={hasAny(root?.me?.permissions, ["DEVICE_CONTROL"])}
          timezone={root?.timezone ?? "Asia/Seoul"}
          lang={i18n.language}
        />
      </Card>
    </>
  );
}
