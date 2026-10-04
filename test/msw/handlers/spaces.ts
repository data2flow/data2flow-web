/**
 * 가짜 공간 API(design/api/DEV-api.md §1 API-DEV-01~10, DSH-api API-DSH-02·03, API-DEV-25 사이트 요약).
 * 목표 환경·운영 시간표·평면도는 core.extra에 공간별로 둔다.
 */
import { SPACE_TYPES } from "../../../app/lib/spaces";
import { fail, list, noContent, ok, type CoreHandler, type CoreState, type FakeSpace } from "../core-fixtures";

interface SpaceExtra {
  targets: Record<string, { inherit: boolean; items: { metricKey: string; min?: number; max?: number }[] }>;
  schedules: Record<string, { inherit: boolean; slots: { dayOfWeek: number; start: string; end: string }[] }>;
  floorplans: Record<string, { width: number; height: number; version: number; markers: { deviceId: string; x: number; y: number }[] }>;
  modes: Record<string, { mode: string | null; until: string | null }>;
}

export function spaceExtra(core: CoreState): SpaceExtra {
  if (!core.extra.spaces) {
    core.extra.spaces = {
      targets: { "1": { inherit: false, items: [{ metricKey: "temperature", min: 20, max: 26 }, { metricKey: "co2", max: 1000 }] } },
      schedules: { "1": { inherit: false, slots: [1, 2, 3, 4, 5].map((d) => ({ dayOfWeek: d, start: "09:00", end: "18:00" })) } },
      floorplans: {},
      modes: {},
    } satisfies SpaceExtra;
  }
  return core.extra.spaces as SpaceExtra;
}

const depthOf = (core: CoreState, id: string | null): number => (id ? 1 + depthOf(core, core.spaces.find((s) => s.id === id)?.parentId ?? null) : 0);

/** API-DEV-02·03 SpaceResponse: path는 조상 ID를 /로 이은 문자열(`/1/2/3`) */
function spaceBody(core: CoreState, s: FakeSpace) {
  return { ...s, path: `/${core.spacePath(s.id).map((p) => p.id).join("/")}`, depth: depthOf(core, s.id), kmaNx: s.type === "SITE" ? 59 : null, kmaNy: s.type === "SITE" ? 74 : null, status: "ACTIVE", updatedAt: "2026-10-03T00:00:00Z" };
}

/** API-DEV-139 SpaceDetailResponse: SpaceResponse + ancestors·effectiveTimezone·개수·평면도 여부 */
function spaceDetail(core: CoreState, s: FakeSpace, hasFloorplan: boolean) {
  const ancestors = core.spacePath(s.parentId).map((p) => ({ id: p.id, name: p.name, type: core.spaces.find((x) => x.id === p.id)?.type ?? "" }));
  const site = core.spaces.find((x) => x.id === core.spacePath(s.id)[0]?.id);
  return { ...spaceBody(core, s), ancestors, effectiveTimezone: s.timezone ?? site?.timezone ?? "Asia/Seoul", childCount: core.spaces.filter((x) => x.parentId === s.id).length, deviceCount: core.devices.filter((d) => d.spaceId === s.id && d.status !== "PENDING").length, hasFloorplan, targets: null, schedule: null, mode: null };
}

/** API-DEV-09·DSH-03 FloorplanResponse. imageUrl은 세션으로 읽는 API 경로(API-DEV-142) */
function floorplanBody(core: CoreState, spaceId: string, plan: { width: number; height: number; version: number; markers: { deviceId: string; x: number; y: number }[] }) {
  return {
    spaceId,
    imageUrl: `/api/v1/core/spaces/${spaceId}/floorplan/image?v=${plan.version}`,
    widthPx: plan.width,
    heightPx: plan.height,
    width: plan.width,
    height: plan.height,
    scaleMPerPx: null,
    contentType: "image/png",
    version: plan.version,
    updatedAt: "2026-10-03T00:00:00Z",
    markersNeedReview: false,
    markers: plan.markers.map((m) => ({ ...m, deviceName: core.devices.find((d) => d.id === m.deviceId)?.name ?? null, rotation: 0 })),
  };
}

/** 가장 가까운 직접 지정 값을 찾는다(BR-DEV-04) */
function effectiveTargets(core: CoreState, id: string) {
  const extra = spaceExtra(core);
  let current = core.spaces.find((s) => s.id === id);
  while (current) {
    const own = extra.targets[current.id];
    if (own && !own.inherit) return { from: current, items: own.items };
    const parentId: string | null = current.parentId;
    current = core.spaces.find((s) => s.id === parentId);
  }
  return { from: undefined, items: [] };
}

function comfortOf(core: CoreState, id: string) {
  const { items } = effectiveTargets(core, id);
  const devices = core.devices.filter((d) => d.spaceId === id && d.status === "ACTIVE");
  const causes: { metricKey: string; value: number; unit?: string; target: { min?: number; max?: number } }[] = [];
  for (const target of items) {
    for (const d of devices) {
      const v = d.latest.find((l) => l.metricKey === target.metricKey);
      if (v && ((target.max !== undefined && v.value > target.max) || (target.min !== undefined && v.value < target.min))) causes.push({ metricKey: target.metricKey, value: v.value, unit: v.unit, target });
    }
  }
  if (devices.length === 0 || items.length === 0) return { state: "UNKNOWN", causes: [], updatedAt: "2026-10-03T23:59:48Z" };
  return { state: causes.length ? "WARNING" : "NORMAL", causes, updatedAt: "2026-10-03T23:59:48Z" };
}

export function comfortRows(core: CoreState) {
  return core.spaces.filter((s) => s.type === "ROOM").map((s) => ({ spaceId: s.id, spaceName: s.name, ...comfortOf(core, s.id) }));
}

export const spacesHandler: CoreHandler = (core, { method, path, url, body, can }) => {
  if (path === "/sites/summary" && method === "GET") {
    return ok(core.spaces.filter((s) => s.type === "SITE").map((s) => ({ siteId: s.id, name: s.name, lat: s.latitude ?? null, lng: s.longitude ?? null, devices: core.devices.filter((d) => d.status !== "PENDING").length, offline: core.devices.filter((d) => d.connectivity === "OFFLINE").length, openAlarms: 0, comfortScore: 82 })));
  }
  if (path === "/sites/map" && method === "GET") {
    // API-DSH-17: 사이트 상태(알람·오프라인·쾌적도 요약). core.extra.siteMapFails면 실패
    if (core.extra.siteMapFails) return fail(503, "SERVICE_UNAVAILABLE");
    const alarms = (core.extra.siteAlarms as Record<string, number> | undefined) ?? {};
    return ok({ sites: core.spaces.filter((s) => s.type === "SITE").map((s) => ({ id: s.id, name: s.name, lat: s.latitude ?? null, lng: s.longitude ?? null, alarms: alarms[s.id] ?? 0, offlineDevices: core.devices.filter((d) => d.connectivity === "OFFLINE").length, comfortSummary: { NORMAL: 1, WARNING: 0 } })) });
  }
  if (!path.startsWith("/spaces")) return undefined;
  const extra = spaceExtra(core);
  const writeDenied = () => fail(403, "PERMISSION_DENIED");
  if (path === "/spaces" && method === "GET") return ok(core.spaceTree(url.searchParams.get("rootId")));
  if (path === "/spaces" && method === "POST") {
    if (!can("DEV_ADMIN")) return writeDenied();
    const input = body as Partial<FakeSpace> & { parentId?: string };
    const parentId = input.parentId ? String(input.parentId) : null;
    const parent = core.spaces.find((s) => s.id === parentId);
    if (parentId && !parent) return fail(404, "SPACE_NOT_FOUND");
    if (!SPACE_TYPES.includes(input.type as never) || (!parent && input.type !== "SITE")) return fail(400, "SPACE_TYPE_INVALID");
    if (depthOf(core, parentId) >= 6) return fail(400, "SPACE_DEPTH_EXCEEDED");
    if (core.spaces.some((s) => s.parentId === parentId && s.name === input.name)) return fail(409, "SPACE_NAME_DUPLICATE");
    const created: FakeSpace = { id: core.nextId(), parentId, type: String(input.type), name: String(input.name), code: input.code ?? null, sortOrder: core.spaces.filter((s) => s.parentId === parentId).length, timezone: input.timezone ?? null, latitude: input.latitude ?? null, longitude: input.longitude ?? null, address: input.address ?? null, version: 1 };
    core.spaces.push(created);
    return ok(spaceBody(core, created), 201, { Location: `/api/v1/core/spaces/${created.id}` });
  }
  const match = /^\/spaces\/([^/]+)(\/.*)?$/.exec(path);
  if (!match) return undefined;
  const space = core.spaces.find((s) => s.id === match[1]);
  if (!space) return fail(404, "SPACE_NOT_FOUND");
  const sub = match[2] ?? "";
  if (sub === "" && method === "GET") return ok(spaceDetail(core, space, Boolean(extra.floorplans[space.id])));
  if (sub === "" && method === "PATCH") {
    if (!can("DEV_ADMIN")) return writeDenied();
    const patch = body as Partial<FakeSpace> & { baseVersion?: number };
    if (patch.baseVersion !== space.version) return fail(409, "VERSION_CONFLICT");
    if (patch.name && core.spaces.some((s) => s.id !== space.id && s.parentId === space.parentId && s.name === patch.name)) return fail(409, "SPACE_NAME_DUPLICATE");
    const { baseVersion: _ignored, ...rest } = patch;
    Object.assign(space, rest, { version: space.version + 1 });
    return ok(spaceBody(core, space));
  }
  if (sub === "" && method === "DELETE") {
    if (!can("DEV_ADMIN")) return writeDenied();
    const children = core.spaces.filter((s) => s.parentId === space.id).length;
    const devices = core.devices.filter((d) => d.spaceId === space.id).length;
    if (children || devices) return HttpJson(409, "SPACE_NOT_EMPTY", { blockers: { children, devices, markers: 0, workOrders: 0 } });
    core.spaces = core.spaces.filter((s) => s.id !== space.id);
    return noContent();
  }
  if (sub === "/move" && method === "POST") {
    if (!can("DEV_ADMIN")) return writeDenied();
    const newParentId = String((body as { newParentId: string }).newParentId);
    let cursor: string | null = newParentId;
    while (cursor) {
      if (cursor === space.id) return fail(409, "SPACE_MOVE_CYCLE");
      cursor = core.spaces.find((s) => s.id === cursor)?.parentId ?? null;
    }
    space.parentId = newParentId;
    space.version += 1;
    return ok(spaceBody(core, space));
  }
  if (sub === "/overview" && method === "GET") {
    const devices = core.devices.filter((d) => d.spaceId === space.id && d.status !== "PENDING");
    return ok({
      space: { id: space.id, name: space.name, type: space.type, path: core.spacePath(space.id), targetEnv: effectiveTargets(core, space.id).items },
      comfort: comfortOf(core, space.id),
      devices: devices.map((d) => ({ id: d.id, name: d.name, modelId: d.modelId, modelName: core.model(d.modelId)?.name ?? null, status: d.status, connection: d.connectivity, lastSeenAt: d.lastSeenAt, battery: d.battery ?? null, rssi: d.rssi ?? null, virtual: d.virtual, metrics: d.latest.map((l) => ({ key: l.metricKey, value: l.value, unit: l.unit, quality: l.quality, at: l.measuredAt })) })),
      // 열린 알람(M4, API-RUL-10 Alarm 모양). 테스트가 core.extra.spaceOpenAlarms[공간 ID]로 넣는다
      openAlarms: ((core.extra.spaceOpenAlarms as Record<string, unknown[]> | undefined) ?? {})[space.id] ?? [],
      hasFloorplan: Boolean(extra.floorplans[space.id]),
      children: core.spaces.filter((c) => c.parentId === space.id).map((c) => ({ id: c.id, name: c.name, type: c.type, comfortState: comfortOf(core, c.id).state })),
    });
  }
  if (sub === "/devices" && method === "GET") {
    const devices = core.devices.filter((d) => d.spaceId === space.id && d.status !== "PENDING");
    return list(devices.map((d) => ({ id: d.id, name: d.name, kind: d.kind, status: d.status, connectivity: d.connectivity, relation: "MEASURES", modelId: d.modelId, modelName: core.model(d.modelId)?.name ?? null, capabilities: [], spaceId: d.spaceId, lastSeenAt: d.lastSeenAt })), url);
  }
  if (sub === "/targets") {
    if (method === "GET") {
      const own = extra.targets[space.id];
      const effective = effectiveTargets(core, space.id);
      const inherit = !own || own.inherit;
      const from = effective.from && effective.from.id !== space.id ? effective.from : undefined;
      return ok(targetsBody(inherit, own?.items ?? [], effective.items, from));
    }
    if (method === "PUT") {
      if (!can("DEV_ADMIN")) return writeDenied();
      const input = body as { inherit: boolean; items: { metricKey: string; min?: number; max?: number }[] };
      if (input.items.some((i) => !core.metrics.some((m) => m.key === i.metricKey))) return fail(400, "METRIC_NOT_FOUND");
      if (input.items.some((i) => i.min !== undefined && i.max !== undefined && i.min > i.max)) return fail(400, "INVALID_REQUEST");
      extra.targets[space.id] = { inherit: input.inherit, items: input.items };
      const effective = effectiveTargets(core, space.id);
      const from = effective.from && effective.from.id !== space.id ? effective.from : undefined;
      return ok(targetsBody(input.inherit, input.items, effective.items, from));
    }
  }
  if (sub === "/schedule") {
    if (method === "GET") {
      const own = extra.schedules[space.id];
      if (own && !own.inherit) return ok({ inherit: false, inheritedFromSpaceId: null, inheritedFromSpaceName: null, slots: own.slots });
      let parent = core.spaces.find((s) => s.id === space.parentId);
      while (parent && (!extra.schedules[parent.id] || extra.schedules[parent.id].inherit)) {
        const pid: string | null = parent.parentId;
        parent = core.spaces.find((s) => s.id === pid);
      }
      return ok({ inherit: true, inheritedFromSpaceId: parent?.id ?? null, inheritedFromSpaceName: parent?.name ?? null, slots: parent ? extra.schedules[parent.id].slots : [] });
    }
    if (method === "PUT") {
      if (!can("DEV_ADMIN")) return writeDenied();
      const input = body as { inherit: boolean; slots: { dayOfWeek: number; start: string; end: string }[] };
      const overlap = input.slots.some((a, i) => input.slots.some((b, j) => i !== j && a.dayOfWeek === b.dayOfWeek && a.start < b.end && b.start < a.end));
      if (overlap) return fail(400, "SCHEDULE_OVERLAP");
      extra.schedules[space.id] = input;
      return ok({ inherit: input.inherit, inheritedFromSpaceId: null, inheritedFromSpaceName: null, slots: input.slots });
    }
  }
  if (sub === "/mode" && method === "GET") {
    const override = extra.modes[space.id];
    return ok(override?.mode ? { mode: override.mode, source: "OVERRIDE", until: override.until, nextChangeAt: override.until } : { mode: "OCCUPIED", source: "SCHEDULE", until: null, nextChangeAt: "2026-10-04T09:00:00Z" });
  }
  if (sub === "/floorplan") {
    if (method === "GET") {
      const plan = extra.floorplans[space.id];
      if (!plan) return fail(404, "RESOURCE_NOT_FOUND");
      return ok(floorplanBody(core, space.id, plan));
    }
    if (method === "PUT") {
      if (!can("DEV_ADMIN")) return writeDenied();
      extra.floorplans[space.id] = { width: 1200, height: 800, version: (extra.floorplans[space.id]?.version ?? 0) + 1, markers: extra.floorplans[space.id]?.markers ?? [] };
      core.extra.lastFloorplanUpload = true;
      return ok(floorplanBody(core, space.id, extra.floorplans[space.id]));
    }
  }
  if (sub === "/floorplan/image" && method === "GET") {
    if (!extra.floorplans[space.id]) return fail(404, "RESOURCE_NOT_FOUND");
    // 1×1 PNG(API-DEV-142 이미지 바이트)
    return new Response(Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="), (c) => c.charCodeAt(0)), { headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=600" } });
  }
  if (sub === "/floorplan/markers" && method === "PUT") {
    if (!can("DEV_ADMIN")) return writeDenied();
    const plan = extra.floorplans[space.id];
    if (!plan) return fail(404, "RESOURCE_NOT_FOUND");
    const markers = (body as { markers: { deviceId: string; x: number; y: number }[] }).markers;
    if (markers.some((m) => core.devices.find((d) => d.id === m.deviceId)?.spaceId !== space.id)) return fail(404, "DEVICE_NOT_FOUND");
    plan.markers = markers;
    return ok({ markers: markers.map((m) => ({ ...m, deviceName: core.devices.find((d) => d.id === m.deviceId)?.name, rotation: 0 })) });
  }
  return undefined;
};

/** API-DEV-140 TargetsResponse: 직접 정한 items + 상속을 반영한 effective(inherited 표시) */
function targetsBody(inherit: boolean, items: { metricKey: string; min?: number; max?: number }[], effective: { metricKey: string; min?: number | null; max?: number | null }[], from?: { id: string; name: string }) {
  const own = new Set(inherit ? [] : items.map((i) => i.metricKey));
  return {
    inherit,
    inheritedFromSpaceId: from?.id ?? null,
    inheritedFromSpaceName: from?.name ?? null,
    items,
    effective: effective.map((e) => {
      const inherited = !own.has(e.metricKey) && Boolean(from);
      return { metricKey: e.metricKey, min: e.min ?? null, max: e.max ?? null, inherited, inheritedFromSpaceId: inherited ? (from?.id ?? null) : null, inheritedFromSpaceName: inherited ? (from?.name ?? null) : null };
    }),
  };
}

function HttpJson(status: number, code: string, response: unknown) {
  return new Response(JSON.stringify({ header: { isSuccessful: false, resultCode: code, resultMessage: `msg:${code}` }, response }), { status, headers: { "Content-Type": "application/json" } });
}
