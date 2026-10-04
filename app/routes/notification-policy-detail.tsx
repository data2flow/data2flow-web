/**
 * UI-RUL-06 알림 정책 만들기·편집(RUL-03.02·03.03·03.06, BR-RUL-12·13·15·16). `/notifications/policies/new`는 새 정책.
 * API: 상세·생성·수정·삭제 API-RUL-21(수정은 baseVersion, 다르면 409 VERSION_CONFLICT; 설정 안 된 채널 409 CHANNEL_NOT_CONFIGURED),
 * 템플릿 API-RUL-22, 규칙 API-RUL-01(선택 목록), 채널 유형 API-OPS-34, 공간 API-DEV-01, 회원 API-IAM-31(관리자만, 없으면 ID 입력)
 */
import { useTranslation } from "react-i18next";
import { Form, redirect, useNavigation, useRouteLoaderData, useSearchParams } from "react-router";
import { callApi, field, newIdempotencyKey, orThrow } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { Alert, Button, ButtonLink, Card, CsrfField, PageHeader } from "~/components/ui";
import { NotifyTabs, ResultAlert } from "~/features/notify/components/common";
import { PolicyForm } from "~/features/notify/components/policy-form";
import { checkPolicy, emptyPolicy, normalizePolicy, parsePolicyForm, policyBody, serverPolicyErrors, type PolicyErrors } from "~/features/notify/model/policy";
import { normalizeTemplate } from "~/features/notify/model/template";
import { done, failed, invalid, loadChannelTypes, loadRows, loadSpaces, loadUsers, type NotifyActionResult } from "~/features/notify/server";
import { hasAny } from "~/lib/permissions";
import type { RootData } from "~/root";
import type { Route } from "./+types/notification-policy-detail";

export function meta() {
  return [{ title: "data2flow" }];
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const ctx = bff(context);
  const creating = params.policyId === "new";
  const [detail, spaces, rules, templates, channelTypes, users] = await Promise.all([
    creating ? null : callApi<Record<string, unknown>>(ctx, request, `/api/v1/core/notification-policies/${encodeURIComponent(params.policyId)}`),
    loadSpaces(ctx, request),
    loadRows<{ ruleId?: string | number; id?: string | number; name: string }>(ctx, request, "/api/v1/core/rules?size=100"),
    loadRows<Record<string, unknown>>(ctx, request, "/api/v1/core/notification-templates"),
    loadChannelTypes(ctx, request),
    loadUsers(ctx, request),
  ]);
  return {
    creating,
    policy: detail ? normalizePolicy(orThrow(detail)) : emptyPolicy(),
    spaces,
    rules: rules.ok ? rules.rows.map((r) => ({ id: String(r.ruleId ?? r.id), name: r.name })) : null,
    templates: templates.rows.map(normalizeTemplate),
    channelTypes,
    users: users.users,
    usersAvailable: users.available,
    idempotencyKey: newIdempotencyKey(),
  };
}

export async function action({ request, context, params }: Route.ActionArgs) {
  const ctx = bff(context);
  const form = await request.formData();
  const creating = params.policyId === "new";
  const path = `/api/v1/core/notification-policies/${encodeURIComponent(params.policyId)}`;
  if (field(form, "intent") === "delete") {
    const result = await callApi(ctx, request, path, { method: "DELETE" });
    if (!result.ok) return failed("delete", result);
    throw redirect("/notifications/policies");
  }
  const { input, stepsInvalid } = parsePolicyForm(form);
  const errors = checkPolicy(input, stepsInvalid);
  if (Object.keys(errors).length) return invalid("save", errors);
  const baseVersion = Number(field(form, "baseVersion") || 0);
  const result = creating
    ? await callApi<Record<string, unknown>>(ctx, request, "/api/v1/core/notification-policies", { method: "POST", body: policyBody(input), idempotencyKey: field(form, "idempotencyKey") || newIdempotencyKey() })
    : await callApi<Record<string, unknown>>(ctx, request, path, { method: "PUT", body: policyBody(input, baseVersion) });
  if (!result.ok) return failed("save", result, serverPolicyErrors(result));
  if (creating) {
    const id = String(result.data?.notificationPolicyId ?? result.data?.id ?? "");
    throw redirect(id ? `/notifications/policies/${encodeURIComponent(id)}?saved=1` : "/notifications/policies");
  }
  return done("save", "notify.policy.saved");
}

export default function NotificationPolicyDetail({ loaderData, actionData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const root = useRouteLoaderData("root") as RootData | undefined;
  const navigation = useNavigation();
  const canWrite = hasAny(root?.me?.permissions, ["NOTIFY_POLICY_WRITE"]);
  const { creating, policy } = loaderData;
  const result = actionData as NotifyActionResult | undefined;
  const conflict = result?.error?.code === "VERSION_CONFLICT";
  const [params] = useSearchParams();
  const saved = !result && params.get("saved") === "1";
  return (
    <>
      <PageHeader crumb={t("notify.policy.title")} title={creating ? t("notify.policy.newTitle") : policy.name} actions={<ButtonLink to="/notifications/policies">{t("common.back")}</ButtonLink>} />
      <NotifyTabs current="policies" />
      {conflict ? (
        <div className="mb-3">
          <Alert tone="danger">{t("notify.policy.conflict")}</Alert>
        </div>
      ) : (
        <ResultAlert result={result?.error?.code === "CHANNEL_NOT_CONFIGURED" ? undefined : result} />
      )}
      {saved && <ResultAlert result={{ done: "notify.policy.saved" }} />}
      <Card>
        <Form method="post" className="flex flex-col gap-4" key={`${policy.notificationPolicyId}:${policy.version}`}>
          <CsrfField />
          <input type="hidden" name="baseVersion" value={policy.version} />
          <input type="hidden" name="idempotencyKey" value={loaderData.idempotencyKey} />
          <PolicyForm
            policy={policy}
            spaces={loaderData.spaces}
            rules={loaderData.rules}
            templates={loaderData.templates}
            channelTypes={loaderData.channelTypes}
            users={loaderData.users}
            usersAvailable={loaderData.usersAvailable}
            errors={result?.fieldErrors as PolicyErrors | undefined}
            readOnly={!canWrite}
          />
          {canWrite && (
            <div className="flex justify-between">
              <span>
                {!creating && (
                  <Button type="submit" name="intent" value="delete" variant="danger" formNoValidate onClick={(e) => (window.confirm(t("notify.policy.deleteConfirm")) ? undefined : e.preventDefault())}>
                    {t("common.delete")}
                  </Button>
                )}
              </span>
              <Button type="submit" name="intent" value="save" variant="primary" disabled={navigation.state === "submitting"}>
                {t("common.save")}
              </Button>
            </div>
          )}
        </Form>
      </Card>
    </>
  );
}
