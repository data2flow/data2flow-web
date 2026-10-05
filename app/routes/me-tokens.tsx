/**
 * UI-IAM-10 개인 보기 — 내 정보 > API 토큰(`/me/tokens`, IAM-04.07·05.01~05.03). 발급 권한(API_TOKEN_ISSUE, VIEWER 제외)이 있어야 [새 토큰].
 * 원문은 발급·교체 대화상자에서 한 번만 보인다.
 */
import { useTranslation } from "react-i18next";
import { useRouteLoaderData } from "react-router";
import { callApi, callList } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { Alert } from "~/components/ui";
import { defaultTokenApi } from "~/features/tokens/api";
import { TokenPanel } from "~/features/tokens/components";
import type { TokenItem } from "~/features/tokens/model";
import { errorText } from "~/lib/error-text";
import { hasAny } from "~/lib/permissions";
import type { SpaceNode } from "~/lib/spaces";
import type { RootData } from "~/root";
import type { Route } from "./+types/me-tokens";

export function meta() {
  return [{ title: "data2flow" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = bff(context);
  const [tokens, spaces] = await Promise.all([callList<TokenItem>(ctx, request, "/api/v1/core/api-tokens?owner=me&size=100"), callApi<SpaceNode[]>(ctx, request, "/api/v1/core/spaces", { noGuards: true })]);
  return { tokens: tokens.ok ? tokens.list.responses : [], failure: tokens.ok ? null : { code: tokens.code, message: tokens.message }, spaces: spaces.ok ? (spaces.data ?? []) : null };
}

export default function MeTokens({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const root = useRouteLoaderData("root") as RootData | undefined;
  const permissions = root?.me?.permissions;
  const canIssue = hasAny(permissions, ["API_TOKEN_ISSUE"]);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[13px] text-muted">{t("tokens.meIntro")}</p>
      {!canIssue && <Alert tone="info">{t("tokens.noIssue")}</Alert>}
      {loaderData.failure && <Alert tone="danger">{errorText(t, loaderData.failure)}</Alert>}
      <TokenPanel initial={loaderData.tokens} query={{ owner: "me" }} canIssue={canIssue} api={defaultTokenApi} timezone={root?.timezone ?? "Asia/Seoul"} permissions={permissions} role={root?.me?.role} spaces={loaderData.spaces} />
    </div>
  );
}
