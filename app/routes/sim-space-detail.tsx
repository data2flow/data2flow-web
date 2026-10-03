/**
 * UI-SIM-06 가상 공간과 물리 설정(SIM-01.01·01.02, SIM-07.03): 기본 정보(이름·상위 공간·프리셋), 물리 설정(프리셋 채움·범위 검사),
 * 24시간 미리 보기(API-SIM-11, 저장 없음), 이 공간의 가상 기기, 샌드박스 지정(API-SIM-24, SIM_ADMIN), 삭제(실행 중이면 SIM_SPACE_BUSY).
 * 저장 API-SIM-10(새로 만들기 POST, 수정 PUT + baseVersion). `/sim/spaces/new`는 새 공간.
 */
import { useTranslation } from "react-i18next";
import { Form, Link, data, redirect, useRouteLoaderData } from "react-router";
import { callApi, callList, field, orThrow } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { Alert, Badge, Button, Card, CsrfField, PageHeader, SelectField, Table, TextField } from "~/components/ui";
import { simApi } from "~/features/sim/api";
import { SimAreaTabs, VirtualBadge, useProblemText } from "~/features/sim/components/common";
import { PhysicsForm } from "~/features/sim/components/physics-form";
import { SPACE_PRESETS, checkPhysics, physicsFromForm, presetPhysics, type Problem } from "~/features/sim/model/sim";
import type { SimSpace, SpacePreset } from "~/features/sim/model/types";
import { errorText } from "~/lib/error-text";
import { hasAny } from "~/lib/permissions";
import { flattenSpaces, type SpaceNode } from "~/lib/spaces";
import type { RootData } from "~/root";
import type { Route } from "./+types/sim-space-detail";

export function meta() {
  return [{ title: "data2flow" }];
}

interface DeviceRow {
  id: string;
  name: string;
  kind?: string;
  virtual?: boolean;
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const ctx = bff(context);
  const isNew = params.spaceId === "new";
  const id = encodeURIComponent(params.spaceId);
  const [space, devices, tree] = await Promise.all([
    isNew ? Promise.resolve(null) : callApi<SimSpace>(ctx, request, `/api/v1/core/sim/spaces/${id}`),
    isNew ? Promise.resolve(null) : callList<DeviceRow>(ctx, request, `/api/v1/core/devices?spaceId=${id}&virtual=true&size=100`),
    callApi<SpaceNode[]>(ctx, request, "/api/v1/core/spaces"),
  ]);
  return {
    space: space ? orThrow(space) : null,
    devices: devices?.ok ? devices.list.responses : [],
    parents: tree.ok ? flattenSpaces(tree.data ?? []).map((s) => ({ id: s.id, label: s.path.join(" › ") })) : [],
  };
}

type ActionResult = { intent: string; error?: { code: string; message?: string }; fieldErrors?: Record<string, Problem>; done?: boolean };

export async function action({ request, context, params }: Route.ActionArgs) {
  const ctx = bff(context);
  const form = await request.formData();
  const intent = field(form, "intent");
  const isNew = params.spaceId === "new";
  const path = `/api/v1/core/sim/spaces/${encodeURIComponent(params.spaceId)}`;
  const fail = (code: string, status: number, message?: string) => data<ActionResult>({ intent, error: { code, message } }, { status });
  if (intent === "save") {
    const preset = (SPACE_PRESETS as string[]).includes(field(form, "preset")) ? (field(form, "preset") as SpacePreset) : "CUSTOM";
    const physics = physicsFromForm(form, presetPhysics(preset));
    const fieldErrors: Record<string, Problem> = checkPhysics(physics);
    const name = field(form, "name").trim();
    if (!name || name.length > 100) fieldErrors.name = { key: "length", values: { min: 1, max: 100 } };
    if (Object.keys(fieldErrors).length) return data<ActionResult>({ intent, fieldErrors }, { status: 400 });
    const body: Record<string, unknown> = { name, preset, physics };
    if (field(form, "parentId")) body.parentId = field(form, "parentId");
    if (!isNew) body.baseVersion = Number(field(form, "baseVersion")) || 0;
    const result = await callApi<SimSpace>(ctx, request, isNew ? "/api/v1/core/sim/spaces" : path, { method: isNew ? "POST" : "PUT", body });
    if (!result.ok) return fail(result.code, result.status, result.message);
    if (isNew) return redirect(`/sim/spaces/${encodeURIComponent(result.data.spaceId)}`);
    return { intent, done: true } satisfies ActionResult;
  }
  if (intent === "sandbox") {
    const result = await callApi(ctx, request, `${path}/sandbox`, { method: "PUT", body: { sandbox: field(form, "sandbox") === "true" } });
    if (!result.ok) return fail(result.code, result.status, result.message);
    return { intent, done: true } satisfies ActionResult;
  }
  if (intent === "delete") {
    const result = await callApi(ctx, request, path, { method: "DELETE" });
    if (!result.ok) return fail(result.code, result.status, result.message);
    return redirect("/sim/spaces");
  }
  return fail("INVALID_REQUEST", 400);
}

export default function SimSpaceDetailPage({ loaderData, actionData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const problemText = useProblemText();
  const root = useRouteLoaderData("root") as RootData | undefined;
  const permissions = root?.me?.permissions;
  const canManage = hasAny(permissions, ["SIM_MANAGE"]);
  const canAdmin = hasAny(permissions, ["SIM_ADMIN"]);
  const { space, devices, parents } = loaderData;
  const result = actionData as ActionResult | undefined;
  const serverErrors = Object.fromEntries(Object.entries(result?.fieldErrors ?? {}).map(([k, p]) => [k, problemText(p) ?? ""]));
  const preset = space?.preset ?? "CLASSROOM";
  return (
    <>
      <PageHeader
        crumb={t("sim.space.listTitle")}
        title={
          <span className="inline-flex items-center gap-2">
            {space?.name ?? t("sim.space.new")} <VirtualBadge />
            {space?.sandbox && <Badge tone="warning">{t("sim.space.sandbox")}</Badge>}
          </span>
        }
      />
      <SimAreaTabs current="spaces" />
      {result?.error && (
        <div className="mb-3">
          <Alert tone="danger">{errorText(t, result.error)}</Alert>
        </div>
      )}
      {result?.done && (
        <div className="mb-3">
          <Alert tone="success">{t("sim.property.saved")}</Alert>
        </div>
      )}
      <Card title={t("sim.space.basic")}>
        <Form method="post" className="flex flex-col gap-4">
          <CsrfField />
          <input type="hidden" name="intent" value="save" />
          <input type="hidden" name="baseVersion" value={space?.version ?? 0} />
          <div className="grid gap-3 md:grid-cols-2">
            <TextField label={t("sim.space.name")} name="name" defaultValue={space?.name ?? ""} maxLength={100} disabled={!canManage} error={serverErrors.name} />
            <SelectField label={t("sim.space.parent")} name="parentId" defaultValue={space?.parentId ?? ""} disabled={!canManage}>
              <option value="">{t("sim.space.noParent")}</option>
              {parents.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </SelectField>
          </div>
          <PhysicsForm initialPreset={preset} initialPhysics={space?.physics ?? presetPhysics(preset)} canEdit={canManage} serverErrors={serverErrors} api={simApi} spaceId={space?.spaceId} timezone={root?.timezone ?? "Asia/Seoul"} />
          {canManage && (
            <div className="flex justify-end">
              <Button type="submit" variant="primary">
                {t("common.save")}
              </Button>
            </div>
          )}
        </Form>
      </Card>
      {space && (
        <Card title={t("sim.space.devicesTitle")} className="mt-4">
          {devices.length === 0 ? (
            <p className="text-[12.5px] text-muted">
              {t("sim.space.noDevices")}{" "}
              <Link className="text-accent underline" to="/sim/catalog">
                {t("sim.area.catalog")}
              </Link>
            </p>
          ) : (
            <Table>
              <tbody>
                {devices.map((d) => (
                  <tr key={d.id}>
                    <td>
                      <Link className="text-accent hover:underline" to={`/devices/${encodeURIComponent(d.id)}?tab=virtual`}>
                        {d.name}
                      </Link>
                    </td>
                    <td>{d.kind ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      )}
      {space && (canAdmin || canManage) && (
        <Card title={t("sim.space.manage")} className="mt-4">
          <div className="flex flex-wrap gap-2">
            {canAdmin && (
              <Form method="post">
                <CsrfField />
                <input type="hidden" name="intent" value="sandbox" />
                <input type="hidden" name="sandbox" value={String(!space.sandbox)} />
                <Button type="submit">{space.sandbox ? t("sim.space.sandboxOff") : t("sim.space.sandboxOn")}</Button>
              </Form>
            )}
            {canManage && (
              <Form method="post">
                <CsrfField />
                <input type="hidden" name="intent" value="delete" />
                <Button type="submit" variant="danger">
                  {t("common.delete")}
                </Button>
              </Form>
            )}
          </div>
          <p className="mt-2 text-[12px] text-muted">{t("sim.space.sandboxHint")}</p>
        </Card>
      )}
    </>
  );
}
