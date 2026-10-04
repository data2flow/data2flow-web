/**
 * ACT-03.06 UI-ACT-09 드라이버 상태 — TC-ACT-082: 목록에 연결 상태·오류율·평균 응답 시간, 서킷 OPEN 드라이버는 경고 배지와 열린 시각,
 * 상세는 지원 기능·서킷·최근 1시간 지표·최근 오류(API-ACT-32).
 */
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderRoute } from "../../../../test/render";
import { DriverManager } from "../drivers";
import { err, fakeAdminApi, ok } from "./fake-admin";

const ROWS = [
  { driverId: "301", name: "가상 장비", type: "VIRTUAL", status: "OK", deviceCount: 6, metrics: { status: "OK", circuit: { state: "CLOSED" }, errorRate: 0, avgMs: 12 } },
  { driverId: "302", name: "플랫폼 MQTT", type: "MQTT", status: "OK", deviceCount: 2, metrics: { status: "OK", errorRate: 0.002, avgMs: 84.4 } },
  {
    driverId: "303",
    name: "LG ThinQ 본관",
    type: "LG_THINQ",
    status: "CIRCUIT_OPEN",
    deviceCount: 1,
    metrics: { status: "CIRCUIT_OPEN", circuit: { state: "OPEN", openedAt: "2026-10-03T23:58:00Z" }, errorRate: 0.62, avgMs: null },
  },
  { driverId: "304", name: "확인 전", type: "SMARTTHINGS", status: "UNTESTED", deviceCount: 0, metrics: null },
];

describe("TC-ACT-082 드라이버 목록 상태", () => {
  it("상태 배지·오류율·평균 응답, 서킷 열림은 경고와 열린 시각", async () => {
    await renderRoute(<DriverManager initial={ROWS} timezone="Asia/Seoul" lang="ko" api={fakeAdminApi()} />);
    expect(await screen.findByText("LG ThinQ 본관")).toBeInTheDocument();
    expect(screen.getAllByText("정상")).toHaveLength(2);
    expect(screen.getByText("서킷 열림")).toBeInTheDocument();
    expect(screen.getByText("2026-10-04 08:58:00부터")).toBeInTheDocument();
    expect(screen.getByText("62%")).toBeInTheDocument();
    expect(screen.getByText("0.2%")).toBeInTheDocument();
    expect(screen.getByText("84ms")).toBeInTheDocument();
    expect(screen.getByText("확인 전", { selector: "span" })).toBeInTheDocument();
  });

  it("상세: 지원 기능, 서킷 열림 시각, 1시간 지표, 최근 오류", async () => {
    const user = userEvent.setup();
    const api = fakeAdminApi();
    await renderRoute(<DriverManager initial={ROWS} timezone="Asia/Seoul" lang="ko" api={api} />);
    await user.click(await screen.findByRole("button", { name: "LG ThinQ 본관" }));
    expect(await screen.findByText("LG ThinQ 본관 상세")).toBeInTheDocument();
    expect(screen.getByText("Switch, Thermostat")).toBeInTheDocument();
    expect(screen.getByText(/열림 · 2026-10-04 08:58:00/)).toBeInTheDocument();
    expect(screen.getByText("요청 50 · 오류 31 (62%) · 평균 0ms · p95 0ms")).toBeInTheDocument();
    expect(screen.getByText(/token expired/)).toBeInTheDocument();
    expect(screen.getByText("저장됨(값은 보이지 않음)")).toBeInTheDocument();
    expect(api.driverMetrics).toHaveBeenCalledWith("303", "1h");
  });

  it("상세 지표가 없으면 '지표 없음', 상세를 못 읽으면 오류 문구", async () => {
    const user = userEvent.setup();
    const api = fakeAdminApi({ driverMetrics: vi.fn(async () => err(503, "SERVICE_UNAVAILABLE")) });
    const { unmount } = await renderRoute(<DriverManager initial={ROWS} timezone="Asia/Seoul" lang="ko" api={api} />);
    await user.click(await screen.findByRole("button", { name: "가상 장비" }));
    expect(await screen.findByText("지표 없음")).toBeInTheDocument();
    unmount();
    const failing = fakeAdminApi({ driver: vi.fn(async () => err(403, "PERMISSION_DENIED")), driverMetrics: vi.fn(async () => ok({ status: "OK" })) });
    await renderRoute(<DriverManager initial={ROWS} failed timezone="Asia/Seoul" lang="ko" api={failing} />);
    expect(await screen.findByText("목록을 불러오지 못했습니다")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "가상 장비" }));
    expect(await screen.findByText(/권한이 없습니다/)).toBeInTheDocument();
  });
});
