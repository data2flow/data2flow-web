/**
 * DEV-13.05 UI-DEV-21 현장 설치 — TC-DEV-327: AT-DEV-27.4(비행기 모드에서 2대 저장 → 연결 복구 → 순서대로 전송, 각 결과),
 * AT-DEV-27.5(409 COMMISSION_CONFLICT, 서버 값과 비교), AT-DEV-27.2(첫 수신 확인 + 값), AT-DEV-27.3(10분 무수신 → 점검 체크리스트).
 * DSH-13.04 TC-DSH-124 AT-DSH-16.2(QR 스캔 → 기기, 다른 조직 QR은 "찾을 수 없는 기기"), 카메라 거부 안내.
 */
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderRoute } from "../../../../test/render";
import { queueSender } from "../api";
import { CommissionWizard } from "../components/commission-wizard";
import { QrScanner, SCAN_INTERVAL_MS } from "../components/qr-scanner";
import { MemoryQueueStore, OfflineQueue } from "../model/offline-queue";
import { FakeES, fail, fakeFieldApi, live, ok, setOnline } from "./helpers";

let clock = Date.parse("2026-10-04T00:00:00Z");
const now = () => clock;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  FakeES.all = [];
  clock = Date.parse("2026-10-04T00:00:00Z");
  setOnline(true);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
});
afterEach(() => {
  setOnline(true);
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const SPACES = [{ id: "3", name: "3층", type: "FLOOR", children: [{ id: "31", name: "실습실", type: "ROOM", children: [] }, { id: "32", name: "사무실", type: "ROOM", children: [] }] }] as never;

function setup(overrides: Parameters<typeof fakeFieldApi>[0] = {}) {
  const api = fakeFieldApi(overrides);
  const queue = new OfflineQueue(new MemoryQueueStore(), queueSender(api));
  return { api, queue };
}

async function installOne(user: ReturnType<typeof userEvent.setup>, token: string, name: string) {
  await user.clear(await screen.findByLabelText("QR 주소 또는 코드"));
  await user.type(screen.getByLabelText("QR 주소 또는 코드"), `https://data2flow.java21.net/d/${token}`);
  await user.click(screen.getByRole("button", { name: "열기" }));
  expect(await screen.findByText(name)).toBeInTheDocument();
  expect(screen.getByLabelText("설치 공간")).toHaveValue("31");
  await user.click(screen.getByRole("button", { name: "다음: 위치" }));
  const plan = await screen.findByTestId("commission-floorplan");
  expect(screen.getByRole("button", { name: "다음: 사진" })).toBeDisabled();
  await user.pointer({ keys: "[MouseLeft]", target: plan, coords: { clientX: 84, clientY: 31 } });
  expect(await screen.findByText("x 0.420 · y 0.310")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "다음: 사진" }));
  await user.upload(screen.getByLabelText("사진 찍기"), [new File([new Uint8Array([1])], "front.jpg", { type: "image/jpeg" }), new File([new Uint8Array([2])], "label.jpg", { type: "image/jpeg" })]);
  expect(screen.getByText("설치 사진 2/5")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "label.jpg 빼기" }));
  await user.click(screen.getByRole("button", { name: "설치 저장" }));
}

describe("TC-DEV-327 UI-DEV-21 현장 설치", () => {
  it("AT-DEV-27.4: 비행기 모드에서 2대 저장 → 대기열 2건 → 연결 복구 시 순서대로 전송·각 결과, 같은 저장은 clientOpId 하나", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { api, queue } = setup();
    await renderRoute(<CommissionWizard spaces={SPACES} timezone="Asia/Seoul" api={api} queue={queue} now={now} live={live} />);
    setOnline(false);
    await installOne(user, "tokA0000000000000000001", "EM300-TH-151606");
    await installOne(user, "tokB0000000000000000002", "EM300-TH-151777");
    expect(await screen.findByText("EM300-TH-151606: 연결되면 전송")).toBeInTheDocument();
    expect(screen.getByText("EM300-TH-151777: 연결되면 전송")).toBeInTheDocument();
    expect(screen.getByText(/대기 중인 업로드 2건/)).toBeInTheDocument();
    expect(api.commission).not.toHaveBeenCalled();

    setOnline(true);
    await act(async () => {
      await queue.flush();
    });
    expect(api.commission.mock.calls.map((c) => c[0])).toEqual(["1050", "1051"]);
    const [first] = api.commission.mock.calls[0];
    expect(first).toBe("1050");
    const form = api.commission.mock.calls[0][1] as FormData;
    expect(form.get("spaceId")).toBe("31");
    expect(form.get("x")).toBe("0.42");
    expect(form.get("y")).toBe("0.31");
    expect(form.getAll("photos")).toHaveLength(1);
    expect(String(form.get("clientOpId"))).toMatch(/^[0-9a-f-]{36}$/);
    expect(await screen.findByText("EM300-TH-151606: 저장됨")).toBeInTheDocument();
    expect(screen.getByText("EM300-TH-151777: 저장됨")).toBeInTheDocument();
    // 마지막 저장의 첫 수신 대기 화면
    expect(await screen.findByText(/첫 수신 대기 \d\d:\d\d/)).toBeInTheDocument();
  });

  it("AT-DEV-27.5: 다른 담당자가 먼저 설치 → 409 COMMISSION_CONFLICT, 서버 값과 내 입력을 나란히", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { api, queue } = setup({
      commission: async () => fail(409, "COMMISSION_CONFLICT", { deviceId: "1050", status: "INSTALLED", spaceId: "32", installedAt: "2026-10-04T00:30:00Z", installedBy: "8", installedByName: "이통합" }),
    });
    await renderRoute(<CommissionWizard spaces={SPACES} timezone="Asia/Seoul" api={api} queue={queue} now={now} live={live} />);
    await installOne(user, "tokA0000000000000000001", "EM300-TH-151606");
    const conflict = await screen.findByRole("alert");
    expect(within(conflict).getByText("EM300-TH-151606: 다른 담당자가 먼저 설치를 기록했습니다")).toBeInTheDocument();
    const rows = within(conflict).getAllByRole("row");
    expect(rows[1].textContent).toBe("설치 공간사무실실습실");
    expect(rows[3].textContent).toBe("설치자이통합나");
  });

  it("AT-DEV-27.2: 저장 후 첫 데이터 → 실시간 commissioning(VERIFIED) → '첫 수신 확인' + 값", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { api, queue } = setup();
    await renderRoute(<CommissionWizard spaces={SPACES} timezone="Asia/Seoul" api={api} queue={queue} now={now} live={live} />);
    await installOne(user, "tokA0000000000000000001", "EM300-TH-151606");
    expect(await screen.findByText("첫 수신 대기 10:00")).toBeInTheDocument();
    const es = FakeES.all.find((e) => e.url.includes("space%3A31"));
    expect(es).toBeDefined();
    act(() => {
      es!.emit("commissioning", { deviceId: "9999", spaceId: "31", status: "VERIFIED" });
    });
    expect(api.commissionStatus).not.toHaveBeenCalled();
    act(() => {
      es!.emit("commissioning", { deviceId: "1050", spaceId: "31", status: "VERIFIED", firstSeenAt: "2026-10-04T00:03:00Z", checklist: { firstData: true } });
    });
    expect(await screen.findByText(/첫 수신 확인 · 2026/)).toBeInTheDocument();
    expect(await screen.findByText("temperature: 23.1℃")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "다음 기기 스캔" }));
    expect(await screen.findByLabelText("QR 주소 또는 코드")).toBeInTheDocument();
  });

  it("AT-DEV-27.3: 10분 동안 수신이 없으면 상태를 다시 읽어 PROBLEM 점검 체크리스트", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { api, queue } = setup({ commissionStatus: async (deviceId) => ok({ deviceId, status: "PROBLEM", checklist: { firstData: false, position: true, signal: false, battery: true, gateway: false, source: true } }) });
    await renderRoute(<CommissionWizard spaces={SPACES} timezone="Asia/Seoul" api={api} queue={queue} now={now} live={live} />);
    await installOne(user, "tokA0000000000000000001", "EM300-TH-151606");
    expect(await screen.findByText("첫 수신 대기 10:00")).toBeInTheDocument();
    clock += 4 * 60_000 + 30_000;
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(await screen.findByText("첫 수신 대기 05:30")).toBeInTheDocument();
    clock += 6 * 60_000;
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    const problem = await screen.findByRole("alert");
    expect(within(problem).getByText("10분 동안 데이터가 오지 않았습니다. 아래를 점검하세요")).toBeInTheDocument();
    expect(within(problem).getByText("기기 전원과 가입(Join) 상태를 확인하세요")).toBeInTheDocument();
    expect(within(problem).getByText("신호가 약합니다. 게이트웨이와의 거리·장애물을 확인하세요")).toBeInTheDocument();
    expect(within(problem).getByText("근처 게이트웨이가 오프라인입니다")).toBeInTheDocument();
  });

  it("평면도가 없으면 위치 없이, 다른 조직 QR은 '찾을 수 없는 기기', 다시 스캔·이전 단계", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { api, queue } = setup({ floorplan: async () => fail(404, "RESOURCE_NOT_FOUND") });
    await renderRoute(<CommissionWizard spaces={SPACES} timezone="Asia/Seoul" api={api} queue={queue} now={now} live={live} initialToken="tokOther000000000000001" />);
    expect(await screen.findByText("찾을 수 없는 기기입니다")).toBeInTheDocument();
    await user.type(screen.getByLabelText("QR 주소 또는 코드"), "not a qr");
    await user.click(screen.getByRole("button", { name: "열기" }));
    expect(screen.getByText("QR 주소 형식이 아닙니다")).toBeInTheDocument();
    await user.clear(screen.getByLabelText("QR 주소 또는 코드"));
    await user.type(screen.getByLabelText("QR 주소 또는 코드"), "tokA0000000000000000001");
    await user.click(screen.getByRole("button", { name: "열기" }));
    await user.click(await screen.findByRole("button", { name: "다시 스캔" }));
    await user.type(await screen.findByLabelText("QR 주소 또는 코드"), "tokA0000000000000000001");
    await user.click(screen.getByRole("button", { name: "열기" }));
    await user.click(await screen.findByRole("button", { name: "다음: 위치" }));
    expect(await screen.findByText(/평면도가 없습니다/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "이전" }));
    await user.click(await screen.findByRole("button", { name: "다음: 위치" }));
    await user.click(await screen.findByRole("button", { name: "다음: 사진" }));
    await user.click(screen.getByRole("button", { name: "설치 저장" }));
    await waitFor(() => expect(api.commission).toHaveBeenCalled());
    expect((api.commission.mock.calls[0][1] as FormData).get("x")).toBeNull();
  });

  it("저장 실패(400)는 결과에 코드로", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { api, queue } = setup({ commission: async () => fail(400, "DEVICE_MODEL_REQUIRED") });
    await renderRoute(<CommissionWizard spaces={SPACES} timezone="Asia/Seoul" api={api} queue={queue} now={now} live={live} />);
    await installOne(user, "tokA0000000000000000001", "EM300-TH-151606");
    expect(await screen.findByText("EM300-TH-151606: 저장 실패(DEVICE_MODEL_REQUIRED)")).toBeInTheDocument();
  });
});

describe("TC-DSH-124 QR 스캔", () => {
  it("카메라 BarcodeDetector가 QR을 읽으면 토큰 한 번만 넘기고, 끝나면 카메라를 끈다", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onToken = vi.fn();
    const stop = vi.fn();
    const detect = vi.fn().mockResolvedValueOnce([]).mockResolvedValue([{ rawValue: "https://data2flow.java21.net/d/tokAm107x0000000000000001" }]);
    const deps = { createDetector: () => ({ detect }), getMedia: async () => ({ getTracks: () => [{ stop }] }) as unknown as MediaStream };
    const { unmount } = await renderRoute(<QrScanner onToken={onToken} deps={deps} />);
    await user.click(await screen.findByRole("button", { name: "카메라로 스캔" }));
    expect(await screen.findByLabelText("QR 카메라")).toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(SCAN_INTERVAL_MS * 3);
    });
    await waitFor(() => expect(onToken).toHaveBeenCalledWith("tokAm107x0000000000000001"));
    await act(async () => {
      vi.advanceTimersByTime(SCAN_INTERVAL_MS * 3);
    });
    expect(onToken).toHaveBeenCalledTimes(1);
    unmount();
    expect(stop).toHaveBeenCalled();
  });

  it("카메라 거부는 '설정에서 카메라를 허용하세요', BarcodeDetector가 없으면 주소 입력 안내", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { unmount } = await renderRoute(<QrScanner onToken={vi.fn()} deps={{ createDetector: () => ({ detect: vi.fn() }), getMedia: async () => Promise.reject(new Error("NotAllowedError")) }} />);
    await user.click(await screen.findByRole("button", { name: "카메라로 스캔" }));
    expect(await screen.findByText("카메라를 쓸 수 없습니다. 설정에서 카메라를 허용하세요")).toBeInTheDocument();
    unmount();
    await renderRoute(<QrScanner onToken={vi.fn()} deps={{ createDetector: () => null }} />);
    await user.click(await screen.findByRole("button", { name: "카메라로 스캔" }));
    expect(await screen.findByText(/이 브라우저는 QR 읽기를 지원하지 않습니다/)).toBeInTheDocument();
  });
});
