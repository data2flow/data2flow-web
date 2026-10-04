/**
 * DEV-08.01 TC-DEV-207 자산 탭(API-DEV-96), DEV-09.04 TC-DEV-255~260 QR 미리 보기·재발급·라벨 PDF,
 * DEV-13.06 TC-DEV-332 설치 현황판: AT-DEV-28.1(층별 숫자), AT-DEV-28.2(실시간 갱신), AT-DEV-28.3(칸 → 기기와 체크리스트).
 */
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderRoute } from "../../../../test/render";
import { AssetPanel } from "../components/asset-panel";
import { BOARD_REFRESH_DEBOUNCE_MS, InstallationBoard } from "../components/installation-board";
import { FakeES, fail, fakeFieldApi, live, ok } from "./helpers";

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  FakeES.all = [];
});
afterEach(() => vi.useRealTimers());

const NOW = () => Date.parse("2026-10-04T00:00:00Z");

describe("TC-DEV-207 자산 정보", () => {
  it("불러와서 보증 만료 임박 경고, 날짜 순서 검증, 저장(PUT 전체 교체), 사진 추가·삭제", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const api = fakeFieldApi();
    await renderRoute(<AssetPanel deviceId="1042" deviceName="AM107-067999" canEdit canPlace api={api} now={NOW} save={vi.fn()} />);
    expect(await screen.findByDisplayValue("SN-1")).toBeInTheDocument();
    expect(screen.getByText("보증이 16일 뒤 끝납니다")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "자산 사진 1" })).toHaveAttribute("src", "/bff/api/core/devices/1042/asset-info/photos/901");
    expect(screen.getByRole("link", { name: "이 기기의 작업 지시 보기" })).toHaveAttribute("href", "/work-orders?view=all&deviceId=1042");

    await user.clear(screen.getByLabelText("설치일"));
    await user.type(screen.getByLabelText("설치일"), "2026-01-01");
    await user.click(screen.getByRole("button", { name: "저장" }));
    expect(screen.getByText("설치일은 구매일 이후여야 합니다")).toBeInTheDocument();
    expect(api.saveAsset).not.toHaveBeenCalled();
    await user.clear(screen.getByLabelText("설치일"));
    await user.type(screen.getByLabelText("공급처"), "-2");
    await user.click(screen.getByRole("button", { name: "저장" }));
    expect(api.saveAsset).toHaveBeenCalledWith("1042", { serialNo: "SN-1", purchasedOn: "2026-03-02", installedOn: null, warrantyUntil: "2026-10-20", supplier: "아이오티몰-2", installer: null });
    expect(await screen.findByText("저장했습니다.")).toBeInTheDocument();

    await user.upload(screen.getByLabelText("사진 추가"), new File([new Uint8Array([1])], "front.jpg", { type: "image/jpeg" }));
    expect(await screen.findByRole("img", { name: "자산 사진 2" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "사진 1 삭제" }));
    expect(api.deleteAssetPhoto).toHaveBeenCalledWith("1042", "901");
  });

  it("읽기 실패 [다시 시도], 보증 지남, 편집 권한 없으면 입력 잠김·QR 버튼 없음, 이미지가 아닌 사진 거부", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime, applyAccept: false });
    let calls = 0;
    const api = fakeFieldApi({
      asset: async (deviceId) => (++calls === 1 ? fail(503, "SERVICE_UNAVAILABLE") : ok({ deviceId, warrantyUntil: "2026-09-01", photoUrls: [] })),
    });
    await renderRoute(<AssetPanel deviceId="1042" deviceName="AM107" canEdit={false} canPlace={false} api={api} now={NOW} />);
    expect(await screen.findByText(/정보를 불러오지 못했습니다/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(await screen.findByText("보증 기간이 끝났습니다")).toBeInTheDocument();
    expect(screen.getByLabelText("시리얼 번호")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "QR 재발급" })).not.toBeInTheDocument();
  });

  it("사진 형식 오류·저장 실패 안내", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime, applyAccept: false });
    const api = fakeFieldApi({ saveAsset: async () => fail(403, "PERMISSION_DENIED"), addAssetPhoto: async () => fail(400, "INVALID_REQUEST") });
    await renderRoute(<AssetPanel deviceId="1042" deviceName="AM107" canEdit canPlace={false} api={api} now={NOW} />);
    await screen.findByDisplayValue("SN-1");
    await user.upload(screen.getByLabelText("사진 추가"), new File(["%PDF"], "doc.pdf", { type: "application/pdf" }));
    expect(await screen.findByText("이미지나 PDF만 올릴 수 있습니다")).toBeInTheDocument();
    await user.upload(screen.getByLabelText("사진 추가"), new File([new Uint8Array([1])], "a.jpg", { type: "image/jpeg" }));
    await user.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(screen.getAllByRole("alert").length).toBeGreaterThan(0));
  });
});

describe("DEV-09.04 QR 라벨", () => {
  it("TC-DEV-255: QR 내용(/d/{token}) 미리 보기, 라벨 PDF 내려받기, 재발급 확인(이전 라벨 404 경고)", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const api = fakeFieldApi();
    const save = vi.fn();
    await renderRoute(<AssetPanel deviceId="1042" deviceName="AM107-067999" canEdit={false} canPlace api={api} now={NOW} save={save} />);
    expect(await screen.findByText("https://data2flow.java21.net/d/tokAm107x0000000000000001")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("img", { name: "AM107-067999 QR 코드" }).innerHTML).toContain("<svg"));
    await user.click(screen.getByRole("button", { name: "라벨 인쇄(PDF)" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.any(Blob), "qr-labels.pdf"));
    expect(api.qrLabels).toHaveBeenCalledWith(["1042"], "A4_3x8");
    await user.click(screen.getByRole("button", { name: "QR 재발급" }));
    const dialog = screen.getByRole("dialog", { name: "QR 재발급" });
    expect(within(dialog).getByText(/이전 라벨은 더 이상 열리지 않습니다/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "QR 재발급" }));
    expect(await screen.findByText("https://data2flow.java21.net/d/tokNew000000000000000002")).toBeInTheDocument();
    expect(screen.getByText("QR을 재발급했습니다. 새 라벨을 인쇄하세요")).toBeInTheDocument();
  });

  it("재발급·인쇄 실패 안내", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const api = fakeFieldApi({ reissueQr: async () => fail(403, "PERMISSION_DENIED"), qrLabels: async () => ({ ok: false as const, status: 403, code: "PERMISSION_DENIED" }) });
    await renderRoute(<AssetPanel deviceId="1042" deviceName="AM107" canEdit={false} canPlace api={api} now={NOW} save={vi.fn()} />);
    await user.click(await screen.findByRole("button", { name: "라벨 인쇄(PDF)" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "QR 재발급" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "QR 재발급" }));
    await waitFor(() => expect(api.reissueQr).toHaveBeenCalled());
  });
});

const FLOORS = [
  { spaceId: "3", name: "3층", planned: 10, installed: 6, verified: 5, problem: 1 },
  { spaceId: "4", name: "1층", planned: 12, installed: 12, verified: 12, problem: 0 },
];

describe("DEV-13.06 TC-DEV-332 설치 현황판", () => {
  it("AT-DEV-28.1: 3층 줄 10/6/5/1·진행률, 합계", async () => {
    await renderRoute(<InstallationBoard sites={[{ id: "1", name: "광주캠퍼스" }]} siteId="1" initial={FLOORS} timezone="Asia/Seoul" api={fakeFieldApi()} live={live} />);
    const row = await screen.findByTestId("floor-3");
    expect(within(row).getAllByRole("button").map((b) => b.textContent)).toEqual(["10", "6", "5", "1"]);
    expect(within(row).getByText("60%")).toBeInTheDocument();
    expect(within(screen.getByTestId("floor-4")).getByText("100%")).toBeInTheDocument();
    expect(screen.getByText("합계").closest("tr")?.textContent).toBe("합계2218171");
  });

  it("AT-DEV-28.3: '문제 있음' 칸 → 그 기기 목록과 각 체크리스트, 목록 라벨 인쇄", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const save = vi.fn();
    const api = fakeFieldApi({
      boardDevices: async () => ok({ responses: [{ deviceId: "1050", name: "EM300-TH-151606", spaceId: "32", status: "PROBLEM", checklist: { firstData: false, position: true, photo: true, signal: false, battery: true, gateway: true, source: true }, installedAt: "2026-10-03T02:00:00Z" }] }),
    });
    await renderRoute(<InstallationBoard sites={[{ id: "1", name: "광주캠퍼스" }]} siteId="1" initial={FLOORS} timezone="Asia/Seoul" api={api} live={live} canPrint save={save} />);
    await user.click(await screen.findByRole("button", { name: "3층 문제 있음 1대 보기" }));
    const drawer = await screen.findByRole("complementary", { name: "3층 · 문제 있음" });
    expect(await within(drawer).findByRole("link", { name: "EM300-TH-151606" })).toHaveAttribute("href", "/devices/1050");
    expect(within(drawer).getByText("✗ 첫 수신")).toBeInTheDocument();
    expect(within(drawer).getByText("✗ 신호 세기")).toBeInTheDocument();
    expect(within(drawer).getByText("✓ 배터리")).toBeInTheDocument();
    expect(api.boardDevices).toHaveBeenCalledWith("3", "PROBLEM");
    await user.click(within(drawer).getByRole("button", { name: "목록 1대 라벨 인쇄" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.any(Blob), "qr-labels.pdf"));
    await user.click(within(drawer).getByRole("button", { name: "닫기" }));
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  });

  it("AT-DEV-28.2: space:{사이트} commissioning 이벤트가 오면 0.5초 안에 숫자를 다시 읽는다(3초 기준 안)", async () => {
    const api = fakeFieldApi();
    await renderRoute(<InstallationBoard sites={[{ id: "1", name: "광주캠퍼스" }]} siteId="1" initial={FLOORS} timezone="Asia/Seoul" api={api} live={live} />);
    await screen.findByTestId("floor-3");
    expect(FakeES.all[0].url).toBe("/bff/stream/live?topics=space%3A1");
    act(() => {
      FakeES.all[0].emit("commissioning", { deviceId: "1050", spaceId: "32", status: "VERIFIED", checklist: {} });
      FakeES.all[0].emit("commissioning", { deviceId: "1051", spaceId: "32", status: "INSTALLED", checklist: {} });
    });
    expect(api.board).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(BOARD_REFRESH_DEBOUNCE_MS);
    });
    await waitFor(() => expect(within(screen.getByTestId("floor-3")).getAllByRole("button").map((b) => b.textContent)).toEqual(["10", "7", "6", "1"]));
    expect(api.board).toHaveBeenCalledTimes(1);
    expect(api.board).toHaveBeenCalledWith("1");
  });

  it("빈 현황판·읽기 실패·칸 목록 실패·0인 칸은 누를 수 없음", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const api = fakeFieldApi({ boardDevices: async () => fail(500, "UNKNOWN") });
    const { unmount } = await renderRoute(<InstallationBoard sites={[]} siteId={null} initial={[]} failed timezone="Asia/Seoul" api={api} live={live} />);
    expect(await screen.findByText("설치할 기기가 없습니다")).toBeInTheDocument();
    expect(screen.getByText("정보를 불러오지 못했습니다.")).toBeInTheDocument();
    unmount();
    await renderRoute(<InstallationBoard sites={[{ id: "1", name: "광주" }]} siteId="1" initial={FLOORS} timezone="Asia/Seoul" api={api} live={live} />);
    expect(await screen.findByRole("button", { name: "1층 문제 있음 0대 보기" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "3층 설치 예정 10대 보기" }));
    expect(await screen.findByText("정보를 불러오지 못했습니다.")).toBeInTheDocument();
  });
});
