/**
 * UI-DEV-04 기기 목록(DEV-02.01, DEV-02.10, DEV-06.01). 필터는 URL 쿼리(공유 가능), 목록 API-DEV-11, 태그 일괄 변경 API-DEV-21,
 * CSV 내보내기 API-DEV-20. 조회 VIEWER+, 태그 OPERATOR+(DEV_PLACE), 추가·가져오기 INTEGRATOR+(DEV_ADMIN).
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Form, Link, data, useNavigate, useRouteLoaderData, useSearchParams } from "react-router";
import { callApi, callList, field, listOrThrow } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { SpaceSelect } from "~/components/space-picker";
import { Alert, Button, ButtonLink, Card, CsrfField, EmptyState, PageHeader, Pager, SelectField, Table, TextField } from "~/components/ui";
import { DeviceAreaTabs } from "~/features/devices/area-tabs";
import { BatteryBar, ConnectivityLabel, DeviceStatusBadge } from "~/features/devices/components";
import { CONNECTIVITIES, DEVICE_KINDS, DEVICE_STATUSES, checkTags, deviceQuery, hasFilters, parseTags, type DeviceSummary } from "~/features/devices/model/devices";
import { errorText } from "~/lib/error-text";
import { formatRelative } from "~/lib/format";
import { hasAny } from "~/lib/permissions";
import type { SpaceNode } from "~/lib/spaces";
import type { RootData } from "~/root";
import { BulkControlDialog } from "~/features/control/bulk-control";
import type { Route } from "./+types/devices";

export function meta() {
  return [{ title: "data2flow" }];
}

const PAGE_SIZE = 50;

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = bff(context);
  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const query = deviceQuery(url.searchParams, page, PAGE_SIZE);
  const [devices, spaces, models, sources, pending] = await Promise.all([
    callList<DeviceSummary>(ctx, request, `/api/v1/core/devices?${query}`),
    callApi<SpaceNode[]>(ctx, request, "/api/v1/core/spaces"),
    callList<{ id: string; code: string; name: string }>(ctx, request, "/api/v1/core/device-models?size=100"),
    callList<{ id: string; code: string; name: string }>(ctx, request, "/api/v1/core/sources?size=100"),
    callList<DeviceSummary>(ctx, request, "/api/v1/core/devices?status=PENDING&size=1"),
  ]);
  return {
    devices: listOrThrow(devices),
    page,
    now: ctx.runtime.now(),
    spaces: spaces.ok ? (spaces.data ?? []) : [],
    models: models.ok ? models.list.responses : [],
    sources: sources.ok ? sources.list.responses : [],
    pendingCount: pending.ok ? (pending.list.totalCount ?? pending.list.responses.length) : null,
  };
}

type ActionResult = { intent: string; results?: { deviceId: string; ok: boolean; errorCode?: string }[]; fieldError?: string; error?: { code: string; message?: string } };

export async function action({ request, context }: Route.ActionArgs) {
  const ctx = bff(context);
  const form = await request.formData();
  const intent = field(form, "intent");
  if (intent !== "tag") return data({ intent, error: { code: "INVALID_REQUEST" } } as ActionResult, { status: 400 });
  const deviceIds = form.getAll("deviceId").filter((v): v is string => typeof v === "string");
  const add = parseTags(field(form, "add"));
  const remove = parseTags(field(form, "remove"));
  if (deviceIds.length === 0 || deviceIds.length > 1000) return data({ intent, fieldError: "selectRequired" } as ActionResult, { status: 400 });
  if (add.length === 0 && remove.length === 0) return data({ intent, fieldError: "tagsRequired" } as ActionResult, { status: 400 });
  const problem = checkTags(add);
  if (problem) return data({ intent, fieldError: problem } as ActionResult, { status: 400 });
  const result = await callApi<{ results: { deviceId: string; ok: boolean; errorCode?: string }[] }>(ctx, request, "/api/v1/core/devices/tag", { method: "POST", body: { deviceIds, add, remove } });
  if (!result.ok) return data({ intent, error: { code: result.code, message: result.message } } as ActionResult, { status: result.status });
  return { intent, results: result.data?.results ?? [] } as ActionResult;
}

export default function Devices({ loaderData, actionData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const root = useRouteLoaderData("root") as RootData | undefined;
  const permissions = root?.me?.permissions;
  const canPlace = hasAny(permissions, ["DEV_PLACE"]);
  const canAdmin = hasAny(permissions, ["DEV_ADMIN"]);
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { devices, spaces, models, sources, now, page, pendingCount } = loaderData;
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkOpen, setBulkOpen] = useState(false);
  const canControl = hasAny(permissions, ["DEVICE_CONTROL"]);
  const result = actionData as ActionResult | undefined;
  const filtered = hasFilters(params);
  const rows = devices.responses;
  const exportQuery = deviceQuery(params, 1, 1000);
  exportQuery.delete("page");
  exportQuery.delete("size");
  exportQuery.set("format", "csv");
  const toggle = (id: string) => setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  const failures = (result?.results ?? []).filter((r) => !r.ok);

  return (
    <>
      <PageHeader
        title={t("devices.title")}
        actions={
          <>
            <a className="inline-flex items-center rounded-md border border-line bg-panel px-3 py-1.5 text-[13px] font-medium" href={`/bff/api/core/devices/export?${exportQuery}`}>
              {t("devices.exportCsv")}
            </a>
            {canAdmin && <ButtonLink to="/devices/new?import=1">{t("devices.importCsv")}</ButtonLink>}
            {canAdmin && (
              <ButtonLink to="/devices/new" variant="primary">
                {t("devices.add")}
              </ButtonLink>
            )}
          </>
        }
      />
      <DeviceAreaTabs current="all" pendingCount={pendingCount} />
      <Card>
        <Form method="get" className="mb-3 flex flex-wrap items-end gap-3" aria-label={t("common.filter")}>
          <TextField label={t("common.search")} name="q" defaultValue={params.get("q") ?? ""} placeholder={t("devices.searchPlaceholder")} />
          <SelectField label={t("devices.status")} name="status" defaultValue={params.get("status") ?? ""}>
            <option value="">{t("common.all")}</option>
            {DEVICE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`status.device.${s}`)}
              </option>
            ))}
          </SelectField>
          <SelectField label={t("devices.connectivity")} name="connectivity" defaultValue={params.get("connectivity") ?? ""}>
            <option value="">{t("common.all")}</option>
            {CONNECTIVITIES.map((c) => (
              <option key={c} value={c}>
                {t(`status.connectivity.${c}`)}
              </option>
            ))}
          </SelectField>
          <SelectField label={t("devices.kind")} name="kind" defaultValue={params.get("kind") ?? ""}>
            <option value="">{t("common.all")}</option>
            {DEVICE_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`devices.kinds.${k}`)}
              </option>
            ))}
          </SelectField>
          <SelectField label={t("devices.model")} name="modelId" defaultValue={params.get("modelId") ?? ""}>
            <option value="">{t("common.all")}</option>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name || m.code}
              </option>
            ))}
          </SelectField>
          <SpaceSelect spaces={spaces} label={t("devices.space")} name="spaceId" defaultValue={params.get("spaceId") ?? ""} emptyLabel={t("common.all")} />
          <SelectField label={t("devices.source")} name="sourceId" defaultValue={params.get("sourceId") ?? ""}>
            <option value="">{t("common.all")}</option>
            {sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name || s.code}
              </option>
            ))}
          </SelectField>
          <TextField label={t("devices.tag")} name="tag" defaultValue={params.get("tag") ?? ""} />
          <label className="flex items-center gap-1 text-[13px]">
            <input type="checkbox" name="virtual" value="true" defaultChecked={params.get("virtual") === "true"} />
            {t("devices.includeVirtual")}
          </label>
          <Button type="submit" variant="primary">
            {t("common.search")}
          </Button>
          {filtered && <ButtonLink to="/devices">{t("devices.resetFilters")}</ButtonLink>}
        </Form>

        {result?.fieldError && <Alert tone="danger">{t(`devices.errors.${result.fieldError}`)}</Alert>}
        {result?.error && <Alert tone="danger">{errorText(t, result.error)}</Alert>}
        {result?.results && (
          <Alert tone={failures.length ? "warning" : "success"}>
            {t("devices.resultSummary", { ok: result.results.length - failures.length, failed: failures.length })}
            {failures.map((f) => (
              <span key={f.deviceId} className="block">
                {f.deviceId}: {errorText(t, { code: f.errorCode ?? "UNKNOWN" })}
              </span>
            ))}
          </Alert>
        )}

        {rows.length === 0 ? (
          filtered ? (
            <EmptyState title={t("devices.emptyFiltered")} action={<ButtonLink to="/devices">{t("devices.resetFilters")}</ButtonLink>} />
          ) : (
            <EmptyState title={t("devices.empty")} action={<ButtonLink to="/sources">{t("devices.goSources")}</ButtonLink>} />
          )
        ) : (
          <Table>
            <thead>
              <tr>
                <th>
                  <span className="sr-only">{t("devices.select")}</span>
                </th>
                <th>{t("devices.connectivity")}</th>
                <th>{t("devices.name")}</th>
                <th>{t("devices.status")}</th>
                <th>{t("devices.model")}</th>
                <th>{t("devices.space")}</th>
                <th>{t("devices.lastSeen")}</th>
                <th>{t("devices.batteryLabel")}</th>
                <th>{t("devices.rssi")}</th>
                <th>{t("devices.tags")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.id} className="cursor-pointer hover:bg-bg" onClick={(e) => (e.target as HTMLElement).closest("input,a") || navigate(`/devices/${d.id}`)}>
                  <td>
                    <input type="checkbox" aria-label={t("devices.selectOne", { name: d.name })} checked={selected.includes(d.id)} onChange={() => toggle(d.id)} />
                  </td>
                  <td>
                    <ConnectivityLabel connectivity={d.connectivity} />
                  </td>
                  <td>
                    <Link to={`/devices/${d.id}`} className="font-medium text-accent hover:underline">
                      {d.name}
                    </Link>
                    {d.virtual && <span className="ml-1 text-[11px] text-muted">{t("chart.virtual")}</span>}
                  </td>
                  <td>
                    <DeviceStatusBadge status={d.status} />
                  </td>
                  <td>{d.model?.name ?? d.model?.code ?? "–"}</td>
                  <td>{d.space?.path?.join(" / ") ?? d.space?.name ?? "–"}</td>
                  <td>{formatRelative(d.lastSeenAt, now, i18n.language)}</td>
                  <td>
                    <BatteryBar value={d.battery} />
                  </td>
                  <td className="font-mono">{d.rssi ?? "–"}</td>
                  <td>{(d.tags ?? []).map((tag) => `#${tag}`).join(" ")}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <Pager page={page} totalPages={devices.totalPages} />
      </Card>

      {selected.length > 0 && (canPlace || canControl || canAdmin) && (
        <Card
          title={t("devices.selectedTools", { n: selected.length })}
          className="mt-4"
          actions={
            <>
              {/* UI-ACT-03 일괄 제어(ACT-02.06), UI-DEV-12 일괄 작업 마법사(DEV-02.09) */}
              {canControl && (
                <Button variant="primary" onClick={() => setBulkOpen(true)}>
                  {t("control.bulk.open")}
                </Button>
              )}
              {canAdmin && <ButtonLink to={`/device-jobs?new=1&deviceIds=${encodeURIComponent(selected.join(","))}`}>{t("devices.jobs.fromSelection")}</ButtonLink>}
            </>
          }
        >
          {canPlace && (
          <Form method="post" className="flex flex-wrap items-end gap-3">
            <CsrfField />
            <input type="hidden" name="intent" value="tag" />
            {selected.map((id) => (
              <input key={id} type="hidden" name="deviceId" value={id} />
            ))}
            <TextField label={t("devices.tagAdd")} name="add" hint={t("devices.tagHint")} />
            <TextField label={t("devices.tagRemove")} name="remove" />
            <Button type="submit" variant="primary">
              {t("devices.applyTags")}
            </Button>
          </Form>
          )}
        </Card>
      )}
      {canControl && <BulkControlDialog open={bulkOpen} onClose={() => setBulkOpen(false)} target={{ deviceIds: selected }} />}
    </>
  );
}
