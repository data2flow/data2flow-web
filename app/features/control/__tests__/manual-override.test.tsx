/**
 * ACT-06.05 수동 우선 표시 — TC-ACT-121(AT-ACT-10.1): 수동 제어 직후 기기 카드에 남은 시간, 시간이 지나면 줄어들고, [자동으로 되돌리기](API-ACT-06).
 */
import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderRoute } from "../../../../test/render";
import { DeviceControlPanel } from "../control-panel";
import { fakeApi, live } from "./fake-live";
import { aircon } from "./fixtures";

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date("2026-10-04T00:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("TC-ACT-121 AT-ACT-10.1 수동 우선", () => {
  it("남은 시간 '수동 우선 · 30분 남음' → 1분 뒤 29분 → [자동으로 되돌리기]로 해제", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const api = fakeApi();
    await renderRoute(
      <DeviceControlPanel
        deviceId="2001"
        spaceId="31"
        initial={aircon({ manualOverride: { capability: "Thermostat", until: "2026-10-04T00:30:00Z", setBy: "7" } })}
        canControl
        timezone="Asia/Seoul"
        lang="ko"
        api={api}
        live={live}
      />,
    );
    expect(await screen.findByText("수동 우선 · 30분 남음")).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(screen.getByText("수동 우선 · 29분 남음")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "자동으로 되돌리기" }));
    expect(await screen.findByText("수동 우선을 해제했습니다")).toBeInTheDocument();
    expect(api.releaseOverride).toHaveBeenCalledWith("2001", "Thermostat");
    expect(screen.queryByText(/수동 우선 ·/)).not.toBeInTheDocument();
  });
});
