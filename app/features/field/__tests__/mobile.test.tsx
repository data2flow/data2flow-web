/**
 * DSH-13.04 UI-DSH-14 모바일 셸(하단 탭 5개, 오프라인 띠), UI-DEV-17 모바일 기기 상세(AT-DSH-16.2: 현재값·배터리·최근 알람, [작업 시작]·[사진]),
 * 내 알림 탭(실시간 `notifications`).
 */
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderRoute } from "../../../../test/render";
import { MobileDevice, MobileNotifications, MobileShell } from "../components/mobile";
import { FakeES, fail, fakeFieldApi, live, order, setOnline } from "./helpers";

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  FakeES.all = [];
  setOnline(true);
});
afterEach(() => {
  setOnline(true);
  vi.useRealTimers();
});

const NOW = () => Date.parse("2026-10-04T00:00:00Z");
const DEVICE = {
  id: "1042",
  name: "AM107-067999",
  status: "ACTIVE",
  space: { id: "31", name: "실습실", path: ["광주캠퍼스", "본관", "3층", "실습실"] },
  state: { connectivity: "ONLINE", lastSeenAt: "2026-10-03T23:59:48Z", battery: 92 },
  latest: [
    { metricKey: "temperature", displayName: "온도", unit: "℃", value: 22.3 },
    { metricKey: "co2", displayName: "CO2", unit: "ppm", value: 517 },
  ],
};

describe("UI-DSH-14 모바일 셸", () => {
  it("TC-DSH-123: 하단 탭 5개(44px 이상), 오프라인이면 읽기 전용 띠", async () => {
    await renderRoute(
      <MobileShell>
        <p>본문</p>
      </MobileShell>,
    );
    const tabs = await screen.findByRole("navigation", { name: "모바일 메뉴" });
    const links = within(tabs).getAllByRole("link");
    expect(links.map((l) => l.getAttribute("href"))).toEqual(["/m/alarms", "/m/spaces", "/m/work-orders", "/m/notifications", "/m/scan"]);
    for (const link of links) expect(link.className).toContain("min-h-11");
    setOnline(false);
    expect(await screen.findByText(/오프라인 — 읽기 전용입니다/)).toBeInTheDocument();
  });
});

describe("UI-DEV-17 모바일 기기 상세", () => {
  it("TC-DSH-124 AT-DSH-16.2: 현재값·배터리·연결·최근 알람·열린 작업, [작업 시작]·[사진]", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const api = fakeFieldApi();
    await renderRoute(<MobileDevice device={DEVICE} orders={[order({ status: "ASSIGNED" })]} alarms={[{ id: "55", severity: "MAJOR", status: "ACTIVE", title: "배터리 20% 미만", raisedAt: "2026-10-03T22:00:00Z" }]} canWrite timezone="Asia/Seoul" now={NOW} api={api} />);
    expect(await screen.findByRole("heading", { name: "AM107-067999" })).toBeInTheDocument();
    expect(screen.getByText("광주캠퍼스 › 본관 › 3층 › 실습실")).toBeInTheDocument();
    expect(screen.getByText("92%")).toBeInTheDocument();
    expect(screen.getByText("온라인")).toBeInTheDocument();
    expect(screen.getByText("22.3℃")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "[주요] 배터리 20% 미만" })).toHaveAttribute("href", "/alarms/55");
    expect(screen.getByRole("link", { name: "실습실 EM300 배터리 교체" })).toHaveAttribute("href", "/m/work-orders/1042");
    const bar = screen.getByRole("navigation", { name: "작업 버튼" });
    await user.click(within(bar).getByRole("button", { name: "작업 시작" }));
    expect(api.transition).toHaveBeenCalledWith("1042", { action: "START" }, expect.any(String));
    expect(await screen.findByText("작업을 시작했습니다")).toBeInTheDocument();
    await user.upload(screen.getByLabelText("사진"), new File([new Uint8Array([1])], "after.jpg", { type: "image/jpeg" }));
    expect(await screen.findByText("사진을 올렸습니다")).toBeInTheDocument();
  });

  it("값·알람·작업이 없으면 안내, 쓰기 권한 없으면 하단 버튼 없음, 시작 실패·형식 오류 안내", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime, applyAccept: false });
    const api = fakeFieldApi({ transition: async () => fail(409, "WORKORDER_STATE_CONFLICT") });
    const { unmount } = await renderRoute(<MobileDevice device={{ ...DEVICE, state: { connectivity: "OFFLINE", battery: null }, latest: [] }} orders={[]} alarms={[]} canWrite timezone="Asia/Seoul" now={NOW} api={api} />);
    expect(await screen.findByText("받은 값이 없습니다")).toBeInTheDocument();
    expect(screen.getByText("최근 알람이 없습니다")).toBeInTheDocument();
    expect(screen.getByText("열린 작업 지시가 없습니다")).toBeInTheDocument();
    expect(screen.getByText("오프라인")).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "작업 버튼" })).not.toBeInTheDocument();
    unmount();
    await renderRoute(<MobileDevice device={DEVICE} orders={[order({ status: "OPEN" })]} alarms={[]} canWrite timezone="Asia/Seoul" now={NOW} api={api} />);
    await user.click(await screen.findByRole("button", { name: "작업 시작" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    await user.upload(screen.getByLabelText("사진"), new File(["x"], "a.txt", { type: "text/plain" }));
    expect(await screen.findByText("이미지나 PDF만 올릴 수 있습니다")).toBeInTheDocument();
  });

  it("오프라인이면 사진을 대기열에 넣는다", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const api = fakeFieldApi();
    await renderRoute(<MobileDevice device={DEVICE} orders={[order({ status: "IN_PROGRESS" })]} alarms={[]} canWrite timezone="Asia/Seoul" now={NOW} api={api} />);
    setOnline(false);
    await user.upload(await screen.findByLabelText("사진"), new File([new Uint8Array([1])], "after.jpg", { type: "image/jpeg" }));
    expect(await screen.findByText("연결되면 전송합니다")).toBeInTheDocument();
    expect(api.attach).not.toHaveBeenCalled();
  });
});

describe("내 알림 탭", () => {
  it("notifications 토픽으로 받은 알림을 위에 쌓는다(링크 있으면 링크)", async () => {
    await renderRoute(<MobileNotifications timezone="Asia/Seoul" live={live} />);
    expect(await screen.findByText("새 알림이 없습니다")).toBeInTheDocument();
    expect(FakeES.all[0].url).toBe("/bff/stream/live?topics=notifications");
    act(() => {
      FakeES.all[0].emit("notification", { id: "n1", category: "ALARM", title: "CO2 높음", link: "/alarms/9", createdAt: "2026-10-04T00:00:00Z" });
      FakeES.all[0].emit("notification", { notificationId: "n2", message: "작업 지시가 배정되었습니다", at: "2026-10-04T00:01:00Z" });
    });
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(2));
    expect(screen.getAllByRole("listitem")[0]).toHaveTextContent("작업 지시가 배정되었습니다");
    expect(screen.getByRole("link", { name: "CO2 높음" })).toHaveAttribute("href", "/alarms/9");
    expect(screen.getByRole("link", { name: "수신 설정" })).toHaveAttribute("href", "/me/notifications");
  });
});
