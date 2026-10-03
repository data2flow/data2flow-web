import { zonedDate, zonedDayStartUtc } from "./format";

/** 감사 로그 검색 조건(UI-IAM-11, API-IAM-50) */
export const AUDIT_FILTERS = ["actorType", "actor", "action", "targetType", "targetId", "result", "ip"] as const;
const MAX_RANGE_DAYS = 366;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** 화면 날짜(사용자 시간대) → API 기간(UTC, from 포함·to 제외) */
export function auditQuery(search: URLSearchParams, timezone: string, nowMs: number) {
  const valid = (value: string | null) => (value && DATE.test(value) && !Number.isNaN(Date.parse(value)) ? value : undefined);
  const fromDate = valid(search.get("from")) ?? zonedDate(nowMs, timezone, -7);
  const toDate = valid(search.get("to")) ?? zonedDate(nowMs, timezone, 0);
  const from = zonedDayStartUtc(fromDate, timezone);
  const toExclusive = zonedDayStartUtc(zonedDate(Date.parse(`${toDate}T12:00:00Z`), "UTC", 1), timezone);
  const query = new URLSearchParams();
  if (from) query.set("from", from);
  if (toExclusive) query.set("to", toExclusive);
  for (const key of AUDIT_FILTERS) {
    const value = search.get(key);
    if (value) query.set(key, value);
  }
  const tooLong = Boolean(from && toExclusive && Date.parse(toExclusive) - Date.parse(from) > MAX_RANGE_DAYS * 86_400_000);
  return { query, fromDate, toDate, tooLong };
}

