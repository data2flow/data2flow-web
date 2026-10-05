/**
 * 조직 달력(UI-DEV-14, DEV-12.01, API-DEV-100~102): 공휴일(HOLIDAY_API)·가져온 학사일정(ICAL)·직접 등록(MANUAL) 일정.
 * 날짜는 사이트 시간대 기준 `YYYY-MM-DD`(서버 LocalDate)라 시간대 변환 없이 날짜 문자열로 계산한다. 주는 월요일부터.
 */
export const EVENT_TYPES = ["HOLIDAY", "CLOSURE", "EVENT", "VACATION", "EXAM", "OTHER"] as const;
export const AFFECTS_MODES = ["HOLIDAY", "UNOCCUPIED", "NONE"] as const;
export const MAX_EVENT_DAYS = 366;
export type CalendarView = "month" | "week" | "list";

export interface CalendarEvent {
  id: string;
  title: string;
  type: string;
  startsOn: string;
  endsOn: string;
  startTime?: string | null;
  endTime?: string | null;
  scopeSpaceIds?: string[];
  origin: string;
  affectsMode?: string | null;
  sourceId?: string | null;
  locallyModified?: boolean;
  originDeleted?: boolean;
  version: number;
}

const DAY = 86_400_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function toDay(date: string): number {
  return Date.parse(`${date}T00:00:00Z`) / DAY;
}

export function fromDay(day: number): string {
  return new Date(day * DAY).toISOString().slice(0, 10);
}

export function addDays(date: string, n: number): string {
  return fromDay(toDay(date) + n);
}

/** 종류별 기본 운영 모드 영향(core CalendarModels.defaultAffects와 같음) */
export function defaultAffects(type: string): string {
  if (type === "HOLIDAY" || type === "CLOSURE") return "HOLIDAY";
  if (type === "VACATION") return "UNOCCUPIED";
  return "NONE";
}

export interface EventInput {
  title: string;
  type: string;
  startsOn: string;
  endsOn: string;
  startTime?: string;
  endTime?: string;
}

/** 입력 검증(UI-DEV-14): 시작 ≤ 종료, 기간 최대 366일, 제목 1~150자, 시간은 둘 다 있거나 둘 다 없음 */
export function checkEvent(input: EventInput): Record<string, string> {
  const errors: Record<string, string> = {};
  const title = input.title.trim();
  if (!title) errors.title = "required";
  else if (title.length > 150) errors.title = "tooLong";
  if (!(EVENT_TYPES as readonly string[]).includes(input.type)) errors.type = "required";
  if (!DATE.test(input.startsOn)) errors.startsOn = "required";
  if (!DATE.test(input.endsOn)) errors.endsOn = "required";
  if (!errors.startsOn && !errors.endsOn) {
    const span = toDay(input.endsOn) - toDay(input.startsOn);
    if (span < 0) errors.endsOn = "startAfterEnd";
    else if (span + 1 > MAX_EVENT_DAYS) errors.endsOn = "tooLong366";
  }
  const hasStart = Boolean(input.startTime);
  const hasEnd = Boolean(input.endTime);
  if (hasStart !== hasEnd) errors.endTime = "timePair";
  else if (hasStart && input.startsOn === input.endsOn && input.startTime! >= input.endTime!) errors.endTime = "timeOrder";
  return errors;
}

/** 월요일 시작 주의 첫날 */
export function weekStart(date: string): string {
  const dow = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
  return addDays(date, -dow);
}

export function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

export function shiftMonth(date: string, n: number): string {
  const [y, m] = date.slice(0, 7).split("-").map(Number);
  const total = y * 12 + (m - 1) + n;
  return `${String(Math.floor(total / 12)).padStart(4, "0")}-${String((total % 12) + 1).padStart(2, "0")}-01`;
}

/** 보기 범위 [from, to](포함). 월 보기는 달력 칸 전체(앞뒤 주 포함) */
export function viewRange(view: CalendarView, anchor: string): { from: string; to: string } {
  if (view === "week") {
    const from = weekStart(anchor);
    return { from, to: addDays(from, 6) };
  }
  const first = monthStart(anchor);
  const last = addDays(shiftMonth(first, 1), -1);
  if (view === "list") return { from: first, to: last };
  const from = weekStart(first);
  const to = addDays(weekStart(last), 6);
  return { from, to };
}

export function shiftAnchor(view: CalendarView, anchor: string, n: number): string {
  return view === "week" ? addDays(weekStart(anchor), 7 * n) : shiftMonth(anchor, n);
}

export function eventsOn(events: readonly CalendarEvent[], date: string): CalendarEvent[] {
  const d = toDay(date);
  return events.filter((e) => toDay(e.startsOn) <= d && d <= toDay(e.endsOn));
}

export interface DayCell {
  date: string;
  inMonth: boolean;
  today: boolean;
  events: CalendarEvent[];
}

/** 주 단위 칸(월 보기 6주 이하, 주 보기 1주) */
export function calendarWeeks(view: CalendarView, anchor: string, events: readonly CalendarEvent[], today: string): DayCell[][] {
  const { from, to } = viewRange(view === "list" ? "month" : view, anchor);
  const month = anchor.slice(0, 7);
  const weeks: DayCell[][] = [];
  for (let d = toDay(from); d <= toDay(to); d += 7) {
    weeks.push(
      Array.from({ length: 7 }, (_, i) => {
        const date = fromDay(d + i);
        return { date, inMonth: view === "week" || date.startsWith(month), today: date === today, events: eventsOn(events, date) };
      }),
    );
  }
  return weeks;
}

/** 목록 보기: 시작일 순 */
export function sortedEvents(events: readonly CalendarEvent[]): CalendarEvent[] {
  return [...events].sort((a, b) => a.startsOn.localeCompare(b.startsOn) || a.title.localeCompare(b.title));
}

/** 자동 생성 일정(공휴일·iCal)은 운영 모드 영향만 바꿀 수 있고 삭제할 수 없다(API-DEV-102, BR-DSC-18) */
export function isAutoGenerated(event: Pick<CalendarEvent, "origin">): boolean {
  return event.origin !== "MANUAL";
}

/** PATCH 본문: 바뀐 키만 + baseVersion. 자동 생성 일정은 affectsMode만 */
export function eventPatch(before: CalendarEvent, input: EventInput & { affectsMode: string; scopeSpaceIds: string[] }): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (isAutoGenerated(before)) {
    if (input.affectsMode !== before.affectsMode) body.affectsMode = input.affectsMode;
  } else {
    if (input.title.trim() !== before.title) body.title = input.title.trim();
    if (input.type !== before.type) body.type = input.type;
    if (input.startsOn !== before.startsOn) body.startsOn = input.startsOn;
    if (input.endsOn !== before.endsOn) body.endsOn = input.endsOn;
    if ((input.startTime || null) !== (before.startTime ?? null)) body.startTime = input.startTime || null;
    if ((input.endTime || null) !== (before.endTime ?? null)) body.endTime = input.endTime || null;
    if (input.affectsMode !== before.affectsMode) body.affectsMode = input.affectsMode;
    const scopeBefore = [...(before.scopeSpaceIds ?? [])].map(String).sort().join(",");
    if ([...input.scopeSpaceIds].sort().join(",") !== scopeBefore) body.scopeSpaceIds = input.scopeSpaceIds;
  }
  body.baseVersion = before.version;
  return body;
}

/** 유형별 색(색 + 글자로 표시, NFR-08.03) */
export const TYPE_CLASS: Record<string, string> = {
  HOLIDAY: "border-bad bg-bad-soft text-bad-ink",
  CLOSURE: "border-bad bg-bad-soft text-bad-ink",
  VACATION: "border-fair bg-fair-soft text-fair-ink",
  EXAM: "border-accent bg-accent-soft text-accent",
  EVENT: "border-good bg-good-soft text-good-ink",
  OTHER: "border-line bg-panel text-muted",
};

export const ORIGIN_ICON: Record<string, string> = { MANUAL: "✎", HOLIDAY_API: "★", ICAL: "⇩" };
