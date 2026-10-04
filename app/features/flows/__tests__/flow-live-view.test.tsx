/**
 * 라이브 뷰(FLW-03.01~03.03, UI-FLW-02 실시간): 가짜 WebSocket으로 node.stats·node.sample을 흘려 노드 카운터·배지·샘플 상한·끊김 표시를 본다.
 */
import { act, fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { coolingGraph, detailOf, renderEditor, stubReactFlowDom } from "./helpers";

beforeEach(() => stubReactFlowDom());
afterEach(() => vi.useRealTimers());

const activeDetail = () => detailOf(coolingGraph(), { status: "ACTIVE", activeVersion: 13, draftVersion: null });
const nodeEl = (container: HTMLElement, id: string) => container.querySelector(`.react-flow__node[data-id="${id}"]`) as HTMLElement;
const stats = (inCount: number, extra: object = {}) => ({ type: "node.stats", t: "2026-10-04T00:00:01Z", version: 13, nodes: [{ nodeId: "n-thr00001", in: inCount, out: { true: 2, false: inCount - 2 }, errors: 0, status: "OK", ...extra }] });
const sample = (i: number, extra: object = {}) => ({ type: "node.sample", t: "2026-10-04T00:00:01Z", version: 13, nodeId: "n-thr00001", messageId: `m-${i}`, direction: "out", port: "true", payload: { temperature: 28 + i / 100 }, masked: false, ...extra });

describe("FLW-03.01 TC-FLW-065 AT-FLW-04.1 AT-FLW-04.2 실시간 흐름 표시", () => {
  it("ACTIVE 플로우를 열면 /bff/stream/flows/{id}로 구독하고, 노드 카운터가 늘고, 화면 샘플은 노드당 초당 5건까지", async () => {
    const { container, sockets } = await renderEditor({ role: "OPERATOR", detail: activeDetail() });
    const live = sockets.byPath("/bff/stream/flows/f-7f3a").find((s) => !s.url.endsWith("/presence"))!;
    expect(live.url).toMatch(/^ws:\/\/[^/]+\/bff\/stream\/flows\/f-7f3a$/);
    act(() => live.open());
    expect(live.sent).toEqual([{ type: "subscribe", samples: true }]);
    expect(screen.getByText("● 라이브")).toBeInTheDocument();
    act(() => live.emit(stats(10)));
    expect(within(nodeEl(container, "n-thr00001")).getByText("처리 10 · 오류 0")).toBeInTheDocument();
    act(() => live.emit(stats(30)));
    expect(within(nodeEl(container, "n-thr00001")).getByText("처리 30 · 오류 0")).toBeInTheDocument();
    // 초당 20건 샘플 → 화면 표시는 5건
    act(() => {
      for (let i = 0; i < 20; i++) live.emit(sample(i));
    });
    fireEvent.click(nodeEl(container, "n-thr00001"));
    await userEvent.click(screen.getByRole("tab", { name: "디버그" }));
    const inspector = screen.getByRole("region", { name: "임계값 최근 메시지" });
    expect(within(inspector).getAllByRole("listitem")).toHaveLength(5);
    expect(within(inspector).getByText("화면 표시 상한(초당 5건)으로 15건을 생략했습니다")).toBeInTheDocument();
  });

  it("연결이 끊기면 '다시 연결 중' 띠를 보이고 1초 뒤 다시 연결해 구독한다", async () => {
    const { sockets } = await renderEditor({ role: "OPERATOR", detail: activeDetail() });
    vi.useFakeTimers();
    const liveSockets = () => sockets.sockets.filter((s) => !s.url.endsWith("/presence"));
    act(() => liveSockets()[0].open());
    act(() => liveSockets()[0].serverClose(1006));
    expect(screen.getByText("라이브 연결이 끊겼습니다. 다시 연결 중…")).toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(liveSockets()).toHaveLength(2);
    act(() => liveSockets()[1].open());
    expect(screen.queryByText("라이브 연결이 끊겼습니다. 다시 연결 중…")).toBeNull();
    expect(liveSockets()[1].sent[0]).toEqual({ type: "subscribe", samples: true });
  });

  it("권한이 바뀌어 4403으로 닫히면 다시 연결하지 않고 안내, 초안만 있는 플로우는 연결하지 않는다", async () => {
    const { sockets, unmount } = await renderEditor({ role: "ANALYST", detail: activeDetail() });
    const live = sockets.sockets.find((s) => !s.url.endsWith("/presence"))!;
    act(() => live.serverClose(4403));
    expect(screen.getByText("라이브 뷰를 볼 권한이 없습니다")).toBeInTheDocument();
    unmount();
    const draft = await renderEditor({ role: "OPERATOR", detail: detailOf(coolingGraph()) });
    expect(draft.sockets.sockets.filter((s) => !s.url.endsWith("/presence"))).toHaveLength(0);
    await userEvent.click(screen.getByRole("tab", { name: "디버그" }));
    expect(screen.getByText("적용된 버전이 있어야 실시간 흐름을 볼 수 있습니다")).toBeInTheDocument();
  });

  it("apply.status로 적용 수렴, flow.status로 엔진 판정 상태를 보여 준다(FLW-06.01·06.02)", async () => {
    const { sockets } = await renderEditor({ role: "OPERATOR", detail: activeDetail() });
    const live = sockets.sockets.find((s) => !s.url.endsWith("/presence"))!;
    act(() => live.open());
    act(() => live.emit({ type: "apply.status", targetVersion: 14, instances: [{ instanceId: "e-1", appliedVersion: 13 }], converged: false }));
    expect(await screen.findByText("v14 적용 중…")).toBeInTheDocument();
    act(() => live.emit({ type: "apply.status", targetVersion: 14, instances: [{ instanceId: "e-1", appliedVersion: 14 }], converged: true }));
    expect(await screen.findByText("모든 인스턴스 v14 적용됨")).toBeInTheDocument();
    act(() => live.emit({ type: "flow.status", status: "DEGRADED", reason: "DEGRADED" }));
    expect(await screen.findByText("엔진이 플로우 상태를 성능 저하(으)로 바꿨습니다")).toBeInTheDocument();
    act(() => live.emit("not json"));
  });
});

describe("FLW-03.01 TC-FLW-063 AT-FLW-04.3 권한 밖 공간 메시지는 가린다", () => {
  it("masked 샘플은 내용 없이 '권한 밖 데이터'", async () => {
    const { container, sockets } = await renderEditor({ role: "OPERATOR", detail: activeDetail() });
    const live = sockets.sockets.find((s) => !s.url.endsWith("/presence"))!;
    act(() => live.open());
    act(() => {
      live.emit(sample(1, { direction: "in", port: null, masked: true, payload: { floor: 2, temperature: 30 } }));
      live.emit(sample(1, { masked: true, payload: { floor: 2 } }));
    });
    fireEvent.click(nodeEl(container, "n-thr00001"));
    await userEvent.click(screen.getByRole("tab", { name: "디버그" }));
    expect(screen.getAllByText("권한 밖 데이터")).toHaveLength(2);
    expect(screen.queryByText(/"floor"/)).toBeNull();
  });
});

describe("FLW-03.03 TC-FLW-070 노드 상태 배지", () => {
  it("정상·경고·오류 3종 배지와 접근 가능한 이름, 오류는 최근 오류를 툴팁(500자 절단)", async () => {
    const { container, sockets } = await renderEditor({ role: "OPERATOR", detail: activeDetail() });
    const live = sockets.sockets.find((s) => !s.url.endsWith("/presence"))!;
    act(() => live.open());
    const long = "x".repeat(600);
    act(() =>
      live.emit({
        type: "node.stats",
        t: "2026-10-04T00:00:01Z",
        version: 13,
        nodes: [
          { nodeId: "n-trg00001", in: 5, out: { out: 5 }, errors: 0, status: "OK" },
          { nodeId: "n-agg00001", in: 5, out: { out: 5 }, errors: 1, status: "WARN", lastError: "느림" },
          { nodeId: "n-thr00001", in: 5, out: { error: 1 }, errors: 5, status: "ERROR", lastError: long },
        ],
      }),
    );
    expect(within(nodeEl(container, "n-trg00001")).getByLabelText("상태: 정상")).toBeInTheDocument();
    expect(within(nodeEl(container, "n-agg00001")).getByLabelText("상태: 경고")).toHaveAttribute("title", "최근 오류: 느림");
    const error = within(nodeEl(container, "n-thr00001")).getByLabelText("상태: 오류");
    expect(error.getAttribute("title")).toBe(`최근 오류: ${"x".repeat(500)}`);
  });
});
