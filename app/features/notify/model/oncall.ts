/**
 * UI-RUL-09 당직 일정 모델(RUL-05.03, BR-RUL-19, API-RUL-26). 주간 달력 칸 만들기, 근무표 검증, 대체 근무 검증.
 */
import { idOf, rowsOf, type OnCallCurrent, type OnCallOverride, type OnCallSchedule, type OnCallShift } from "./types";

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
export const DAYS = [1, 2, 3, 4, 5, 6, 7] as const;

/** 시간대(행)마다 요일(열)의 담당자. 시간대는 시작 시각 순 */
export interface ShiftGrid {
  bands: { from: string; to: string; cells: Record<number, OnCallShift | undefined> }[];
}

export function shiftGrid(shifts: OnCallShift[]): ShiftGrid {
  const bands = new Map<string, ShiftGrid["bands"][number]>();
  for (const shift of shifts) {
    const key = `${shift.from}-${shift.to}`;
    const band = bands.get(key) ?? { from: shift.from, to: shift.to, cells: {} };
    band.cells[shift.dayOfWeek] = shift;
    bands.set(key, band);
  }
  return { bands: [...bands.values()].sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to)) };
}

/** 분 단위 구간(자정을 넘는 근무는 두 조각) */
function minutes(value: string) {
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
}

function ranges(shift: OnCallShift): { day: number; from: number; to: number }[] {
  const from = minutes(shift.from);
  const to = minutes(shift.to);
  if (to > from) return [{ day: shift.dayOfWeek, from, to }];
  const next = (shift.dayOfWeek % 7) + 1;
  return [
    { day: shift.dayOfWeek, from, to: 24 * 60 },
    ...(to > 0 ? [{ day: next, from: 0, to }] : []),
  ];
}

export type ShiftProblem = { index: number; code: "dayInvalid" | "timeFormat" | "timeSame" | "userRequired" | "overlap" };

/** 근무표 검증. 같은 시각에 두 사람이 겹치면 overlap(당직자는 한 명) */
export function checkShifts(shifts: OnCallShift[]): ShiftProblem | undefined {
  for (const [index, s] of shifts.entries()) {
    if (!Number.isInteger(s.dayOfWeek) || s.dayOfWeek < 1 || s.dayOfWeek > 7) return { index, code: "dayInvalid" };
    if (!HHMM.test(s.from) || !HHMM.test(s.to)) return { index, code: "timeFormat" };
    if (s.from === s.to) return { index, code: "timeSame" };
    if (!s.userId) return { index, code: "userRequired" };
  }
  const all = shifts.flatMap((s, index) => ranges(s).map((r) => ({ ...r, index })));
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i];
      const b = all[j];
      if (a.index !== b.index && a.day === b.day && a.from < b.to && b.from < a.to) return { index: Math.max(a.index, b.index), code: "overlap" };
    }
  }
  return undefined;
}

export type OverrideProblem = "rangeInvalid" | "substituteRequired" | "sameUser";

export function checkOverride(input: { startsAt?: string; endsAt?: string; originalUserId?: string; substituteUserId?: string }): OverrideProblem | undefined {
  const start = input.startsAt ? Date.parse(input.startsAt) : NaN;
  const end = input.endsAt ? Date.parse(input.endsAt) : NaN;
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return "rangeInvalid";
  if (!input.substituteUserId) return "substituteRequired";
  if (input.originalUserId && input.originalUserId === input.substituteUserId) return "sameUser";
  return undefined;
}

/** 클라이언트 근무표 편집기가 보내는 JSON(`shifts`) */
export function parseShifts(raw: string): OnCallShift[] | undefined {
  try {
    const value = JSON.parse(raw || "[]") as unknown;
    if (!Array.isArray(value)) return undefined;
    return value.map((row) => {
      const r = row as Record<string, unknown>;
      return { dayOfWeek: Number(r.dayOfWeek), from: String(r.from ?? ""), to: String(r.to ?? ""), userId: String(r.userId ?? "").trim() };
    });
  } catch {
    return undefined;
  }
}

export function normalizeSchedule(raw: Record<string, unknown> | null | undefined): OnCallSchedule {
  const r = raw ?? {};
  return {
    name: String(r.name ?? ""),
    timezone: String(r.timezone ?? "Asia/Seoul"),
    shifts: rowsOf<Record<string, unknown>>(r.shifts).map((s) => ({ dayOfWeek: Number(s.dayOfWeek), from: String(s.from ?? ""), to: String(s.to ?? ""), userId: String(s.userId ?? ""), userName: (s.userName ?? s.name ?? null) as string | null })),
    overrides: rowsOf<Record<string, unknown>>(r.overrides).map(normalizeOverride),
    version: Number(r.version ?? 0),
  };
}

export function normalizeOverride(o: Record<string, unknown>): OnCallOverride {
  return {
    overrideId: idOf(o, "overrideId"),
    startsAt: String(o.startsAt ?? ""),
    endsAt: String(o.endsAt ?? ""),
    originalUserId: o.originalUserId === undefined || o.originalUserId === null ? null : String(o.originalUserId),
    originalUserName: (o.originalUserName as string | undefined) ?? null,
    substituteUserId: String(o.substituteUserId ?? ""),
    substituteUserName: (o.substituteUserName as string | undefined) ?? null,
  };
}

export function normalizeCurrent(raw: Record<string, unknown> | null | undefined): OnCallCurrent {
  return { userId: raw?.userId ? String(raw.userId) : null, name: (raw?.name as string | undefined) ?? null, until: (raw?.until as string | undefined) ?? null };
}
