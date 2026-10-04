/**
 * ACT-04.01 UI-ACT-01 기능별 표준 컨트롤 — TC-ACT-084(AT-ACT-01.2·01.4): Switch 토글, Thermostat 슬라이더 18~30·모드 선택, 모델 범위 밖 입력 불가,
 * ANALYST·VIEWER는 컨트롤 비활성 + 읽기 전용 표시. 단계형(FanSpeed·Ventilation level)은 단계 버튼.
 */
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderRoute } from "../../../../test/render";
import { DeviceControlPanel } from "../control-panel";
import { fakeApi, live } from "./fake-live";
import { SWITCH, THERMOSTAT, aircon } from "./fixtures";

const RANGE_18_30 = { ...THERMOSTAT, effectiveConstraints: { mode: { enum: ["off", "cool", "heat", "auto"] }, targetTemperature: { min: 18, max: 30 } } };
const FAN = {
  name: "FanSpeed",
  attributes: [
    { name: "level", type: "integer", min: 0, max: 3 },
    { name: "auto", type: "boolean" },
  ],
  commands: [{ name: "set", sets: ["level", "auto"] }],
};

describe("TC-ACT-084 AT-ACT-01.2 AT-ACT-01.4 표준 컨트롤", () => {
  it("OPERATOR: Switch 토글, Thermostat 18~30 슬라이더·지원 모드만, FanSpeed 단계 버튼, 범위 밖(31)은 적용 불가", async () => {
    const user = userEvent.setup();
    const api = fakeApi();
    await renderRoute(
      <DeviceControlPanel deviceId="2001" spaceId="31" initial={aircon({ capabilities: [SWITCH, RANGE_18_30, FAN] })} canControl timezone="Asia/Seoul" lang="ko" api={api} live={live} />,
    );
    expect(await screen.findByRole("switch", { name: "Switch 전원" })).toBeChecked();
    const slider = screen.getByRole("slider", { name: "Thermostat 목표 온도 슬라이더" });
    expect(slider).toHaveAttribute("min", "18");
    expect(slider).toHaveAttribute("max", "30");
    const modes = screen.getByRole("group", { name: "Thermostat 모드" });
    expect([...modes.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["끄기", "냉방", "난방", "자동"]);
    const levels = screen.getByRole("group", { name: "FanSpeed 단계" });
    expect([...levels.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["0", "1", "2", "3"]);
    await user.click(screen.getByRole("button", { name: "2" }));
    expect(screen.getByRole("button", { name: "2" })).toHaveAttribute("aria-pressed", "true");

    const input = screen.getByRole("spinbutton", { name: "Thermostat 목표 온도" });
    await user.clear(input);
    await user.type(input, "31");
    expect(screen.getByText("18~30℃ 사이로 설정하세요")).toBeInTheDocument();
    const apply = screen.getAllByRole("button", { name: "적용" });
    expect(apply[1]).toBeDisabled();
    await user.click(apply[2]);
    expect(api.command).toHaveBeenCalledWith("2001", { capability: "FanSpeed", command: "set", args: { level: 2 } });
  });

  it("ANALYST·VIEWER(제어 권한 없음): 컨트롤 비활성, 읽기 전용 안내, [적용]·[자동으로 되돌리기] 없음", async () => {
    await renderRoute(
      <DeviceControlPanel
        deviceId="2001"
        spaceId="31"
        initial={aircon({ manualOverride: { capability: "Thermostat", until: "2026-10-04T00:23:00Z" } })}
        canControl={false}
        timezone="Asia/Seoul"
        lang="ko"
        api={fakeApi()}
        live={live}
        now={() => Date.parse("2026-10-04T00:00:00Z")}
      />,
    );
    expect(await screen.findByText("제어 권한이 없어 보기만 할 수 있습니다")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Switch 전원" })).toBeDisabled();
    expect(screen.getByRole("spinbutton", { name: "Thermostat 목표 온도" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "적용" })).not.toBeInTheDocument();
    expect(screen.getByText("수동 우선 · 23분 남음")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "자동으로 되돌리기" })).not.toBeInTheDocument();
  });

  it("드라이버 없음·서킷 열림·비상 정지 상태 안내", async () => {
    const { unmount } = await renderRoute(
      <DeviceControlPanel
        deviceId="2001"
        initial={aircon({ driver: { id: "303", name: "LG", status: "CIRCUIT_OPEN" }, emergencyStop: { emergencyStopId: "9" } })}
        canControl
        timezone="Asia/Seoul"
        lang="ko"
        api={fakeApi()}
        live={live}
      />,
    );
    expect(await screen.findByText("드라이버 일시 장애: 명령이 바로 실패로 끝날 수 있습니다")).toBeInTheDocument();
    expect(screen.getByText("자동 제어 비상 정지 중 — 수동 제어는 가능합니다")).toBeInTheDocument();
    unmount();
    await renderRoute(<DeviceControlPanel deviceId="1042" initial={{ controllable: false, capabilities: [] }} canControl timezone="Asia/Seoul" lang="ko" api={fakeApi()} live={live} />);
    expect(await screen.findByText("이 기기는 제어할 수 없습니다")).toBeInTheDocument();
  });
});
