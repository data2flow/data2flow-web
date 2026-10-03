import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { createFlowGraph } from "../model/flow-graph";
import { catalog, detailOf, renderEditor, stubReactFlowDom } from "./helpers";

beforeEach(() => stubReactFlowDom());

function chain(n: number) {
  const b = createFlowGraph(catalog).node("trigger.telemetry", "n-node0000");
  for (let i = 1; i < n; i += 1) b.node("debug.log", `n-node${String(i).padStart(4, "0")}`).wire(`n-node${String(i - 1).padStart(4, "0")}`, "out", `n-node${String(i).padStart(4, "0")}`);
  return b.build();
}

describe("FLW-01.01 TC-FLW-008 React Flow 캔버스 최소 렌더링", () => {
  it("노드 10개·와이어 9개를 표시하고, 키보드로 팔레트 노드를 추가한다", async () => {
    const { container } = await renderEditor({ detail: detailOf(chain(10)) });
    await screen.findByRole("list", { name: "와이어 목록" });
    expect(container.querySelectorAll(".react-flow__node")).toHaveLength(10);
    expect(within(screen.getByRole("list", { name: "와이어 목록" })).getAllByRole("listitem")).toHaveLength(9);
    const add = screen.getByRole("button", { name: "임계값 추가" });
    add.focus();
    await userEvent.keyboard("{Enter}");
    expect(container.querySelectorAll(".react-flow__node")).toHaveLength(11);
    expect(screen.getByText("임계값 노드를 추가했습니다")).toBeInTheDocument();
    // 미니맵·확대 컨트롤
    expect(container.querySelector(".react-flow__minimap")).not.toBeNull();
    expect(container.querySelector(".react-flow__controls")).not.toBeNull();
  });

  it("빈 캔버스 안내, 팔레트 검색", async () => {
    await renderEditor();
    expect(await screen.findByText("팔레트에서 트리거를 끌어다 놓으세요")).toBeInTheDocument();
    await userEvent.type(screen.getByRole("searchbox", { name: "노드 검색" }), "없는노드");
    expect(screen.getByText("맞는 노드가 없습니다")).toBeInTheDocument();
    await userEvent.clear(screen.getByRole("searchbox", { name: "노드 검색" }));
    await userEvent.type(screen.getByRole("searchbox", { name: "노드 검색" }), "JavaScript");
    expect(screen.getByRole("button", { name: "JavaScript 함수 추가" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "임계값 추가" })).toBeNull();
  });
});
