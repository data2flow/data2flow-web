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
    expect(screen.getByText("6").parentElement).toHaveAttribute("title", "위험 1 · 주요 3 · 경미 2");
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

describe("[DSH-01.01][AT-DSH-01.1] 홈 요약 카드", () => {
  it("TC-DSH-004 알람 카드 1/3이 색·기호·글자로, 누르면 /alarms?state=ACTIVE, 오프라인 카드는 오프라인 기기 목록", async () => {
    await renderRoute(<SummaryCards summary={{ alarms: { critical: 1, major: 3, minor: 0 }, offlineDevices: 2, ingestPerMinute: 0 }} lang="ko" />);
    const critical = (await screen.findByText("위험", { exact: false, selector: ".sr-only" })).parentElement!;
    expect(critical).toHaveAttribute("data-severity", "critical");
    expect(critical).toHaveTextContent("▲1 위험");
    expect(critical).toHaveClass("text-bad");
    expect(document.querySelector('[data-severity="major"]')).toHaveTextContent("!3 주요");
    expect(screen.getByText("4").closest("a")).toHaveAttribute("href", "/alarms?state=ACTIVE");
    expect(screen.getByText("2대").closest("a")).toHaveAttribute("href", "/devices?connectivity=OFFLINE");
  });
});

describe("[DSH-01.03][AT-DSH-01.3] 최근 알람·자동 제어 타임라인", () => {
  const item = (n: number, type = "ALARM_RAISED") => ({ type, at: new Date(Date.UTC(2026, 9, 3, 2, n)).toISOString(), title: `이벤트 ${n}`, link: `/alarms/${n}` });

  it("TC-DSH-009 SSE home 이벤트로 맨 위 삽입·21번째 제거, 알람 카드 수치 증가", async () => {
    const initial = { alarms: { critical: 0, major: 1, minor: 0 }, timeline: Array.from({ length: 20 }, (_, i) => item(i)) };
    await renderRoute(<LiveHome initial={initial} timezone="UTC" lang="ko" streamOptions={{ createSource: (u) => new FakeSource(u), checkSession: async () => true }} />);
    expect(await screen.findByRole("link", { name: "이벤트 0" })).toBeInTheDocument();
    act(() => FakeSource.last.listeners["home-summary"][0]({ data: JSON.stringify({ alarms: { critical: 1 }, timeline: [{ type: "ALARM_RAISED", at: "2026-10-03T03:00:00Z", title: "실습실 고CO2", severity: "CRITICAL", link: "/alarms/77" }] }), lastEventId: "" } as MessageEvent));
    const items = document.querySelectorAll("[data-timeline]");
    expect(items).toHaveLength(20);
    expect(items[0]).toHaveTextContent("실습실 고CO2");
    expect(screen.getByRole("link", { name: "실습실 고CO2" })).toHaveAttribute("href", "/alarms/77");
    expect(screen.queryByRole("link", { name: "이벤트 0" })).toBeNull();
    expect(document.querySelector('[data-severity="critical"]')).toHaveTextContent("▲1");
  });

  it("TC-DSH-008 제어 출처 표시(자동·플로우), 링크가 없으면 명령 이력·알람 목록으로, 기호", async () => {
    await renderRoute(
      <Timeline
        summary={{ timeline: [{ type: "CONTROL", at: "2026-10-03T02:43:00Z", title: "환기 2단", origin: "FLOW" }, { type: "ALARM_CLEARED", at: "2026-10-03T02:30:00Z", title: "회의실 고온 해제" }] }}
        timezone="UTC"
        lang="ko"
      />,
    );
    expect(await screen.findByRole("link", { name: "환기 2단" })).toHaveAttribute("href", "/control/commands");
    expect(screen.getByText("자동, 플로우")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "회의실 고온 해제" })).toHaveAttribute("href", "/alarms");
    expect(document.querySelectorAll("[data-timeline]")[0]).toHaveTextContent("⚙");
  });

  it("TC-DSH-010 AT-DSH-01.4 AI 요약이 없으면 영역 없음, 있으면 리포트 링크", async () => {
    const { unmount } = await renderRoute(<LiveHome initial={{ aiSummary: null }} timezone="UTC" lang="ko" streamOptions={{ createSource: (u) => new FakeSource(u), checkSession: async () => true }} />);
    await screen.findByText("최근 알람·제어가 없습니다.");
    expect(screen.queryByText("리포트 보기")).toBeNull();
    unmount();
    await renderRoute(<LiveHome initial={{ aiSummary: { text: "CO2가 2회 넘었습니다", reportId: "r-9" } }} timezone="UTC" lang="ko" streamOptions={{ createSource: (u) => new FakeSource(u), checkSession: async () => true }} />);
    expect(await screen.findByRole("link", { name: "리포트 보기" })).toHaveAttribute("href", "/reports/r-9");
  });
});
