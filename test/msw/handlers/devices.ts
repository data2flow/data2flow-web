/**
 * 가짜 core 기기 API(design/api/DEV-api.md §2): 목록(필터)·상세·수동 등록·수정(baseVersion)·승인·거부·활성/비활성·삭제·태그·
 * CSV 가져오기·변경 이력·모델 추천·시맨틱. 내 화면 설정(API-DSH-12 즐겨찾기·최근 본 항목)도 여기서 흉내 낸다.
 */
import { HttpResponse } from "msw";
import { envelope, fail, list, noContent, ok, type CoreHandler, type CoreState, type FakeDevice } from "../core-fixtures";

interface DeviceExtra {
  history: Record<string, { at: string; actor: string; action: string; changes: Record<string, [unknown, unknown]> }[]>;
  semantic: Record<string, { equipment: unknown[] }>;
  references: Record<string, { type: string; id: string; name: string }[]>;
  preferences: Record<string, { favorites: { type: string; id: string; name?: string }[]; recent: { type: string; id: string }[]; version: number }>;
}

/** 테스트가 상황을 바꿀 수 있는 기기 부가 상태(사용처, 시맨틱 …) */
export function deviceExtra(core: CoreState): DeviceExtra {
  core.extra.devices ??= {
    history: { "1042": [{ at: "2026-10-02T00:00:00Z", actor: "홍길동", action: "UPDATED", changes: { spaceId: ["3", "31"] } }] },
    semantic: {
      "1042": {
        equipment: [
          {
            id: "e1",
            equipClass: "Zone_Air_Sensor",
            name: "실습실 센서",
            spaceId: "31",
            points: [
              { id: "p1", metricKey: "temperature", pointType: "Measurement", quantity: "Zone_Air_Temperature", tags: ["zone", "air"] },
              { id: "p2", metricKey: "co2", pointType: "Measurement", quantity: "CO2_Level", tags: [] },
            ],
          },
        ],
      },
    },
    references: {},
    preferences: {},
  } satisfies DeviceExtra;
  return core.extra.devices as DeviceExtra;
}

const SUGGEST: Record<string, { modelId: string; score: number }> = { temperature: { modelId: "11", score: 0.95 }, LAeq: { modelId: "13", score: 0.9 } };

function touch(d: FakeDevice) {
  d.version += 1;
}

export const devicesHandler: CoreHandler = (core, { method, path, url, body, can, user }) => {
  const extra = deviceExtra(core);
  const b = (body ?? {}) as Record<string, unknown>;

  if (path === "/accounts/me/preferences") {
    const prefs = (extra.preferences[user.id] ??= { favorites: [], recent: [], version: 1 });
    if (method === "GET") return ok({ theme: "SYSTEM", favorites: prefs.favorites, recent: prefs.recent, version: prefs.version });
    if (method === "PUT") {
      if (b.baseVersion !== prefs.version) return fail(409, "VERSION_CONFLICT");
      if (Array.isArray(b.favorites)) prefs.favorites = b.favorites as typeof prefs.favorites;
      prefs.version += 1;
      return ok({ favorites: prefs.favorites, version: prefs.version });
    }
  }
  if (path === "/accounts/me/recent" && method === "POST") {
    const prefs = (extra.preferences[user.id] ??= { favorites: [], recent: [], version: 1 });
    prefs.recent = [{ type: String(b.type), id: String(b.id) }, ...prefs.recent.filter((r) => !(r.type === b.type && r.id === String(b.id)))].slice(0, 20);
    return noContent();
  }

  if (path === "/devices" && method === "GET") {
    const p = url.searchParams;
    const statuses = p.getAll("status");
    const q = p.get("q")?.toLowerCase();
    const virtual = p.get("virtual") === "true";
    const items = core.devices.filter(
      (d) =>
        (statuses.length ? statuses.includes(d.status) : true) &&
        (!q || d.name.toLowerCase().includes(q) || d.externalId.includes(q)) &&
        (!p.get("connectivity") || d.connectivity === p.get("connectivity")) &&
        (!p.get("modelId") || d.modelId === p.get("modelId")) &&
        (!p.get("sourceId") || d.sourceId === p.get("sourceId")) &&
        (!p.get("tag") || d.tags.some((t) => t.toLowerCase() === p.get("tag")?.toLowerCase())) &&
        (!p.get("spaceId") || core.spacePath(d.spaceId).some((s) => s.id === p.get("spaceId"))) &&
        (virtual || !d.virtual),
    );
    return list(items.map((d) => core.deviceSummary(d)), url);
  }
  if (path === "/devices" && method === "POST") {
    if (!can("DEV_ADMIN")) return fail(403, "PERMISSION_DENIED");
    const externalId = String(b.externalId);
    if (core.devices.some((d) => d.sourceId === String(b.sourceId) && d.externalId === externalId)) return fail(409, "DEVICE_DUPLICATE");
    if (!core.model(String(b.modelId))) return fail(400, "MODEL_NOT_FOUND");
    const device: FakeDevice = { id: core.nextId(), name: String(b.name), externalId, kind: String(b.kind), status: "ACTIVE", connectivity: "UNKNOWN", modelId: String(b.modelId), spaceId: String(b.spaceId), sourceId: String(b.sourceId), tags: (b.tags as string[]) ?? [], virtual: Boolean(b.virtual), lastSeenAt: null, latest: [], version: 1 };
    core.devices.push(device);
    return ok(core.deviceDetail(device), 201, { Location: `/api/v1/core/devices/${device.id}` });
  }
  if (path === "/devices/approve" && method === "POST") {
    if (!can("DEV_PLACE")) return fail(403, "PERMISSION_DENIED");
    if (!b.modelId) return fail(400, "DEVICE_MODEL_REQUIRED");
    if (!b.spaceId) return fail(400, "DEVICE_SPACE_REQUIRED");
    const items = (b.items as { deviceId: string; baseVersion: number }[]) ?? [];
    const results = items.map((item) => {
      const d = core.devices.find((x) => x.id === item.deviceId);
      if (!d) return { deviceId: item.deviceId, ok: false, errorCode: "DEVICE_NOT_FOUND" };
      if (d.status !== "PENDING" || d.version !== item.baseVersion) return { deviceId: d.id, ok: false, errorCode: "DEVICE_STATE_CONFLICT" };
      Object.assign(d, { status: "ACTIVE", modelId: String(b.modelId), spaceId: String(b.spaceId) });
      if (items.length === 1 && typeof b.name === "string") d.name = b.name;
      if (Array.isArray(b.tags)) d.tags = b.tags as string[];
      touch(d);
      return { deviceId: d.id, ok: true };
    });
    return ok({ results });
  }
  if (path === "/devices/reject" && method === "POST") {
    if (!can("DEV_PLACE")) return fail(403, "PERMISSION_DENIED");
    const ids = (b.deviceIds as string[]) ?? [];
    const results = ids.map((id) => {
      const index = core.devices.findIndex((d) => d.id === id && d.status === "PENDING");
      if (index < 0) return { deviceId: id, ok: false, errorCode: "DEVICE_STATE_CONFLICT", ignored: false };
      core.devices.splice(index, 1);
      return { deviceId: id, ok: true, ignored: b.addToIgnoreList !== false };
    });
    return ok({ results });
  }
  if (path === "/devices/tag" && method === "POST") {
    if (!can("DEV_PLACE")) return fail(403, "PERMISSION_DENIED");
    const add = (b.add as string[]) ?? [];
    const remove = ((b.remove as string[]) ?? []).map((t) => t.toLowerCase());
    const results = ((b.deviceIds as string[]) ?? []).map((id) => {
      const d = core.devices.find((x) => x.id === id);
      if (!d) return { deviceId: id, ok: false, errorCode: "DEVICE_NOT_FOUND", tags: [] };
      const next = d.tags.filter((t) => !remove.includes(t.toLowerCase()));
      for (const t of add) if (!next.some((x) => x.toLowerCase() === t.toLowerCase())) next.push(t);
      if (next.length > 20) return { deviceId: id, ok: false, errorCode: "DEVICE_TAG_LIMIT", tags: d.tags };
      d.tags = next;
      touch(d);
      return { deviceId: id, ok: true, tags: next };
    });
    return ok({ results });
  }
  if (path === "/devices/import" && method === "POST") {
    if (!can("DEV_ADMIN")) return fail(403, "PERMISSION_DENIED");
    const dryRun = url.searchParams.get("dryRun") !== "false";
    // 본문(multipart)은 핸들러 공통 처리에서 읽지 않으므로 행 결과를 고정 시나리오로 돌려준다
    const rows = [
      { line: 2, ok: true, errorCode: null, message: null },
      { line: 3, ok: false, errorCode: "MODEL_NOT_FOUND", message: '"EM500-CO3" 모델이 없습니다' },
    ];
    const allOrNothing = url.searchParams.get("mode") === "ALL_OR_NOTHING";
    const succeeded = dryRun ? 1 : allOrNothing ? 0 : 1;
    if (!dryRun) core.extra.importRuns = Number(core.extra.importRuns ?? 0) + 1;
    return ok({ total: 2, succeeded, failed: 2 - succeeded, rows });
  }
  if (path === "/devices/export" && method === "GET") {
    return new HttpResponse("﻿sourceId,externalId,name\n7,24e124707c067999,AM107-067999\n", { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="devices.csv"' } });
  }

  const one = /^\/devices\/([^/]+)(\/[a-z-/]+)?$/.exec(path);
  if (!one) return undefined;
  const d = core.devices.find((x) => x.id === one[1]);
  const sub = one[2] ?? "";
  if (!d) return ["", "/history", "/semantic", "/model-suggestions", "/activate", "/deactivate"].includes(sub) ? fail(404, "DEVICE_NOT_FOUND") : undefined;

  if (sub === "" && method === "GET") return ok(core.deviceDetail(d));
  if (sub === "" && method === "PATCH") {
    const placeOnly = Object.keys(b).every((k) => ["spaceId", "baseVersion"].includes(k));
    if (!can("DEV_ADMIN") && !(placeOnly && can("DEV_PLACE"))) return fail(403, "PERMISSION_DENIED");
    if (b.baseVersion !== d.version) return fail(409, "VERSION_CONFLICT");
    if (b.modelId && !core.model(String(b.modelId))) return fail(400, "MODEL_NOT_FOUND");
    for (const key of ["name", "modelId", "spaceId", "kind"] as const) if (typeof b[key] === "string") (d as unknown as Record<string, unknown>)[key] = b[key];
    touch(d);
    return ok(core.deviceDetail(d));
  }
  if (sub === "" && method === "DELETE") {
    if (!can("DEV_ADMIN")) return fail(403, "PERMISSION_DENIED");
    const refs = extra.references[d.id];
    if (refs?.length) return HttpResponse.json({ ...envelope({ references: refs }, "DEVICE_IN_USE") }, { status: 409 });
    core.devices.splice(core.devices.indexOf(d), 1);
    return noContent();
  }
  if ((sub === "/activate" || sub === "/deactivate") && method === "POST") {
    if (!can("DEV_PLACE")) return fail(403, "PERMISSION_DENIED");
    if (b.baseVersion !== d.version) return fail(409, "VERSION_CONFLICT");
    const target = sub === "/activate" ? "ACTIVE" : "INACTIVE";
    if (d.status === "PENDING" || d.status === target) return fail(409, "DEVICE_STATE_CONFLICT");
    d.status = target;
    touch(d);
    return ok({ id: d.id, status: d.status, version: d.version });
  }
  if (sub === "/history" && method === "GET") return list(extra.history[d.id] ?? [], url);
  if (sub === "/model-suggestions" && method === "GET") {
    if (!can("DEV_PLACE")) return fail(403, "PERMISSION_DENIED");
    const hits = d.latest.map((l) => SUGGEST[l.metricKey]).filter(Boolean);
    return ok(
      hits.map((h) => {
        const m = core.model(h.modelId)!;
        return { modelId: m.id, modelCode: m.code, modelName: m.name, matchedMetrics: m.metrics.map((x) => x.key), score: h.score };
      }),
    );
  }
  if (sub === "/semantic" && method === "GET") return ok({ deviceId: d.id, equipment: extra.semantic[d.id]?.equipment ?? [] });
  if (sub === "/semantic" && method === "PUT") {
    if (!can("DEV_ADMIN")) return fail(403, "PERMISSION_DENIED");
    const equipment = (b.equipment as { points: { quantity?: string | null }[] }[]) ?? [];
    const errors: { field: string; code: string; message: string }[] = [];
    equipment.forEach((eq, i) => eq.points.forEach((p, j) => p.quantity === "Unknown_Thing" && errors.push({ field: `equipment[${i}].points[${j}].quantity`, code: "SEMANTIC_TAG_UNKNOWN", message: "알 수 없는 물리량입니다" })));
    if (errors.length) return HttpResponse.json({ ...envelope(undefined, "SEMANTIC_TAG_UNKNOWN"), errors }, { status: 400 });
    extra.semantic[d.id] = { equipment };
    return ok({ deviceId: d.id, equipment });
  }
  if (sub === "/semantic/reapply-model" && method === "POST") {
    if (!can("DEV_ADMIN")) return fail(403, "PERMISSION_DENIED");
    return ok({ deviceId: d.id, equipment: extra.semantic[d.id]?.equipment ?? [] });
  }
  return undefined;
};
