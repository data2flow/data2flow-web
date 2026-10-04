/**
 * 공간 보기 알람(DSH-02.01, UI-DSH-02 알람 탭·기기 카드 배지): TC-DSH-013, AT-DSH-02.1.
 */
import { act, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderRoute } from "../../../../test/render";
import type { EventSourceLike } from "~/lib/event-stream";
import { SpaceAlarms } from "../components/space-alarms";
import { DeviceCards } from "../components/space-overview";
import { alarmCountByDevice, applyAlarmEvent, severityTone, sortAlarms, type SpaceAlarm } from "../model/space-alarms";

class FakeSource implements EventSourceLike {
  static last: FakeSource;
  readyState = 0;
  onopen: ((e: Event) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  listeners: Record<string, ((e: MessageEvent) => void)[]> = {};
  constructor(readonly url: string) {
    FakeSource.last = this;
  }
  addEventListener(type: string, l: (e: MessageEvent) => void) {
    (this.listeners[type] ??= []).push(l);
  }
  close() {}
}
const stream = { createSource: (u: string) => new FakeSource(u), checkSession: async () => true };
const emit = (data: unknown) => act(() => FakeSource.last.listeners.alarm[0]({ data: JSON.stringify(data), lastEventId: "" } as MessageEvent));

const alarms: SpaceAlarm[] = [
  { id: "5", severity: "MINOR", status: "ACKNOWLEDGED", title: "습도 높음", device: { id: "17", name: "TH-1" }, raisedAt: "2026-10-03T01:00:00Z" },
  { id: "9", severity: "CRITICAL", status: "ACTIVE", title: "실습실 고CO2", device: { id: "18", name: "CO2-1" }, raisedAt: "2026-10-03T02:42:00Z", flapping: true },
];

describe("[DSH-02.01][AT-DSH-02.1] 공간 알람 모델", () => {
  it("심각도 순 정렬, 실시간 이벤트: 해제는 빼고 아는 알람은 고치고 범위 안 새 알람만 넣는다", () => {
    expect(sortAlarms(alarms).map((a) => a.id)).toEqual(["9", "5"]);
    const scope = new Set(["31", "311"]);
    const now = "2026-10-03T03:00:00Z";
    expect(applyAlarmEvent(alarms, { alarmId: 9, state: "CLEARED" }, scope, now).map((a) => a.id)).toEqual(["5"]);
    expect(applyAlarmEvent(alarms, { alarmId: 5, state: "ACTIVE", severity: "MAJOR" }, scope, now).find((a) => a.id === "5")).toMatchObject({ status: "ACTIVE", severity: "MAJOR" });
    expect(applyAlarmEvent(alarms, { alarmId: 11, state: "ACTIVE", severity: "MAJOR", spaceId: 999, title: "다른 공간" }, scope, now)).toBe(alarms);
    expect(applyAlarmEvent(alarms, { alarmId: 11, state: "ACTIVE", spaceId: null }, scope, now)).toBe(alarms);
    const added = applyAlarmEvent(alarms, { alarmId: 11, state: "ACTIVE", severity: "MAJOR", spaceId: 311, title: "하위 공간 고온" }, scope, now);
    expect(added.map((a) => a.id)).toEqual(["9", "11", "5"]);
    expect(applyAlarmEvent([], { alarmId: 12, state: "ACTIVE", spaceId: 31 }, scope, now)[0]).toMatchObject({ severity: "INFO", title: "" });
  });

  it("기기별 열린 알람 수와 가장 높은 심각도, 배지 기호", () => {
    const counts = alarmCountByDevice([...alarms, { id: "10", severity: "MAJOR", status: "ACTIVE", title: "x", device: { id: "18" } }, { id: "11", severity: "MAJOR", status: "CLEARED", title: "y", device: { id: "17" } }, { id: "12", severity: "INFO", status: "ACTIVE", title: "z" }]);
    expect(counts.get("18")).toEqual({ count: 2, worst: "CRITICAL" });
    expect(counts.get("17")).toEqual({ count: 1, worst: "MINOR" });
    expect(alarmCountByDevice(undefined).size).toBe(0);
    expect(severityTone("CRITICAL")).toEqual({ tone: "danger", icon: "▲" });
    expect(severityTone("MAJOR").icon).toBe("!");
    expect(severityTone("WARNING").tone).toBe("info");
    expect(severityTone("INFO").tone).toBe("neutral");
  });
});

describe("[DSH-02.01] UI-DSH-02 알람 탭과 기기 카드 배지", () => {
  it("TC-DSH-013 열린 알람 목록(심각도 배지 기호+글자, 상세 링크), alarms 토픽으로 새 알람 추가·해제 제거", async () => {
    await renderRoute(<SpaceAlarms initial={alarms} spaceIds={["31", "311"]} timezone="UTC" lang="ko" streamOptions={stream} now={() => "2026-10-03T03:00:00Z"} />);
    const rows = await screen.findAllByRole("row");
    expect(rows[1]).toHaveTextContent("▲ 위험");
    expect(screen.getByRole("link", { name: "실습실 고CO2" })).toHaveAttribute("href", "/alarms/9");
    expect(screen.getByText("반복 발생")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "알람 목록에서 보기" })).toHaveAttribute("href", "/alarms?spaceId=31");
    expect(FakeSource.last.url).toContain("topics=alarms");
    emit({ alarmId: 20, state: "ACTIVE", severity: "MAJOR", spaceId: 311, title: "하위 공간 고온" });
    expect(screen.getByRole("link", { name: "하위 공간 고온" })).toBeInTheDocument();
    emit({ alarmId: 9, state: "CLEARED", severity: "CRITICAL", spaceId: 31 });
    expect(screen.queryByRole("link", { name: "실습실 고CO2" })).toBeNull();
  });

  it("열린 알람이 없으면 안내, 불러오기 실패면 오류 안내(구독하지 않음)", async () => {
    const { unmount } = await renderRoute(<SpaceAlarms initial={[]} spaceIds={["31"]} timezone="UTC" lang="ko" streamOptions={stream} />);
    expect(await screen.findByText("이 공간에 열린 알람이 없습니다.")).toBeInTheDocument();
    unmount();
    await renderRoute(<SpaceAlarms initial={[]} failed spaceIds={["31"]} timezone="UTC" lang="ko" streamOptions={stream} />);
    expect(await screen.findByText("알람을 불러오지 못했습니다.")).toBeInTheDocument();
  });

  it("기기 카드에 열린 알람 배지(수·가장 높은 심각도)", async () => {
    await renderRoute(<DeviceCards spaceId="31" devices={[{ id: "18", name: "CO2-1", connection: "ONLINE", metrics: [] }, { id: "19", name: "TH-2", connection: "ONLINE", metrics: [] }]} alarms={alarms} now={Date.parse("2026-10-03T03:00:00Z")} lang="ko" streamOptions={stream} />);
    expect(await screen.findByText("알람 1")).toBeInTheDocument();
    expect(screen.getByText("알람 1").closest("span")).toHaveTextContent("▲ 알람 1");
    expect(screen.getAllByText(/^알람 \d+$/)).toHaveLength(1);
  });
});
