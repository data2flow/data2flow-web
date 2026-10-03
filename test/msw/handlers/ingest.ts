/**
 * 수집(ING)·수집 흐름(DSH-03) 가짜 API: API-ING-01 요약, API-ING-02 지표, API-ING-04 알람 기준, API-ING-05·06 원본 메시지,
 * API-ING-07 재처리, API-ING-08 실패 목록, API-ING-11 폐기, API-DSH-05 흐름 스냅샷, API-OPS-02 운영 수집 지표.
 * 상태는 CoreState마다 하나(`ingestState(core)`)이고 테스트가 직접 바꿀 수 있다.
 */
import { HttpResponse } from "msw";
import { envelope, fail, list, ok, type CoreHandler, type CoreState } from "../core-fixtures";

export interface FakeRawMessage {
  id: string;
  receivedAt: string;
  sourceId: string;
  topic: string;
  deviceId: string | null;
  externalId?: string | null;
  status: string;
  errorCode?: string | null;
  errorDetail?: string | null;
  payload: string;
  canonical?: unknown;
  stored?: { metricKey: string; value: unknown; unit?: string | null; quality: number; late?: boolean }[];
  virtual?: boolean;
}

export interface FakeFailure {
  id: string;
  rawMessageId: string;
  stage: "DECODE" | "SCRIPT" | "STORE" | "PUBLISH";
  errorCode: string;
  errorMessage: string;
  attempts: number;
  status: "OPEN" | "REPROCESSING" | "RESOLVED" | "DISCARDED";
  sourceId: string | null;
  deviceId: string | null;
  createdAt: string;
  lockedBy?: string | null;
}

export interface IngestState {
  summary: Record<string, unknown>;
  snapshot: Record<string, unknown>;
  metricsAvailable: boolean;
  thresholds: { lagWarnSec: number; lagCriticalSec: number; heartbeatCriticalSec: number; version: number };
  raw: FakeRawMessage[];
  failures: FakeFailure[];
  /** 재처리 시 해결되는 오류 코드(나머지는 SAME_ERROR) */
  fixedCodes: Set<string>;
}

const states = new WeakMap<CoreState, IngestState>();

const uplink = (devEui: string, object: Record<string, number>) =>
  JSON.stringify({ deviceInfo: { deviceName: devEui, devEui, tags: { location: "실습실" } }, fCnt: 1822, object });

export function ingestState(core: CoreState): IngestState {
  let state = states.get(core);
  if (state) return state;
  const raw: FakeRawMessage[] = [
    { id: "8812345", receivedAt: "2026-10-03T23:59:48Z", sourceId: "7", topic: "application/1/device/24e124707c067999/event/up", deviceId: "1042", externalId: "24e124707c067999", status: "OK", payload: uplink("24e124707c067999", { temperature: 22.3, humidity: 44.5, co2: 517 }), canonical: { v: 1, deviceId: "1042", metrics: [{ key: "temperature", value: 22.3 }] }, stored: [{ metricKey: "temperature", value: 22.3, unit: "℃", quality: 0 }] },
    { id: "8812344", receivedAt: "2026-10-03T23:58:00Z", sourceId: "7", topic: "application/1/device/24e124136d151606/event/up", deviceId: "1050", externalId: "24e124136d151606", status: "OK", payload: uplink("24e124136d151606", { temperature: 22.3, humidity: 43 }), canonical: { v: 1, deviceId: "1050" }, stored: [] },
    { id: "8812300", receivedAt: "2026-10-03T14:10:00Z", sourceId: "7", topic: "devices/unknown/telemetry", deviceId: null, status: "DECODE_ERROR", errorCode: "ING_EXTERNAL_ID_MISSING", errorDetail: "externalId 없음", payload: '{"temp":1}', stored: [] },
    { id: "8812301", receivedAt: "2026-10-03T15:00:00Z", sourceId: "7", topic: "application/1/device/24e124707c067999/event/up", deviceId: "1042", status: "SCRIPT_ERROR", errorCode: "SCRIPT_RUNTIME_ERROR", errorDetail: "Cannot read property 'value' of undefined", payload: uplink("24e124707c067999", { temperature: 22.1 }), stored: [] },
  ];
  const failures: FakeFailure[] = [
    ...Array.from({ length: 3 }, (_, i): FakeFailure => ({ id: String(500 + i), rawMessageId: "8812300", stage: "DECODE", errorCode: "ING_EXTERNAL_ID_MISSING", errorMessage: "externalId 없음", attempts: 1, status: "OPEN", sourceId: "7", deviceId: null, createdAt: `2026-10-03T14:1${i}:00Z` })),
    { id: "510", rawMessageId: "8812301", stage: "SCRIPT", errorCode: "SCRIPT_RUNTIME_ERROR", errorMessage: "Cannot read property 'value' of undefined", attempts: 2, status: "OPEN", sourceId: "7", deviceId: "1042", createdAt: "2026-10-03T15:00:00Z" },
  ];
  state = {
    summary: {
      perMinute: 12.4,
      latencyP50Ms: 210,
      latencyP95Ms: 420,
      streamLagSec: 3,
      heartbeat: { lastPassedAt: "2026-10-03T23:59:50Z", totalMs: 2100, stages: [{ name: "ingress", ms: 100 }, { name: "raw", ms: 300 }, { name: "telemetry", ms: 400 }] },
      failuresToday: 7,
      alerts: [],
      sources: [{ sourceId: "7", name: "ChirpStack s3", type: "MQTT_SUBSCRIBE", connection: "CONNECTED", perMinute: 11.9, counts: { OK: 712, DECODE_ERROR: 0, SCRIPT_ERROR: 2, DUPLICATE: 31, UNKNOWN_DEVICE_REJECTED: 0, INVALID: 0 }, lastReceivedAt: "2026-10-03T23:59:48Z" }],
    },
    snapshot: {
      stages: [
        { key: "SOURCE", inPerMin: 14, failPerMin: 0, latencyP95Ms: 5 },
        { key: "DECODE", inPerMin: 14, failPerMin: 0, latencyP95Ms: 3 },
        { key: "SCRIPT", inPerMin: 14, failPerMin: 12, latencyP95Ms: 1, failureLink: "/ingest/failures?stage=SCRIPT&code=SCRIPT_ERROR" },
        { key: "VALIDATE", inPerMin: 2, failPerMin: 0, latencyP95Ms: 1 },
        { key: "STORE", inPerMin: 2, failPerMin: 0, latencyP95Ms: 30 },
        { key: "EVENT", inPerMin: 2, failPerMin: 0, latencyP95Ms: 8 },
      ],
      sources: [{ id: "7", name: "ChirpStack s3", state: "CONNECTED", perMin: 11.9, lastMessageAt: "2026-10-03T23:59:48Z" }],
      throughput: [{ sourceId: "7", points: [["2026-10-03T23:58:00Z", 11], ["2026-10-03T23:59:00Z", 12]] }],
    },
    metricsAvailable: true,
    thresholds: { lagWarnSec: 60, lagCriticalSec: 300, heartbeatCriticalSec: 120, version: 1 },
    raw,
    failures,
    fixedCodes: new Set(["ING_EXTERNAL_ID_MISSING"]),
  };
  states.set(core, state);
  return state;
}

function rawSummary(core: CoreState, m: FakeRawMessage) {
  const device = core.devices.find((d) => d.id === m.deviceId);
  return { id: m.id, receivedAt: m.receivedAt, sourceId: m.sourceId, sourceName: core.source(m.sourceId)?.name ?? null, topic: m.topic, deviceId: m.deviceId, deviceName: device?.name ?? null, externalId: m.externalId ?? null, status: m.status, metricCount: m.stored?.length ?? 0, qualitySummary: { normal: m.stored?.length ?? 0, outOfRange: 0, unverified: 0 }, sizeBytes: m.payload.length };
}

export const ingestHandler: CoreHandler = (core, { method, path, url, body, can, request }) => {
  const isIngest = path.startsWith("/ingest/") || path === "/monitoring/ingest" || path === "/ops/metrics/ingest";
  if (!isIngest) return undefined;
  const state = ingestState(core);
  if (path === "/ingest/alert-thresholds") {
    if (!can("OPS_MANAGE")) return fail(403, "PERMISSION_DENIED");
    if (method === "GET") return ok(state.thresholds);
    if (method === "PUT") {
      const b = body as typeof state.thresholds & { baseVersion: number };
      if (b.baseVersion !== state.thresholds.version) return fail(409, "VERSION_CONFLICT");
      state.thresholds = { lagWarnSec: b.lagWarnSec, lagCriticalSec: b.lagCriticalSec, heartbeatCriticalSec: b.heartbeatCriticalSec, version: state.thresholds.version + 1 };
      return ok({ ...state.thresholds, updatedBy: "1", updatedAt: "2026-10-04T00:00:00Z" });
    }
  }
  if (!can("INGEST_READ")) return fail(403, "PERMISSION_DENIED");
  if (method === "GET" && path === "/ingest/summary") return ok(state.summary);
  if (method === "GET" && path === "/monitoring/ingest") return ok(state.snapshot);
  if (method === "GET" && path === "/ingest/metrics") {
    if (!state.metricsAvailable) return fail(503, "METRICS_UNAVAILABLE");
    return ok({ points: [{ t: "2026-10-03T23:58:00Z", received: 11, byStatus: { OK: 11 }, latencyP50Ms: 200, latencyP95Ms: 410 }, { t: "2026-10-03T23:59:00Z", received: 12, byStatus: { OK: 12 }, latencyP50Ms: 210, latencyP95Ms: 420 }] });
  }
  if (method === "GET" && path === "/ops/metrics/ingest") {
    if (!state.metricsAvailable) return fail(503, "METRICS_UNAVAILABLE");
    return ok({ series: { receivedPerMin: [], latencyP50: [], latencyP95: [], backlog: [] }, resultCounts: (state.summary.sources as { counts: Record<string, number> }[])[0]?.counts ?? {} });
  }
  if (method === "GET" && path === "/ingest/raw-messages") {
    const from = Date.parse(url.searchParams.get("from") ?? "");
    const to = Date.parse(url.searchParams.get("to") ?? "");
    if (Number.isNaN(from) || Number.isNaN(to)) return fail(400, "INVALID_REQUEST");
    if (to - from > 31 * 86400_000) return fail(400, "ING_QUERY_RANGE_TOO_LARGE");
    const sourceIds = url.searchParams.getAll("sourceId");
    const deviceIds = url.searchParams.getAll("deviceId");
    const statuses = url.searchParams.getAll("status");
    const topic = url.searchParams.get("topicContains");
    const size = Math.min(500, Math.max(1, Number(url.searchParams.get("size")) || 50));
    const cursor = Number(url.searchParams.get("cursor") || 0);
    const matched = state.raw
      .filter((m) => {
        const t = Date.parse(m.receivedAt);
        return t >= from && t < to && (!sourceIds.length || sourceIds.includes(m.sourceId)) && (!deviceIds.length || deviceIds.includes(m.deviceId ?? "")) && (!statuses.length || statuses.includes(m.status)) && (!topic || m.topic.includes(topic));
      })
      .sort((a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt));
    const page = matched.slice(cursor, cursor + size);
    const countsByStatus: Record<string, number> = {};
    for (const m of matched) countsByStatus[m.status] = (countsByStatus[m.status] ?? 0) + 1;
    const next = cursor + size < matched.length ? String(cursor + size) : null;
    return HttpResponse.json({ ...envelope(), responses: page.map((m) => rawSummary(core, m)), countsByStatus, nextCursor: next });
  }
  const rawDetail = /^\/ingest\/raw-messages\/([^/]+)$/.exec(path);
  if (method === "GET" && rawDetail) {
    const m = state.raw.find((r) => r.id === rawDetail[1]);
    if (!m) return fail(404, "ING_RAW_MESSAGE_NOT_FOUND");
    const detail: Record<string, unknown> = { ...rawSummary(core, m), ingressInstance: "ingress-0", dedupKey: `${m.deviceId}:${m.receivedAt}`, payloadEncoding: "JSON", errorCode: m.errorCode ?? null, errorDetail: m.errorDetail ?? null, trace: [{ stage: "DECODE", ok: m.status !== "DECODE_ERROR", ms: 1, info: "chirpstack-v4" }, ...(m.status === "DECODE_ERROR" ? [] : [{ stage: "SCRIPT", ok: m.status !== "SCRIPT_ERROR", ms: 1 }])], canonical: m.canonical ?? null, stored: m.stored ?? [] };
    if (can("INGEST_PAYLOAD_READ")) detail.payload = m.payload;
    return ok(detail);
  }
  if (method === "GET" && path === "/ingest/failures") {
    const status = url.searchParams.get("status") ?? "OPEN";
    const stage = url.searchParams.get("stage");
    const code = url.searchParams.get("errorCode");
    const inScope = state.failures.filter((f) => f.status === status);
    const filtered = inScope.filter((f) => (!stage || f.stage === stage) && (!code || f.errorCode === code));
    if (url.searchParams.get("groupBy") === "errorCode") {
      const groups = new Map<string, { errorCode: string; count: number; firstAt: string; lastAt: string; sampleMessage: string }>();
      for (const f of filtered) {
        const g = groups.get(f.errorCode) ?? { errorCode: f.errorCode, count: 0, firstAt: f.createdAt, lastAt: f.createdAt, sampleMessage: f.errorMessage };
        g.count += 1;
        if (f.createdAt < g.firstAt) g.firstAt = f.createdAt;
        if (f.createdAt > g.lastAt) g.lastAt = f.createdAt;
        groups.set(f.errorCode, g);
      }
      const countsByStage: Record<string, number> = { DECODE: 0, SCRIPT: 0, STORE: 0, PUBLISH: 0 };
      for (const f of inScope) countsByStage[f.stage] += 1;
      return ok({ groups: [...groups.values()], countsByStage });
    }
    return list(
      filtered.map((f) => ({ ...f, sourceName: core.source(f.sourceId)?.name ?? null, deviceName: core.devices.find((d) => d.id === f.deviceId)?.name ?? null })),
      url,
    );
  }
  if (method === "POST" && path === "/ingest/failures/reprocess") {
    if (!can("INGEST_REPROCESS")) return fail(403, "PERMISSION_DENIED");
    if (!request.headers.get("idempotency-key")) return fail(400, "INVALID_REQUEST");
    const ids = ((body as { dlqItemIds?: string[] })?.dlqItemIds ?? []).map(String);
    if (ids.length < 1) return fail(400, "INVALID_REQUEST");
    if (ids.length > 5000) return fail(400, "ING_DLQ_BATCH_TOO_LARGE");
    const results = ids.map((id) => {
      const f = state.failures.find((x) => x.id === id);
      if (!f) return { id, outcome: "OTHER_ERROR", errorCode: "RESOURCE_NOT_FOUND" };
      if (f.lockedBy) return { id, outcome: "LOCKED", errorCode: "ING_DLQ_ITEM_LOCKED" };
      f.attempts += 1;
      if (state.fixedCodes.has(f.errorCode)) {
        f.status = "RESOLVED";
        return { id, outcome: "RESOLVED" };
      }
      return { id, outcome: "SAME_ERROR", errorCode: f.errorCode };
    });
    const count = (o: string) => results.filter((r) => r.outcome === o).length;
    return ok({ results, summary: { resolved: count("RESOLVED"), sameError: count("SAME_ERROR"), otherError: count("OTHER_ERROR") } });
  }
  if (method === "POST" && path === "/ingest/failures/discard") {
    if (!can("INGEST_REPROCESS")) return fail(403, "PERMISSION_DENIED");
    const { dlqItemIds = [], reason = "" } = (body as { dlqItemIds?: string[]; reason?: string }) ?? {};
    if (reason.trim().length < 2 || reason.length > 200 || dlqItemIds.length < 1 || dlqItemIds.length > 5000) return fail(400, "INVALID_REQUEST");
    let discarded = 0;
    for (const id of dlqItemIds.map(String)) {
      const f = state.failures.find((x) => x.id === id && x.status === "OPEN");
      if (f) {
        f.status = "DISCARDED";
        discarded += 1;
      }
    }
    return ok({ discarded });
  }
  return fail(404, "RESOURCE_NOT_FOUND");
};
