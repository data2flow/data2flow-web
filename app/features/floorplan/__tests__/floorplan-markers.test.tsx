/**
 * TC-DSH-014 AT-DSH-02.1 평면도 마커(현재값·상태 색, 팝업, SSE로 값·색 갱신), TC-DSH-017 AT-DSH-02.3 히트 컬러(범례·그라데이션·"보간 추정"),
 * 확대·이동(DSH-12.04).
 */
import { act, fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderRoute } from "../../../../test/render";
import type { EventSourceLike } from "~/lib/event-stream";
import { FloorplanLive } from "../components/floorplan-live";

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

const NOW = Date.parse("2026-10-04T00:00:00Z");
const stream = { createSource: (u: string) => new FakeSource(u), checkSession: async () => true };
const view = {
  imageUrl: "/api/v1/core/spaces/31/floorplan/image?v=2",
  width: 1200,
  height: 800,
  markers: [
    { deviceId: "d17", x: 0.2, y: 0.3 },
    { deviceId: "d18", x: 0.7, y: 0.3 },
    { deviceId: "d19", x: 0.2, y: 0.8 },
    { deviceId: "d20", x: 0.7, y: 0.8 },
  ],
};
const devices = [
  { id: "d17", name: "온습도 A", connection: "ONLINE", lastSeenAt: "2026-10-03T23:59:48Z", metrics: [{ key: "temperature", value: 24.1, unit: "℃" }, { key: "humidity", value: 41, unit: "%" }] },
  { id: "d18", name: "온습도 B", connection: "ONLINE", metrics: [{ key: "temperature", value: 23.8, unit: "℃" }] },
  { id: "d19", name: "CO2", connection: "ONLINE", metrics: [{ key: "co2", value: 1150, unit: "ppm" }] },
  { id: "d20", name: "소음", connection: "OFFLINE", metrics: [{ key: "LAeq", value: 52, unit: "dB" }] },
];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe("TC-DSH-014 평면도 마커", () => {
  it("마커 4개가 비율 좌표에 현재값·상태 기호, 클릭하면 기기 요약 팝업, space 토픽 이벤트로 값·색 갱신", async () => {
    await renderRoute(<FloorplanLive spaceId="31" view={view} devices={devices} alarms={[{ deviceId: "d19", severity: "MAJOR" }]} now={NOW} lang="ko" streamOptions={stream} />);
    await screen.findByRole("button", { name: "온습도 A · 정상" });
    const markers = document.querySelectorAll("[data-marker]");
    expect(markers).toHaveLength(4);
    const a = screen.getByRole("button", { name: "온습도 A · 정상" });
    expect(a).toHaveStyle({ left: "20%", top: "30%" });
    expect(a).toHaveTextContent("✔ 24.1℃");
    expect(screen.getByRole("button", { name: "CO2 · 알람" })).toHaveTextContent("▲ 1,150ppm");
    expect(screen.getByRole("button", { name: "소음 · 오프라인" })).toHaveAttribute("data-state", "OFFLINE");
    expect(screen.getByRole("img", { name: "공간 평면도" })).toHaveAttribute("src", "/bff/api/core/spaces/31/floorplan/image?v=2");
    expect(FakeSource.last.url).toBe(`/bff/stream/live?topics=${encodeURIComponent("space:31")}`);

    await userEvent.click(a);
    const popup = screen.getByRole("dialog", { name: "온습도 A 요약" });
    expect(popup).toHaveTextContent("humidity");
    expect(popup).toHaveTextContent("41%");
    expect(popup).toHaveTextContent("마지막 수신 12초 전");
    expect(screen.getByRole("link", { name: "기기 상세" })).toHaveAttribute("href", "/devices/d17");

    act(() => FakeSource.last.listeners["device-update"][0]({ data: JSON.stringify({ deviceId: "d17", metrics: [{ key: "temperature", value: 27.5, unit: "℃", at: "2026-10-04T00:00:00Z" }], connection: "OFFLINE" }), lastEventId: "" } as MessageEvent));
    const updated = screen.getByRole("button", { name: "온습도 A · 오프라인" });
    expect(updated).toHaveTextContent("✕ 27.5℃");
    expect(screen.getByRole("dialog")).toHaveTextContent("27.5℃");
    await userEvent.click(screen.getByRole("button", { name: "닫기" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("평면도가 없으면 안내와 동작 버튼, 마커가 없으면 안내(연결하지 않음)", async () => {
    const { unmount } = await renderRoute(<FloorplanLive spaceId="3" view={null} devices={[]} now={NOW} lang="ko" emptyAction={<a href="/x">올리기</a>} toolbar={<p>층 바</p>} />);
    expect(await screen.findByText("이 층에는 평면도가 없습니다")).toBeInTheDocument();
    expect(screen.getByText("층 바")).toBeInTheDocument();
    unmount();
    await renderRoute(<FloorplanLive spaceId="3" view={{ imageUrl: "/p.png" }} devices={[]} now={NOW} lang="ko" streamOptions={stream} />);
    expect(await screen.findByText(/배치된 기기가 없습니다/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "히트 컬러" })).toBeDisabled();
  });
});

describe("TC-DSH-017 히트 컬러", () => {
  it("토글하면 색 범례(최저~최고)와 그라데이션, \"보간 추정\" 문구, 측정 항목을 바꾸면 범례도 바뀐다", async () => {
    await renderRoute(<FloorplanLive spaceId="31" view={view} devices={devices} now={NOW} lang="ko" streamOptions={stream} />);
    expect(await screen.findByRole("button", { name: "히트 컬러" })).toBeInTheDocument();
    expect(screen.queryByTestId("heat-layer")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "히트 컬러" }));
    expect(screen.getByRole("button", { name: "히트 컬러" })).toHaveAttribute("aria-pressed", "true");
    const layer = screen.getByTestId("heat-layer");
    expect(layer.querySelectorAll("rect").length).toBe(40 * 27);
    const legend = screen.getByRole("group", { name: "색 범례" });
    expect(legend).toHaveTextContent("1,150ppm");
    expect(screen.getByText(/보간 추정\(IDW\)/)).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("측정 항목"), "temperature");
    expect(screen.getByRole("group", { name: "색 범례" })).toHaveTextContent("23.8℃");
    expect(screen.getByRole("group", { name: "색 범례" })).toHaveTextContent("24.1℃");
    await userEvent.click(screen.getByRole("button", { name: "히트 컬러" }));
    expect(screen.queryByTestId("heat-layer")).toBeNull();
  });
});

describe("DSH-12.04 확대·이동", () => {
  it("[+]/[−]는 1~4배, 확대했을 때만 끌어 이동, [원래대로]는 처음 상태", async () => {
    await renderRoute(<FloorplanLive spaceId="31" view={view} devices={devices} now={NOW} lang="ko" streamOptions={stream} />);
    const level = await screen.findByTestId("zoom-level");
    const canvas = screen.getByTestId("floorplan-canvas");
    const viewport = screen.getByTestId("floorplan-viewport");
    expect(screen.getByRole("button", { name: "축소" })).toBeDisabled();
    fireEvent.pointerDown(viewport, { clientX: 10, clientY: 10 });
    fireEvent.pointerMove(viewport, { clientX: 50, clientY: 30 });
    expect(canvas.style.transform).toBe("translate(0px, 0px) scale(1)");
    for (let i = 0; i < 7; i++) await userEvent.click(screen.getByRole("button", { name: "확대" }));
    expect(level).toHaveTextContent("400%");
    expect(screen.getByRole("button", { name: "확대" })).toBeDisabled();
    fireEvent.pointerDown(viewport, { clientX: 10, clientY: 10 });
    fireEvent.pointerMove(viewport, { clientX: 50, clientY: 30 });
    fireEvent.pointerUp(viewport);
    fireEvent.pointerMove(viewport, { clientX: 90, clientY: 90 });
    expect(canvas.style.transform).toBe("translate(40px, 20px) scale(4)");
    await userEvent.click(screen.getByRole("button", { name: "축소" }));
    expect(level).toHaveTextContent("350%");
    await userEvent.click(screen.getByRole("button", { name: "원래대로" }));
    expect(canvas.style.transform).toBe("translate(0px, 0px) scale(1)");
  });
});
