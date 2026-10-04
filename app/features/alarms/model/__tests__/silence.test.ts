/**
 * 무음 모델(UI-RUL-08, RUL-02.07, API-RUL-25) — 일시·반복(요일·날짜 범위) 검사와 본문, 빠른 무음.
 */
import { describe, expect, it } from "vitest";
import { quickSilence, silencePayload, validateSilence } from "../silence";

describe("RUL-02.07 무음 입력", () => {
  it("일시 무음: 끝 > 시작이어야 한다(SILENCE_RANGE_INVALID), 대상 필수", () => {
    expect(validateSilence({ kind: "ONE_TIME", targetType: "RULE", targetId: "", startsAt: "2026-10-04T01:00:00Z", endsAt: "2026-10-04T00:00:00Z" })).toEqual({ target: "silences.v.target", range: "errors.SILENCE_RANGE_INVALID" });
    expect(validateSilence({ kind: "ONE_TIME", targetType: "RULE", targetId: "r", startsAt: "2026-10-04T00:00:00Z", endsAt: "2026-10-04T01:00:00Z" })).toEqual({});
  });

  it("반복 무음: 요일·시각, 날짜 범위(방학), 사유 200자", () => {
    expect(validateSilence({ kind: "RECURRING", repeat: "WEEKLY", targetType: "SPACE", targetId: "31", days: [], from: "00:00", to: "00:00" })).toEqual({ days: "silences.v.days", range: "errors.SILENCE_RANGE_INVALID" });
    expect(validateSilence({ kind: "RECURRING", repeat: "DATES", targetType: "SPACE", targetId: "31", dateFrom: "2027-02-28", dateTo: "2026-12-22" })).toEqual({ range: "errors.SILENCE_RANGE_INVALID" });
    expect(validateSilence({ kind: "RECURRING", repeat: "DATES", targetType: "SPACE", targetId: "31", dateFrom: "2026-12-22", dateTo: "2027-02-28", reason: "x".repeat(201) })).toEqual({ reason: "silences.v.reason" });
  });

  it("본문: 일시는 startsAt·endsAt, 반복은 recurrence, 사유는 있으면", () => {
    expect(silencePayload({ kind: "ONE_TIME", targetType: "DEVICE", targetId: "1042", startsAt: "a", endsAt: "b", reason: " 점검 " })).toEqual({ kind: "ONE_TIME", target: { type: "DEVICE", id: "1042" }, startsAt: "a", endsAt: "b", reason: "점검" });
    expect(silencePayload({ kind: "RECURRING", repeat: "WEEKLY", targetType: "SPACE", targetId: "31", days: [7, 1], from: "00:00", to: "23:59" })).toEqual({ kind: "RECURRING", target: { type: "SPACE", id: "31" }, recurrence: { days: [1, 7], from: "00:00", to: "23:59" } });
    expect(silencePayload({ kind: "RECURRING", repeat: "DATES", targetType: "SPACE", targetId: "31", dateFrom: "2026-12-22", dateTo: "2027-02-28" })).toMatchObject({ recurrence: { dateFrom: "2026-12-22", dateTo: "2027-02-28" } });
    expect(quickSilence({ type: "ALARM", id: "9" }, 30, Date.parse("2026-10-04T00:00:00Z"))).toEqual({ kind: "ONE_TIME", target: { type: "ALARM", id: "9" }, startsAt: "2026-10-04T00:00:00.000Z", endsAt: "2026-10-04T00:30:00.000Z" });
  });
});
