/**
 * 기기 화면 부품(UI-DEV-04·06): TC-DEV-037 개요 실시간 갱신, 데이터 탭(API-TSD-02 + 실시간 점, M2 시연 "실시간 차트에 값 표시"),
 * 하위 탭, 상태 표시.
 */
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderRoute } from "../../../../test/render";
import type { ChartHandle } from "~/components/charts/timeseries-chart";
import type { EventSourceLike } from "~/lib/event-stream";
import { DeviceAreaTabs } from "../area-tabs";
import { BatteryBar, ConnectivityLabel, DeviceDataPanel, DeviceOverview, DeviceStatusBadge, LatestValueCards } from "../components";
import type { DeviceDetail } from "../model/devices";

class FakeES implements EventSourceLike {
  static all: FakeES[] = [];
  readyState = 0;
  onopen: ((e: Event) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  listeners: Record<string, ((e: MessageEvent) => void)[]> = {};
  constructor(readonly url: string) {
    FakeES.all.push(this);
  }
  addEventListener(type: string, l: (e: MessageEvent) => void) {
    (this.listeners[type] ??= []).push(l);
  }
  close() {}
  emit(type: string, data: unknown) {
    for (const l of this.listeners[type] ?? []) l({ data: JSON.stringify(data), lastEventId: "" } as MessageEvent);
  }
}
const live = { createSource: (url: string) => new FakeES(url), checkSession: async () => true };

const device: DeviceDetail = {
  id: "1042",
  name: "AM107-067999",
  externalId: "24e124707c067999",
  kind: "SENSOR",
  status: "ACTIVE",
  version: 4,
  source: { id: "7", name: "ChirpStack s3", type: "MQTT_SUBSCRIBE" },
  space: { id: "31", name: "실습실", path: ["본관", "3층", "실습실"] },
  state: { connectivity: "ONLINE", lastSeenAt: "2026-10-03T23:59:48Z", battery: 92, rssi: -33, snr: 13.5, bestGatewayEui: "24e124fffef79304" },
  latest: [{ metricKey: "co2", displayName: "CO2", unit: "ppm", value: 517, measuredAt: "2026-10-03T23:59:48Z", quality: 0 }],
  effective: { expectedIntervalSec: 60, offlineMultiplier: 3, inheritedFrom: "MODEL" },
  onboarding: { firstData: true, model: true, space: true, decodeOk: true, rulesApplied: false },
};

describe("기기 하위 탭과 상태 표시", () => {
  it("하위 탭 9개(M4 일괄 작업, M5 게이트웨이·작업 지시·설치 현황 포함)와 승인 대기 수, 현재 탭 표시", async () => {
    await renderRoute(<DeviceAreaTabs current="pending" pendingCount={2} />);
    const current = await screen.findByRole("link", { name: "승인 대기 (2)" });
    expect(current).toHaveAttribute("aria-current", "page");
    expect(screen.getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual(["/devices", "/devices/pending", "/models", "/metrics", "/device-groups", "/device-jobs", "/gateways", "/work-orders", "/devices/installation"]);
  });

  it("상태 배지(용어 툴팁), 연결 표시, 배터리 막대(20% 이하 경고), 품질 표시", async () => {
    await renderRoute(
      <>
        <DeviceStatusBadge status="PENDING" />
        <ConnectivityLabel connectivity={null} />
        <BatteryBar value={1} />
        <BatteryBar value={null} />
        <LatestValueCards latest={[{ metricKey: "temperature", unit: "℃", value: 61, quality: 1 }]} lang="ko" />
      </>,
    );
    expect(await screen.findByText("승인 대기")).toBeInTheDocument();
    expect(screen.getByText("알 수 없음")).toBeInTheDocument();
    expect(screen.getByLabelText("배터리 1%")).toBeInTheDocument();
    expect(screen.getByText("1%")).toHaveClass("text-bad-ink");
    expect(screen.getByText("61℃")).toBeInTheDocument();
    expect(screen.getByText("품질 1")).toBeInTheDocument();
  });
});

describe("TC-DEV-037 개요 실시간 갱신(API-DSH-20 space 토픽)", () => {
  it("같은 기기의 device-update만 현재값에 반영, 수신 이력 없으면 안내", async () => {
    FakeES.all = [];
    const { unmount } = await renderRoute(<DeviceOverview device={device} timezone="Asia/Seoul" lang="ko" now={Date.parse("2026-10-04T00:00:00Z")} live={live} />);
    expect(await screen.findByText("517ppm")).toBeInTheDocument();
    expect(screen.getByText("12초 전 (2026-10-04 08:59:48)")).toBeInTheDocument();
    expect(screen.getByText("60초 × 3 (모델 값)")).toBeInTheDocument();
    await waitFor(() => expect(FakeES.all[0]?.url).toBe(`/bff/stream/live?topics=${encodeURIComponent("space:31")}`));
    act(() => FakeES.all[0].emit("device-update", { deviceId: "9", metrics: [{ key: "co2", value: 999 }] }));
    act(() => FakeES.all[0].emit("device-update", { deviceId: "1042", metrics: [{ key: "co2", value: 530, unit: "ppm", at: "2026-10-04T00:00:05Z" }] }));
    expect(screen.getByText("530ppm")).toBeInTheDocument();
    expect(screen.queryByText("999ppm")).toBeNull();
    unmount();
    await renderRoute(<DeviceOverview device={{ ...device, latest: [], space: null, effective: null }} timezone="UTC" lang="ko" now={0} live={live} />);
    expect(await screen.findByText(/아직 데이터를 받지 못했습니다/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "소스 연결 상태" })).toHaveAttribute("href", "/sources/7");
  });
});

describe("데이터 탭: API-TSD-02 조회 + 실시간 점 이어 그리기", () => {
  function chart() {
    const handle: ChartHandle & { last?: { series: { id: string; data: [number, number | null][] }[] } } = {
      setOption: vi.fn((o) => {
        handle.last = o as never;
      }),
      resize: vi.fn(),
      dispose: vi.fn(),
    };
    return { handle, factory: async () => handle };
  }

  it("측정 항목·기간·품질을 바꾸면 다시 조회하고, telemetry 토픽의 point를 덧붙인다", async () => {
    FakeES.all = [];
    const calls: string[] = [];
    const fetcher = vi.fn(async (path: string) => {
      calls.push(path);
      if (path.includes("/annotations")) return { ok: true as const, status: 200, data: { responses: [{ timeFrom: "2026-10-03T22:00:00Z", type: "OFFLINE", title: "오프라인" }] } };
      return { ok: true as const, status: 200, data: { resolutionUsed: "raw", series: [{ metric: "co2", unit: "ppm", points: [["2026-10-03T23:59:00Z", 517, 0]] }] } };
    });
    const { handle, factory } = chart();
    await renderRoute(
      <DeviceDataPanel deviceId="1042" metrics={["co2", "temperature"]} latest={device.latest} expectedIntervalSec={60} timezone="Asia/Seoul" now={() => Date.parse("2026-10-04T00:00:00Z")} fetcher={fetcher as never} live={live} chartFactory={factory} />,
    );
    await waitFor(() => expect(handle.setOption).toHaveBeenCalled());
    expect(calls[0]).toBe("/bff/api/core/telemetry/series?deviceId=1042&metrics=co2%2Ctemperature&from=2026-10-03T00%3A00%3A00Z&to=2026-10-04T00%3A00%3A00Z&resolution=auto&quality=normal");
    expect(calls[1]).toContain("/bff/api/core/annotations?deviceId=1042");
    await waitFor(() => expect(FakeES.all.at(-1)?.url).toBe(`/bff/stream/live?topics=${encodeURIComponent("telemetry:1042.co2,telemetry:1042.temperature")}`));
    const source = FakeES.all.at(-1)!;
    act(() => source.emit("point", { deviceId: "1042", metricKey: "co2", t: "2026-10-04T00:00:05Z", v: 530, quality: 0 }));
    act(() => source.emit("point", { deviceId: "1042", metricKey: "co2", t: "2026-10-04T00:00:06Z", v: 9999, quality: 1 }));
    act(() => source.emit("point", { deviceId: "77", metricKey: "co2", t: "2026-10-04T00:00:07Z", v: 1 }));
    await waitFor(() => expect(handle.last?.series[0].data.at(-1)).toEqual([Date.parse("2026-10-04T00:00:05Z"), 530]));

    await userEvent.selectOptions(screen.getByLabelText("기간"), "1h");
    await waitFor(() => expect(calls.some((c) => c.includes("from=2026-10-03T23%3A00%3A00Z"))).toBe(true));
    await userEvent.selectOptions(screen.getByLabelText("품질"), "all");
    await waitFor(() => expect(calls.some((c) => c.includes("quality=all"))).toBe(true));
    await userEvent.click(screen.getByLabelText("co2"));
    await userEvent.click(screen.getByLabelText("temperature"));
    expect(await screen.findByText("측정 항목을 하나 이상 고르세요")).toBeInTheDocument();
  });

  it("조회 실패면 오류와 [다시 시도]", async () => {
    let fail = true;
    const fetcher = vi.fn(async () => (fail ? { ok: false as const, status: 503, code: "SERVICE_UNAVAILABLE", message: "" } : { ok: true as const, status: 200, data: { series: [] } }));
    const { factory } = chart();
    await renderRoute(<DeviceDataPanel deviceId="1" metrics={["co2"]} timezone="UTC" now={() => 0} fetcher={fetcher as never} live={live} chartFactory={factory} />);
    expect(await screen.findByText("데이터를 불러오지 못했습니다.")).toBeInTheDocument();
    fail = false;
    await userEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    await waitFor(() => expect(screen.queryByText("데이터를 불러오지 못했습니다.")).toBeNull());
  });
});
