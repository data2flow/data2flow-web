/**
 * M4 제어 관리 화면 모델(design/api/ACT-api.md 부록 A 모양): 비상 정지(API-ACT-20·21), 장면(API-ACT-10~12), 예약(API-ACT-15),
 * 인터락(API-ACT-16), 드라이버(API-ACT-30~32), 기능 카탈로그(API-ACT-25), 일괄 제어(API-ACT-05), 가동·효과(API-ACT-35).
 * 화면 부품은 이 함수들로 요청 본문·검증·요약 문구 재료를 만든다.
 */
import type { AttributeDef, CommandDef } from "./control";

// ── 비상 정지(ACT-06.03, UI-ACT-07) ──────────────────────────────────────────

export interface EmergencyScope {
  type: "ORG" | "SPACE";
  spaceId?: string | null;
  includeChildren?: boolean;
}

export interface EmergencyStop {
  emergencyStopId: string;
  scope: EmergencyScope;
  reason: string;
  startedBy?: { userId: string; name?: string | null } | null;
  startedAt: string;
  releasedBy?: { userId: string; name?: string | null } | null;
  releasedAt?: string | null;
  releaseNote?: string | null;
  active: boolean;
}

/** 확인 입력 문구("정지")와 같아야 실행할 수 있다. 사유는 1~200자(API-ACT-20) */
export function emergencyProblems(input: { scopeType: "ORG" | "SPACE"; spaceId?: string; reason: string; confirm: string; confirmWord: string }): string[] {
  const problems: string[] = [];
  const reason = input.reason.trim();
  if (reason.length < 1 || reason.length > 200) problems.push("reason");
  if (input.scopeType === "SPACE" && !input.spaceId) problems.push("space");
  if (input.confirm.trim() !== input.confirmWord) problems.push("confirm");
  return problems;
}

export function emergencyBody(scopeType: "ORG" | "SPACE", spaceId: string | undefined, reason: string): { scope: EmergencyScope; reason: string } {
  return { scope: scopeType === "ORG" ? { type: "ORG" } : { type: "SPACE", spaceId, includeChildren: true }, reason: reason.trim() };
}

// ── 유지보수 띠(OPS-05, 00-navigation.md §1.3) ───────────────────────────────

export interface MaintenanceWindow {
  id: string;
  targetType: "SPACE" | "DEVICE" | string;
  targetId: string;
  targetName?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  pauseAutomation?: boolean;
  reason?: string | null;
  status: "SCHEDULED" | "ACTIVE" | "ENDED" | "CANCELED" | string;
}

// ── 장면(ACT-05, UI-ACT-04) ──────────────────────────────────────────────────

export interface SceneTarget {
  deviceId?: string | null;
  spaceId?: string | null;
  relation?: string | null;
  capability?: string | null;
  includeChildren?: boolean | null;
}

export interface SceneItem {
  target: SceneTarget;
  capability: string;
  desired: Record<string, unknown>;
}

export interface SceneSummary {
  sceneId: string;
  name: string;
  spaceId?: string | null;
  itemCount: number;
  updatedAt?: string;
}

export interface Scene extends SceneSummary {
  description?: string | null;
  items: SceneItem[];
  version: number;
  createdBy?: { userId: string; name?: string } | null;
}

export interface ScenePreviewItem {
  deviceId: string;
  name?: string | null;
  capability: string;
  current?: Record<string, unknown> | null;
  target?: Record<string, unknown> | null;
  willChange: boolean;
  predictedBlock?: { reason: string; message?: string | null } | null;
  offline?: boolean;
}

export interface SceneRun {
  status: "RUNNING" | "SUCCEEDED" | "PARTIAL" | "FAILED" | string;
  results: { deviceId: string; commandId?: string | null; status: string; reason?: string | null }[];
}

export const SCENE_ITEM_LIMIT = 100;

/** 장면 저장 전 검사(BR-ACT-16): 이름 1~60자, 항목 1~100개, 항목마다 대상·기능·목표 상태 */
export function sceneProblems(name: string, items: SceneItem[]): { field: string; code: string }[] {
  const problems: { field: string; code: string }[] = [];
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > 60) problems.push({ field: "name", code: "nameLength" });
  if (items.length === 0) problems.push({ field: "items", code: "itemsRequired" });
  if (items.length > SCENE_ITEM_LIMIT) problems.push({ field: "items", code: "SCENE_ITEM_LIMIT_EXCEEDED" });
  items.forEach((item, i) => {
    const hasTarget = Boolean(item.target.deviceId) || Boolean(item.target.spaceId);
    if (!hasTarget) problems.push({ field: `items[${i}].target`, code: "targetRequired" });
    if (!item.capability) problems.push({ field: `items[${i}].capability`, code: "capabilityRequired" });
    if (Object.keys(item.desired ?? {}).length === 0) problems.push({ field: `items[${i}].desired`, code: "desiredRequired" });
  });
  return problems;
}

/** 관계 대상은 기능을 target에도 넣는다(API-ACT-10 `{spaceId, relation:"controls", capability, includeChildren}`) */
export function normalizeSceneItem(item: SceneItem): SceneItem {
  if (item.target.deviceId) return { target: { deviceId: item.target.deviceId }, capability: item.capability, desired: item.desired };
  return {
    target: { spaceId: item.target.spaceId, relation: "controls", capability: item.capability, includeChildren: Boolean(item.target.includeChildren) },
    capability: item.capability,
    desired: item.desired,
  };
}

/** 미리보기 요약: 바뀌는 수, 변경 없음, 차단 예상, 오프라인(TC-ACT-096) */
export function previewSummary(items: ScenePreviewItem[]) {
  return {
    change: items.filter((i) => i.willChange && !i.predictedBlock).length,
    noChange: items.filter((i) => !i.willChange).length,
    blocked: items.filter((i) => i.predictedBlock).length,
    offline: items.filter((i) => i.offline).length,
  };
}

/** 실행 결과 요약(적용·대기·차단·실패·건너뜀) */
export function runSummary(run: SceneRun) {
  const count = (pred: (s: string) => boolean) => run.results.filter((r) => pred(r.status)).length;
  return {
    applied: count((s) => s === "APPLIED"),
    waiting: count((s) => ["REQUESTED", "SENT", "ACKED", "QUEUED", "QUEUED_FOR_DOWNLINK", "DELAYED"].includes(s)),
    blocked: count((s) => s === "BLOCKED"),
    failed: count((s) => ["FAILED", "TIMEOUT", "REJECTED"].includes(s)),
    skipped: count((s) => s === "SKIPPED"),
  };
}

/** "cool · 24" 처럼 상태 값을 짧게 */
export function stateText(state: Record<string, unknown> | null | undefined): string {
  if (!state || Object.keys(state).length === 0) return "–";
  return Object.values(state)
    .map((v) => (typeof v === "boolean" ? (v ? "ON" : "OFF") : String(v)))
    .join(" · ");
}

// ── 예약 제어(ACT-02.07, UI-ACT-05) ───────────────────────────────────────────

export type ScheduleKind = "ONCE" | "RECURRING" | "SPACE_HOURS";

export interface ScheduleSummary {
  controlScheduleId: string;
  name: string;
  kind: ScheduleKind;
  targetSummary?: string | null;
  enabled: boolean;
  nextRunAt?: string | null;
  lastRun?: { at?: string | null; status?: string | null } | null;
}

export interface Schedule extends ScheduleSummary {
  target: { sceneId?: string | null; deviceId?: string | null; capability?: string | null; command?: string | null; args?: Record<string, unknown> | null };
  at?: string | null;
  cron?: string | null;
  spaceHours?: { spaceId: string; edge: "START" | "END"; offsetMinutes: number } | null;
  validFrom?: string | null;
  validTo?: string | null;
  skipHolidays: boolean;
  timezone?: string | null;
  version: number;
}

export interface ScheduleForm {
  name: string;
  targetType: "scene" | "device";
  sceneId: string;
  deviceId: string;
  capability: string;
  command: string;
  args: string;
  kind: ScheduleKind;
  at: string;
  days: number[];
  time: string;
  cron: string;
  spaceId: string;
  edge: "START" | "END";
  offsetMinutes: string;
  validFrom: string;
  validTo: string;
  skipHolidays: boolean;
  timezone: string;
}

const CRON_FIELD = /^(\*|\d{1,2}(-\d{1,2})?(,\d{1,2}(-\d{1,2})?)*)(\/\d{1,2})?$/;

/** 5칸 cron(분 시 일 월 요일)만 받는다. 화면 요일·시각 선택은 이 cron으로 바꾼다 */
export function isValidCron(cron: string): boolean {
  const parts = cron.trim().split(/\s+/);
  return parts.length === 5 && parts.every((p) => CRON_FIELD.test(p));
}

/** 요일(1=월~7=일)·시각 → cron(일요일은 0) */
export function daysTimeToCron(days: number[], time: string): string | undefined {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match || days.length === 0) return undefined;
  const dow = [...new Set(days.map((d) => (d === 7 ? 0 : d)))].sort((a, b) => a - b);
  return `${Number(match[2])} ${Number(match[1])} * * ${dow.join(",")}`;
}

/** 반복 일정 cron이 요일·시각 모양이면 화면 선택으로 되돌린다 */
export function cronToDaysTime(cron: string | null | undefined): { days: number[]; time: string } | undefined {
  const match = /^(\d{1,2}) (\d{1,2}) \* \* ([0-6](,[0-6])*)$/.exec((cron ?? "").trim());
  if (!match) return undefined;
  const days = match[3].split(",").map((d) => (d === "0" ? 7 : Number(d)));
  return { days, time: `${match[2].padStart(2, "0")}:${match[1].padStart(2, "0")}` };
}

export function scheduleProblems(form: ScheduleForm): string[] {
  const problems: string[] = [];
  if (!form.name.trim() || form.name.trim().length > 100) problems.push("name");
  if (form.targetType === "scene" && !form.sceneId) problems.push("scene");
  if (form.targetType === "device") {
    if (!form.deviceId || !form.capability || !form.command) problems.push("device");
    try {
      const parsed = JSON.parse(form.args || "{}");
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) problems.push("args");
    } catch {
      problems.push("args");
    }
  }
  if (form.kind === "ONCE" && !form.at) problems.push("at");
  if (form.kind === "RECURRING") {
    const cron = form.cron.trim() || daysTimeToCron(form.days, form.time);
    if (!cron || !isValidCron(cron)) problems.push("cron");
  }
  if (form.kind === "SPACE_HOURS" && (!form.spaceId || !/^-?\d+$/.test(form.offsetMinutes.trim()))) problems.push("spaceHours");
  if (form.validFrom && form.validTo && form.validFrom > form.validTo) problems.push("validRange");
  return problems;
}

/** 화면 폼 → API-ACT-15 요청. `at`은 조직 시간대 입력을 UTC로 바꿔 받는다 */
export function scheduleBody(form: ScheduleForm, toUtc: (local: string) => string | undefined): Record<string, unknown> {
  const target =
    form.targetType === "scene"
      ? { sceneId: form.sceneId }
      : { deviceId: form.deviceId, capability: form.capability, command: form.command, args: JSON.parse(form.args || "{}") as Record<string, unknown> };
  const body: Record<string, unknown> = { name: form.name.trim(), target, kind: form.kind, skipHolidays: form.skipHolidays, timezone: form.timezone || undefined };
  if (form.kind === "ONCE") body.at = toUtc(form.at);
  if (form.kind === "RECURRING") body.cron = form.cron.trim() || daysTimeToCron(form.days, form.time);
  if (form.kind === "SPACE_HOURS") body.spaceHours = { spaceId: form.spaceId, edge: form.edge, offsetMinutes: Number(form.offsetMinutes) };
  if (form.validFrom) body.validFrom = form.validFrom;
  if (form.validTo) body.validTo = form.validTo;
  return body;
}

export function emptyScheduleForm(timezone: string): ScheduleForm {
  return {
    name: "",
    targetType: "scene",
    sceneId: "",
    deviceId: "",
    capability: "",
    command: "set",
    args: "{}",
    kind: "RECURRING",
    at: "",
    days: [1, 2, 3, 4, 5],
    time: "08:50",
    cron: "",
    spaceId: "",
    edge: "END",
    offsetMinutes: "10",
    validFrom: "",
    validTo: "",
    skipHolidays: true,
    timezone,
  };
}

export function scheduleToForm(s: Schedule, timezone: string, toLocal: (iso: string) => string): ScheduleForm {
  const dt = cronToDaysTime(s.cron);
  return {
    ...emptyScheduleForm(s.timezone ?? timezone),
    name: s.name,
    targetType: s.target.sceneId ? "scene" : "device",
    sceneId: s.target.sceneId ?? "",
    deviceId: s.target.deviceId ?? "",
    capability: s.target.capability ?? "",
    command: s.target.command ?? "set",
    args: JSON.stringify(s.target.args ?? {}),
    kind: s.kind,
    at: s.at ? toLocal(s.at) : "",
    days: dt?.days ?? [],
    time: dt?.time ?? "",
    cron: s.kind === "RECURRING" && !dt ? (s.cron ?? "") : "",
    spaceId: s.spaceHours?.spaceId ?? "",
    edge: s.spaceHours?.edge ?? "END",
    offsetMinutes: String(s.spaceHours?.offsetMinutes ?? 0),
    validFrom: s.validFrom ?? "",
    validTo: s.validTo ?? "",
    skipHolidays: s.skipHolidays,
  };
}

// ── 인터락(ACT-06.02, UI-ACT-06) ─────────────────────────────────────────────

export interface InterlockCondition {
  kind: "metric" | "state";
  deviceId?: string | null;
  spaceAgg?: string | null;
  relation?: string | null;
  metric?: string | null;
  capability?: string | null;
  attribute?: string | null;
  op: string;
  value: unknown;
}

export interface InterlockForbid {
  capability: string;
  command?: string | null;
  argsMatch?: Record<string, { in?: unknown[]; eq?: unknown }> | null;
}

export interface InterlockSummary {
  interlockId: string;
  name: string;
  spaceId: string;
  includeChildren: boolean;
  forbid: InterlockForbid;
  enabled: boolean;
  blocks7d?: number;
  updatedAt?: string;
}

export interface Interlock extends InterlockSummary {
  condition: InterlockCondition;
  message: string;
  version: number;
}

export const INTERLOCK_OPS = [">", ">=", "<", "<=", "==", "!="] as const;

export interface InterlockForm {
  name: string;
  spaceId: string;
  includeChildren: boolean;
  kind: "metric" | "state";
  deviceId: string;
  metric: string;
  capability: string;
  attribute: string;
  op: string;
  value: string;
  forbidCapability: string;
  forbidCommand: string;
  forbidAttribute: string;
  forbidValues: string;
  message: string;
  enabled: boolean;
}

export function emptyInterlockForm(): InterlockForm {
  return {
    name: "",
    spaceId: "",
    includeChildren: true,
    kind: "state",
    deviceId: "",
    metric: "",
    capability: "Contact",
    attribute: "open",
    op: "==",
    value: "true",
    forbidCapability: "Thermostat",
    forbidCommand: "set",
    forbidAttribute: "mode",
    forbidValues: "cool, heat",
    message: "",
    enabled: true,
  };
}

/** 입력 문자열 값 → JSON 값(true/false/숫자/문자열) */
export function parseScalar(raw: string): unknown {
  const v = raw.trim();
  if (v === "true") return true;
  if (v === "false") return false;
  if (v !== "" && !Number.isNaN(Number(v))) return Number(v);
  return v;
}

export function interlockProblems(form: InterlockForm): string[] {
  const problems: string[] = [];
  if (!form.name.trim() || form.name.trim().length > 100) problems.push("name");
  if (!form.spaceId) problems.push("space");
  if (form.kind === "metric" && !form.metric.trim()) problems.push("metric");
  if (form.kind === "state" && (!form.capability.trim() || !form.attribute.trim())) problems.push("state");
  if (!(INTERLOCK_OPS as readonly string[]).includes(form.op) || form.value.trim() === "") problems.push("condition");
  if (!form.forbidCapability.trim()) problems.push("forbid");
  if (!form.message.trim() || form.message.trim().length > 200) problems.push("message");
  return problems;
}

export function interlockBody(form: InterlockForm): Record<string, unknown> {
  const condition: InterlockCondition =
    form.kind === "metric"
      ? { kind: "metric", ...(form.deviceId ? { deviceId: form.deviceId } : { spaceAgg: "avg" }), metric: form.metric.trim(), op: form.op, value: parseScalar(form.value) }
      : {
          kind: "state",
          ...(form.deviceId ? { deviceId: form.deviceId } : { relation: "measures" }),
          capability: form.capability.trim(),
          attribute: form.attribute.trim(),
          op: form.op,
          value: parseScalar(form.value),
        };
  const values = form.forbidValues
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean)
    .map(parseScalar);
  const forbid: InterlockForbid = { capability: form.forbidCapability.trim() };
  if (form.forbidCommand.trim()) forbid.command = form.forbidCommand.trim();
  if (form.forbidAttribute.trim() && values.length) forbid.argsMatch = { [form.forbidAttribute.trim()]: { in: values } };
  return { name: form.name.trim(), spaceId: form.spaceId, includeChildren: form.includeChildren, condition, forbid, message: form.message.trim(), enabled: form.enabled };
}

export function interlockToForm(i: Interlock): InterlockForm {
  const c = i.condition;
  const [attribute, match] = Object.entries(i.forbid.argsMatch ?? {})[0] ?? ["", undefined];
  return {
    name: i.name,
    spaceId: i.spaceId,
    includeChildren: i.includeChildren,
    kind: c.kind,
    deviceId: c.deviceId ?? "",
    metric: c.metric ?? "",
    capability: c.capability ?? "",
    attribute: c.attribute ?? "",
    op: c.op,
    value: String(c.value ?? ""),
    forbidCapability: i.forbid.capability,
    forbidCommand: i.forbid.command ?? "",
    forbidAttribute: attribute,
    forbidValues: (match?.in ?? (match?.eq !== undefined ? [match.eq] : [])).map(String).join(", "),
    message: i.message,
    enabled: i.enabled,
  };
}

/** "Contact.open == true" · "pm2_5 > 75" */
export function conditionText(c: InterlockCondition | null | undefined): string {
  if (!c) return "–";
  const left = c.kind === "metric" ? (c.metric ?? "") : `${c.capability ?? ""}.${c.attribute ?? ""}`;
  return `${left} ${c.op} ${String(c.value)}`;
}

/** "Thermostat · mode ∈ {cool, heat}" */
export function forbidText(f: InterlockForbid | null | undefined): string {
  if (!f) return "–";
  const parts = [f.command ? `${f.capability}.${f.command}` : f.capability];
  for (const [attr, m] of Object.entries(f.argsMatch ?? {})) {
    if (m.in) parts.push(`${attr} ∈ {${m.in.map(String).join(", ")}}`);
    else if (m.eq !== undefined) parts.push(`${attr} = ${String(m.eq)}`);
  }
  return parts.join(" · ");
}

/** 데이터 없음 판정 기본값: 보고 주기 × 3, 최소 5분(BR-ACT-11, UI-ACT-06) */
export function defaultStaleSec(expectedIntervalSec: number | null | undefined): number {
  return Math.max(300, (expectedIntervalSec ?? 0) * 3);
}

// ── 드라이버(ACT-03, UI-ACT-09) ──────────────────────────────────────────────

export const DRIVER_TYPES = ["VIRTUAL", "MQTT", "LORAWAN", "LG_THINQ", "SMARTTHINGS"] as const;
export type DriverType = (typeof DRIVER_TYPES)[number];

export interface DriverSummary {
  driverId: string;
  name: string;
  type: DriverType | string;
  status: "OK" | "CIRCUIT_OPEN" | "ERROR" | "UNTESTED" | string;
  deviceCount?: number;
  updatedAt?: string;
}

export interface Driver extends DriverSummary {
  config: Record<string, unknown>;
  hasSecret: boolean;
  pollingSec?: number | null;
  ackTimeoutSec?: number | null;
  applyTimeoutSec?: number | null;
  retry?: { maxAttempts?: number; initialMs?: number; multiplier?: number; maxMs?: number } | null;
  circuit?: { failureRate?: number; windowSec?: number; openSec?: number } | null;
  capabilities?: string[];
  version: number;
}

export interface DriverMetrics {
  status: string;
  circuit?: { state: "CLOSED" | "OPEN" | "HALF_OPEN" | string; openedAt?: string | null } | null;
  requests?: number;
  errors?: number;
  errorRate?: number | null;
  avgMs?: number | null;
  p95Ms?: number | null;
  recentErrors?: { at: string; commandId?: string | null; message: string }[];
}

export interface HealthcheckResult {
  ok: boolean;
  latencyMs?: number | null;
  capabilities?: string[];
  error?: { kind: string; message: string } | null;
}

/** 종류별 연결 정보 칸(API-ACT-30 표). secret 칸은 쓰기 전용 */
export const DRIVER_FIELDS: Record<DriverType, { config: { key: string; type: "text" | "number" | "boolean"; required?: boolean }[]; secret: string[] }> = {
  VIRTUAL: { config: [{ key: "simulatorEnvironmentId", type: "text" }], secret: [] },
  MQTT: {
    config: [
      { key: "sourceId", type: "text", required: true },
      { key: "commandTopic", type: "text", required: true },
      { key: "ackTopic", type: "text", required: true },
      { key: "stateTopic", type: "text", required: true },
      { key: "qos", type: "number" },
    ],
    secret: [],
  },
  LORAWAN: {
    config: [
      { key: "chirpstackUrl", type: "text", required: true },
      { key: "applicationId", type: "text", required: true },
      { key: "fPortDefault", type: "number", required: true },
      { key: "confirmed", type: "boolean" },
    ],
    secret: ["apiToken"],
  },
  LG_THINQ: {
    config: [
      { key: "region", type: "text", required: true },
      { key: "clientId", type: "text", required: true },
    ],
    secret: ["pat"],
  },
  SMARTTHINGS: { config: [{ key: "locationId", type: "text" }], secret: ["token"] },
};

export const DRIVER_DEFAULTS = {
  pollingSec: 60,
  ackTimeoutSec: 30,
  applyTimeoutSec: 60,
  retry: { maxAttempts: 3, initialMs: 1000, multiplier: 2, maxMs: 30000 },
  circuit: { failureRate: 50, windowSec: 60, openSec: 30 },
};

export const MQTT_DEFAULT_CONFIG = { commandTopic: "devices/{device-key}/command", ackTopic: "devices/{device-key}/command/ack", stateTopic: "devices/{device-key}/state", qos: 1 };

export interface DriverForm {
  name: string;
  type: DriverType;
  config: Record<string, string | boolean>;
  secret: Record<string, string>;
  pollingSec: string;
  ackTimeoutSec: string;
  applyTimeoutSec: string;
  maxAttempts: string;
}

export function emptyDriverForm(type: DriverType = "LORAWAN"): DriverForm {
  const config: Record<string, string | boolean> = {};
  for (const f of DRIVER_FIELDS[type].config) config[f.key] = f.type === "boolean" ? true : "";
  if (type === "MQTT") Object.assign(config, { ...MQTT_DEFAULT_CONFIG, qos: String(MQTT_DEFAULT_CONFIG.qos) });
  return {
    name: "",
    type,
    config,
    secret: {},
    pollingSec: String(DRIVER_DEFAULTS.pollingSec),
    ackTimeoutSec: String(DRIVER_DEFAULTS.ackTimeoutSec),
    applyTimeoutSec: String(DRIVER_DEFAULTS.applyTimeoutSec),
    maxAttempts: String(DRIVER_DEFAULTS.retry.maxAttempts),
  };
}

export function driverToForm(d: Driver): DriverForm {
  const type = (DRIVER_TYPES as readonly string[]).includes(d.type) ? (d.type as DriverType) : "VIRTUAL";
  const config: Record<string, string | boolean> = {};
  for (const f of DRIVER_FIELDS[type].config) {
    const v = d.config?.[f.key];
    config[f.key] = f.type === "boolean" ? Boolean(v ?? true) : v === undefined || v === null ? "" : String(v);
  }
  return {
    name: d.name,
    type,
    config,
    secret: {},
    pollingSec: String(d.pollingSec ?? DRIVER_DEFAULTS.pollingSec),
    ackTimeoutSec: String(d.ackTimeoutSec ?? DRIVER_DEFAULTS.ackTimeoutSec),
    applyTimeoutSec: String(d.applyTimeoutSec ?? DRIVER_DEFAULTS.applyTimeoutSec),
    maxAttempts: String(d.retry?.maxAttempts ?? DRIVER_DEFAULTS.retry.maxAttempts),
  };
}

/** 저장 전 검사. 새 드라이버는 비밀값이 필요한 종류면 비밀값 필수, 수정은 비워 두면 기존 값 유지(hasSecret) */
export function driverProblems(form: DriverForm, hasSecret = false): string[] {
  const problems: string[] = [];
  if (!form.name.trim() || form.name.trim().length > 100) problems.push("name");
  for (const f of DRIVER_FIELDS[form.type].config) {
    const v = form.config[f.key];
    if (f.required && (v === undefined || v === "")) problems.push(`config.${f.key}`);
    if (f.type === "number" && v !== "" && v !== undefined && Number.isNaN(Number(v))) problems.push(`config.${f.key}`);
  }
  if (form.type === "LORAWAN" && typeof form.config.chirpstackUrl === "string" && form.config.chirpstackUrl && !/^https?:\/\//.test(form.config.chirpstackUrl)) problems.push("config.chirpstackUrl");
  const secrets = DRIVER_FIELDS[form.type].secret;
  if (secrets.length && !hasSecret && secrets.every((k) => !form.secret[k]?.trim())) problems.push("secret");
  for (const key of ["pollingSec", "ackTimeoutSec", "applyTimeoutSec", "maxAttempts"] as const) {
    const n = Number(form[key]);
    if (!Number.isInteger(n) || n < 0 || (key === "maxAttempts" && n > 3)) problems.push(key);
  }
  return [...new Set(problems)];
}

/** 화면 폼 → API-ACT-30 요청. 비밀값을 비우면 보내지 않는다(기존 값 유지) */
export function driverBody(form: DriverForm): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  for (const f of DRIVER_FIELDS[form.type].config) {
    const v = form.config[f.key];
    if (v === "" || v === undefined) continue;
    config[f.key] = f.type === "number" ? Number(v) : f.type === "boolean" ? Boolean(v) : String(v).trim();
  }
  const secret = Object.fromEntries(Object.entries(form.secret).filter(([, v]) => v.trim()));
  return {
    name: form.name.trim(),
    type: form.type,
    config,
    ...(Object.keys(secret).length ? { secret } : {}),
    pollingSec: Number(form.pollingSec),
    ackTimeoutSec: Number(form.ackTimeoutSec),
    applyTimeoutSec: Number(form.applyTimeoutSec),
    retry: { ...DRIVER_DEFAULTS.retry, maxAttempts: Number(form.maxAttempts) },
    circuit: DRIVER_DEFAULTS.circuit,
  };
}

export function driverTone(status: string): "success" | "warning" | "danger" | "neutral" {
  if (status === "OK") return "success";
  if (status === "CIRCUIT_OPEN") return "warning";
  if (status === "ERROR") return "danger";
  return "neutral";
}

// ── 기능 카탈로그(ACT-01, UI-ACT-10) ─────────────────────────────────────────

export interface CapabilitySummaryRow {
  name: string;
  version: number;
  standard: boolean;
  matterCluster?: string | null;
  attributeCount?: number;
  commandCount?: number;
}

export interface CapabilityDefinition {
  name: string;
  version?: number;
  standard?: boolean;
  matterCluster?: string | null;
  attributes: AttributeDef[];
  commands: CommandDef[];
  expectedEffects?: { when: unknown; metric: string; direction: "up" | "down"; withinMinutes: number }[];
  updatedAt?: string;
}

const STANDARD_NAMES = ["Switch", "Thermostat", "FanSpeed", "Ventilation", "Dimmer", "Lock", "Contact"];
const ATTR_TYPES = ["boolean", "number", "integer", "enum", "string"];

/** 사용자 정의 기능 JSON 검사(BR-ACT-22): 이름은 `custom.`으로 시작, 표준 이름 금지, 속성 1개 이상, 명령의 sets는 속성 이름 */
export function parseCapabilityJson(text: string): { definition?: CapabilityDefinition; problems: string[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { problems: ["json"] };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { problems: ["json"] };
  const d = raw as Partial<CapabilityDefinition>;
  const problems: string[] = [];
  if (typeof d.name !== "string" || STANDARD_NAMES.includes(d.name)) problems.push("CAPABILITY_NAME_RESERVED");
  else if (!/^custom\.[A-Za-z][A-Za-z0-9]{0,59}$/.test(d.name)) problems.push("namePrefix");
  const attributes = Array.isArray(d.attributes) ? d.attributes : [];
  if (attributes.length === 0) problems.push("attributes");
  for (const a of attributes) {
    if (!a || typeof a.name !== "string" || !ATTR_TYPES.includes(a.type)) problems.push("attributeShape");
    else if (a.type === "enum" && (!Array.isArray(a.enum) || a.enum.length === 0)) problems.push("attributeShape");
    else if (a.min != null && a.max != null && a.min > a.max) problems.push("attributeRange");
  }
  const names = new Set(attributes.map((a) => a?.name));
  const commands = Array.isArray(d.commands) ? d.commands : [];
  for (const c of commands) if (!c || typeof c.name !== "string" || (c.sets ?? []).some((s) => !names.has(s))) problems.push("commandShape");
  const unique = [...new Set(problems)];
  return unique.length ? { problems: unique } : { definition: { ...(d as CapabilityDefinition), attributes, commands }, problems: [] };
}

export const CUSTOM_CAPABILITY_TEMPLATE = JSON.stringify(
  {
    name: "custom.Humidifier",
    attributes: [
      { name: "on", type: "boolean" },
      { name: "targetHumidity", type: "integer", unit: "%", min: 30, max: 70, step: 1 },
    ],
    commands: [{ name: "set", sets: ["on", "targetHumidity"] }],
    expectedEffects: [{ when: { command: "set", args: { on: true } }, metric: "humidity", direction: "up", withinMinutes: 30 }],
  },
  null,
  2,
);

// ── 일괄 제어(ACT-02.06, UI-ACT-03) ──────────────────────────────────────────

export const BULK_LIMIT = 500;

export interface BulkPreviewDevice {
  deviceId: string;
  name?: string | null;
  current?: Record<string, unknown> | null;
  target?: Record<string, unknown> | null;
  willChange: boolean;
  warnings?: string[];
}

export interface BulkJob {
  total: number;
  succeeded: number;
  failed: number;
  queued: number;
  skipped: number;
  items: { deviceId: string; commandId?: string | null; status: string; reason?: string | null }[];
}

export function bulkDone(job: BulkJob): boolean {
  return job.succeeded + job.failed + job.queued + job.skipped >= job.total;
}

// ── 가동·효과(ACT-08, UI-ACT-11) ─────────────────────────────────────────────

export interface RuntimeReport {
  items: { date: string; onSeconds: number; cycles: number; energyWh?: number | null; energySource?: "RATED" | "REPORTED" | string | null }[];
  noEffectEvents: {
    at: string;
    commandId?: string | null;
    metric: string;
    expected?: { direction?: string; withinMinutes?: number } | string | null;
    observed?: { start?: number; end?: number; delta?: number } | string | null;
  }[];
}

export function runtimeTotals(report: RuntimeReport) {
  return report.items.reduce((acc, i) => ({ onHours: acc.onHours + i.onSeconds / 3600, cycles: acc.cycles + i.cycles, energyKwh: acc.energyKwh + (i.energyWh ?? 0) / 1000 }), {
    onHours: 0,
    cycles: 0,
    energyKwh: 0,
  });
}

export function effectText(value: RuntimeReport["noEffectEvents"][number]["expected"] | RuntimeReport["noEffectEvents"][number]["observed"]): string {
  if (value === null || value === undefined) return "–";
  if (typeof value === "string") return value;
  if ("direction" in value || "withinMinutes" in value) {
    const v = value as { direction?: string; withinMinutes?: number };
    return `${v.direction === "down" ? "↓" : v.direction === "up" ? "↑" : ""}${v.withinMinutes !== undefined ? ` ${v.withinMinutes}m` : ""}`.trim();
  }
  const o = value as { start?: number; end?: number; delta?: number };
  const delta = o.delta ?? (o.start !== undefined && o.end !== undefined ? o.end - o.start : undefined);
  return delta === undefined ? "–" : `${delta > 0 ? "+" : ""}${Math.round(delta * 10) / 10}`;
}

/** "mode=cool, targetTemperature=24" ↔ {mode:"cool", targetTemperature:24} (장면 목표 상태 입력) */
export function parseDesired(text: string): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  for (const part of text
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/.exec(part);
    if (!match) return undefined;
    out[match[1]] = parseScalar(match[2]);
  }
  return out;
}

export function desiredText(desired: Record<string, unknown> | null | undefined): string {
  return Object.entries(desired ?? {})
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(", ");
}
