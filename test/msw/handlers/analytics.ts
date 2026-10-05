/**
 * M6 분석·장기 토큰 가짜 core API(design/api/ANA-api.md §1, IAM-api.md §5): 템플릿 API-ANA-01~05·19, 분석 API-ANA-06~10·13·22,
 * 모델 API-ANA-23, 대시보드 고정 API-DSH-08 pin-analysis, 장기 토큰 API-IAM-40~45. 권한은 core와 같게 검사한다(ANALYTICS_READ·RUN, API_TOKEN_ISSUE, IAM_MANAGE).
 * 상태는 core.extra["m6"]. 응답 모양은 core·analytics 구현 기준(목록 항목에 id·analysisId 함께).
 */
import { fail, list, noContent, ok, type CoreHandler, type CoreState } from "../core-fixtures";

export interface M6State {
  analyses: Record<string, unknown>[];
  runs: Record<string, Record<string, unknown>>;
  tokens: Record<string, unknown>[];
  accounts: Record<string, unknown>[];
  pins: { dashboardId: string; body: unknown }[];
  seq: number;
}

export const M6_TEMPLATES = [
  { key: "comfort-index", version: "1.0.0", name: "쾌적도 분석", kind: "DOMAIN", category: "ENV_QUALITY", summary: "이 공간은 쾌적한가", questions: ["이 공간은 쾌적한가?"], roles: [{ name: "temp", type: "series", min: 1, max: 10, semantic: "temperature", required: true }], requirements: { minPeriodDays: 1 }, fast: true, realtime: false, trainable: false },
  { key: "anomaly-detect", version: "1.2.0", name: "이상 탐지", kind: "GENERAL", category: "GENERAL", summary: "평소와 다른 값이 있었나", questions: ["평소와 다른 값이 있었나?"], roles: [{ name: "target", type: "series", min: 1, max: 50, semantic: null, required: true }], requirements: { minPeriodDays: 7 }, fast: false, realtime: true, trainable: false },
  { key: "sensor-health", version: "1.0.0", name: "센서 건강 진단", kind: "DOMAIN", category: "ASSET_HEALTH", summary: "고장 난 센서가 있나", questions: ["센서 고장이 있나?"], roles: [{ name: "sensors", type: "multi_series", min: 2, max: 50, semantic: null, required: true }], requirements: { minPeriodDays: 7 }, fast: true, realtime: false, trainable: false },
];

export const M6_RESULT = {
  summary: { headline: "최근 14일 중 이상 12건", level: "WARN", metrics: [{ key: "anomalies", label: "이상 건수", value: 12, unit: null, level: "WARN" }] },
  charts: [{ id: "series", type: "line", title: "온도 추이", series: [{ key: "t", label: "온도", data: [["2026-10-02T05:00:00Z", 22.1]] }] }],
  tables: [{ id: "anomalies", title: "이상 목록", columns: [{ key: "time", label: "시각", type: "datetime" }], rows: [{ time: "2026-10-02T05:20:00Z" }] }],
  evidence: { threshold: 3, contributors: [] },
  caveats: ["이상은 평소와 다름이지 잘못됨이 아닙니다"],
  provenance: { template: "anomaly-detect@1.2.0", points: 40320, missingRate: 0.01, qualityFilter: "NORMAL_ONLY", virtual: false, seed: 1 },
  aiCommentaryId: null,
  expiresAt: "2027-10-04T00:00:00Z",
};

export function m6State(core: CoreState): M6State {
  core.extra.m6 ??= {
    analyses: [
      { analysisId: "17", name: "실습실 온도 이상 탐지", templateKey: "anomaly-detect", templateVersion: "1.2.0", bindings: [], period: { type: "RELATIVE", days: 14 }, resolution: "AUTO", qualityFilter: "NORMAL_ONLY", includeVirtual: false, params: {}, schedule: null, scheduleState: null, realtime: false, owner: { userId: "10", name: "박분석" }, status: "ACTIVE", version: 1, ownerUserId: "10" },
      { analysisId: "18", name: "저장만 한 분석", templateKey: "comfort-index", templateVersion: "1.0.0", owner: { userId: "10", name: "박분석" }, status: "ACTIVE", version: 1, ownerUserId: "10" },
    ],
    runs: {
      "128": { runId: "128", analysisId: "17", status: "SUCCEEDED", trigger: "MANUAL", progress: 100, stage: "SAVE", periodFrom: "2026-09-20T00:00:00Z", periodTo: "2026-10-04T00:00:00Z", startedAt: "2026-10-04T00:00:00Z", finishedAt: "2026-10-04T00:00:12Z" },
      "129": { runId: "129", analysisId: "17", status: "RUNNING", trigger: "MANUAL", progress: 40, stage: "COMPUTE", startedAt: "2026-10-04T00:01:00Z", finishedAt: null },
      "100": { runId: "100", analysisId: "17", status: "SUCCEEDED", expired: true, finishedAt: "2025-09-01T00:00:00Z" },
    },
    tokens: [
      { id: "41", kind: "MCP", name: "노트북 Claude", tokenPrefix: "data2flow_ab12", ownerType: "USER", ownerId: "10", ownerName: "박분석", scopes: ["read:telemetry"], spaceScope: [], status: "ACTIVE", expiresAt: "2027-01-01T23:59:59Z", rateLimitPerMin: 60, lastUsedAt: null, lastUsedIp: null, graceUntil: null, createdAt: "2026-07-01T00:00:00Z" },
      { id: "42", kind: "API_KEY", name: "제어 키", tokenPrefix: "data2flow_cd34", ownerType: "USER", ownerId: "8", ownerName: "이통합", scopes: ["control:devices"], spaceScope: [], status: "PENDING_APPROVAL", expiresAt: "2027-01-01T23:59:59Z", rateLimitPerMin: 600, lastUsedAt: null, lastUsedIp: null, graceUntil: null, createdAt: "2026-10-01T00:00:00Z" },
    ],
    accounts: [{ id: "3", name: "BI 연동", description: null, status: "ACTIVE", tokenCount: 0, version: 0, createdAt: "2026-09-01T00:00:00Z" }],
    pins: [],
    seq: 500,
  } satisfies M6State;
  return core.extra.m6 as M6State;
}

const summary = (a: Record<string, unknown>, runs: Record<string, Record<string, unknown>>) => {
  const last = Object.values(runs).filter((r) => r.analysisId === a.analysisId && !r.expired).sort((x, y) => Number(y.runId) - Number(x.runId))[0];
  return { id: a.analysisId, analysisId: a.analysisId, name: a.name, templateKey: a.templateKey, templateVersion: a.templateVersion, targetSummary: "실습실", lastRun: last ? { id: last.runId, runId: last.runId, status: last.status, finishedAt: last.finishedAt } : null, nextScheduledAt: null, scheduleState: a.scheduleState ?? null, realtime: Boolean(a.realtime), owner: { id: (a.owner as { userId: string }).userId, userId: (a.owner as { userId: string }).userId, name: (a.owner as { name: string }).name } };
};

export const analyticsHandler: CoreHandler = (core, { method, path, url, body, can, user }) => {
  const s = m6State(core);
  const b = (body ?? {}) as Record<string, unknown>;

  if (path.startsWith("/analytics/")) {
    if (!can("ANALYTICS_READ")) return fail(403, "PERMISSION_DENIED");
    const runOnly = !["GET"].includes(method) || /\/check$|\/candidates$/.test(path);
    if (runOnly && !/\/feedback$/.test(path) && !can("ANALYTICS_RUN")) return fail(403, "PERMISSION_DENIED");

    if (path === "/analytics/templates" && method === "GET") {
      const keyword = url.searchParams.get("keyword");
      if (url.searchParams.get("view") === "runnable") return list(M6_TEMPLATES.map((t) => ({ ...t, enabled: true, runnable: t.key !== "sensor-health", missingRoles: t.key === "sensor-health" ? [{ role: "sensors", semantic: null }] : [] })), url);
      if (keyword) return list(M6_TEMPLATES.filter((t) => t.questions.some((q) => q.includes(keyword)) || t.name.includes(keyword)).map((t) => ({ ...t, enabled: true, score: 1, matchedQuestion: t.questions[0], mode: "KEYWORD" })), url);
      return list(M6_TEMPLATES.map((t) => ({ ...t, enabled: true })), url);
    }
    const tmpl = /^\/analytics\/templates\/([a-z0-9-]+)$/.exec(path);
    if (tmpl && method === "GET") {
      const t = M6_TEMPLATES.find((x) => x.key === tmpl[1]);
      if (!t) return fail(404, "TEMPLATE_NOT_FOUND");
      return ok({ ...t, enabled: true, paramsSchema: { type: "object", properties: { sensitivity: { type: "integer", minimum: 1, maximum: 5, default: 3, title: "민감도" } } }, guide: { summary: t.summary, whenToUse: t.questions, howToRead: "빨간 점은 단발 이상입니다" }, versions: [t.version] });
    }
    if (/^\/analytics\/templates\/[a-z0-9-]+\/check$/.test(path) && method === "POST") return ok({ level: "OK", issues: [], stats: { points: 40320 }, limits: { maxPoints: 5_000_000 } });
    if (path === "/analytics/analyses" && method === "GET") {
      const mine = url.searchParams.get("owner") !== "all";
      return list(s.analyses.filter((a) => !mine || a.ownerUserId === user.id).map((a) => summary(a, s.runs)), url);
    }
    if (path === "/analytics/analyses" && method === "POST") {
      const id = String(++s.seq);
      const created = { ...b, analysisId: id, owner: { userId: user.id, name: user.name }, ownerUserId: user.id, status: "ACTIVE", version: 0 };
      s.analyses.push(created);
      return ok(created, 201, { Location: `/api/v1/core/analytics/analyses/${id}` });
    }
    const one = /^\/analytics\/analyses\/(\d+)$/.exec(path);
    if (one) {
      const a = s.analyses.find((x) => x.analysisId === one[1]);
      if (!a) return fail(404, "ANALYSIS_NOT_FOUND");
      if (method === "GET") return ok(a);
      if (method === "DELETE") {
        s.analyses = s.analyses.filter((x) => x !== a);
        return noContent();
      }
    }
    const runs = /^\/analytics\/analyses\/(\d+)\/runs$/.exec(path);
    if (runs && method === "GET") return list(Object.values(s.runs).filter((r) => r.analysisId === runs[1] && !r.expired).sort((x, y) => Number(y.runId) - Number(x.runId)), url);
    if (runs && method === "POST") {
      const id = String(++s.seq);
      s.runs[id] = { runId: id, analysisId: runs[1], status: "QUEUED", trigger: "MANUAL", progress: 0, queuePosition: 1 };
      return ok({ runId: id, status: "QUEUED", queuePosition: 1 }, 202);
    }
    const run = /^\/analytics\/analyses\/(\d+)\/runs\/(\d+)$/.exec(path);
    if (run && method === "GET") {
      const r = s.runs[run[2]];
      if (!r || r.analysisId !== run[1]) return fail(404, "ANALYSIS_RUN_NOT_FOUND");
      if (r.expired) return fail(404, "ANALYSIS_RUN_NOT_FOUND", { response: { resultExpired: true, run: { runId: r.runId, status: r.status, finishedAt: r.finishedAt } } });
      return ok({ run: r, result: r.status === "SUCCEEDED" ? M6_RESULT : null });
    }
    if (path === "/analytics/models" && method === "GET") return list([{ modelId: "301", analysisId: "17", analysisName: "실습실 온도 이상 탐지", templateKey: "anomaly-detect", version: 1, status: "ACTIVE", metrics: { mae: 0.4 }, trainedAt: "2026-10-01T00:00:00Z" }], url);
    return fail(404, "RESOURCE_NOT_FOUND");
  }

  const pin = /^\/dashboards\/(\d+)\/widgets\/pin-analysis$/.exec(path);
  if (pin && method === "POST") {
    if (!can("ANALYTICS_RUN") || !can("DASHBOARD_WRITE")) return fail(403, "PERMISSION_DENIED");
    if (!s.analyses.some((a) => a.analysisId === b.analysisId)) return fail(404, "ANALYSIS_NOT_FOUND");
    s.pins.push({ dashboardId: pin[1], body });
    return ok({ dashboardId: pin[1], widgetId: `analysis-${b.analysisId}`, version: 2 });
  }

  // 장기 토큰·서비스 계정(API-IAM-40~45)
  if (path === "/api-tokens" && method === "GET") {
    const all = url.searchParams.get("owner") === "all";
    if (all && !can("IAM_MANAGE")) return fail(403, "PERMISSION_DENIED");
    const kind = url.searchParams.get("kind");
    const status = url.searchParams.get("status");
    return list(s.tokens.filter((t) => (all || t.ownerId === user.id) && (!kind || t.kind === kind) && (!status || t.status === status)), url);
  }
  if (path === "/api-tokens" && method === "POST") {
    const scopes = (b.scopes as string[]) ?? [];
    const write = scopes.some((x) => ["write:devices", "control:devices", "mcp:write"].includes(x));
    if (write && !["ADMIN", "INTEGRATOR"].includes(user.role)) return fail(400, "API_TOKEN_SCOPE_EXCEEDED");
    if (!can("API_TOKEN_ISSUE")) return fail(403, "PERMISSION_DENIED");
    const id = String(++s.seq);
    const status = write && user.role !== "ADMIN" ? "PENDING_APPROVAL" : "ACTIVE";
    s.tokens.push({ id, kind: b.kind, name: b.name, tokenPrefix: "data2flow_new0", ownerType: "USER", ownerId: user.id, ownerName: user.name, scopes, spaceScope: b.spaceScope ?? [], status, expiresAt: b.expiresAt, rateLimitPerMin: 60, lastUsedAt: null, lastUsedIp: null, graceUntil: null, createdAt: "2026-10-04T00:00:00Z" });
    return ok({ id, token: `data2flow_raw${id}SECRET`, prefix: "data2flow_new0", status }, 201, { Location: `/api/v1/core/api-tokens/${id}`, "Cache-Control": "no-store" });
  }
  const decide = /^\/api-tokens\/(\d+)\/(approve|reject)$/.exec(path);
  if (decide && method === "POST") {
    if (!can("IAM_MANAGE")) return fail(403, "PERMISSION_DENIED");
    const t = s.tokens.find((x) => x.id === decide[1]);
    if (!t) return fail(404, "API_TOKEN_NOT_FOUND");
    t.status = decide[2] === "approve" ? "ACTIVE" : "REJECTED";
    return noContent();
  }
  if (path === "/service-accounts" && (method === "GET" || method === "POST")) {
    if (!can("IAM_MANAGE")) return fail(403, "PERMISSION_DENIED");
    if (method === "GET") return list(s.accounts, url);
    const id = String(++s.seq);
    const account = { id, name: b.name, description: b.description ?? null, status: "ACTIVE", tokenCount: 0, version: 0, createdAt: "2026-10-04T00:00:00Z" };
    s.accounts.push(account);
    return ok(account, 201);
  }
  return undefined;
};
