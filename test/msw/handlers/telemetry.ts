/**
 * 가짜 시계열 API(design/api/TSD-api.md): 현재값 API-TSD-01, 시계열 API-TSD-02, 공간 집계 API-TSD-03, 다중 조회 API-TSD-04,
 * 주석 API-TSD-06·07. 값은 시각으로 정해지는 결정적 값이다.
 * AM107-067999(1042) temperature 원본에는 품질 1(범위 초과) 점 하나와 공백 한 구간이 있다(AT-TSD-01.3, DSH-05.03).
 */
import { fail, list, noContent, ok, type CoreHandler, type CoreState } from "../core-fixtures";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const BASE: Record<string, number> = { temperature: 22, humidity: 44, co2: 520, LAeq: 31 };

export interface FakeAnnotation {
  id: string;
  timeFrom: string;
  timeTo?: string | null;
  deviceId?: string | null;
  spaceId?: string | null;
  metricKey?: string | null;
  type: string;
  title: string;
  createdBy?: string | null;
}

const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

export function annotationsOf(core: CoreState): FakeAnnotation[] {
  core.extra.annotations ??= [
    { id: "a1", timeFrom: "2026-10-03T21:00:00Z", deviceId: "1042", type: "OFFLINE", title: "오프라인", createdBy: null },
    { id: "a2", timeFrom: "2026-10-03T22:00:00Z", timeTo: "2026-10-03T23:00:00Z", spaceId: "31", type: "USER", title: "창문 공사", createdBy: "1" },
  ] satisfies FakeAnnotation[];
  return core.extra.annotations as FakeAnnotation[];
}

function pickResolution(requested: string | null, spanMs: number): { resolutionUsed: string; reason: string } {
  if (requested && requested !== "auto") {
    if (requested === "raw" && spanMs > 7 * DAY) return { resolutionUsed: "1h", reason: "CAPPED" };
    return { resolutionUsed: requested, reason: "REQUESTED" };
  }
  if (spanMs <= 6 * 60 * MINUTE) return { resolutionUsed: "raw", reason: "AUTO" };
  if (spanMs <= 2 * DAY) return { resolutionUsed: "1m", reason: "AUTO" };
  if (spanMs <= 60 * DAY) return { resolutionUsed: "1h", reason: "AUTO" };
  return { resolutionUsed: "1d", reason: "AUTO" };
}

/** 계열 하나: 구간을 최대 120점으로 나눈다 */
export function generateSeries(deviceId: string, metric: string, from: number, to: number, resolution: string, quality: string) {
  const step = Math.max(MINUTE, Math.floor((to - from) / 120));
  const raw = resolution === "raw";
  const special = deviceId === "1042" && metric === "temperature";
  const points: [string, number | null, number | null][] = [];
  const gaps: { from: string; to: string }[] = [];
  let index = 0;
  for (let t = from - (from % step) + step; t <= to; t += step, index += 1) {
    if (special && index >= 20 && index < 30) {
      if (index === 20) gaps.push({ from: iso(t), to: iso(t + 9 * step) });
      continue;
    }
    const value = Math.round(((BASE[metric] ?? 10) + Math.sin(t / 3_600_000) * 2) * 10) / 10;
    const q = special && raw && index === 5 ? 1 : 0;
    if (raw && q !== 0 && quality !== "all") continue;
    points.push([iso(t), q === 1 ? 61 : value, raw ? q : 12]);
  }
  return { points, gaps };
}

function units(core: CoreState, metric: string) {
  return core.metrics.find((m) => m.key === metric)?.unit ?? null;
}

export const telemetryHandler: CoreHandler = (core, { method, path, url, body, can, user }) => {
  if (path === "/telemetry/latest" && method === "GET") {
    const ids = (url.searchParams.get("deviceIds") ?? "").split(",").filter(Boolean);
    const devices = core.devices.filter((d) => ids.includes(d.id) || (url.searchParams.get("spaceId") && d.spaceId === url.searchParams.get("spaceId")));
    return ok(devices.map((d) => ({ deviceId: d.id, deviceName: d.name, metrics: d.latest.map((l) => ({ key: l.metricKey, value: l.value, unit: l.unit, measuredAt: l.measuredAt, quality: l.quality })), connectivity: d.connectivity, lastSeenAt: d.lastSeenAt })));
  }
  if (path === "/telemetry/series" && method === "GET") {
    const deviceId = url.searchParams.get("deviceId") ?? "";
    const device = core.devices.find((d) => d.id === deviceId);
    if (!device) return fail(404, "DEVICE_NOT_FOUND");
    const from = Date.parse(url.searchParams.get("from") ?? "");
    const to = Date.parse(url.searchParams.get("to") ?? "") || Date.parse("2026-10-04T00:00:00Z");
    if (url.searchParams.get("resolution") === "raw" && to - from > 31 * DAY) return fail(400, "TSD_RANGE_TOO_LARGE");
    const picked = pickResolution(url.searchParams.get("resolution"), to - from);
    const quality = url.searchParams.get("quality") ?? "normal";
    const metrics = (url.searchParams.get("metrics") ?? "").split(",").filter(Boolean);
    const hide = device.virtual && url.searchParams.get("virtual") !== "true";
    return ok({
      ...picked,
      truncated: false,
      series: metrics.map((metric) => ({ metric, unit: units(core, metric), agg: "avg", virtual: device.virtual, ...(hide ? { points: [], gaps: [] } : generateSeries(deviceId, metric, from, to, picked.resolutionUsed, quality)) })),
    });
  }
  if (path === "/telemetry/space-series" && method === "GET") {
    const from = Date.parse(url.searchParams.get("from") ?? "");
    const to = Date.parse(url.searchParams.get("to") ?? "");
    const { points } = generateSeries(`s${url.searchParams.get("spaceId")}`, url.searchParams.get("metric") ?? "", from, to, "1h", "normal");
    return ok({ points: points.map(([t, v]) => [t, v, 2]), excludedDeviceCount: 0 });
  }
  if (path === "/telemetry/query" && method === "POST") {
    const request = body as { series: { deviceId?: string; spaceId?: string; metric: string; agg?: string; label?: string }[]; from: string; to: string; resolution?: string; quality?: string };
    if (!request?.series?.length || request.series.length > 50) return fail(400, "TSD_TOO_MANY_SERIES");
    const from = Date.parse(request.from);
    const to = Date.parse(request.to);
    const picked = pickResolution(request.resolution ?? "auto", to - from);
    return ok({
      ...picked,
      truncated: false,
      series: request.series.map((s) => ({ ...s, unit: units(core, s.metric), agg: s.agg ?? "avg", virtual: Boolean(core.devices.find((d) => d.id === s.deviceId)?.virtual), ...generateSeries(s.deviceId ?? `s${s.spaceId}`, s.metric, from, to, picked.resolutionUsed, request.quality ?? "normal") })),
    });
  }
  if (path === "/annotations" && method === "GET") {
    const deviceId = url.searchParams.get("deviceId");
    const spaceId = url.searchParams.get("spaceId");
    const from = Date.parse(url.searchParams.get("from") ?? "") || 0;
    const to = Date.parse(url.searchParams.get("to") ?? "") || Number.MAX_SAFE_INTEGER;
    const types = (url.searchParams.get("types") ?? "").split(",").filter(Boolean);
    // 기기로 조회하면 그 기기가 있는 공간(상위 포함)의 공간 범위 주석도 함께 준다(AT-TSD-11.2)
    const deviceSpace = deviceId ? core.devices.find((d) => d.id === deviceId)?.spaceId : null;
    const spaceIds = new Set([...(spaceId ? [spaceId] : []), ...core.spacePath(deviceSpace ?? null).map((p) => p.id)]);
    const items = annotationsOf(core).filter(
      (a) =>
        ((deviceId && a.deviceId === deviceId) || (a.spaceId && !a.deviceId && spaceIds.has(a.spaceId))) &&
        Date.parse(a.timeTo ?? a.timeFrom) >= from &&
        Date.parse(a.timeFrom) <= to &&
        (types.length === 0 || types.includes(a.type)),
    );
    return list(items, url);
  }
  if (path === "/annotations" && method === "POST") {
    if (!can("DEV_PLACE")) return fail(403, "ANNOTATION_FORBIDDEN");
    const input = body as Partial<FakeAnnotation>;
    if (!input?.title || !input.timeFrom) return fail(400, "INVALID_REQUEST");
    const created: FakeAnnotation = { id: core.nextId(), timeFrom: input.timeFrom, timeTo: input.timeTo ?? null, deviceId: input.deviceId ?? null, spaceId: input.spaceId ?? null, metricKey: input.metricKey ?? null, type: "USER", title: input.title, createdBy: user.id };
    annotationsOf(core).push(created);
    return ok({ ...created, createdAt: "2026-10-04T00:00:00Z" }, 201, { Location: `/api/v1/core/annotations/${created.id}` });
  }
  const one = /^\/annotations\/([^/]+)$/.exec(path);
  if (one && method === "DELETE") {
    const items = annotationsOf(core);
    const index = items.findIndex((a) => a.id === one[1]);
    if (index < 0) return fail(404, "RESOURCE_NOT_FOUND");
    if (!can("DEV_PLACE") || items[index].createdBy !== user.id) return fail(403, "ANNOTATION_FORBIDDEN");
    items.splice(index, 1);
    return noContent();
  }
  return undefined;
};
