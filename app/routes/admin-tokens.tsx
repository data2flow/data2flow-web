/**
 * UI-IAM-10 관리 보기(`/admin/tokens?tab=all|accounts|pending`, IAM-05.01~05.04). ADMIN(IAM_MANAGE).
 * 전체 토큰(소유자·서비스 계정 포함), 서비스 계정(만들기·비활성화·키 발급), 승인 대기(쓰기·제어 범위 [승인]·[거절]).
 */
import { useTranslation } from "react-i18next";
import { useRouteLoaderData } from "react-router";
import { callApi, callList } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { Alert, CountBadge, PageHeader, Tabs } from "~/components/ui";
import { defaultTokenApi } from "~/features/tokens/api";
import { ServiceAccountsPanel, TokenPanel } from "~/features/tokens/components";
import type { ServiceAccount, TokenItem } from "~/features/tokens/model";
import { errorText } from "~/lib/error-text";
import type { SpaceNode } from "~/lib/spaces";
import type { RootData } from "~/root";
import type { Route } from "./+types/admin-tokens";

const TABS = ["all", "accounts", "pending"] as const;

export function meta() {
  return [{ title: "data2flow" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = bff(context);
  const asked = new URL(request.url).searchParams.get("tab");
  const tab = (TABS as readonly string[]).includes(asked ?? "") ? (asked as (typeof TABS)[number]) : "all";
  const [all, pending, accounts, spaces] = await Promise.all([
    callList<TokenItem>(ctx, request, "/api/v1/core/api-tokens?owner=all&size=100"),
    callList<TokenItem>(ctx, request, "/api/v1/core/api-tokens?owner=all&status=PENDING_APPROVAL&size=100"),
    tab === "accounts" ? callList<ServiceAccount>(ctx, request, "/api/v1/core/service-accounts?size=100") : Promise.resolve(null),
    callApi<SpaceNode[]>(ctx, request, "/api/v1/core/spaces", { noGuards: true }),
  ]);
  const failed = !all.ok ? all : accounts && !accounts.ok ? accounts : null;
  return {
    tab,
    all: all.ok ? all.list.responses : [],
    pending: pending.ok ? pending.list.responses : [],
    accounts: accounts?.ok ? accounts.list.responses : [],
    spaces: spaces.ok ? (spaces.data ?? []) : null,
    failure: failed ? { code: failed.code, message: failed.message } : null,
  };
}

export default function AdminTokens({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const root = useRouteLoaderData("root") as RootData | undefined;
  const timezone = root?.timezone ?? "Asia/Seoul";
  const { tab } = loaderData;
  return (
    <>
      <PageHeader crumb={t("nav.admin")} title={t("tokens.adminTitle")} />
      <Tabs
        current={tab}
        items={TABS.map((key) => ({ key, to: `/admin/tokens?tab=${key}`, label: key === "pending" ? <>{t("tokens.tabs.pending")}<CountBadge n={loaderData.pending.length} /></> : t(`tokens.tabs.${key}`) }))}
      />
      {loaderData.failure && <Alert tone="danger">{errorText(t, loaderData.failure)}</Alert>}
      {tab === "all" && <TokenPanel key="all" initial={loaderData.all} query={{ owner: "all" }} canIssue api={defaultTokenApi} timezone={timezone} permissions={root?.me?.permissions} role={root?.me?.role} spaces={loaderData.spaces} showOwner />}
      {tab === "pending" && <TokenPanel key="pending" initial={loaderData.pending} query={{ owner: "all", status: "PENDING_APPROVAL" }} canIssue={false} approvals api={defaultTokenApi} timezone={timezone} spaces={loaderData.spaces} showOwner />}
      {tab === "accounts" && <ServiceAccountsPanel initial={loaderData.accounts} api={defaultTokenApi} spaces={loaderData.spaces} timezone={timezone} />}
    </>
  );
}
