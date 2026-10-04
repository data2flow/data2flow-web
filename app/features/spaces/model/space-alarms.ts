/**
 * 공간 보기의 열린 알람(DSH-02.01, UI-DSH-02 알람 탭). 목록은 API-RUL-10(`spaceId`는 하위 공간 포함),
 * 실시간은 API-DSH-20 `alarms` 토픽의 `alarm` 이벤트 `{alarmId, state, severity, spaceId, title}`로 고친다.
 */

export const SEVERITY_ORDER = ["CRITICAL", "MAJOR", "MINOR", "WARNING", "INFO"] as const;

/** API-RUL-10 Alarm 중 공간 보기가 쓰는 필드 */
export interface SpaceAlarm {
  id: string;
  severity: string;
  status: string;
  title: string;
  device?: { id: string; name?: string } | null;
  space?: { id: string; path?: string } | null;
  raisedAt?: string | null;
  lastRaisedAt?: string | null;
  flapping?: boolean;
}

/** `alarms` 토픽 이벤트(API-DSH-20) */
export interface AlarmEvent {
  alarmId: string | number;
  state: string;
  severity?: string;
  spaceId?: string | number | null;
  title?: string;
}

const OPEN = new Set(["ACTIVE", "ACKNOWLEDGED", "SUPPRESSED"]);

export function isOpen(status: string): boolean {
  return OPEN.has(status);
}

const rank = (severity: string) => {
  const index = (SEVERITY_ORDER as readonly string[]).indexOf(severity);
  return index < 0 ? SEVERITY_ORDER.length : index;
};

/** 심각도 높은 순, 같으면 최근 발생 순 */
export function sortAlarms(alarms: SpaceAlarm[]): SpaceAlarm[] {
  return [...alarms].sort((a, b) => rank(a.severity) - rank(b.severity) || Date.parse(b.lastRaisedAt ?? b.raisedAt ?? "") - Date.parse(a.lastRaisedAt ?? a.raisedAt ?? "") || 0);
}

/**
 * 실시간 이벤트 반영: 해제(CLEARED)는 빼고, 아는 알람은 상태·심각도를 고치고, 모르는 열린 알람은 이 공간(하위 포함)일 때만 넣는다.
 * `spaceIds`는 보고 있는 공간과 그 하위 공간 ID
 */
export function applyAlarmEvent(alarms: SpaceAlarm[], event: AlarmEvent, spaceIds: ReadonlySet<string>, now: string): SpaceAlarm[] {
  const id = String(event.alarmId);
  if (!isOpen(event.state)) return alarms.filter((a) => a.id !== id);
  const existing = alarms.find((a) => a.id === id);
  if (existing) return sortAlarms(alarms.map((a) => (a.id === id ? { ...a, status: event.state, severity: event.severity ?? a.severity, title: event.title ?? a.title } : a)));
  if (event.spaceId === undefined || event.spaceId === null || !spaceIds.has(String(event.spaceId))) return alarms;
  return sortAlarms([...alarms, { id, status: event.state, severity: event.severity ?? "INFO", title: event.title ?? "", space: { id: String(event.spaceId) }, raisedAt: now }]);
}

/** 기기별 열린 알람 수(기기 카드 배지) */
export function alarmCountByDevice(alarms: SpaceAlarm[] | undefined): Map<string, { count: number; worst: string }> {
  const out = new Map<string, { count: number; worst: string }>();
  for (const a of alarms ?? []) {
    if (!a.device?.id || !isOpen(a.status)) continue;
    const key = String(a.device.id);
    const current = out.get(key);
    out.set(key, { count: (current?.count ?? 0) + 1, worst: current && rank(current.worst) <= rank(a.severity) ? current.worst : a.severity });
  }
  return out;
}

/** 심각도 배지 색·기호(색만으로 구분하지 않는다) */
export function severityTone(severity: string): { tone: "danger" | "warning" | "info" | "neutral"; icon: string } {
  if (severity === "CRITICAL") return { tone: "danger", icon: "▲" };
  if (severity === "MAJOR") return { tone: "warning", icon: "!" };
  if (severity === "MINOR" || severity === "WARNING") return { tone: "info", icon: "·" };
  return { tone: "neutral", icon: "i" };
}
