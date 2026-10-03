/**
 * UI-IAM-09 역할과 권한(IAM-04.01, IAM-04.03, API-IAM-70·73). 기본 역할 권한표는 읽기 전용이고,
 * 사용자 정의 역할은 권한을 조합해 만든다. ADMIN 전용 권한(IAM_MANAGE, AUDIT_READ)은 넣을 수 없다.
 */
import { useTranslation } from "react-i18next";
import { Form, data, redirect, useSearchParams } from "react-router";
import { callApi, callList, field, listOrThrow, orThrow } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import type { CustomRoleRow } from "~/components/role-options";
import { Alert, Button, ButtonLink, Card, CsrfField, PageHeader, Table, TextField } from "~/components/ui";
import { BUILTIN_ROLES } from "~/lib/api-types";
import { errorText } from "~/lib/error-text";
import { ADMIN_ONLY_PERMISSIONS } from "~/lib/roles";
import { checkName } from "~/lib/validation";
import type { Route } from "./+types/admin-roles";

interface PermissionCatalog {
  permissions: { code: string; area?: string; action?: string }[];
  builtinRoles: Record<string, string[]>;
}

export function meta() {
  return [{ title: "data2flow" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = bff(context);
  const [catalog, roles] = await Promise.all([
    callApi<PermissionCatalog>(ctx, request, "/api/v1/core/permissions"),
    callList<CustomRoleRow>(ctx, request, "/api/v1/core/custom-roles"),
  ]);
  const value = orThrow(catalog);
  return {
    catalog: { permissions: value?.permissions ?? [], builtinRoles: value?.builtinRoles ?? {} },
    customRoles: listOrThrow(roles).responses,
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const ctx = bff(context);
  const form = await request.formData();
  const intent = field(form, "intent");
  const id = field(form, "id");
  if (intent === "delete") {
    const result = await callApi(ctx, request, `/api/v1/core/custom-roles/${encodeURIComponent(id)}`, { method: "DELETE" });
    return result.ok ? { deleted: true } : data({ error: { code: result.code, message: result.message } }, { status: result.status });
  }
  const name = field(form, "name").trim();
  const permissions = form
    .getAll("permissions")
    .filter((v): v is string => typeof v === "string" && !ADMIN_ONLY_PERMISSIONS.includes(v));
  if (checkName(name)) return data({ fieldError: "name" }, { status: 400 });
  if (permissions.length === 0) return data({ fieldError: "permissions" }, { status: 400 });
  const body = { name, description: field(form, "description").trim(), permissions, baseVersion: id ? Number(field(form, "baseVersion")) : undefined };
  const result = id
    ? await callApi(ctx, request, `/api/v1/core/custom-roles/${encodeURIComponent(id)}`, { method: "PUT", body })
    : await callApi(ctx, request, "/api/v1/core/custom-roles", { method: "POST", body });
  if (result.ok) throw redirect("/admin/roles?saved=1");
  return data({ error: { code: result.code, message: result.message } }, { status: result.status });
}

function RoleEditor({ role, catalog }: { role?: CustomRoleRow; catalog: PermissionCatalog }) {
  const { t } = useTranslation();
  const owned = new Set(role?.permissions ?? []);
  const areas = [...new Set(catalog.permissions.map((p) => p.area ?? "OTHER"))];
  return (
    <Card title={role ? t("roles.editor.edit", { name: role.name }) : t("roles.editor.new")} actions={<ButtonLink to="/admin/roles">{t("common.close")}</ButtonLink>}>
      <Form method="post" className="grid gap-3">
        <CsrfField />
        <input type="hidden" name="intent" value="save" />
        <input type="hidden" name="id" value={role?.id ?? ""} />
        <input type="hidden" name="baseVersion" value={role?.version ?? 0} />
        <TextField label={t("roles.editor.name")} name="name" defaultValue={role?.name ?? ""} maxLength={50} />
        <TextField label={t("roles.editor.description")} name="description" defaultValue={role?.description ?? ""} />
        {areas.map((area) => (
          <fieldset key={area} className="rounded-md border border-line p-3">
            <legend className="px-1 text-[12px] font-semibold text-muted">{area}</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {catalog.permissions
                .filter((p) => (p.area ?? "OTHER") === area)
                .map((p) => {
                  const adminOnly = ADMIN_ONLY_PERMISSIONS.includes(p.code);
                  return (
                    <label key={p.code} className="flex items-center gap-1.5 font-mono text-[12px]">
                      <input type="checkbox" name="permissions" value={p.code} defaultChecked={owned.has(p.code)} disabled={adminOnly} />
                      {p.code}
                    </label>
                  );
                })}
            </div>
          </fieldset>
        ))}
        <div>
          <Button type="submit" variant="primary">
            {t("common.save")}
          </Button>
        </div>
      </Form>
    </Card>
  );
}

export default function AdminRoles({ loaderData, actionData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const { catalog, customRoles } = loaderData;
  const result = actionData as { deleted?: boolean; fieldError?: string; error?: { code: string; message?: string } } | undefined;
  const editId = params.get("edit");
  const editing = editId === "new" ? undefined : customRoles.find((r) => r.id === editId);
  const columns = [...BUILTIN_ROLES.map((role) => ({ key: role, label: t(`roles.${role}`), permissions: catalog.builtinRoles[role] ?? [] })), ...customRoles.map((r) => ({ key: r.id, label: r.name, permissions: r.permissions ?? [] }))];
  return (
    <>
      <PageHeader crumb={t("nav.admin")} title={t("nav.roles")} actions={<ButtonLink to="?edit=new" variant="primary">{t("roles.editor.new")}</ButtonLink>} />
      <div className="grid gap-4">
        {params.get("saved") && <Alert tone="success">{t("common.saved")}</Alert>}
        {result?.deleted && <Alert tone="success">{t("common.done")}</Alert>}
        {result?.error && <Alert tone="danger">{errorText(t, result.error)}</Alert>}
        {result?.fieldError && <Alert tone="danger">{t(`roles.editor.${result.fieldError}Required`)}</Alert>}
        {editId && <RoleEditor role={editing} catalog={catalog} />}
        <Card title={t("roles.customTitle")}>
          {customRoles.length === 0 ? (
            <p className="text-muted">{t("roles.noCustom")}</p>
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>{t("roles.editor.name")}</th>
                  <th>{t("roles.permissionCount")}</th>
                  <th>{t("roles.userCount")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {customRoles.map((role) => (
                  <tr key={role.id}>
                    <td>{role.name}</td>
                    <td>{role.permissions?.length ?? 0}</td>
                    <td>{role.assignedUsers ?? 0}</td>
                    <td className="flex justify-end gap-2">
                      <ButtonLink to={`?edit=${role.id}`}>{t("common.edit")}</ButtonLink>
                      <Form
                        method="post"
                        onSubmit={(event) => {
                          if (!window.confirm(t("roles.confirmDelete"))) event.preventDefault();
                        }}
                      >
                        <CsrfField />
                        <input type="hidden" name="intent" value="delete" />
                        <input type="hidden" name="id" value={role.id} />
                        <Button type="submit" variant="danger">
                          {t("common.delete")}
                        </Button>
                      </Form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
        <Card title={t("roles.matrixTitle")}>
          <Table>
            <thead>
              <tr>
                <th>{t("roles.permission")}</th>
                {columns.map((c) => (
                  <th key={c.key}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {catalog.permissions.map((p) => (
                <tr key={p.code}>
                  <td className="font-mono text-[12px]">{p.code}</td>
                  {columns.map((c) => (
                    <td key={c.key} className="text-center">
                      {c.permissions.includes(p.code) ? <span aria-label={t("common.yes")}>&#10003;</span> : <span className="text-muted">–</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      </div>
    </>
  );
}
