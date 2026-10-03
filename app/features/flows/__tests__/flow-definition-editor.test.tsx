import { act, fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFlowGraph, updateNode } from "../model/flow-graph";
import { catalog, coolingGraph, detailOf, fakeApi, renderEditor, stubReactFlowDom } from "./helpers";

beforeEach(() => stubReactFlowDom());

function nodeEl(container: HTMLElement, id: string) {
  return container.querySelector(`.react-flow__node[data-id="${id}"]`) as HTMLElement;
}

describe("FLW-01.01 TC-FLW-003 AT-FLW-02.3 노드 50개 화면 편집", () => {
  it("50개 노드 렌더·전체 선택·정렬이 한 프레임 안에 끝난다", async () => {
    const b = createFlowGraph(catalog).node("trigger.telemetry", "n-node0000");
    for (let i = 1; i < 50; i += 1) b.node("debug.log", `n-node${String(i).padStart(4, "0")}`);
    const { container } = await renderEditor({ detail: detailOf(b.build()) });
    await screen.findByRole("toolbar", { name: "편집 도구" });
    expect(container.querySelectorAll(".react-flow__node")).toHaveLength(50);
    const start = performance.now();
    await userEvent.click(screen.getByRole("button", { name: "전체 선택" }));
    expect(screen.getByText("50개 선택")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "정렬" }));
    expect(performance.now() - start).toBeLessThan(2000);
  });
});

describe("FLW-01.02 TC-FLW-010 AT-FLW-02.2 임계값 value 미입력 → 저장은 되고 배지·적용 비활성", () => {
  it("저장 성공, 노드 오류 배지, 적용 버튼 비활성과 이유", async () => {
    const graph = updateNode(coolingGraph(), "n-thr00001", { config: { metric: "temperature", op: ">", for: "PT5M" } });
    const api = fakeApi();
    const { container } = await renderEditor({ detail: detailOf(graph, { draftVersion: 3 }), api });
    await screen.findByRole("toolbar", { name: "편집 도구" });
    expect(within(nodeEl(container, "n-thr00001")).getByText("오류 1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "적용" })).toBeDisabled();
    expect(screen.getByText("검증 오류를 고쳐야 적용할 수 있습니다")).toBeInTheDocument();
    // 이름 바꿈 → 저장(초안 저장 + 이름 PATCH), baseVersion 3
    await userEvent.type(screen.getByRole("textbox", { name: "플로우 이름" }), " 2");
    expect(screen.getByText("변경 내용을 먼저 저장하세요")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(api.rename).toHaveBeenCalledWith("f-7f3a", "고온이면 냉방 2");
    expect(api.saveDraft).toHaveBeenCalledWith("f-7f3a", expect.objectContaining({ baseVersion: 3 }));
    expect(await screen.findByText("초안 v4을(를) 저장했습니다")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "적용" })).toBeDisabled();
    // 노드 선택 → 값 입력 → 오류 사라짐
    fireEvent.click(nodeEl(container, "n-thr00001"));
    const panel = await screen.findByRole("region", { name: "임계값 설정" });
    expect(within(panel).getByText("필수 입력입니다")).toBeInTheDocument();
    await userEvent.type(within(panel).getByRole("spinbutton", { name: "값" }), "27");
    expect(within(nodeEl(container, "n-thr00001")).queryByText("오류 1")).toBeNull();
    // Ctrl+S로 저장
    fireEvent.keyDown(screen.getByRole("toolbar", { name: "편집 도구" }), { key: "s", ctrlKey: true });
    await vi.waitFor(() => expect(api.saveDraft).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("button", { name: "적용" })).toBeEnabled();
  });

  it("새 플로우: 이름 규칙, 처음 저장은 생성 후 이동, 이름 중복·버전 충돌 문구", async () => {
    const onCreated = vi.fn();
    const api = fakeApi({ create: vi.fn().mockResolvedValueOnce({ ok: false, status: 409, code: "FLOW_NAME_DUPLICATED", message: "" }).mockResolvedValueOnce({ ok: true, status: 201, data: { flowId: "f-new", draftVersion: 1 } }) });
    await renderEditor({ api, onCreated });
    await userEvent.click(await screen.findByRole("button", { name: "저장" }));
    expect(screen.getByText("이름은 1~100자로 입력하세요")).toBeInTheDocument();
    await userEvent.type(screen.getByRole("textbox", { name: "플로우 이름" }), "고온이면 냉방");
    await userEvent.click(screen.getByRole("button", { name: "텔레메트리 추가" }));
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(await screen.findByText("같은 이름의 플로우가 있습니다")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    await vi.waitFor(() => expect(onCreated).toHaveBeenCalledWith("f-new"));
    const body = (api.create as ReturnType<typeof vi.fn>).mock.calls[1][0];
    expect(body.definition.nodes).toHaveLength(1);
    expect(body.definition.nodes[0].id).toMatch(/^n-[a-z0-9]{8}$/);
  });

  it("초안 저장 409 FLOW_VERSION_CONFLICT 안내", async () => {
    const api = fakeApi({ saveDraft: vi.fn().mockResolvedValue({ ok: false, status: 409, code: "FLOW_VERSION_CONFLICT", message: "" }) });
    await renderEditor({ detail: detailOf(coolingGraph()), api });
    await userEvent.click(await screen.findByRole("button", { name: "저장" }));
    expect(await screen.findByText("다른 사용자가 먼저 바꿨습니다. 새로 고친 뒤 다시 편집하세요")).toBeInTheDocument();
  });
});

describe("FLW-01.01 편집 동작: 연결 거부 문구, 삭제 시 앞뒤 잇기, 실행 취소, 복사·붙여넣기", () => {
  it("삭제 확인 → 앞뒤를 이어 삭제, 실행 취소로 되돌리기", async () => {
    const { container } = await renderEditor({ detail: detailOf(coolingGraph()) });
    await screen.findByRole("toolbar", { name: "편집 도구" });
    fireEvent.click(nodeEl(container, "n-agg00001"));
    await userEvent.click(screen.getByRole("button", { name: "삭제" }));
    const dialog = screen.getByRole("dialog", { name: "노드 삭제" });
    expect(within(dialog).getByText("집계·창 노드를 지웁니다. 앞뒤를 이을까요?")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "앞뒤를 이어 삭제" }));
    expect(container.querySelectorAll(".react-flow__node")).toHaveLength(3);
    expect(screen.getByText("텔레메트리 → 임계값 (out)")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "실행 취소" }));
    expect(container.querySelectorAll(".react-flow__node")).toHaveLength(4);
    await userEvent.click(screen.getByRole("button", { name: "다시 실행" }));
    expect(container.querySelectorAll(".react-flow__node")).toHaveLength(3);
    // 키보드: 전체 선택(Ctrl+A) → 복사 → 붙여넣기 → Delete
    const root = screen.getByRole("toolbar", { name: "편집 도구" });
    fireEvent.keyDown(root, { key: "a", ctrlKey: true });
    fireEvent.keyDown(root, { key: "c", ctrlKey: true });
    fireEvent.keyDown(root, { key: "v", ctrlKey: true });
    expect(container.querySelectorAll(".react-flow__node")).toHaveLength(6);
    fireEvent.keyDown(root, { key: "Delete" });
    expect(container.querySelectorAll(".react-flow__node")).toHaveLength(3);
    fireEvent.keyDown(root, { key: "z", ctrlKey: true });
    expect(container.querySelectorAll(".react-flow__node")).toHaveLength(6);
    fireEvent.keyDown(root, { key: "z", ctrlKey: true, shiftKey: true });
    fireEvent.keyDown(root, { key: "y", ctrlKey: true });
    expect(container.querySelectorAll(".react-flow__node")).toHaveLength(3);
  });

  it("단순 삭제(앞뒤 와이어 없음)와 끌어 놓기 위치 기록", async () => {
    const { container } = await renderEditor({ detail: detailOf(coolingGraph()) });
    await screen.findByRole("toolbar", { name: "편집 도구" });
    fireEvent.click(nodeEl(container, "n-act00001"));
    await userEvent.click(screen.getByRole("button", { name: "삭제" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(container.querySelectorAll(".react-flow__node")).toHaveLength(3);
    // 팔레트에서 끌어 캔버스에 놓기
    const pane = container.querySelector(".react-flow")!.parentElement!;
    const data = new Map<string, string>([["application/x-data2flow-node", "debug.log"]]);
    await act(async () => {
      fireEvent.drop(pane, { dataTransfer: { getData: (k: string) => data.get(k) ?? "" }, clientX: 300, clientY: 200 });
    });
    expect(container.querySelectorAll(".react-flow__node")).toHaveLength(4);
  });
});
