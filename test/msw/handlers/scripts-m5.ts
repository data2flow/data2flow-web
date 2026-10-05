/**
 * M5 스크립트·수집 가짜 API(core ScriptM5Controller·IngestController·IngestInsightController 모양):
 * 테스트 케이스 API-SCR-10·11, 운영 API-SCR-12~14·22, 공유 모듈 API-SCR-18·19, 수식 항목 API-SCR-20·21,
 * 재처리 API-ING-09·10·12·14, 품질 API-ING-13 + quality/summary·trend. 상태는 core.extra["m5.scripts"].
 */
import { fail, list, noContent, ok, type CoreHandler, type CoreState } from "../core-fixtures";

interface M5State {
  cases: Map<string, Record<string, unknown>[]>;
  modules: { id: string; name: string; description: string | null; draftCode: string; versions: { versionNo: number; status: string; releasedAt: string }[] }[];
  formulas: Record<string, unknown>[];
  jobs: Record<string, unknown>[];
  config: Record<string, unknown>;
  configVersion: number;
  logUntil: string | null;
  received: { path: string; method: string; body: unknown; headers: Record<string, string> }[];
}

export function m5State(core: CoreState): M5State {
  const key = "m5.scripts";
  if (!core.extra[key]) {
    core.extra[key] = {
      cases: new Map([["501", [{ id: "1", name: "기본 업링크", input: { metrics: [{ key: "temperature", value: 22 }] }, context: null, expected: { metrics: [{ key: "temperature", value: 22.5 }] }, compareMode: "TOLERANCE", compareFields: null, tolerance: 0.01, lastResult: { passed: true, at: "2026-10-03T00:00:00Z" }, updatedAt: "2026-10-03T00:00:00Z" }]]]),
      modules: [{ id: "3", name: "milesight-channels", description: "채널 파서", draftCode: "export function parseChannels(bytes) { return []; }\n", versions: [{ versionNo: 1, status: "RELEASED", releasedAt: "2026-10-01T00:00:00Z" }] }],
      formulas: [{ id: "41", resultKey: "thi", displayName: "불쾌지수", unit: null, expression: "thi(temperature, humidity)", targetType: "MODEL", targetId: "11", targetName: "EM300-TH", status: "ACTIVE", version: 1, updatedAt: "2026-10-03T00:00:00Z" }],
      jobs: [{ jobId: "12", sourceId: "7", sourceName: "chirpstack-s3", deviceIds: [], from: "2026-09-26T00:00:00Z", to: "2026-10-03T00:00:00Z", status: "RUNNING", total: 102330, processed: 64401, failed: 0, skipped: 0, progressPercent: 62.9, onlyFailed: false, requestedBy: "8", requestedByName: "이통합", memo: "보정 v4", error: null, createdAt: "2026-10-03T23:00:00Z", startedAt: "2026-10-03T23:00:01Z", finishedAt: null }],
      config: { tempOffset: -0.5 },
      configVersion: 7,
      logUntil: null,
      received: [],
    } satisfies M5State;
  }
  return core.extra[key] as M5State;
}

const QUALITY = [
  { targetId: "2", targetName: "EM320-TH-389818", score: 88, completeness: 97, timeliness: 99, validity: 100, stability: 80, gaps: 0, clockSkewSuspect: false, evidence: { expected: 1440, received: 1400, late: 2, outOfRange: 0, suspect: 0 } },
  { targetId: "1", targetName: "AM103-081175", score: 41, completeness: 55, timeliness: 98, validity: 100, stability: 60, gaps: 3, clockSkewSuspect: false, evidence: { expected: 1440, received: 790, late: 0, outOfRange: 0, suspect: 12 } },
];

export const scriptsM5Handler: CoreHandler = (core, { method, path, url, body, can, request }) => {
  const m = /^\/scripts\/([^/]+)\/(test-cases|stats|errors|log-capture|logs|config)(?:\/([^/]+))?$/.exec(path);
  const isModules = path.startsWith("/script-modules");
  const isFormulas = path.startsWith("/formula-metrics");
  const isReprocess = path.startsWith("/ingest/reprocess-jobs");
  const isQuality = path.startsWith("/ingest/quality");
  if (!m && !isModules && !isFormulas && !isReprocess && !isQuality) return undefined;
  const state = m5State(core);
  state.received.push({ path, method, body, headers: Object.fromEntries(request.headers) });
  const b = (body ?? {}) as Record<string, unknown>;
  const write = (perm = "SCRIPT_WRITE") => (can(perm) ? undefined : fail(403, "PERMISSION_DENIED"));

  if (m) {
    if (!can("SCRIPT_READ")) return fail(403, "PERMISSION_DENIED");
    const [, scriptId, kind, sub] = m;
    const cases = state.cases.get(scriptId) ?? [];
    if (kind === "test-cases") {
      if (method === "GET" && !sub) return list(cases, new URL("http://x/?size=100"));
      const denied = write();
      if (denied) return denied;
      if (method === "POST" && sub === "run") {
        const results = cases.map((c, i) => ({ caseId: c.id, name: c.name, passed: i === 0, diff: i === 0 ? null : { changed: [{ key: "temperature", expected: 85, actual: 85.5 }] }, durationMs: 0.3 }));
        return ok({ passed: results.filter((r) => r.passed).length, failed: results.filter((r) => !r.passed).length, results });
      }
      if (method === "POST" && !sub) {
        if (cases.some((c) => c.name === b.name)) return fail(400, "INVALID_REQUEST", { errors: [{ field: "name", code: "Duplicated", message: "" }] });
        if (cases.length >= 50) return fail(409, "SCRIPT_QUOTA_EXCEEDED");
        const created = { id: core.nextId(), ...b, lastResult: null, updatedAt: "2026-10-04T00:00:00Z" };
        state.cases.set(scriptId, [...cases, created]);
        return ok(created, 201, { Location: `/api/v1/core/scripts/${scriptId}/test-cases/${created.id}` });
      }
      if (method === "PUT" && sub) return ok({ id: sub, ...b });
      if (method === "DELETE" && sub) {
        state.cases.set(scriptId, cases.filter((c) => c.id !== sub));
        return noContent();
      }
    }
    if (kind === "stats" && method === "GET") {
      return ok({
        points: [
          { t: "2026-10-03T23:00:00Z", versionNo: 4, processed: 1000, errors: 2, timeouts: 0, avgMs: 0.4, p95Ms: 1.1 },
          { t: "2026-10-03T23:30:00Z", versionNo: 5, processed: 800, errors: 0, timeouts: 0, avgMs: 9, p95Ms: 25 },
        ],
        warnings: [{ type: "SLOW", value: 25, hints: ["LARGE_INPUT"] }],
        deployMarks: [{ versionNo: 5, at: "2026-10-03T23:15:00Z" }],
      });
    }
    if (kind === "errors" && method === "GET") {
      return list([{ id: "e1", occurredAt: "2026-10-03T23:41:02Z", versionNo: 4, errorCode: "SCRIPT_RUNTIME_ERROR", message: "x is undefined", line: 7, col: 12, deviceId: "11", ...(can("SCRIPT_WRITE") ? { inputSnapshot: { metrics: [] } } : {}) }], url);
    }
    if (kind === "log-capture" && method === "POST") {
      const denied = write();
      if (denied) return denied;
      state.logUntil = b.enabled ? "2026-10-04T00:30:00Z" : null;
      return ok({ enabled: Boolean(b.enabled), until: state.logUntil });
    }
    if (kind === "logs" && method === "GET") return list([{ at: "2026-10-03T23:59:00Z", versionNo: 5, deviceId: "11", message: "offset -0.5" }], url);
    if (kind === "config" && method === "PUT") {
      const denied = write();
      if (denied) return denied;
      if (b.baseVersion !== state.configVersion) return fail(409, "SCRIPT_VERSION_CONFLICT");
      const config = (b.config ?? {}) as Record<string, unknown>;
      if (Object.keys(config).some((k) => /token|password|secret|_key$/i.test(k))) return fail(400, "SCRIPT_CONFIG_SECRET_FORBIDDEN");
      state.config = config;
      state.configVersion += 1;
      return ok({ scriptId, config, version: state.configVersion, configRevision: state.configVersion });
    }
    return fail(404, "RESOURCE_NOT_FOUND");
  }

  if (isModules) {
    if (!can("SCRIPT_READ")) return fail(403, "PERMISSION_DENIED");
    const mm = /^\/script-modules(?:\/([^/]+))?(?:\/(usage|release|versions)(?:\/(\d+))?)?$/.exec(path);
    const [, id, action, versionNo] = mm ?? [];
    const found = state.modules.find((x) => x.id === id);
    const detail = (x: M5State["modules"][number]) => ({ id: x.id, name: x.name, description: x.description, draftCode: x.draftCode, latestVersionNo: x.versions[0]?.versionNo ?? null, versions: x.versions, updatedAt: "2026-10-03T00:00:00Z" });
    if (!id && method === "GET") return list(state.modules.map((x) => ({ id: x.id, name: x.name, description: x.description, latestVersionNo: x.versions[0]?.versionNo ?? null, usedBy: 2, updatedAt: "2026-10-03T00:00:00Z" })), url);
    if (!id && method === "POST") {
      const denied = write();
      if (denied) return denied;
      if (!/^[a-z0-9-]{3,40}$/.test(String(b.name)) || state.modules.some((x) => x.name === b.name)) return fail(400, "INVALID_REQUEST", { errors: [{ field: "name", code: "Pattern", message: "" }] });
      const created = { id: core.nextId(), name: String(b.name), description: (b.description as string) ?? null, draftCode: String(b.code ?? ""), versions: [] };
      state.modules.push(created);
      return ok(detail(created), 201);
    }
    if (!found) return fail(404, "RESOURCE_NOT_FOUND");
    if (!action && method === "GET") return ok(detail(found));
    if (action === "usage") return ok({ moduleId: found.id, scripts: [{ scriptId: "501", scriptName: "온도 보정 오프셋", versionNo: 1 }] });
    const denied = write();
    if (denied) return denied;
    if (!action && method === "PUT") {
      found.draftCode = String(b.code ?? "");
      found.description = (b.description as string) ?? null;
      return ok(detail(found));
    }
    if (action === "release" && method === "POST") {
      const next = (found.versions[0]?.versionNo ?? 0) + 1;
      found.versions.unshift({ versionNo: next, status: "RELEASED", releasedAt: "2026-10-04T00:00:00Z" });
      return ok({ moduleId: found.id, versionNo: next, releasedAt: "2026-10-04T00:00:00Z" }, 201);
    }
    if (action === "versions" && method === "DELETE") {
      if (versionNo === "1") return fail(409, "SCRIPT_MODULE_IN_USE");
      found.versions = found.versions.filter((v) => String(v.versionNo) !== versionNo);
      return noContent();
    }
    return fail(404, "RESOURCE_NOT_FOUND");
  }

  if (isFormulas) {
    if (!can("SCRIPT_READ")) return fail(403, "PERMISSION_DENIED");
    if (path === "/formula-metrics" && method === "GET") return list(state.formulas, url);
    const denied = write();
    if (denied) return denied;
    if (path === "/formula-metrics/preview" && method === "POST") {
      if (/temprature/.test(String(b.expression))) return fail(400, "SCRIPT_FORMULA_INVALID");
      return ok({ series: [{ t: "2026-10-03T23:00:00Z", value: 71.2 }], inputs: { temperature: [{ t: "2026-10-03T23:00:00Z", value: 27 }] } });
    }
    if (path === "/formula-metrics" && method === "POST") {
      if (["temperature", "humidity", "co2"].includes(String(b.resultKey)) || state.formulas.some((f) => f.resultKey === b.resultKey)) return fail(409, "SCRIPT_FORMULA_KEY_CONFLICT");
      const created = { id: core.nextId(), ...b, targetName: "EM300-TH", version: 1, updatedAt: "2026-10-04T00:00:00Z" };
      state.formulas.push(created);
      return ok(created, 201, { Location: `/api/v1/core/formula-metrics/${created.id}` });
    }
    const id = path.split("/")[2];
    if (method === "DELETE") {
      state.formulas = state.formulas.filter((f) => f.id !== id);
      return noContent();
    }
    if (method === "PUT") return ok({ id, ...b, version: 2 });
    return fail(404, "RESOURCE_NOT_FOUND");
  }

  if (isReprocess) {
    if (!can("INGEST_REPROCESS")) return fail(403, "PERMISSION_DENIED");
    if (path === "/ingest/reprocess-jobs" && method === "GET") return list(state.jobs, url);
    if (path === "/ingest/reprocess-jobs/preview" && method === "POST") {
      return ok({ total: 102330, byStatus: { OK: 102000, SCRIPT_ERROR: 330 }, estimatedSeconds: 361, decoder: { key: "chirpstack-v4", version: "1" }, scripts: [{ scope: "model:EM300-TH", scriptId: "501", name: "온도 보정 오프셋", version: 5 }] });
    }
    if (path === "/ingest/reprocess-jobs" && method === "POST") {
      if (!request.headers.get("Idempotency-Key")) return fail(400, "INVALID_REQUEST");
      if (state.jobs.some((j) => j.sourceId === String(b.sourceId) && j.status === "RUNNING")) return fail(409, "ING_REPROCESS_ALREADY_RUNNING");
      const jobId = core.nextId();
      state.jobs.unshift({ jobId, sourceId: String(b.sourceId), status: "PENDING", total: 500, processed: 0, failed: 0, from: b.from, to: b.to, memo: b.memo ?? null });
      return ok({ jobId, status: "PENDING", total: 500 }, 202, { Location: `/api/v1/core/ingest/reprocess-jobs/${jobId}` });
    }
    const cancel = /^\/ingest\/reprocess-jobs\/([^/]+)\/cancel$/.exec(path);
    if (cancel && method === "POST") {
      const job = state.jobs.find((j) => j.jobId === cancel[1]);
      if (!job) return fail(404, "RESOURCE_NOT_FOUND");
      if (job.status !== "RUNNING" && job.status !== "PENDING") return fail(409, "ING_REPROCESS_NOT_CANCELLABLE");
      job.status = "CANCELLED";
      return ok({ jobId: job.jobId, status: "CANCELLED", processed: job.processed });
    }
    return fail(404, "RESOURCE_NOT_FOUND");
  }

  // 품질(API-ING-13, summary·trend)
  if (!can("INGEST_READ") && !can("ANALYTICS_READ") && !can("ANALYTICS_RUN")) return fail(403, "PERMISSION_DENIED");
  if (path === "/ingest/quality" && method === "GET") {
    if (core.extra["m5.qualityEmpty"]) return list([], url);
    return list(QUALITY, url, { nextCursor: null });
  }
  if (path === "/ingest/quality/summary") return ok({ day: url.searchParams.get("day"), devices: 2, averageScore: 65, bottom10: [QUALITY[1], QUALITY[0]], distribution: { gaps: 30, outOfRange: 0, suspect: 12, late: 2, expected: 2880, received: 2190 } });
  if (path === "/ingest/quality/trend") return ok({ groupBy: url.searchParams.get("groupBy"), targetId: url.searchParams.get("targetId"), from: url.searchParams.get("from"), to: url.searchParams.get("to"), points: [{ day: "2026-10-02", score: 41, completeness: 55, timeliness: 98, validity: 100, stability: 60, devices: 1 }] });
  return fail(404, "RESOURCE_NOT_FOUND");
};
