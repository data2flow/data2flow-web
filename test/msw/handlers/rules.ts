/**
 * 규칙·알람·무음·통계 가짜 API(design/api/RUL-api.md API-RUL-01~08·10~14·20·25·27).
 * 상태는 core.extra["rules"]. 테스트는 `rulesState(core)`로 상황(비동기 시뮬레이션, 알람 추가)을 바꾼다.
 * 알림 정책·템플릿·당직(API-RUL-21·22·26)과 채널은 notify 핸들러가 맡는다. 발송 이력(API-RUL-27)은 `alarmId`가 있을 때만 여기서 답한다.
 */
import { HttpResponse } from "msw";
import { fail, list, noContent, ok, type CoreHandler, type CoreRequest, type CoreState } from "../core-fixtures";

type Json = Record<string, unknown>;

export interface FakeRule {
  ruleId: string;
  name: string;
  templateKey: string | null;
  status: "ACTIVE" | "INACTIVE" | "ERROR" | "CONVERTED" | "DELETED";
  errorReason: string | null;
  scope: { type: string; ids: string[]; includeChildren: boolean; targetCount: number };
  condition: Json;
  timeCondition: Json | null;
  severity: string;
  titleTemplate: string;
  autoClear: boolean;
  policyId: string | null;
  flowId: string;
  version: number;
  stats7d: { raised: number };
  openAlarms: number;
  conditionSummary: string;
  updatedBy: { userId: string; name: string };
  updatedAt: string;
}

export interface FakeAlarm extends Json {
  id: string;
  severity: string;
  status: string;
  title: string;
  source: Json;
  raisedAt: string;
}

export interface RulesState {
  seq: number;
  rules: FakeRule[];
  alarms: FakeAlarm[];
  events: Record<string, Json[]>;
  silences: Json[];
  tuning: Json[];
  deliveries: Json[];
  /** 받은 시뮬레이션 요청(본문) */
  simulations: Json[];
}

const by = { userId: "7", name: "김운영" };

function alarm(id: string, extra: Partial<FakeAlarm> & Json): FakeAlarm {
  return {
    id,
    severity: "MAJOR",
    status: "ACTIVE",
    flapping: false,
    title: "고CO2 · 실습실",
    source: { type: "RULE", ruleId: "301" },
    device: { id: "1042", name: "AM107-067999" },
    space: { id: "31", name: "실습실", path: "광주캠퍼스 / 본관 / 3층 / 실습실" },
    metric: "co2",
    triggerValue: 1050,
    peakValue: 1180,
    lastValue: 1120,
    occurrenceCount: 3,
    raisedAt: "2026-10-03T23:05:00Z",
    lastRaisedAt: "2026-10-03T23:09:00Z",
    ackedBy: null,
    ackedAt: null,
    clearedAt: null,
    assignee: null,
    parentAlarmId: null,
    childCount: 0,
    spaceEventId: null,
    suppressedReason: null,
    ...extra,
  };
}

export function rulesState(core: CoreState): RulesState {
  if (!core.extra.rules) {
    const state: RulesState = {
      seq: 500,
      simulations: [],
      rules: [
        {
          ruleId: "301",
          name: "본관 고CO2",
          templateKey: "high-co2",
          status: "ACTIVE",
          errorReason: null,
          scope: { type: "SPACE", ids: ["2"], includeChildren: true, targetCount: 1 },
          condition: { kind: "threshold", metric: "co2", op: ">", value: 1000, for: "PT5M", clear: 900, repeat: 1, aggregate: "perDevice" },
          timeCondition: null,
          severity: "MAJOR",
          titleTemplate: "고CO2 · {{space.path}}",
          autoClear: true,
          policyId: null,
          flowId: "0d6f2b1e-7c4a-4b8e-9f00-000000000301",
          version: 3,
          stats7d: { raised: 14 },
          openAlarms: 2,
          conditionSummary: "co2 > 1000ppm 5분",
          updatedBy: by,
          updatedAt: "2026-10-02T01:00:00Z",
        },
        {
          ruleId: "302",
          name: "야간 문열림",
          templateKey: "door-open-off-hours",
          status: "ERROR",
          errorReason: "NO_TARGET",
          scope: { type: "SPACE", ids: ["32"], includeChildren: true, targetCount: 0 },
          condition: { kind: "threshold", metric: "door", op: "==", value: 1 },
          timeCondition: { days: [1, 2, 3, 4, 5, 6, 7], spaceSchedule: "OUTSIDE" },
          severity: "MAJOR",
          titleTemplate: "운영 시간 외 문 열림",
          autoClear: true,
          policyId: null,
          flowId: "0d6f2b1e-7c4a-4b8e-9f00-000000000302",
          version: 1,
          stats7d: { raised: 0 },
          openAlarms: 0,
          conditionSummary: "door = 1 운영시간 밖",
          updatedBy: { userId: "1", name: "홍길동" },
          updatedAt: "2026-09-30T01:00:00Z",
        },
      ],
      alarms: [
        alarm("9001", {}),
        alarm("9002", { severity: "CRITICAL", title: "게이트웨이 UG65-F5DCCC 오프라인", source: { type: "SYSTEM" }, device: null, metric: null, triggerValue: null, peakValue: null, lastValue: null, occurrenceCount: 1, childCount: 1, raisedAt: "2026-10-03T23:02:00Z" }),
        alarm("9003", { severity: "MINOR", title: "무수신 · EM300", source: { type: "SYSTEM" }, parentAlarmId: "9002", status: "SUPPRESSED", suppressedReason: "PARENT", raisedAt: "2026-10-03T23:03:00Z" }),
        alarm("9004", { severity: "MAJOR", status: "ACKNOWLEDGED", title: "고온 · 실습실", metric: "temperature", source: { type: "FLOW", flowId: "f-7f3a", nodeId: "n-thr00001" }, ackedBy: { userId: "1", name: "홍길동" }, ackedAt: "2026-10-03T23:20:00Z", raisedAt: "2026-10-03T22:40:00Z" }),
      ],
      events: {
        "9001": [
          { eventId: "70001", type: "RAISED", at: "2026-10-03T23:05:00Z", actor: { type: "FLOW" }, data: { value: 1050 } },
          { eventId: "70002", type: "NOTIFIED", at: "2026-10-03T23:05:02Z", actor: { type: "SYSTEM" }, data: { channel: "TELEGRAM", recipient: "시설팀", status: "SENT" } },
          { eventId: "70003", type: "RERAISED", at: "2026-10-03T23:09:00Z", actor: { type: "FLOW" }, data: { value: 1180 } },
        ],
      },
      silences: [],
      tuning: [
        {
          tuningSuggestionId: "41",
          ruleId: "301",
          ruleName: "본관 고CO2",
          problem: "TOO_FREQUENT",
          current: { kind: "threshold", metric: "co2", op: ">", value: 1000, for: "PT5M" },
          proposed: { kind: "threshold", metric: "co2", op: ">", value: 1000, for: "PT15M" },
          simulation: { alarmsBefore: 40, alarmsAfter: 6 },
          status: "OPEN",
          createdAt: "2026-10-03T00:00:00Z",
        },
      ],
      deliveries: [
        { deliveryId: "d-1", alarmId: "9001", channel: "WEB", recipient: "김운영", status: "SENT", attempts: 1, sentAt: "2026-10-03T23:05:01Z" },
        { deliveryId: "d-2", alarmId: "9001", channel: "TELEGRAM", recipient: "시설팀", status: "SENT", attempts: 1, sentAt: "2026-10-03T23:05:02Z" },
      ],
    };
    core.extra.rules = state;
  }
  return core.extra.rules as RulesState;
}

/** API-RUL-05 모양(core RuleDtos.RuleTemplate, 기본 제목은 템플릿 이름) — core 시드(V202610071000) 중 셋 */
const TEMPLATES = [
  { key: "high-co2", name: "고CO2", description: "CO2가 1,000ppm을 넘은 상태가 5분 이어지면 발생, 900ppm 아래에서 해제", category: "COMFORT", defaults: { condition: { kind: "threshold", metric: "co2", op: ">", value: 1000, for: "PT5M", clear: 900 }, severity: "MAJOR", titleTemplate: "고CO2 · {{space.path}}" }, paramsSchema: { type: "object" }, requiredMetrics: ["co2"], builtin: true },
  { key: "high-temp", name: "고온", description: "온도가 28℃를 넘은 상태가 10분 이어지면 발생", category: "COMFORT", defaults: { condition: { kind: "threshold", metric: "temperature", op: ">", value: 28, for: "PT10M", clear: 27 }, severity: "MINOR", titleTemplate: "고온 · {{space.path}}" }, paramsSchema: { type: "object" }, requiredMetrics: ["temperature"], builtin: true },
  { key: "no-data-30m", name: "무수신 30분", description: "30분 동안 데이터가 없으면 발생", category: "EQUIPMENT", defaults: { condition: { kind: "noData", window: "PT30M" }, severity: "WARNING", titleTemplate: "무수신 · {{device.name}}" }, paramsSchema: { type: "object" }, requiredMetrics: [], builtin: true },
];

function descendants(core: CoreState, id: string): string[] {
  const out = [id];
  for (const s of core.spaces) if (s.parentId === id) out.push(...descendants(core, s.id));
  return out;
}

function metricsIn(condition: Json): string[] {
  if (condition.kind === "group") return (condition.items as Json[]).flatMap(metricsIn);
  return typeof condition.metric === "string" ? [condition.metric] : [];
}

/** 범위 안 ACTIVE 기기 중 조건의 측정 항목을 내는 기기 수 */
function targetCount(core: CoreState, scope: { type: string; ids: string[]; includeChildren: boolean }, condition: Json): number {
  const needed = metricsIn(condition);
  const measures = (d: CoreState["devices"][number]) => needed.length === 0 || needed.some((m) => d.latest.some((l) => l.metricKey === m));
  const active = core.devices.filter((d) => d.status === "ACTIVE" && measures(d));
  if (scope.type === "DEVICE") return active.filter((d) => scope.ids.includes(d.id)).length;
  if (scope.type === "SPACE") {
    const spaces = new Set(scope.ids.flatMap((id) => (scope.includeChildren ? descendants(core, id) : [id])));
    return active.filter((d) => d.spaceId && spaces.has(d.spaceId)).length;
  }
  if (scope.type === "MODEL") return active.filter((d) => scope.ids.includes(core.models.find((m) => m.id === d.modelId)?.code ?? "")).length;
  return active.filter((d) => d.tags.some((tag) => scope.ids.includes(tag))).length;
}

function firstValue(condition: Json): number | null {
  if (condition.kind === "group") {
    for (const item of condition.items as Json[]) {
      const v = firstValue(item);
      if (v !== null) return v;
    }
    return null;
  }
  return typeof condition.value === "number" ? condition.value : null;
}

/** 시뮬레이션 결과: 기준이 높을수록 적게(1000 → 14건, 1200 → 5건) */
function simulate(rule: Json): Json {
  const value = firstValue((rule.condition as Json) ?? {}) ?? 1000;
  const alarms = value >= 1200 ? 5 : 14;
  return {
    alarms,
    notifications: alarms,
    avgDurationSec: 540,
    byDevice: [{ deviceId: "1042", name: "AM107-067999", count: alarms, longestSec: 1800 }],
    heatmap: [{ dow: 2, hour: 10, count: Math.ceil(alarms / 2) }, { dow: 3, hour: 14, count: Math.floor(alarms / 2) }],
    coverage: { dataRatio: 0.95 },
  };
}

function rulePayloadErrors(body: Json): { field: string; code: string; message: string }[] {
  const errors: { field: string; code: string; message: string }[] = [];
  if (typeof body.name !== "string" || !body.name.trim() || body.name.length > 100) errors.push({ field: "name", code: "INVALID_REQUEST", message: "name" });
  const scope = body.scope as Json | undefined;
  if (!scope || !Array.isArray(scope.ids) || scope.ids.length === 0) errors.push({ field: "scope.ids", code: "INVALID_REQUEST", message: "scope" });
  if (!body.condition) errors.push({ field: "condition", code: "RULE_CONDITION_INVALID", message: "condition" });
  if (typeof body.titleTemplate !== "string" || !body.titleTemplate) errors.push({ field: "titleTemplate", code: "INVALID_REQUEST", message: "titleTemplate" });
  return errors;
}

/** API-RUL-10: core AlarmQueryService.list와 같게 — counts.byStatus는 상태 조건을 빼고 센 수, bySeverity는 고른 상태 안에서 센 수 */
function listAlarms(core: CoreState, state: RulesState, url: URL) {
  const statuses = (url.searchParams.get("status") || "ACTIVE,ACKNOWLEDGED,SUPPRESSED").split(",");
  const severity = url.searchParams.get("severity")?.split(",").filter(Boolean) ?? [];
  const ruleId = url.searchParams.get("ruleId");
  const deviceId = url.searchParams.get("deviceId");
  const sourceType = url.searchParams.get("sourceType");
  const spaceId = url.searchParams.get("spaceId");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const spaces = spaceId ? new Set(descendants(core, spaceId)) : null;
  const base = state.alarms.filter(
    (a) =>
      (!ruleId || (a.source as Json).ruleId === ruleId) &&
      (!deviceId || String((a.device as Json | null)?.id ?? "") === deviceId) &&
      (!sourceType || (a.source as Json).type === sourceType) &&
      (!from || Date.parse(a.raisedAt) >= Date.parse(from)) &&
      (!to || Date.parse(a.raisedAt) < Date.parse(to)) &&
      (!spaces || spaces.has(String((a.space as Json | null)?.id ?? ""))),
  );
  const byStatus: Record<string, number> = {};
  const bySeverity: Record<string, number> = {};
  for (const a of base) {
    byStatus[a.status] = (byStatus[a.status] ?? 0) + 1;
    if (statuses.includes(a.status)) bySeverity[a.severity] = (bySeverity[a.severity] ?? 0) + 1;
  }
  const matched = base.filter((a) => statuses.includes(a.status) && (severity.length === 0 || severity.includes(a.severity)));
  return list(matched, url, { counts: { byStatus, bySeverity } });
}

/** flow-engine 규칙 컴파일(API-FLW-86)은 이상 탐지 조건을 아직 거부한다 → core가 400을 그대로 중계 */
function hasAnomaly(condition: Json | undefined): boolean {
  if (!condition) return false;
  if (condition.kind === "group") return ((condition.items as Json[]) ?? []).some(hasAnomaly);
  return condition.kind === "anomaly";
}
const ANOMALY_REJECTED = { errors: [{ field: "rule.condition.kind", code: "UNSUPPORTED", message: "이상 탐지 조건은 ANA 실시간 이상 점수가 필요합니다(RUL-01.08, M7)" }] };

function event(state: RulesState, id: string, type: string, req: CoreRequest, data: Json = {}) {
  (state.events[id] ??= []).push({ eventId: String((state.seq += 1)), type, at: "2026-10-04T00:00:00Z", actor: { type: "USER", id: req.user.id, name: req.user.name }, data });
}

export const rulesHandler: CoreHandler = (core, req) => {
  const { method, path, url } = req;
  const body = (req.body ?? {}) as Json;
  if (!/^\/(rules|rule-|alarms|silences|notification-deliveries)/.test(path)) return undefined;
  const state = rulesState(core);

  // ── 규칙 ──
  // ItemsResponse(페이징 없음): {header, responses, totalCount}
  if (path === "/rule-templates" && method === "GET") return req.can("RULE_READ") ? HttpResponse.json({ header: { isSuccessful: true, resultCode: "SUCCESS", resultMessage: "SUCCESS" }, responses: TEMPLATES, totalCount: TEMPLATES.length }) : fail(403, "PERMISSION_DENIED");
  if (path === "/rules" && method === "GET") {
    if (!req.can("RULE_READ")) return fail(403, "PERMISSION_DENIED");
    const q = url.searchParams.get("q")?.toLowerCase();
    const status = url.searchParams.get("status");
    const severity = url.searchParams.get("severity");
    const rows = state.rules.filter((r) => r.status !== "DELETED" && r.status !== "CONVERTED" && (!q || r.name.toLowerCase().includes(q)) && (!status || r.status === status) && (!severity || r.severity === severity));
    return list(rows, url, { counts: { total: state.rules.filter((r) => r.status !== "DELETED").length, limit: 1000 } });
  }
  if (path === "/rules" && method === "POST") {
    if (!req.can("RULE_WRITE")) return fail(403, "PERMISSION_DENIED");
    const errors = rulePayloadErrors(body);
    if (errors.length) return fail(400, "INVALID_REQUEST", { errors });
    if (state.rules.some((r) => r.name === body.name && r.status !== "DELETED")) return fail(409, "RULE_NAME_DUPLICATED");
    if (hasAnomaly(body.condition as Json)) return fail(400, "RULE_CONDITION_INVALID", ANOMALY_REJECTED);
    const scope = body.scope as FakeRule["scope"];
    const count = targetCount(core, scope, body.condition as Json);
    const rule: FakeRule = {
      ruleId: String((state.seq += 1)),
      name: String(body.name),
      templateKey: (body.templateKey as string) ?? null,
      status: count === 0 ? "ERROR" : "ACTIVE",
      errorReason: count === 0 ? "NO_TARGET" : null,
      scope: { ...scope, targetCount: count },
      condition: body.condition as Json,
      timeCondition: (body.timeCondition as Json) ?? null,
      severity: String(body.severity),
      titleTemplate: String(body.titleTemplate),
      autoClear: body.autoClear !== false,
      policyId: (body.policyId as string) ?? null,
      flowId: `0d6f2b1e-7c4a-4b8e-9f00-${String(state.seq).padStart(12, "0")}`,
      version: 1,
      stats7d: { raised: 0 },
      openAlarms: 0,
      conditionSummary: "",
      updatedBy: { userId: req.user.id, name: req.user.name },
      updatedAt: "2026-10-04T00:00:00Z",
    };
    state.rules.unshift(rule);
    return HttpResponse.json(
      { header: { isSuccessful: true, resultCode: "SUCCESS", resultMessage: "" }, response: { ruleId: rule.ruleId, version: 1, status: rule.status, targetCount: count, flowId: rule.flowId, warnings: count === 0 ? [{ code: "NO_TARGET", field: "scope", message: "범위에 조건의 측정 항목을 내는 기기가 없습니다" }] : [] } },
      { status: 201, headers: { Location: `/api/v1/core/rules/${rule.ruleId}` } },
    );
  }
  if (path === "/rules/draft-from-chart" && method === "POST") {
    if (!req.can("RULE_WRITE")) return fail(403, "PERMISSION_DENIED");
    const target = (body.target ?? {}) as Json;
    const spaceId = target.spaceId as string | undefined;
    return ok({
      name: `${body.metric} ${body.op} ${body.value}`,
      templateKey: null,
      scope: spaceId ? { type: "SPACE", ids: [spaceId], includeChildren: true } : { type: "DEVICE", ids: (target.deviceIds as string[]) ?? [], includeChildren: false },
      condition: { kind: "threshold", metric: body.metric, op: body.op, value: body.value },
      severity: "MAJOR",
      titleTemplate: `${body.metric} ${body.op} ${body.value}`,
      autoClear: true,
    });
  }
  if ((path === "/rules/simulate" || /^\/rules\/[^/]+\/simulate$/.test(path)) && method === "POST") {
    if (!req.can("RULE_WRITE")) return fail(403, "PERMISSION_DENIED");
    state.simulations.push(body);
    const span = Date.parse(String(body.to)) - Date.parse(String(body.from));
    if (!(span > 0) || span > 30 * 86_400_000) return fail(400, "RULE_SIMULATION_RANGE_INVALID");
    const result = simulate((body.rule as Json) ?? {});
    return ok(result);
  }
  if (path === "/rule-tuning-suggestions" && method === "GET") {
    if (!req.can("RULE_READ")) return fail(403, "PERMISSION_DENIED");
    const status = url.searchParams.get("status");
    return list(state.tuning.filter((t) => !status || t.status === status), url);
  }
  const tuning = /^\/rule-tuning-suggestions\/([^/]+)\/(apply|dismiss)$/.exec(path);
  if (tuning && method === "POST") {
    if (!req.can("RULE_WRITE")) return fail(403, "PERMISSION_DENIED");
    const item = state.tuning.find((t) => t.tuningSuggestionId === tuning[1]);
    if (!item) return fail(404, "RESOURCE_NOT_FOUND");
    if (tuning[2] === "dismiss") {
      item.status = "DISMISSED";
      return noContent();
    }
    item.status = "APPLIED";
    const rule = state.rules.find((r) => r.ruleId === item.ruleId);
    if (rule) {
      rule.version += 1;
      rule.condition = item.proposed as Json;
    }
    return ok({ tuningSuggestionId: item.tuningSuggestionId, status: "APPLIED", ruleId: item.ruleId, ruleVersion: rule?.version ?? 1 });
  }
  // core 경로 변수는 long(`/core/rules/{rule-id}`)이라 숫자가 아니면 400
  const ruleSegment = /^\/rules\/([^/]+)/.exec(path)?.[1];
  if (ruleSegment && !/^\d+$/.test(ruleSegment) && ruleSegment !== "simulate" && ruleSegment !== "draft-from-chart") return fail(400, "INVALID_REQUEST");
  const ruleMatch = /^\/rules\/(\d+)(?:\/(activate|deactivate|convert-to-flow))?$/.exec(path);
  if (ruleMatch) {
    const rule = state.rules.find((r) => r.ruleId === ruleMatch[1] && r.status !== "DELETED");
    if (!rule) return fail(404, "RULE_NOT_FOUND");
    const action = ruleMatch[2];
    if (method === "GET" && !action) return req.can("RULE_READ") ? ok(rule) : fail(403, "PERMISSION_DENIED");
    if (!req.can("RULE_WRITE")) return fail(403, "PERMISSION_DENIED");
    if (method === "PUT" && !action) {
      if (rule.status === "CONVERTED") return fail(409, "RULE_STATE_CONFLICT");
      if (body.baseVersion !== rule.version) return fail(409, "VERSION_CONFLICT");
      const errors = rulePayloadErrors(body);
      if (errors.length) return fail(400, "INVALID_REQUEST", { errors });
      if (hasAnomaly(body.condition as Json)) return fail(400, "RULE_CONDITION_INVALID", ANOMALY_REJECTED);
      const scope = body.scope as FakeRule["scope"];
      const count = targetCount(core, scope, body.condition as Json);
      Object.assign(rule, { name: body.name, scope: { ...scope, targetCount: count }, condition: body.condition, timeCondition: body.timeCondition ?? null, severity: body.severity, titleTemplate: body.titleTemplate, autoClear: body.autoClear, policyId: body.policyId ?? null, version: rule.version + 1, status: count === 0 ? "ERROR" : "ACTIVE", errorReason: count === 0 ? "NO_TARGET" : null });
      return ok({ ruleId: rule.ruleId, version: rule.version, status: rule.status, errorReason: rule.errorReason, targetCount: count, flowId: rule.flowId, warnings: count === 0 ? [{ code: "NO_TARGET", field: "scope", message: "범위에 조건의 측정 항목을 내는 기기가 없습니다" }] : [] });
    }
    if (method === "DELETE" && !action) {
      rule.status = "DELETED";
      if (url.searchParams.get("clearOpenAlarms") === "true") for (const a of state.alarms) if ((a.source as Json).ruleId === rule.ruleId) a.status = "CLEARED";
      return noContent();
    }
    if (method === "POST" && action === "activate") {
      if (rule.status === "CONVERTED") return fail(409, "RULE_STATE_CONFLICT");
      rule.status = "ACTIVE";
      return ok({ ruleId: rule.ruleId, status: rule.status, errorReason: null });
    }
    if (method === "POST" && action === "deactivate") {
      if (rule.status === "INACTIVE") return fail(409, "RULE_STATE_CONFLICT");
      rule.status = "INACTIVE";
      return ok({ ruleId: rule.ruleId, status: rule.status, errorReason: null });
    }
    if (method === "POST" && action === "convert-to-flow") {
      rule.status = "CONVERTED";
      return ok({ flowId: rule.flowId });
    }
    return fail(405, "INVALID_REQUEST");
  }

  // ── 알람 ──
  if (path === "/alarms" && method === "GET") return req.can("ALARM_READ") ? listAlarms(core, state, url) : fail(403, "PERMISSION_DENIED");
  if (path === "/alarms/stats" && method === "GET") {
    if (!req.can("RULE_READ")) return fail(403, "PERMISSION_DENIED");
    return ok({
      raised: 100,
      mttaSec: 720,
      mttrSec: 3600,
      unackedRatio: 0.12,
      topRules: [{ id: "301", name: "본관 고CO2", count: 40 }],
      topSpaces: [{ id: "31", name: "실습실", count: 55 }],
      topDevices: [{ id: "1042", name: "AM107-067999", count: 52 }],
      daily: [
        { date: "2026-10-02", raised: 12 },
        { date: "2026-10-03", raised: 18 },
      ],
    });
  }
  if (path === "/alarms/bulk-ack" && method === "POST") {
    if (!req.can("ALARM_HANDLE")) return fail(403, "PERMISSION_DENIED");
    const ids = (body.alarmIds as string[]) ?? [];
    if (ids.length > 200) return fail(400, "ALARM_BULK_LIMIT_EXCEEDED");
    const results = ids.map((id) => {
      const a = state.alarms.find((x) => x.id === String(id));
      if (!a) return { alarmId: id, ok: false, code: "ALARM_NOT_FOUND" };
      if (a.ackedAt) return { alarmId: id, ok: true, alreadyAcked: true };
      a.ackedAt = "2026-10-04T00:00:00Z";
      a.ackedBy = { userId: req.user.id, name: req.user.name };
      if (a.status === "ACTIVE") a.status = "ACKNOWLEDGED";
      event(state, a.id, "ACKED", req);
      return { alarmId: id, ok: true };
    });
    return ok({ results });
  }
  // core 경로는 `{alarm-id:\\d+}`라 숫자만
  const alarmMatch = /^\/alarms\/(\d+)(?:\/(ack|clear|notes|assignee))?$/.exec(path);
  if (alarmMatch) {
    const a = state.alarms.find((x) => x.id === alarmMatch[1]);
    if (!a || !req.can("ALARM_READ")) return fail(404, "ALARM_NOT_FOUND");
    const action = alarmMatch[2];
    if (method === "GET" && !action) {
      const children = state.alarms.filter((x) => x.parentAlarmId === a.id);
      const threshold = (a.source as Json).ruleId === "301" ? { raise: 1000, clear: 900 } : null;
      return ok({ alarm: { ...a, threshold, source: { ...(a.source as Json), ruleName: (a.source as Json).ruleId === "301" ? "본관 고CO2" : undefined } }, events: state.events[a.id] ?? [], children, chart: { metric: a.metric, from: "2026-10-03T21:05:00Z", to: "2026-10-04T00:00:00Z" } });
    }
    if (!req.can("ALARM_HANDLE")) return fail(403, "PERMISSION_DENIED");
    if (method === "POST" && action === "ack") {
      // 단건 재확인은 409(일괄 확인만 alreadyAcked, AlarmHandlingService)
      if (a.ackedAt) return fail(409, "ALARM_STATE_CONFLICT");
      a.ackedAt = "2026-10-04T00:00:00Z";
      a.ackedBy = { userId: req.user.id, name: req.user.name };
      if (a.status === "ACTIVE") a.status = "ACKNOWLEDGED";
      event(state, a.id, "ACKED", req);
      return ok({ ok: true, alarmId: a.id, status: a.status, ackedAt: a.ackedAt });
    }
    if (method === "POST" && action === "clear") {
      if (a.status === "CLEARED") return fail(409, "ALARM_STATE_CONFLICT");
      a.status = "CLEARED";
      a.clearedAt = "2026-10-04T00:00:00Z";
      a.clearReason = "MANUAL";
      event(state, a.id, "CLEARED", req, { reason: "MANUAL", note: body.note ?? null });
      return ok({ ok: true, alarmId: a.id, status: "CLEARED", clearedAt: a.clearedAt, clearReason: "MANUAL" });
    }
    if (method === "POST" && action === "notes") {
      const text = String(body.text ?? "");
      if (!text || text.length > 2000) return fail(400, "INVALID_REQUEST", { errors: [{ field: "text", code: "INVALID_REQUEST", message: "text" }] });
      const type = body.actionType ? "ACTION" : "NOTE";
      event(state, a.id, type, req, { text, actionType: body.actionType ?? null });
      return ok({ eventId: String((state.seq += 1)), alarmId: a.id, type, text, actionType: body.actionType ?? null, actor: { userId: req.user.id, name: req.user.name }, at: "2026-10-04T00:00:00Z" }, 201);
    }
    if (method === "PUT" && action === "assignee") {
      const userId = String(body.userId ?? "");
      const name = userId === req.user.id ? req.user.name : `사용자 ${userId}`;
      if (!/^\d+$/.test(userId)) return fail(400, "INVALID_REQUEST", { errors: [{ field: "userId", code: "Pattern", message: "userId" }] });
      a.assignee = { userId, name };
      event(state, a.id, "ASSIGNED", req, { assigneeId: userId });
      return ok({ alarmId: a.id, assignee: a.assignee, version: 2, updatedAt: "2026-10-04T00:00:00Z" });
    }
    return fail(405, "INVALID_REQUEST");
  }

  // ── 무음 ──
  if (path === "/silences") {
    if (!req.can("ALARM_HANDLE")) return fail(403, "PERMISSION_DENIED");
    if (method === "GET") return list(state.silences, url);
    if (method === "POST") {
      const kind = body.kind;
      if (kind === "ONE_TIME" && !(Date.parse(String(body.endsAt)) > Date.parse(String(body.startsAt)))) return fail(400, "SILENCE_RANGE_INVALID");
      const target = body.target as Json;
      const silence = { silenceId: String((state.seq += 1)), kind, target: { ...target, name: target.type === "RULE" ? state.rules.find((r) => r.ruleId === target.id)?.name : null }, startsAt: body.startsAt ?? null, endsAt: body.endsAt ?? null, recurrence: body.recurrence ?? null, reason: body.reason ?? null, active: true, createdBy: { userId: req.user.id, name: req.user.name }, createdAt: "2026-10-04T00:00:00Z" };
      state.silences.push(silence);
      if (target.type === "ALARM") event(state, String(target.id), "SILENCED", req);
      return ok(silence, 201);
    }
  }
  const silence = /^\/silences\/([^/]+)$/.exec(path);
  if (silence && method === "DELETE") {
    if (!req.can("ALARM_HANDLE")) return fail(403, "PERMISSION_DENIED");
    state.silences = state.silences.filter((s) => s.silenceId !== silence[1]);
    return noContent();
  }

  // ── 발송 이력(알람 상세) ──
  if (path === "/notification-deliveries" && method === "GET" && url.searchParams.get("alarmId")) {
    return HttpResponse.json({ header: { isSuccessful: true, resultCode: "SUCCESS", resultMessage: "" }, size: 50, responses: state.deliveries.filter((d) => d.alarmId === url.searchParams.get("alarmId")), nextCursor: null });
  }
  return undefined;
};
