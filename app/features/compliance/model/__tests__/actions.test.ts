/** CMP-02.05 개선 조치 입력 검사·본문(UI-CMP-10), 결과 문구 */
import { describe, expect, it } from "vitest";
import { actionBody, parseIds, resultSummary, validateActionForm, type ActionForm } from "../actions";

const form = (extra: Partial<ActionForm> = {}): ActionForm => ({
  cause: "VENTILATION",
  causeNote: "",
  actionText: "환기 장치 필터 교체",
  actorUserId: "7",
  actedAt: "2026-10-02T11:00",
  linkedAlarmIds: [],
  linkedWorkOrderIds: [],
  resultMode: "AUTO",
  resultNote: "",
  ...extra,
});
const START = "2026-10-02T01:00:00Z";
const NOW = "2026-10-04T00:00:00Z";

describe("validateActionForm", () => {
  it("정상 값은 오류가 없다", () => {
    expect(validateActionForm(form(), "2026-10-02T02:00:00Z", START, NOW)).toEqual({});
  });

  it("원인·기타 메모·조치 내용·조치 일시·수동 결과를 검사한다", () => {
    expect(validateActionForm(form({ cause: "" }), "2026-10-02T02:00:00Z", START, NOW).cause).toBe("causeRequired");
    expect(validateActionForm(form({ cause: "OTHER" }), "2026-10-02T02:00:00Z", START, NOW).causeNote).toBe("causeNoteRequired");
    expect(validateActionForm(form({ actionText: " " }), "2026-10-02T02:00:00Z", START, NOW).actionText).toBe("actionRequired");
    expect(validateActionForm(form({ actionText: "가".repeat(1001) }), "2026-10-02T02:00:00Z", START, NOW).actionText).toBe("actionTooLong");
    expect(validateActionForm(form(), null, START, NOW).actedAt).toBe("actedAtRequired");
    expect(validateActionForm(form(), "2026-10-02T00:59:00Z", START, NOW).actedAt).toBe("beforeExcursion");
    expect(validateActionForm(form(), "2026-10-05T00:00:00Z", START, NOW).actedAt).toBe("future");
    expect(validateActionForm(form({ resultMode: "MANUAL" }), "2026-10-02T02:00:00Z", START, NOW).resultNote).toBe("resultNoteRequired");
  });
});

describe("actionBody·parseIds·resultSummary", () => {
  it("자동 결과면 결과 메모를 보내지 않고, 빈 메모는 null", () => {
    expect(actionBody(form({ resultNote: "무시" }), "2026-10-02T02:00:00Z")).toEqual({
      cause: "VENTILATION", causeNote: null, actionText: "환기 장치 필터 교체", actorUserId: "7", actedAt: "2026-10-02T02:00:00Z",
      linkedAlarmIds: [], linkedWorkOrderIds: [], resultMode: "AUTO", resultNote: null,
    });
  });

  it("ID는 숫자만, 중복 없이", () => {
    expect(parseIds("12, 13 12,x 14")).toEqual(["12", "13", "14"]);
    expect(parseIds("")).toEqual([]);
  });

  it("결과 문구: 충족률은 정수 %", () => {
    expect(resultSummary({ resultStatus: "CONFIRMED", resultRatio24h: 97.99 })).toEqual({ key: "confirmed", ratio: 98 });
    expect(resultSummary({ resultStatus: "RECORDED", resultNote: "정상" })).toEqual({ key: "recorded", note: "정상" });
    expect(resultSummary({ resultStatus: "UNVERIFIABLE" })).toEqual({ key: "unverifiable" });
    expect(resultSummary({ resultStatus: "PENDING" })).toEqual({ key: "pending" });
  });
});
