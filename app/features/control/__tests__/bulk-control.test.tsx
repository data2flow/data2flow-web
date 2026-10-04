/**
 * ACT-02.06 UI-ACT-03 일괄 제어 — TC-ACT-055(AT-ACT-04.1: 12대 중 1대 오프라인 → "11/12 적용, 1 대기"), TC-ACT-056(AT-ACT-04.2: 500대 초과 거부).
 */
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderRoute } from "../../../../test/render";
import { BulkControlDialog } from "../bulk-control";
import { ControlAreaTabs } from "../area-tabs";
import { err, fakeAdminApi, ok } from "./fake-admin";

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => vi.useRealTimers());

const VENTILATION = {
  name: "Ventilation",
  version: 1,
  attributes: [
    { name: "mode", type: "enum", enum: ["off", "on", "auto"] },
    { name: "level", type: "integer", min: 1, max: 3 },
  ],
  commands: [{ name: "set", sets: ["mode", "level"] }],
};
const ids = Array.from({ length: 12 }, (_, i) => `v${i + 1}`);

describe("TC-ACT-055 AT-ACT-04.1 일괄 제어", () => {
  it("기능 정의로 입력(모드 버튼·단계 버튼) → 미리보기 → 실행 → 진행 폴링 '11/12 적용 · 대기 1'", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const api = fakeAdminApi({
      capability: vi.fn(async () => ok(VENTILATION)),
      bulkPreview: vi.fn(async () =>
        ok({
          devices: ids.map((id, i) => ({
            deviceId: id,
            name: `환기 ${i + 1}`,
            current: { mode: "off" },
            target: { mode: "on", level: 2 },
            willChange: i !== 11,
            warnings: i === 0 ? ["OFFLINE"] : [],
          })),
        }),
      ),
      bulkRun: vi.fn(async () => ok({ bulkJobId: "bj-1", total: 12 }, 202)),
      bulkJob: vi.fn(async () => ok({ total: 12, succeeded: 11, failed: 0, queued: 1, skipped: 0, items: [{ deviceId: "v1", status: "QUEUED", reason: "OFFLINE" }] })),
    });
    await renderRoute(<BulkControlDialog open onClose={vi.fn()} target={{ deviceIds: ids }} api={api} pollMs={2000} />);
    expect(await screen.findByRole("dialog", { name: "일괄 제어: 12대" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "미리보기" })).toBeDisabled();
    await user.selectOptions(screen.getByLabelText("기능"), "Ventilation");
    await user.click(await screen.findByRole("button", { name: "켜기" }));
    await user.click(screen.getByRole("button", { name: "2" }));
    expect(screen.getByRole("button", { name: "실행" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "미리보기" }));
    expect(await screen.findByText("환기 12")).toBeInTheDocument();
    expect(screen.getByText("변경 없음")).toBeInTheDocument();
    expect(screen.getByText(/오프라인/)).toBeInTheDocument();
    expect(api.bulkPreview.mock.calls[0][0]).toEqual({ target: { deviceIds: ids }, capability: "Ventilation", command: "set", args: { mode: "on", level: 2 } });
    await user.click(screen.getByRole("button", { name: "실행" }));
    expect(await screen.findByText("0/12 적용 · 대기 0 · 실패 0 · 건너뜀 0")).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    await waitFor(() => expect(screen.getByText("11/12 적용 · 대기 1 · 실패 0 · 건너뜀 0")).toBeInTheDocument());
    expect(screen.getByText(/v1: 대기열 — 오프라인/)).toBeInTheDocument();
  });

  it("TC-ACT-056 AT-ACT-04.2: 500대 초과는 미리보기 전에 막고, 서버 거부·범위 밖 값도 문구로", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { unmount } = await renderRoute(<BulkControlDialog open onClose={vi.fn()} target={{ deviceIds: Array.from({ length: 501 }, (_, i) => String(i)) }} api={fakeAdminApi()} />);
    expect(await screen.findByText("한 번에 500대까지 제어할 수 있습니다")).toBeInTheDocument();
    unmount();
    const api = fakeAdminApi({
      capability: vi.fn(async () =>
        ok({ name: "Thermostat", attributes: [{ name: "targetTemperature", type: "number", min: 18, max: 28, step: 0.5 }], commands: [{ name: "set", sets: ["targetTemperature"] }] }),
      ),
      bulkPreview: vi.fn(async () => err(400, "CAPABILITY_NOT_SUPPORTED")),
    });
    await renderRoute(<BulkControlDialog open onClose={vi.fn()} target={{ spaceId: "3", includeChildren: true }} api={api} />);
    expect(await screen.findByRole("dialog", { name: "이 공간 일괄 제어" })).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("기능"), "Thermostat");
    const input = await screen.findByRole("spinbutton");
    await user.type(input, "31");
    expect(await screen.findByText("18~28 사이로 설정하세요")).toBeInTheDocument();
    await user.clear(input);
    await user.type(input, "24");
    await user.click(screen.getByRole("button", { name: "미리보기" }));
    expect(await screen.findByText("이 기기가 지원하지 않는 기능입니다")).toBeInTheDocument();
    expect(api.bulkPreview.mock.calls[0][0].target).toEqual({ spaceId: "3", includeChildren: true, capability: "Thermostat" });
  });
});

describe("제어 하위 탭", () => {
  it("권한에 따라 탭을 거른다(OPERATOR: 장면·명령 이력·기능 카탈로그)", async () => {
    await renderRoute(<ControlAreaTabs current="scenes" permissions={["DEV_READ", "SCENE_RUN", "DEVICE_CONTROL"]} />);
    const links = (await screen.findAllByRole("link")).map((a) => a.textContent);
    expect(links).toEqual(["장면", "명령 이력", "기능 카탈로그"]);
  });
});
