/**
 * 알람 모델(UI-RUL-04·05, RUL-02.06, RUL-04.01·04.03) — 필터 ↔ URL·API 쿼리, 정렬, 묶기, 실시간 반영, 일괄 결과.
 */
import { describe, expect, it } from "vitest";
import { apiQuery, applyAlarmEvent, bulkSummary, canAck, canClear, chunk, durationSec, filterFromParams, filterToParams, groupAlarms, matchesFilter, sortAlarms, sortEvents, sourceLink, spacePathText, type Alarm } from "../alarms";

const base: Alarm = { id: "1", severity: "MAJOR", status: "ACTIVE", title: "고CO2", source: { type: "RULE", ruleId: "r-1" }, space: { id: "31", path: ["본관", "실습실"] }, raisedAt: "2026-10-03T23:00:00Z" };
const a = (extra: Partial<Alarm>): Alarm => ({ ...base, ...extra });

describe("TC-RUL-058 필터 ↔ URL 검색 매개변수", () => {
  it("기본은 열린 알람·24시간, 기본값은 주소에 넣지 않는다", () => {
    const filter = filterFromParams(new URLSearchParams());
    expect(filter).toMatchObject({ status: ["ACTIVE", "ACKNOWLEDGED", "SUPPRESSED"], range: "24h", page: 1, groupBySpaceEvent: false });
    expect(filterToParams(filter).toString()).toBe("");
    const custom = filterFromParams(new URLSearchParams("status=CLEARED,BOGUS&severity=MAJOR&spaceId=31&ruleId=r-1&sourceType=FLOW&range=7d&groupBySpaceEvent=true&page=2"));
    expect(custom).toMatchObject({ status: ["CLEARED"], severity: ["MAJOR"], spaceId: "31", ruleId: "r-1", sourceType: "FLOW", range: "7d", groupBySpaceEvent: true, page: 2 });
    expect(filterToParams(custom).toString()).toBe("status=CLEARED&severity=MAJOR&spaceId=31&ruleId=r-1&sourceType=FLOW&range=7d&groupBySpaceEvent=true&page=2");
    expect(filterFromParams(new URLSearchParams("sourceType=X&range=1y")).sourceType).toBe("");
    // 홈 알람 카드 링크(TC-DSH-004) `state`는 `status`의 다른 이름
    expect(filterFromParams(new URLSearchParams("state=ACTIVE")).status).toEqual(["ACTIVE"]);
    expect(filterFromParams(new URLSearchParams("state=ACTIVE&status=CLEARED")).status).toEqual(["CLEARED"]);
  });

  it("API-RUL-10 쿼리: 기간을 from·to로, 전체 기간은 생략", () => {
    const now = Date.parse("2026-10-04T00:00:00Z");
    const q = apiQuery(filterFromParams(new URLSearchParams("severity=MAJOR&ruleId=r-1&sourceType=RULE&spaceId=31&groupBySpaceEvent=true")), now, 50);
    expect(Object.fromEntries(q)).toEqual({ status: "ACTIVE,ACKNOWLEDGED,SUPPRESSED", page: "1", size: "50", severity: "MAJOR", spaceId: "31", ruleId: "r-1", sourceType: "RULE", from: "2026-10-03T00:00:00.000Z", to: "2026-10-04T00:00:00.000Z", groupBySpaceEvent: "true" });
    expect(apiQuery(filterFromParams(new URLSearchParams("range=all")), now).has("from")).toBe(false);
  });
});

describe("정렬·묶기(RUL-04.01·04.03)", () => {
  it("심각도 → 발생 시각 내림차순", () => {
    const sorted = sortAlarms([a({ id: "1", severity: "MINOR" }), a({ id: "2", severity: "CRITICAL", raisedAt: "2026-10-03T20:00:00Z" }), a({ id: "3", severity: "MINOR", raisedAt: "2026-10-03T23:30:00Z" }), a({ id: "4", severity: "UNKNOWN" as never })]);
    expect(sorted.map((x) => x.id)).toEqual(["2", "3", "1", "4"]);
  });

  it("하위 알람은 상위 아래, 공간 이벤트 2건 이상은 묶음", () => {
    const alarms = [a({ id: "p", severity: "CRITICAL" }), a({ id: "c1", parentAlarmId: "p" }), a({ id: "e1", spaceEventId: "ev", raisedAt: "2026-10-03T22:00:00Z" }), a({ id: "e2", spaceEventId: "ev", raisedAt: "2026-10-03T21:00:00Z" }), a({ id: "solo", spaceEventId: "lonely", raisedAt: "2026-10-03T20:00:00Z" }), a({ id: "orphan", parentAlarmId: "missing", raisedAt: "2026-10-03T19:00:00Z" })];
    const plain = groupAlarms(alarms, false);
    expect(plain.map((e) => (e.kind === "alarm" ? `${e.alarm.id}:${e.children.length}` : e.spaceEventId))).toEqual(["p:1", "e1:0", "e2:0", "solo:0", "orphan:0"]);
    const grouped = groupAlarms(alarms, true);
    expect(grouped.map((e) => (e.kind === "alarm" ? e.alarm.id : `ev:${e.alarms.map((x) => x.id).join(",")}`))).toEqual(["p", "ev:e1,e2", "solo", "orphan"]);
  });
});

describe("실시간 반영(API-RUL-14 alarm.raised·updated·cleared)", () => {
  const filter = filterFromParams(new URLSearchParams());
  const counts = { byStatus: { ACTIVE: 1 }, bySeverity: { MAJOR: 1 } };

  it("새 알람은 맨 위(강조 ID), 상태 변경은 그 자리, 필터에서 벗어나면 뺀다", () => {
    const raised = applyAlarmEvent({ alarms: [base], counts }, "alarm.raised", a({ id: 2 as unknown as string, severity: "CRITICAL" }), filter);
    expect(raised.alarms.map((x) => x.id)).toEqual(["2", "1"]);
    expect(raised.added).toBe("2");
    expect(raised.counts).toEqual({ byStatus: { ACTIVE: 2 }, bySeverity: { MAJOR: 1, CRITICAL: 1 } });
    const acked = applyAlarmEvent(raised, "alarm.updated", a({ id: "1", status: "ACKNOWLEDGED" }), filter);
    expect(acked.alarms.find((x) => x.id === "1")?.status).toBe("ACKNOWLEDGED");
    expect(acked.counts.byStatus).toEqual({ ACTIVE: 1, ACKNOWLEDGED: 1 });
    const cleared = applyAlarmEvent(acked, "alarm.cleared", a({ id: "1", status: "CLEARED" }), filter);
    expect(cleared.alarms.map((x) => x.id)).toEqual(["2"]);
    expect(cleared.counts.byStatus.ACKNOWLEDGED).toBe(0);
    const unknown = applyAlarmEvent(cleared, "alarm.updated", a({ id: "77" }), filter);
    expect(unknown.alarms).toHaveLength(1);
  });

  it("필터에 맞지 않는 새 알람은 넣지 않는다(심각도·규칙·출처·공간)", () => {
    const only = filterFromParams(new URLSearchParams("severity=CRITICAL&ruleId=r-9&sourceType=FLOW&spaceId=31"));
    expect(matchesFilter(base, only)).toBe(false);
    expect(matchesFilter(a({ severity: "CRITICAL", source: { type: "FLOW", ruleId: "r-9" } }), only, new Set(["31"]))).toBe(true);
    expect(matchesFilter(a({ severity: "CRITICAL", source: { type: "FLOW", ruleId: "r-9" }, space: { id: "99" } }), only, new Set(["31"]))).toBe(false);
    expect(matchesFilter(a({ severity: "CRITICAL", source: { type: "RULE", ruleId: "r-9" } }), only)).toBe(false);
    expect(applyAlarmEvent({ alarms: [], counts }, "alarm.raised", base, only).alarms).toHaveLength(0);
  });
});

describe("표시 도우미", () => {
  it("지속 시간, 공간 경로, 출처 링크, 확인·해제 가능, 일괄 결과, 이벤트 정렬", () => {
    const now = Date.parse("2026-10-04T00:00:00Z");
    expect(durationSec(base, now)).toBe(3600);
    expect(durationSec({ ...base, clearedAt: "2026-10-03T23:10:00Z" }, now)).toBe(600);
    expect(spacePathText(base.space)).toBe("본관 / 실습실");
    expect(spacePathText({ id: "1", path: [{ name: "A" }, { name: "B" }] })).toBe("A / B");
    expect(spacePathText({ id: "1", path: "A > B" })).toBe("A > B");
    expect(spacePathText(null)).toBe("");
    expect(sourceLink(base)).toBe("/rules/r-1");
    expect(sourceLink({ source: { type: "FLOW", flowId: "f-1", nodeId: "n 1" } })).toBe("/automation/flows/f-1?node=n%201");
    expect(sourceLink({ source: { type: "FLOW", flowId: "f-1" } })).toBe("/automation/flows/f-1");
    expect(sourceLink({ source: { type: "SYSTEM" } })).toBeNull();
    expect(canAck(base)).toBe(true);
    expect(canAck({ status: "ACKNOWLEDGED" })).toBe(false);
    expect(canAck({ status: "CLEARED", ackedAt: null })).toBe(true);
    expect(canClear({ status: "CLEARED" })).toBe(false);
    expect(bulkSummary([{ alarmId: "1", ok: true }, { alarmId: "2", ok: false, code: "X" }])).toEqual({ ok: 1, failed: 1, failures: [{ alarmId: "2", ok: false, code: "X" }] });
    expect(chunk([1, 2, 3], 2)).toEqual([[1, 2], [3]]);
    expect(sortEvents([{ type: "B", at: "2026-10-04T00:01:00Z" }, { type: "A", at: "2026-10-04T00:00:00Z" }]).map((e) => e.type)).toEqual(["A", "B"]);
  });
});
