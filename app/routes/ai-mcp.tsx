/**
 * UI-AIA-07 MCP 연결 안내·토큰(`/ai/mcp`, AIA-08, API-AIA-17·API-AIA-09). 발급 권한(API_TOKEN_ISSUE)이 있는 역할만 연다(VIEWER 제외).
 * ADMIN은 조직 전체 토큰을 관리 화면(`/admin/tokens`)에서 본다.
 */
import { useTranslation } from "react-i18next";
import { Link, useRouteLoaderData } from "react-router";
import { callApi, callList } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { Card, PageHeader } from "~/components/ui";
import { McpConnect } from "~/features/ai/components/mcp-connect";
import { AnalyticsAreaTabs } from "~/features/analytics/components/area-tabs";
import type { McpTool } from "~/features/ai/model/types";
import { defaultTokenApi } from "~/features/tokens/api";
import { TokenPanel } from "~/features/tokens/components";
import type { TokenItem } from "~/features/tokens/model";
import { hasAny } from "~/lib/permissions";
import type { SpaceNode } from "~/lib/spaces";
import type { RootData } from "~/root";
import type { Route } from "./+types/ai-mcp";

export function meta() {
  return [{ title: "data2flow" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = bff(context);
  const [tools, tokens, spaces] = await Promise.all([
    callApi<McpTool[]>(ctx, request, "/api/v1/ai/mcp/tools", { noGuards: true }),
    callList<TokenItem>(ctx, request, "/api/v1/core/api-tokens?owner=me&kind=MCP&size=100"),
    callApi<SpaceNode[]>(ctx, request, "/api/v1/core/spaces", { noGuards: true }),
  ]);
  return {
    tools: tools.ok ? (tools.data ?? []) : [],
    toolsError: tools.ok ? null : { code: tools.code, message: tools.message },
    tokens: tokens.ok ? tokens.list.responses : [],
    spaces: spaces.ok ? (spaces.data ?? []) : null,
  };
}

export default function AiMcp({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const root = useRouteLoaderData("root") as RootData | undefined;
  const permissions = root?.me?.permissions;
  return (
    <>
      <PageHeader crumb={t("analytics.crumb")} title={t("ai.mcp.title")} />
      <AnalyticsAreaTabs current="mcp" />
      <div className="flex flex-col gap-3">
        <McpConnect tools={loaderData.tools} toolsError={loaderData.toolsError} />
        <Card title={t("ai.mcp.myTokens")} actions={root?.me?.role === "ADMIN" ? <Link to="/admin/tokens" className="text-[12.5px] text-accent hover:underline">{t("ai.mcp.orgTokens")}</Link> : undefined}>
          <TokenPanel initial={loaderData.tokens} query={{ owner: "me", kind: "MCP" }} canIssue={hasAny(permissions, ["API_TOKEN_ISSUE"])} fixedKind="MCP" api={defaultTokenApi} timezone={root?.timezone ?? "Asia/Seoul"} permissions={permissions} role={root?.me?.role} spaces={loaderData.spaces} />
        </Card>
      </div>
    </>
  );
}
