/**
 * 홈 요약(DSH-01.02)·즐겨찾기(DSH-07.05) 도우미.
 */
import { describe, expect, it } from "vitest";
import { causeText, comfortTone, isEmptyOrganization, isFavorite, mergeSummary, mergeTimeline, severityParts, timelineIcon, timelineLink, toggleFavorite, topComfort, totalAlarms } from "../model/home";

describe("TC-DSH-007 공간 쾌적도 목록", () => {
  it("나쁜 상태부터 상위 10개 + 외 N곳", () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({ spaceId: String(i), spaceName: `실${String(i).padStart(2, "0")}`, state: i === 5 ? "WARNING" : i === 7 ? "CAUTION" : "NORMAL" }));
    const { rows: top, rest } = topComfort(rows);
    expect(top).toHaveLength(10);
    expect(top[0].state).toBe("WARNING");
    expect(top[1].state).toBe("CAUTION");
    expect(rest).toBe(2);
    expect(topComfort(rows.slice(0, 3), 10, 25).rest).toBe(22);
    expect(topComfort(undefined)).toEqual({ rows: [], rest: 0 });
  });

  it("상태 배지는 색과 기호를 함께, 원인 값 문자열", () => {
    expect(comfortTone("NORMAL")).toEqual({ tone: "success", icon: "✔" });
    expect(comfortTone("CAUTION").icon).toBe("!");
    expect(comfortTone("WARNING").tone).toBe("danger");
    expect(comfortTone("X").tone).toBe("neutral");
    expect(causeText({ metricKey: "co2", value: 1150, unit: "ppm" })).toBe("co2 1150ppm");
    expect(causeText({ metricKey: "co2" })).toBe("co2");
  });
});

describe("실시간 요약 합치기·알람 합계·빈 조직", () => {
  it("바뀐 부분만 덮고 알람 수는 항목별로 합친다", () => {
    const base = { alarms: { critical: 1, major: 2 }, offlineDevices: 2 };
    expect(mergeSummary(base, { alarms: { critical: 3 } })).toEqual({ alarms: { critical: 3, major: 2 }, offlineDevices: 2 });
    expect(mergeSummary(base, null)).toBe(base);
    expect(mergeSummary(base, [1])).toBe(base);
    expect(mergeSummary({}, { alarms: { minor: 1 } })).toEqual({ alarms: { minor: 1 } });
    expect(totalAlarms({ alarms: { critical: 1, major: 3, minor: 2, warning: 1, info: 1 } })).toBe(8);
    expect(totalAlarms({})).toBe(0);
  });

  it("DSH-08.02 공간·소스·쾌적도가 하나도 없으면 빈 조직", () => {
    expect(isEmptyOrganization(null, 0)).toBe(true);
    expect(isEmptyOrganization({ sources: { connected: 0, total: 0 }, comfort: [] }, 0)).toBe(true);
    expect(isEmptyOrganization({ sources: { connected: 1, total: 1 } }, 0)).toBe(false);
    expect(isEmptyOrganization(null, 2)).toBe(false);
  });
});

describe("TC-DSH-079 즐겨찾기", () => {
  it("켜면 앞에 넣고, 다시 누르면 뺀다", () => {
    const on = toggleFavorite([{ type: "DEVICE", id: "1042", name: "AM107" }], { type: "SPACE", id: "31" });
    expect(on).toEqual([{ type: "SPACE", id: "31" }, { type: "DEVICE", id: "1042" }]);
    expect(isFavorite(on, "SPACE", "31")).toBe(true);
    expect(toggleFavorite(on, { type: "SPACE", id: "31" })).toEqual([{ type: "DEVICE", id: "1042" }]);
    expect(toggleFavorite(undefined, { type: "SPACE", id: "1" })).toHaveLength(1);
    expect(isFavorite(undefined, "SPACE", "1")).toBe(false);
  });
});

describe("[DSH-01.03] 타임라인 합치기", () => {
  it("TC-DSH-009 새 항목을 위에, 같은 항목은 한 번, 시각 내림차순 20건", () => {
    const old = Array.from({ length: 20 }, (_, i) => ({ type: "CONTROL", at: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(), title: `c${i}` }));
    const merged = mergeTimeline(old, [{ type: "ALARM_RAISED", at: "2026-01-01T01:00:00Z", title: "new" }, old[19]]);
    expect(merged).toHaveLength(20);
    expect(merged[0].title).toBe("new");
    expect(merged.filter((m) => m.title === "c19")).toHaveLength(1);
    expect(merged.some((m) => m.title === "c0")).toBe(false);
    expect(mergeTimeline(undefined, undefined)).toEqual([]);
    expect(mergeSummary({ timeline: old }, { timeline: [] }).timeline).toHaveLength(20);
  });

  it("기호·링크·심각도 표시", () => {
    expect(timelineIcon("ALARM_RAISED")).toBe("▲");
    expect(timelineIcon("ALARM_CLEARED")).toBe("✔");
    expect(timelineIcon("CONTROL")).toBe("⚙");
    expect(timelineIcon("X")).toBe("•");
    expect(timelineLink({ type: "CONTROL", at: "", title: "" })).toBe("/control/commands");
    expect(timelineLink({ type: "ALARM_RAISED", at: "", title: "", link: "/alarms/3" })).toBe("/alarms/3");
    expect(timelineLink({ type: "ALARM_RAISED", at: "", title: "", link: "//evil" })).toBe("/alarms");
    expect(severityParts({ alarms: { critical: 1, major: 3, warning: 2 } }).map((p) => `${p.icon}${p.count}`)).toEqual(["▲1", "!3", "·0", "△2"]);
  });
});
