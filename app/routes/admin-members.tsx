/**
 * UI-IAM-06 회원 관리 목록 + UI-IAM-07 초대·직접 생성(IAM-01.03, IAM-01.07, IAM-01.08). ADMIN(`IAM_MANAGE`)만.
 * API: 회원 API-IAM-31, 초대 API-IAM-20·22·29·33, 직접 생성 API-IAM-21, 비활성화 API-IAM-25, 가입 신청 API-IAM-69
 * 공간 범위 지정은 공간 계층(DEV-01.01, M2)이 생긴 뒤 트리 선택으로 바꾼다. M1에서는 비우면 전체다.
 */
import { useTranslation } from "react-i18next";
import { Form, Link, data, useNavigation, useRouteLoaderData, useSearchParams } from "react-router";
import { callApi, callList, field, listOrThrow, newIdempotencyKey } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { Alert, Badge, Button, ButtonLink, Card, CsrfField, PageHeader, SelectField, Table, Tabs, TextArea, TextField } from "~/components/ui";
import { RoleOptions, type CustomRoleRow } from "~/components/role-options";
import { BUILTIN_ROLES, type ListEnvelope } from "~/lib/api-types";
import { parseRole, parseScope } from "~/lib/roles";
import { errorText, policyErrorText } from "~/lib/error-text";
import { formatDateTime } from "~/lib/format";
import { checkLoginId, checkName, parseEmails } from "~/lib/validation";
import type { RootData } from "~/root";
import type { Route } from "./+types/admin-members";

interface UserSummary {
  id: string;
  name?: string;
  loginId?: string;
  email?: string;
  role?: string;
  customRoleName?: string;
  spaceScopeSummary?: string;
  status?: string;
  mfaEnabled?: boolean;
  lastLoginAt?: string;
}

interface InvitationRow {
  id: string;
  email: string;
  role?: string;
  status?: string;
  sentCount?: number;
  invitedBy?: string | { name?: string };
  expiresAt?: string;
}

interface SignupRow {
  id: string;
  email?: string;
  name?: string;
  loginId?: string;
  message?: string;
  createdAt?: string;
}


const TABS = ["members", "invitations", "signups"] as const;
type Tab = (typeof TABS)[number];
const STATUSES = ["ACTIVE", "INVITED", "LOCKED", "DISABLED", "PENDING_APPROVAL"];
const PAGE_SIZE = 50;

export function meta() {
  return [{ title: "data2flow" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = bff(context);
  const url = new URL(request.url);
  const tabParam = url.searchParams.get("tab");
  const tab: Tab = (TABS as readonly string[]).includes(tabParam ?? "") ? (tabParam as Tab) : "members";
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const [policy, roles] = await Promise.all([
    callApi<{ signupRequestEnabled?: boolean }>(ctx, request, "/api/v1/core/security-policy"),
    callList<CustomRoleRow>(ctx, request, "/api/v1/core/custom-roles"),
  ]);
  const signupEnabled = policy.ok && Boolean(policy.data?.signupRequestEnabled);
  let members: ListEnvelope<UserSummary> | undefined;
  let invitations: ListEnvelope<InvitationRow> | undefined;
  let signups: ListEnvelope<SignupRow> | undefined;
  if (tab === "members") {
    const query = new URLSearchParams({ page: String(page), size: String(PAGE_SIZE) });
    for (const key of ["keyword", "role", "status"]) {
      const value = url.searchParams.get(key);
      if (value) query.set(key, value);
    }
    members = listOrThrow(await callList<UserSummary>(ctx, request, `/api/v1/core/users?${query}`));
  } else if (tab === "invitations") {
    invitations = listOrThrow(await callList<InvitationRow>(ctx, request, `/api/v1/core/invitations?status=PENDING&page=${page}&size=${PAGE_SIZE}`));
  } else if (signupEnabled) {
    signups = listOrThrow(await callList<SignupRow>(ctx, request, `/api/v1/core/signup-requests?status=PENDING_APPROVAL&page=${page}&size=${PAGE_SIZE}`));
  }
  return {
    tab,
    page,
    signupEnabled,
    customRoles: roles.ok ? roles.list.responses : [],
    members,
    invitations,
    signups,
    idempotencyKey: newIdempotencyKey(),
  };
}


type ActionResult =
  | { intent: "invite"; results?: { email: string; status: string; resultCode?: string }[]; error?: { code: string; message?: string }; fieldError?: string }
  | { intent: "create"; temporaryPassword?: string; loginId?: string; error?: { code: string; message?: string }; fieldError?: string }
  | { intent: "bulk-disable"; results: { id: string; ok: boolean; code?: string }[] }
  | { intent: string; done?: boolean; error?: { code: string; message?: string }; fieldError?: string };

export async function action({ request, context }: Route.ActionArgs) {
  const ctx = bff(context);
  const form = await request.formData();
  const intent = field(form, "intent");
  const idempotencyKey = field(form, "idempotencyKey") || newIdempotencyKey();
  const fail = (result: { code: string; message: string; status: number }) =>
    data({ intent, error: { code: result.code, message: result.message } } as ActionResult, { status: result.status });

  switch (intent) {
    case "invite": {
      const { emails, invalid } = parseEmails(field(form, "emails"));
      if (emails.length === 0 || invalid.length > 0 || emails.length > 20) return data({ intent, fieldError: "emails" } as ActionResult, { status: 400 });
      const role = parseRole(field(form, "role"));
      const name = field(form, "name").trim();
      const result = await callApi<{ results: { email: string; status: string; resultCode?: string }[] }>(ctx, request, "/api/v1/core/invitations", {
        method: "POST",
        idempotencyKey,
        body: { emails, name: emails.length === 1 && name ? name : undefined, role: role.role, customRoleId: role.customRoleId, spaceScope: parseScope(field(form, "spaceScope")) },
      });
      if (!result.ok) return fail(result);
      return { intent, results: result.data?.results ?? [] } as ActionResult;
    }
    case "create": {
      const loginId = field(form, "loginId").trim().toLowerCase();
      const email = field(form, "email").trim().toLowerCase();
      const name = field(form, "name").trim();
      if (checkLoginId(loginId)) return data({ intent, fieldError: "loginId" } as ActionResult, { status: 400 });
      if (!parseEmails(email).emails.length) return data({ intent, fieldError: "email" } as ActionResult, { status: 400 });
      if (checkName(name)) return data({ intent, fieldError: "name" } as ActionResult, { status: 400 });
      const role = parseRole(field(form, "role"));
      const temporaryPassword = field(form, "temporaryPassword") || undefined;
      const result = await callApi<{ id: string; temporaryPassword?: string }>(ctx, request, "/api/v1/core/users", {
        method: "POST",
        idempotencyKey,
        body: { loginId, email, name, role: role.role, customRoleId: role.customRoleId, spaceScope: parseScope(field(form, "spaceScope")), temporaryPassword },
      });
      if (!result.ok) return fail(result);
      return { intent, loginId, temporaryPassword: result.data?.temporaryPassword ?? temporaryPassword } as ActionResult;
    }
    case "resend":
    case "cancel": {
      const id = encodeURIComponent(field(form, "id"));
      const result = await callApi(ctx, request, `/api/v1/core/invitations/${id}/${intent}`, { method: "POST" });
      return result.ok ? ({ intent, done: true } as ActionResult) : fail(result);
    }
    case "approve": {
      const spaceScope = parseScope(field(form, "spaceScope"));
      const roleValue = field(form, "role");
      if (!roleValue || spaceScope.length === 0) return data({ intent, fieldError: "approve" } as ActionResult, { status: 400 });
      const role = parseRole(roleValue);
      const id = encodeURIComponent(field(form, "id"));
      const result = await callApi(ctx, request, `/api/v1/core/signup-requests/${id}/approve`, {
        method: "POST",
        body: { role: role.role, customRoleId: role.customRoleId, spaceScope },
      });
      return result.ok ? ({ intent, done: true } as ActionResult) : fail(result);
    }
    case "reject": {
      const reason = field(form, "reason").trim();
      if (reason.length < 2 || reason.length > 200) return data({ intent, fieldError: "reason" } as ActionResult, { status: 400 });
      const id = encodeURIComponent(field(form, "id"));
      const result = await callApi(ctx, request, `/api/v1/core/signup-requests/${id}/reject`, { method: "POST", body: { reason } });
      return result.ok ? ({ intent, done: true } as ActionResult) : fail(result);
    }
    case "bulk-disable": {
      const ids = form.getAll("userId").filter((v): v is string => typeof v === "string");
      const results = [];
      for (const id of ids) {
        const result = await callApi(ctx, request, `/api/v1/core/users/${encodeURIComponent(id)}/disable`, { method: "POST", body: {} });
        results.push(result.ok ? { id, ok: true } : { id, ok: false, code: result.code });
      }
      return { intent, results } as ActionResult;
    }
    default:
      return data({ intent, error: { code: "INVALID_REQUEST" } } as ActionResult, { status: 400 });
  }
}

const STATUS_TONE: Record<string, "success" | "warning" | "danger" | "info" | "neutral"> = {
  ACTIVE: "success",
  INVITED: "info",
  LOCKED: "warning",
  DISABLED: "neutral",
  PENDING_APPROVAL: "info",
};

function roleLabel(t: (k: string, o?: Record<string, unknown>) => string, user: { role?: string; customRoleName?: string }) {
  if (user.role === "CUSTOM") return user.customRoleName ?? t("roles.CUSTOM");
  return user.role ? t(`roles.${user.role}`, { defaultValue: user.role }) : "–";
}

function Pager({ page, totalPages }: { page: number; totalPages?: number }) {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const link = (target: number) => {
    const next = new URLSearchParams(params);
    next.set("page", String(target));
    return `?${next}`;
  };
  return (
    <div className="mt-3 flex justify-end gap-2">
      {page > 1 && <ButtonLink to={link(page - 1)}>{t("common.prev")}</ButtonLink>}
      {totalPages !== undefined && page < totalPages && <ButtonLink to={link(page + 1)}>{t("common.next")}</ButtonLink>}
    </div>
  );
}

function InviteDialog({ customRoles, idempotencyKey, result }: { customRoles: CustomRoleRow[]; idempotencyKey: string; result?: ActionResult }) {
  const { t } = useTranslation();
  const invite = result?.intent === "invite" ? (result as Extract<ActionResult, { intent: "invite" }>) : undefined;
  return (
    <Card title={t("members.invite.title")} actions={<ButtonLink to="?tab=members">{t("common.close")}</ButtonLink>}>
      {invite?.results ? (
        <Table>
          <thead>
            <tr>
              <th>{t("members.email")}</th>
              <th>{t("members.invite.result")}</th>
            </tr>
          </thead>
          <tbody>
            {invite.results.map((row) => (
              <tr key={row.email}>
                <td>{row.email}</td>
                <td>{row.status === "CREATED" ? <Badge tone="success">{t("members.invite.created")}</Badge> : <Badge tone="danger">{errorText(t, { code: row.resultCode ?? "UNKNOWN" })}</Badge>}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : (
        <Form method="post" className="grid max-w-xl gap-3" noValidate>
          <CsrfField />
          <input type="hidden" name="intent" value="invite" />
          <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
          {invite?.error && <Alert tone="danger">{errorText(t, invite.error)}</Alert>}
          <TextArea label={t("members.invite.emails")} name="emails" rows={4} error={invite?.fieldError ? t("validation.emails") : undefined} />
          <TextField label={t("members.invite.name")} name="name" />
          <SelectField label={t("members.role")} name="role" defaultValue="VIEWER">
            <RoleOptions customRoles={customRoles} />
          </SelectField>
          <TextField label={t("members.spaceScope")} name="spaceScope" hint={t("members.spaceScopeHint")} />
          <p className="text-[12px] text-muted">{t("members.invite.notice")}</p>
          <div>
            <Button type="submit" variant="primary">
              {t("members.invite.submit")}
            </Button>
          </div>
        </Form>
      )}
    </Card>
  );
}

function CreateDialog({ customRoles, idempotencyKey, result }: { customRoles: CustomRoleRow[]; idempotencyKey: string; result?: ActionResult }) {
  const { t } = useTranslation();
  const create = result?.intent === "create" ? (result as Extract<ActionResult, { intent: "create" }>) : undefined;
  return (
    <Card title={t("members.create.title")} actions={<ButtonLink to="?tab=members">{t("common.close")}</ButtonLink>}>
      {create?.loginId && !create.error ? (
        <div className="grid gap-2">
          <Alert tone="success">{t("members.create.done", { loginId: create.loginId })}</Alert>
          {create.temporaryPassword && (
            <>
              <Alert tone="warning">{t("members.create.passwordOnce")}</Alert>
              <p className="font-mono text-[14px]" data-testid="temporary-password">
                {create.temporaryPassword}
              </p>
            </>
          )}
        </div>
      ) : (
        <Form method="post" className="grid max-w-xl gap-3" noValidate>
          <CsrfField />
          <input type="hidden" name="intent" value="create" />
          <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
          {create?.error && <Alert tone="danger">{policyErrorText(t, create.error)}</Alert>}
          <TextField label={t("members.loginId")} name="loginId" autoCapitalize="none" error={create?.fieldError === "loginId" ? t("validation.loginIdFormat") : undefined} />
          <TextField label={t("members.email")} name="email" type="email" error={create?.fieldError === "email" ? t("validation.email") : undefined} />
          <TextField label={t("members.name")} name="name" error={create?.fieldError === "name" ? t("validation.name") : undefined} />
          <SelectField label={t("members.role")} name="role" defaultValue="VIEWER">
            <RoleOptions customRoles={customRoles} />
          </SelectField>
          <TextField label={t("members.spaceScope")} name="spaceScope" hint={t("members.spaceScopeHint")} />
          <TextField label={t("members.create.temporaryPassword")} name="temporaryPassword" type="text" autoComplete="off" hint={t("members.create.autoHint")} />
          <div>
            <Button type="submit" variant="primary">
              {t("members.create.submit")}
            </Button>
          </div>
        </Form>
      )}
    </Card>
  );
}

export default function AdminMembers({ loaderData, actionData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const [params] = useSearchParams();
  const navigation = useNavigation();
  const root = useRouteLoaderData("root") as RootData;
  const result = actionData as ActionResult | undefined;
  const dialog = params.get("dialog");
  const { tab, customRoles } = loaderData;
  const tabs = [
    { key: "members", label: t("members.tabs.members"), to: "?tab=members" },
    { key: "invitations", label: t("members.tabs.invitations"), to: "?tab=invitations" },
    ...(loaderData.signupEnabled ? [{ key: "signups", label: t("members.tabs.signups"), to: "?tab=signups" }] : []),
  ];
  const fmt = (iso?: string) => formatDateTime(iso, root.timezone, i18n.language);
  const simple = result && "done" in result ? result : undefined;
  const bulk = result?.intent === "bulk-disable" ? (result as Extract<ActionResult, { intent: "bulk-disable" }>) : undefined;

  return (
    <>
      <PageHeader
        crumb={t("nav.admin")}
        title={t("nav.members")}
        actions={
          <>
            <ButtonLink to="?tab=members&dialog=invite" variant="primary">
              {t("members.invite.open")}
            </ButtonLink>
            <ButtonLink to="?tab=members&dialog=create">{t("members.create.open")}</ButtonLink>
          </>
        }
      />
      {dialog === "invite" && <InviteDialog customRoles={customRoles} idempotencyKey={loaderData.idempotencyKey} result={result} />}
      {dialog === "create" && <CreateDialog customRoles={customRoles} idempotencyKey={loaderData.idempotencyKey} result={result} />}
      <div className="mt-4">
        <Tabs items={tabs} current={tab} />
      </div>
      {simple?.done && <Alert tone="success">{t("common.done")}</Alert>}
      {simple?.error && <Alert tone="danger">{errorText(t, simple.error)}</Alert>}
      {simple?.fieldError === "approve" && <Alert tone="danger">{t("members.signups.approveRequired")}</Alert>}
      {simple?.fieldError === "reason" && <Alert tone="danger">{t("validation.rejectReason")}</Alert>}

      {tab === "members" && loaderData.members && (
        <Card>
          <Form method="get" className="mb-3 flex flex-wrap items-end gap-2">
            <input type="hidden" name="tab" value="members" />
            <TextField label={t("members.search")} name="keyword" defaultValue={params.get("keyword") ?? ""} />
            <SelectField label={t("members.role")} name="role" defaultValue={params.get("role") ?? ""}>
              <option value="">{t("common.all")}</option>
              {[...BUILTIN_ROLES, "CUSTOM"].map((role) => (
                <option key={role} value={role}>
                  {t(`roles.${role}`)}
                </option>
              ))}
            </SelectField>
            <SelectField label={t("members.status")} name="status" defaultValue={params.get("status") ?? ""}>
              <option value="">{t("common.all")}</option>
              {STATUSES.map((status) => (
                <option key={status} value={status}>
                  {t(`userStatus.${status}`)}
                </option>
              ))}
            </SelectField>
            <Button type="submit">{t("common.search")}</Button>
          </Form>
          {bulk && (
            <div className="mb-3">
              <Alert tone={bulk.results.every((r) => r.ok) ? "success" : "warning"}>
                {t("members.bulk.result", { ok: bulk.results.filter((r) => r.ok).length, failed: bulk.results.filter((r) => !r.ok).length })}
                {bulk.results
                  .filter((r) => !r.ok)
                  .map((r) => (
                    <span key={r.id} className="ml-2 font-mono">
                      {r.id}: {errorText(t, { code: r.code ?? "UNKNOWN" })}
                    </span>
                  ))}
              </Alert>
            </div>
          )}
          {loaderData.members.responses.length === 0 ? (
            <p className="py-6 text-center text-muted">{t("members.empty")}</p>
          ) : (
            <Form
              method="post"
              onSubmit={(event) => {
                if (!window.confirm(t("members.bulk.confirm"))) event.preventDefault();
              }}
            >
              <CsrfField />
              <input type="hidden" name="intent" value="bulk-disable" />
              <Table>
                <thead>
                  <tr>
                    <th aria-label={t("members.select")} />
                    <th>{t("members.name")}</th>
                    <th>{t("members.loginId")}</th>
                    <th>{t("members.email")}</th>
                    <th>{t("members.role")}</th>
                    <th>{t("members.spaceScope")}</th>
                    <th>{t("members.status")}</th>
                    <th>{t("members.mfa")}</th>
                    <th>{t("members.lastLogin")}</th>
                  </tr>
                </thead>
                <tbody>
                  {loaderData.members.responses.map((user) => (
                    <tr key={user.id}>
                      <td>
                        <input type="checkbox" name="userId" value={user.id} aria-label={user.loginId} disabled={user.id === root.me?.id} />
                      </td>
                      <td>
                        <Link to={`/admin/members/${user.id}`} className="text-accent hover:underline">
                          {user.name || "–"}
                        </Link>
                      </td>
                      <td className="font-mono">{user.loginId}</td>
                      <td>{user.email}</td>
                      <td>{roleLabel(t, user)}</td>
                      <td>{user.spaceScopeSummary || t("members.allSpaces")}</td>
                      <td>{user.status && <Badge tone={STATUS_TONE[user.status] ?? "neutral"}>{t(`userStatus.${user.status}`, { defaultValue: user.status })}</Badge>}</td>
                      <td>{user.mfaEnabled ? t("common.yes") : t("common.no")}</td>
                      <td>{fmt(user.lastLoginAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              <div className="mt-3 flex items-center justify-between">
                <Button type="submit" variant="danger" disabled={navigation.state !== "idle"}>
                  {t("members.bulk.disable")}
                </Button>
                <span className="text-muted">{t("members.total", { count: loaderData.members.totalCount ?? loaderData.members.responses.length })}</span>
              </div>
            </Form>
          )}
          <Pager page={loaderData.page} totalPages={loaderData.members.totalPages} />
        </Card>
      )}

      {tab === "invitations" && loaderData.invitations && (
        <Card>
          {loaderData.invitations.responses.length === 0 ? (
            <p className="py-6 text-center text-muted">{t("members.invitations.empty")}</p>
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>{t("members.email")}</th>
                  <th>{t("members.role")}</th>
                  <th>{t("invitation.invitedBy")}</th>
                  <th>{t("members.invitations.sentCount")}</th>
                  <th>{t("invitation.expiresAt")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {loaderData.invitations.responses.map((row) => (
                  <tr key={row.id}>
                    <td>{row.email}</td>
                    <td>{roleLabel(t, row)}</td>
                    <td>{typeof row.invitedBy === "string" ? row.invitedBy : row.invitedBy?.name}</td>
                    <td>{row.sentCount ?? 1}</td>
                    <td>{fmt(row.expiresAt)}</td>
                    <td className="flex justify-end gap-2">
                      {(["resend", "cancel"] as const).map((intent) => (
                        <Form
                          key={intent}
                          method="post"
                          onSubmit={(event) => {
                            if (!window.confirm(t(`members.invitations.confirm.${intent}`))) event.preventDefault();
                          }}
                        >
                          <CsrfField />
                          <input type="hidden" name="intent" value={intent} />
                          <input type="hidden" name="id" value={row.id} />
                          <Button type="submit" variant={intent === "cancel" ? "danger" : "secondary"}>
                            {t(`members.invitations.${intent}`)}
                          </Button>
                        </Form>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          <Pager page={loaderData.page} totalPages={loaderData.invitations.totalPages} />
        </Card>
      )}

      {tab === "signups" && loaderData.signups && (
        <Card>
          {loaderData.signups.responses.length === 0 ? (
            <p className="py-6 text-center text-muted">{t("members.signups.empty")}</p>
          ) : (
            <div className="grid gap-3">
              {loaderData.signups.responses.map((row) => (
                <div key={row.id} className="rounded-md border border-line p-3">
                  <p className="font-semibold">
                    {row.name} <span className="font-mono text-muted">{row.loginId}</span> · {row.email}
                  </p>
                  <p className="text-muted">{row.message}</p>
                  <p className="text-[12px] text-muted">{fmt(row.createdAt)}</p>
                  <div className="mt-2 flex flex-wrap gap-4">
                    <Form method="post" className="flex flex-wrap items-end gap-2">
                      <CsrfField />
                      <input type="hidden" name="intent" value="approve" />
                      <input type="hidden" name="id" value={row.id} />
                      <SelectField label={t("members.role")} name="role" defaultValue="">
                        <option value="">–</option>
                        <RoleOptions customRoles={customRoles} />
                      </SelectField>
                      <TextField label={t("members.spaceScope")} name="spaceScope" hint={t("members.signups.spaceRequired")} />
                      <Button type="submit" variant="primary">
                        {t("members.signups.approve")}
                      </Button>
                    </Form>
                    <Form method="post" className="flex flex-wrap items-end gap-2">
                      <CsrfField />
                      <input type="hidden" name="intent" value="reject" />
                      <input type="hidden" name="id" value={row.id} />
                      <TextField label={t("members.signups.reason")} name="reason" maxLength={200} />
                      <Button type="submit" variant="danger">
                        {t("members.signups.reject")}
                      </Button>
                    </Form>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
    </>
  );
}
