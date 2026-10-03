/**
 * UI-DEV-11 기기 그룹 목록·만들기(DEV-06.01, BR-DEV-12). 조회 DEV_READ, 생성 DEV_ADMIN.
 * API: 목록 API-DEV-34, 생성 API-DEV-30(정적 deviceIds·동적 criteria), 미리 보기 API-DEV-33(브라우저에서 직접)
 */
import { useTranslation } from "react-i18next";
import { Form, Link, redirect, useRouteLoaderData, useSearchParams } from "react-router";
import { callApi, callList, field, listOrThrow, newIdempotencyKey } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { Alert, Badge, Button, ButtonLink, Card, CsrfField, EmptyState, PageHeader, Pager, SelectField, Table, TextField } from "~/components/ui";
import { GroupFormBody } from "~/features/catalog/components/group-form";
import { checkGroupInput, parseCriteria } from "~/features/catalog/model/catalog";
import type { GroupRow, ModelSummary } from "~/features/catalog/model/types";
import { can, failed, invalid, type CatalogActionResult } from "~/features/catalog/server";
import { DeviceAreaTabs } from "~/features/devices/area-tabs";
import { errorText } from "~/lib/error-text";
import type { SpaceNode } from "~/lib/spaces";
import type { RootData } from "~/root";
import type { Route } from "./+types/device-groups";

export function meta() {
  return [{ title: "data2flow" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = bff(context);
  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const query = new URLSearchParams({ page: String(page), size: "50" });
  for (const key of ["q", "type"]) {
    const value = url.searchParams.get(key);
    if (value) query.set(key, value);
  }
  const creating = url.searchParams.get("new") === "1";
  const [groups, models, spaces] = await Promise.all([
    callList<GroupRow>(ctx, request, `/api/v1/core/device-groups?${query}`),
    creating ? callList<ModelSummary>(ctx, request, "/api/v1/core/device-models?size=100") : null,
    creating ? callApi<SpaceNode[]>(ctx, request, "/api/v1/core/spaces") : null,
  ]);
  const list = listOrThrow(groups);
  return { groups: list.responses, page, totalPages: list.totalPages, creating, models: models?.ok ? models.list.responses : [], spaces: spaces?.ok ? (spaces.data ?? []) : [], idempotencyKey: newIdempotencyKey() };
}

export async function action({ request, context }: Route.ActionArgs) {
  const ctx = bff(context);
  const form = await request.formData();
  const type = field(form, "type");
  const criteria = type === "DYNAMIC" ? (parseCriteria(field(form, "criteria")) ?? {}) : undefined;
  const deviceIds = form.getAll("deviceIds").map(String);
  const previewRaw = field(form, "previewCount");
  const errors = checkGroupInput({ name: field(form, "name"), type, criteria, deviceIds, previewCount: previewRaw ? Number(previewRaw) : null });
  if (Object.keys(errors).length) return invalid("create", errors);
  const body: Record<string, unknown> = { name: field(form, "name").trim(), type, description: field(form, "description").trim() || null };
  if (type === "DYNAMIC") body.criteria = criteria;
  else body.deviceIds = deviceIds;
  const result = await callApi<GroupRow>(ctx, request, "/api/v1/core/device-groups", { method: "POST", body, idempotencyKey: field(form, "idempotencyKey") || newIdempotencyKey() });
  if (!result.ok) return failed("create", result);
  throw redirect(`/device-groups/${encodeURIComponent(result.data.id)}`);
}

export default function DeviceGroups({ loaderData, actionData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const root = useRouteLoaderData("root") as RootData | undefined;
  const admin = can(root?.me?.permissions, "DEV_ADMIN");
  const [params] = useSearchParams();
  const { groups, page, totalPages, creating, models, spaces, idempotencyKey } = loaderData;
  const result = actionData as CatalogActionResult | undefined;
  const filtered = Boolean(params.get("q") || params.get("type"));
  return (
    <>
      <PageHeader title={t("catalog.groups.title")} actions={admin && !creating && <ButtonLink to="?new=1" variant="primary">{t("catalog.groups.new")}</ButtonLink>} />
      <DeviceAreaTabs current="groups" />
      {result?.error && (
        <div className="mb-3">
          <Alert tone="danger">{errorText(t, result.error)}</Alert>
        </div>
      )}
      {creating && admin && (
        <Card className="mb-4" title={t("catalog.groups.new")} actions={<ButtonLink to="/device-groups">{t("common.cancel")}</ButtonLink>}>
          <Form method="post" className="flex flex-col gap-3">
            <CsrfField />
            <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
            <GroupFormBody models={models} spaces={spaces} creating fieldErrors={result?.fieldErrors} />
            <div className="flex justify-end">
              <Button type="submit" variant="primary">
                {t("common.save")}
              </Button>
            </div>
          </Form>
        </Card>
      )}
      <Form method="get" className="mb-4 flex flex-wrap items-end gap-3">
        <TextField label={t("common.search")} name="q" defaultValue={params.get("q") ?? ""} />
        <SelectField label={t("catalog.groups.type")} name="type" defaultValue={params.get("type") ?? ""}>
          <option value="">{t("common.all")}</option>
          <option value="STATIC">{t("catalog.groups.STATIC")}</option>
          <option value="DYNAMIC">{t("catalog.groups.DYNAMIC")}</option>
        </SelectField>
        <Button type="submit">{t("common.filter")}</Button>
      </Form>
      {groups.length === 0 ? (
        <EmptyState
          title={filtered ? t("catalog.groups.noMatch") : t("catalog.groups.empty")}
          body={filtered ? undefined : t("catalog.groups.emptyBody")}
          action={filtered ? <ButtonLink to="/device-groups">{t("common.reset")}</ButtonLink> : admin ? <ButtonLink to="?new=1" variant="primary">{t("catalog.groups.new")}</ButtonLink> : <span className="text-[12.5px] text-muted">{t("catalog.askAdmin")}</span>}
        />
      ) : (
        <Card>
          <Table>
            <thead>
              <tr>
                <th>{t("catalog.groups.name")}</th>
                <th>{t("catalog.groups.type")}</th>
                <th>{t("catalog.groups.memberCount")}</th>
                <th>{t("catalog.groups.usage")}</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.id}>
                  <td>
                    <Link to={`/device-groups/${g.id}`} className="text-accent hover:underline">
                      {g.name}
                    </Link>
                  </td>
                  <td>
                    <Badge tone={g.type === "DYNAMIC" ? "info" : "neutral"}>{t(`catalog.groups.${g.type}`)}</Badge>
                  </td>
                  <td>{g.memberCount ?? 0}</td>
                  <td>{t("catalog.groups.usageText", { rules: g.usage?.rules ?? 0, flows: g.usage?.flows ?? 0, dashboards: g.usage?.dashboards ?? 0 })}</td>
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
