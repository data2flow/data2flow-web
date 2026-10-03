/**
 * UI-SIM-05 조직 프로필(SIM-09.02): 목록(이름·유형·바꾼 특성 수·사용 기기 수), [새 프로필], 편집(UI-SIM-04 공통 폼, 편집 층 = 프로필),
 * [복제], [삭제](사용 중이면 비활성, 서버 SIM_PROFILE_IN_USE). 조회 SIM_READ, 쓰기 SIM_MANAGE. API-SIM-08.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Form, Link, data, redirect, useRevalidator, useRouteLoaderData, useSearchParams } from "react-router";
import { callApi, callList, field, listOrThrow } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { Alert, Button, Card, CsrfField, Dialog, EmptyState, PageHeader, SelectField, Table, TextField } from "~/components/ui";
import { rowsFromDefs, simApi } from "~/features/sim/api";
import { SimAreaTabs, useProblemText } from "~/features/sim/components/common";
import { PropertyForm } from "~/features/sim/components/property-form";
import { checkProfileName, type Problem } from "~/features/sim/model/sim";
import type { PropertyRow, SimCatalog, SimProfile } from "~/features/sim/model/types";
import { errorText } from "~/lib/error-text";
import { hasAny } from "~/lib/permissions";
import type { RootData } from "~/root";
import type { Route } from "./+types/sim-profiles";

export function meta() {
  return [{ title: "data2flow" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = bff(context);
  const url = new URL(request.url);
  const selectedId = url.searchParams.get("id");
  const [profiles, catalog, selected] = await Promise.all([
    callList<SimProfile>(ctx, request, "/api/v1/core/sim/profiles?size=100"),
    callApi<SimCatalog>(ctx, request, "/api/v1/core/sim/catalog"),
    selectedId ? callApi<SimProfile>(ctx, request, `/api/v1/core/sim/profiles/${encodeURIComponent(selectedId)}`) : Promise.resolve(null),
  ]);
  return { profiles: listOrThrow(profiles).responses, types: catalog.ok ? catalog.data.types : [], selected: selected?.ok ? selected.data : null, selectedFailed: Boolean(selected && !selected.ok) };
}

type ActionResult = { intent: string; error?: { code: string; message?: string }; fieldErrors?: Record<string, Problem> };

export async function action({ request, context }: Route.ActionArgs) {
  const ctx = bff(context);
  const form = await request.formData();
  const intent = field(form, "intent");
  const fail = (code: string, status: number, message?: string) => data<ActionResult>({ intent, error: { code, message } }, { status });
  if (intent === "create" || intent === "clone") {
    const name = field(form, "name");
    const problem = checkProfileName(name);
    if (problem) return data<ActionResult>({ intent, fieldErrors: { name: problem } }, { status: 400 });
    let overrides: Record<string, unknown> = {};
    if (intent === "clone") {
      const source = await callApi<SimProfile>(ctx, request, `/api/v1/core/sim/profiles/${encodeURIComponent(field(form, "sourceId"))}`);
      if (!source.ok) return fail(source.code, source.status, source.message);
      overrides = source.data.overrides ?? Object.fromEntries((source.data.properties ?? []).filter((p) => p.origin === "PROFILE").map((p) => [p.key, p.value]));
    }
    const result = await callApi<SimProfile>(ctx, request, "/api/v1/core/sim/profiles", { method: "POST", body: { name: name.trim(), typeId: field(form, "typeId"), overrides } });
    if (!result.ok) return fail(result.code, result.status, result.message);
    return redirect(`/sim/profiles?id=${encodeURIComponent(result.data.id)}`);
  }
  if (intent === "delete") {
    const result = await callApi(ctx, request, `/api/v1/core/sim/profiles/${encodeURIComponent(field(form, "id"))}`, { method: "DELETE" });
    if (!result.ok) return fail(result.code, result.status, result.message);
    return redirect("/sim/profiles");
  }
  return fail("INVALID_REQUEST", 400);
}

export default function SimProfilesPage({ loaderData, actionData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const problemText = useProblemText();
  const [params] = useSearchParams();
  const revalidator = useRevalidator();
  const root = useRouteLoaderData("root") as RootData | undefined;
  const canManage = hasAny(root?.me?.permissions, ["SIM_MANAGE"]);
  const { profiles, types, selected } = loaderData;
  const result = actionData as ActionResult | undefined;
  const [creating, setCreating] = useState(result?.intent === "create" && Boolean(result.fieldErrors || result.error));
  const typeName = (id: string) => types.find((ty) => ty.id === id)?.name ?? id;
  const selectedType = selected ? types.find((ty) => ty.id === selected.typeId) : undefined;
  const rows: PropertyRow[] = selected?.properties ?? (selectedType ? rowsFromDefs(selectedType.propertyDefs, selected?.overrides) : []);

  const save = async (diff: Record<string, unknown>) => {
    if (!selected) return { ok: false };
    const merged: Record<string, unknown> = { ...(selected.overrides ?? Object.fromEntries(rows.filter((r) => r.origin === "PROFILE").map((r) => [r.key, r.value]))) };
    for (const [k, v] of Object.entries(diff)) {
      if (v === null) delete merged[k];
      else merged[k] = v;
    }
    const response = await simApi.saveProfile(selected.id, { name: selected.name, typeId: selected.typeId, overrides: merged, baseVersion: selected.version });
    if (!response.ok) return { ok: false, message: errorText(t, response) };
    void revalidator.revalidate();
    return { ok: true };
  };

  return (
    <>
      <PageHeader
        crumb={t("nav.sim")}
        title={t("sim.profiles.title")}
        actions={
          canManage && (
            <Button variant="primary" onClick={() => setCreating(true)}>
              {t("sim.profiles.new")}
            </Button>
          )
        }
      />
      <SimAreaTabs current="profiles" />
      {result?.error && (
        <div className="mb-3">
          <Alert tone="danger">{errorText(t, result.error)}</Alert>
        </div>
      )}
      <Card>
        {profiles.length === 0 ? (
          <EmptyState title={t("sim.profiles.empty")} />
        ) : (
          <Table>
            <thead>
              <tr>
                <th>{t("sim.profiles.col.name")}</th>
                <th>{t("sim.profiles.col.type")}</th>
                <th>{t("sim.profiles.col.changed")}</th>
                <th>{t("sim.profiles.col.devices")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {profiles.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link className="text-accent hover:underline" to={`?id=${encodeURIComponent(p.id)}`} aria-current={params.get("id") === p.id ? "page" : undefined}>
                      {p.name}
                    </Link>
                  </td>
                  <td>{p.typeName ?? typeName(p.typeId)}</td>
                  <td className="font-mono">{Object.keys(p.overrides ?? {}).length}</td>
                  <td className="font-mono">{p.deviceCount ?? 0}</td>
                  <td>
                    {canManage && (
                      <div className="flex gap-1">
                        <Form method="post">
                          <CsrfField />
                          <input type="hidden" name="intent" value="clone" />
                          <input type="hidden" name="sourceId" value={p.id} />
                          <input type="hidden" name="typeId" value={p.typeId} />
                          <input type="hidden" name="name" value={t("sim.profiles.copyName", { name: p.name }).slice(0, 80)} />
                          <Button type="submit" variant="ghost">
                            {t("sim.profiles.clone")}
                          </Button>
                        </Form>
                        <Form method="post">
                          <CsrfField />
                          <input type="hidden" name="intent" value="delete" />
                          <input type="hidden" name="id" value={p.id} />
                          <Button type="submit" variant="ghost" disabled={(p.deviceCount ?? 0) > 0} title={(p.deviceCount ?? 0) > 0 ? t("errors.SIM_PROFILE_IN_USE") : undefined}>
                            {t("common.delete")}
                          </Button>
                        </Form>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {loaderData.selectedFailed && (
        <div className="mt-3">
          <Alert tone="danger">{t("errors.SIM_NOT_FOUND")}</Alert>
        </div>
      )}
      {selected && (
        <Card title={t("sim.profiles.editTitle", { name: selected.name, type: typeName(selected.typeId) })} className="mt-4">
          <PropertyForm key={`${selected.id}-${selected.version ?? 0}`} rows={rows} layer="PROFILE" canEdit={canManage} onSave={save} />
        </Card>
      )}
      {creating && (
        <Dialog title={t("sim.profiles.new")} open onClose={() => setCreating(false)}>
          <Form method="post" className="flex flex-col gap-3">
            <CsrfField />
            <input type="hidden" name="intent" value="create" />
            <TextField label={t("sim.profiles.col.name")} name="name" maxLength={80} error={problemText(result?.fieldErrors?.name)} />
            <SelectField label={t("sim.profiles.col.type")} name="typeId">
              {types.map((ty) => (
                <option key={ty.id} value={ty.id}>
                  {ty.name}
                </option>
              ))}
            </SelectField>
            <div className="flex justify-end gap-2">
              <Button onClick={() => setCreating(false)}>{t("common.cancel")}</Button>
              <Button type="submit" variant="primary">
                {t("common.save")}
              </Button>
            </div>
          </Form>
        </Dialog>
      )}
    </>
  );
}
