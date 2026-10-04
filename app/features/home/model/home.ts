/**
 * 홈 요약(UI-DSH-01, API-DSH-01)과 즐겨찾기(DSH-07.05, API-DSH-12) 도우미.
 */

export type ComfortState = "NORMAL" | "CAUTION" | "WARNING" | "UNKNOWN";

export interface ComfortCause {
  metricKey: string;
  value?: number | null;
  unit?: string | null;
  target?: string | { min?: number | null; max?: number | null } | null;
}

export interface ComfortRow {
  spaceId: string;
  spaceName: string;
  state: ComfortState | string;
  causes?: ComfortCause[];
  updatedAt?: string;
}

/** 타임라인 한 줄(API-DSH-01 `timeline[]`, DSH-01.03) */
export interface TimelineItem {
  type: "ALARM_RAISED" | "ALARM_CLEARED" | "CONTROL" | string;
  at: string;
  title: string;
  severity?: string | null;
  origin?: "USER" | "FLOW" | "RULE" | "SCHEDULE" | string | null;
  link?: string | null;
}

export interface HomeSummary {
  alarms?: { critical?: number; major?: number; minor?: number; warning?: number; info?: number };
  offlineDevices?: number;
  pendingDevices?: number | null;
  ingestPerMinute?: number;
  sources?: { connected: number; total: number } | null;
  comfort?: ComfortRow[];
  comfortTotal?: number;
  timeline?: TimelineItem[];
  aiSummary?: { text: string; reportId?: string } | null;
}

const ORDER: Record<string, number> = { WARNING: 0, CAUTION: 1, UNKNOWN: 2, NORMAL: 3 };

/** 나쁜 상태부터 최대 limit개, 나머지 수(“외 N곳”) */
export function topComfort(rows: ComfortRow[] | undefined, limit = 10, total?: number): { rows: ComfortRow[]; rest: number } {
  const sorted = [...(rows ?? [])].sort((a, b) => (ORDER[a.state] ?? 2) - (ORDER[b.state] ?? 2) || a.spaceName.localeCompare(b.spaceName));
  const shown = sorted.slice(0, limit);
  return { rows: shown, rest: Math.max(0, (total ?? sorted.length) - shown.length) };
}

/** 상태 배지 색·기호(색만으로 구분하지 않는다) */
export function comfortTone(state: string): { tone: "success" | "warning" | "danger" | "neutral"; icon: string } {
  if (state === "NORMAL") return { tone: "success", icon: "✔" };
  if (state === "CAUTION") return { tone: "warning", icon: "!" };
  if (state === "WARNING") return { tone: "danger", icon: "▲" };
  return { tone: "neutral", icon: "?" };
}

/** 원인 측정 항목 값의 표시 문자열(`co2 1150ppm`) */
export function causeText(cause: ComfortCause): string {
  const value = cause.value === null || cause.value === undefined ? "" : ` ${cause.value}${cause.unit ?? ""}`;
  return `${cause.metricKey}${value}`;
}

export const TIMELINE_LIMIT = 20;

const timelineKey = (item: TimelineItem) => `${item.type}|${item.at}|${item.title}|${item.link ?? ""}`;

/**
 * 새 타임라인 항목을 맨 위에 넣고 시각 내림차순 20건만 남긴다(TC-DSH-009). 같은 항목(종류·시각·제목·링크)은 한 번만
 */
export function mergeTimeline(previous: TimelineItem[] | undefined, incoming: TimelineItem[] | undefined, limit = TIMELINE_LIMIT): TimelineItem[] {
  const seen = new Set<string>();
  const out: TimelineItem[] = [];
  for (const item of [...(incoming ?? []), ...(previous ?? [])]) {
    const key = timelineKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, limit);
}

/**
 * 실시간 변경 부분을 이전 요약에 합친다(API-DSH-20 `home-summary`는 바뀐 부분만 보낸다).
 * 알람 수는 심각도별로 합치고, 타임라인은 새 항목을 위에 넣어 20건을 유지한다
 */
export function mergeSummary(previous: HomeSummary, patch: unknown): HomeSummary {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return previous;
  const next: HomeSummary = { ...previous, ...(patch as HomeSummary) };
  const p = patch as HomeSummary;
  if (p.alarms && previous.alarms) next.alarms = { ...previous.alarms, ...p.alarms };
  if (p.timeline) next.timeline = mergeTimeline(previous.timeline, p.timeline);
  return next;
}

/** 알람 카드의 심각도 표시(BR-DSH-02: 색만으로 구분하지 않고 기호·글자를 함께) */
export const SEVERITY_ICONS: Record<string, string> = { critical: "▲", major: "!", minor: "·", warning: "△", info: "i" };

export function severityParts(summary: HomeSummary): { key: "critical" | "major" | "minor" | "warning" | "info"; count: number; icon: string }[] {
  const a = summary.alarms ?? {};
  return (["critical", "major", "minor", "warning", "info"] as const)
    .map((key) => ({ key, count: a[key] ?? 0, icon: SEVERITY_ICONS[key] }))
    .filter((p) => p.count > 0 || p.key === "critical" || p.key === "major" || p.key === "minor");
}

/** 타임라인 기호(알람 발생 ▲, 해제 ✔, 제어 ⚙) */
export function timelineIcon(type: string): string {
  if (type === "ALARM_RAISED") return "▲";
  if (type === "ALARM_CLEARED") return "✔";
  if (type === "CONTROL") return "⚙";
  return "•";
}

/** 링크가 없으면 종류별 기본 목록(알람 목록, 명령 이력)으로 */
export function timelineLink(item: TimelineItem): string {
  if (item.link && item.link.startsWith("/") && !item.link.startsWith("//")) return item.link;
  return item.type === "CONTROL" ? "/control/commands" : "/alarms";
}

export function totalAlarms(summary: HomeSummary): number {
  const a = summary.alarms ?? {};
  return (a.critical ?? 0) + (a.major ?? 0) + (a.minor ?? 0) + (a.warning ?? 0) + (a.info ?? 0);
}

export interface Favorite {
  type: string;
  id: string;
  name?: string;
}

/** 즐겨찾기 켜고 끄기(같은 type·id가 있으면 빼고, 없으면 앞에 넣는다) */
export function toggleFavorite(favorites: Favorite[] | undefined, item: { type: string; id: string }): Favorite[] {
  const list = (favorites ?? []).map((f) => ({ type: f.type, id: String(f.id) }));
  const exists = list.some((f) => f.type === item.type && f.id === String(item.id));
  return exists ? list.filter((f) => !(f.type === item.type && f.id === String(item.id))) : [{ type: item.type, id: String(item.id) }, ...list];
}

export function isFavorite(favorites: Favorite[] | undefined, type: string, id: string): boolean {
  return (favorites ?? []).some((f) => f.type === type && String(f.id) === String(id));
}

/** 홈이 비어 있는지(공간·소스·기기가 하나도 없다) — 시작 안내(DSH-08.02) */
export function isEmptyOrganization(summary: HomeSummary | null, spaceCount: number): boolean {
  if (spaceCount > 0) return false;
  if (!summary) return true;
  return (summary.sources?.total ?? 0) === 0 && (summary.comfort?.length ?? 0) === 0;
}
