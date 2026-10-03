/**
 * TC-SIM-002 공간 트리에서 가상 공간에 "가상" 배지, 필터 "실제만" 적용 시 숨김(SIM-01.01, AT-SIM-13.1).
 */
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { meOf, renderRoute } from "../../../../test/render";
import { flattenSpaces } from "~/lib/spaces";
import { SpaceTree, withoutVirtual } from "../components/space-tree";

const tree = [
  {
    id: "1",
    type: "SITE",
    name: "광주캠퍼스",
    children: [
      { id: "31", type: "ROOM", name: "실습실" },
      { id: "41", type: "ROOM", name: "데모 강의실", virtual: true, children: [{ id: "411", type: "ZONE", name: "앞쪽" }] },
    ],
  },
];

describe("TC-SIM-002 AT-SIM-13.1 가상 공간 배지와 '실제만' 필터", () => {
  it("가상 공간에 [가상] 배지, '실제만'이면 가상 공간과 그 아래를 숨긴다", async () => {
    await renderRoute(<SpaceTree spaces={tree} canEdit={false} />, { session: meOf("VIEWER") });
    const nav = await screen.findByRole("navigation", { name: "공간 트리" });
    const demo = within(nav).getByRole("link", { name: /데모 강의실/ });
    expect(within(demo).getByText("가상")).toBeInTheDocument();
    expect(within(within(nav).getByRole("link", { name: /실습실/ })).queryByText("가상")).toBeNull();
    await userEvent.click(screen.getByLabelText("실제만"));
    expect(within(nav).queryByRole("link", { name: /데모 강의실/ })).toBeNull();
    expect(within(nav).queryByRole("link", { name: /앞쪽/ })).toBeNull();
    expect(within(nav).getByRole("link", { name: /실습실/ })).toBeInTheDocument();
  });

  it("가상 공간이 없으면 필터를 보이지 않는다", async () => {
    await renderRoute(<SpaceTree spaces={[{ id: "1", type: "SITE", name: "본관" }]} canEdit={false} />, { session: meOf("VIEWER") });
    await screen.findByRole("navigation", { name: "공간 트리" });
    expect(screen.queryByLabelText("실제만")).toBeNull();
    expect(withoutVirtual(flattenSpaces(tree)).map((s) => s.id)).toEqual(["1", "31"]);
  });
});
