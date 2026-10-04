/**
 * M5 데이터 관리 가짜 core API(design/api/TSD-api.md §2~§4, OPS-api.md API-OPS-03): 내보내기 API-TSD-20~22, 정기 API-TSD-23·56,
 * 가져오기 API-TSD-30~32, 보관 API-TSD-40~43·33, 데이터 사전 API-TSD-59, 저장 지표 API-OPS-03. 권한은 core와 같게 검사한다.
 * 상태는 core.extra["data"]. 응답 모양은 core M5 컨트롤러(ExchangeDtos·RetentionDtos·StorageMetricsService) 기준.
 */
import { HttpResponse } from "msw";
import { fail, list, noContent, ok, NOW, type CoreHandler, type CoreState } from "../core-fixtures";

interface DataState {
  exports: Record<string, unknown>[];
  schedules: Record<string, unknown>[];
  imports: Record<string, unknown>[];
  effective: Record<string, unknown>[];
  seq: number;
}

const DEFAULTS: [string, number, number][] = [
  ["RAW_MESSAGE", 30, 7],
  ["TELEMETRY", 365, 30],
  ["LINK", 90, 7],
  ["AGG_1M", 90, 30],
  ["AGG_1H", 1095, 365],
  ["AGG_1D", 0, 0],
  ["FLOW_EXECUTION", 30, 7],
  ["ANALYSIS_RESULT", 365, 30],
  ["AUDIT_LOG", 365, 365],
  ["NOTIFICATION_DELIVERY", 90, 30],
  ["COMMAND", 365, 90],
  ["DEVICE_STATE_HISTORY", 365, 90],
  ["WEBHOOK_DELIVERY", 90, 30],
];

export function dataState(core: CoreState): DataState {
  core.extra.data ??= {
    exports: [
      { id: "71", status: "SUCCEEDED", format: "CSV", query: { series: [{ deviceId: "1042", metric: "temperature" }], from: "2025-10-04T00:00:00Z", to: "2026-10-04T00:00:00Z", resolution: "1m" }, rows: 525_600, bytes: 31_457_280, dictionaryVersion: 4, expiresAt: "2026-10-11T00:00:00Z", downloadUrl: "/api/v1/core/exports/71/file?expires=1760000000&signature=ab", error: null, requestedBy: "7", scheduleId: null, estimatedRows: 525_600, createdAt: "2026-10-03T23:00:00Z", finishedAt: "2026-10-03T23:01:00Z" },
    ],
    schedules: [
      { id: "5", name: "주간 실내환경", query: { series: [{ spaceId: "31", metric: "temperature" }] }, format: "CSV", cron: "0 2 * * 1", relativePeriod: "PREVIOUS_WEEK", delivery: "STORAGE", recipients: [], targetType: "SFTP", target: { host: "sftp.example", username: "bi" }, credentialRef: "export-schedule-credential", credentialConfigured: true, enabled: true, lastRunAt: "2026-09-28T17:00:00Z", lastStatus: "FAILED", lastError: "인증 실패", nextRunAt: "2026-10-04T17:00:00Z", lastFileVersion: 1, version: 2, createdBy: "7" },
    ],
    imports: [
      { id: "9", sourceKind: "INFLUXDB", status: "DRY_RUN_DONE", dryRun: true, total: 1_284_300, inserted: 0, skippedDuplicate: 12_000, failed: 2, originLabel: "아카데미 iot-bucket 2026-09", sample: [], error: null, rangeFrom: "2026-08-31T15:00:00Z", rangeTo: "2026-09-30T15:00:00Z", startedAt: null, finishedAt: null, createdAt: NOW },
    ],
    effective: [
      ...DEFAULTS.map(([dataClass, days, min]) => ({ scope: "ORG", scopeRef: null, dataClass, retainDays: days, compressAfterDays: dataClass === "TELEMETRY" ? 7 : null, archiveBeforeDelete: false, storeMode: null, minDays: min, inherited: true, version: 0 })),
      { scope: "METRIC", scopeRef: "LAeq", dataClass: "TELEMETRY", retainDays: 90, compressAfterDays: null, archiveBeforeDelete: false, storeMode: null, minDays: 30, inherited: false, version: 1 },
    ],
    seq: 100,
  } satisfies DataState;
  return core.extra.data as DataState;
}

const DICTIONARY = {
  version: 4,
  generatedAt: "2026-10-03T00:00:00Z",
  tables: [{ name: "telemetry", description: "측정값", columns: [{ name: "time", type: "timestamptz", unit: null, description: "측정 시각" }] }],
  metrics: [
    { key: "temperature", displayName: "온도", unit: "℃", valueType: "NUMBER", aggDefault: "avg", validMin: -40, validMax: 85, stateType: null, aliases: [] },
    { key: "co2", displayName: "CO2", unit: "ppm", valueType: "NUMBER", aggDefault: "avg", validMin: 0, validMax: 10000, stateType: null, aliases: [] },
  ],
  qualityCodes: [
    { code: 0, meaning: "정상", includedInAggregates: true },
    { code: 2, meaning: "미검증", includedInAggregates: false },
  ],
  aggregations: [{ key: "avg", description: "평균" }],
  spaces: [
    { id: "1", parentId: null, type: "SITE", name: "광주캠퍼스", code: null, path: "1" },
    { id: "31", parentId: "1", type: "ROOM", name: "실습실", code: null, path: "1.31" },
  ],
};

const STORAGE = {
  dbSizeBytes: 41_015_000_000,
  tables: [
    { schema: "data2flow_pipeline", table: "telemetry", bytes: 30_000_000_000, rows: 900_000_000 },
    { schema: "data2flow_core", table: "audit_logs", bytes: 1_000_000_000, rows: 1_000_000 },
  ],
  dailyGrowthBytes: [
    { day: "2026-10-02", bytes: 40_000_000_000, growthBytes: null },
    { day: "2026-10-03", bytes: 41_015_000_000, growthBytes: 1_015_000_000 },
  ],
  diskFreePercent: 19,
  diskCapacityBytes: 214_748_364_800,
  checkedAt: NOW,
};

export const EXPORT_CSV = "\uFEFFtime,device_id,device_name,space_path,metric,value,unit,quality\n2025-10-04T09:00:00+09:00,1042,AM107-067999,광주캠퍼스/실습실,temperature,22.1,℃,0\n";

export const dataHandler: CoreHandler = (core, { method, path, url, body, can }) => {
  const s = dataState(core);
  const b = (body ?? {}) as Record<string, unknown>;

  // 내보내기(API-TSD-20~22) — TS_EXPORT
  if (path === "/exports" || path.startsWith("/exports/")) {
    if (!can("TS_EXPORT")) return fail(403, "PERMISSION_DENIED");
    if (path === "/exports" && method === "GET") return list(s.exports, url);
    if (path === "/exports" && method === "POST") {
      const q = (b.query ?? {}) as { series?: unknown[]; from?: string; to?: string };
      if (!q.series?.length) return fail(400, "INVALID_REQUEST");
      if (s.exports.filter((e) => e.status === "QUEUED" || e.status === "RUNNING").length >= 3) return fail(429, "EXPORT_LIMIT_EXCEEDED");
      const id = String(++s.seq);
      const days = (Date.parse(q.to ?? NOW) - Date.parse(q.from ?? NOW)) / 86_400_000;
      if (days <= 31) return ok({ mode: "SYNC", jobId: id, downloadUrl: `/api/v1/core/exports/${id}/file?expires=1760000000&signature=cd`, estimatedRows: 48 });
      s.exports.unshift({ id, status: "QUEUED", format: b.format ?? "CSV", query: q, rows: null, bytes: null, dictionaryVersion: 4, expiresAt: null, downloadUrl: null, error: null, requestedBy: "7", scheduleId: null, estimatedRows: 1_576_800, createdAt: NOW, finishedAt: null });
      return ok({ mode: "ASYNC", jobId: id, downloadUrl: null, estimatedRows: 1_576_800 }, 202, { Location: `/api/v1/core/exports/${id}` });
    }
    const file = /^\/exports\/(\d+)\/file$/.exec(path);
    if (file && method === "GET") {
      if (!url.searchParams.get("signature")) return fail(404, "EXPORT_NOT_FOUND");
      return new HttpResponse(EXPORT_CSV, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="export-${file[1]}.csv"` } });
    }
    const cancel = /^\/exports\/(\d+)\/cancel$/.exec(path);
    if (cancel && method === "POST") {
      const job = s.exports.find((e) => e.id === cancel[1]);
      if (!job) return fail(404, "EXPORT_NOT_FOUND");
      job.status = "CANCELLED";
      return ok(job);
    }
    const one = /^\/exports\/(\d+)$/.exec(path);
    if (one && method === "GET") {
      const job = s.exports.find((e) => e.id === one[1]);
      return job ? ok(job) : fail(404, "EXPORT_NOT_FOUND");
    }
  }

  // 정기 내보내기(API-TSD-23·56) — TS_EXPORT
  if (path === "/export-schedules" || path.startsWith("/export-schedules/")) {
    if (!can("TS_EXPORT")) return fail(403, "PERMISSION_DENIED");
    if (path === "/export-schedules" && method === "GET") return list(s.schedules, url);
    if (path === "/export-schedules/test-target" && method === "POST") return ok({ ok: true, steps: [{ name: "CONNECT", ok: true, detail: null }, { name: "WRITE", ok: true, detail: null }, { name: "DELETE", ok: true, detail: null }] });
    if (path === "/export-schedules" && method === "POST") {
      const created = { ...b, id: String(++s.seq), lastStatus: null, version: 0, credentialConfigured: Boolean(b.credential) };
      s.schedules.push(created);
      return ok(created, 201);
    }
    const one = /^\/export-schedules\/(\d+)$/.exec(path);
    const schedule = one ? s.schedules.find((x) => x.id === one[1]) : undefined;
    if (one && !schedule) return fail(404, "RESOURCE_NOT_FOUND");
    if (schedule && method === "PATCH") {
      if (b.baseVersion !== schedule.version) return fail(409, "VERSION_CONFLICT");
      Object.assign(schedule, b, { version: Number(schedule.version) + 1 });
      delete schedule.baseVersion;
      return ok(schedule);
    }
    if (schedule && method === "DELETE") {
      s.schedules.splice(s.schedules.indexOf(schedule), 1);
      return noContent();
    }
  }

  // 데이터 사전(API-TSD-59) — TS_READ
  if (path === "/data-dictionary" && method === "GET") {
    if (!can("TS_READ")) return fail(403, "PERMISSION_DENIED");
    if (url.searchParams.get("format") === "html") return new HttpResponse("<!doctype html><html><body><h1>데이터 사전 v4</h1></body></html>", { headers: { "Content-Type": "text/html; charset=utf-8" } });
    return ok(DICTIONARY);
  }

  // 가져오기(API-TSD-30~32) — TS_IMPORT
  if (path === "/imports" || path.startsWith("/imports/")) {
    if (!can("TS_IMPORT")) return fail(403, "PERMISSION_DENIED");
    if (path === "/imports" && method === "GET") return list(s.imports, url);
    if (path === "/imports" && method === "POST") {
      const job = { id: String(++s.seq), sourceKind: body ? "INFLUXDB" : "CSV", status: "QUEUED", dryRun: true, total: null, inserted: 0, skippedDuplicate: 0, failed: 0, originLabel: (b.originLabel as string) ?? "CSV", sample: [], createdAt: NOW };
      s.imports.unshift(job);
      return ok(job, 202, { Location: `/api/v1/core/imports/${job.id}` });
    }
    const errors = /^\/imports\/(\d+)\/errors$/.exec(path);
    if (errors && method === "GET") return list([{ lineOrPoint: "24e124136d389818", errorCode: "DEVICE_NOT_MAPPED", message: "매핑 안 된 기기" }], url);
    const run = /^\/imports\/(\d+)\/run$/.exec(path);
    if (run && method === "POST") {
      const job = s.imports.find((x) => x.id === run[1]);
      if (!job) return fail(404, "IMPORT_NOT_FOUND");
      if (job.status !== "DRY_RUN_DONE") return fail(409, "IMPORT_STATE_CONFLICT");
      Object.assign(job, { status: "RUNNING", dryRun: false });
      return ok(job, 202);
    }
    const one = /^\/imports\/(\d+)$/.exec(path);
    if (one && method === "GET") {
      const job = s.imports.find((x) => x.id === one[1]);
      return job ? ok(job) : fail(404, "IMPORT_NOT_FOUND");
    }
  }

  // 보관 정책·저장 현황·장기 보관 파일(API-TSD-40~43·33) — TS_POLICY
  if (path.startsWith("/retention-policies") || path === "/storage-stats" || path.startsWith("/archives")) {
    if (!can("TS_POLICY")) return fail(403, "PERMISSION_DENIED");
    if (path === "/retention-policies" && method === "GET") return ok({ effective: s.effective, version: 1 });
    if (path === "/retention-policies/preview" && method === "POST") {
      const items = (b.items ?? []) as { scope: string; scopeRef?: string; dataClass: string; retainDays: number }[];
      const shortened = items.filter((i) => {
        const before = s.effective.find((e) => e.scope === i.scope && (e.scopeRef ?? null) === (i.scopeRef ?? null) && e.dataClass === i.dataClass);
        const old = Number(before?.retainDays ?? 365);
        return i.retainDays !== 0 && (old === 0 || i.retainDays < old);
      });
      return ok({ affectedRows: shortened.length * 1_200_000, affectedBytes: shortened.length * 188_743_680, byMetric: shortened.map((i) => ({ scope: i.scope, scopeRef: i.scopeRef ?? null, dataClass: i.dataClass, rows: 1_200_000, bytes: 188_743_680 })), shortened: shortened.length > 0, confirmToken: shortened.length ? "1760000000.0123456789abcdef0123456789abcdef01234567" : null, expiresAt: null });
    }
    if (path === "/retention-policies" && method === "PUT") {
      const items = (b.items ?? []) as Record<string, unknown>[];
      if (items.some((i) => Number(i.retainDays) > 3650)) return fail(400, "RETENTION_INVALID");
      s.effective = items.map((i) => ({ ...i, minDays: 7, inherited: false, version: 1 }));
      return ok({ effective: s.effective, version: 2, appliesAt: "2026-10-05T02:00:00Z" });
    }
    if (path === "/storage-stats" && method === "GET") return ok({ partitions: [{ table: "telemetry", name: "telemetry_p2026_10", range: { from: "2026-10-01T00:00:00Z", to: "2026-11-01T00:00:00Z" }, state: "ACTIVE", rows: 1_200_000, bytes: 188_743_680, compressionRatio: null }], totalBytes: 188_743_680 });
    if (path === "/archives" && method === "GET") return list([{ id: "1", dataClass: "TELEMETRY", rangeFrom: "2025-09-01T00:00:00Z", rangeTo: "2025-10-01T00:00:00Z", objectKey: "org-1/telemetry/2025-09.parquet", format: "PARQUET", rowsCount: 3_000_000, bytes: 52_428_800, checksum: "ab", restoredJobId: null, createdAt: "2025-10-02T02:00:00Z" }], url);
  }

  // 저장 지표(API-OPS-03) — OPS_MANAGE
  if (path === "/ops/metrics/storage" && method === "GET") {
    if (!can("OPS_MANAGE")) return fail(403, "PERMISSION_DENIED");
    return ok(STORAGE);
  }
  return undefined;
};
