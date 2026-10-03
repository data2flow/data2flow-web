/**
 * 홈 부품(UI-DSH-01): TC-DSH-007 공간 쾌적도, 요약 카드, 실시간 합치기.
 */
import { act, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderRoute } from "../../../../test/render";
import type { EventSourceLike } from "~/lib/event-stream";
import { ComfortTable, LiveHome, SummaryCards, Timeline } from "../components/home-panels";

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

const comfort = Array.from({ length: 12 }, (_, i) => ({ spaceId: String(i), spaceName: `실${String(i).padStart(2, "0")}`, state: i === 0 ? "WARNING" : "NORMAL", causes: i === 0 ? [{ metricKey: "co2", value: 1150, unit: "ppm" }] : [], updatedAt: "2026-10-03T02:42:00Z" }));

describe("UI-DSH-01 홈 부품", () => {
  it("TC-DSH-007 상위 10곳 + 외 N곳, 배지(기호+글자), 원인 값, 갱신 시각(표시 시간대)", async () => {
    await renderRoute(<ComfortTable summary={{ comfort }} timezone="Asia/Seoul" lang="ko" />);
    expect(await screen.findByText("외 2곳")).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(11);
    expect(screen.getByText("co2 1150ppm")).toBeInTheDocument();
    expect(screen.getByText("경고").closest("span")).toHaveTextContent("▲ 경고");
    expect(screen.getAllByText("2026-10-03 11:42")).toHaveLength(10);
  });

  it("쾌적도·타임라인이 비면 안내, 카드는 권한별(승인 대기·소스 값이 있을 때만)", async () => {
    await renderRoute(
      <>
        <ComfortTable summary={{}} timezone="UTC" lang="ko" />
        <Timeline summary={{}} timezone="UTC" lang="ko" />
        <SummaryCards summary={{ alarms: { critical: 1, major: 3, minor: 2 }, offlineDevices: 2, ingestPerMinute: 14 }} lang="ko" />
      </>,
    );
    expect(await screen.findByText("목표 환경이 정해진 공간이 없습니다.")).toBeInTheDocument();
    expect(screen.getByText("최근 알람·제어가 없습니다.")).toBeInTheDocument();
    expect(screen.getByText("6")).toHaveAttribute("title", "위험 1 · 주요 3 · 경미 2");
    expect(screen.getByText("14건/분")).toBeInTheDocument();
    expect(screen.queryByText("승인 대기 기기")).toBeNull();
    expect(screen.queryByText("소스 연결")).toBeNull();
  });

  it("실시간 home-summary가 오면 바뀐 카드만 갱신, 타임라인 링크", async () => {
    await renderRoute(
      <LiveHome
        initial={{ offlineDevices: 2, pendingDevices: 3, sources: { connected: 1, total: 1 }, timeline: [{ type: "CONTROL", at: "2026-10-03T02:43:00Z", title: "환기 2단", link: "/control/commands" }, { type: "ALARM_CLEARED", at: "2026-10-03T02:30:00Z", title: "해제" }], aiSummary: { text: "오늘 요약" } }}
        timezone="UTC"
        lang="ko"
        streamOptions={{ createSource: (u) => new FakeSource(u), checkSession: async () => true }}
      />,
    );
    expect(await screen.findByText("3대")).toBeInTheDocument();
    expect(screen.getByText("1/1 정상")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "환기 2단" })).toHaveAttribute("href", "/control/commands");
    expect(screen.getByText("오늘 요약")).toBeInTheDocument();
    act(() => FakeSource.last.listeners["home-summary"][0]({ data: JSON.stringify({ offlineDevices: 5 }), lastEventId: "" } as MessageEvent));
    expect(screen.getByText("5대")).toBeInTheDocument();
    expect(screen.getByText("3대")).toBeInTheDocument();
  });
});
