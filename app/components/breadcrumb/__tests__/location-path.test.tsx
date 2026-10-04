/**
 * TC-DSH-089 AT-DSH-02.2 AT-DSH-12.4 위치 경로: 사이트 > 건물 > 3층 > 실습실, "3층"은 평면도로, 포트폴리오에서 오면 "포트폴리오 > …".
 */
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderRoute } from "../../../../test/render";
import { locationPath } from "~/features/floorplan/model/location";
import { LocationPath } from "../location-path";

const tree = [{ id: "1", type: "SITE", name: "A", children: [{ id: "2", type: "BUILDING", name: "본관", children: [{ id: "3", type: "FLOOR", name: "3층", children: [{ id: "31", type: "ROOM", name: "실습실" }] }] }] }];

describe("TC-DSH-089 위치 경로", () => {
  it("단계마다 링크, 현재 단계는 글자, 층은 평면도 탭", async () => {
    await renderRoute(<LocationPath crumbs={locationPath(tree, "31")} />);
    const nav = await screen.findByRole("navigation", { name: "위치 경로" });
    expect(nav).toHaveTextContent("A › 본관 › 3층 › 실습실");
    expect(screen.getByRole("link", { name: "3층" })).toHaveAttribute("href", "/spaces/3?tab=floorplan");
    expect(screen.queryByRole("link", { name: "실습실" })).toBeNull();
    expect(screen.queryByRole("link", { name: "포트폴리오" })).toBeNull();
  });

  it("포트폴리오에서 내려오면 맨 앞이 포트폴리오, 경로에 from 유지", async () => {
    await renderRoute(<LocationPath crumbs={locationPath(tree, "2", "portfolio")} from="portfolio" />);
    expect(await screen.findByRole("navigation", { name: "위치 경로" })).toHaveTextContent("포트폴리오 › A › 본관");
    expect(screen.getByRole("link", { name: "포트폴리오" })).toHaveAttribute("href", "/portfolio");
    expect(screen.getByRole("link", { name: "A" })).toHaveAttribute("href", "/spaces/1?from=portfolio");
  });
});
