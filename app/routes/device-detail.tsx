/**
 * UI-DEV-06 기기 상세 + UI-DEV-18 시맨틱 탭(DEV-02.01·02.03·02.10·13.01, DSH-07.05 즐겨찾기).
 * 탭: 개요(실시간 현재값) · 데이터(API-TSD-02 차트 + 실시간 점) · 원본 메시지(API-ING-05·06) · 시맨틱(API-DEV-131). 변경 이력(API-DEV-27)은 M4
 * · 자격증명(플랫폼 브로커 소스만, UI-DSC-06).
 * 편집 API-DEV-13(baseVersion), 활성/비활성 API-DEV-16, 삭제 API-DEV-17(사용처 있으면 막음), 태그 API-DEV-21.
 * 권한: 조회 VIEWER+, 공간·태그·활성 OPERATOR+(DEV_PLACE), 이름·모델·주기·삭제·시맨틱 편집 INTEGRATOR+(DEV_ADMIN).
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Form, Link, data, redirect, useRouteLoaderData } from "react-router";
import { callApi, callList, field, orThrow } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { SpaceSelect } from "~/components/space-picker";
import { Alert, Badge, Button, ButtonLink, Card, CsrfField, Dialog, EmptyState, PageHeader, SelectField, Table, Tabs, TextField } from "~/components/ui";
import { DeviceAreaTabs } from "~/features/devices/area-tabs";
import { ConnectivityLabel, DeviceDataPanel, DeviceOverview, DeviceStatusBadge } from "~/features/devices/components";
import { DEVICE_KINDS, isFavorite, metricChoices, parseTags, toggleFavorite, type DeviceDetail } from "~/features/devices/model/devices";
import { POINT_TYPES, errorsByField, semanticFromForm, type SemanticDoc } from "~/features/devices/model/semantic";
import { errorText } from "~/lib/error-text";
import { formatDateTime } from "~/lib/format";
import { hasAny } from "~/lib/permissions";
import type { SpaceNode } from "~/lib/spaces";
import type { RootData } from "~/root";
import { DeviceCredentialsPanel } from "~/features/sources/device-credentials";
import { simApi } from "~/features/sim/api";
import { VirtualDeviceTab } from "~/features/sim/components/virtual-device-tab";
import type { VirtualDeviceConfig } from "~/features/sim/model/types";
import { CommandHistory, HistoryFilters } from "~/features/control/command-history";
import { DeviceControlPanel } from "~/features/control/control-panel";
import { historyQuery, type Command, type ControlInfo } from "~/features/control/model/control";
import type { Route } from "./+types/device-detail";

export function meta() {
  return [{ title: "data2flow" }];
}

// 변경 이력(API-DEV-27)은 DEV-02.07(M4, 규칙·알람·명령 이력과 함께) 범위라 M2에서는 탭을 두지 않는다
// 제어(UI-ACT-01, ACT-02.04·04.01·04.02)·명령 이력(UI-ACT-02, ACT-04.03)은 M3
const TABS = ["overview", "data", "control", "commands", "virtual", "raw", "semantic", "credentials"] as const;
type Tab = (typeof TABS)[number];

interface RawRow {
  id: string;
  receivedAt?: string;
  topic?: string;
  status?: string;
  sizeBytes?: number;
}
interface RawDetail {
  id: string;
  receivedAt?: string;
  topic?: string;
  payload?: string;
  payloadEncoding?: string;
  status?: string;
  errorCode?: string | null;
  canonical?: unknown;
}
interface Preferences {
  favorites?: { type: string; id: string; name?: string }[];
  version?: number;
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const ctx = bff(context);
  const url = new URL(request.url);
  const id = encodeURIComponent(params.deviceId);
  const tabParam = url.searchParams.get("tab");
  const tab: Tab = (TABS as readonly string[]).includes(tabParam ?? "") ? (tabParam as Tab) : "overview";
  const editing = url.searchParams.get("edit") === "1";
  const now = ctx.runtime.now();
  const [device, prefs] = await Promise.all([
    callApi<DeviceDetail>(ctx, request, `/api/v1/core/devices/${id}`),
    callApi<Preferences>(ctx, request, "/api/v1/core/accounts/me/preferences"),
    // 최근 본 항목(DSH-07.05). 실패해도 화면은 그대로
    callApi(ctx, request, "/api/v1/core/accounts/me/recent", { method: "POST", body: { type: "DEVICE", id: params.deviceId } }).catch(() => undefined),
  ]);
  const detail = orThrow(device);

  let raw: { rows: RawRow[]; nextCursor?: string | null; failed: boolean; selected?: RawDetail | null } | undefined;
  let semantic: SemanticDoc | null | undefined;
  let modelMetrics: string[] = [];
  let control: ControlInfo | null | undefined;
  let commands: { rows: Command[]; nextCursor?: string | null; failed: boolean } | undefined;
  let virtualConfig: { config: VirtualDeviceConfig | null; failed: boolean } | undefined;
  if (tab === "raw") {
    const from = new Date(now - 7 * 86_400_000).toISOString();
    const to = new Date(now).toISOString();
    const query = new URLSearchParams({ deviceId: detail.id, from, to, size: "50" });
    const cursor = url.searchParams.get("cursor");
    if (cursor) query.set("cursor", cursor);
    const list = await callList<RawRow>(ctx, request, `/api/v1/core/ingest/raw-messages?${query}`);
    const rawId = url.searchParams.get("raw");
    const selected = rawId ? await callApi<RawDetail>(ctx, request, `/api/v1/core/ingest/raw-messages/${encodeURIComponent(rawId)}`) : undefined;
    raw = { rows: list.ok ? list.list.responses : [], nextCursor: list.ok ? list.list.nextCursor : null, failed: !list.ok, selected: selected?.ok ? selected.data : null };
  } else if (tab === "control") {
    // API-ACT-03 컨트롤 생성 정보(실패해도 화면은 열고 안내)
    const result = await callApi<ControlInfo>(ctx, request, `/api/v1/core/devices/${id}/control`);
    control = result.ok ? result.data : null;
  } else if (tab === "commands") {
    // API-ACT-02 기기별 명령 이력(커서 목록)
    const result = await callList<Command>(ctx, request, `/api/v1/core/devices/${id}/commands?${historyQuery(url.searchParams)}`);
    commands = { rows: result.ok ? result.list.responses : [], nextCursor: result.ok ? result.list.nextCursor : null, failed: !result.ok };
  } else if (tab === "virtual") {
    // UI-SIM-03 가상 기기 설정(API-SIM-09). 가상 기기가 아니면 탭을 보이지 않는다
    const sim = detail.virtual ? await callApi<VirtualDeviceConfig>(ctx, request, `/api/v1/core/sim/devices/${id}`) : null;
    virtualConfig = { config: sim?.ok ? sim.data : null, failed: Boolean(sim && !sim.ok) };
  } else if (tab === "semantic") {
    const result = await callApi<SemanticDoc>(ctx, request, `/api/v1/core/devices/${id}/semantic`);
    semantic = result.ok ? result.data : null;
  } else if (tab === "data" && detail.model?.id) {
    const model = await callApi<{ metrics?: { key: string }[] }>(ctx, request, `/api/v1/core/device-models/${encodeURIComponent(detail.model.id)}`);
    modelMetrics = model.ok ? (model.data?.metrics ?? []).map((m) => m.key) : [];
  }
  let editOptions: { models: { id: string; code: string; name: string }[]; spaces: SpaceNode[] } | undefined;
  if (editing) {
    const [models, spaces] = await Promise.all([callList<{ id: string; code: string; name: string }>(ctx, request, "/api/v1/core/device-models?size=100"), callApi<SpaceNode[]>(ctx, request, "/api/v1/core/spaces")]);
    editOptions = { models: models.ok ? models.list.responses : [], spaces: spaces.ok ? (spaces.data ?? []) : [] };
  }
  return { device: detail, tab, now, raw, virtualConfig, semantic, control, commands, modelMetrics, editOptions, preferences: prefs.ok ? prefs.data : null };
}

type ActionResult = { intent: string; done?: boolean; error?: { code: string; message?: string }; references?: { type: string; id: string; name?: string }[]; fieldErrors?: Record<string, string> };

export async function action({ request, context, params }: Route.ActionArgs) {
  const ctx = bff(context);
  const form = await request.formData();
  const intent = field(form, "intent");
  const base = `/api/v1/core/devices/${encodeURIComponent(params.deviceId)}`;
  const baseVersion = Number(field(form, "baseVersion")) || 0;
  const fail = (result: { code: string; message: string; status: number; errors?: { field: string; code: string; message: string }[] }, extra: Partial<ActionResult> = {}) =>
    data({ intent, error: { code: result.code, message: result.message }, ...extra } as ActionResult, { status: result.status });

  switch (intent) {
    case "edit": {
      const body: Record<string, unknown> = { baseVersion };
      for (const key of ["name", "modelId", "spaceId", "kind"]) if (form.has(key)) body[key] = field(form, key).trim() || undefined;
      for (const key of ["expectedIntervalSec", "offlineMultiplier"]) if (field(form, key)) body[key] = Number(field(form, key));
      if (typeof body.name === "string" && ((body.name as string).length < 1 || (body.name as string).length > 100)) return data({ intent, fieldErrors: { name: "nameInvalid" } } as ActionResult, { status: 400 });
      const result = await callApi(ctx, request, base, { method: "PATCH", body });
      if (!result.ok) return fail(result);
      if (form.has("tags")) {
        const before = parseTags(field(form, "tagsBefore"));
        const after = parseTags(field(form, "tags"));
        const add = after.filter((t) => !before.some((b) => b.toLowerCase() === t.toLowerCase()));
        const remove = before.filter((b) => !after.some((t) => t.toLowerCase() === b.toLowerCase()));
        if (add.length || remove.length) {
          const tagged = await callApi<{ results: { ok: boolean; errorCode?: string }[] }>(ctx, request, "/api/v1/core/devices/tag", { method: "POST", body: { deviceIds: [params.deviceId], add, remove } });
          if (!tagged.ok) return fail(tagged);
          const failed = tagged.data?.results?.find((r) => !r.ok);
          if (failed) return data({ intent, error: { code: failed.errorCode ?? "UNKNOWN" } } as ActionResult, { status: 400 });
        }
      }
      throw redirect(`/devices/${encodeURIComponent(params.deviceId)}`);
    }
    case "activate":
    case "deactivate": {
      const result = await callApi(ctx, request, `${base}/${intent}`, { method: "POST", body: { baseVersion } });
      return result.ok ? ({ intent, done: true } as ActionResult) : fail(result);
    }
    case "delete": {
      const result = await callApi<{ references?: { type: string; id: string; name?: string }[] }>(ctx, request, `${base}?baseVersion=${baseVersion}`, { method: "DELETE" });
      if (result.ok) throw redirect("/devices");
      return fail(result);
    }
    case "favorite": {
      const prefs = await callApi<Preferences>(ctx, request, "/api/v1/core/accounts/me/preferences");
      if (!prefs.ok) return fail(prefs);
      const favorites = toggleFavorite(prefs.data?.favorites, "DEVICE", params.deviceId);
      const result = await callApi(ctx, request, "/api/v1/core/accounts/me/preferences", { method: "PUT", body: { favorites, baseVersion: prefs.data?.version ?? 0 } });
      return result.ok ? ({ intent, done: true } as ActionResult) : fail(result);
    }
    case "semantic-save": {
      const result = await callApi(ctx, request, `${base}/semantic`, { method: "PUT", body: semanticFromForm(form) });
      if (result.ok) return { intent, done: true } as ActionResult;
      return data({ intent, error: { code: result.code, message: result.message }, fieldErrors: errorsByField(result.errors) } as ActionResult, { status: result.status });
    }
    case "semantic-reapply": {
      const result = await callApi(ctx, request, `${base}/semantic/reapply-model`, { method: "POST", body: {} });
      return result.ok ? ({ intent, done: true } as ActionResult) : fail(result);
    }
    default:
      return data({ intent, error: { code: "INVALID_REQUEST" } } as ActionResult, { status: 400 });
  }
}

function PostButton({ intent, label, version, confirm, variant = "secondary" }: { intent: string; label: string; version: number; confirm?: string; variant?: "secondary" | "danger" | "ghost" }) {
  return (
    <Form
      method="post"
      onSubmit={(event) => {
        if (confirm && !window.confirm(confirm)) event.preventDefault();
      }}
    >
      <CsrfField />
      <input type="hidden" name="intent" value={intent} />
      <input type="hidden" name="baseVersion" value={version} />
      <Button type="submit" variant={variant}>
        {label}
      </Button>
    </Form>
  );
}

export default function DeviceDetailRoute({ loaderData, actionData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const root = useRouteLoaderData("root") as RootData | undefined;
  const permissions = root?.me?.permissions;
  const canPlace = hasAny(permissions, ["DEV_PLACE"]);
  const canAdmin = hasAny(permissions, ["DEV_ADMIN"]);
  const timezone = root?.timezone ?? "Asia/Seoul";
  const { device, tab, now, raw, semantic, control, commands, modelMetrics, editOptions, preferences } = loaderData;
  const result = actionData as ActionResult | undefined;
  const [deleteOpen, setDeleteOpen] = useState(false);
  const favorite = isFavorite(preferences?.favorites, "DEVICE", device.id);
  const platformBroker = device.source?.type === "PLATFORM_BROKER";
  const tabItems = TABS.filter((k) => (k !== "credentials" || platformBroker) && (k !== "virtual" || device.virtual)).map((k) => ({ key: k, label: k === "virtual" ? t("sim.virtual") : t(`devices.tabs.${k}`), to: `?tab=${k}` }));
  const fmt = (iso?: string | null) => formatDateTime(iso ?? undefined, timezone, i18n.language, true);
  const conflict = result?.error?.code === "VERSION_CONFLICT";

  return (
    <>
      <PageHeader
        crumb={
          <span>
            <Link to="/devices" className="hover:underline">
              {t("devices.title")}
            </Link>
            {(device.space?.path ?? []).map((name, i) => (
              <span key={`${name}-${i}`}>
                {" › "}
                {i === (device.space?.path?.length ?? 0) - 1 && device.space ? (
                  <Link to={`/spaces/${device.space.id}`} className="hover:underline">
                    {name}
                  </Link>
                ) : (
                  name
                )}
              </span>
            ))}
          </span>
        }
        title={
          <span className="inline-flex items-center gap-2">
            {device.name}
            <Form method="post" className="inline">
              <CsrfField />
              <input type="hidden" name="intent" value="favorite" />
              <button type="submit" aria-pressed={favorite} aria-label={favorite ? t("devices.unfavorite") : t("devices.favorite")} className="text-[18px] text-warn">
                {favorite ? "★" : "☆"}
              </button>
            </Form>
          </span>
        }
        actions={
          <>
            <DeviceStatusBadge status={device.status} />
            <ConnectivityLabel connectivity={device.state?.connectivity} />
            {canPlace && <ButtonLink to="?edit=1">{t("common.edit")}</ButtonLink>}
            {canPlace && device.status === "ACTIVE" && <PostButton intent="deactivate" label={t("devices.deactivate")} version={device.version} confirm={t("devices.deactivateConfirm")} />}
            {canPlace && device.status === "INACTIVE" && <PostButton intent="activate" label={t("devices.activate")} version={device.version} />}
            {canAdmin && (
              <Button variant="danger" onClick={() => setDeleteOpen(true)}>
                {t("common.delete")}
              </Button>
            )}
          </>
        }
      />
      <DeviceAreaTabs current="all" />
      <p className="mb-3 text-[13px] text-muted">
        {device.model ? (
          <Link to={`/models/${encodeURIComponent(device.model.code ?? device.model.id)}`} className="hover:underline">
            {device.model.name ?? device.model.code}
          </Link>
        ) : (
          t("devices.noModel")
        )}
        {" · "}
        <span className="font-mono">{device.externalId}</span>
        {(device.tags ?? []).length > 0 && ` · ${(device.tags ?? []).map((tag) => `#${tag}`).join(" ")}`}
        {device.virtual && ` · ${t("chart.virtual")}`}
      </p>

      {result?.done && (
        <div className="mb-3">
          <Alert tone="success">{t("common.done")}</Alert>
        </div>
      )}
      {result?.error && (
        <div className="mb-3">
          <Alert tone="danger">
            {conflict ? t("devices.conflict") : errorText(t, result.error)}
            {conflict && (
              <Link to={`/devices/${device.id}`} className="ml-2 underline">
                {t("common.refresh")}
              </Link>
            )}
          </Alert>
        </div>
      )}

      {editOptions && <EditPanel device={device} options={editOptions} canAdmin={canAdmin} fieldErrors={result?.fieldErrors} />}

      <Tabs items={tabItems} current={tab} />
      {tab === "virtual" && loaderData.virtualConfig && <VirtualDeviceTab deviceId={device.id} initial={loaderData.virtualConfig.config} failed={loaderData.virtualConfig.failed} canManage={hasAny(permissions, ["SIM_MANAGE"])} api={simApi} />}
      {tab === "overview" && <DeviceOverview device={device} timezone={timezone} lang={i18n.language} now={now} />}
      {tab === "data" && <DeviceDataPanel deviceId={device.id} metrics={metricChoices(device.latest, modelMetrics)} latest={device.latest} expectedIntervalSec={device.effective?.expectedIntervalSec} timezone={timezone} now={Date.now} />}
      {tab === "raw" && raw && (
        <Card title={t("devices.raw.title")}>
          {raw.failed && <Alert tone="warning">{t("devices.raw.unavailable")}</Alert>}
          {raw.rows.length === 0 && !raw.failed ? (
            <EmptyState title={t("devices.raw.empty")} />
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>{t("devices.raw.receivedAt")}</th>
                  <th>{t("devices.raw.topic")}</th>
                  <th>{t("devices.raw.status")}</th>
                  <th>{t("devices.raw.size")}</th>
                </tr>
              </thead>
              <tbody>
                {raw.rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link to={`?tab=raw&raw=${encodeURIComponent(r.id)}`} className="font-mono text-accent hover:underline">
                        {fmt(r.receivedAt)}
                      </Link>
                    </td>
                    <td className="font-mono text-[12px]">{r.topic}</td>
                    <td>{r.status}</td>
                    <td className="font-mono">{`${r.sizeBytes ?? "–"}B`}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          {raw.nextCursor && (
            <div className="mt-2 flex justify-end">
              <ButtonLink to={`?tab=raw&cursor=${encodeURIComponent(raw.nextCursor)}`}>{t("common.more")}</ButtonLink>
            </div>
          )}
          {raw.selected && (
            <section className="mt-3" aria-label={t("devices.raw.json")}>
              <h3 className="mb-1 text-[13px] font-semibold">{t("devices.raw.json")}</h3>
              <pre className="max-h-80 overflow-auto rounded bg-bg p-3 font-mono text-[12px]">{raw.selected.payload ?? t("devices.raw.noPayload")}</pre>
              {raw.selected.canonical !== undefined && raw.selected.canonical !== null && <pre className="mt-2 max-h-80 overflow-auto rounded bg-bg p-3 font-mono text-[12px]">{JSON.stringify(raw.selected.canonical, null, 2)}</pre>}
            </section>
          )}
        </Card>
      )}
      {tab === "control" && <DeviceControlPanel deviceId={device.id} spaceId={device.space?.id} initial={control ?? null} canControl={hasAny(permissions, ["DEVICE_CONTROL"])} timezone={timezone} lang={i18n.language} />}
      {tab === "commands" && commands && (
        <Card title={t("devices.tabs.commands")}>
          <HistoryFilters hidden={{ tab: "commands" }} />
          <CommandHistory key={commands.rows.map((r) => r.id).join(",")} rows={commands.rows} failed={commands.failed} moreHref={commands.nextCursor ? `?tab=commands&cursor=${encodeURIComponent(commands.nextCursor)}` : null} showDevice={false} canControl={hasAny(permissions, ["DEVICE_CONTROL"])} timezone={timezone} lang={i18n.language} />
        </Card>
      )}
      {tab === "semantic" && <SemanticTab semantic={semantic ?? null} canEdit={canAdmin} fieldErrors={result?.intent === "semantic-save" ? result.fieldErrors : undefined} />}
      {tab === "credentials" && platformBroker && (
        <Card title={t("devices.tabs.credentials")}>
          {/* 플랫폼 브로커 기기 자격증명(UI-DSC-06, DSC-03.02·03.05): 승인 뒤 서명 키를 여기서 한 번 발급한다(ADR-031) */}
          <DeviceCredentialsPanel deviceId={device.id} externalId={device.externalId} canAdmin={hasAny(permissions, ["SRC_ADMIN"])} timezone={timezone} lang={i18n.language} />
        </Card>
      )}

      <Dialog
        title={t("devices.deleteTitle")}
        open={deleteOpen || result?.intent === "delete"}
        onClose={() => setDeleteOpen(false)}
        footer={
          <Button type="submit" form="delete-form" variant="danger" disabled={result?.error?.code === "DEVICE_IN_USE"}>
            {t("common.delete")}
          </Button>
        }
      >
        <p className="text-[13px]">{t("devices.deleteBody", { name: device.name })}</p>
        {result?.intent === "delete" && result.error?.code === "DEVICE_IN_USE" && <p className="text-[13px] text-bad">{t("devices.inUse")}</p>}
        <Form method="post" id="delete-form">
          <CsrfField />
          <input type="hidden" name="intent" value="delete" />
          <input type="hidden" name="baseVersion" value={device.version} />
        </Form>
      </Dialog>
    </>
  );
}

function EditPanel({ device, options, canAdmin, fieldErrors }: { device: DeviceDetail; options: { models: { id: string; code: string; name: string }[]; spaces: SpaceNode[] }; canAdmin: boolean; fieldErrors?: Record<string, string> }) {
  const { t } = useTranslation();
  return (
    <Card title={t("devices.editTitle")} className="mb-4" actions={<ButtonLink to="?">{t("common.close")}</ButtonLink>}>
      <Form method="post" className="grid gap-3 sm:grid-cols-2">
        <CsrfField />
        <input type="hidden" name="intent" value="edit" />
        <input type="hidden" name="baseVersion" value={device.version} />
        <input type="hidden" name="tagsBefore" value={(device.tags ?? []).join(",")} />
        {canAdmin && (
          <>
            <TextField label={t("devices.name")} name="name" defaultValue={device.name} maxLength={100} error={fieldErrors?.name && t(`devices.errors.${fieldErrors.name}`)} />
            <SelectField label={t("devices.kind")} name="kind" defaultValue={device.kind}>
              {DEVICE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`devices.kinds.${k}`)}
                </option>
              ))}
            </SelectField>
            <SelectField label={t("devices.model")} name="modelId" defaultValue={device.model?.id ?? ""}>
              <option value="">{t("devices.chooseModel")}</option>
              {options.models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name || m.code}
                </option>
              ))}
            </SelectField>
            <TextField label={t("devices.new.interval")} name="expectedIntervalSec" type="number" defaultValue={device.effective?.inheritedFrom === "DEVICE" ? String(device.effective.expectedIntervalSec ?? "") : ""} hint={t("devices.new.intervalHint")} />
            <TextField label={t("devices.new.multiplier")} name="offlineMultiplier" type="number" step="0.1" defaultValue="" />
          </>
        )}
        <SpaceSelect spaces={options.spaces} label={t("devices.space")} name="spaceId" defaultValue={device.space?.id ?? ""} />
        <TextField label={t("devices.tags")} name="tags" defaultValue={(device.tags ?? []).join(", ")} hint={t("devices.tagHint")} />
        <div className="flex justify-end sm:col-span-2">
          <Button type="submit" variant="primary">
            {t("common.save")}
          </Button>
        </div>
      </Form>
    </Card>
  );
}

function SemanticTab({ semantic, canEdit, fieldErrors = {} }: { semantic: SemanticDoc | null; canEdit: boolean; fieldErrors?: Record<string, string> }) {
  const { t } = useTranslation();
  const equipment = semantic?.equipment ?? [];
  return (
    <Card
      title={t("devices.semantic.title")}
      actions={
        canEdit && (
          <Form method="post">
            <CsrfField />
            <input type="hidden" name="intent" value="semantic-reapply" />
            <Button type="submit">{t("devices.semantic.reapply")}</Button>
          </Form>
        )
      }
    >
      {equipment.length === 0 ? (
        <EmptyState title={t("devices.semantic.empty")} />
      ) : (
        <Form method="post" className="flex flex-col gap-4">
          <CsrfField />
          <input type="hidden" name="intent" value="semantic-save" />
          {equipment.map((eq, i) => (
            <section key={eq.id ?? i} className="rounded-md border border-line p-3">
              <div className="mb-2 flex flex-wrap gap-3">
                <TextField label={t("devices.semantic.equipClass")} name={`eq.${i}.equipClass`} defaultValue={eq.equipClass} readOnly={!canEdit} error={fieldErrors[`eq.${i}.equipClass`]} />
                <TextField label={t("devices.semantic.equipName")} name={`eq.${i}.name`} defaultValue={eq.name} readOnly={!canEdit} error={fieldErrors[`eq.${i}.name`]} />
              </div>
              <Table>
                <thead>
                  <tr>
                    <th>{t("devices.semantic.metric")}</th>
                    <th>{t("devices.semantic.pointType")}</th>
                    <th>{t("devices.semantic.quantity")}</th>
                    <th>{t("devices.semantic.tags")}</th>
                  </tr>
                </thead>
                <tbody>
                  {eq.points.map((p, j) => {
                    const prefix = `eq.${i}.pt.${j}`;
                    return (
                      <tr key={p.id ?? `${p.metricKey}-${j}`}>
                        <td className="font-mono">
                          {p.metricKey}
                          <input type="hidden" name={`${prefix}.metricKey`} value={p.metricKey} />
                        </td>
                        <td>
                          <SelectField label={t("devices.semantic.pointTypeOf", { metric: p.metricKey })} name={`${prefix}.pointType`} defaultValue={p.pointType} disabled={!canEdit} error={fieldErrors[`${prefix}.pointType`]}>
                            {POINT_TYPES.map((pt) => (
                              <option key={pt} value={pt}>
                                {pt}
                              </option>
                            ))}
                          </SelectField>
                        </td>
                        <td>
                          <TextField label={t("devices.semantic.quantityOf", { metric: p.metricKey })} name={`${prefix}.quantity`} defaultValue={p.quantity ?? ""} readOnly={!canEdit} error={fieldErrors[`${prefix}.quantity`]} />
                        </td>
                        <td>
                          <TextField label={t("devices.semantic.tagsOf", { metric: p.metricKey })} name={`${prefix}.tags`} defaultValue={(p.tags ?? []).join(", ")} readOnly={!canEdit} error={fieldErrors[`${prefix}.tags`]} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            </section>
          ))}
          {canEdit && (
            <div className="flex justify-end">
              <Button type="submit" variant="primary">
                {t("common.save")}
              </Button>
            </div>
          )}
          {!canEdit && <Badge tone="neutral">{t("devices.semantic.readOnly")}</Badge>}
        </Form>
      )}
    </Card>
  );
}
