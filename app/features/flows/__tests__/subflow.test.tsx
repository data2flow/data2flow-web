/**
 * 서브플로우(FLW-01.04, UI-FLW-11, BR-FLW-17).
 */
import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFlowGraph } from "../model/flow-graph";
import { subflowDraft, subflowNameProblem, subflowRefs } from "../model/subflow";
import { catalog, coolingGraph, detailOf, fakeApi, renderEditor, stubReactFlowDom } from "./helpers";

beforeEach(() => stubReactFlowDom());

const nodeEl = (container: HTMLElement, id: string) => container.querySelector(`.react-flow__node[data-id="${id}"]`) as HTMLElement;

describe("FLW-01.04 TC-FLW-014 AT-FLW-13.1 서브플로우로 만들기", () => {
  it("집계·임계값 두 노드를 골라 만들기 → 입력 1·출력 이름·노출 파라미터로 API-FLW-22, 원래 플로우는 다시 불러온다", async () => {
    const onReload = vi.fn();
    const api = fakeApi();
    const { container } = await renderEditor({ role: "OPERATOR", detail: detailOf(coolingGraph()), api, onReload });
    fireEvent.click(nodeEl(container, "n-agg00001"));
    fireEvent.keyDown(document.body, { key: "Shift" });
    fireEvent.click(nodeEl(container, "n-thr00001"), { shiftKey: true });
    fireEvent.keyUp(document.body, { key: "Shift" });
    await userEvent.click(screen.getByRole("button", { name: "서브플로우로 만들기" }));
    const dialog = await screen.findByRole("dialog", { name: "서브플로우로 만들기" });
    expect(within(dialog).getByText("입력 1개 · 노드 2개")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "만들기" }));
    expect(within(dialog).getByText("이름은 1~100자로 입력하세요")).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText("이름"), "평균 후 기준 판정");
    const output = within(dialog).getByLabelText("출력 1 (true)");
    await userEvent.clear(output);
    await userEvent.type(output, "above");
    await userEvent.click(within(dialog).getByRole("checkbox", { name: /· value$/ }));
    await userEvent.clear(within(dialog).getByLabelText("표시 이름"));
    await userEvent.type(within(dialog).getByLabelText("표시 이름"), "기준값");
    await userEvent.click(within(dialog).getByRole("button", { name: "만들기" }));
    expect(api.createSubflow).toHaveBeenCalledWith({
      name: "평균 후 기준 판정",
      description: "",
      definition: expect.objectContaining({ inputs: [{ name: "in1", nodeId: "n-agg00001" }], outputs: [{ name: "above", from: "n-thr00001", port: "true" }], params: [{ path: "n-thr00001.value", label: "기준값", default: 27 }] }),
      fromFlow: { flowId: "f-7f3a", nodeIds: ["n-agg00001", "n-thr00001"] },
    });
    expect(await screen.findByText("서브플로우 평균 후 기준 판정 v1을(를) 만들었습니다")).toBeInTheDocument();
    expect(onReload).toHaveBeenCalled();
  });

  it("트리거를 포함하면 만들지 않는다, 서버 오류는 대화상자에", async () => {
    const api = fakeApi({ createSubflow: vi.fn(() => Promise.resolve({ ok: false as const, status: 400, code: "FLOW_VALIDATION_FAILED", message: "" })) });
    const { container } = await renderEditor({ role: "OPERATOR", detail: detailOf(coolingGraph()), api });
    fireEvent.click(nodeEl(container, "n-trg00001"));
    await userEvent.click(screen.getByRole("button", { name: "서브플로우로 만들기" }));
    expect(screen.getByText("트리거 노드는 서브플로우에 넣을 수 없습니다")).toBeInTheDocument();
    fireEvent.click(nodeEl(container, "n-thr00001"));
    await userEvent.click(screen.getByRole("button", { name: "서브플로우로 만들기" }));
    const dialog = await screen.findByRole("dialog", { name: "서브플로우로 만들기" });
    await userEvent.type(within(dialog).getByLabelText("이름"), "x");
    await userEvent.click(within(dialog).getByRole("button", { name: "만들기" }));
    expect(await within(dialog).findByText("검증에 실패해 적용하지 못했습니다")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "취소" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("FLW-01.04 TC-FLW-016 AT-FLW-13.2 새 버전 있음", () => {
  it("서브플로우 v2가 발행돼도 v1로 고정, 노드에 '새 버전 있음'과 [버전 올리기](명시적으로 올려야 반영)", async () => {
    const graph = createFlowGraph(catalog).node("trigger.telemetry", "n-trg00001").build();
    graph.nodes.push({ id: "n-sub00001", type: "subflow", typeVersion: 1, name: "평균 후 기준 판정", config: { subflowId: "sf-1", version: 1, params: {} }, position: { x: 300, y: 100 } });
    graph.wires.push({ from: "n-trg00001", port: "out", to: "n-sub00001" });
    const api = fakeApi({ subflow: vi.fn(() => Promise.resolve({ ok: true as const, status: 200, data: { subflowId: "sf-1", version: 2, usedBy: [] } })) });
    const { container } = await renderEditor({ role: "OPERATOR", detail: detailOf(graph), api });
    expect(await within(nodeEl(container, "n-sub00001")).findByText("새 버전 있음(v2)")).toBeInTheDocument();
    fireEvent.click(nodeEl(container, "n-sub00001"));
    expect(screen.getByText("지금 v1 · 새 버전 v2이 있습니다")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "버전 올리기" }));
    expect(within(nodeEl(container, "n-sub00001")).queryByText("새 버전 있음(v2)")).toBeNull();
    expect(screen.getByTitle("저장 안 된 변경")).toBeInTheDocument();
  });

  it("초안 모델: 입력·출력 한도와 빈 선택, 이름 규칙, 참조 목록", () => {
    const g = coolingGraph();
    expect(subflowDraft(g, [], catalog)).toEqual({ ok: false, reason: "empty" });
    expect(subflowDraft(g, ["n-act00001"], catalog)).toEqual({ ok: false, reason: "noOutput" });
    const lonely = createFlowGraph(catalog).node("condition.threshold", "n-thr00009").build();
    expect(subflowDraft(lonely, ["n-thr00009"], catalog)).toEqual({ ok: false, reason: "noInput" });
    expect(subflowNameProblem(" ")).toBe(true);
    expect(subflowNameProblem("x".repeat(101))).toBe(true);
    expect(subflowRefs(g)).toEqual([]);
  });
});
