/**
 * ACT-07.01·07.02 오프라인 대기열과 LoRaWAN Class A — TC-ACT-127(AT-ACT-07.5): 명령 → QUEUED_FOR_DOWNLINK, 예상 전달 시각 표시, 다음 업링크 후 ACKED.
 * 오프라인 기기는 대기 명령 수 배지.
 */
import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderRoute } from "../../../../test/render";
import { CommandProgress, DeviceControlPanel } from "../control-panel";
import { FakeES, fakeApi, live } from "./fake-live";
import { aircon } from "./fixtures";

describe("TC-ACT-127 AT-ACT-07.5 Class A 다운링크 대기", () => {
  it("QUEUED_FOR_DOWNLINK + 예상 전달 시각(보고 주기 10분) → 다음 업링크 뒤 ACKED", async () => {
    FakeES.all = [];
    const user = userEvent.setup();
    const api = fakeApi({
      command: vi.fn(async () => ({
        ok: true as const,
        status: 202,
        data: { id: "c-a", status: "QUEUED_FOR_DOWNLINK", deviceId: "3001", capability: "Switch", command: "set", args: { on: false }, expectedDeliveryAt: "2026-10-04T00:10:00Z" },
      })),
    });
    await renderRoute(<DeviceControlPanel deviceId="3001" spaceId="31" initial={aircon()} canControl timezone="Asia/Seoul" lang="ko" api={api} live={live} />);
    await user.click(await screen.findByRole("switch", { name: "Switch 전원" }));
    await user.click(screen.getAllByRole("button", { name: "적용" })[0]);
    expect(await screen.findByText("다음 업링크 때 전달 예정 · 2026-10-04 09:10")).toBeInTheDocument();
    expect(screen.getByText("다운링크 대기")).toBeInTheDocument();
    expect(screen.getByText("대기 명령 1건")).toBeInTheDocument();
    act(() => FakeES.all[0].emit("command-status", { commandId: "c-a", status: "SENT" }));
    act(() => FakeES.all[0].emit("command-status", { commandId: "c-a", status: "ACKED" }));
    expect(await screen.findByRole("status", { name: "명령 상태: 응답받음" })).toBeInTheDocument();
    expect(screen.queryByText(/다음 업링크 때 전달 예정/)).not.toBeInTheDocument();
  });

  it("오프라인 기기: 이미 대기 중인 명령 수, 예상 시각이 없으면 문구만", async () => {
    await renderRoute(
      <DeviceControlPanel
        deviceId="2001"
        initial={aircon({
          shadow: { ...aircon().shadow, connectivity: "OFFLINE" },
          pending: [
            { commandId: "q1", capability: "Switch", command: "set", status: "QUEUED" },
            { commandId: "q2", capability: "Thermostat", command: "set", status: "QUEUED" },
          ],
        })}
        canControl
        timezone="Asia/Seoul"
        lang="ko"
        api={fakeApi()}
        live={live}
      />,
    );
    expect(await screen.findByText("대기 명령 2건")).toBeInTheDocument();
    expect(screen.getByText("오프라인")).toBeInTheDocument();
    await renderRoute(<CommandProgress command={{ status: "QUEUED_FOR_DOWNLINK" }} />);
    expect(await screen.findByText("다음 업링크 때 전달 예정")).toBeInTheDocument();
  });
});
