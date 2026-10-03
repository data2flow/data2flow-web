/**
 * TC-SIM-096 UI-SIM-04 출처 배지(카탈로그·프로필·기기)와 [기본값으로 되돌리기](SIM-09.02, AT-SIM-03.2),
 * UI-SIM-03 가상 기기 탭(특성·출력·장비 응답 저장).
 */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { meOf, renderRoute } from "../../../../test/render";
import { PropertyForm } from "../components/property-form";
import { VirtualDeviceTab } from "../components/virtual-device-tab";
import type { PropertyRow, VirtualDeviceConfig } from "../model/types";
import { failure, fakeSimApi } from "./fake-sim-api";

const cooling = { key: "coolingCapacityKw", name: "냉방 능력", type: "number" as const, unit: "kW", min: 0.5, max: 20, default: 3.5, description: "정격 냉방 출력" };
const power = { key: "powerKw", name: "소비 전력", type: "number" as const, unit: "kW", min: 0.1, max: 10, default: 1.2 };
const ROWS: PropertyRow[] = [
  { key: "coolingCapacityKw", value: 5, origin: "DEVICE", def: cooling },
  { key: "powerKw", value: 1.0, origin: "PROFILE", def: power },
];

describe("TC-SIM-096 AT-SIM-03.2 특성 출처 배지와 되돌리기", () => {
  it("직접 설정·프로필 배지, 되돌리기는 null로 저장하고 저장 뒤 출처가 프로필로", async () => {
    const onSave = vi.fn(async () => ({ ok: true }));
    const { rerender } = await renderRoute(<PropertyForm rows={ROWS} layer="DEVICE" canEdit onSave={onSave} />, { session: meOf("INTEGRATOR") });
    await screen.findByText("냉방 능력");
    const row = (name: RegExp) => screen.getByText(name).closest("tr") as HTMLElement;
    expect(within(row(/냉방 능력/)).getByText("직접 설정")).toBeInTheDocument();
    expect(within(row(/소비 전력/)).getByText("프로필")).toBeInTheDocument();
    expect(screen.getByText("냉방 능력")).toHaveAttribute("title", "정격 냉방 출력");
    // 상속 값은 되돌리기 없음
    expect(within(row(/소비 전력/)).queryByRole("button", { name: "기본값으로 되돌리기" })).toBeNull();
    expect(screen.getByRole("button", { name: "저장" })).toBeDisabled();
    await userEvent.click(within(row(/냉방 능력/)).getByRole("button", { name: "기본값으로 되돌리기" }));
    expect(within(row(/냉방 능력/)).getByText("되돌림(저장 시 반영)")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(onSave).toHaveBeenCalledWith({ coolingCapacityKw: null });
    expect(await screen.findByText("저장했습니다.")).toBeInTheDocument();
    // 서버가 돌려준 새 행: 냉방 능력 출처 = PROFILE
    rerender(<PropertyForm key="v2" rows={[{ ...ROWS[0], value: 4, origin: "PROFILE" }, ROWS[1]]} layer="DEVICE" canEdit onSave={onSave} />);
    await waitFor(() => expect(within(row(/냉방 능력/)).getByText("프로필")).toBeInTheDocument());
  });

  it("값을 바꾸면 '직접 설정', 저장 실패 문구, [취소]로 되돌림, 권한 없으면 읽기 전용", async () => {
    const onSave = vi.fn(async () => ({ ok: false, message: "허용 범위를 벗어난 값입니다" }));
    const { unmount } = await renderRoute(<PropertyForm rows={ROWS} layer="DEVICE" canEdit onSave={onSave} title="가상 특성" />, { session: meOf("INTEGRATOR") });
    expect(await screen.findByText("가상 특성")).toBeInTheDocument();
    const input = screen.getByLabelText("소비 전력 (kW)");
    await userEvent.clear(input);
    await userEvent.type(input, "2");
    expect(screen.getAllByText("직접 설정")).toHaveLength(2);
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(onSave).toHaveBeenCalledWith({ powerKw: 2 });
    expect(await screen.findByText("허용 범위를 벗어난 값입니다")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "취소" }));
    expect(screen.getByLabelText("소비 전력 (kW)")).toHaveValue("1");
    unmount();
    await renderRoute(<PropertyForm rows={ROWS} layer="DEVICE" canEdit={false} onSave={onSave} />, { session: meOf("OPERATOR") });
    expect(await screen.findByLabelText("냉방 능력 (kW)")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "저장" })).toBeNull();
    expect(screen.queryByRole("button", { name: "기본값으로 되돌리기" })).toBeNull();
  });
});

const CONFIG: VirtualDeviceConfig = {
  deviceId: "2002",
  typeId: "21",
  profileId: "301",
  properties: ROWS,
  reportIntervalSec: 60,
  jitterPct: 10,
  payloadFormat: "GENERIC_JSON",
  outputPath: "INTERNAL",
  response: { reactionDelaySec: 120, ackDelayMs: 500, failurePct: 0 },
  actuatorState: { power: "OFF", mode: "cool", version: 3 },
  seed: null,
  reportMode: "ALWAYS",
};

describe("UI-SIM-03 가상 기기 탭", () => {
  it("개요(장비 상태), 특성 저장은 overrides PATCH 후 다시 조회, 출력 범위 검사와 저장", async () => {
    const api = fakeSimApi({ device: vi.fn(async () => ({ ok: true as const, status: 200, data: { ...CONFIG, properties: [{ ...ROWS[0], value: 6 }, ROWS[1]] } })) });
    await renderRoute(<VirtualDeviceTab deviceId="2002" initial={CONFIG} canManage api={api} />, { session: meOf("INTEGRATOR") });
    expect(await screen.findByText("power=OFF mode=cool")).toBeInTheDocument();
    expect(screen.getByText("상시")).toBeInTheDocument();
    const cap = screen.getByLabelText("냉방 능력 (kW)");
    await userEvent.clear(cap);
    await userEvent.type(cap, "6");
    await userEvent.click(screen.getAllByRole("button", { name: "저장" })[0]);
    await waitFor(() => expect(api.patchDevice).toHaveBeenCalledWith("2002", { overrides: { coolingCapacityKw: 6 } }));
    await waitFor(() => expect(api.device).toHaveBeenCalledWith("2002"));
    await waitFor(() => expect(screen.getByLabelText("냉방 능력 (kW)")).toHaveValue("6"));
    const interval = screen.getByLabelText("보고 주기(초, 5~86,400)");
    await userEvent.clear(interval);
    await userEvent.type(interval, "1");
    await userEvent.click(screen.getAllByRole("button", { name: "저장" }).at(-1) as HTMLElement);
    expect(await screen.findByText("5~86400 사이로 입력하세요.")).toBeInTheDocument();
    await userEvent.clear(interval);
    await userEvent.type(interval, "30");
    await userEvent.click(screen.getAllByRole("button", { name: "저장" }).at(-1) as HTMLElement);
    await waitFor(() => expect(api.patchDevice).toHaveBeenLastCalledWith("2002", { reportIntervalSec: 30, jitterPct: 10, payloadFormat: "GENERIC_JSON", response: { reactionDelaySec: 120, ackDelayMs: 500, failurePct: 0 } }));
  });

  it("저장 실패 문구, 설정이 없으면 안내", async () => {
    const api = fakeSimApi({ patchDevice: vi.fn(() => failure(400, "SIM_PROPERTY_OUT_OF_RANGE")) });
    const { unmount } = await renderRoute(<VirtualDeviceTab deviceId="2002" initial={{ ...CONFIG, response: null, actuatorState: null }} canManage api={api} />, { session: meOf("INTEGRATOR") });
    await screen.findByText("가상 특성");
    expect(screen.queryByLabelText("실패 확률(%, 0~100)")).toBeNull();
    await userEvent.click(screen.getAllByRole("button", { name: "저장" }).at(-1) as HTMLElement);
    expect(await screen.findByText("허용 범위를 벗어난 값입니다")).toBeInTheDocument();
    const cap = screen.getByLabelText("냉방 능력 (kW)");
    await userEvent.clear(cap);
    await userEvent.type(cap, "7");
    await userEvent.click(screen.getAllByRole("button", { name: "저장" })[0]);
    expect(await screen.findAllByText("허용 범위를 벗어난 값입니다")).toHaveLength(2);
    unmount();
    const r = await renderRoute(<VirtualDeviceTab deviceId="1" initial={null} failed canManage api={api} />);
    expect(await screen.findByText("가상 설정을 불러오지 못했습니다.")).toBeInTheDocument();
    r.unmount();
    await renderRoute(<VirtualDeviceTab deviceId="1" initial={null} canManage api={api} />);
    expect(await screen.findByText("가상 기기가 아닙니다.")).toBeInTheDocument();
  });
});
