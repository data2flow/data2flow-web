/**
 * TC-DSH-111 AT-DSH-13.2 [3D] 열람: 공간 10개 중 8개 매핑 → 8개 상태 색, 2개 회색, 열람 전용(편집 도구 없음).
 * 3D 렌더링(web-ifc)은 v1 범위 밖이라 요소 타일로 확인한다. INTEGRATOR는 연결 편집·올리기(.ifc ≤200MB, AT-DSH-13.3).
 */
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderRoute } from "../../../../test/render";
import { BimPanel } from "../components/bim-panel";

const gid = (n: number) => `2O2Fr$t4X7Zf8NOew3FL${String(n).padStart(2, "0")}`;
const tree = [{ id: "2", type: "BUILDING", name: "본관", children: [{ id: "31", type: "ROOM", name: "실습실", counts: { alarms: 2 } }, { id: "32", type: "ROOM", name: "사무실" }] }];
const elements = Array.from({ length: 10 }, (_, i) => ({ ifcGlobalId: gid(i + 1), name: `Room ${i + 1}` }));
const detail = { id: "801", name: "본관.ifc", ifcSchema: "IFC4", status: "READY", elementCount: 10, downloadUrl: "/api/v1/core/buildings/2/models/801/file", version: 1, spaceElements: elements, mappings: elements.slice(0, 8).map((e, i) => ({ ifcGlobalId: e.ifcGlobalId, spaceId: i < 4 ? "31" : "32" })) };
const models = [{ id: "801", name: "본관.ifc", sizeBytes: 12_400_000, ifcSchema: "IFC4", status: "READY", elementCount: 10, version: 1 }, { id: "802", name: "신관.ifc", sizeBytes: 1000, status: "PROCESSING", version: 1 }];

describe("TC-DSH-111 IFC 열람", () => {
  it("8개 요소는 상태 색, 2개 회색, 편집 도구 없음(VIEWER)", async () => {
    await renderRoute(<BimPanel spaceId="2" models={models} detail={detail} tree={tree} canEdit={false} />);
    const list = await screen.findByRole("list", { name: "IFC 공간 요소" });
    const tiles = within(list).getAllByRole("listitem");
    expect(tiles).toHaveLength(10);
    expect(tiles.filter((t) => t.dataset.state === "UNMAPPED")).toHaveLength(2);
    expect(tiles.filter((t) => t.dataset.state === "ALARM")).toHaveLength(4);
    expect(tiles.filter((t) => t.dataset.state === "NORMAL")).toHaveLength(4);
    expect(screen.getByText(/연결 8 · 연결 없음 2/)).toHaveTextContent("열람 전용");
    expect(screen.queryByRole("button", { name: "공간 연결 편집" })).toBeNull();
    expect(screen.queryByText("IFC 올리기")).toBeNull();
    expect(screen.queryByRole("button", { name: "모델 삭제" })).toBeNull();
    expect(screen.getByRole("link", { name: "IFC 내려받기" })).toHaveAttribute("href", "/bff/api/core/buildings/2/models/801/file");
    expect(screen.getByRole("link", { name: /신관.ifc/ })).toHaveAttribute("href", "/spaces/2?tab=model3d&model=802");
  });

  it("모델이 없으면 안내, 변환 중·실패 표시", async () => {
    const { unmount } = await renderRoute(<BimPanel spaceId="2" models={[]} detail={null} tree={tree} canEdit={false} />);
    expect(await screen.findByText("올린 3D 모델이 없습니다")).toBeInTheDocument();
    expect(screen.getByText(/INTEGRATOR 이상/)).toBeInTheDocument();
    unmount();
    await renderRoute(<BimPanel spaceId="2" models={models} detail={{ ...detail, status: "FAILED", error: "IFC 파싱 실패" }} tree={tree} canEdit />);
    expect(await screen.findByText("모델 변환 실패: IFC 파싱 실패")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "공간 연결 편집" })).toBeNull();
  });

  it("INTEGRATOR: 연결 편집(공간 고르기 → 저장 값), 올리기 파일 검사", async () => {
    await renderRoute(<BimPanel spaceId="2" models={models} detail={detail} tree={tree} canEdit result={{ intent: "bimMapping", ok: true }} />);
    await userEvent.click(await screen.findByRole("button", { name: "공간 연결 편집" }));
    await userEvent.selectOptions(screen.getByLabelText("Room 10 연결 공간"), "32");
    const hidden = document.querySelector('input[name="mappings"]') as HTMLInputElement;
    expect(JSON.parse(hidden.value)[9]).toEqual({ ifcGlobalId: gid(10), spaceId: "32" });
    expect(screen.getByText("저장했습니다.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "열람으로" }));
    expect(screen.getByRole("list", { name: "IFC 공간 요소" })).toBeInTheDocument();

    const input = screen.getByLabelText("IFC 파일");
    await userEvent.upload(input, new File(["x"], "plan.dwg"), { applyAccept: false });
    expect(screen.getByText("IFC(.ifc) 파일만 올릴 수 있습니다")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "올리기" })).toBeDisabled();
    const big = new File(["x"], "big.ifc");
    Object.defineProperty(big, "size", { value: 300 * 1024 * 1024 });
    await userEvent.upload(input, big);
    expect(screen.getByText("200MB 이하 파일만 올릴 수 있습니다")).toBeInTheDocument();
    await userEvent.upload(input, new File(["ISO-10303-21;"], "ok.ifc"));
    expect(screen.getByRole("button", { name: "올리기" })).toBeEnabled();
  });

  it("서버 거부(413 MODEL_FILE_INVALID)는 \"200MB 이하\" 안내, 성공·연결 오류 표시", async () => {
    const { unmount } = await renderRoute(<BimPanel spaceId="2" models={models} detail={null} tree={tree} canEdit result={{ intent: "bimUpload", error: { code: "MODEL_FILE_INVALID" } }} />);
    expect(await screen.findByText(/200MB 이하\)/)).toBeInTheDocument();
    unmount();
    await renderRoute(<BimPanel spaceId="2" models={models} detail={{ ...detail, status: "PROCESSING" }} tree={tree} canEdit result={{ intent: "bimMapping", error: { code: "INVALID_REQUEST" } }} />);
    expect(await screen.findByText(/모델을 변환하고 있습니다/)).toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});
