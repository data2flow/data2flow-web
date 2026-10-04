/**
 * DSH-12.04 IFC 모델 규칙(BR-DSH-21): 파일 검사(.ifc ≤200MB), 열람 요소 상태(매핑 = 공간 상태, 없음 = 회색), 연결 저장 본문.
 */
import { describe, expect, it } from "vitest";
import { IFC_MAX_BYTES, checkIfcFile, formatBytes, mappingBody, mappingCounts, spaceState, viewerElements } from "../bim";

const gid = (n: number) => `2O2Fr$t4X7Zf8NOew3FL${String(n).padStart(2, "0")}`;
const tree = [{ id: "1", type: "SITE", name: "A", children: [{ id: "31", type: "ROOM", name: "실습실", counts: { alarms: 1 } }, { id: "32", type: "ROOM", name: "사무실", comfortState: "WARNING" }, { id: "33", type: "ROOM", name: "회의실", comfortState: "NORMAL" }] }];

describe("AT-DSH-13.3 IFC 파일 검사", () => {
  it("없음·확장자·200MB 초과", () => {
    expect(checkIfcFile(null)).toBe("REQUIRED");
    expect(checkIfcFile({ name: "a.ifc", size: 0 })).toBe("REQUIRED");
    expect(checkIfcFile({ name: "a.dwg", size: 10 })).toBe("NOT_IFC");
    expect(checkIfcFile({ name: "a.IFC", size: 300 * 1024 * 1024 })).toBe("TOO_LARGE");
    expect(checkIfcFile({ name: "a.ifc", size: IFC_MAX_BYTES })).toBeNull();
  });
});

describe("AT-DSH-13.2 열람 요소", () => {
  it("매핑 요소는 공간 상태(알람·주의·정상), 매핑 없음은 회색, 모르는 공간은 정상", () => {
    const elements = viewerElements(
      {
        id: "1", name: "m", status: "READY", version: 1,
        mappings: [{ ifcGlobalId: gid(1), spaceId: "31" }, { ifcGlobalId: gid(2), spaceId: "32" }, { ifcGlobalId: gid(3), spaceId: "33" }, { ifcGlobalId: gid(4), spaceId: "99" }],
        spaceElements: [1, 2, 3, 4, 5].map((n) => ({ ifcGlobalId: gid(n), name: n === 5 ? null : `R${n}` })),
      },
      tree,
    );
    expect(elements.map((e) => e.state)).toEqual(["ALARM", "WARNING", "NORMAL", "NORMAL", "UNMAPPED"]);
    expect(elements[0].spaceName).toBe("실습실");
    expect(elements[4].name).toBe(gid(5));
    expect(mappingCounts(elements)).toEqual({ mapped: 4, unmapped: 1, total: 5 });
    expect(spaceState(undefined)).toBe("UNMAPPED");
  });

  it("요소 목록이 없으면 매핑으로 만든다", () => {
    const elements = viewerElements({ id: "1", name: "m", status: "PROCESSING", version: 1, mappings: [{ ifcGlobalId: gid(1), spaceId: "33" }] }, tree);
    expect(elements).toEqual([{ ifcGlobalId: gid(1), name: gid(1), spaceId: "33", spaceName: "회의실", state: "NORMAL" }]);
  });

  it("연결 저장은 공간을 고른 유효한 GlobalId만, 크기 표시", () => {
    expect(mappingBody([{ ifcGlobalId: gid(1), spaceId: "31" }, { ifcGlobalId: "short", spaceId: "31" }, { ifcGlobalId: gid(2), spaceId: "" }])).toEqual({ mappings: [{ ifcGlobalId: gid(1), spaceId: "31" }] });
    expect(formatBytes(12_400_000)).toBe("11.8MB");
    expect(formatBytes(2048)).toBe("2KB");
    expect(formatBytes(10)).toBe("10B");
  });
});
