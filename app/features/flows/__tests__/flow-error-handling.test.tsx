import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { createFlowGraph } from "../model/flow-graph";
import { catalog, detailOf, renderEditor, stubReactFlowDom } from "./helpers";

beforeEach(() => stubReactFlowDom());

describe("FLW-05.03 TC-FLW-102 AT-FLW-19.3 JS 노드 예외 → 오류 지표, 다른 플로우 영향 없음 안내", () => {
  it("오류 탭에 노드별 오류 수와 격리 안내, 캔버스 노드에 오류 카운터", async () => {
    const graph = createFlowGraph(catalog).node("trigger.telemetry", "n-trg00002").node("transform.js", "n-js000002", { code: "function main(msg){ throw new Error('x') }", outputs: 1 }).wire("n-trg00002", "out", "n-js000002").build();
    const metrics = { summary: { executions: 1204, errors: 145, errorRate: 0.12 }, nodes: [{ nodeId: "n-trg00002", processed: 1204, errors: 0 }, { nodeId: "n-js000002", processed: 1204, errors: 145 }] };
    const { container } = await renderEditor({ detail: detailOf(graph, { status: "DEGRADED", activeVersion: 7, draftVersion: null }), metrics });
    await screen.findByRole("tablist", { name: "하단 패널" });
    expect(within(container.querySelector('.react-flow__node[data-id="n-js000002"]') as HTMLElement).getByText("최근 1시간 오류 145건")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "오류" }));
    expect(screen.getByText("최근 1시간: 실행 1204회 · 오류 145건 · 오류율 12.0%")).toBeInTheDocument();
    expect(screen.getByText(/다른 플로우와 같은 기기의 다음 메시지 처리는 막지 않습니다/)).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "145" })).toBeInTheDocument();
  });

  it("지표가 없거나 오류가 없을 때", async () => {
    const { unmount } = await renderEditor({ detail: detailOf(createFlowGraph(catalog).node("trigger.telemetry", "n-trg00002").build()) });
    await userEvent.click(await screen.findByRole("tab", { name: "오류" }));
    expect(screen.getByText("지표를 불러오지 못했습니다")).toBeInTheDocument();
    unmount();
    await renderEditor({ detail: detailOf(createFlowGraph(catalog).node("trigger.telemetry", "n-trg00002").build()), metrics: { summary: { executions: 3, errors: 0, errorRate: 0 }, nodes: [] } });
    await userEvent.click(await screen.findByRole("tab", { name: "오류" }));
    expect(screen.getByText("최근 1시간 동안 오류가 없습니다")).toBeInTheDocument();
  });
});
