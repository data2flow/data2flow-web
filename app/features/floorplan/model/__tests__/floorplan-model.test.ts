/**
 * DSH-02.02 마커 상태·DSH-09.02 위치 경로·DSH-12.04 층 전환 모델.
 */
import { describe, expect, it } from "vitest";
import { ancestorsOf, buildingOf, crumbTarget, floorNav, locationPath, sortFloors } from "../location";
import { heatMetricOptions, heatPoints, liveMarkers, markerState } from "../markers";

const tree = [
  { id: "1", type: "SITE", name: "광주캠퍼스", children: [{ id: "2", type: "BUILDING", name: "본관", children: [{ id: "3", type: "FLOOR", name: "3층", children: [{ id: "31", type: "ROOM", name: "실습실" }] }] }] },
];

describe("DSH-02.02 마커 상태(TC-DSH-014)", () => {
  const devices = [
    { id: "1", name: "온습도", connection: "ONLINE", metrics: [{ key: "temperature", value: 24.1, unit: "℃" }] },
    { id: "2", name: "CO2", connection: "OFFLINE", metrics: [{ key: "co2", value: 1150, unit: "ppm" }] },
    { id: "3", name: "소음", metrics: [] },
  ];

  it("알람 > 오프라인 > 정상 > 알 수 없음, 가장 높은 심각도", () => {
    const markers = liveMarkers(
      [
        { deviceId: 1, x: "0.1", y: 0.2 },
        { deviceId: "2", x: 0.5, y: 0.5 },
        { deviceId: "3", x: 0.9, y: 0.9, deviceName: "소음" },
        { deviceId: "4", x: 0.3, y: 0.3, deviceName: "모르는 기기" },
        { deviceId: "5", x: 1.5, y: 0.3 },
      ],
      devices,
      [
        { deviceId: "2", severity: "MINOR" },
        { deviceId: "2", severity: "CRITICAL" },
        { deviceId: "2", severity: "WARNING" },
        { deviceId: null, severity: "MAJOR" },
      ],
    );
    expect(markers.map((m) => [m.deviceId, m.state])).toEqual([
      ["1", "NORMAL"],
      ["2", "ALARM"],
      ["3", "UNKNOWN"],
      ["4", "UNKNOWN"],
    ]);
    expect(markers[1].alarmSeverity).toBe("CRITICAL");
    expect(markers[0].x).toBe(0.1);
    expect(markers[3].name).toBe("모르는 기기");
    expect(markerState({ id: "2", name: "x", connection: "OFFLINE" }, null)).toBe("OFFLINE");
    expect(liveMarkers(undefined, devices)).toEqual([]);
  });

  it("히트 컬러 측정 항목과 입력점(값이 있는 마커만)", () => {
    const markers = liveMarkers([{ deviceId: "1", x: 0.1, y: 0.2 }, { deviceId: "2", x: 0.5, y: 0.5 }, { deviceId: "3", x: 0.9, y: 0.9 }], [...devices.slice(0, 2), { id: "3", name: "n", metrics: [{ key: "temperature", value: null }] }]);
    expect(heatMetricOptions(markers)).toEqual([{ key: "co2", unit: "ppm" }, { key: "temperature", unit: "℃" }]);
    expect(heatPoints(markers, "temperature")).toEqual([{ x: 0.1, y: 0.2, value: 24.1 }]);
  });
});

describe("DSH-09.02 위치 경로(TC-DSH-089)", () => {
  it("사이트 › 건물 › 층 › 실, 층은 평면도 탭, from 유지", () => {
    expect(ancestorsOf(tree, "31").map((n) => n.name)).toEqual(["광주캠퍼스", "본관", "3층", "실습실"]);
    expect(locationPath(tree, "31").map((c) => c.to)).toEqual(["/spaces/1", "/spaces/2", "/spaces/3?tab=floorplan", "/spaces/31"]);
    expect(crumbTarget({ id: "3", type: "FLOOR" }, "portfolio")).toBe("/spaces/3?tab=floorplan&from=portfolio");
    expect(locationPath(tree, "nope")).toEqual([]);
    expect(buildingOf(tree, "31")?.id).toBe("2");
    expect(buildingOf(tree, "1")).toBeNull();
  });
});

describe("DSH-12.04 층 전환(TC-DSH-109)", () => {
  const floors = [
    { spaceId: "5", name: "5층", sortOrder: 2, hasFloorplan: true },
    { spaceId: "3", name: "3층", sortOrder: 0, hasFloorplan: false },
    { spaceId: "4", name: "4층", sortOrder: 1, hasFloorplan: true },
  ];
  it("아래층부터 정렬, 요청 층이 없으면 평면도가 있는 첫 층, 위·아래 이웃", () => {
    expect(sortFloors(floors).map((f) => f.spaceId)).toEqual(["3", "4", "5"]);
    const nav = floorNav(floors, null);
    expect(nav.current?.spaceId).toBe("4");
    expect(nav.up?.spaceId).toBe("5");
    expect(nav.down?.spaceId).toBe("3");
    const top = floorNav(floors, "5");
    expect(top.up).toBeNull();
    expect(top.index).toBe(2);
    expect(floorNav(floors.map((f) => ({ ...f, hasFloorplan: false })), "x").current?.spaceId).toBe("3");
    expect(floorNav([], "3")).toEqual({ current: null, index: -1, up: null, down: null });
    expect(sortFloors([{ spaceId: "a", name: "10층" }, { spaceId: "b", name: "2층" }]).map((f) => f.name)).toEqual(["2층", "10층"]);
  });
});
