/**
 * UI-SIM-12 실행 결과 리포트(SIM-04.06): TC-SIM-058 — 통과·실패 배지, 근거 시각 링크, 실패 항목 실제값.
 * AT-SIM-10.1 "10분 안에 에어컨 ON" 7분 → 통과(근거 시각), AT-SIM-10.2 "알람 1건"에 2건 → 실패(실제 2, 알람 ID).
 */
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderRoute } from "../../../../test/render";
import { ReportExpectations } from "../components/report-expectations";
import { describeExpectation, evidenceAlarmIds, evidenceLink, scenarioExpectations, verdictOf } from "../model/report";
import type { Expectation } from "../model/types";

const defs: Expectation[] = [
  { id: "ex-1", kind: "DEVICE_STATE_REACHED", target: { deviceId: "2002" }, condition: { power: "ON" }, deadline: "2026-08-12T01:30:00Z" },
  { id: "ex-2", kind: "ALARM_COUNT", target: { spaceId: "41" }, condition: { op: "==", value: 1 } },
  { id: "ex-3", kind: "METRIC_RANGE_RATIO", target: { spaceId: "41", metric: "temperature" }, condition: { min: 22, max: 26, ratio: 0.9 } },
  { id: "ex-4", kind: "CONTROL_COUNT_MAX", target: { deviceId: "2002" }, condition: { max: 10 } },
];

describe("[SIM-04.06] 기대 결과 판정 모델", () => {
  it("판정(통과·실패·판정 불가), 설명, 근거 링크, 알람 ID", () => {
    expect(verdictOf({ id: "a", kind: "ALARM_COUNT", passed: true })).toBe("PASSED");
    expect(verdictOf({ id: "a", kind: "ALARM_COUNT", passed: false })).toBe("FAILED");
    expect(verdictOf({ id: "a", kind: "ALARM_COUNT", passed: null })).toBe("SKIPPED");
    expect(verdictOf({ id: "a", kind: "ALARM_COUNT", passed: false, state: "SKIPPED" })).toBe("SKIPPED");
    expect(describeExpectation(defs[0], { "2002": "ERV-1" })).toEqual({ key: "deviceStateBy", values: { device: "ERV-1", state: "power=ON", deadline: "2026-08-12T01:30:00Z" } });
    expect(describeExpectation({ ...defs[0], deadline: null, condition: { mode: { a: 1 } } })?.values.state).toBe('mode={"a":1}');
    expect(describeExpectation(defs[1])).toEqual({ key: "alarmCount", values: { op: "==", value: "1" } });
    expect(describeExpectation(defs[2])?.values).toEqual({ metric: "temperature", min: "22", max: "26", pct: "90" });
    expect(describeExpectation(defs[3])).toEqual({ key: "controlMax", values: { device: "2002", max: "10" } });
    expect(describeExpectation(undefined)).toBeNull();
    expect(describeExpectation({ ...defs[0], kind: "OTHER" as never })).toBeNull();
    expect(evidenceLink(defs[0])).toBe("/devices/2002?tab=commands");
    expect(evidenceLink(defs[1])).toBe("/alarms?spaceId=41");
    expect(evidenceLink({ ...defs[1], target: { ruleId: "r-7" } })).toBe("/alarms?ruleId=r-7");
    expect(evidenceLink({ ...defs[1], target: {} })).toBe("/alarms");
    expect(evidenceLink(defs[2])).toBe("/spaces/41");
    expect(evidenceLink({ ...defs[2], target: {} })).toBeNull();
    expect(evidenceLink(undefined)).toBeNull();
    expect(evidenceAlarmIds({ id: "a", kind: "ALARM_COUNT", passed: false, evidence: { alarmIds: [5, "6"] } })).toEqual(["5", "6"]);
    expect(evidenceAlarmIds({ id: "a", kind: "ALARM_COUNT", passed: false })).toEqual([]);
    expect(scenarioExpectations({ scenario: { name: "x", expectations: defs } })).toHaveLength(4);
    expect(scenarioExpectations({ scenario: "이름" })).toEqual([]);
    expect(scenarioExpectations({ scenario: { name: "x" } })).toEqual([]);
  });
});

describe("[SIM-04.06][AT-SIM-10.1][AT-SIM-10.2] UI-SIM-12 기대 결과", () => {
  it("TC-SIM-058 통과·실패 배지, 근거 시각 링크, 실패 항목 실제값과 알람 ID", async () => {
    await renderRoute(
      <ReportExpectations
        items={[
          { id: "ex-1", kind: "DEVICE_STATE_REACHED", passed: true, evidence: { at: "2026-08-12T01:07:00Z", value: "ON" } },
          { id: "ex-2", kind: "ALARM_COUNT", passed: false, evidence: { actual: 2, alarmIds: [71, 72] } },
          { id: "ex-3", kind: "METRIC_RANGE_RATIO", passed: false, evidence: { actual: "81%" } },
          { id: "ex-4", kind: "CONTROL_COUNT_MAX", passed: null },
        ]}
        definitions={defs}
        deviceNames={{ "2002": "ERV-1" }}
        timezone="Asia/Seoul"
        lang="ko"
      />,
    );
    const rows = await screen.findAllByRole("row");
    expect(rows[1]).toHaveAttribute("data-verdict", "PASSED");
    expect(rows[1]).toHaveTextContent("✔ 통과");
    expect(rows[1]).toHaveTextContent("2026-08-12 10:30까지 ERV-1 power=ON");
    expect(screen.getByRole("link", { name: "2026-08-12 10:07" })).toHaveAttribute("href", "/devices/2002?tab=commands");
    expect(rows[2]).toHaveTextContent("✖ 실패");
    expect(rows[2]).toHaveTextContent("알람 == 1건");
    expect(rows[2]).toHaveTextContent("실제 2");
    expect(screen.getByRole("link", { name: "#71" })).toHaveAttribute("href", "/alarms/71");
    expect(screen.getAllByRole("link", { name: "근거 보기" })[0]).toHaveAttribute("href", "/alarms?spaceId=41");
    expect(rows[3]).toHaveTextContent("temperature 22~26 90% 유지");
    expect(rows[3]).toHaveTextContent("실제 81%");
    expect(rows[4]).toHaveTextContent("– 판정 불가(정지)");
    expect(rows[4]).toHaveTextContent("ERV-1 제어 10회 이하");
  });

  it("기대 결과가 없으면 안내, 정의를 못 찾으면 종류만", async () => {
    const { unmount } = await renderRoute(<ReportExpectations items={[]} definitions={[]} timezone="UTC" lang="ko" />);
    expect(await screen.findByText("기대 결과가 없습니다.", { exact: false })).toBeInTheDocument();
    unmount();
    await renderRoute(<ReportExpectations items={[{ id: "z", kind: "ALARM_COUNT", passed: true }]} definitions={[]} timezone="UTC" lang="ko" />);
    expect(await screen.findByText("알람 수")).toBeInTheDocument();
    expect(screen.getByText("–")).toBeInTheDocument();
  });
});
