/**
 * TC-DSH-109 AT-DSH-13.1 층 전환 바: 위·아래 링크가 URL에 층을 남기고, 끝 층에서는 버튼이 꺼진다.
 */
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderRoute } from "../../../../test/render";
import { FloorSwitcher } from "../components/floor-switcher";
import { floorNav } from "../model/location";

const floors = [
  { spaceId: "3", name: "3층", sortOrder: 0, hasFloorplan: true },
  { spaceId: "4", name: "4층", sortOrder: 1, hasFloorplan: false },
  { spaceId: "5", name: "5층", sortOrder: 2, hasFloorplan: true },
];
const href = (id: string) => `/spaces/2?tab=floorplan&floor=${id}`;

describe("TC-DSH-109 층 전환", () => {
  it("가운데 층: ▲ 5층, ▼ 3층, 현재 층 이름과 순서, 평면도 없음 표시", async () => {
    await renderRoute(<FloorSwitcher nav={floorNav(floors, "4")} total={3} hrefFor={href} />);
    expect(await screen.findByRole("link", { name: "위층: 5층" })).toHaveAttribute("href", "/spaces/2?tab=floorplan&floor=5");
    expect(screen.getByRole("link", { name: "아래층: 3층" })).toHaveAttribute("href", "/spaces/2?tab=floorplan&floor=3");
    expect(screen.getByText("4층")).toBeInTheDocument();
    expect(screen.getByText("2 / 3층")).toBeInTheDocument();
    expect(screen.getByText("평면도 없음")).toBeInTheDocument();
  });

  it("맨 위층에서는 ▲가 꺼지고, 층이 없으면 그리지 않는다", async () => {
    const { unmount } = await renderRoute(<FloorSwitcher nav={floorNav(floors, "5")} total={3} hrefFor={href} />);
    expect(await screen.findByRole("link", { name: "아래층: 4층" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /위층/ })).toBeNull();
    unmount();
    const { container } = await renderRoute(<><p>빈 층</p><FloorSwitcher nav={floorNav([], null)} total={0} hrefFor={href} /></>);
    await screen.findByText("빈 층");
    expect(container.querySelector('[role="group"]')).toBeNull();
  });
});
