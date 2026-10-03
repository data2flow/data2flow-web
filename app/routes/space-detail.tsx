/**
 * /spaces/:spaceId 공간 상세(UI-DEV-01·02·03 + UI-DSH-02, DEV-01.01~01.04, DEV-10.01, DEV-11.01, DSH-01.02, DSH-07.05).
 * 왼쪽 트리(편집은 DEV_ADMIN), 오른쪽 경로·쾌적도·즐겨찾기와 탭: 개요(실시간 기기 카드)·기기·속성·목표 환경·운영 시간·평면도.
 * API: API-DEV-01~10, API-DSH-02(개요)·03(평면도 보기)·12(즐겨찾기·최근 본 항목), API-DEV-11(기기 목록)·18(공간 기기)
 */
import { useTranslation } from "react-i18next";
import { Form, Link, data, useActionData, useLoaderData, useRouteLoaderData } from "react-router";
import { callApi, callList, field } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { Alert, Badge, Button, Card, CsrfField, PageHeader, StatusDot, Table, Tabs } from "~/components/ui";
import { isFavorite, toggleFavorite, type Favorite } from "~/features/home/model/home";
import { FloorplanPanel, type FloorplanView } from "~/features/spaces/components/floorplan";
import { ModeCard, PropsForm, ScheduleEditor, TargetsEditor, type FormResult, type ModeData, type ScheduleData, type SpaceDetail, type TargetsData } from "~/features/spaces/components/space-manage";
import { ChildSpaces, ComfortBadge, ComfortCauses, DeviceCards } from "~/features/spaces/components/space-overview";
import { SpaceTree, type TreeActionResult } from "~/features/spaces/components/space-tree";
import type { OverviewDevice } from "~/features/spaces/model/live-devices";
import { checkFloorplanFile, checkSlots, checkTargets, parseJsonArray, type Slot, type TargetRow } from "~/features/spaces/model/space-forms";
import { formatRelative } from "~/lib/format";
import { hasAny } from "~/lib/permissions";
import { checkSpaceInput, findSpace } from "~/lib/spaces";
import type { RootData } from "~/root";
import type { Route } from "./+types/space-detail";
import { loadTree, treeAction } from "./spaces-shared.server";

const TABS = ["overview", "devices", "props", "targets", "schedule", "floorplan"] as const;
type Tab = (typeof TABS)[number];

interface Overview {
  comfort?: { state?: string; causes?: { metricKey: string; value?: number | null; unit?: string | null }[]; updatedAt?: string } | null;
  devices?: OverviewDevice[];
  hasFloorplan?: boolean;
}

interface DeviceRow {
  id: string;
  name: string;
  status?: string;
  connectivity?: string;
  lastSeenAt?: string | null;
  model?: { name?: string } | null;
  space?: { path?: string[] } | null;
}

interface Preferences {
  favorites?: Favorite[];
  version?: number;
}

export function meta() {
  return [{ title: "data2flow" }];
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const ctx = bff(context);
  const url = new URL(request.url);
  const tabParam = url.searchParams.get("tab") ?? "overview";
  const tab: Tab = (TABS as readonly string[]).includes(tabParam) ? (tabParam as Tab) : "overview";
  const id = encodeURIComponent(params.spaceId);
  const base = `/api/v1/core/spaces/${id}`;
  const [tree, space, overview, prefs] = await Promise.all([
    loadTree(ctx, request),
    callApi<SpaceDetail>(ctx, request, base),
    callApi<Overview>(ctx, request, `${base}/overview`),
    callApi<Preferences>(ctx, request, "/api/v1/core/accounts/me/preferences"),
  ]);
  if (!space.ok) throw data({ code: space.code }, { status: space.status === 401 ? 401 : space.status });
  // 최근 본 항목(API-DSH-12). 실패해도 화면은 그대로 보인다
  await callApi(ctx, request, "/api/v1/core/accounts/me/recent", { method: "POST", body: { type: "SPACE", id: params.spaceId } });

  let devices: DeviceRow[] = [];
  let targets: TargetsData | null = null;
  let metrics: { key: string; displayName?: string; unit?: string | null }[] = [];
  let schedule: ScheduleData | null = null;
  let mode: ModeData | null = null;
  let floorplan: FloorplanView | null = null;
  let spaceDevices: { id: string; name: string }[] = [];
  if (tab === "devices") {
    const list = await callList<DeviceRow>(ctx, request, `/api/v1/core/devices?spaceId=${id}&includeDescendants=true&size=100`);
    if (list.ok) devices = list.list.responses;
  } else if (tab === "targets") {
    const [t, m] = await Promise.all([callApi<TargetsData>(ctx, request, `${base}/targets`), callList<{ key: string; displayName?: string; unit?: string | null }>(ctx, request, "/api/v1/core/metrics?status=VERIFIED&size=100")]);
    targets = t.ok ? t.data : { inherit: true, items: [], effective: [] };
    metrics = m.ok ? m.list.responses : [];
  } else if (tab === "schedule") {
    const [s, m] = await Promise.all([callApi<ScheduleData>(ctx, request, `${base}/schedule`), callApi<ModeData>(ctx, request, `${base}/mode`)]);
    schedule = s.ok ? s.data : { inherit: true, slots: [] };
    mode = m.ok ? m.data : null;
  } else if (tab === "floorplan") {
    const [f, d] = await Promise.all([callApi<FloorplanView>(ctx, request, `${base}/floorplan`), callList<{ id: string; name: string }>(ctx, request, `${base}/devices?includeDescendants=false`)]);
    floorplan = f.ok ? f.data : null;
    spaceDevices = d.ok ? d.list.responses.map((x) => ({ id: String(x.id), name: x.name })) : [];
  }
  return {
    tab,
    tree,
    space: space.data,
    overview: overview.ok ? overview.data : null,
    favorite: prefs.ok ? isFavorite(prefs.data.favorites, "SPACE", params.spaceId) : false,
    devices,
    targets,
    metrics,
    schedule,
    mode,
    floorplan,
    spaceDevices,
    now: Date.now(),
  };
}

function fail(intent: string, result: { code: string; message: string; status: number }) {
  return data({ intent, error: { code: result.code, message: result.message } } as FormResult, { status: result.status });
}

const optionalNumber = (raw: string) => (raw.trim() === "" ? null : Number(raw));

export async function action({ request, context, params }: Route.ActionArgs) {
  const ctx = bff(context);
  const form = await request.formData();
  const intent = field(form, "intent");
  const tree = await treeAction(ctx, request, form, intent, params.spaceId);
  if (tree) return tree;
  const base = `/api/v1/core/spaces/${encodeURIComponent(params.spaceId)}`;
  switch (intent) {
    case "props": {
      const input = { name: field(form, "name"), type: "ROOM", code: field(form, "code").trim(), latitude: field(form, "latitude").trim(), longitude: field(form, "longitude").trim() };
      const errors = checkSpaceInput(input);
      for (const key of ["areaM2", "capacity"]) {
        const raw = field(form, key).trim();
        if (raw && !(Number(raw) >= 0)) errors[key] = "notNumber";
      }
      if (Object.keys(errors).length) return data({ intent, fieldErrors: errors } as FormResult, { status: 400 });
      const body: Record<string, unknown> = {
        name: input.name.trim(),
        code: input.code || null,
        usage: field(form, "usage") || null,
        areaM2: optionalNumber(field(form, "areaM2")),
        capacity: optionalNumber(field(form, "capacity")),
        baseVersion: Number(field(form, "baseVersion")),
      };
      if (form.has("timezone")) Object.assign(body, { timezone: field(form, "timezone"), address: field(form, "address") || null, latitude: optionalNumber(input.latitude), longitude: optionalNumber(input.longitude) });
      const result = await callApi(ctx, request, base, { method: "PATCH", body });
      return result.ok ? ({ intent, ok: true } as FormResult) : fail(intent, result);
    }
    case "targets": {
      const inherit = field(form, "inherit") === "true";
      const rows = parseJsonArray<{ metricKey: string; min?: number; max?: number }>(field(form, "items")).map((i): TargetRow => ({ metricKey: i.metricKey, min: i.min === undefined ? "" : String(i.min), max: i.max === undefined ? "" : String(i.max) }));
      const { items, errors } = checkTargets(rows);
      if (!inherit && Object.keys(errors).length) return data({ intent, error: { code: "INVALID_REQUEST" } } as FormResult, { status: 400 });
      const result = await callApi(ctx, request, `${base}/targets`, { method: "PUT", body: { inherit, items: inherit ? [] : items } });
      return result.ok ? ({ intent, ok: true } as FormResult) : fail(intent, result);
    }
    case "schedule": {
      const inherit = field(form, "inherit") === "true";
      const slots = inherit ? [] : parseJsonArray<Slot>(field(form, "slots"));
      if (Object.keys(checkSlots(slots)).length) return data({ intent, error: { code: "SCHEDULE_OVERLAP" } } as FormResult, { status: 400 });
      const result = await callApi(ctx, request, `${base}/schedule`, { method: "PUT", body: { inherit, slots } });
      return result.ok ? ({ intent, ok: true } as FormResult) : fail(intent, result);
    }
    case "floorplan": {
      const file = form.get("file");
      if (!(file instanceof File) || !checkFloorplanFile({ type: file.type, size: file.size })) return data({ intent, error: { code: "FLOORPLAN_IMAGE_INVALID" } } as FormResult, { status: 400 });
      const upload = new FormData();
      upload.set("file", file, file.name);
      const result = await callApi(ctx, request, `${base}/floorplan`, { method: "PUT", rawBody: upload });
      return result.ok ? ({ intent, ok: true } as FormResult) : fail(intent, result);
    }
    case "markers": {
      const markers = parseJsonArray<{ deviceId: string; x: number; y: number }>(field(form, "markers")).filter((m) => m.x >= 0 && m.x <= 1 && m.y >= 0 && m.y <= 1);
      const result = await callApi(ctx, request, `${base}/floorplan/markers`, { method: "PUT", body: { markers } });
      return result.ok ? ({ intent, ok: true } as FormResult) : fail(intent, result);
    }
    case "favorite": {
      const prefs = await callApi<Preferences>(ctx, request, "/api/v1/core/accounts/me/preferences");
      if (!prefs.ok) return fail(intent, prefs);
      const favorites = toggleFavorite(prefs.data.favorites, { type: "SPACE", id: params.spaceId });
      const result = await callApi(ctx, request, "/api/v1/core/accounts/me/preferences", { method: "PUT", body: { favorites, baseVersion: prefs.data.version } });
      return result.ok ? ({ intent, ok: true } as FormResult) : fail(intent, result);
    }
    default:
      return data({ intent, error: { code: "INVALID_REQUEST" } } as FormResult, { status: 400 });
  }
}

export default function SpaceDetailPage() {
  const { t, i18n } = useTranslation();
  const loaded = useLoaderData<typeof loader>();
  const result = useActionData<FormResult & TreeActionResult>() ?? undefined;
  const root = useRouteLoaderData("root") as RootData | undefined;
  const me = root?.me;
  const timezone = root?.timezone ?? "Asia/Seoul";
  const lang = i18n.language;
  const canEdit = hasAny(me?.permissions, ["DEV_ADMIN"]);
  const { space, tree, tab, overview } = loaded;
  const flat = findSpace(tree, space.id);
  const children = (flat?.node.children ?? []).map((c) => ({ id: String(c.id), name: c.name, type: c.type }));
  const tabs = TABS.map((key) => ({ key, label: t(`spaces.tab.${key}`), to: `/spaces/${space.id}?tab=${key}` }));
  return (
    <div className="grid gap-4 md:grid-cols-[260px_1fr]">
      <aside>
        <SpaceTree spaces={tree} selectedId={space.id} canEdit={canEdit} result={result && ["create", "rename", "move", "delete"].includes(result.intent ?? "") ? result : undefined} />
      </aside>
      <section>
        <PageHeader
          crumb={(flat?.path ?? [space.name]).join(" › ")}
          title={
            <span className="inline-flex items-center gap-2">
              {space.name}
              <Badge tone="neutral">{t(`spaceType.${space.type}`, { defaultValue: space.type })}</Badge>
              {overview?.comfort && <ComfortBadge state={overview.comfort.state} />}
            </span>
          }
          actions={
            <Form method="post">
              <CsrfField />
              <input type="hidden" name="intent" value="favorite" />
              <Button type="submit" aria-pressed={loaded.favorite}>
                {loaded.favorite ? t("spaces.favorite.on") : t("spaces.favorite.off")}
              </Button>
            </Form>
          }
        />
        {overview?.comfort?.causes?.length ? (
          <p className="mb-3 text-[13px] text-muted">
            {t("spaces.overview.causes")} <ComfortCauses causes={overview.comfort.causes} />
          </p>
        ) : null}
        <Tabs items={tabs} current={tab} />
        {tab === "overview" && (
          <div className="flex flex-col gap-4">
            <DeviceCards spaceId={space.id} devices={overview?.devices ?? []} now={loaded.now} lang={lang} />
            <ChildSpaces>{children}</ChildSpaces>
          </div>
        )}
        {tab === "devices" && <DevicesTab devices={loaded.devices} now={loaded.now} lang={lang} spaceId={space.id} />}
        {tab === "props" && <PropsForm space={space} canEdit={canEdit} result={result} />}
        {tab === "targets" && loaded.targets && <TargetsEditor data={loaded.targets} metrics={loaded.metrics} canEdit={canEdit} result={result} />}
        {tab === "schedule" && loaded.schedule && (
          <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
            <ScheduleEditor data={loaded.schedule} canEdit={canEdit} result={result} />
            {/* 운영 모드 수동 지정(API-DEV-08 POST …/override-mode)은 core M2에 아직 없어 조회만 보인다(DEV-11.02는 M3) */}
            <ModeCard data={loaded.mode} canOverride={false} timezone={timezone} lang={lang} now={loaded.now} result={result} />
          </div>
        )}
        {tab === "floorplan" && <FloorplanPanel view={loaded.floorplan} devices={loaded.spaceDevices} canEdit={canEdit} result={result} />}
        {result?.error && (result.intent === "favorite" || (!canEdit && ["create", "rename", "move", "delete"].includes(result.intent ?? ""))) && <Alert tone="danger">{t(`errors.${result.error.code}`, { defaultValue: t("errors.UNKNOWN") })}</Alert>}
      </section>
    </div>
  );
}

function DevicesTab({ devices, now, lang, spaceId }: { devices: DeviceRow[]; now: number; lang: string; spaceId: string }) {
  const { t } = useTranslation();
  if (devices.length === 0) {
    return (
      <Card>
        <p className="text-[13px] text-muted">{t("spaces.overview.noDevices")}</p>
        <Link className="text-accent underline" to="/devices/pending">
          {t("spaces.overview.placeDevices")}
        </Link>
      </Card>
    );
  }
  return (
    <Card actions={<Link className="text-[12.5px] text-accent" to={`/devices?spaceId=${spaceId}`}>{t("spaces.devices.openList")}</Link>}>
      <Table>
        <thead>
          <tr>
            <th scope="col">{t("spaces.devices.name")}</th>
            <th scope="col">{t("spaces.devices.status")}</th>
            <th scope="col">{t("spaces.devices.model")}</th>
            <th scope="col">{t("spaces.devices.path")}</th>
            <th scope="col">{t("spaces.devices.lastSeen")}</th>
          </tr>
        </thead>
        <tbody>
          {devices.map((d) => (
            <tr key={d.id}>
              <td>
                <Link to={`/devices/${d.id}`} className="text-accent hover:underline">
                  {d.name}
                </Link>
              </td>
              <td>
                <StatusDot tone={d.connectivity === "ONLINE" ? "good" : d.connectivity === "OFFLINE" ? "bad" : "warn"} label={t(`status.device.${d.status ?? "ACTIVE"}`, { defaultValue: d.status ?? "" })} />
              </td>
              <td>{d.model?.name ?? "–"}</td>
              <td>{d.space?.path?.join(" › ") ?? "–"}</td>
              <td>{formatRelative(d.lastSeenAt, now, lang)}</td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}
