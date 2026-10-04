/**
 * 알람 화면 모델(UI-RUL-04·05, API-RUL-10~14, BR-RUL-02·07·09·10·11·21).
 * - 필터 ↔ URL 검색 매개변수(상태 기본: CLEARED 제외, 기간 24h·7d·30d)
 * - 정렬: 심각도 → 발생 시각 내림차순
 * - 묶기: 상위 알람 아래 하위 알람(토폴로지, RUL-04.01), 공간 이벤트(RUL-04.03)
 * - 실시간(SSE `alarm.raised`·`alarm.updated`·`alarm.cleared`) 반영
 */
export const SEVERITIES = ["CRITICAL", "MAJOR", "MINOR", "WARNING", "INFO"] as const;
export type Severity = (typeof SEVERITIES)[number];
export const ALARM_STATUSES = ["ACTIVE", "ACKNOWLEDGED", "SUPPRESSED", "CLEARED"] as const;
export type AlarmStatus = (typeof ALARM_STATUSES)[number];
export const OPEN_STATUSES: AlarmStatus[] = ["ACTIVE", "ACKNOWLEDGED", "SUPPRESSED"];
export const SOURCE_TYPES = ["RULE", "FLOW", "SYSTEM"] as const;
export const RANGES = ["24h", "7d", "30d", "all"] as const;
export type RangeKey = (typeof RANGES)[number];
/** 일괄 처리 한도(BR-RUL-21) */
export const BULK_LIMIT = 200;
/** 새 알람 강조 시간(UI-RUL-04 "3초") */
export const HIGHLIGHT_MS = 3000;

export interface UserRef {
  userId: string;
  name: string;
}

export interface Alarm {
  id: string;
  severity: Severity;
  status: AlarmStatus;
  flapping?: boolean;
  title: string;
  source: { type: "RULE" | "FLOW" | "SYSTEM"; ruleId?: string | null; flowId?: string | null; nodeId?: string | null; ruleName?: string | null; flowName?: string | null };
  device?: { id: string; name?: string | null } | null;
  space?: { id: string; path?: (string | { name?: string })[] | string | null } | null;
  metric?: string | null;
  triggerValue?: number | null;
  peakValue?: number | null;
  lastValue?: number | null;
  occurrenceCount?: number;
  raisedAt: string;
  lastRaisedAt?: string | null;
  ackedBy?: UserRef | null;
  ackedAt?: string | null;
  clearedAt?: string | null;
  clearReason?: string | null;
  assignee?: UserRef | null;
  parentAlarmId?: string | null;
  childCount?: number;
  spaceEventId?: string | null;
  suppressedReason?: "MAINTENANCE" | "PARENT" | "DEVICE_OFFLINE" | null;
  /** 발생·해제 기준(EVT-RUL-01 threshold 스냅숏). 목록 모양에는 없고 상세에 있을 때만 */
  threshold?: { raise?: number | null; clear?: number | null } | null;
  /** core Alarm에는 없다. 상세 loader가 차트 시계열 단위로 채운다 */
  unit?: string | null;
}

export interface AlarmCounts {
  byStatus: Partial<Record<AlarmStatus, number>>;
  bySeverity: Partial<Record<Severity, number>>;
}

export interface AlarmFilter {
  status: AlarmStatus[];
  severity: Severity[];
  spaceId: string;
  ruleId: string;
  sourceType: string;
  range: RangeKey;
  groupBySpaceEvent: boolean;
  page: number;
}

const pick = <T extends string>(values: string[], allowed: readonly T[]) => values.flatMap((v) => v.split(",")).filter((v): v is T => (allowed as readonly string[]).includes(v));

export function filterFromParams(params: URLSearchParams): AlarmFilter {
  // `state`는 `status`의 다른 이름(홈 알람 카드 링크 `/alarms?state=ACTIVE`, TC-DSH-004)
  const status = pick(params.getAll("status").length ? params.getAll("status") : params.getAll("state"), ALARM_STATUSES);
  const range = params.get("range");
  return {
    status: status.length ? status : [...OPEN_STATUSES],
    severity: pick(params.getAll("severity"), SEVERITIES),
    spaceId: params.get("spaceId") ?? "",
    ruleId: params.get("ruleId") ?? "",
    sourceType: (SOURCE_TYPES as readonly string[]).includes(params.get("sourceType") ?? "") ? (params.get("sourceType") as string) : "",
    range: (RANGES as readonly string[]).includes(range ?? "") ? (range as RangeKey) : "24h",
    groupBySpaceEvent: params.get("groupBySpaceEvent") === "true",
    page: Math.max(1, Number(params.get("page")) || 1),
  };
}

/** 화면 주소의 검색 매개변수(기본값은 넣지 않는다) */
export function filterToParams(filter: AlarmFilter): URLSearchParams {
  const params = new URLSearchParams();
  const defaultStatus = filter.status.length === OPEN_STATUSES.length && OPEN_STATUSES.every((s) => filter.status.includes(s));
  if (!defaultStatus) params.set("status", filter.status.join(","));
  if (filter.severity.length) params.set("severity", filter.severity.join(","));
  if (filter.spaceId) params.set("spaceId", filter.spaceId);
  if (filter.ruleId) params.set("ruleId", filter.ruleId);
  if (filter.sourceType) params.set("sourceType", filter.sourceType);
  if (filter.range !== "24h") params.set("range", filter.range);
  if (filter.groupBySpaceEvent) params.set("groupBySpaceEvent", "true");
  if (filter.page > 1) params.set("page", String(filter.page));
  return params;
}

const RANGE_MS: Record<Exclude<RangeKey, "all">, number> = { "24h": 86_400_000, "7d": 7 * 86_400_000, "30d": 30 * 86_400_000 };

/** API-RUL-10 쿼리(core AlarmController: status·severity·spaceId·ruleId·sourceType·deviceId·from·to·page·size) */
export function apiQuery(filter: AlarmFilter, nowMs: number, size = 50): URLSearchParams {
  const query = new URLSearchParams({ status: filter.status.join(","), page: String(filter.page), size: String(size) });
  if (filter.severity.length) query.set("severity", filter.severity.join(","));
  if (filter.spaceId) query.set("spaceId", filter.spaceId);
  if (filter.ruleId) query.set("ruleId", filter.ruleId);
  if (filter.sourceType) query.set("sourceType", filter.sourceType);
  if (filter.range !== "all") {
    query.set("from", new Date(nowMs - RANGE_MS[filter.range]).toISOString());
    query.set("to", new Date(nowMs).toISOString());
  }
  // 공간 이벤트 묶기는 화면이 한다(core API-RUL-10에는 묶기 매개변수가 없다)
  return query;
}

export function severityRank(severity: string): number {
  const index = (SEVERITIES as readonly string[]).indexOf(severity);
  return index < 0 ? SEVERITIES.length : index;
}

/** 기본 정렬: 심각도 → 발생 시각 내림차순 */
export function sortAlarms(alarms: Alarm[]): Alarm[] {
  return [...alarms].sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || Date.parse(b.raisedAt) - Date.parse(a.raisedAt));
}

export type AlarmEntry = { kind: "alarm"; alarm: Alarm; children: Alarm[] } | { kind: "event"; spaceEventId: string; alarms: Alarm[] };

/**
 * 목록 행 묶기: 같은 페이지에 상위가 있는 하위 알람은 상위 아래로(RUL-04.01).
 * `byEvent`면 공간 이벤트(space_event_id)가 같은 알람 2건 이상을 한 묶음으로(RUL-04.03)
 */
export function groupAlarms(alarms: Alarm[], byEvent: boolean): AlarmEntry[] {
  const sorted = sortAlarms(alarms);
  const ids = new Set(sorted.map((a) => a.id));
  const childrenOf = new Map<string, Alarm[]>();
  for (const alarm of sorted) {
    if (alarm.parentAlarmId && ids.has(alarm.parentAlarmId)) childrenOf.set(alarm.parentAlarmId, [...(childrenOf.get(alarm.parentAlarmId) ?? []), alarm]);
  }
  const tops = sorted.filter((a) => !(a.parentAlarmId && ids.has(a.parentAlarmId)));
  if (!byEvent) return tops.map((alarm) => ({ kind: "alarm", alarm, children: childrenOf.get(alarm.id) ?? [] }));
  const eventCount = new Map<string, number>();
  for (const a of tops) if (a.spaceEventId) eventCount.set(a.spaceEventId, (eventCount.get(a.spaceEventId) ?? 0) + 1);
  const out: AlarmEntry[] = [];
  const placed = new Map<string, Alarm[]>();
  for (const alarm of tops) {
    const eventId = alarm.spaceEventId;
    if (eventId && (eventCount.get(eventId) ?? 0) >= 2) {
      const bucket = placed.get(eventId);
      if (bucket) bucket.push(alarm);
      else {
        const list = [alarm];
        placed.set(eventId, list);
        out.push({ kind: "event", spaceEventId: eventId, alarms: list });
      }
    } else out.push({ kind: "alarm", alarm, children: childrenOf.get(alarm.id) ?? [] });
  }
  return out;
}

/** 지속 시간(초): 해제됐으면 해제까지, 아니면 지금까지 */
export function durationSec(alarm: Pick<Alarm, "raisedAt" | "clearedAt">, nowMs: number): number {
  const end = alarm.clearedAt ? Date.parse(alarm.clearedAt) : nowMs;
  return Math.max(0, Math.round((end - Date.parse(alarm.raisedAt)) / 1000));
}

export function spacePathText(space: Alarm["space"]): string {
  if (!space?.path) return "";
  if (typeof space.path === "string") return space.path;
  return space.path.map((p) => (typeof p === "string" ? p : (p.name ?? ""))).join(" / ");
}

/** 실시간 이벤트가 지금 필터에 맞는지(상태·심각도·규칙·출처. 공간은 서버가 권한 범위로 거른 뒤 하위 포함으로 맞춘다) */
export function matchesFilter(alarm: Alarm, filter: AlarmFilter, spaceIds?: Set<string>): boolean {
  if (!filter.status.includes(alarm.status)) return false;
  if (filter.severity.length && !filter.severity.includes(alarm.severity)) return false;
  if (filter.ruleId && alarm.source.ruleId !== filter.ruleId) return false;
  if (filter.sourceType && alarm.source.type !== filter.sourceType) return false;
  if (filter.spaceId && spaceIds && (!alarm.space?.id || !spaceIds.has(String(alarm.space.id)))) return false;
  return true;
}

export interface LiveState {
  alarms: Alarm[];
  counts: AlarmCounts;
}

function bump(counts: AlarmCounts, alarm: Alarm, delta: number): AlarmCounts {
  const byStatus = { ...counts.byStatus, [alarm.status]: Math.max(0, (counts.byStatus[alarm.status] ?? 0) + delta) };
  const bySeverity = alarm.status === "CLEARED" ? counts.bySeverity : { ...counts.bySeverity, [alarm.severity]: Math.max(0, (counts.bySeverity[alarm.severity] ?? 0) + delta) };
  return { byStatus, bySeverity };
}

const idText = (value: unknown): string | undefined => (value === null || value === undefined || value === "" ? undefined : String(value));

/**
 * SSE `alarm.*` 데이터(core는 EVT-RUL-02 AlarmSnapshot을 그대로 보낸다)를 목록 모양(API-RUL-10 Alarm)으로 맞춘다.
 * - ID(알람·규칙·기기·공간·상위·공간 이벤트)가 JSON 숫자로 오므로 문자열로 바꾼다
 * - 공간 `path`는 이름 경로가 아니라 ID 경로(`/1/7/31`)라 버린다(이미 보이는 행의 이름 경로를 지킨다)
 * - 이벤트에 없는 칸(기기 이름 등)은 키를 두지 않아, 병합할 때 기존 값을 지우지 않는다
 */
export function normalizeStreamAlarm(raw: Record<string, unknown>): Alarm {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) if (value !== undefined && value !== null) out[key] = value;
  out.id = String(raw.id);
  const source = raw.source as Record<string, unknown> | undefined;
  if (source) out.source = { ...source, ...(source.ruleId != null ? { ruleId: String(source.ruleId) } : {}) };
  const device = raw.device as Record<string, unknown> | undefined;
  if (device && device.id != null) out.device = { ...device, id: String(device.id) };
  const space = raw.space as Record<string, unknown> | undefined;
  if (space && space.id != null) {
    const next: Record<string, unknown> = { ...space, id: String(space.id) };
    if (next.path == null || (typeof next.path === "string" && /^(\/\d+)+\/?$/.test(next.path))) delete next.path;
    out.space = next;
  }
  for (const key of ["ackedBy", "assignee"] as const) {
    const user = raw[key] as Record<string, unknown> | undefined;
    if (user && user.userId != null) out[key] = { ...user, userId: String(user.userId) };
  }
  for (const key of ["parentAlarmId", "spaceEventId"] as const) {
    const text = idText(raw[key]);
    if (text) out[key] = text;
  }
  return out as unknown as Alarm;
}

/**
 * SSE 이벤트 하나를 목록에 반영한다. 새 알람은 맨 위(필터에 맞을 때만), 상태 변경은 그 자리에서, 필터에서 벗어나면 뺀다.
 * 돌려주는 `added`는 강조할 알람 ID
 */
export function applyAlarmEvent(state: LiveState, type: string, incoming: Alarm, filter: AlarmFilter, spaceIds?: Set<string>): LiveState & { added?: string } {
  const normalized = normalizeStreamAlarm(incoming as unknown as Record<string, unknown>);
  const index = state.alarms.findIndex((a) => a.id === normalized.id);
  const previous = index >= 0 ? state.alarms[index] : undefined;
  // 이름 경로가 없는 이벤트는 기존 행의 공간(이름 경로)을 이어 받는다
  const alarm: Alarm = previous?.space && normalized.space && !normalized.space.path && previous.space.id === normalized.space.id ? { ...normalized, space: previous.space } : normalized;
  const fits = matchesFilter(alarm, filter, spaceIds);
  let counts = previous ? bump(state.counts, previous, -1) : state.counts;
  if (fits && (previous || type === "alarm.raised")) counts = bump(counts, alarm, 1);
  if (!fits) return { alarms: state.alarms.filter((a) => a.id !== alarm.id), counts };
  if (previous) {
    const alarms = [...state.alarms];
    alarms[index] = { ...previous, ...alarm };
    return { alarms, counts };
  }
  if (type === "alarm.raised") return { alarms: [alarm, ...state.alarms], counts, added: alarm.id };
  return { alarms: state.alarms, counts };
}

export interface BulkResult {
  alarmId: string;
  ok: boolean;
  code?: string;
  alreadyAcked?: boolean;
}

export function bulkSummary(results: BulkResult[]): { ok: number; failed: number; failures: BulkResult[] } {
  const failures = results.filter((r) => !r.ok);
  return { ok: results.length - failures.length, failed: failures.length, failures };
}

/** 선택을 한도(200건)로 자른다 */
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** 알람 상세 타임라인(API-RUL-11 events) */
export interface AlarmEvent {
  type: string;
  at: string;
  actor?: { type?: string; id?: string; name?: string | null } | null;
  data?: Record<string, unknown> | null;
}

export function sortEvents(events: AlarmEvent[]): AlarmEvent[] {
  return [...events].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

/** 출처 링크: 규칙 → 규칙 편집, 플로우 → 플로우 편집기의 그 노드 */
export function sourceLink(alarm: Pick<Alarm, "source">): string | null {
  if (alarm.source.type === "RULE" && alarm.source.ruleId) return `/rules/${encodeURIComponent(alarm.source.ruleId)}`;
  if (alarm.source.type === "FLOW" && alarm.source.flowId) {
    const node = alarm.source.nodeId ? `?node=${encodeURIComponent(alarm.source.nodeId)}` : "";
    return `/automation/flows/${encodeURIComponent(alarm.source.flowId)}${node}`;
  }
  return null;
}

/** 확인할 수 있는 상태(CLEARED에서도 기록용 확인은 된다, domain-model §3) */
export function canAck(alarm: Pick<Alarm, "status" | "ackedAt">): boolean {
  return !alarm.ackedAt && alarm.status !== "ACKNOWLEDGED";
}

export function canClear(alarm: Pick<Alarm, "status">): boolean {
  return alarm.status !== "CLEARED";
}
