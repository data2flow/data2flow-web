/**
 * DSC-06.01·06.02·06.04·06.05 외부 맥락 화면 규칙(UI-DSC-04 입력 검증, 호출량 경고).
 */
import { describe, expect, it } from "vitest";
import { checkContextInput, checkIcsFile, contextTone, costTotals, selectedItems, serverFieldCode, syncDelta, typeMappingBody, typeMappingRows, usageLevel } from "../context";

describe("UI-DSC-04 입력 검증", () => {
  it("TC-DSC-144 켤 때 API 키 필수(저장된 키가 있으면 통과), 격자 범위", () => {
    expect(checkContextInput("AIRKOREA", { enabled: true, apiKey: " " })).toEqual({ apiKey: "apiKeyRequired" });
    expect(checkContextInput("AIRKOREA", { enabled: true, apiKeyConfigured: true })).toEqual({});
    expect(checkContextInput("AIRKOREA", { enabled: false })).toEqual({});
    expect(checkContextInput("KMA_WEATHER", { enabled: true, apiKey: "k", nx: "150", ny: "0" })).toEqual({ nx: "gridRange", ny: "gridRange" });
    expect(checkContextInput("KMA_WEATHER", { enabled: true, apiKey: "k", nx: "58", ny: "74", dailyQuota: "0", unitCost: "-1" })).toEqual({ dailyQuota: "positiveInteger", unitCost: "costRange" });
  });

  it("TC-DSC-156 iCal은 https·webcal만, 켤 때 주소나 파일, 갱신 1~168시간; 파일은 .ics 2MB 이하", () => {
    expect(checkContextInput("ICAL", { enabled: true, url: "http://x/a.ics" })).toEqual({ url: "icalUrl" });
    expect(checkContextInput("ICAL", { enabled: true, url: "" })).toEqual({ url: "icalSourceRequired" });
    expect(checkContextInput("ICAL", { enabled: true, url: "webcal://x/a.ics", refreshHours: "200" })).toEqual({ refreshHours: "refreshRange" });
    expect(checkContextInput("ICAL", { enabled: true, hasFile: true })).toEqual({});
    expect(checkIcsFile({ name: "a.ics", size: 100 })).toBeNull();
    expect(checkIcsFile({ name: "a.txt", size: 100 })).toBe("NOT_ICS");
    expect(checkIcsFile({ name: "a.ics", size: 3 * 1024 * 1024 })).toBe("TOO_LARGE");
  });

  it("서버 검증 코드를 화면 문구 키로", () => {
    expect(serverFieldCode("apiKey", "NotBlank")).toBe("apiKeyRequired");
    expect(serverFieldCode("url", "INVALID")).toBe("icalUrl");
    expect(serverFieldCode("url", "NotBlank")).toBe("icalSourceRequired");
    expect(serverFieldCode("nx", "Range")).toBe("gridRange");
    expect(serverFieldCode("refreshHours", "Range")).toBe("refreshRange");
    expect(serverFieldCode("unitCost", "Range")).toBe("costRange");
    expect(serverFieldCode("stationName", "Size")).toBe("Size");
  });
});

describe("TC-DSC-162 호출량", () => {
  it("80% 이상 경고, 100% 또는 서버 exhausted면 중지, 한도 없으면 비율 없음", () => {
    expect(usageLevel({ calls: 799, quota: 1000 })).toEqual({ pct: 80, level: "ok" });
    expect(usageLevel({ calls: 800, quota: 1000 })).toEqual({ pct: 80, level: "warn" });
    expect(usageLevel({ calls: 1000, quota: 1000 })).toEqual({ pct: 100, level: "exhausted" });
    expect(usageLevel({ calls: 5, quota: null, warning: true })).toEqual({ pct: null, level: "warn" });
    expect(usageLevel({ calls: 5, exhausted: true })).toEqual({ pct: null, level: "exhausted" });
  });

  it("비용 합계(오늘·이번 달), 단가가 없으면 없음", () => {
    const days = [
      { day: "2026-09-30", calls: 1, failures: 0, warning: false, exhausted: false, cost: 100 },
      { day: "2026-10-01", calls: 1, failures: 0, warning: false, exhausted: false, cost: 10 },
      { day: "2026-10-04", calls: 1, failures: 0, warning: false, exhausted: false, cost: 5 },
    ];
    expect(costTotals(days, "2026-10-04")).toEqual({ today: 5, month: 15 });
    expect(costTotals(days.map((d) => ({ ...d, cost: null })), "2026-10-04")).toBeNull();
  });
});

describe("카드 표시 도우미", () => {
  it("동기화 결과·매핑·항목·상태 톤", () => {
    expect(syncDelta({ added: 2, updated: 0, removed: 1 })).toBe("+2 −1");
    expect(syncDelta({ added: 0, updated: 3, removed: 0 })).toBe("+0 ~3 −0");
    expect(syncDelta(null)).toBe("");
    expect(typeMappingBody([{ category: " 시험 ", type: "EXAM" }, { category: "", type: "EVENT" }, { category: "x", type: "BAD" }])).toEqual({ 시험: "EXAM" });
    expect(Object.keys(typeMappingBody(Array.from({ length: 60 }, (_, i) => ({ category: `c${i}`, type: "EVENT" }))))).toHaveLength(50);
    expect(typeMappingRows({ typeMapping: { 시험: "EXAM" } }, ["시험", "방학"])).toEqual([{ category: "시험", type: "EXAM" }, { category: "방학", type: "EVENT" }]);
    expect(typeMappingRows(null)).toEqual([]);
    expect(selectedItems({ items: ["T1H"] }, ["REH"])).toEqual(["T1H"]);
    expect(selectedItems({}, ["REH"])).toEqual(["REH"]);
    const base = { type: "KMA_WEATHER", enabled: true, apiKeyConfigured: true };
    expect(contextTone({ ...base, enabled: false })).toBe("muted");
    expect(contextTone({ ...base, connectionState: "ERROR" })).toBe("bad");
    expect(contextTone({ ...base, usageToday: { calls: 1, failures: 0, warning: true, exhausted: false } })).toBe("warn");
    expect(contextTone(base)).toBe("good");
  });
});
