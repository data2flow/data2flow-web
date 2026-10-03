/**
 * 기기 제어 화면 모델(UI-ACT-01·02, ACT-02.04·04.01·04.02·04.03).
 * API 모양은 design/api/ACT-api.md(API-ACT-01~04·06, 부록 A)를 따른다. 화면 부품은 이 함수들로 컨트롤·상태 배지·진행 칩·이력 행을 만든다.
 */
import { zonedDayStartUtc } from "~/lib/format";

export type CapabilityState = Record<string, Record<string, unknown>>;

export interface AttributeDef {
  name: string;
  type: string;
  enum?: string[] | null;
  unit?: string | null;
  min?: number | null;
  max?: number | null;
  step?: number | null;
  readOnly?: boolean | null;
}

export interface CommandDef {
  name: string;
  sets?: string[];
  args?: unknown;
}

export interface Constraint {
  min?: number | null;
  max?: number | null;
  enum?: string[] | null;
}

export interface CapabilityControl {
  name: string;
  version?: number;
  attributes: AttributeDef[];
  commands: CommandDef[];
  effectiveConstraints?: Record<string, Constraint> | null;
}

export interface Shadow {
  desired?: CapabilityState | null;
  desiredVersion?: number | null;
  reported?: CapabilityState | null;
  reportedAt?: string | null;
  delta?: CapabilityState | null;
  connectivity?: "UNKNOWN" | "ONLINE" | "OFFLINE" | string | null;
}

/** API-ACT-03 응답 */
export interface ControlInfo {
  controllable: boolean;
  driver?: { id: string; name?: string; type?: string; status?: string } | null;
  capabilities: CapabilityControl[];
  shadow?: Shadow | null;
  manualOverride?: { capability: string; until: string; setBy?: string | null } | null;
  protection?: { nextAllowedAt?: string | null } | null;
  pending?: { commandId: string; capability: string; command: string; status: string }[];
  emergencyStop?: { emergencyStopId?: string; scope?: unknown; since?: string } | null;
}

export type CommandStatus =
  | "REQUESTED"
  | "REJECTED"
  | "BLOCKED"
  | "SKIPPED"
  | "DELAYED"
  | "QUEUED"
  | "QUEUED_FOR_DOWNLINK"
  | "SENT"
  | "ACKED"
  | "APPLIED"
  | "TIMEOUT"
  | "FAILED"
  | "SUPERSEDED"
  | "CANCELLED";

export interface CommandSource {
  type: string;
  userId?: string | null;
  /** API 문서에는 없다. 있으면 쓴다(이름 표시, 문서 보완 요청) */
  userName?: string | null;
  flowId?: string | null;
  /** API 문서에는 없다. 있으면 쓰고 없으면 flowId를 보여 준다 */
  flowName?: string | null;
  flowVersion?: number | null;
  nodeId?: string | null;
  sceneRunId?: string | null;
  scheduleId?: string | null;
  bulkJobId?: string | null;
  suggestionId?: string | null;
  approvedBy?: string | null;
}

/** API-ACT-01·02 Command */
export interface Command {
  id: string;
  status: CommandStatus | string;
  statusReason?: string | null;
  deviceId: string;
  /** 목록 표시용(문서에는 없음, 있으면 쓴다) */
  deviceName?: string | null;
  capability: string;
  command: string;
  args?: Record<string, unknown> | null;
  priority?: string;
  source?: CommandSource | null;
  validUntil?: string | null;
  executeAfter?: string | null;
  expectedDeliveryAt?: string | null;
  timeline?: { status: string; at: string; reason?: string | null }[];
  message?: string | null;
  idempotencyKey?: string | null;
  createdAt?: string | null;
}

/** 진행 칩 단계(ACT-04.02): REQUESTED → SENT → ACKED → APPLIED */
export const PROGRESS_STEPS = ["REQUESTED", "SENT", "ACKED", "APPLIED"] as const;
const FAILED = new Set(["REJECTED", "BLOCKED", "FAILED", "TIMEOUT", "CANCELLED", "SUPERSEDED", "SKIPPED"]);
const WAITING = new Set(["DELAYED", "QUEUED", "QUEUED_FOR_DOWNLINK"]);
export const CANCELLABLE = new Set(["QUEUED", "DELAYED", "QUEUED_FOR_DOWNLINK"]);

export interface Progress {
  /** 끝난 단계 수(0~4) */
  done: number;
  terminal: boolean;
  failed: boolean;
  waiting: boolean;
}

export function progressOf(status: string): Progress {
  const index = (PROGRESS_STEPS as readonly string[]).indexOf(status);
  if (index >= 0) return { done: index + 1, terminal: status === "APPLIED", failed: false, waiting: false };
  if (WAITING.has(status)) return { done: 1, terminal: false, failed: false, waiting: true };
  return { done: 0, terminal: true, failed: FAILED.has(status), waiting: false };
}

/** 상태 이벤트는 순서가 뒤바뀔 수 있다. 진행 단계가 뒤로 가는 이벤트는 무시하고, 끝난 명령은 바꾸지 않는다 */
export function nextStatus(current: string | undefined, incoming: string): string {
  if (!current) return incoming;
  const now = progressOf(current);
  if (now.terminal) return current;
  const next = progressOf(incoming);
  if (!next.terminal && !next.waiting && next.done < now.done) return current;
  return incoming;
}

/** 속성 입력 범위: 기능 정의 ∩ 모델 제약·조직 한계(effectiveConstraints, API-ACT-03) */
export function attributeRange(capability: CapabilityControl, attribute: string): { min?: number; max?: number; step?: number; enum?: string[]; unit?: string } {
  const def = capability.attributes.find((a) => a.name === attribute);
  const constraint = capability.effectiveConstraints?.[attribute] ?? {};
  const pick = (a?: number | null, b?: number | null, f: (x: number, y: number) => number = Math.max) => (a == null ? (b ?? undefined) : b == null ? a : f(a, b));
  const enumValues = constraint.enum ?? def?.enum ?? undefined;
  return {
    min: pick(def?.min, constraint.min, Math.max),
    max: pick(def?.max, constraint.max, Math.min),
    step: def?.step ?? (def?.type === "integer" ? 1 : undefined),
    enum: enumValues && def?.enum && constraint.enum ? constraint.enum.filter((v) => def.enum!.includes(v)) : (enumValues ?? undefined),
    unit: def?.unit ?? undefined,
  };
}

/** 사용자가 바꿀 수 있는 속성(읽기 전용 제외, set 명령이 바꾸는 것) */
export function writableAttributes(capability: CapabilityControl): AttributeDef[] {
  const set = capability.commands.find((c) => c.name === "set");
  if (!set) return [];
  const settable = set.sets && set.sets.length > 0 ? new Set(set.sets) : null;
  return capability.attributes.filter((a) => !a.readOnly && (!settable || settable.has(a.name)));
}

export type ArgProblem = { attribute: string; kind: "range"; min?: number; max?: number } | { attribute: string; kind: "enum" } | { attribute: string; kind: "type" };

export function validateArgs(capability: CapabilityControl, args: Record<string, unknown>): ArgProblem[] {
  const problems: ArgProblem[] = [];
  for (const [attribute, value] of Object.entries(args)) {
    const def = capability.attributes.find((a) => a.name === attribute);
    if (!def) continue;
    const range = attributeRange(capability, attribute);
    if (def.type === "number" || def.type === "integer") {
      if (typeof value !== "number" || Number.isNaN(value) || (def.type === "integer" && !Number.isInteger(value))) {
        problems.push({ attribute, kind: "type" });
        continue;
      }
      if ((range.min !== undefined && value < range.min) || (range.max !== undefined && value > range.max)) problems.push({ attribute, kind: "range", min: range.min, max: range.max });
      else if (range.step && !Number.isInteger(Math.round(((value - (range.min ?? 0)) / range.step) * 1e6) / 1e6)) problems.push({ attribute, kind: "range", min: range.min, max: range.max });
    } else if (def.type === "enum") {
      if (range.enum && !range.enum.includes(String(value))) problems.push({ attribute, kind: "enum" });
    } else if (def.type === "boolean" && typeof value !== "boolean") problems.push({ attribute, kind: "type" });
  }
  return problems;
}

/** 현재 원하는 값(없으면 보고 값) */
export function currentValue(shadow: Shadow | null | undefined, capability: string, attribute: string): unknown {
  return shadow?.desired?.[capability]?.[attribute] ?? shadow?.reported?.[capability]?.[attribute];
}

/** 바꾼 값만 명령 인자로(명령은 토글이 아니라 목표 상태 설정, BR-ACT-03) */
export function changedArgs(shadow: Shadow | null | undefined, capability: string, edited: Record<string, unknown>): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(edited)) {
    if (value === undefined || value === "") continue;
    if (currentValue(shadow, capability, key) !== value) args[key] = value;
  }
  return args;
}

export type SyncState = "synced" | "pending" | "deviceChanged";

/**
 * 원하는 상태와 실제 상태 비교(ACT-02.04, TC-ACT-044):
 * - 차이 없음 → synced
 * - 차이가 있고 이 기능의 명령이 진행·대기 중이거나 기기가 오프라인 → pending("적용 대기")
 * - 차이가 있는데 진행 중인 명령이 없음 → deviceChanged("기기에서 직접 변경됨", desired는 그대로 두고 자동 재적용하지 않는다)
 */
export function syncState(shadow: Shadow | null | undefined, capability: string, pendingCapabilities: ReadonlySet<string>): SyncState {
  const delta = shadow?.delta?.[capability] ?? diff(shadow?.desired?.[capability], shadow?.reported?.[capability]);
  if (!delta || Object.keys(delta).length === 0) return "synced";
  if (pendingCapabilities.has(capability) || shadow?.connectivity === "OFFLINE") return "pending";
  return "deviceChanged";
}

function diff(desired?: Record<string, unknown>, reported?: Record<string, unknown>): Record<string, unknown> | null {
  if (!desired) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(desired)) if (reported?.[k] !== v) out[k] = v;
  return out;
}

/** 실시간 기기 상태(`device-update`의 state = 기능별 보고 값)를 섀도에 합친다. desired는 바꾸지 않는다 */
export function mergeReported(shadow: Shadow | null | undefined, state: unknown, at?: string): Shadow {
  const base: Shadow = { ...(shadow ?? {}) };
  if (!state || typeof state !== "object") return base;
  const reported: CapabilityState = { ...(base.reported ?? {}) };
  for (const [cap, attrs] of Object.entries(state as Record<string, unknown>)) {
    if (attrs && typeof attrs === "object" && !Array.isArray(attrs)) reported[cap] = { ...(reported[cap] ?? {}), ...(attrs as Record<string, unknown>) };
  }
  const delta: CapabilityState = {};
  for (const [cap, desired] of Object.entries(base.desired ?? {})) {
    const d = diff(desired, reported[cap]);
    if (d && Object.keys(d).length) delta[cap] = d;
  }
  return { ...base, reported, delta, reportedAt: at ?? base.reportedAt };
}

/** "Thermostat.set(cool, 24)" */
export function commandLabel(command: Pick<Command, "capability" | "command" | "args">): string {
  const values = Object.values(command.args ?? {}).map((v) => (typeof v === "string" ? v : JSON.stringify(v)));
  return `${command.capability}.${command.command}(${values.join(", ")})`;
}

/** 요청부터 마지막 상태까지 걸린 시간(ms). 타임라인이 없으면 null */
export function commandDurationMs(command: Pick<Command, "timeline">): number | null {
  const timeline = command.timeline ?? [];
  if (timeline.length < 2) return null;
  const times = timeline.map((s) => Date.parse(s.at)).filter((n) => !Number.isNaN(n));
  if (times.length < 2) return null;
  return Math.max(...times) - Math.min(...times);
}

export function requestedAt(command: Pick<Command, "timeline" | "createdAt">): string | undefined {
  return command.createdAt ?? command.timeline?.[0]?.at;
}

/** 실패·차단 사유: 인터락 message > statusReason */
export function failureReason(command: Pick<Command, "message" | "statusReason">): string | undefined {
  return command.message ?? command.statusReason ?? undefined;
}

/** 이력 필터(URL ↔ API-ACT-02 쿼리) */
export const HISTORY_FILTERS = ["from", "to", "sourceType", "status", "capability"] as const;
export const SOURCE_TYPES = ["USER", "FLOW", "RULE", "AI", "SCHEDULE", "SCENE", "BULK", "SYSTEM"] as const;
export const HISTORY_STATUSES = ["REQUESTED", "SENT", "ACKED", "APPLIED", "REJECTED", "BLOCKED", "DELAYED", "QUEUED", "TIMEOUT", "FAILED", "CANCELLED"] as const;

/** 화면 입력(조직 시간대 `2026-10-03T09:00`)을 UTC ISO로. 이미 ISO면 그대로 */
export function localToUtc(value: string, timezone: string): string | undefined {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return Number.isNaN(Date.parse(value)) ? undefined : value;
  const valid = new Date(`${match[1]}T00:00:00Z`);
  if (Number.isNaN(valid.getTime()) || valid.toISOString().slice(0, 10) !== match[1] || Number(match[2]) > 23 || Number(match[3]) > 59) return undefined;
  const day = zonedDayStartUtc(match[1], timezone) as string;
  return new Date(Date.parse(day) + (Number(match[2]) * 60 + Number(match[3])) * 60_000).toISOString().replace(".000Z", "Z");
}

export function historyQuery(params: URLSearchParams, size = 50, extra: Record<string, string | null | undefined> = {}, timezone = "Asia/Seoul"): URLSearchParams {
  const query = new URLSearchParams();
  for (const key of HISTORY_FILTERS) {
    const raw = params.get(key)?.trim();
    const value = raw && (key === "from" || key === "to") ? localToUtc(raw, timezone) : raw;
    if (value) query.set(key, value);
  }
  for (const [key, value] of Object.entries(extra)) if (value) query.set(key, value);
  const cursor = params.get("cursor");
  if (cursor) query.set("cursor", cursor);
  query.set("size", String(size));
  return query;
}

/** 버튼 연타 방지(1초, API-ACT-01 참고): 마지막 허용 뒤 ms 안의 요청은 거부 */
export function createDebounceGuard(ms = 1000, now: () => number = Date.now) {
  let last = -Infinity;
  return () => {
    const t = now();
    if (t - last < ms) return false;
    last = t;
    return true;
  };
}
