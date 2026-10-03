/**
 * UI-DEV-11 기기 그룹 상세(DEV-06.01): 소속 기기, 정적 그룹 기기 추가·제거, 이름·설명·조건 수정, 삭제(사용처가 있으면 막음).
 * API: 그룹 API-DEV-31(PATCH)·32(DELETE, GROUP_IN_USE references), 소속 API-DEV-34 members, 추가·제거 API-DEV-35
 * 그룹 한 건 조회 `GET /api/v1/core/device-groups/{group-id}`는 API 문서 표에 없어 일반 REST 관례로 부른다(보고서 참고).
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Form, Link, data, redirect, useRouteLoaderData } from "react-router";
import { callApi, callList, field, listOrThrow, orThrow } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { Alert, Badge, Button, Card, CsrfField, PageHeader, Pager, Table } from "~/components/ui";
import { DevicePicker } from "~/features/catalog/components/group-editor";
import { GroupFormBody } from "~/features/catalog/components/group-form";
import { GROUP_LIMIT, checkGroupInput, parseCriteria } from "~/features/catalog/model/catalog";
import type { DeviceLite, GroupRow, ModelSummary } from "~/features/catalog/model/types";
import { can, failed, invalid, outcome, type CatalogActionResult } from "~/features/catalog/server";
import { DeviceAreaTabs } from "~/features/devices/area-tabs";
import { errorText } from "~/lib/error-text";
import type { SpaceNode } from "~/lib/spaces";
import type { RootData } from "~/root";
import type { Route } from "./+types/device-group-detail";

export function meta() {
  return [{ title: "data2flow" }];
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const ctx = bff(context);
  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const id = encodeURIComponent(params.groupId);
  const group = orThrow(await callApi<GroupRow>(ctx, request, `/api/v1/core/device-groups/${id}`));
  const [members, models, spaces] = await Promise.all([
    callList<DeviceLite>(ctx, request, `/api/v1/core/device-groups/${id}/members?page=${page}&size=50`),
    group.type === "DYNAMIC" ? callList<ModelSummary>(ctx, request, "/api/v1/core/device-models?size=100") : null,
    group.type === "DYNAMIC" ? callApi<SpaceNode[]>(ctx, request, "/api/v1/core/spaces") : null,
  ]);
  const list = listOrThrow(members);
  return { group, members: list.responses, memberTotal: list.totalCount ?? list.responses.length, page, totalPages: list.totalPages, models: models?.ok ? models.list.responses : [], spaces: spaces?.ok ? (spaces.data ?? []) : [] };
}

export async function action({ request, context, params }: Route.ActionArgs) {
  const ctx = bff(context);
  const form = await request.formData();
  const intent = field(form, "intent");
  const base = `/api/v1/core/device-groups/${encodeURIComponent(params.groupId)}`;
  switch (intent) {
    case "update": {
      const type = field(form, "type");
      const criteria = type === "DYNAMIC" ? (parseCriteria(field(form, "criteria")) ?? {}) : undefined;
      const previewRaw = field(form, "previewCount");
      const errors = checkGroupInput({ name: field(form, "name"), type, criteria, previewCount: previewRaw ? Number(previewRaw) : null });
      if (Object.keys(errors).length) return invalid(intent, errors);
      const body: Record<string, unknown> = { name: field(form, "name").trim(), description: field(form, "description").trim() || null };
      if (criteria) body.criteria = criteria;
      return outcome(intent, await callApi(ctx, request, base, { method: "PATCH", body }));
    }
    case "add":
    case "remove": {
      const deviceIds = form.getAll("deviceIds").map(String);
      if (deviceIds.length === 0) return invalid(intent, { deviceIds: "selectDevice" });
      if (deviceIds.length > GROUP_LIMIT) return invalid(intent, { deviceIds: "groupLimit" });
      return outcome(intent, await callApi(ctx, request, `${base}/members/${intent}`, { method: "POST", body: { deviceIds } }));
    }
    case "delete": {
      const result = await callApi<{ references?: { type: string; id: string; name: string }[] }>(ctx, request, base, { method: "DELETE" });
      if (result.ok) throw redirect("/device-groups");
      return failed(intent, result);
    }
    default:
      return data({ intent, error: { code: "INVALID_REQUEST" } } as CatalogActionResult, { status: 400 });
  }
}

export default function DeviceGroupDetail({ loaderData, actionData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const root = useRouteLoaderData("root") as RootData | undefined;
  const admin = can(root?.me?.permissions, "DEV_ADMIN");
  const { group, members, memberTotal, page, totalPages, models, spaces } = loaderData;
  const result = actionData as CatalogActionResult | undefined;
  const [selected, setSelected] = useState<string[]>([]);
  const err = (key: string) => (result?.fieldErrors?.[key] ? t(`catalog.validation.${result.fieldErrors[key]}`) : undefined);
  const usage = group.usage ?? {};
  return (
    <>
      <PageHeader
        crumb={
          <Link to="/device-groups" className="hover:underline">
            {t("catalog.groups.title")}
          </Link>
        }
        title={group.name}
        actions={
          <>
            <Badge tone={group.type === "DYNAMIC" ? "info" : "neutral"}>{t(`catalog.groups.${group.type}`)}</Badge>
            {admin && (
              <Form method="post" onSubmit={(e) => !window.confirm(t("catalog.groups.confirmDelete")) && e.preventDefault()}>
                <CsrfField />
                <input type="hidden" name="intent" value="delete" />
                <Button type="submit" variant="danger">
                  {t("common.delete")}
                </Button>
              </Form>
            )}
          </>
        }
      />
      <DeviceAreaTabs current="groups" />
      {result?.done && (
        <div className="mb-3">
          <Alert tone="success">{t("common.saved")}</Alert>
        </div>
      )}
      {result?.error && (
        <div className="mb-3">
          <Alert tone="danger">
            {errorText(t, result.error)}
            {result.error.code === "GROUP_IN_USE" && ` ${t("catalog.groups.usageText", { rules: usage.rules ?? 0, flows: usage.flows ?? 0, dashboards: usage.dashboards ?? 0 })}`}
            {result.error.references && result.error.references.length > 0 && (
              <ul className="mt-1 list-disc pl-5">
                {result.error.references.map((r) => (
                  <li key={`${r.type}-${r.id}`}>
                    {t(`catalog.groups.refType.${r.type}`, { defaultValue: r.type })}: {r.name}
                  </li>
                ))}
              </ul>
            )}
          </Alert>
        </div>
      )}
      <div className="grid gap-4">
        <Card title={t("catalog.groups.info")}>
          <p className="mb-3 text-[12.5px] text-muted">{t("catalog.groups.usageText", { rules: usage.rules ?? 0, flows: usage.flows ?? 0, dashboards: usage.dashboards ?? 0 })}</p>
          {admin ? (
            <Form method="post" className="flex flex-col gap-3">
              <CsrfField />
              <input type="hidden" name="intent" value="update" />
              <GroupFormBody group={group} models={models} spaces={spaces} creating={false} fieldErrors={result?.intent === "update" ? result.fieldErrors : undefined} />
              <div className="flex justify-end">
                <Button type="submit" variant="primary">
                  {t("common.save")}
                </Button>
              </div>
            </Form>
          ) : (
            <p>{group.description || t("common.none")}</p>
          )}
        </Card>
        <Card title={t("catalog.groups.members", { n: memberTotal })}>
          {members.length === 0 ? (
            <p className="text-muted">{t("catalog.groups.noMembers")}</p>
          ) : (
            <Form method="post">
              <CsrfField />
              {admin && group.type === "STATIC" && <input type="hidden" name="intent" value="remove" />}
              <Table>
                <thead>
                  <tr>
                    {admin && group.type === "STATIC" && <th aria-label={t("common.selectedCount", { n: selected.length })} />}
                    <th>{t("catalog.groups.deviceName")}</th>
                    <th>{t("catalog.models.title")}</th>
                    <th>{t("catalog.groups.space")}</th>
                    <th>{t("catalog.groups.status")}</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((d) => (
                    <tr key={d.id}>
                      {admin && group.type === "STATIC" && (
                        <td>
                          <input
                            type="checkbox"
                            name="deviceIds"
                            value={d.id}
                            aria-label={d.name}
                            checked={selected.includes(d.id)}
                            onChange={() => setSelected((s) => (s.includes(d.id) ? s.filter((x) => x !== d.id) : [...s, d.id]))}
                          />
                        </td>
                      )}
                      <td>
                        <Link to={`/devices/${d.id}`} className="text-accent hover:underline">
                          {d.name}
                        </Link>
                      </td>
                      <td>{d.model?.code ?? "–"}</td>
                      <td>{d.space?.path?.join(" › ") ?? "–"}</td>
                      <td>{d.status ? t(`status.device.${d.status}`, { defaultValue: d.status }) : "–"}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              {admin && group.type === "STATIC" && (
                <div className="mt-3 flex justify-end">
                  <Button type="submit" variant="danger" disabled={selected.length === 0}>
                    {t("catalog.groups.removeSelected", { n: selected.length })}
                  </Button>
                </div>
              )}
            </Form>
          )}
          {result?.intent === "remove" && err("deviceIds") && <Alert tone="danger">{err("deviceIds")}</Alert>}
          <Pager page={page} totalPages={totalPages} />
        </Card>
        {admin && group.type === "STATIC" && (
          <Card title={t("catalog.groups.addMembers")}>
            <Form method="post" className="flex flex-col gap-3">
              <CsrfField />
              <input type="hidden" name="intent" value="add" />
              <DevicePicker />
              {result?.intent === "add" && err("deviceIds") && <Alert tone="danger">{err("deviceIds")}</Alert>}
              <div className="flex justify-end">
                <Button type="submit" variant="primary">
                  {t("catalog.groups.addMembers")}
                </Button>
              </div>
            </Form>
          </Card>
        )}
      </div>
    </>
  );
}
