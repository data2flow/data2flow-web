/**
 * UI-ACT-01 기기 제어 패널 — ACT-02.04 원하는 상태·실제 상태(TC-ACT-044, AT-ACT-03.3), ACT-04.01 표준 컨트롤.
 */
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderRoute } from "../../../../test/render";
import { DeviceControlPanel } from "../control-panel";
import type { CapabilityControl } from "../model/control";
import { FakeES, fakeApi, live } from "./fake-live";
import { aircon } from "./fixtures";

const NOW = Date.parse("2026-10-04T00:00:00Z");

beforeEach(() => {
  FakeES.all = [];
});

function render(props: Partial<Parameters<typeof DeviceControlPanel>[0]> = {}) {
  const api = props.api ?? fakeApi();
  return renderRoute(<DeviceControlPanel deviceId="2001" spaceId="31" initial={aircon()} canControl timezone="Asia/Seoul" lang="ko" api={api} live={live} now={() => NOW} {...props} />);
}

describe("TC-ACT-044 AT-ACT-03.3 기기에서 직접 바꾼 보고(ACT-02.04)", () => {
  it("리모컨으로 온도 변경(reported만 바뀜) → 차이 표시, '기기에서 직접 변경됨', desired 그대로, 명령 재전송 없음", async () => {
    const api = fakeApi();
    await render({ api });
    expect(await screen.findAllByText("원하는 상태 = 실제 상태")).toHaveLength(2);
    expect(FakeES.all[0].url).toBe(`/bff/stream/live?topics=${encodeURIComponent("commands:2001,space:31")}`);
    // 측정값 갱신(state는 기기 상태 문자열)은 섀도와 무관하다
    act(() => FakeES.all[0].emit("device-update", { deviceId: "2001", metrics: [{ key: "temperature", value: 25.1, unit: "℃", quality: 0, at: "2026-10-04T00:00:04Z" }], state: "ACTIVE" }));
    expect(screen.getAllByText("원하는 상태 = 실제 상태")).toHaveLength(2);
    // 액추에이터 보고(API-DSH-20): {deviceId, connection, state:{reported, delta, reportedVersion, origin, at}}
    act(() =>
      FakeES.all[0].emit("device-update", {
        deviceId: "2001",
        connection: "ONLINE",
        state: { reported: { Thermostat: { targetTemperature: 22 } }, delta: { Thermostat: { targetTemperature: 26 } }, reportedVersion: 8, origin: "DEVICE_LOCAL", at: "2026-10-04T00:00:05Z" },
      }),
    );
    expect(await screen.findByText("기기에서 직접 변경됨")).toBeInTheDocument();
    expect(screen.getByText("원하는 값 26℃ · 실제 값 22℃")).toBeInTheDocument();
    expect(api.command).not.toHaveBeenCalled();
    // 다른 기기의 보고는 무시
    act(() => FakeES.all[0].emit("device-update", { deviceId: "9999", state: { reported: { Switch: { on: false } }, delta: {}, reportedVersion: 1, origin: "DEVICE_LOCAL", at: "2026-10-04T00:00:06Z" } }));
    expect(screen.getAllByText("원하는 상태 = 실제 상태")).toHaveLength(1);
  });

  it("오프라인 기기에 보류된 desired → '적용 대기'", async () => {
    const info = aircon();
    info.shadow = { ...info.shadow!, connectivity: "OFFLINE", desired: { ...info.shadow!.desired!, Switch: { on: false } }, delta: { Switch: { on: false } } };
    await render({ initial: info });
    expect(await screen.findByText("적용 대기")).toBeInTheDocument();
    expect(screen.getByText("오프라인")).toBeInTheDocument();
  });
});

describe("ACT-04.01 표준 컨트롤과 적용", () => {
  it("모드는 모델이 지원하는 것만, 목표 온도 범위 안내, 바뀐 값이 있을 때만 [적용], Idempotency 명령 1건", async () => {
    const user = userEvent.setup();
    const api = fakeApi();
    await render({ api });
    const modes = await screen.findByRole("group", { name: "Thermostat 모드" });
    expect([...modes.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["끄기", "냉방", "난방", "자동"]);
    expect(screen.getAllByText("18~28℃")).toHaveLength(1);
    const applyButtons = screen.getAllByRole("button", { name: "적용" });
    expect(applyButtons.every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
    const input = screen.getByRole("spinbutton", { name: "Thermostat 목표 온도" });
    await user.clear(input);
    await user.type(input, "30");
    expect(await screen.findByText("18~28℃ 사이로 설정하세요")).toBeInTheDocument();
    expect(applyButtons[1]).toBeDisabled();
    await user.clear(input);
    await user.type(input, "24");
    expect(screen.queryByText("18~28℃ 사이로 설정하세요")).not.toBeInTheDocument();
    await user.click(applyButtons[1]);
    await user.click(applyButtons[1]);
    await waitFor(() => expect(api.command).toHaveBeenCalledTimes(1));
    expect(api.command).toHaveBeenCalledWith("2001", { capability: "Thermostat", command: "set", args: { targetTemperature: 24 } });
    expect(await screen.findByRole("status", { name: "명령 상태: 요청됨" })).toBeInTheDocument();
    expect(screen.getByText("원하는 값 24℃ · 실제 값 26℃")).toBeInTheDocument();
  });

  it("전원 토글·모드 선택, 서버 거부(COMMAND_ABSOLUTE_LIMIT)는 사유 문구", async () => {
    const user = userEvent.setup();
    const api = fakeApi({ command: vi.fn(async () => ({ ok: false as const, status: 400, code: "COMMAND_ABSOLUTE_LIMIT", message: "" })) });
    await render({ api });
    await user.click(await screen.findByRole("switch", { name: "Switch 전원" }));
    expect(screen.getByText("꺼짐")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "난방" }));
    expect(screen.getByRole("button", { name: "난방" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getAllByRole("button", { name: "적용" })[0]);
    expect(await screen.findByText("조직 절대 한계를 넘는 값이라 거부했습니다")).toBeInTheDocument();
  });

  it("잠금 해제는 확인, 슬라이더, 사용자 정의 문자열·단계 속성", async () => {
    const user = userEvent.setup();
    const lock: CapabilityControl = { name: "Lock", attributes: [{ name: "locked", type: "boolean" }, { name: "battery", type: "number", readOnly: true }], commands: [{ name: "set", sets: ["locked"] }] };
    const custom: CapabilityControl = { name: "custom.Label", attributes: [{ name: "text", type: "string" }, { name: "level", type: "integer" }], commands: [{ name: "set" }] };
    const info = aircon({ capabilities: [lock, custom], shadow: { desired: {}, reported: { Lock: { locked: true, battery: 80 } } } });
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    await render({ initial: info });
    const toggle = await screen.findByRole("switch", { name: "Lock 잠금" });
    await user.click(toggle);
    expect(toggle).toBeChecked();
    await user.click(toggle);
    expect(toggle).not.toBeChecked();
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(screen.getByText("80")).toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: "custom.Label text" }), "hi");
    expect(screen.getByRole("textbox", { name: "custom.Label text" })).toHaveValue("hi");
    await user.type(screen.getByRole("spinbutton", { name: "custom.Label 단계" }), "2");
    expect(screen.getByRole("spinbutton", { name: "custom.Label 단계" })).toHaveValue(2);
    confirm.mockRestore();
  });

  it("슬라이더로도 바꾼다", async () => {
    await render();
    const slider = (await screen.findByRole("slider", { name: "Thermostat 목표 온도 슬라이더" })) as HTMLInputElement;
    expect(slider.min).toBe("18");
    expect(slider.max).toBe("28");
    expect(slider.step).toBe("0.5");
  });
});

describe("UI-ACT-01 상태", () => {
  it("읽기 실패·제어 불가·읽기 전용·비상 정지·서킷 열림·보호", async () => {
    const first = await render({ initial: null });
    expect(await screen.findByText("제어 정보를 불러오지 못했습니다. 잠시 뒤 다시 시도해 주세요.")).toBeInTheDocument();
    first.unmount();
    const second = await render({ initial: aircon({ controllable: false, capabilities: [] }) });
    expect(await screen.findByText("이 기기는 제어할 수 없습니다")).toBeInTheDocument();
    expect(FakeES.all).toHaveLength(0);
    second.unmount();
    await render({
      canControl: false,
      initial: aircon({ emergencyStop: { since: "2026-10-04T00:00:00Z" }, driver: { id: "1", name: "LG", type: "LG_THINQ", status: "CIRCUIT_OPEN" }, protection: { nextAllowedAt: "2026-10-04T00:03:00Z" } }),
    });
    expect(await screen.findByText("자동 제어 비상 정지 중 — 수동 제어는 가능합니다")).toBeInTheDocument();
    expect(screen.getByText("드라이버 일시 장애: 명령이 바로 실패로 끝날 수 있습니다")).toBeInTheDocument();
    expect(screen.getByText("제어 권한이 없어 보기만 할 수 있습니다")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "적용" })).not.toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Switch 전원" })).toBeDisabled();
    expect(screen.getByText(/장비 보호: .* 이후 명령 가능/)).toBeInTheDocument();
  });

  it("수동 우선 배지와 [자동으로 되돌리기](API-ACT-06), 실패 문구", async () => {
    const user = userEvent.setup();
    const api = fakeApi();
    const { unmount } = await render({ api, initial: aircon({ manualOverride: { capability: "Thermostat", until: "2026-10-04T00:23:00Z" } }) });
    expect(await screen.findByText("수동 우선 · 23분 남음")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "자동으로 되돌리기" }));
    expect(api.releaseOverride).toHaveBeenCalledWith("2001", "Thermostat");
    expect(await screen.findByText("수동 우선을 해제했습니다")).toBeInTheDocument();
    expect(screen.queryByText("수동 우선 · 23분 남음")).not.toBeInTheDocument();
    unmount();
    const failing = fakeApi({ releaseOverride: vi.fn(async () => ({ ok: false as const, status: 403, code: "PERMISSION_DENIED", message: "" })) });
    await render({ api: failing, initial: aircon({ manualOverride: { capability: "Thermostat", until: "2026-10-04T00:23:00Z" } }) });
    await user.click(await screen.findByRole("button", { name: "자동으로 되돌리기" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});
