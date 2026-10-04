/**
 * DSH-09.01 사이트 지도(UI-DSH-09): TC-DSH-087, AT-DSH-09.1 — 마커 상태 색(알람·오프라인), 카드 요약, 위치 없는 사이트는 목록에만.
 */
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderRoute } from "../../../../test/render";
import { SiteCard, SiteMap, SiteViewToggle } from "../components/site-map";
import { comfortSummaryText, mergeSites, projectSites, siteStatus } from "../model/site-map";

const map = [
  { id: "1", name: "광주캠퍼스", lat: 35.15, lng: 126.85, alarms: 2, offlineDevices: 1, comfortSummary: { NORMAL: 3, WARNING: 1 } },
  { id: "2", name: "서울분원", lat: 37.56, lng: 126.97, alarms: 0, offlineDevices: 3, comfortSummary: "양호" },
  { id: "3", name: "부산", lat: 35.1, lng: 129.04, alarms: 0, offlineDevices: 0 },
  { id: "4", name: "위치 없음", lat: null, lng: null, alarms: 0, offlineDevices: 0 },
];

describe("[DSH-09.01] 사이트 지도 모델", () => {
  it("상태는 알람 > 오프라인 > 정상, 요약 행(기기 수·쾌적 점수)을 붙이고, 범위 밖 좌표는 없음으로", () => {
    expect(siteStatus(1, 5)).toBe("ALARM");
    expect(siteStatus(0, 5)).toBe("OFFLINE");
    expect(siteStatus(0, 0)).toBe("OK");
    const merged = mergeSites([...map, { id: "5", name: "잘못", lat: 120, lng: 10 }], [{ siteId: "1", name: "광주캠퍼스", devices: 12, comfortScore: 82 }]);
    expect(merged[0]).toMatchObject({ status: "ALARM", devices: 12, comfortScore: 82, comfortSummary: "NORMAL 3 · WARNING 1" });
    expect(merged[1]).toMatchObject({ status: "OFFLINE", devices: null, comfortSummary: "양호" });
    expect(merged[4]).toMatchObject({ lat: null, lng: 10 });
    expect(mergeSites(null, [{ siteId: "9", name: "요약만", lat: 1, lng: 2, openAlarms: 1, offline: 0, devices: 3 }])[0]).toMatchObject({ id: "9", status: "ALARM", devices: 3 });
    expect(mergeSites(null, null)).toEqual([]);
    expect(comfortSummaryText(null)).toBeNull();
    expect(comfortSummaryText(7)).toBe("7");
    expect(comfortSummaryText({ a: [] })).toBeNull();
  });

  it("좌표 투영: 영역 안, 북쪽이 위, 한 곳뿐이면 가운데", () => {
    const sites = mergeSites(map, null);
    const points = projectSites(sites, 640, 360);
    expect(points.map((p) => p.site.id)).toEqual(["1", "2", "3"]);
    for (const p of points) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(640);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(360);
    }
    const seoul = points.find((p) => p.site.id === "2")!;
    const busan = points.find((p) => p.site.id === "3")!;
    expect(seoul.y).toBeLessThan(busan.y);
    expect(busan.x).toBeGreaterThan(seoul.x);
    expect(projectSites([sites[0]], 640, 360)[0]).toMatchObject({ x: 320, y: 180 });
    expect(projectSites([sites[3]], 640, 360)).toEqual([]);
  });
});

describe("[DSH-09.01][AT-DSH-09.1] UI-DSH-09 사이트 지도", () => {
  it("TC-DSH-087 마커 상태 색·기호와 툴팁, 범례, 위치 없는 사이트 수 안내", async () => {
    await renderRoute(<SiteMap sites={mergeSites(map, null)} />);
    const svg = await screen.findByRole("img", { name: "사이트 지도" });
    const markers = svg.querySelectorAll("[data-marker]");
    expect(markers).toHaveLength(3);
    expect(markers[0].getAttribute("aria-label")).toBe("광주캠퍼스 · 열린 알람 있음");
    expect(markers[0].querySelector("circle")!.getAttribute("fill")).toBe("var(--color-bad)");
    expect(markers[1].querySelector("circle")!.getAttribute("fill")).toBe("var(--color-warn)");
    expect(markers[0].querySelector("title")!.textContent).toBe("광주캠퍼스 · 오프라인 1 · 알람 2");
    expect(screen.getByText("위치 없음 1곳(목록에만 표시)")).toBeInTheDocument();
  });

  it("위치 있는 사이트가 없으면 목록 안내, 카드 요약과 [들어가기], 토글", async () => {
    await renderRoute(
      <>
        <SiteMap sites={mergeSites([map[3]], null)} />
        <SiteCard site={mergeSites([map[0]], [{ siteId: "1", name: "광주캠퍼스", devices: 12, comfortScore: 82 }])[0]} />
        <SiteViewToggle view="list" />
      </>,
    );
    expect(await screen.findByText("위치 정보가 있는 사이트가 없어 목록으로 보여 줍니다.")).toBeInTheDocument();
    expect(screen.getByText("기기 12 · 오프라인 1 · 알람 2")).toBeInTheDocument();
    expect(screen.getByText("쾌적 82")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "들어가기" })).toHaveAttribute("href", "/spaces/1");
    expect(screen.getByRole("link", { name: "목록" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "지도" })).toHaveAttribute("href", "/sites");
  });
});
