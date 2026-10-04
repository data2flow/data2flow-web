/**
 * 무음 일정 모델(UI-RUL-08, RUL-02.07, API-RUL-25, BR-RUL-14).
 * 일시 무음(ONE_TIME): 시작·끝(끝 > 시작). 반복 무음(RECURRING): 요일 + 시간대 또는 날짜 범위(예: 방학 2026-12-22~2027-02-28).
 */
export type SilenceTargetType = "RULE" | "DEVICE" | "SPACE" | "ALARM";
export const SILENCE_TARGETS: SilenceTargetType[] = ["RULE", "DEVICE", "SPACE"];
export const QUICK_SILENCE_MINUTES = [30, 60, 240, 1440] as const;

export interface Silence {
  silenceId: string;
  kind: "ONE_TIME" | "RECURRING";
  target: { type: SilenceTargetType; id: string; name?: string | null };
  startsAt?: string | null;
  endsAt?: string | null;
  recurrence?: { days?: number[]; from?: string; to?: string; dateFrom?: string; dateTo?: string } | null;
  reason?: string | null;
  active?: boolean;
  createdBy?: { userId: string; name: string } | null;
  createdAt?: string;
}

export interface SilenceInput {
  kind: "ONE_TIME" | "RECURRING";
  targetType: SilenceTargetType;
  targetId: string;
  /** ONE_TIME: UTC ISO */
  startsAt?: string;
  endsAt?: string;
  /** RECURRING */
  repeat?: "WEEKLY" | "DATES";
  days?: number[];
  from?: string;
  to?: string;
  dateFrom?: string;
  dateTo?: string;
  reason?: string;
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export type SilenceProblems = Partial<Record<"target" | "range" | "days" | "reason", string>>;

/** 문제 키(문구는 화면이 rules i18n으로) */
export function validateSilence(input: SilenceInput): SilenceProblems {
  const problems: SilenceProblems = {};
  if (!input.targetId) problems.target = "silences.v.target";
  if (input.kind === "ONE_TIME") {
    const start = Date.parse(input.startsAt ?? "");
    const end = Date.parse(input.endsAt ?? "");
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) problems.range = "errors.SILENCE_RANGE_INVALID";
  } else if (input.repeat === "DATES") {
    if (!DATE.test(input.dateFrom ?? "") || !DATE.test(input.dateTo ?? "") || (input.dateTo ?? "") < (input.dateFrom ?? "")) problems.range = "errors.SILENCE_RANGE_INVALID";
  } else {
    if (!input.days || input.days.length === 0) problems.days = "silences.v.days";
    if (!TIME.test(input.from ?? "") || !TIME.test(input.to ?? "") || input.from === input.to) problems.range = "errors.SILENCE_RANGE_INVALID";
  }
  if ((input.reason ?? "").length > 200) problems.reason = "silences.v.reason";
  return problems;
}

/** API-RUL-25 요청 본문 */
export function silencePayload(input: SilenceInput): Record<string, unknown> {
  const body: Record<string, unknown> = { kind: input.kind, target: { type: input.targetType, id: input.targetId } };
  if (input.reason?.trim()) body.reason = input.reason.trim();
  if (input.kind === "ONE_TIME") {
    body.startsAt = input.startsAt;
    body.endsAt = input.endsAt;
  } else if (input.repeat === "DATES") body.recurrence = { dateFrom: input.dateFrom, dateTo: input.dateTo };
  else body.recurrence = { days: [...(input.days ?? [])].sort((a, b) => a - b), from: input.from, to: input.to };
  return body;
}

/** 알람 빠른 무음(30분·1시간·4시간·24시간): 지금부터 */
export function quickSilence(target: { type: SilenceTargetType; id: string }, minutes: number, nowMs: number): Record<string, unknown> {
  return { kind: "ONE_TIME", target, startsAt: new Date(nowMs).toISOString(), endsAt: new Date(nowMs + minutes * 60_000).toISOString() };
}
