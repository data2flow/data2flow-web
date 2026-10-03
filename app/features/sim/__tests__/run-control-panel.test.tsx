/**
 * TC-SIM-047 UI-SIM-09 `sim.tick` SSE로 경과 시간·시뮬레이션 시각 표시, 상태별 버튼 활성(PAUSED면 [재개]),
 * `sim.throttle` 띠(SIM-04.02, SIM-11.02, AT-SIM-08.2). 가짜 EventSource + 가짜 타이머(실제 시각 1초 갱신).
 */
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { meOf, renderRoute } from "../../../../test/render";
import type { ChartHandle } from "~/components/charts/timeseries-chart";
import type { EventSourceLike } from "~/lib/event-stream";
import { RunPanel } from "../components/run-panel";
import type { SimRun } from "../model/types";
import { failure, fakeSimApi } from "./fake-sim-api";

class FakeEventSource implements EventSourceLike {
  static last: FakeEventSource | undefined;
  readyState = 0;
  onopen: ((e: Event) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  listeners: Record<string, ((e: MessageEvent) => void)[]> = {};
  closed = false;
  constructor(readonly url: string) {
    FakeEventSource.last = this;
  }
  addEventListener(type: string, l: (e: MessageEvent) => void) {
    (this.listeners[type] ??= []).push(l);
  }
  close() {
    this.closed = true;
  }
  emit(type: string, data: unknown) {
    act(() => {
      for (const l of this.listeners[type] ?? []) l({ data: JSON.stringify(data), lastEventId: "" } as MessageEvent);
    });
  }
}

const RUN: SimRun = {
  runId: "42",
  status: "RUNNING",
  scenarioId: "601",
  accelerationRequested: 60,
  accelerationEffective: 60,
  throttled: false,
  simClock: "2026-08-12T04:00:00Z",
  elapsedSec: 0,
  progressPct: 0,
  expectations: [{ id: "ex-1", state: "PENDING" }],
  lastEvents: [],
};

function fakeChart() {
  const handle: ChartHandle = { setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn() };
  return vi.fn(async () => handle);
}

const createSource = (url: string) => new FakeEventSource(url);
const checkSession = async () => true;
let clock = Date.parse("2026-10-04T01:00:00Z");
const now = () => clock;
beforeEach(() => {
  clock = Date.parse("2026-10-04T01:00:00Z");
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => vi.useRealTimers());

async function render(run: SimRun = RUN, api = fakeSimApi(), canRun = true) {
  const result = await renderRoute(
    <RunPanel
      run={run}
      title="R-42 폭염 오후"
      spaceNames={{ "41": "데모 강의실" }}
      actuatorNames={{ "2002": "AC-1" }}
      targets={[{ deviceId: "2001", name: "TH-1", virtual: true }]}
      canRun={canRun}
      timezone="Asia/Seoul"
      api={api}
      now={now}
      createSource={createSource}
      checkSession={checkSession}
      chartFactory={fakeChart()}
    />,
    { session: meOf("OPERATOR") },
  );
  await screen.findByText("R-42 폭염 오후");
  if (!["FAILED", "COMPLETED", "STOPPED", "PURGED"].includes(run.status)) await waitFor(() => expect(FakeEventSource.last?.url).toBe("/bff/stream/sim/runs/42"));
  return { ...result, api };
}

beforeEach(() => {
  FakeEventSource.last = undefined;
});

describe("TC-SIM-047 AT-SIM-08.2 실행 제어 패널", () => {
  it("SSE 연결 주소, tick으로 시뮬레이션 시각·진행률·경과·장비 상태 갱신, 실제 시각은 1초마다", async () => {
    await render();
    const source = FakeEventSource.last as FakeEventSource;
    expect(source.url).toBe("/bff/stream/sim/runs/42");
    const bar = screen.getByRole("group", { name: "실행 상태" });
    expect(within(bar).getByText("실행 중")).toBeInTheDocument();
    expect(within(bar).getByText("x60")).toBeInTheDocument();
    expect(within(bar).getByText("2026-08-12 13:00:00")).toBeInTheDocument();
    expect(within(bar).getByText("2026-10-04 10:00:00")).toBeInTheDocument();
    expect(screen.getByText("실행 데이터를 기다리는 중입니다.")).toBeInTheDocument();
    source.emit("sim.tick", { simClock: "2026-08-12T04:10:00Z", progressPct: 4, spaces: { "41": { temperature: 27.6, co2: 900 } }, actuators: {} });
    clock += 264_000;
    source.emit("sim.tick", { simClock: "2026-08-12T04:20:00Z", progressPct: 8.3, spaces: { "41": { temperature: 27.1 } }, actuators: { "2002": { power: "ON", mode: "cool", targetTemperature: 24 } } });
    expect(within(bar).getByText("2026-08-12 13:20:00")).toBeInTheDocument();
    expect(within(bar).getByText("8%")).toBeInTheDocument();
    expect(within(bar).getByText("0:04:24")).toBeInTheDocument();
    expect(screen.getByText("power=ON mode=cool targetTemperature=24")).toBeInTheDocument();
    expect(screen.queryByText("실행 데이터를 기다리는 중입니다.")).toBeNull();
    await act(async () => {
      clock += 1000;
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(within(bar).getByText("2026-10-04 10:04:25")).toBeInTheDocument();
    source.emit("sim.event", { simAt: "2026-08-12T04:12:00Z", type: "COMMAND", message: "AC-1 Thermostat.set(cool, 24)" });
    expect(screen.getByText("AC-1 Thermostat.set(cool, 24)")).toBeInTheDocument();
    expect(screen.getByText("명령")).toBeInTheDocument();
  });

  it("상태별 버튼: RUNNING은 일시정지·정지, 일시정지하면 재개만(+정지·초기화), 재개하면 다시 일시정지", async () => {
    const { api } = await render();
    const button = (name: string) => screen.getByRole("button", { name }) as HTMLButtonElement;
    expect(button("일시정지")).toBeEnabled();
    expect(button("재개")).toBeDisabled();
    fireEvent.click(button("일시정지"));
    await waitFor(() => expect(button("재개")).toBeEnabled());
    expect(api.control).toHaveBeenCalledWith("42", "pause");
    expect(button("일시정지")).toBeDisabled();
    expect(button("정지")).toBeEnabled();
    expect(button("초기화")).toBeEnabled();
    fireEvent.click(button("재개"));
    await waitFor(() => expect(button("일시정지")).toBeEnabled());
    // 서버가 상태를 바꾸면(SSE sim.status) 버튼도 따라간다
    (FakeEventSource.last as FakeEventSource).emit("sim.status", { status: "PAUSED" });
    expect(button("재개")).toBeEnabled();
  });

  it("sim.throttle 띠와 실제 가속 표시, 가속 변경 PATCH, 상태 충돌 문구", async () => {
    const api = fakeSimApi({ control: vi.fn(() => failure(409, "SIM_RUN_STATE_CONFLICT")) });
    await render(RUN, api);
    (FakeEventSource.last as FakeEventSource).emit("sim.throttle", { from: 60, to: 24, reason: "INGEST" });
    expect(screen.getByText("실제 수집 보호를 위해 x60 → x24로 낮췄습니다")).toBeInTheDocument();
    expect(screen.getByText("x24")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("가속"), { target: { value: "30" } });
    await waitFor(() => expect(api.accelerate).toHaveBeenCalledWith("42", 30));
    fireEvent.click(screen.getByRole("button", { name: "정지" }));
    expect(await screen.findByText("지금 상태에서는 할 수 없는 동작입니다")).toBeInTheDocument();
  });

  it("끝난 실행: SSE 연결 없음, 리포트 바로가기, 실패 사유, 실행 권한 없으면 제어 없음", async () => {
    FakeEventSource.last = undefined;
    const { unmount } = await render({ ...RUN, status: "FAILED", failureReason: "INTERNAL_ERROR", expectations: [{ id: "ex-1", state: "FAILED" }], lastEvents: [{ simAt: "2026-08-12T04:00:00Z", type: "SCENARIO", message: "시작" }] }, fakeSimApi(), false);
    expect(FakeEventSource.last).toBeUndefined();
    expect(screen.getByText("실행이 실패했습니다: INTERNAL_ERROR")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "결과 리포트 보기" })).toHaveAttribute("href", "/sim/runs/42/report");
    expect(screen.queryByRole("button", { name: "일시정지" })).toBeNull();
    expect(screen.getAllByText("실패")).toHaveLength(2);
    unmount();
    await render({ ...RUN, expectations: [] });
    expect(screen.getByText("기대 결과가 없습니다.")).toBeInTheDocument();
    expect(screen.getByText("아직 이벤트가 없습니다.")).toBeInTheDocument();
  });

  it("[장애 주입]은 UI-SIM-10 대화상자를 연다", async () => {
    await render();
    fireEvent.click(screen.getByRole("button", { name: "장애 주입" }));
    expect(await screen.findByRole("dialog", { name: "장애 주입" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "닫기" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
