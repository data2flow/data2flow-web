/**
 * UI-IAM-08 회원 상세(IAM-01.04, IAM-01.07, IAM-01.10, IAM-02.03, IAM-03.03, IAM-04.03).
 * 역할·공간 저장(API-IAM-23), 모든 세션 종료(API-IAM-24), 비활성화·재활성화·잠금 해제·삭제(API-IAM-25~28),
 * 2단계 초기화(API-IAM-63), 최근 활동(API-IAM-50). 자기 자신은 역할·상태를 바꿀 수 없다(BR-IAM-08).
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Form, Link, data, redirect, useRouteLoaderData } from "react-router";
import { callApi, callList, field, orThrow } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { getMe } from "~/bff/user.server";
import { RoleOptions, type CustomRoleRow } from "~/components/role-options";
import { Alert, Badge, Button, Card, CsrfField, PageHeader, SelectField, Table, TextField } from "~/components/ui";
import { errorText } from "~/lib/error-text";
import { formatDateTime } from "~/lib/format";
import { hasAny } from "~/lib/permissions";
import { parseRole, roleValue, scopeFromForm } from "~/lib/roles";
import { ScopeField } from "~/components/space-picker";
import { findSpace, type SpaceNode } from "~/lib/spaces";
import type { RootData } from "~/root";
import type { Route } from "./+types/admin-member-detail";

interface UserDetail {
  id: string;
  loginId: string;
  email?: string;
  name?: string;
  phone?: string;
  status?: string;
  role?: string;
  customRoleId?: string | null;
  spaceScope?: ({ id: string; name?: string } | string)[];
  mfaEnabled?: boolean;
  lockedUntil?: string | null;
  lastLoginAt?: string;
  lastLoginIp?: string;
  activeSessionCount?: number;
  createdAt?: string;
  version?: number;
}

interface AuditRow {
  id: string;
  occurredAt?: string;
  action?: string;
  targetType?: string;
  targetId?: string;
  result?: string;
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const ctx = bff(context);
  const id = encodeURIComponent(params.userId);
  const [user, roles, spaceTree] = await Promise.all([
    callApi<UserDetail>(ctx, request, `/api/v1/core/users/${id}`),
    callList<CustomRoleRow>(ctx, request, "/api/v1/core/custom-roles"),
    // 공간 범위는 트리에서 고른다(IAM-01.07, IAM-04.02). 못 불러오면 ID 입력
    callApi<SpaceNode[]>(ctx, request, "/api/v1/core/spaces"),
  ]);
  const detail = orThrow(user);
  const root = await getMe(ctx, request);
  let activity: AuditRow[] = [];
  if (root.ok && hasAny(root.data.permissions, ["AUDIT_READ"])) {
    const audit = await callList<AuditRow>(ctx, request, `/api/v1/core/audit-logs?actor=${id}&size=20`);
    if (audit.ok) activity = audit.list.responses;
  }
  return { user: detail, customRoles: roles.ok ? roles.list.responses : [], activity, spaces: spaceTree.ok && Array.isArray(spaceTree.data) ? spaceTree.data : null };
}

const ACTIONS: Record<string, { method: string; suffix: string }> = {
  "revoke-sessions": { method: "POST", suffix: "/sessions/revoke-all" },
  disable: { method: "POST", suffix: "/disable" },
  enable: { method: "POST", suffix: "/enable" },
  unlock: { method: "POST", suffix: "/unlock" },
  "reset-mfa": { method: "DELETE", suffix: "/mfa" },
};

export async function action({ request, context, params }: Route.ActionArgs) {
  const ctx = bff(context);
  const form = await request.formData();
  const intent = field(form, "intent");
  const base = `/api/v1/core/users/${encodeURIComponent(params.userId)}`;
  if (intent === "role") {
    const role = parseRole(field(form, "role"));
    const result = await callApi(ctx, request, `${base}/role`, {
      method: "PUT",
      body: { role: role.role, customRoleId: role.customRoleId ?? null, spaceScope: scopeFromForm(form), baseVersion: Number(field(form, "baseVersion")) },
    });
    return result.ok ? { intent, done: true } : data({ intent, error: { code: result.code, message: result.message } }, { status: result.status });
  }
  if (intent === "delete") {
    const confirmLoginId = field(form, "confirmLoginId").trim();
    if (confirmLoginId !== field(form, "loginId")) return data({ intent, error: { code: "CONFIRM_MISMATCH" } }, { status: 400 });
    const result = await callApi(ctx, request, base, { method: "DELETE", body: { confirmLoginId } });
    if (result.ok) throw redirect("/admin/members");
    return data({ intent, error: { code: result.code, message: result.message } }, { status: result.status });
  }
  const spec = ACTIONS[intent];
  if (!spec) return data({ intent, error: { code: "INVALID_REQUEST" } }, { status: 400 });
  const body = intent === "disable" ? { reason: field(form, "reason") || undefined } : undefined;
  const result = await callApi(ctx, request, `${base}${spec.suffix}`, { method: spec.method, body });
  return result.ok ? { intent, done: true } : data({ intent, error: { code: result.code, message: result.message } }, { status: result.status });
}

function ActionButton({ intent, label, confirm, variant = "secondary", disabled }: { intent: string; label: string; confirm: string; variant?: "secondary" | "danger"; disabled?: boolean }) {
  return (
    <Form
      method="post"
      onSubmit={(event) => {
        if (!window.confirm(confirm)) event.preventDefault();
      }}
    >
      <CsrfField />
      <input type="hidden" name="intent" value={intent} />
      <Button type="submit" variant={variant} disabled={disabled}>
        {label}
      </Button>
    </Form>
  );
}

export default function AdminMemberDetail({ loaderData, actionData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const root = useRouteLoaderData("root") as RootData;
  const { user, customRoles, activity, spaces } = loaderData;
  const self = root.me?.id === user.id;
  const scopeIds = (user.spaceScope ?? []).map((s) => (typeof s === "string" ? s : String(s.id)));
  const result = actionData as { intent?: string; done?: boolean; error?: { code: string; message?: string } } | undefined;
  const [confirmId, setConfirmId] = useState("");
  const fmt = (iso?: string | null) => formatDateTime(iso ?? undefined, root.timezone, i18n.language);
  const disabled = user.status === "DISABLED";
  return (
    <>
      <PageHeader
        crumb={
          <Link to="/admin/members" className="hover:underline">
            {t("nav.members")}
          </Link>
        }
        title={`${user.name ?? ""} (${user.loginId})`}
        actions={user.status && <Badge tone={user.status === "ACTIVE" ? "success" : "neutral"}>{t(`userStatus.${user.status}`, { defaultValue: user.status })}</Badge>}
      />
      {result?.done && (
        <div className="mb-3">
          <Alert tone="success">{t("common.done")}</Alert>
        </div>
      )}
      {result?.error && (
        <div className="mb-3">
          <Alert tone="danger">{result.error.code === "CONFIRM_MISMATCH" ? t("members.detail.confirmMismatch") : errorText(t, result.error)}</Alert>
        </div>
      )}
      {self && (
        <div className="mb-3">
          <Alert tone="info">{t("errors.SELF_MODIFICATION_FORBIDDEN")}</Alert>
        </div>
      )}
      <div className="grid gap-4">
        <Card title={t("members.detail.basic")}>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            <dt className="text-muted">{t("members.email")}</dt>
            <dd>{user.email}</dd>
            <dt className="text-muted">{t("me.profile.phone")}</dt>
            <dd>{user.phone ?? "–"}</dd>
            <dt className="text-muted">{t("members.detail.createdAt")}</dt>
            <dd>{fmt(user.createdAt)}</dd>
            <dt className="text-muted">{t("members.lastLogin")}</dt>
            <dd>
              {fmt(user.lastLoginAt)} <span className="font-mono text-muted">{user.lastLoginIp}</span>
            </dd>
          </dl>
        </Card>

        <Card title={t("members.detail.permissions")}>
          <Form method="post" className="flex flex-wrap items-end gap-3">
            <CsrfField />
            <input type="hidden" name="intent" value="role" />
            <input type="hidden" name="baseVersion" value={user.version ?? 0} />
            <SelectField label={t("members.role")} name="role" defaultValue={roleValue(user.role, user.customRoleId)} disabled={self}>
              <RoleOptions customRoles={customRoles} />
            </SelectField>
            {self ? (
              <p className="text-[13px]">
                {t("members.spaceScope")}: {scopeIds.length === 0 ? t("members.allSpaces") : scopeIds.map((sid) => findSpace(spaces ?? [], sid)?.path.join(" › ") ?? sid).join(", ")}
              </p>
            ) : (
              <div className="min-w-72">
                <ScopeField spaces={spaces} label={t("members.spaceScope")} hint={t("members.spaceScopeHint")} defaultValue={scopeIds} />
              </div>
            )}
            <Button type="submit" variant="primary" disabled={self}>
              {t("common.save")}
            </Button>
          </Form>
        </Card>

        <Card title={t("members.detail.security")}>
          <div className="flex flex-wrap items-center gap-3">
            <span>
              {t("members.mfa")}: {user.mfaEnabled ? t("me.security.mfaOn") : t("me.security.mfaOff")}
            </span>
            {user.mfaEnabled && <ActionButton intent="reset-mfa" label={t("members.detail.resetMfa")} confirm={t("members.detail.confirm")} />}
            <span>
              {t("members.detail.lock")}: {user.status === "LOCKED" ? t("userStatus.LOCKED") : t("members.detail.notLocked")}
            </span>
            {user.status === "LOCKED" && <ActionButton intent="unlock" label={t("members.detail.unlock")} confirm={t("members.detail.confirm")} />}
            <span>{t("members.detail.sessions", { count: user.activeSessionCount ?? 0 })}</span>
            <ActionButton intent="revoke-sessions" label={t("members.detail.revokeAll")} confirm={t("members.detail.confirmRevoke")} variant="danger" />
          </div>
        </Card>

        <Card title={t("members.detail.danger")}>
          <div className="flex flex-wrap items-end gap-3">
            {disabled ? (
              <ActionButton intent="enable" label={t("members.detail.enable")} confirm={t("members.detail.confirm")} disabled={self} />
            ) : (
              <ActionButton intent="disable" label={t("members.detail.disable")} confirm={t("members.detail.confirmDisable")} variant="danger" disabled={self} />
            )}
            <Form method="post" className="flex items-end gap-2">
              <CsrfField />
              <input type="hidden" name="intent" value="delete" />
              <input type="hidden" name="loginId" value={user.loginId} />
              <TextField label={t("members.detail.deleteConfirm", { loginId: user.loginId })} name="confirmLoginId" value={confirmId} onChange={(e) => setConfirmId(e.target.value)} disabled={self} />
              <Button type="submit" variant="danger" disabled={self || confirmId !== user.loginId}>
                {t("members.detail.delete")}
              </Button>
            </Form>
          </div>
        </Card>

        {activity.length > 0 && (
          <Card
            title={t("members.detail.activity")}
            actions={
              <Link to={`/admin/audit?actor=${encodeURIComponent(user.id)}`} className="text-accent hover:underline">
                {t("members.detail.viewAll")}
              </Link>
            }
          >
            <Table>
              <tbody>
                {activity.map((row) => (
                  <tr key={row.id}>
                    <td>{fmt(row.occurredAt)}</td>
                    <td className="font-mono">{row.action}</td>
                    <td>
                      {row.targetType} {row.targetId}
                    </td>
                    <td>{row.result}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        )}
      </div>
    </>
  );
}
