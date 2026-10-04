/**
 * M5 floor 가짜 core: 층 목록·IFC 모델(API-DSH-24, BuildingModelController), 조직 달력(API-DEV-100~102)·운영 모드 수동 지정(API-DEV-08 POST, CalendarController),
 * 외부 맥락(API-DSC-40~45, ContextSourceController). 응답 모양은 core M5 DTO(BimDtos·CalendarDtos·ExternalDtos)를 따른다.
 */
import { fail, list, noContent, ok, type CoreHandler, type CoreState } from "../core-fixtures";
import { spaceExtra } from "./spaces";

interface FakeModel {
  id: string;
  buildingId: string;
  name: string;
  sizeBytes: number;
  ifcSchema: string;
  status: string;
  version: number;
  elements: { ifcGlobalId: string; name: string }[];
  mappings: { ifcGlobalId: string; spaceId: string }[];
}

interface FakeEvent {
  id: string;
  title: string;
  type: string;
  startsOn: string;
  endsOn: string;
  startTime: string | null;
  endTime: string | null;
  scopeSpaceIds: string[];
  origin: string;
  affectsMode: string;
  sourceId: string | null;
  locallyModified: boolean;
  originDeleted: boolean;
  version: number;
  updatedAt: string;
}

interface FakeContext {
  type: string;
  sourceId: string | null;
  enabled: boolean;
  config: Record<string, unknown>;
  apiKeyConfigured: boolean;
  version: number;
}

export interface FloorExtra {
  models: FakeModel[];
  events: FakeEvent[];
  context: Record<string, FakeContext[]>;
  usage: Record<string, { day: string; calls: number; failures: number; quota: number | null; warning: boolean; exhausted: boolean; cost: number | null }[]>;
  lastPut?: { siteId: string; type: string; body: Record<string, unknown> };
  uploads: number;
}

const gid = (n: number) => `2O2Fr$t4X7Zf8NOew3FL${String(n).padStart(2, "0")}`;

export function floorExtra(core: CoreState): FloorExtra {
  if (!core.extra.floor) {
    core.extra.floor = {
      models: [],
      events: [
        { id: "501", title: "개천절", type: "HOLIDAY", startsOn: "2026-10-03", endsOn: "2026-10-03", startTime: null, endTime: null, scopeSpaceIds: [], origin: "HOLIDAY_API", affectsMode: "HOLIDAY", sourceId: "71", locallyModified: false, originDeleted: false, version: 1, updatedAt: "2026-10-01T00:00:00Z" },
        { id: "502", title: "한글날", type: "HOLIDAY", startsOn: "2026-10-09", endsOn: "2026-10-09", startTime: null, endTime: null, scopeSpaceIds: [], origin: "HOLIDAY_API", affectsMode: "HOLIDAY", sourceId: "71", locallyModified: false, originDeleted: false, version: 1, updatedAt: "2026-10-01T00:00:00Z" },
        { id: "503", title: "중간고사 기간", type: "EXAM", startsOn: "2026-10-12", endsOn: "2026-10-17", startTime: null, endTime: null, scopeSpaceIds: ["1"], origin: "ICAL", affectsMode: "NONE", sourceId: "72", locallyModified: true, originDeleted: true, version: 2, updatedAt: "2026-10-02T00:00:00Z" },
      ],
      context: {},
      usage: {},
      uploads: 0,
    } satisfies FloorExtra;
  }
  return core.extra.floor as FloorExtra;
}

/** 공간 10개 중 8개를 매핑한 READY 모델(AT-DSH-13.2) */
export function seedModel(core: CoreState, buildingId = "2"): FakeModel {
  const elements = Array.from({ length: 10 }, (_, i) => ({ ifcGlobalId: gid(i + 1), name: `Room ${i + 1}` }));
  const model: FakeModel = { id: "801", buildingId, name: "본관.ifc", sizeBytes: 12_400_000, ifcSchema: "IFC4", status: "READY", version: 1, elements, mappings: elements.slice(0, 8).map((e, i) => ({ ifcGlobalId: e.ifcGlobalId, spaceId: i % 2 === 0 ? "31" : "32" })) };
  floorExtra(core).models.push(model);
  return model;
}

function floorItems(core: CoreState, buildingId: string) {
  const plans = spaceExtra(core).floorplans;
  return core.spaces
    .filter((s) => s.parentId === buildingId && s.type === "FLOOR")
    .map((s) => ({ spaceId: s.id, name: s.name, code: s.code ?? null, sortOrder: s.sortOrder, hasFloorplan: Boolean(plans[s.id]), imageUrl: plans[s.id] ? `/api/v1/core/spaces/${s.id}/floorplan/image?v=${plans[s.id].version}` : null, width: plans[s.id]?.width ?? null, height: plans[s.id]?.height ?? null }));
}

function modelDetail(m: FakeModel) {
  return { id: m.id, name: m.name, ifcSchema: m.ifcSchema, status: m.status, error: null, elementCount: m.elements.length, downloadUrl: `/api/v1/core/buildings/${m.buildingId}/models/${m.id}/file`, mappings: m.mappings, spaceElements: m.elements, version: m.version };
}

const CONTEXT_TYPES = ["KMA_WEATHER", "AIRKOREA", "HOLIDAY", "ICAL"];

function contextView(c: FakeContext | undefined, type: string, usage: FloorExtra["usage"]) {
  const today = c?.sourceId ? usage[c.sourceId]?.at(-1) : undefined;
  return {
    type,
    sourceId: c?.sourceId ?? null,
    enabled: c?.enabled ?? false,
    lifecycle: c ? (c.enabled ? "ACTIVE" : "PAUSED") : null,
    connectionState: c?.enabled ? "CONNECTED" : null,
    provider: { key: type, available: true, simulated: type === "AIRKOREA" },
    config: c?.config ?? null,
    apiKeyConfigured: c?.apiKeyConfigured ?? false,
    lastSync: c?.sourceId ? { at: "2026-10-04T02:00:00Z", status: "SUCCESS", added: 2, updated: 0, removed: 1, error: null, nextDueAt: "2026-10-04T08:00:00Z" } : null,
    usageToday: today ? { day: today.day, calls: today.calls, failures: today.failures, quota: today.quota, warning: today.warning, exhausted: today.exhausted, resumeAt: null } : null,
    version: c?.version ?? null,
  };
}

export const floorHandler: CoreHandler = (core, { method, path, url, body, can, request }) => {
  const extra = floorExtra(core);

  // --- 층 목록·IFC 모델(API-DSH-24)
  const building = /^\/buildings\/([^/]+)(\/.*)?$/.exec(path);
  if (building) {
    const [, buildingId, sub = ""] = building;
    const space = core.spaces.find((s) => s.id === buildingId && s.type === "BUILDING");
    if (!space) return fail(404, "SPACE_NOT_FOUND");
    if (sub === "/floors" && method === "GET") return ok(floorItems(core, buildingId));
    if (sub === "/models" && method === "GET") return ok(extra.models.filter((m) => m.buildingId === buildingId).map((m) => ({ id: m.id, name: m.name, sizeBytes: m.sizeBytes, ifcSchema: m.ifcSchema, status: m.status, elementCount: m.elements.length, version: m.version, createdAt: "2026-10-03T00:00:00Z" })));
    if (sub === "/models" && method === "POST") {
      if (!can("DEV_ADMIN")) return fail(403, "PERMISSION_DENIED");
      extra.uploads += 1;
      return (async () => {
        const form = await request.formData();
        const file = form.get("file") as File | null;
        if (!file) return fail(400, "MODEL_FILE_INVALID");
        const id = core.nextId();
        extra.models.push({ id, buildingId, name: String(form.get("name") || file.name), sizeBytes: file.size, ifcSchema: "IFC4", status: "PROCESSING", version: 1, elements: [], mappings: [] });
        return ok({ id, name: String(form.get("name") || file.name), sizeBytes: file.size, status: "PROCESSING", version: 1 }, 201, { Location: `/api/v1/core/buildings/${buildingId}/models/${id}` });
      })();
    }
    const model = /^\/models\/([^/]+)(\/.*)?$/.exec(sub);
    if (model) {
      const m = extra.models.find((x) => x.id === model[1] && x.buildingId === buildingId);
      if (!m) return fail(404, "RESOURCE_NOT_FOUND");
      const rest = model[2] ?? "";
      if (rest === "" && method === "GET") return ok(modelDetail(m));
      if (rest === "" && method === "DELETE") {
        if (!can("DEV_ADMIN")) return fail(403, "PERMISSION_DENIED");
        extra.models = extra.models.filter((x) => x !== m);
        return noContent();
      }
      if (rest === "/space-mapping" && method === "PUT") {
        if (!can("DEV_ADMIN")) return fail(403, "PERMISSION_DENIED");
        m.mappings = (body as { mappings: { ifcGlobalId: string; spaceId: string }[] }).mappings;
        m.version += 1;
        return ok({ modelId: m.id, mapped: m.mappings.length, unmappedElements: m.elements.length - m.mappings.length });
      }
      if (rest === "/file" && method === "GET") return new Response("ISO-10303-21;", { headers: { "Content-Type": "application/octet-stream" } });
    }
    return undefined;
  }

  // --- 운영 모드 수동 지정(API-DEV-08 POST)
  const override = /^\/spaces\/([^/]+)\/override-mode$/.exec(path);
  if (override && method === "POST") {
    if (!can("DEV_PLACE")) return fail(403, "PERMISSION_DENIED");
    const input = body as { mode: string | null; until?: string };
    spaceExtra(core).modes[override[1]] = { mode: input.mode, until: input.until ?? null };
    return ok(input.mode ? { mode: input.mode, source: "OVERRIDE", until: input.until ?? null, nextChangeAt: input.until ?? null } : { mode: "OCCUPIED", source: "SCHEDULE", until: null, nextChangeAt: null });
  }

  // --- 조직 달력(API-DEV-100~102)
  if (path === "/calendar-events" && method === "GET") {
    const from = url.searchParams.get("from") ?? "0000-01-01";
    const to = url.searchParams.get("to") ?? "9999-12-31";
    const spaceId = url.searchParams.get("spaceId");
    if (core.extra.calendarFails) return fail(503, "SERVICE_UNAVAILABLE");
    const rows = extra.events.filter((e) => e.endsOn >= from && e.startsOn <= to && (!spaceId || e.scopeSpaceIds.length === 0 || e.scopeSpaceIds.includes(spaceId) || core.spacePath(spaceId).some((p) => e.scopeSpaceIds.includes(p.id))));
    return list(rows, url);
  }
  if (path === "/calendar-events" && method === "POST") {
    if (!can("DEV_PLACE")) return fail(403, "PERMISSION_DENIED");
    const input = body as Partial<FakeEvent>;
    if (!input.title || !input.startsOn || !input.endsOn || input.startsOn > input.endsOn) return fail(400, "CALENDAR_EVENT_INVALID");
    const created: FakeEvent = { id: core.nextId(), title: input.title, type: input.type ?? "EVENT", startsOn: input.startsOn, endsOn: input.endsOn, startTime: input.startTime ?? null, endTime: input.endTime ?? null, scopeSpaceIds: input.scopeSpaceIds ?? [], origin: "MANUAL", affectsMode: input.affectsMode ?? "NONE", sourceId: null, locallyModified: false, originDeleted: false, version: 1, updatedAt: "2026-10-04T00:00:00Z" };
    extra.events.push(created);
    return ok(created, 201, { Location: `/api/v1/core/calendar-events/${created.id}` });
  }
  const event = /^\/calendar-events\/([^/]+)$/.exec(path);
  if (event) {
    const e = extra.events.find((x) => x.id === event[1]);
    if (!e) return fail(404, "RESOURCE_NOT_FOUND");
    if (method === "GET") return ok(e);
    if (!can("DEV_PLACE")) return fail(403, "PERMISSION_DENIED");
    if (method === "DELETE") {
      if (e.origin !== "MANUAL") return fail(400, "CALENDAR_EVENT_INVALID");
      extra.events = extra.events.filter((x) => x !== e);
      return noContent();
    }
    if (method === "PATCH") {
      const patch = body as Record<string, unknown> & { baseVersion?: number };
      if (patch.baseVersion !== e.version) return fail(409, "VERSION_CONFLICT");
      if (e.origin !== "MANUAL" && Object.keys(patch).some((k) => k !== "affectsMode" && k !== "baseVersion")) return fail(400, "CALENDAR_EVENT_INVALID");
      const { baseVersion: _ignored, ...rest } = patch;
      Object.assign(e, rest, { version: e.version + 1, locallyModified: e.origin !== "MANUAL" || e.locallyModified });
      return ok(e);
    }
  }

  // --- 외부 맥락(API-DSC-40~45)
  const site = /^\/sites\/([^/]+)\/context-sources(?:\/([A-Z_]+))?$/.exec(path);
  if (site) {
    if (!can("SRC_READ")) return fail(403, "PERMISSION_DENIED");
    const s = core.spaces.find((x) => x.id === site[1] && x.type === "SITE");
    if (!s) return fail(404, "SPACE_NOT_FOUND");
    const rows = (extra.context[s.id] ??= []);
    const located = s.latitude !== null && s.latitude !== undefined && s.longitude !== null && s.longitude !== undefined;
    if (!site[2] && method === "GET") {
      return ok({ siteId: s.id, siteName: s.name, latitude: s.latitude ?? null, longitude: s.longitude ?? null, locationRequired: !located, kmaNx: located ? 58 : null, kmaNy: located ? 74 : null, sources: CONTEXT_TYPES.map((t) => contextView(rows.find((r) => r.type === t), t, extra.usage)) });
    }
    if (site[2] && method === "PUT") {
      if (!can("SRC_ADMIN")) return fail(403, "PERMISSION_DENIED");
      const type = site[2];
      const input = body as Record<string, unknown>;
      extra.lastPut = { siteId: s.id, type, body: input };
      if ((type === "KMA_WEATHER" || type === "AIRKOREA") && input.enabled && !located) return fail(400, "SITE_LOCATION_REQUIRED");
      const existing = rows.find((r) => r.type === type);
      if ((type === "KMA_WEATHER" || type === "AIRKOREA") && input.enabled && !input.apiKey && !existing?.apiKeyConfigured) {
        return new Response(JSON.stringify({ header: { isSuccessful: false, resultCode: "INVALID_REQUEST", resultMessage: "invalid" }, response: null, errors: [{ field: "apiKey", code: "NotBlank", message: "" }] }), { status: 400, headers: { "Content-Type": "application/json" } });
      }
      const { enabled, apiKey, ...config } = input;
      const row: FakeContext = existing ?? { type, sourceId: core.nextId(), enabled: false, config: {}, apiKeyConfigured: false, version: 0 };
      Object.assign(row, { enabled: Boolean(enabled), config: { ...row.config, ...config }, apiKeyConfigured: row.apiKeyConfigured || Boolean(apiKey), version: row.version + 1 });
      if (!existing) rows.push(row);
      return ok(contextView(row, type, extra.usage));
    }
  }
  const usage = /^\/sources\/([^/]+)\/(api-usage|refresh-now)$/.exec(path);
  if (usage) {
    if (usage[2] === "api-usage" && method === "GET") return ok(extra.usage[usage[1]] ?? []);
    if (usage[2] === "refresh-now" && method === "POST") {
      if (!can("SRC_ADMIN")) return fail(403, "PERMISSION_DENIED");
      return ok({ jobId: "j1", sourceId: usage[1], status: "SUCCESS", added: 2, updated: 0, removed: 1, error: null });
    }
  }
  if (path === "/external/airkorea-stations" && method === "GET") {
    if (!can("SRC_ADMIN")) return fail(403, "PERMISSION_DENIED");
    return ok([
      { stationName: "농성동", address: "광주 서구", lat: 35.15, lng: 126.88, distanceKm: 2.4, items: ["PM10", "PM25", "O3"] },
      { stationName: "치평동", address: "광주 서구", lat: 35.15, lng: 126.85, distanceKm: 1.2, items: ["PM10", "PM25", "O3"] },
    ]);
  }
  if (path === "/sources/ical/upload" && method === "POST") {
    if (!can("SRC_ADMIN")) return fail(403, "PERMISSION_DENIED");
    extra.uploads += 1;
    return ok({ fileObjectKey: "ical/2026/academic.ics", eventCount: 12, categories: ["시험", "방학"] });
  }
  return undefined;
};
