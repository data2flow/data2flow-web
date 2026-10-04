/**
 * 시험 실행·과거 재생(UI-FLW-06, FLW-03.05·03.06)과 JS 노드 시험 실행(FLW-07 transform.js, FLW-10.01 64KB).
 */
import { act, fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { meOf, renderRoute } from "../../../../test/render";
import { JsTestRun } from "../components/js-test-run";
import { TestRunPanel, type TestRunPanelProps } from "../components/test-run-panel";
import { checkTestMessage, replayDone, replayPercent, replayRange, sampleMessage, toCanonicalTelemetry } from "../model/test-run";
import type { Trace } from "../model/types";

afterEach(() => vi.useRealTimers());

const NOW = Date.parse("2026-10-04T01:00:00Z");
const DRY: Trace = {
  messageId: "m-test",
  version: 14,
  steps: [
    { nodeId: "n-thr00001", type: "condition.threshold", durationMs: 0.3, outputs: [{ port: "true" }] },
    { nodeId: "n-act00001", type: "action.control", durationMs: 1, outputs: [{ port: "ok" }], action: { kind: "COMMAND", dryRun: true, summary: "Thermostat.set(cool,24)" } },
  ],
  result: "COMPLETED",
};
const ok = <T,>(data: T, status = 200) => Promise.resolve({ ok: true as const, status, data });

function panel(overrides: Partial<TestRunPanelProps> = {}) {
  const api = {
    testRun: vi.fn(() => ok({ trace: DRY })),
    replay: vi.fn(() => ok({ jobId: "9001", status: "QUEUED" as const }, 202)),
    replayJob: vi.fn(),
    cancelReplay: vi.fn(),
    rawMessages: vi.fn(() => ok({ responses: [{ id: "9001", receivedAt: "2026-10-04T00:12:03Z", deviceId: "1042", deviceName: "EM300-TH-151606" }] })),
    ...(overrides.api ?? {}),
  };
  const props: TestRunPanelProps = {
    flowId: "f-7f3a",
    version: 14,
    dirty: false,
    definition: () => ({ schema: "data2flow.flow-definition/v1", nodes: [], wires: [] }),
    devices: [{ id: "1042", name: "EM300-TH-151606", spaceId: "31", modelId: null, tags: [] }],
    timezone: "Asia/Seoul",
    now: () => NOW,
    nameOf: (id) => ({ "n-thr00001": "온도>27", "n-act00001": "에어컨 냉방" })[id] ?? id,
    onSelectNode: vi.fn(),
    onReplayCounts: vi.fn(),
    ...overrides,
    api,
  };
  return { props, api, view: renderRoute(<TestRunPanel {...props} />, { session: meOf("OPERATOR") }) };
}

describe("FLW-03.05 TC-FLW-073 AT-FLW-05.1 시험 실행(드라이런)", () => {
  it("최근 원본 메시지(최근 24시간)를 골라 실행 → 노드별 결과와 제어 노드 '드라이런(실행 안 함)'", async () => {
    const { api, view } = panel();
    await view;
    const region = await screen.findByRole("region", { name: "시험 실행(드라이런)" });
    await within(region).findByRole("option", { name: /EM300-TH-151606/ });
    expect(api.rawMessages).toHaveBeenCalledWith({ from: "2026-10-03T01:00:00.000Z", to: "2026-10-04T01:00:00.000Z" });
    await userEvent.click(within(region).getByRole("button", { name: "실행" }));
    expect(api.testRun).toHaveBeenCalledWith("f-7f3a", { definition: { schema: "data2flow.flow-definition/v1", nodes: [], wires: [] }, input: { rawMessageId: "9001" } });
    expect(await within(region).findByText("드라이런(실행 안 함): 제어 Thermostat.set(cool,24)")).toBeInTheDocument();
  });

  it("직접 입력: JSON 형식·표준 메시지 검사, 통과하면 message로 보낸다. TC-FLW-075 400 FLOW_TEST_INPUT_INVALID 문구", async () => {
    const testRun = vi.fn().mockResolvedValueOnce({ ok: false, status: 400, code: "FLOW_TEST_INPUT_INVALID", message: "" }).mockResolvedValueOnce({ ok: true, status: 200, data: { trace: DRY } });
    const { view } = panel({ api: { testRun } as never });
    await view;
    await userEvent.click(await screen.findByRole("radio", { name: "직접 입력" }));
    const box = screen.getByLabelText("표준 메시지(JSON)");
    expect((box as HTMLTextAreaElement).value).toContain('"temperature"');
    await userEvent.clear(box);
    await userEvent.type(box, "{{");
    await userEvent.click(screen.getByRole("button", { name: "실행" }));
    expect(screen.getByRole("alert")).toHaveTextContent("JSON 형식이 올바르지 않습니다");
    await userEvent.clear(box);
    await userEvent.type(box, '{{"deviceId":1}');
    await userEvent.click(screen.getByRole("button", { name: "실행" }));
    expect(screen.getByRole("alert")).toHaveTextContent("표준 메시지 형식이 아닙니다: measuredAt");
    fireEvent.change(box, { target: { value: '{"deviceId":1,"measuredAt":"2026-10-04T00:00:00Z","metrics":[{"key":"temperature","value":28}]}' } });
    await userEvent.click(screen.getByRole("button", { name: "실행" }));
    expect(await screen.findByText("입력 형식이 올바르지 않습니다")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "실행" }));
    // 엔진은 contracts CanonicalTelemetry로 읽으므로 봉투 필수 항목(조직·소스·외부 ID·상태·원본 ID·수신 시각)을 시험용 값으로 채워 보낸다
    expect(testRun).toHaveBeenLastCalledWith(
      "f-7f3a",
      expect.objectContaining({
        input: { message: expect.objectContaining({ v: 1, organizationId: 1, sourceId: 1, externalId: "test-1", deviceStatus: "ACTIVE", rawMessageId: 1, receivedAt: "2026-10-04T00:00:00Z", deviceId: 1, measuredAt: "2026-10-04T00:00:00Z", metrics: [{ key: "temperature", value: 28 }] }) },
      }),
    );
    expect(await screen.findByText(/드라이런\(실행 안 함\)/)).toBeInTheDocument();
  });

  it("최근 원본 메시지가 없으면 안내, 저장 안 한 편집은 그 내용으로 실행한다고 알린다", async () => {
    const { view } = panel({ dirty: true, api: { rawMessages: vi.fn(() => ok({ responses: [] })) } as never });
    await view;
    expect(await screen.findByText("최근 24시간 원본 메시지가 없습니다. 직접 입력을 쓰세요")).toBeInTheDocument();
    expect(screen.getByText(/저장하지 않은 편집 내용으로 실행합니다/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "실행" }));
    expect(screen.getByRole("alert")).toHaveTextContent("원본 메시지를 고르세요");
  });
});

describe("FLW-03.06 TC-FLW-076 AT-FLW-05.2 과거 재생", () => {
  it("7일 재생 → 진행률 → '실행·제어·알림' 요약과 분기 건수를 캔버스로, 실제 행동 0건 안내", async () => {
    const replayJob = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, data: { status: "RUNNING", progress: { processed: 500, total: 1000 } } })
      .mockResolvedValueOnce({ ok: true, status: 200, data: { status: "SUCCEEDED", progress: { processed: 1000, total: 1000 }, result: { executions: 1000, branchCounts: { "n-thr00001": { true: 12, false: 988 } }, actions: { command: 12, notify: 3, sink: 0 }, errors: 0 } } });
    const onReplayCounts = vi.fn();
    const { api, view } = panel({ onReplayCounts, api: { replayJob } as never });
    await view;
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await userEvent.click(await screen.findByRole("button", { name: "재생 시작" }));
    expect(api.replay).toHaveBeenCalledWith("f-7f3a", { version: 14, from: "2026-09-27T15:00:00Z", to: "2026-10-04T15:00:00Z", deviceIds: undefined });
    expect(screen.getByText("대기 중")).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(screen.getByRole("progressbar", { name: "재생 진행률" })).toHaveAttribute("aria-valuenow", "50");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(screen.getByText("실행 1000회 · 제어 12회 · 알림 3회 · 저장 0회 · 오류 0건")).toBeInTheDocument();
    expect(screen.getByText("온도>27: true 12 · false 988")).toBeInTheDocument();
    expect(screen.getByText("드라이런이라 실제 명령·알림은 0건입니다")).toBeInTheDocument();
    expect(onReplayCounts).toHaveBeenLastCalledWith({ "n-thr00001": { true: 12, false: 988 } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(replayJob).toHaveBeenCalledTimes(2);
  });

  it("기간 7일 초과는 화면에서 거부, TC-FLW-077 FLOW_REPLAY_TOO_LARGE는 '기간을 줄여 주세요', 대상 기기 필터", async () => {
    const replay = vi.fn(() => Promise.resolve({ ok: false as const, status: 400, code: "FLOW_REPLAY_TOO_LARGE", message: "" }));
    const { view } = panel({ api: { replay } as never });
    await view;
    const from = await screen.findByLabelText("시작일");
    await userEvent.clear(from);
    await userEvent.type(from, "2026-09-20");
    await userEvent.click(screen.getByRole("button", { name: "재생 시작" }));
    expect(screen.getByRole("alert")).toHaveTextContent("기간은 최대 7일입니다");
    expect(replay).not.toHaveBeenCalled();
    await userEvent.clear(from);
    await userEvent.type(from, "2026-10-02");
    await userEvent.selectOptions(screen.getByLabelText("대상 기기"), "1042");
    await userEvent.click(screen.getByRole("button", { name: "재생 시작" }));
    expect(replay).toHaveBeenCalledWith("f-7f3a", expect.objectContaining({ deviceIds: ["1042"] }));
    expect(await screen.findByText("재생할 데이터가 너무 많습니다. 기간을 줄여 주세요")).toBeInTheDocument();
  });

  it("엔진이 전체 건수를 모르면(total null) 처리 건수만, [재생 취소] → POST cancel → 취소됨, 더 묻지 않음", async () => {
    const replayJob = vi.fn().mockResolvedValue({ ok: true, status: 200, data: { jobId: "9001", flowId: "f-7f3a", status: "RUNNING", progress: { processed: 500, total: null }, result: null, error: null } });
    const cancelReplay = vi.fn(() => ok({ jobId: "9001", flowId: "f-7f3a", status: "CANCELLED" as const, progress: { processed: 500, total: null }, result: null, error: null }));
    const { view } = panel({ api: { replayJob, cancelReplay } as never });
    await view;
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await userEvent.click(await screen.findByRole("button", { name: "재생 시작" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(screen.getByText("500건 처리")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "재생 진행률" })).toHaveAttribute("aria-valuenow", "0");
    await userEvent.click(screen.getByRole("button", { name: "재생 취소" }));
    expect(cancelReplay).toHaveBeenCalledWith("9001");
    expect(await screen.findByText("취소됨")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "재생 취소" })).toBeNull();
    const calls = replayJob.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(replayJob).toHaveBeenCalledTimes(calls);
  });

  it("재생 실패면 엔진 오류 문구를 보인다", async () => {
    const replayJob = vi.fn().mockResolvedValue({ ok: true, status: 200, data: { jobId: "9001", flowId: "f-7f3a", status: "FAILED", progress: { processed: 10, total: 100 }, result: null, error: "텔레메트리 조회 실패" } });
    const { view } = panel({ api: { replayJob } as never });
    await view;
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await userEvent.click(await screen.findByRole("button", { name: "재생 시작" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(screen.getByText("실패")).toBeInTheDocument();
    expect(screen.getByText("텔레메트리 조회 실패")).toBeInTheDocument();
  });

  it("저장한 버전이 없으면 재생할 수 없다", async () => {
    const { view } = panel({ version: null });
    await view;
    await userEvent.click(await screen.findByRole("button", { name: "재생 시작" }));
    expect(await screen.findByText("저장한 버전이 있어야 재생할 수 있습니다")).toBeInTheDocument();
  });
});

describe("시험 입력·재생 기간 모델", () => {
  it("표준 메시지 검사, 기간(시간대 기준, 끝 날짜 포함), 진행률", () => {
    expect(checkTestMessage("[]")).toEqual({ ok: false, error: "schema" });
    expect(checkTestMessage('{"measuredAt":"x"}')).toEqual({ ok: false, error: "schema", field: "deviceId" });
    expect(checkTestMessage('{"deviceId":1,"measuredAt":"2026-10-04T00:00:00Z","metrics":[]}')).toEqual({ ok: false, error: "schema", field: "metrics" });
    expect(checkTestMessage(JSON.stringify(sampleMessage("2026-10-04T00:00:00Z", "1042", "31"))).ok).toBe(true);
    expect(sampleMessage("2026-10-04T00:00:00Z")).toMatchObject({ deviceId: 1 });
    // 사용자가 적은 값이 시험용 기본값보다 앞선다
    expect(toCanonicalTelemetry({ deviceId: 7, organizationId: 3, measuredAt: "2026-10-04T00:00:00Z" }, "2026-10-05T00:00:00Z")).toMatchObject({ deviceId: 7, organizationId: 3, receivedAt: "2026-10-04T00:00:00Z", deviceStatus: "ACTIVE", externalId: "test-7" });
    expect(replayPercent({ status: "RUNNING", progress: { processed: 5, total: null } })).toBe(0);
    expect(replayRange("2026-10-01", "2026-10-01", "Asia/Seoul")).toEqual({ ok: true, from: "2026-09-30T15:00:00Z", to: "2026-10-01T15:00:00Z" });
    expect(replayRange("2026-10-02", "2026-10-01", "Asia/Seoul")).toEqual({ ok: false, error: "order" });
    expect(replayRange("", "2026-10-01", "Asia/Seoul")).toEqual({ ok: false, error: "required" });
    expect(replayRange("2026-10-01", "x", "Asia/Seoul")).toEqual({ ok: false, error: "required" });
    expect(replayPercent({ status: "SUCCEEDED" })).toBe(100);
    expect(replayPercent({ status: "RUNNING", progress: { processed: 1, total: 0 } })).toBe(0);
    expect(replayPercent(null)).toBe(0);
    expect(replayDone({ status: "FAILED" })).toBe(true);
    expect(replayDone(null)).toBe(false);
  });
});

describe("FLW-07 transform.js [노드 시험 실행]", () => {
  it("예시 메시지로 이 노드부터 실행 → 출력 포트별 메시지", async () => {
    const runner = vi.fn(() => ok({ trace: { messageId: "m", steps: [{ nodeId: "n-js1", type: "transform.js", outputs: [{ port: "out1", payload: { payload: { temperature: 2.81 } } }] }] } }));
    await renderRoute(<JsTestRun nodeId="n-js1" code="return msg;" runner={runner} />, { session: meOf("OPERATOR") });
    await userEvent.click(await screen.findByRole("button", { name: "노드 시험 실행" }));
    expect(runner).toHaveBeenCalledWith("n-js1", expect.objectContaining({ payload: { temperature: 28.1, humidity: 41 } }));
    const outputs = await screen.findByRole("list", { name: "출력" });
    expect(within(outputs).getByText("out1")).toBeInTheDocument();
    expect(within(outputs).getByText(/2.81/)).toBeInTheDocument();
  });

  it("스크립트 오류는 코드·줄 번호, 출력 없음, 잘못된 JSON, 64KB 초과·저장 전에는 실행 못 함", async () => {
    const runner = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, data: { trace: { messageId: "m", steps: [{ nodeId: "n-js1", type: "transform.js", outputs: [{ port: "error" }], error: { code: "SCRIPT_ERROR", message: "x is not defined", line: 2 } }] } } })
      .mockResolvedValueOnce({ ok: true, status: 200, data: { trace: { messageId: "m", steps: [{ nodeId: "n-js1", type: "transform.js", outputs: [] }] } } })
      .mockResolvedValueOnce({ ok: false, status: 400, code: "FLOW_TEST_INPUT_INVALID", message: "" });
    const { unmount } = await renderRoute(<JsTestRun nodeId="n-js1" code="return x;" runner={runner} />, { session: meOf("OPERATOR") });
    await userEvent.click(await screen.findByRole("button", { name: "노드 시험 실행" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("오류 SCRIPT_ERROR: x is not defined (2번째 줄)");
    await userEvent.click(screen.getByRole("button", { name: "노드 시험 실행" }));
    expect(await screen.findByText("출력이 없습니다(null·undefined 반환)")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "노드 시험 실행" }));
    expect(await screen.findByText("입력 형식이 올바르지 않습니다")).toBeInTheDocument();
    const box = screen.getByLabelText("예시 메시지(JSON)");
    await userEvent.clear(box);
    await userEvent.type(box, "nope");
    await userEvent.click(screen.getByRole("button", { name: "노드 시험 실행" }));
    expect(screen.getByText("JSON 형식이 올바르지 않습니다")).toBeInTheDocument();
    unmount();
    await renderRoute(<JsTestRun nodeId="n-js1" code={"x".repeat(64 * 1024 + 1)} runner={runner} />, { session: meOf("OPERATOR") });
    expect(await screen.findByText("코드가 65536바이트를 넘어 실행할 수 없습니다")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "노드 시험 실행" })).toBeDisabled();
  });

  it("저장 전 플로우는 안내만", async () => {
    await renderRoute(<JsTestRun nodeId="n-js1" code="return msg;" />, { session: meOf("OPERATOR") });
    expect(await screen.findByText("플로우를 한 번 저장하면 시험 실행할 수 있습니다")).toBeInTheDocument();
  });
});
