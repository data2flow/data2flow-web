/**
 * 노드 최근 메시지(FLW-03.02, TC-FLW-068)와 실행 추적 타임라인(FLW-03.04, UI-FLW-07, TC-FLW-072).
 */
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { meOf, renderRoute } from "../../../../test/render";
import { NodeInspector, TracePanel, TraceView, actionText, pairSamples } from "../components/live-panels";
import type { NodeSample } from "../model/live";
import type { Trace } from "../model/types";

const sample = (messageId: string, direction: "in" | "out", extra: Partial<NodeSample> = {}): NodeSample => ({ t: "2026-10-04T01:12:03Z", nodeId: "n-thr00001", messageId, direction, port: direction === "out" ? "true" : null, payload: { temperature: 27.8 }, masked: false, ...extra });
const names: Record<string, string> = { "n-trg": "텔레메트리", "n-js": "평균", "n-thr": "온도>27", "n-act": "에어컨 냉방" };
const nameOf = (id: string) => names[id] ?? id;

const TRACE: Trace = {
  messageId: "7f3a-1",
  flowId: "f-7f3a",
  version: 13,
  startedAt: "2026-10-03T01:12:03.120Z",
  result: "COMPLETED",
  steps: [
    { nodeId: "n-trg", type: "trigger.telemetry", inMs: 0, durationMs: 0.2, input: { a: 1 }, outputs: [{ port: "out", payload: {} }] },
    { nodeId: "n-js", type: "transform.js", durationMs: 0.8, outputs: [{ port: "out1", payload: { avg: 27.9 } }] },
    { nodeId: "n-thr", type: "condition.threshold", durationMs: 0.4, outputs: [{ port: "true" }] },
    { nodeId: "n-act", type: "action.control", durationMs: 1.6, outputs: [{ port: "ok" }], action: { kind: "COMMAND", idempotencyKey: "9c1f00aa", dryRun: true, skipped: null, summary: "Thermostat.set(cool,24)" } },
  ],
};

describe("FLW-03.02 TC-FLW-068 노드 최근 메시지", () => {
  it("입력·출력 JSON을 나란히, 분기 포트 배지, 가려진 메시지 '권한 밖 데이터', [추적 보기]", async () => {
    const onTrace = vi.fn();
    await renderRoute(<NodeInspector nodeName="온도>27" samples={[sample("m-2", "out", { port: "false" }), sample("m-2", "in"), sample("m-1", "out", { masked: true, payload: undefined }), sample("m-1", "in", { masked: true })]} timezone="Asia/Seoul" onTrace={onTrace} droppedPerSec={15} />, { session: meOf("OPERATOR") });
    const region = await screen.findByRole("region", { name: "온도>27 최근 메시지" });
    const rows = within(region).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText("→ false")).toBeInTheDocument();
    expect(within(rows[0]).getAllByText(/"temperature": 27.8/)).toHaveLength(2);
    expect(within(rows[1]).getAllByText("권한 밖 데이터")).toHaveLength(2);
    expect(within(region).getByText("메시지가 많아 서버가 초당 15건을 줄여 보내고 있습니다")).toBeInTheDocument();
    await userEvent.click(within(rows[0]).getByRole("button", { name: "추적 보기" }));
    expect(onTrace).toHaveBeenCalledWith("m-2");
  });

  it("빈 버퍼는 '아직 지나간 메시지가 없습니다', 같은 메시지의 입·출력 묶기", async () => {
    await renderRoute(<NodeInspector nodeName="온도>27" samples={[]} timezone="Asia/Seoul" />, { session: meOf("OPERATOR") });
    expect(await screen.findByText("아직 지나간 메시지가 없습니다")).toBeInTheDocument();
    expect(pairSamples([sample("a", "out"), sample("a", "in"), sample("b", "out")]).map((r) => [r.messageId, Boolean(r.input), r.outputs.length])).toEqual([
      ["a", true, 1],
      ["b", false, 1],
    ]);
  });
});

describe("FLW-03.04 TC-FLW-072 실행 추적 타임라인", () => {
  it("노드 순서대로 막대, 길이는 소요 시간에 비례, 행동 노드는 드라이런 표시, 노드를 누르면 캔버스에서 선택", async () => {
    const onSelect = vi.fn();
    await renderRoute(<TraceView trace={TRACE} nameOf={nameOf} timezone="Asia/Seoul" onSelectNode={onSelect} />, { session: meOf("OPERATOR") });
    const steps = await screen.findAllByTestId("trace-step");
    expect(steps.map((s) => within(s).getAllByText(/./)[0].textContent)).toEqual(["텔레메트리", "평균", "온도>27", "에어컨 냉방"]);
    const widths = screen.getAllByTestId("trace-bar").map((b) => (b as HTMLElement).style.width);
    expect(widths).toEqual(["13%", "50%", "25%", "100%"]);
    expect(screen.getByText("드라이런(실행 안 함): 제어 Thermostat.set(cool,24)")).toBeInTheDocument();
    expect(screen.getByText("메시지 7f3a-1")).toBeInTheDocument();
    expect(screen.getByText("끝까지 처리")).toBeInTheDocument();
    await userEvent.click(within(steps[2]).getAllByRole("button")[0]);
    expect(onSelect).toHaveBeenCalledWith("n-thr");
  });

  it("오류 노드는 강조하고 오류 코드·줄 번호, 행동 결과 문구(건너뜀·아웃박스)", async () => {
    const failed: Trace = { messageId: "m-x", steps: [{ nodeId: "n-js", type: "transform.js", durationMs: 50, outputs: [{ port: "error" }], error: { code: "SCRIPT_TIMEOUT", message: "50ms 초과", line: 3 } }], result: "FAILED", error: { code: "SCRIPT_TIMEOUT", nodeId: "n-js" } };
    await renderRoute(<TraceView trace={failed} nameOf={nameOf} timezone="Asia/Seoul" />, { session: meOf("OPERATOR") });
    expect(await screen.findByRole("alert")).toHaveTextContent("오류 SCRIPT_TIMEOUT: 50ms 초과 (3번째 줄)");
    expect(screen.getByTestId("trace-step").className).toContain("border-bad");
    const t = (key: string, o?: Record<string, unknown>) => `${key}:${JSON.stringify(o ?? {})}`;
    expect(actionText(t, { nodeId: "a", type: "x", action: { kind: "NOTIFY", skipped: "BYPASSED" } })).toContain("flows.trace.skipped");
    expect(actionText(t, { nodeId: "a", type: "x", action: { kind: "SINK", dryRun: false, idempotencyKey: "abcdef123" } })).toContain('"key":"abcdef12"');
    expect(actionText(t, { nodeId: "a", type: "x" })).toBeUndefined();
  });

  it("ADR-048 공간 범위 밖 내용은 core가 가린다(input null·payload null, masked=true) → '일부 가림'과 안내 문구", async () => {
    const masked: Trace = {
      messageId: "m-scope",
      result: "COMPLETED",
      steps: [
        { nodeId: "n-trg", type: "trigger.telemetry", durationMs: 0.2, input: null, masked: true, outputs: [{ port: "out", payload: null, masked: true }] },
        { nodeId: "n-thr", type: "condition.threshold", durationMs: 0.4, input: { temperature: 27.8 }, outputs: [{ port: "true" }] },
      ],
    };
    await renderRoute(<TraceView trace={masked} nameOf={nameOf} timezone="Asia/Seoul" />, { session: meOf("OPERATOR") });
    const steps = await screen.findAllByTestId("trace-step");
    expect(within(steps[0]).getByTestId("trace-masked")).toHaveTextContent("일부 가림");
    expect(within(steps[0]).getByText("권한 범위 밖 공간의 내용이라 가렸습니다")).toBeInTheDocument();
    expect(within(steps[1]).queryByTestId("trace-masked")).toBeNull();
  });

  it("[추적] 탭: 메시지 ID로 불러오기, 없으면(404) 1시간 보관 안내", async () => {
    const trace = vi.fn().mockResolvedValueOnce({ ok: false, status: 404, code: "RESOURCE_NOT_FOUND", message: "" }).mockResolvedValueOnce({ ok: true, status: 200, data: TRACE });
    await renderRoute(<TracePanel flowId="f-7f3a" api={{ trace }} nameOf={nameOf} timezone="Asia/Seoul" onSelectNode={vi.fn()} />, { session: meOf("OPERATOR") });
    await userEvent.type(await screen.findByLabelText(/메시지 ID/), "old-1");
    await userEvent.click(screen.getByRole("button", { name: "불러오기" }));
    expect(await screen.findByText(/추적이 없습니다/)).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText(/메시지 ID/));
    await userEvent.type(screen.getByLabelText(/메시지 ID/), "7f3a-1");
    await userEvent.click(screen.getByRole("button", { name: "불러오기" }));
    expect(await screen.findByText("메시지 7f3a-1")).toBeInTheDocument();
    expect(trace).toHaveBeenLastCalledWith("f-7f3a", "7f3a-1");
  });

  it("디버그 메시지에서 넘어오면 바로 불러온다", async () => {
    const trace = vi.fn().mockResolvedValue({ ok: true, status: 200, data: TRACE });
    await renderRoute(<TracePanel flowId="f-7f3a" api={{ trace }} initialMessageId="7f3a-1" nameOf={nameOf} timezone="Asia/Seoul" onSelectNode={vi.fn()} />, { session: meOf("OPERATOR") });
    expect(await screen.findByText("메시지 7f3a-1")).toBeInTheDocument();
  });
});
