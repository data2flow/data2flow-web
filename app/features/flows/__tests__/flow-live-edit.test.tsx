/**
 * 라이브 편집(FLW-06): 상태 정책 요약(06.03), 바이패스·디버그(06.04), 적용 충돌(06.09), 노드 한도(10.01), JS 노드 시험 실행.
 */
import { act, fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFlowGraph, toDefinition } from "../model/flow-graph";
import { initialState, isDirty, toggleOverlay } from "../store/flow-editor-store";
import { catalog, coolingGraph, detailOf, fakeApi, renderEditor, stubReactFlowDom } from "./helpers";

beforeEach(() => stubReactFlowDom());
afterEach(() => vi.useRealTimers());

const nodeEl = (container: HTMLElement, id: string) => container.querySelector(`.react-flow__node[data-id="${id}"]`) as HTMLElement;
const active = (overrides: object = {}) => ({ ...detailOf(coolingGraph(), { status: "ACTIVE", activeVersion: 13, draftVersion: null }), overlay: { bypass: [], debug: [], revision: 4 }, ...overrides });

describe("FLW-06.03 TC-FLW-138 AT-FLW-03.3 노드 상태 이어받기 요약", () => {
  it("측정 항목을 temperature→co2로 바꾼 노드는 RESET, 기준값만 바꾼 노드는 KEEP으로 요약하고 정책 뜻을 함께 보인다", async () => {
    const validate = vi.fn(() => Promise.resolve({ ok: true as const, status: 200, data: { errors: [], warnings: [], changeSummary: { added: [], removed: [], changed: [{ nodeId: "n-thr00001", statePolicy: "RESET" as const }, { nodeId: "n-agg00001", statePolicy: "MIGRATE" as const }] }, risky: { controlNodesChanged: false, executionModeChanged: false } } }));
    await renderEditor({ role: "OPERATOR", detail: detailOf(coolingGraph(), { status: "ACTIVE", activeVersion: 13, draftVersion: 14 }), api: fakeApi({ validate }) });
    await userEvent.click(screen.getByRole("button", { name: "적용" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("~ 임계값 · 상태: 초기화(RESET)")).toBeInTheDocument();
    expect(within(dialog).getByText(/^~ .+ · 상태: 변환\(MIGRATE\)$/)).toBeInTheDocument();
    expect(within(dialog).getByText("초기화(RESET): 상태를 지우고 새로 시작합니다")).toBeInTheDocument();
    expect(within(dialog).getByText("노드 상태 처리는 노드 종류의 규칙(BR-FLW-07)으로 정해집니다", { selector: "li" })).toBeInTheDocument();
  });
});

describe("FLW-06.04 TC-FLW-147 바이패스·디버그(overlay)", () => {
  it("바이패스 토글은 overlay만 바꾸고 정의·저장 상태는 그대로", () => {
    const detail = detailOf(coolingGraph(), { status: "ACTIVE", activeVersion: 13, draftVersion: null });
    const state = initialState(detail);
    const before = JSON.stringify(toDefinition(state.history.present));
    const next = toggleOverlay({ bypass: [], debug: ["n-x"], revision: 4 }, "bypass", "n-act00001", true);
    expect(next).toEqual({ bypass: ["n-act00001"], debug: ["n-x"], revision: 4 });
    expect(toggleOverlay(next, "bypass", "n-act00001", false).bypass).toEqual([]);
    expect(JSON.stringify(toDefinition(state.history.present))).toBe(before);
    expect(isDirty(state)).toBe(false);
  });

  it("INTEGRATOR: 알림·제어 노드 바이패스를 켜면 PUT overlay(revision), 노드 카드 점선과 배지, 버전은 그대로", async () => {
    const api = fakeApi();
    const { container } = await renderEditor({ role: "INTEGRATOR", detail: active(), api });
    fireEvent.click(nodeEl(container, "n-act00001"));
    await userEvent.click(screen.getByRole("checkbox", { name: "바이패스(일시 해제)" }));
    expect(api.overlay).toHaveBeenCalledWith("f-7f3a", { bypass: ["n-act00001"], debug: [], revision: 4 });
    expect(await screen.findByText(/노드를 바이패스했습니다$/)).toBeInTheDocument();
    expect(nodeEl(container, "n-act00001").querySelector('[data-bypassed="true"]')).not.toBeNull();
    await userEvent.click(screen.getByRole("checkbox", { name: "디버그" }));
    expect(api.overlay).toHaveBeenLastCalledWith("f-7f3a", { bypass: ["n-act00001"], debug: ["n-act00001"], revision: 5 });
    expect(api.saveDraft).not.toHaveBeenCalled();
  });

  it("OPERATOR(제어 배포 권한 없음)는 제어 노드 바이패스를 못 바꾼다. revision 충돌(409)은 새로 불러온다", async () => {
    const onReload = vi.fn();
    const api = fakeApi({ overlay: vi.fn(() => Promise.resolve({ ok: false as const, status: 409, code: "FLOW_VERSION_CONFLICT", message: "" })) });
    const { container } = await renderEditor({ role: "OPERATOR", detail: active(), api, onReload });
    fireEvent.click(nodeEl(container, "n-act00001"));
    expect(await screen.findByRole("checkbox", { name: "바이패스(일시 해제)" })).toBeDisabled();
    expect((await screen.findAllByText("제어 노드 바이패스는 제어 배포 권한이 필요합니다")).length).toBeGreaterThan(0);
    fireEvent.click(nodeEl(container, "n-thr00001"));
    await userEvent.click(await screen.findByRole("checkbox", { name: "디버그" }));
    expect(await screen.findByText("다른 사람이 먼저 바이패스·디버그를 바꿨습니다. 새로 불러왔습니다")).toBeInTheDocument();
    expect(onReload).toHaveBeenCalled();
  });

  it("서버가 403이면 권한 안내, 승인 필요(202)면 승인 요청 안내, 적용 전 플로우에는 토글이 없다", async () => {
    const overlay = vi.fn().mockResolvedValueOnce({ ok: false, status: 403, code: "PERMISSION_DENIED", message: "" }).mockResolvedValueOnce({ ok: true, status: 202, data: { approvalId: "ap-1" } });
    const { container, unmount } = await renderEditor({ role: "INTEGRATOR", detail: active(), api: fakeApi({ overlay }) });
    fireEvent.click(nodeEl(container, "n-act00001"));
    await userEvent.click(await screen.findByRole("checkbox", { name: "바이패스(일시 해제)" }));
    expect(await screen.findByText("제어 노드 바이패스는 제어 배포 권한이 필요합니다", { selector: "[role=alert], [role=alert] *" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("checkbox", { name: "바이패스(일시 해제)" }));
    expect(await screen.findByText("승인 요청을 보냈습니다")).toBeInTheDocument();
    unmount();
    const draft = await renderEditor({ role: "INTEGRATOR", detail: detailOf(coolingGraph()) });
    fireEvent.click(nodeEl(draft.container, "n-act00001"));
    expect(screen.queryByRole("checkbox", { name: "바이패스(일시 해제)" })).toBeNull();
  });
});

describe("FLW-06.09 TC-FLW-162 AT-FLW-07.1 적용 충돌", () => {
  it("B가 먼저 적용한 뒤 A가 적용 → 409, 덮어쓰지 않았다는 안내와 [차이 보기](실행 v15 → 내 초안 v14)", async () => {
    const api = fakeApi({
      apply: vi.fn(() => Promise.resolve({ ok: false as const, status: 409, code: "FLOW_VERSION_CONFLICT", message: "" })),
      versions: vi.fn(() => Promise.resolve({ ok: true as const, status: 200, data: { responses: [{ version: 15, state: "ACTIVE" }, { version: 14, state: "DRAFT" }], totalCount: 2 } })),
    });
    await renderEditor({ role: "OPERATOR", detail: detailOf(coolingGraph(), { status: "ACTIVE", activeVersion: 13, draftVersion: 14 }), api });
    await userEvent.click(screen.getByRole("button", { name: "적용" }));
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "적용" }));
    expect(await screen.findByText(/다른 사람이 먼저 적용했습니다/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "차이 보기" }));
    expect(api.diff).toHaveBeenCalledWith("f-7f3a", 15, 14);
    expect(await screen.findByText(/실행 v15 → 내 초안 v14/)).toBeInTheDocument();
  });
});

describe("FLW-10.01 TC-FLW-207 AT-FLW-22.1 노드 한도", () => {
  it("저장이 FLOW_NODE_LIMIT_EXCEEDED면 한도와 현재 수를 보이고, 200개에서는 화면에서 더 추가하지 않는다", async () => {
    let builder = createFlowGraph(catalog).node("trigger.telemetry", "n-trg00001");
    for (let i = 1; i < 200; i++) builder = builder.node("debug.log", `n-dbg${String(i).padStart(5, "0")}`);
    const graph = builder.build();
    const api = fakeApi({ saveDraft: vi.fn(() => Promise.resolve({ ok: false as const, status: 400, code: "FLOW_NODE_LIMIT_EXCEEDED", message: "" })) });
    await renderEditor({ role: "OPERATOR", detail: detailOf(graph), api });
    await userEvent.click(screen.getByRole("button", { name: "텔레메트리 추가" }));
    expect(await screen.findByText("노드는 플로우당 최대 200개입니다(현재 200개)")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(await screen.findByText("노드는 플로우당 최대 200개입니다(현재 200개)")).toBeInTheDocument();
  });
});

describe("FLW-07 JS 노드 [노드 시험 실행](설정 패널)", () => {
  it("저장된 플로우의 JS 노드는 지금 편집 중인 정의와 startNodeId로 시험 실행한다", async () => {
    const graph = createFlowGraph(catalog).node("trigger.telemetry", "n-trg00001").node("transform.js", "n-js000001", { code: "return {...msg, payload: {t: msg.payload.temperature / 10}};", outputs: 1 }).wire("n-trg00001", "out", "n-js000001").build();
    const api = fakeApi({ testRun: vi.fn(() => Promise.resolve({ ok: true as const, status: 200, data: { trace: { messageId: "m", steps: [{ nodeId: "n-js000001", type: "transform.js", outputs: [{ port: "out1", payload: { payload: { t: 2.81 } } }] }] } } })) });
    const { container } = await renderEditor({ role: "OPERATOR", detail: detailOf(graph), api });
    fireEvent.click(nodeEl(container, "n-js000001"));
    await userEvent.click(screen.getByRole("button", { name: "노드 시험 실행" }));
    expect(api.testRun).toHaveBeenCalledWith("f-7f3a", expect.objectContaining({ startNodeId: "n-js000001", input: { message: expect.objectContaining({ payload: { temperature: 28.1, humidity: 41 } }) }, definition: expect.objectContaining({ nodes: expect.any(Array) }) }));
    expect(await screen.findByText(/"t": 2.81/)).toBeInTheDocument();
  });

  it("[시험 실행] 버튼은 하단 시험 실행 탭을 연다", async () => {
    await renderEditor({ role: "OPERATOR", detail: detailOf(coolingGraph()) });
    await userEvent.click(screen.getByRole("button", { name: "시험 실행" }));
    expect(await screen.findByRole("region", { name: "시험 실행(드라이런)" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "시험 실행" })).toHaveAttribute("aria-selected", "true");
  });

  it("과거 재생 결과의 분기 건수를 캔버스 포트 옆에 겹쳐 보이고 지울 수 있다", async () => {
    const api = fakeApi({ replayJob: vi.fn(() => Promise.resolve({ ok: true as const, status: 200, data: { status: "SUCCEEDED" as const, progress: { processed: 10, total: 10 }, result: { executions: 10, branchCounts: { "n-thr00001": { true: 7 } }, actions: { command: 7, notify: 0, sink: 0 }, errors: 0 } } })) });
    const { container } = await renderEditor({ role: "OPERATOR", detail: detailOf(coolingGraph(), { status: "ACTIVE", activeVersion: 13, draftVersion: 14 }), api });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await userEvent.click(screen.getByRole("tab", { name: "시험 실행" }));
    await userEvent.click(screen.getByRole("button", { name: "재생 시작" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(within(nodeEl(container, "n-thr00001")).getByTitle("과거 재생 건수")).toHaveTextContent("7");
    await userEvent.click(screen.getByRole("button", { name: "지우기" }));
    expect(within(nodeEl(container, "n-thr00001")).queryByTitle("과거 재생 건수")).toBeNull();
  });
});
