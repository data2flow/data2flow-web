/**
 * /spaces/:spaceId 공간 상세(UI-DEV-01·02·03 + UI-DSH-02, DEV-01.01~01.04, DEV-10.01, DEV-11.01, DSH-01.02, DSH-07.05).
 * 왼쪽 트리(편집은 DEV_ADMIN), 오른쪽 경로·쾌적도·즐겨찾기와 탭: 개요(실시간 기기 카드)·기기·속성·목표 환경·운영 시간·평면도.
 * API: API-DEV-01~10, API-DSH-02(개요)·03(평면도 보기)·12(즐겨찾기·최근 본 항목), API-DEV-11(기기 목록)·18(공간 기기)
 * M5: 평면도 보기(실시간 마커·히트 컬러·확대, DSH-02.02·02.03), 위치 경로(DSH-09.02), 건물 층 전환(`?floor=`)과 [3D] 탭(IFC, DSH-12.04, API-DSH-24),
 * 운영 모드 수동 지정(API-DEV-08 POST, DEV_PLACE — core M5 DEV-11.02)
 */
import { useTranslation } from "react-i18next";
import { Form, Link, data, useActionData, useLoaderData, useRouteLoaderData } from "react-router";
import { callApi, callList, field } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { Alert, Badge, Button, Card, CsrfField, PageHeader, StatusDot, Table, Tabs } from "~/components/ui";
import { isFavorite, toggleFavorite, type Favorite } from "~/features/home/model/home";
import { LocationPath } from "~/components/breadcrumb/location-path";
import { BimPanel } from "~/features/bim/components/bim-panel";
import { checkIfcFile, mappingBody, type ModelDetail, type ModelSummary } from "~/features/bim/model/bim";
import { FloorSwitcher } from "~/features/floorplan/components/floor-switcher";
import { FloorplanLive } from "~/features/floorplan/components/floorplan-live";
import { buildingOf, floorNav, locationPath, type FloorItem, type FloorNav } from "~/features/floorplan/model/location";
import { FloorplanPanel, type FloorplanView } from "~/features/spaces/components/floorplan";
import { ModeCard, PropsForm, ScheduleEditor, TargetsEditor, type FormResult, type ModeData, type ScheduleData, type SpaceDetail, type TargetsData } from "~/features/spaces/components/space-manage";
import { SpaceAlarms } from "~/features/spaces/components/space-alarms";
import { ChildSpaces, ComfortBadge, ComfortCauses, DeviceCards } from "~/features/spaces/components/space-overview";
import type { SpaceAlarm } from "~/features/spaces/model/space-alarms";
import { SpaceTree, type TreeActionResult } from "~/features/spaces/components/space-tree";
import type { OverviewDevice } from "~/features/spaces/model/live-devices";
import { checkFloorplanFile, checkSlots, checkTargets, parseJsonArray, type Slot, type TargetRow } from "~/features/spaces/model/space-forms";
import { formatRelative } from "~/lib/format";
import { hasAny } from "~/lib/permissions";
import { checkSpaceInput, descendantIds, findSpace } from "~/lib/spaces";
import type { RootData } from "~/root";
import type { Route } from "./+types/space-detail";
import { loadTree, treeAction } from "./spaces-shared.server";

// 보기 탭(UI-DSH-02: 개요·알람) + 관리 탭(UI-DEV-01~03)
const TABS = ["overview", "alarms", "devices", "props", "targets", "schedule", "floorplan", "model3d"] as const;
type Tab = (typeof TABS)[number];

interface Overview {
  comfort?: { state?: string; causes?: { metricKey: string; value?: number | null; unit?: string | null }[]; updatedAt?: string } | null;
  devices?: OverviewDevice[];
  /** 열린 알람(API-DSH-02 `openAlarms[]`, API-RUL-10 Alarm 모양) — 기기 카드 배지 */
  openAlarms?: SpaceAlarm[];
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
  let alarms: SpaceAlarm[] = [];
  let alarmsFailed = false;
  // M5 평면도 보기·층 전환(DSH-02.02·12.04), [3D](DSH-12.04)
  let floors: FloorItem[] = [];
  let floorNavState: FloorNav | null = null;
  let floorBase: { kind: "building" | "floor"; buildingId: string } | null = null;
  let planOverview: Overview | null = null;
  let planSpaceId = params.spaceId;
  let models: ModelSummary[] = [];
  let modelDetail: ModelDetail | null = null;
  const edit = url.searchParams.get("edit") === "1";
  if (tab === "alarms") {
    // 공간 하위 열린 알람(API-RUL-10, spaceId는 하위 포함, 기본 상태 ACTIVE·ACKNOWLEDGED·SUPPRESSED)
    const list = await callList<SpaceAlarm>(ctx, request, `/api/v1/core/alarms?spaceId=${id}&size=100`);
    if (list.ok) alarms = list.list.responses.map((a) => ({ ...a, id: String(a.id) }));
    else alarmsFailed = true;
  } else if (tab === "devices") {
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
    // 건물이면 층 목록(GET /core/buildings/{id}/floors)으로 층 전환, 층이면 같은 건물의 다른 층으로 이동(AT-DSH-13.1)
    const building = space.data.type === "BUILDING" ? params.spaceId : space.data.type === "FLOOR" ? (buildingOf(tree, params.spaceId)?.id ?? null) : null;
    if (building && !edit) {
      const f = await callApi<FloorItem[]>(ctx, request, `/api/v1/core/buildings/${encodeURIComponent(String(building))}/floors`);
      floors = f.ok ? (f.data ?? []).map((x) => ({ ...x, spaceId: String(x.spaceId) })) : [];
      if (floors.length) {
        floorBase = { kind: space.data.type === "BUILDING" ? "building" : "floor", buildingId: String(building) };
        floorNavState = floorNav(floors, space.data.type === "BUILDING" ? url.searchParams.get("floor") : params.spaceId);
        if (space.data.type === "BUILDING" && floorNavState.current) planSpaceId = floorNavState.current.spaceId;
      }
    }
    const planBase = `/api/v1/core/spaces/${encodeURIComponent(planSpaceId)}`;
    const [f, d, o] = await Promise.all([
      callApi<FloorplanView>(ctx, request, `${planBase}/floorplan`),
      edit ? callList<{ id: string; name: string }>(ctx, request, `${base}/devices?includeDescendants=false`) : Promise.resolve(null),
      planSpaceId !== params.spaceId ? callApi<Overview>(ctx, request, `${planBase}/overview`) : Promise.resolve(null),
    ]);
    floorplan = f.ok ? f.data : null;
    spaceDevices = d?.ok ? d.list.responses.map((x) => ({ id: String(x.id), name: x.name })) : [];
    planOverview = o ? (o.ok ? o.data : null) : overview.ok ? overview.data : null;
  } else if (tab === "model3d" && space.data.type === "BUILDING") {
    const list = await callApi<ModelSummary[]>(ctx, request, `/api/v1/core/buildings/${id}/models`);
    models = list.ok ? (list.data ?? []).map((m) => ({ ...m, id: String(m.id) })) : [];
    const wanted = url.searchParams.get("model") ?? models[0]?.id;
    if (wanted && models.some((m) => m.id === wanted)) {
      const detail = await callApi<ModelDetail>(ctx, request, `/api/v1/core/buildings/${id}/models/${encodeURIComponent(wanted)}`);
      modelDetail = detail.ok ? { ...detail.data, id: String(detail.data.id), mappings: detail.data.mappings ?? [] } : null;
    }
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
    alarms,
    alarmsFailed,
    floors,
    floorNav: floorNavState,
    floorBase,
    planOverview,
    planSpaceId,
    models,
    modelDetail,
    edit,
    from: url.searchParams.get("from"),
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
    case "override": {
      // API-DEV-08 POST 운영 모드 수동 지정(mode 비우면 해제, until 선택 — 7일 이내)
      const mode = field(form, "mode");
      const until = field(form, "until");
      const result = await callApi(ctx, request, `${base}/override-mode`, { method: "POST", body: mode ? { mode, ...(until ? { until } : {}) } : { mode: null } });
      return result.ok ? ({ intent, ok: true } as FormResult) : fail(intent, result);
    }
    case "bimUpload": {
      const file = form.get("file");
      const problem = checkIfcFile(file instanceof File ? { name: file.name, size: file.size } : null);
      if (problem) return data({ intent, error: { code: "MODEL_FILE_INVALID" } } as FormResult, { status: problem === "TOO_LARGE" ? 413 : 400 });
      const upload = new FormData();
      upload.set("file", file as File, (file as File).name);
      const name = field(form, "name").trim();
      if (name) upload.set("name", name);
      const result = await callApi(ctx, request, `/api/v1/core/buildings/${encodeURIComponent(params.spaceId)}/models`, { method: "POST", rawBody: upload });
      return result.ok ? ({ intent, ok: true } as FormResult) : fail(intent, result);
    }
    case "bimMapping": {
      const result = await callApi(ctx, request, `/api/v1/core/buildings/${encodeURIComponent(params.spaceId)}/models/${encodeURIComponent(field(form, "modelId"))}/space-mapping`, {
        method: "PUT",
        body: mappingBody(parseJsonArray<{ ifcGlobalId: string; spaceId: string }>(field(form, "mappings"))),
      });
      return result.ok ? ({ intent, ok: true } as FormResult) : fail(intent, result);
    }
    case "bimDelete": {
      const result = await callApi(ctx, request, `/api/v1/core/buildings/${encodeURIComponent(params.spaceId)}/models/${encodeURIComponent(field(form, "modelId"))}`, { method: "DELETE" });
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
  const tabs = TABS.filter((key) => key !== "model3d" || space.type === "BUILDING").map((key) => ({ key, label: key === "model3d" ? t("floor.tab3d") : t(`spaces.tab.${key}`), to: `/spaces/${space.id}?tab=${key}` }));
  const crumbs = locationPath(tree, String(space.id), loaded.from);
  return (
    <div className="grid min-w-0 gap-4 md:grid-cols-[260px_1fr]">
      <aside className="min-w-0">
        <SpaceTree spaces={tree} selectedId={space.id} canEdit={canEdit} result={result && ["create", "rename", "move", "delete"].includes(result.intent ?? "") ? result : undefined} />
      </aside>
      <section className="min-w-0">
        <PageHeader
          crumb={crumbs.length ? <LocationPath crumbs={crumbs} from={loaded.from} /> : (flat?.path ?? [space.name]).join(" › ")}
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
            <DeviceCards spaceId={space.id} devices={overview?.devices ?? []} alarms={overview?.openAlarms} now={loaded.now} lang={lang} />
            <ChildSpaces>{children}</ChildSpaces>
          </div>
        )}
        {tab === "alarms" && <SpaceAlarms initial={loaded.alarms} failed={loaded.alarmsFailed} spaceIds={descendantIds(tree, String(space.id)).length ? descendantIds(tree, String(space.id)) : [String(space.id)]} timezone={timezone} lang={lang} />}
        {tab === "devices" && <DevicesTab devices={loaded.devices} now={loaded.now} lang={lang} spaceId={space.id} />}
        {tab === "props" && <PropsForm space={space} canEdit={canEdit} result={result} />}
        {tab === "targets" && loaded.targets && <TargetsEditor data={loaded.targets} metrics={loaded.metrics} canEdit={canEdit} result={result} />}
        {tab === "schedule" && loaded.schedule && (
          <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
            <ScheduleEditor data={loaded.schedule} canEdit={canEdit} result={result} />
            {/* 운영 모드 수동 지정(API-DEV-08 POST …/override-mode)은 DEV-11.02(M5, 조직 달력 DEV-12.01 필요) 범위라 M2에서는 조회만 보인다 */}
            <ModeCard data={loaded.mode} canOverride={hasAny(me?.permissions, ["DEV_PLACE"])} timezone={timezone} lang={lang} now={loaded.now} result={result} />
          </div>
        )}
        {tab === "floorplan" && (loaded.edit || (loaded.planSpaceId === String(space.id) && !loaded.floorplan?.imageUrl) || (result && ["markers", "floorplan"].includes(result.intent ?? "")) ? (
          <FloorplanPanel view={loaded.floorplan} devices={loaded.spaceDevices} canEdit={canEdit} result={result} />
        ) : (
          <FloorplanLive
            key={loaded.planSpaceId}
            spaceId={loaded.planSpaceId}
            view={loaded.floorplan}
            devices={loaded.planOverview?.devices ?? []}
            alarms={(loaded.planOverview?.openAlarms ?? []).map((a) => ({ deviceId: a.device?.id ?? null, severity: a.severity }))}
            now={loaded.now}
            lang={lang}
            emptyAction={
              canEdit ? (
                <Link to={`/spaces/${encodeURIComponent(loaded.planSpaceId)}?tab=floorplan`} className="text-accent underline">
                  {t("floor.view.uploadForFloor")}
                </Link>
              ) : undefined
            }
            toolbar={
              <div className="flex flex-wrap items-start justify-between gap-2">
                {loaded.floorNav && loaded.floorBase && (
                  <FloorSwitcher
                    nav={loaded.floorNav}
                    total={loaded.floors.length}
                    hrefFor={(floorId) => (loaded.floorBase!.kind === "building" ? `/spaces/${space.id}?tab=floorplan&floor=${encodeURIComponent(floorId)}` : `/spaces/${encodeURIComponent(floorId)}?tab=floorplan`)}
                  />
                )}
                {canEdit && loaded.planSpaceId === String(space.id) && (
                  <Link to={`/spaces/${space.id}?tab=floorplan&edit=1`} className="ml-auto text-[12.5px] text-accent underline">
                    {t("floor.view.edit")}
                  </Link>
                )}
              </div>
            }
          />
        ))}
        {tab === "model3d" && space.type === "BUILDING" && <BimPanel spaceId={String(space.id)} models={loaded.models} detail={loaded.modelDetail} tree={tree} canEdit={canEdit} result={result} />}
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
