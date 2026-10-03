/**
 * 자동화 플로우 가짜 API(design/api/FLW-api.md API-FLW-01~10·14·20·24·30, ACT-api API-ACT-25 기능 카탈로그 조회).
 * 상태는 core.extra["flows"]. 테스트는 `flowsState(core)`로 상황(승인 필요 설정, 제어 가능 공간, 지표)을 바꾼다.
 */
import { HttpResponse } from "msw";
import { M3_NODE_TYPES } from "~/features/flows/model/__tests__/catalog-fixture";
import { fail, list, noContent, ok, type CoreHandler, type CoreRequest, type CoreState } from "../core-fixtures";

interface Issue {
  code: string;
  nodeId?: string;
  path?: string;
  message?: string;
}
interface Def {
  schema: string;
  nodes: { id: string; type: string; typeVersion: number; name: string; config: Record<string, unknown>; position: { x: number; y: number } }[];
  wires: { from: string; port: string; to: string }[];
  [key: string]: unknown;
}
export interface FakeFlowVersion {
  version: number;
  state: "DRAFT" | "ACTIVE" | "ARCHIVED" | "PENDING_APPROVAL";
  definition: Def;
  memo: string | null;
  appliedBy: { userId: string; name: string } | null;
  appliedAt: string | null;
  baseVersion: number | null;
}
export interface FakeFlow {
  flowId: string;
  name: string;
  description: string | null;
  kind: "FLOW" | "RULE" | "CATCH";
  status: "DRAFT" | "ACTIVE" | "PAUSED" | "DEGRADED" | "DISABLED";
  environment: "PROD" | "TEST";
  activeVersion: number | null;
  draftVersion: number | null;
  spaceIds: string[];
  metrics1h: { executions: number; errorRate: number; actions: number };
  updatedBy: { userId: string; name: string };
  updatedAt: string;
  lock: number;
  versions: FakeFlowVersion[];
}
export interface FakeApproval {
  approvalId: string;
  flowId: string;
  flowName: string;
  version: number;
  kind: "APPLY" | "PROMOTE";
  status: "PENDING" | "APPROVED" | "REJECTED";
  hasControlNode: boolean;
  requestedBy: { userId: string; name: string };
  requestedAt: string;
  reason?: string;
}
export interface FlowsState {
  flows: FakeFlow[];
  approvals: FakeApproval[];
  /** 조직 설정: 제어 노드 배포 승인 필요(API-ACT-17 requireApprovalForControlNodes) */
  requireApproval: boolean;
  /** 공간별 제어 가능 기능(없으면 템플릿·검증에서 TARGET_MISSING 경고) */
  controllable: Map<string, string[]>;
  seq: number;
}

const AT = "2026-10-03T02:02:00Z";

/** "고온이면 냉방" 4노드(TC-FLW-019): 트리거(실습실 temperature) → 집계(평균) → 임계값(>27, 5분, 해제 26) → 제어(Thermostat set cool 24) */
export function coolingDefinition(spaceId: string, value = 27, duration = "PT5M", target = 24): Def {
  return {
    schema: "data2flow.flow-definition/v1",
    mode: { concurrency: "queued", keyBy: "deviceId", max: 10 },
    variables: [],
    nodes: [
      { id: "n-trg00001", type: "trigger.telemetry", typeVersion: 1, name: "실습실 온도", config: { target: { spaceId, relation: "measures", includeChildren: false }, metrics: ["temperature"] }, position: { x: 64, y: 96 } },
      { id: "n-agg00001", type: "transform.aggregate", typeVersion: 1, name: "평균", config: { window: "PT5M", fn: "avg", groupBy: "space" }, position: { x: 288, y: 96 } },
      { id: "n-thr00001", type: "condition.threshold", typeVersion: 1, name: `온도>${value}`, config: { metric: "temperature", op: ">", value, for: duration, clear: value - 1 }, position: { x: 512, y: 96 } },
      { id: "n-act00001", type: "action.control", typeVersion: 1, name: "에어컨 냉방", config: { target: { spaceId, relation: "controls", capability: "Thermostat" }, capability: "Thermostat", command: "set", args: { mode: "cool", targetTemperature: target }, validitySeconds: 600 }, position: { x: 736, y: 96 } },
    ],
    wires: [
      { from: "n-trg00001", port: "out", to: "n-agg00001" },
      { from: "n-agg00001", port: "out", to: "n-thr00001" },
      { from: "n-thr00001", port: "true", to: "n-act00001" },
    ],
  };
}

function co2Definition(): Def {
  return {
    schema: "data2flow.flow-definition/v1",
    nodes: [
      { id: "n-trg00002", type: "trigger.telemetry", typeVersion: 1, name: "실습실 CO2", config: { target: { spaceId: "31", relation: "measures" }, metrics: ["co2"] }, position: { x: 64, y: 96 } },
      { id: "n-js000002", type: "transform.js", typeVersion: 1, name: "보정(JS)", config: { code: "function main(msg) { return msg.co2.value * 1.02; }", outputs: 1 }, position: { x: 288, y: 96 } },
      { id: "n-dbg00002", type: "debug.log", typeVersion: 1, name: "기록", config: { level: "INFO" }, position: { x: 512, y: 96 } },
    ],
    wires: [
      { from: "n-trg00002", port: "out", to: "n-js000002" },
      { from: "n-js000002", port: "out1", to: "n-dbg00002" },
    ],
  };
}

const TEMPLATES = [
  {
    key: "high-temp-cooling",
    name: "고온이면 냉방",
    description: "공간 평균 온도가 기준을 넘는 상태가 이어지면 에어컨을 냉방으로 켭니다",
    category: "COMFORT",
    required: { metrics: ["temperature"], capabilities: ["Thermostat"] },
    paramsSchema: {
      type: "object",
      required: ["spaceId", "threshold", "duration", "targetTemperature"],
      properties: {
        spaceId: { type: "string", "x-widget": "space", title: "대상 공간" },
        threshold: { type: "number", minimum: 15, maximum: 40, default: 27, title: "기준 온도" },
        duration: { type: "string", format: "duration", default: "PT5M", title: "지속 시간" },
        targetTemperature: { type: "number", minimum: 18, maximum: 30, default: 24, title: "목표 온도" },
      },
    },
    preview: { nodes: [{ name: "텔레메트리" }, { name: "집계" }, { name: "임계값" }, { name: "기기 제어" }] },
  },
  { key: "co2-ventilation", name: "CO2 높으면 환기", description: "CO2가 기준을 넘으면 환기 장치를 켭니다", category: "COMFORT", required: { metrics: ["co2"], capabilities: ["Ventilation"] }, paramsSchema: { type: "object", required: ["spaceId"], properties: { spaceId: { type: "string", "x-widget": "space", title: "대상 공간" }, threshold: { type: "number", default: 1000, title: "기준 CO2" } } }, preview: null },
  { key: "sensor-anomaly-alert", name: "센서 이상 알림", description: "센서 값이 튀거나 멈추면 알립니다", category: "SAFETY", required: { metrics: [], capabilities: [] }, paramsSchema: { type: "object", properties: { spaceId: { type: "string", "x-widget": "space", title: "대상 공간" } } }, preview: null },
];

const CAPABILITIES = [
  {
    name: "Thermostat",
    version: 1,
    standard: true,
    matterCluster: "Thermostat",
    attributes: [
      { name: "mode", type: "enum", enum: ["off", "cool", "heat", "dry", "fan", "auto"] },
      { name: "targetTemperature", type: "number", unit: "°C", min: 5, max: 35, step: 0.5 },
      { name: "currentTemperature", type: "number", unit: "°C", readOnly: true },
    ],
    commands: [{ name: "set", sets: ["mode", "targetTemperature"], args: {} }],
    expectedEffects: [],
  },
  { name: "Switch", version: 1, standard: true, matterCluster: "On/Off", attributes: [{ name: "on", type: "boolean" }], commands: [{ name: "set", sets: ["on"], args: {} }], expectedEffects: [] },
  { name: "Ventilation", version: 1, standard: true, matterCluster: "Fan Control", attributes: [{ name: "mode", type: "enum", enum: ["off", "on", "auto"] }, { name: "level", type: "integer", min: 1, max: 3 }], commands: [{ name: "set", sets: ["mode", "level"], args: {} }], expectedEffects: [] },
];

function version(v: number, state: FakeFlowVersion["state"], definition: Def, memo: string | null = null): FakeFlowVersion {
  return { version: v, state, definition, memo, appliedBy: state === "DRAFT" ? null : { userId: "7", name: "김운영" }, appliedAt: state === "DRAFT" ? null : AT, baseVersion: null };
}

export function flowsState(core: CoreState): FlowsState {
  const key = "flows";
  if (!core.extra[key]) {
    const by = { userId: "7", name: "김운영" };
    core.extra[key] = {
      seq: 100,
      requireApproval: false,
      controllable: new Map(),
      approvals: [],
      flows: [
        { flowId: "f-7f3a", name: "고온이면 냉방", description: null, kind: "FLOW", status: "ACTIVE", environment: "PROD", activeVersion: 13, draftVersion: null, spaceIds: ["31"], metrics1h: { executions: 812, errorRate: 0, actions: 3 }, updatedBy: by, updatedAt: "2026-10-03T01:40:00Z", lock: 5, versions: [version(13, "ACTIVE", coolingDefinition("31"), "기준 온도 상향"), version(12, "ARCHIVED", coolingDefinition("31", 28), "처음 적용")] },
        { flowId: "f-co2", name: "CO2 환기 자동화", description: null, kind: "FLOW", status: "DEGRADED", environment: "PROD", activeVersion: 7, draftVersion: null, spaceIds: ["31"], metrics1h: { executions: 1204, errorRate: 0.12, actions: 0 }, updatedBy: { userId: "1", name: "홍길동" }, updatedAt: "2026-10-03T00:10:00Z", lock: 2, versions: [version(7, "ACTIVE", co2Definition())] },
        { flowId: "f-night", name: "야간 문 열림 알림", description: null, kind: "RULE", status: "PAUSED", environment: "PROD", activeVersion: 2, draftVersion: null, spaceIds: ["3"], metrics1h: { executions: 0, errorRate: 0, actions: 0 }, updatedBy: by, updatedAt: "2026-10-01T00:00:00Z", lock: 1, versions: [version(2, "ACTIVE", { schema: "data2flow.flow-definition/v1", nodes: [], wires: [] })] },
        { flowId: "f-draft", name: "초안 플로우", description: null, kind: "FLOW", status: "DRAFT", environment: "PROD", activeVersion: null, draftVersion: 1, spaceIds: [], metrics1h: { executions: 0, errorRate: 0, actions: 0 }, updatedBy: by, updatedAt: "2026-10-02T00:00:00Z", lock: 1, versions: [version(1, "DRAFT", { schema: "data2flow.flow-definition/v1", nodes: [], wires: [] })] },
      ],
    } satisfies FlowsState;
  }
  return core.extra[key] as FlowsState;
}

/** 가짜 서버 검증(API-FLW-06): NO_TRIGGER · UNCONNECTED · INVALID_CONFIG(임계값 value) · 경고 TARGET_MISSING */
export function fakeValidate(state: FlowsState, def: Def): { errors: Issue[]; warnings: Issue[] } {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  const nodes = def.nodes ?? [];
  if (nodes.length > 0 && !nodes.some((n) => n.type.startsWith("trigger."))) errors.push({ code: "NO_TRIGGER", message: "트리거가 없습니다" });
  const incoming = new Set((def.wires ?? []).map((w) => w.to));
  for (const n of nodes) {
    if (!n.type.startsWith("trigger.") && !incoming.has(n.id)) errors.push({ code: "UNCONNECTED", nodeId: n.id, message: "연결되지 않은 노드" });
    if (n.type === "condition.threshold" && typeof n.config?.value !== "number") errors.push({ code: "INVALID_CONFIG", nodeId: n.id, path: "value", message: "value 필수" });
    if (n.type === "action.control") {
      const target = n.config?.target as { spaceId?: string } | undefined;
      const caps = target?.spaceId ? (state.controllable.get(String(target.spaceId)) ?? []) : [];
      if (!caps.includes(String(n.config?.capability ?? ""))) warnings.push({ code: "TARGET_MISSING", nodeId: n.id, message: "대상 기기 없음" });
    }
  }
  return { errors, warnings };
}

const hasControl = (def: Def) => (def.nodes ?? []).some((n) => n.type === "action.control" || n.type === "action.scene");

function flowRow(f: FakeFlow) {
  return { flowId: f.flowId, name: f.name, kind: f.kind, status: f.status, environment: f.environment, activeVersion: f.activeVersion, draftVersion: f.draftVersion, spaceIds: f.spaceIds, hasControlNode: f.versions.some((v) => hasControl(v.definition)), metrics1h: f.metrics1h, updatedBy: f.updatedBy, updatedAt: f.updatedAt };
}

function detail(state: FlowsState, f: FakeFlow, requested?: number) {
  const target = requested ?? f.draftVersion ?? f.activeVersion ?? f.versions[0]?.version;
  const v = f.versions.find((x) => x.version === target);
  if (!v) return undefined;
  return {
    flow: { ...flowRow(f), description: f.description, purpose: null, ownerUserId: null, relatedSpaceIds: f.spaceIds, tags: [], version: f.lock },
    version: { version: v.version, state: v.state, baseVersion: v.baseVersion, definition: v.definition, validation: fakeValidate(state, v.definition), changeSummary: null, memo: v.memo, appliedBy: v.appliedBy, appliedAt: v.appliedAt },
    overlay: { bypass: [], debug: [], revision: 1 },
    applyStatus: f.activeVersion ? { targetVersion: f.activeVersion, instances: [{ instanceId: "flow-engine-0", appliedVersion: f.activeVersion, reportedAt: AT }, { instanceId: "flow-engine-1", appliedVersion: f.activeVersion, reportedAt: AT }], converged: true } : null,
    editors: [],
    emergencyStop: { active: false },
  };
}

function nextVersion(f: FakeFlow) {
  return Math.max(0, ...f.versions.map((v) => v.version)) + 1;
}

function diffOf(a: Def, b: Def) {
  const aIds = new Map(a.nodes.map((n) => [n.id, n]));
  const bIds = new Map(b.nodes.map((n) => [n.id, n]));
  const changed = b.nodes
    .filter((n) => aIds.has(n.id))
    .map((n) => {
      const before = aIds.get(n.id)!;
      const fields = [...new Set([...Object.keys(before.config), ...Object.keys(n.config)])].filter((k) => JSON.stringify(before.config[k]) !== JSON.stringify(n.config[k])).map((k) => `config.${k}`);
      if (before.name !== n.name) fields.push("name");
      return { nodeId: n.id, fields, statePolicy: "KEEP" };
    })
    .filter((c) => c.fields.length > 0);
  return { added: b.nodes.filter((n) => !aIds.has(n.id)).map((n) => n.id), removed: a.nodes.filter((n) => !bIds.has(n.id)).map((n) => n.id), changed };
}

function activate(f: FakeFlow, v: FakeFlowVersion, user: CoreRequest["user"], memo: string | null) {
  for (const other of f.versions) if (other.state === "ACTIVE") other.state = "ARCHIVED";
  v.state = "ACTIVE";
  v.memo = memo;
  v.appliedBy = { userId: user.id, name: user.name };
  v.appliedAt = AT;
  f.activeVersion = v.version;
  if (f.draftVersion === v.version) f.draftVersion = null;
  if (f.status === "DRAFT") f.status = "ACTIVE";
  f.updatedAt = AT;
  return { appliedVersion: v.version, applyStatus: { targetVersion: v.version, instances: [{ instanceId: "flow-engine-0", appliedVersion: v.version }], converged: true } };
}

const denied = () => fail(403, "PERMISSION_DENIED");

function createFlow(state: FlowsState, user: CoreRequest["user"], name: string, def: Def, spaceIds: string[] = []): FakeFlow {
  state.seq += 1;
  const flow: FakeFlow = { flowId: `f-${state.seq}`, name, description: null, kind: "FLOW", status: "DRAFT", environment: "PROD", activeVersion: null, draftVersion: 1, spaceIds, metrics1h: { executions: 0, errorRate: 0, actions: 0 }, updatedBy: { userId: user.id, name: user.name }, updatedAt: AT, lock: 1, versions: [version(1, "DRAFT", def)] };
  state.flows.push(flow);
  return flow;
}

export const flowsHandler: CoreHandler = (core, req) => {
  const { method, path, url, body, can, user } = req;
  const isCapability = path === "/capabilities" || path.startsWith("/capabilities/");
  if (!path.startsWith("/flow") && !isCapability) return undefined;
  const state = flowsState(core);
  const b = (body ?? {}) as Record<string, unknown>;

  if (isCapability && method === "GET") {
    if (!can("DEV_READ")) return denied();
    if (path === "/capabilities") return list(CAPABILITIES.map((c) => ({ name: c.name, version: c.version, standard: c.standard, matterCluster: c.matterCluster, attributeCount: c.attributes.length, commandCount: c.commands.length })), url);
    const cap = CAPABILITIES.find((c) => c.name === decodeURIComponent(path.slice("/capabilities/".length)));
    return cap ? ok(cap) : fail(404, "CAPABILITY_NOT_FOUND");
  }
  if (isCapability) return undefined;

  if (path === "/flow-nodes" && method === "GET") return can("FLOW_READ") ? list(M3_NODE_TYPES, url, { size: 100 }) : denied();

  if (path === "/flow-templates" && method === "GET") {
    if (!can("FLOW_WRITE")) return denied();
    const category = url.searchParams.get("category");
    return list(TEMPLATES.filter((tpl) => !category || tpl.category === category), url);
  }
  const instantiate = /^\/flow-templates\/([^/]+)\/instantiate$/.exec(path);
  if (instantiate && method === "POST") {
    if (!can("FLOW_WRITE")) return denied();
    const tpl = TEMPLATES.find((x) => x.key === decodeURIComponent(instantiate[1]));
    if (!tpl) return fail(404, "RESOURCE_NOT_FOUND");
    const params = (b.params ?? {}) as Record<string, unknown>;
    const name = String(b.name ?? tpl.name);
    if (state.flows.some((f) => f.name === name)) return fail(409, "FLOW_NAME_DUPLICATED");
    const spaceId = String(params.spaceId ?? "");
    const def = coolingDefinition(spaceId, Number(params.threshold ?? 27), String(params.duration ?? "PT5M"), Number(params.targetTemperature ?? 24));
    const flow = createFlow(state, user, name, def, spaceId ? [spaceId] : []);
    return ok({ flowId: flow.flowId, draftVersion: 1, warnings: fakeValidate(state, def).warnings }, 201, { Location: `/api/v1/core/flows/${flow.flowId}` });
  }

  const approvalAction = /^\/flow-approvals\/([^/]+)\/(approve|reject)$/.exec(path);
  if (approvalAction && method === "POST") {
    if (!can("FLOW_APPROVE")) return denied();
    const approval = state.approvals.find((a) => a.approvalId === approvalAction[1]);
    if (!approval) return fail(404, "RESOURCE_NOT_FOUND");
    if (approval.status !== "PENDING") return fail(409, "FLOW_STATE_CONFLICT");
    const flow = state.flows.find((f) => f.flowId === approval.flowId)!;
    const v = flow.versions.find((x) => x.version === approval.version)!;
    if (approvalAction[2] === "approve") {
      approval.status = "APPROVED";
      const applied = activate(flow, v, user, v.memo);
      return ok({ approvalId: approval.approvalId, flowId: flow.flowId, version: v.version, kind: approval.kind, status: "APPROVED", decidedBy: { userId: user.id, name: user.name }, decidedAt: AT, appliedVersion: applied.appliedVersion });
    }
    if (!b.reason) return fail(400, "INVALID_REQUEST");
    approval.status = "REJECTED";
    approval.reason = String(b.reason);
    v.state = "DRAFT";
    return ok({ approvalId: approval.approvalId, flowId: flow.flowId, version: v.version, kind: approval.kind, status: "REJECTED", decidedBy: { userId: user.id, name: user.name }, decidedAt: AT, reason: approval.reason });
  }

  if (path === "/flows/approvals" && method === "GET") {
    if (!can("FLOW_WRITE") && !can("FLOW_APPROVE")) return denied();
    const status = url.searchParams.get("status");
    return list(state.approvals.filter((a) => (!status || a.status === status) && (can("FLOW_APPROVE") || a.requestedBy.userId === user.id)), url);
  }

  if (path === "/flows") {
    if (method === "GET") {
      if (!can("FLOW_READ")) return denied();
      const q = url.searchParams.get("q")?.toLowerCase();
      const statuses = url.searchParams.getAll("status");
      const kind = url.searchParams.get("kind");
      const spaceId = url.searchParams.get("spaceId");
      const rank = (f: FakeFlow) => (f.status === "DEGRADED" ? 0 : f.metrics1h.errorRate > 0 ? 1 : 2);
      const rows = state.flows
        .filter((f) => (!q || f.name.toLowerCase().includes(q)) && (statuses.length === 0 || statuses.includes(f.status)) && (!kind || f.kind === kind) && (!spaceId || f.spaceIds.includes(spaceId)))
        .sort((a, c) => rank(a) - rank(c) || c.updatedAt.localeCompare(a.updatedAt));
      return list(rows.map(flowRow), url);
    }
    if (method === "POST") {
      if (!can("FLOW_WRITE")) return denied();
      const name = String(b.name ?? "").trim();
      if (!name || name.length > 100) return fail(400, "INVALID_REQUEST", { errors: [{ field: "name", code: "INVALID", message: "1~100자" }] });
      if (state.flows.some((f) => f.name === name)) return fail(409, "FLOW_NAME_DUPLICATED");
      const def = b.definition as Def;
      if ((def?.nodes?.length ?? 0) > 200) return fail(400, "FLOW_NODE_LIMIT_EXCEEDED");
      const flow = createFlow(state, user, name, def);
      return ok({ flowId: flow.flowId, draftVersion: 1, validation: fakeValidate(state, def) }, 201, { Location: `/api/v1/core/flows/${flow.flowId}` });
    }
    return undefined;
  }

  const m = /^\/flows\/([^/]+)(?:\/([a-z-]+))?$/.exec(path);
  if (!m) return undefined;
  const flow = state.flows.find((f) => f.flowId === decodeURIComponent(m[1]));
  if (!can("FLOW_READ")) return denied();
  if (!flow) return fail(404, "FLOW_NOT_FOUND");
  const sub = m[2];
  const write = () => can("FLOW_WRITE");

  if (!sub) {
    if (method === "GET") {
      const requested = url.searchParams.get("version");
      const d = detail(state, flow, requested ? Number(requested) : undefined);
      return d ? ok(d) : fail(404, "FLOW_NOT_FOUND");
    }
    if (method === "PATCH") {
      if (!write()) return denied();
      if (typeof b.name === "string") {
        const name = b.name.trim();
        if (state.flows.some((f) => f.name === name && f.flowId !== flow.flowId)) return fail(409, "FLOW_NAME_DUPLICATED");
        flow.name = name;
      }
      flow.lock += 1;
      return ok({ ...flowRow(flow), version: flow.lock });
    }
    if (method === "DELETE") {
      if (!write()) return denied();
      if (flow.status !== "DRAFT" && flow.status !== "DISABLED") return fail(409, "FLOW_STATE_CONFLICT");
      state.flows.splice(state.flows.indexOf(flow), 1);
      return noContent();
    }
    return undefined;
  }

  switch (`${method} ${sub}`) {
    case "PUT draft": {
      if (!write()) return denied();
      const latest = flow.draftVersion ?? flow.activeVersion ?? 0;
      if (Number(b.baseVersion) !== latest) return fail(409, "FLOW_VERSION_CONFLICT");
      const def = b.definition as Def;
      let draft = flow.versions.find((v) => v.version === flow.draftVersion);
      if (draft) draft.definition = def;
      else {
        draft = version(nextVersion(flow), "DRAFT", def);
        draft.baseVersion = flow.activeVersion;
        flow.versions.unshift(draft);
        flow.draftVersion = draft.version;
      }
      flow.updatedAt = AT;
      return ok({ flowId: flow.flowId, draftVersion: draft.version, validation: fakeValidate(state, def) });
    }
    case "POST validate": {
      const v = flow.versions.find((x) => x.version === Number(b.version));
      if (!v) return fail(404, "FLOW_NOT_FOUND");
      const active = flow.versions.find((x) => x.version === flow.activeVersion);
      const result = fakeValidate(state, v.definition);
      const diff = active ? diffOf(active.definition, v.definition) : { added: v.definition.nodes.map((n) => n.id), removed: [] as string[], changed: [] as { nodeId: string; statePolicy: string }[] };
      const controlIds = new Set(v.definition.nodes.filter((n) => n.type === "action.control").map((n) => n.id));
      const controlNodesChanged = [...diff.added, ...diff.changed.map((c) => c.nodeId)].some((id) => controlIds.has(id));
      return ok({ ...result, changeSummary: { added: diff.added, removed: diff.removed.map((nodeId) => ({ nodeId, retainedState: true })), changed: diff.changed.map((c) => ({ nodeId: c.nodeId, statePolicy: c.statePolicy })) }, risky: { controlNodesChanged, executionModeChanged: false }, approvalRequired: state.requireApproval && controlNodesChanged });
    }
    case "POST apply": {
      if (!write()) return denied();
      const v = flow.versions.find((x) => x.version === Number(b.version));
      if (!v) return fail(404, "FLOW_NOT_FOUND");
      if (Number(b.baseVersion ?? 0) !== (flow.activeVersion ?? 0)) return fail(409, "FLOW_VERSION_CONFLICT");
      const result = fakeValidate(state, v.definition);
      if (result.errors.length > 0) return fail(400, "FLOW_VALIDATION_FAILED", { errors: result.errors });
      const control = hasControl(v.definition);
      if (control && !can("FLOW_DEPLOY_CONTROL")) return fail(403, "PERMISSION_DENIED");
      if (control && state.requireApproval && !can("FLOW_APPROVE")) {
        state.seq += 1;
        const approvalId = `ap-${state.seq}`;
        v.state = "PENDING_APPROVAL";
        v.memo = (b.memo as string) ?? null;
        state.approvals.push({ approvalId, flowId: flow.flowId, flowName: flow.name, version: v.version, kind: "APPLY", status: "PENDING", hasControlNode: true, requestedBy: { userId: user.id, name: user.name }, requestedAt: AT });
        return HttpResponse.json({ header: { isSuccessful: true, resultCode: "FLOW_APPROVAL_REQUIRED", resultMessage: "승인 요청을 보냈습니다" }, response: { approvalId } }, { status: 202 });
      }
      return ok(activate(flow, v, user, (b.memo as string) ?? null));
    }
    case "GET versions":
      return HttpResponse.json({ header: { isSuccessful: true, resultCode: "SUCCESS", resultMessage: "SUCCESS" }, responses: [...flow.versions].sort((a, c) => c.version - a.version).map((v) => ({ version: v.version, state: v.state, appliedBy: v.appliedBy, appliedAt: v.appliedAt, memo: v.memo, hasControlNode: hasControl(v.definition) })), totalCount: flow.versions.length });
    case "GET version-diff": {
      const a = flow.versions.find((x) => x.version === Number(url.searchParams.get("from")));
      const c = flow.versions.find((x) => x.version === Number(url.searchParams.get("to")));
      if (!a || !c) return fail(404, "FLOW_NOT_FOUND");
      return ok({ ...diffOf(a.definition, c.definition), wires: { added: [], removed: [] }, settings: [] });
    }
    case "POST rollback": {
      if (!write()) return denied();
      const from = flow.versions.find((x) => x.version === Number(b.toVersion));
      if (!from) return fail(404, "FLOW_NOT_FOUND");
      if (hasControl(from.definition) && !can("FLOW_DEPLOY_CONTROL")) return fail(403, "PERMISSION_DENIED");
      const next = version(nextVersion(flow), "DRAFT", structuredClone(from.definition));
      flow.versions.unshift(next);
      return ok(activate(flow, next, user, (b.memo as string) ?? `v${from.version}로 롤백`));
    }
    case "POST pause":
    case "POST resume":
    case "POST disable": {
      if (!write()) return denied();
      const allowed = sub === "pause" ? ["ACTIVE", "DEGRADED"] : sub === "resume" ? ["PAUSED"] : ["ACTIVE", "DEGRADED", "PAUSED"];
      if (!allowed.includes(flow.status)) return fail(409, "FLOW_STATE_CONFLICT");
      flow.status = sub === "pause" ? "PAUSED" : sub === "resume" ? "ACTIVE" : "DISABLED";
      return ok({ status: flow.status });
    }
    case "GET metrics": {
      const active = flow.versions.find((x) => x.version === flow.activeVersion) ?? flow.versions[0];
      const errorsByNode = (id: string, type: string) => (flow.flowId === "f-co2" && type === "transform.js" ? 145 : 0);
      const nodes = (active?.definition.nodes ?? []).map((n) => ({ nodeId: n.id, processed: flow.metrics1h.executions, errors: errorsByNode(n.id, n.type), avgMs: 0.4 }));
      const errors = nodes.reduce((s, n) => s + n.errors, 0);
      return ok({ summary: { executions: flow.metrics1h.executions, errors, errorRate: flow.metrics1h.errorRate, avgMs: 1.2, p95Ms: 3.4, actions: { command: flow.metrics1h.actions, notify: 0, sink: 0 }, droppedTriggers: 0 }, nodes, series: [] });
    }
    default:
      return undefined;
  }
};
