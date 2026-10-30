/**
 * 요구사항 시험 화면 보강 가짜 core API: 조직 제어 설정(API-ACT-17, UI-ACT-08), 공백·완전성(API-TSD-09, UI-TSD-06),
 * 분석 템플릿 설정·조직 분석 설정(API-ANA-17·18·25, UI-ANA-07), 데이터셋(API-ANA-20, UI-ANA-09).
 * 모양은 core-api·analytics 구현을 따른다. 상태는 core.extra.requirementScreens. 분석 핸들러보다 먼저 받는다.
 */
import { fail, list, noContent, ok, type CoreHandler, type CoreState } from "../core-fixtures";
import { M6_TEMPLATES, m6State } from "./analytics";

const AT = "2026-10-04T00:00:00Z";

/** 기기 모델이 허용하는 Thermostat.targetTemperature 범위(모든 모델의 교집합) — 이보다 넓은 절대 한계는 LIMIT_WIDER_THAN_MODEL */
export const MODEL_TARGET_TEMPERATURE = { min: 16, max: 30 };

export interface Dataset {
  datasetId: string;
  name: string;
  bindings: unknown[];
  period: unknown;
  qualityFilter: string;
  includeVirtual: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface RequirementScreensState {
  control: Record<string, unknown> & { version: number };
  templateEnabled: Record<string, boolean>;
  resultRetentionDays: number;
  datasets: Dataset[];
  datasetVersions: Record<string, { version: number; bindingCount: number; updatedAt: string }[]>;
  seq: number;
  bodies: { path: string; body: unknown }[];
}

const BINDINGS = [{ role: "target", sources: [{ kind: "DEVICE_METRIC", deviceId: "1042", metricKey: "temperature", label: "AM107 · 온도" }] }];

export function requirementScreensState(core: CoreState): RequirementScreensState {
  if (core.extra.requirementScreens) return core.extra.requirementScreens as RequirementScreensState;
  // 분석 17은 데이터셋 61의 이전 버전(1)을 쓴다 — [최신 버전으로 올리기] 대상
  const a17 = m6State(core).analyses.find((a) => a.analysisId === "17");
  if (a17) Object.assign(a17, { datasetId: "61", datasetVersion: 1 });
  core.extra.requirementScreens = {
    control: {
      absoluteLimits: { Thermostat: { targetTemperature: { min: 18, max: 28 } } },
      manualOverrideMinutes: 30,
      minIntervalSec: 10,
      oscillation: { windowSec: 60, flips: 3 },
      defaultValiditySec: 600,
      scheduleRespectsManualOverride: true,
      requireApprovalForControlNodes: false,
      version: 2,
      updatedBy: { userId: "1", name: "관리자" },
      updatedAt: AT,
    },
    templateEnabled: {},
    resultRetentionDays: 365,
    datasets: [{ datasetId: "61", name: "실습실 온도", bindings: BINDINGS, period: { type: "RELATIVE", days: 14 }, qualityFilter: "NORMAL_ONLY", includeVirtual: false, version: 2, createdAt: "2026-09-01T00:00:00Z", updatedAt: AT }],
    datasetVersions: {
      "61": [
        { version: 2, bindingCount: 1, updatedAt: AT },
        { version: 1, bindingCount: 1, updatedAt: "2026-09-01T00:00:00Z" },
      ],
    },
    seq: 700,
    bodies: [],
  } satisfies RequirementScreensState;
  return core.extra.requirementScreens as RequirementScreensState;
}

const PATHS = /^\/(settings\/control|telemetry\/gaps|analytics\/(template-settings|settings|datasets))(\/|$)|^\/analytics\/analyses\/[^/]+$/;

export const requirementScreensHandler: CoreHandler = (core, { method, path, url, body, can }) => {
  if (!PATHS.test(path)) return undefined;
  const s = requirementScreensState(core);
  const b = (body ?? {}) as Record<string, unknown>;
  if (method !== "GET") s.bodies.push({ path, body });

  // ── API-ACT-17 조직 제어 설정(CONTROL_SETTINGS) ──
  if (path === "/settings/control") {
    if (!can("CONTROL_SETTINGS")) return fail(403, "PERMISSION_DENIED");
    if (method === "GET") return ok(s.control);
    if (method === "PUT") {
      if (b.baseVersion !== s.control.version) return fail(409, "VERSION_CONFLICT");
      const limits = (b.absoluteLimits ?? {}) as Record<string, Record<string, { min?: number; max?: number }>>;
      const t = limits.Thermostat?.targetTemperature;
      if (t && ((t.min ?? MODEL_TARGET_TEMPERATURE.min) < MODEL_TARGET_TEMPERATURE.min || (t.max ?? MODEL_TARGET_TEMPERATURE.max) > MODEL_TARGET_TEMPERATURE.max)) {
        return fail(400, "LIMIT_WIDER_THAN_MODEL", { errors: [{ field: "absoluteLimits.Thermostat.targetTemperature", code: "LIMIT_WIDER_THAN_MODEL", message: "" }] });
      }
      const { baseVersion: _v, ...rest } = b;
      void _v;
      s.control = { ...s.control, ...rest, version: s.control.version + 1, updatedBy: { userId: "1", name: "관리자" }, updatedAt: AT };
      return ok(s.control);
    }
  }

  // ── API-TSD-09 공백·완전성(TS_READ) ──
  if (path === "/telemetry/gaps" && method === "GET") {
    if (!can("TS_READ")) return fail(403, "PERMISSION_DENIED");
    const from = url.searchParams.get("from") ?? "2026-10-03T00:00:00Z";
    const to = url.searchParams.get("to") ?? AT;
    const deviceId = url.searchParams.get("deviceId");
    const spaceId = url.searchParams.get("spaceId");
    const devices = core.devices.filter((d) => (!deviceId || d.id === deviceId) && (!spaceId || d.spaceId === spaceId)).slice(0, 2);
    const gaps = devices[0] ? [{ deviceId: devices[0].id, from: "2026-10-03T02:00:00Z", to: "2026-10-03T03:30:00Z", expectedCount: 9 }, { deviceId: devices[0].id, from: "2026-10-03T10:00:00Z", to: "2026-10-03T10:20:00Z", expectedCount: 2 }] : [];
    return ok({
      from,
      to,
      gaps,
      devices: devices.map((d, i) => (i === 0 ? { deviceId: d.id, deviceName: d.name, intervalSec: 600, expected: 144, missing: 11, completenessPercent: 92.4 } : { deviceId: d.id, deviceName: d.name, intervalSec: 600, expected: 144, missing: 0, completenessPercent: 100 })),
    });
  }

  // ── API-ANA-17·18·25(ADMIN — 가짜는 IAM_MANAGE로 본다) ──
  if (path === "/analytics/template-settings" && method === "GET") {
    if (!can("IAM_MANAGE")) return fail(403, "PERMISSION_DENIED");
    const items = M6_TEMPLATES.map((t) => ({ key: t.key, name: t.name, version: t.version, enabled: s.templateEnabled[t.key] ?? true, analysisCount: t.key === "anomaly-detect" ? 1 : 0, scheduleCount: t.key === "anomaly-detect" ? 2 : 0, realtimeCount: t.key === "anomaly-detect" ? 1 : 0 }));
    return list(items, url);
  }
  const setting = /^\/analytics\/template-settings\/([a-z0-9-]+)$/.exec(path);
  if (setting && method === "PUT") {
    if (!can("IAM_MANAGE")) return fail(403, "PERMISSION_DENIED");
    const t = M6_TEMPLATES.find((x) => x.key === setting[1]);
    if (!t) return fail(404, "TEMPLATE_NOT_FOUND");
    if (typeof b.enabled !== "boolean") return fail(400, "INVALID_REQUEST");
    s.templateEnabled[t.key] = b.enabled;
    return ok({ key: t.key, name: t.name, version: t.version, enabled: b.enabled, analysisCount: 0, scheduleCount: 0, realtimeCount: 0, pausedAnalysisIds: b.enabled ? [] : ["17"] });
  }
  if (path === "/analytics/settings") {
    if (!can("IAM_MANAGE")) return fail(403, "PERMISSION_DENIED");
    if (method === "PUT") {
      const days = b.resultRetentionDays;
      if (typeof days !== "number" || !Number.isInteger(days) || days < 30 || days > 1095) return fail(400, "INVALID_REQUEST", { errors: [{ field: "resultRetentionDays", code: "Range", message: "" }] });
      s.resultRetentionDays = days;
    }
    return ok({ resultRetentionDays: s.resultRetentionDays, updatedBy: null, updatedAt: null });
  }

  // ── API-ANA-20 데이터셋(조회 ANALYTICS_READ, 쓰기 ANALYTICS_RUN) ──
  if (path.startsWith("/analytics/datasets")) {
    if (!can("ANALYTICS_READ")) return fail(403, "PERMISSION_DENIED");
    if (method !== "GET" && !can("ANALYTICS_RUN")) return fail(403, "PERMISSION_DENIED");
    const m6 = m6State(core);
    const usedBy = (id: string) => m6.analyses.filter((a) => a.datasetId === id && a.status === "ACTIVE").length;
    if (path === "/analytics/datasets" && method === "GET") {
      return list(s.datasets.map((d) => ({ datasetId: d.datasetId, name: d.name, bindingCount: d.bindings.length, version: d.version, analysisCount: usedBy(d.datasetId), updatedAt: d.updatedAt })), url);
    }
    if (path === "/analytics/datasets" && method === "POST") {
      const name = String(b.name ?? "").trim();
      if (!name || name.length > 100 || !Array.isArray(b.bindings)) return fail(400, "INVALID_REQUEST");
      const d: Dataset = { datasetId: String(++s.seq), name, bindings: b.bindings, period: b.period, qualityFilter: String(b.qualityFilter ?? "NORMAL_ONLY"), includeVirtual: Boolean(b.includeVirtual), version: 1, createdAt: AT, updatedAt: AT };
      s.datasets.unshift(d);
      s.datasetVersions[d.datasetId] = [{ version: 1, bindingCount: d.bindings.length, updatedAt: AT }];
      return ok(d, 201);
    }
    const one = /^\/analytics\/datasets\/([^/]+)(\/versions|\/analyses\/([^/]+)\/upgrade-dataset)?$/.exec(path);
    const d = one ? s.datasets.find((x) => x.datasetId === one[1]) : undefined;
    if (!one || !d) return fail(404, "DATASET_NOT_FOUND");
    if (one[2] === "/versions" && method === "GET") return list(s.datasetVersions[d.datasetId] ?? [], url);
    if (one[3] && method === "POST") {
      const a = m6.analyses.find((x) => x.analysisId === one[3] && x.datasetId === d.datasetId);
      if (!a) return fail(404, "ANALYSIS_NOT_FOUND");
      a.datasetVersion = d.version;
      return ok({ analysisId: a.analysisId, datasetId: d.datasetId, datasetVersion: d.version });
    }
    if (method === "GET") return ok(d);
    if (method === "PUT") {
      if (b.baseVersion !== d.version) return fail(409, "VERSION_CONFLICT");
      d.name = String(b.name ?? d.name);
      if (Array.isArray(b.bindings)) d.bindings = b.bindings;
      if (b.period) d.period = b.period;
      d.version += 1;
      (s.datasetVersions[d.datasetId] ??= []).unshift({ version: d.version, bindingCount: d.bindings.length, updatedAt: AT });
      return ok(d);
    }
    if (method === "DELETE") {
      if (usedBy(d.datasetId) > 0) return fail(409, "DATASET_IN_USE");
      s.datasets = s.datasets.filter((x) => x !== d);
      return noContent();
    }
  }

  // 분석 상세에 데이터셋 정보(datasetId·datasetVersion·newerDatasetVersion)를 덧붙인다(analytics views.analysis_view)
  const analysis = /^\/analytics\/analyses\/([^/]+)$/.exec(path);
  if (analysis && method === "GET") {
    const a = m6State(core).analyses.find((x) => x.analysisId === analysis[1]);
    const d = a?.datasetId ? s.datasets.find((x) => x.datasetId === a.datasetId) : undefined;
    if (!a || !d || !can("ANALYTICS_READ")) return undefined;
    return ok({ ...a, newerDatasetVersion: d.version !== a.datasetVersion ? d.version : undefined });
  }
  return undefined;
};
