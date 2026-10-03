/**
 * 가짜 기기 모델·측정 항목·별칭 API(design/api/DEV-api.md §4·§5, API-DEV-40~47·50~56). 쓰기는 DEV_ADMIN만.
 */
import { fail, list, noContent, ok, type CoreHandler, type CoreState, type FakeMetric, type FakeModel } from "../core-fixtures";

interface ModelExtra {
  aliases: { id: string; alias: string; metricKey: string; metricId: string; createdAt: string }[];
  jobs: Map<string, { status: string; processed: number; total: number; polls: number }>;
  packages: Map<string, Record<string, unknown>>;
}

function extra(core: CoreState): ModelExtra {
  core.extra.models ??= { aliases: [{ id: "201", alias: "temp", metricKey: "temperature", metricId: "101", createdAt: "2026-10-01T00:00:00Z" }], jobs: new Map(), packages: new Map() } satisfies ModelExtra;
  return core.extra.models as ModelExtra;
}

function modelView(core: CoreState, m: FakeModel) {
  const pkg = extra(core).packages.get(m.id) ?? {};
  return {
    ...m,
    description: m.description ?? null,
    imageUrl: null,
    defaultOfflineMultiplier: 3,
    package: { transformScriptId: null, decodeScriptId: null, driverKey: null, defaultDashboardId: null, defaultRuleTemplateIds: [], attributeSchema: m.attributeSchema ?? null, ...pkg },
    deviceCount: core.devices.filter((d) => d.modelId === m.id).length,
    updatedAt: "2026-10-01T00:00:00Z",
  };
}

function summary(core: CoreState, m: FakeModel) {
  return { id: m.id, code: m.code, vendor: m.vendor, name: m.name, protocol: m.protocol, kind: m.kind, builtin: m.builtin, status: m.status, deviceCount: core.devices.filter((d) => d.modelId === m.id).length, metricCount: m.metrics.length, updatedAt: "2026-10-01T00:00:00Z" };
}

const metricView = (m: FakeMetric) => ({ ...m, enumMap: (m as FakeMetric & { enumMap?: unknown }).enumMap ?? null, stateType: null, semantic: null, updatedAt: "2026-10-01T00:00:00Z" });

export const modelsHandler: CoreHandler = (core, { method, path, url, body, can }) => {
  const write = method !== "GET";
  const isModel = path.startsWith("/device-models");
  const isMetric = path.startsWith("/metrics") || path.startsWith("/metric-aliases") || path.startsWith("/metric-remap-jobs");
  if (!isModel && !isMetric) return undefined;
  if (write && !can("DEV_ADMIN")) return fail(403, "PERMISSION_DENIED");
  const b = (body ?? {}) as Record<string, unknown>;
  const x = extra(core);

  // ---- 모델 ----
  if (path === "/device-models" && method === "GET") {
    const code = url.searchParams.get("code");
    const protocol = url.searchParams.get("protocol");
    const kind = url.searchParams.get("kind");
    const q = url.searchParams.get("q")?.toLowerCase();
    const deprecated = url.searchParams.get("includeDeprecated") === "true" || Boolean(code);
    const items = core.models.filter((m) => (!code || m.code === code) && (!protocol || m.protocol === protocol) && (!kind || m.kind === kind) && (!q || `${m.code} ${m.name} ${m.vendor}`.toLowerCase().includes(q)) && (deprecated || m.status === "ACTIVE"));
    return list(items.map((m) => summary(core, m)), url);
  }
  if (path === "/device-models" && method === "POST") {
    const code = String(b.code ?? "");
    if (!/^[A-Z0-9][A-Z0-9._-]{1,49}$/.test(code)) return fail(400, "INVALID_REQUEST", { errors: [{ field: "code", code: "PATTERN", message: "code" }] });
    if (core.models.some((m) => m.code === code)) return fail(409, "MODEL_CODE_DUPLICATE");
    const metrics = (b.metrics as { key: string; required: boolean }[] | undefined) ?? [];
    const missing = metrics.find((m) => !core.metrics.some((x2) => x2.key === m.key && x2.status === "VERIFIED"));
    if (missing) return fail(400, "METRIC_NOT_FOUND");
    const model: FakeModel = { id: core.nextId(), code, vendor: String(b.vendor ?? ""), name: String(b.name ?? ""), protocol: String(b.protocol ?? "OTHER"), kind: String(b.kind ?? "SENSOR"), defaultIntervalSec: Number(b.defaultIntervalSec ?? 600), builtin: false, status: "ACTIVE", metrics, capabilities: (b.capabilities as FakeModel["capabilities"]) ?? [], description: (b.description as string) ?? null, version: 1 };
    core.models.push(model);
    return ok(modelView(core, model), 201, { Location: `/api/v1/core/device-models/${model.id}` });
  }
  const m1 = /^\/device-models\/([^/]+)(?:\/(clone|deprecate|package))?$/.exec(path);
  if (m1) {
    const model = core.models.find((m) => m.id === m1[1]);
    if (!model) return fail(404, "RESOURCE_NOT_FOUND");
    const sub = m1[2];
    if (!sub && method === "GET") return ok(modelView(core, model));
    if (sub === "clone" && method === "POST") {
      const newCode = String(b.newCode ?? "");
      if (core.models.some((m) => m.code === newCode)) return fail(409, "MODEL_CODE_DUPLICATE");
      const copy: FakeModel = { ...model, id: core.nextId(), code: newCode, name: String(b.name ?? model.name), builtin: false, status: "ACTIVE", version: 1 };
      core.models.push(copy);
      return ok(modelView(core, copy), 201);
    }
    if (model.builtin && (sub === "package" || (!sub && method !== "GET") || sub === "deprecate")) return fail(409, "MODEL_BUILTIN_READONLY");
    if (!sub && method === "PATCH") {
      if (b.baseVersion !== model.version) return fail(409, "VERSION_CONFLICT");
      for (const key of ["vendor", "name", "protocol", "kind", "defaultIntervalSec", "description", "metrics", "capabilities"]) if (key in b) (model as unknown as Record<string, unknown>)[key] = b[key];
      model.version += 1;
      return ok(modelView(core, model));
    }
    if (!sub && method === "DELETE") {
      if (core.devices.some((d) => d.modelId === model.id)) return fail(409, "MODEL_IN_USE");
      core.models.splice(core.models.indexOf(model), 1);
      return noContent();
    }
    if (sub === "deprecate" && method === "POST") {
      model.status = "DEPRECATED";
      model.version += 1;
      return ok(modelView(core, model));
    }
    if (sub === "package" && method === "PUT") {
      model.attributeSchema = b.attributeSchema ?? null;
      const { attributeSchema: _ignored, ...rest } = b;
      void _ignored;
      x.packages.set(model.id, rest);
      model.version += 1;
      return ok({ modelId: model.id, ...rest, attributeSchema: model.attributeSchema, version: model.version });
    }
  }

  // ---- 측정 항목 ----
  if (path === "/metrics" && method === "GET") {
    const status = url.searchParams.get("status");
    const q = url.searchParams.get("q")?.toLowerCase();
    const key = url.searchParams.get("key");
    return list(core.metrics.filter((m) => (!status || m.status === status) && (!key || m.key === key) && (!q || `${m.key} ${m.displayName}`.toLowerCase().includes(q))).map(metricView), url);
  }
  if (path === "/metrics" && method === "POST") {
    const key = String(b.key ?? "");
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(key)) return fail(400, "METRIC_KEY_INVALID");
    if (core.metrics.some((m) => m.key === key) || x.aliases.some((a) => a.alias === key)) return fail(409, "METRIC_KEY_DUPLICATE");
    const metric = { id: core.nextId(), key, displayName: String(b.displayName ?? key), unit: (b.unit as string) ?? null, valueType: (b.valueType as FakeMetric["valueType"]) ?? "NUMBER", validMin: (b.validMin as number) ?? null, validMax: (b.validMax as number) ?? null, precision: (b.precision as number) ?? null, aggDefault: String(b.aggDefault ?? "AVG"), status: "VERIFIED" as const, builtin: false, aliases: [], version: 1, enumMap: b.enumMap ?? null };
    core.metrics.push(metric);
    return ok(metricView(metric), 201);
  }
  const m2 = /^\/metrics\/([^/]+)(?:\/(verify|alias-to|ignore|restore))?$/.exec(path);
  if (m2) {
    const metric = core.metrics.find((m) => m.id === m2[1]);
    if (!metric) return fail(404, "RESOURCE_NOT_FOUND");
    const sub = m2[2];
    if (!sub && method === "PATCH") {
      if (b.baseVersion !== metric.version) return fail(409, "VERSION_CONFLICT");
      for (const key of ["displayName", "unit", "valueType", "enumMap", "validMin", "validMax", "precision", "aggDefault"]) if (key in b) (metric as unknown as Record<string, unknown>)[key] = b[key];
      metric.version += 1;
      return ok(metricView(metric));
    }
    if (sub === "verify") {
      if (metric.status !== "UNVERIFIED") return fail(409, "METRIC_STATE_CONFLICT");
      Object.assign(metric, { displayName: b.displayName ?? metric.displayName, unit: b.unit ?? null, valueType: b.valueType ?? "NUMBER", aggDefault: b.aggDefault ?? "AVG", status: "VERIFIED", version: metric.version + 1 });
      return ok(metricView(metric));
    }
    if (sub === "alias-to") {
      const target = core.metrics.find((m) => m.key === b.targetKey && m.status === "VERIFIED");
      if (!target || metric.status !== "UNVERIFIED") return fail(400, "METRIC_ALIAS_INVALID");
      const alias = { id: core.nextId(), alias: metric.key, metricKey: target.key, metricId: target.id, createdAt: "2026-10-04T00:00:00Z" };
      x.aliases.push(alias);
      target.aliases.push(metric.key);
      core.metrics.splice(core.metrics.indexOf(metric), 1);
      const jobId = b.remapHistory === false ? null : core.nextId();
      if (jobId) x.jobs.set(jobId, { status: "RUNNING", processed: 0, total: 1000, polls: 0 });
      return ok({ alias, remapJobId: jobId });
    }
    if (sub === "ignore") {
      metric.status = "IGNORED";
      metric.version += 1;
      return ok({ id: metric.id, key: metric.key, status: metric.status, version: metric.version });
    }
    if (sub === "restore") {
      metric.status = "UNVERIFIED";
      metric.version += 1;
      return ok({ id: metric.id, key: metric.key, status: metric.status, version: metric.version });
    }
  }
  const job = /^\/metric-remap-jobs\/([^/]+)$/.exec(path);
  if (job && method === "GET") {
    const state = x.jobs.get(job[1]);
    if (!state) return fail(404, "RESOURCE_NOT_FOUND");
    state.polls += 1;
    state.processed = Math.min(state.total, state.polls * 500);
    if (state.processed >= state.total) state.status = "SUCCEEDED";
    return ok({ status: state.status, processed: state.processed, total: state.total });
  }
  if (path === "/metric-aliases" && method === "GET") return list(x.aliases, url);
  if (path === "/metric-aliases" && method === "POST") {
    const alias = String(b.alias ?? "");
    const target = core.metrics.find((m) => m.key === b.metricKey && m.status === "VERIFIED");
    if (!target) return fail(400, "METRIC_ALIAS_INVALID");
    if (core.metrics.some((m) => m.key === alias) || x.aliases.some((a) => a.alias === alias)) return fail(409, "METRIC_KEY_DUPLICATE");
    const row = { id: core.nextId(), alias, metricKey: target.key, metricId: target.id, createdAt: "2026-10-04T00:00:00Z" };
    x.aliases.push(row);
    return ok(row, 201);
  }
  const aliasDelete = /^\/metric-aliases\/([^/]+)$/.exec(path);
  if (aliasDelete && method === "DELETE") {
    x.aliases = x.aliases.filter((a) => a.id !== aliasDelete[1]);
    return noContent();
  }
  return undefined;
};
