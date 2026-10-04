/**
 * UI-RUL-06 알림 정책 목록(RUL-03.02). 경로 권한 NOTIFY_POLICY_WRITE(OPERATOR 이상, 00-navigation.md §2).
 * API: 목록 API-RUL-21 `GET /notification-policies`, 삭제 `DELETE …/{id}`(사용 중이면 409 POLICY_IN_USE). 공간 이름은 API-DEV-01
 */
import { useTranslation } from "react-i18next";
import { Form, Link, useRouteLoaderData } from "react-router";
import { callApi, callList, field, listOrThrow } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { Button, ButtonLink, Card, CsrfField, EmptyState, PageHeader, Pager, Table } from "~/components/ui";
import { NotifyTabs, ResultAlert, SeverityBadge } from "~/features/notify/components/common";
import { normalizePolicyRow } from "~/features/notify/model/policy";
import { done, failed, loadSpaces, type NotifyActionResult } from "~/features/notify/server";
import { formatDateTime } from "~/lib/format";
import { hasAny } from "~/lib/permissions";
import { findSpace } from "~/lib/spaces";
import type { RootData } from "~/root";
import type { Route } from "./+types/notification-policies";

export function meta() {
  return [{ title: "data2flow" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = bff(context);
  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const [list, spaces] = await Promise.all([callList<Record<string, unknown>>(ctx, request, `/api/v1/core/notification-policies?page=${page}&size=50`), loadSpaces(ctx, request)]);
  const envelope = listOrThrow(list);
  return { rows: envelope.responses.map(normalizePolicyRow), page, totalPages: envelope.totalPages, spaces };
}

export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  const id = field(form, "policyId");
  const result = await callApi(bff(context), request, `/api/v1/core/notification-policies/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!result.ok) return failed("delete", result);
  return done("delete", "notify.policy.deleted");
}

export default function NotificationPolicies({ loaderData, actionData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const root = useRouteLoaderData("root") as RootData | undefined;
  const canWrite = hasAny(root?.me?.permissions, ["NOTIFY_POLICY_WRITE"]);
  const { rows, page, totalPages, spaces } = loaderData;
  const result = actionData as NotifyActionResult | undefined;
  return (
    <>
      <PageHeader crumb={t("notify.crumb")} title={t("notify.policy.title")} actions={canWrite && <ButtonLink to="/notifications/policies/new" variant="primary">{t("notify.policy.new")}</ButtonLink>} />
      <NotifyTabs current="policies" />
      <ResultAlert result={result} />
      {rows.length === 0 ? (
        <EmptyState title={t("notify.policy.empty")} body={t("notify.policy.emptyBody")} action={canWrite && <ButtonLink to="/notifications/policies/new" variant="primary">{t("notify.policy.new")}</ButtonLink>} />
      ) : (
        <Card>
          <Table>
            <thead>
              <tr>
                <th>{t("notify.policy.name")}</th>
                <th>{t("notify.policy.condition")}</th>
                <th>{t("notify.policy.recipients")}</th>
                <th>{t("notify.policy.channels")}</th>
                <th>{t("notify.policy.steps")}</th>
                <th>{t("notify.policy.updatedAt")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.notificationPolicyId}>
                  <td>
                    <Link to={`/notifications/policies/${encodeURIComponent(row.notificationPolicyId)}`} className="text-accent hover:underline">
                      {row.name}
                    </Link>
                  </td>
                  <td>
                    <span className="inline-flex items-center gap-1.5">
                      <SeverityBadge severity={row.minSeverity} />
                      {row.spaceId ? (findSpace(spaces, row.spaceId)?.path.join(" › ") ?? row.spaceId) : t("notify.policy.allSpaces")}
                    </span>
                  </td>
                  <td>{t("notify.policy.recipientCount", { count: row.recipientCount })}</td>
                  <td>{row.channels.map((c) => t(`notify.channel.${c}`, { defaultValue: c })).join(", ")}</td>
                  <td>{row.stepCount ? t("notify.policy.stepCount", { count: row.stepCount }) : t("notify.policy.noSteps")}</td>
                  <td>{formatDateTime(row.updatedAt, root?.timezone ?? "Asia/Seoul", i18n.language)}</td>
                  <td>
                    {canWrite && (
                      <Form method="post" onSubmit={(e) => (window.confirm(t("notify.policy.deleteConfirm")) ? undefined : e.preventDefault())}>
                        <CsrfField />
                        <input type="hidden" name="policyId" value={row.notificationPolicyId} />
                        <Button type="submit" variant="ghost">
                          {t("common.delete")}
                        </Button>
                      </Form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pager page={page} totalPages={totalPages} />
        </Card>
      )}
    </>
  );
}
