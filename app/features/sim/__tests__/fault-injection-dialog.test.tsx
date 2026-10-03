/**
 * TC-SIM-066 UI-SIM-10 장애 종류별 파라미터 폼, 실제 기기 선택 불가, 400 문구(SIM-05.03, AT-SIM-11.1), 진행 중 장애 [해제](API-SIM-21).
 */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { meOf, renderRoute } from "../../../../test/render";
import { FaultDialog } from "../components/fault-dialog";
import { failure, fakeSimApi } from "./fake-sim-api";

const TARGETS = [
  { deviceId: "2001", name: "TH-1", virtual: true },
  { deviceId: "2003", name: "TH-2", virtual: true },
  { deviceId: "1042", name: "AM107-067999", virtual: false },
];

describe("TC-SIM-066 AT-SIM-11.1 장애 주입 대화상자", () => {
  it("가상 센서만 고를 수 있고, 종류별 강도 칸·범위 검사, 지금/N분 뒤·지속 → API-SIM-20", async () => {
    const api = fakeSimApi();
    await renderRoute(<FaultDialog open onClose={vi.fn()} runId="42" targets={TARGETS} api={api} />, { session: meOf("OPERATOR") });
    const dialog = await screen.findByRole("dialog", { name: "장애 주입" });
    expect(within(dialog).getByLabelText("TH-1")).toBeInTheDocument();
    expect(within(dialog).queryByLabelText("AM107-067999")).toBeNull();
    expect(within(dialog).getByText("실제 기기 1대는 고를 수 없습니다(가상 기기에만 주입).")).toBeInTheDocument();
    // 대상 없이 주입 → 문구
    await userEvent.click(within(dialog).getByRole("button", { name: "주입" }));
    expect(within(dialog).getByText("대상을 하나 이상 고르세요.")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByLabelText("TH-1"));
    await userEvent.click(within(dialog).getByLabelText("TH-2"));
    await userEvent.click(within(dialog).getByLabelText("TH-2"));
    // STUCK: 값은 선택(비우면 현재 값)
    expect(within(dialog).getByText("비우면 현재 값")).toBeInTheDocument();
    await userEvent.selectOptions(within(dialog).getByLabelText("유형"), "SPIKE");
    expect(within(dialog).getByLabelText("크기 (-100000~100000)")).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText("크기 (-100000~100000)"), "20");
    await userEvent.type(within(dialog).getByLabelText("횟수 (1~100)"), "300");
    await userEvent.click(within(dialog).getByLabelText("N분 뒤"));
    const start = within(dialog).getByLabelText("몇 분 뒤(시뮬레이션)");
    await userEvent.clear(start);
    await userEvent.type(start, "10");
    await userEvent.click(within(dialog).getByRole("button", { name: "주입" }));
    expect(within(dialog).getByText("1~100 사이로 입력하세요.")).toBeInTheDocument();
    await userEvent.clear(within(dialog).getByLabelText("횟수 (1~100)"));
    await userEvent.type(within(dialog).getByLabelText("횟수 (1~100)"), "3");
    await userEvent.click(within(dialog).getByRole("button", { name: "주입" }));
    await waitFor(() => expect(api.injectFault).toHaveBeenCalledWith({ runId: "42", targetType: "DEVICE", targetIds: ["2001"], kind: "SPIKE", params: { magnitude: 20, count: 3 }, startInSec: 600, durationSec: 1800 }));
    expect(await within(dialog).findByText("장애 1건을 주입했습니다.")).toBeInTheDocument();
    expect(api.faults).toHaveBeenCalledWith("42");
  });

  it("게이트웨이 대상은 EUI 입력과 게이트웨이 장애 종류, 지속 범위", async () => {
    const api = fakeSimApi();
    await renderRoute(<FaultDialog open onClose={vi.fn()} runId={null} targets={[]} api={api} />, { session: meOf("OPERATOR") });
    const dialog = await screen.findByRole("dialog", { name: "장애 주입" });
    expect(within(dialog).getByText("가상 기기가 없습니다.")).toBeInTheDocument();
    await userEvent.selectOptions(within(dialog).getByLabelText("대상 종류"), "GATEWAY");
    expect(within(dialog).getByLabelText("유형")).toHaveDisplayValue("게이트웨이 장애");
    await userEvent.type(within(dialog).getByLabelText("가상 게이트웨이 EUI"), "5a1d000000000001");
    const duration = within(dialog).getByLabelText("지속(분, 1~1,440)");
    await userEvent.clear(duration);
    await userEvent.type(duration, "2000");
    await userEvent.click(within(dialog).getByRole("button", { name: "주입" }));
    expect(within(dialog).getByText("1~1440 사이로 입력하세요.")).toBeInTheDocument();
    await userEvent.clear(duration);
    await userEvent.type(duration, "60");
    await userEvent.selectOptions(within(dialog).getByLabelText("유형"), "DUPLICATE");
    await userEvent.type(within(dialog).getByLabelText("배수 (2~5)"), "3");
    await userEvent.click(within(dialog).getByRole("button", { name: "주입" }));
    await waitFor(() => expect(api.injectFault).toHaveBeenCalledWith({ targetType: "GATEWAY", targetIds: ["5a1d000000000001"], kind: "DUPLICATE", params: { factor: 3 }, startInSec: 0, durationSec: 3600 }));
    expect(api.faults).toHaveBeenCalledWith(null);
  });

  it("서버 400 SIM_TARGET_NOT_VIRTUAL 문구, 진행 중·예정 장애 목록과 [해제]", async () => {
    const api = fakeSimApi({
      injectFault: vi.fn(() => failure(400, "SIM_TARGET_NOT_VIRTUAL")),
      faults: vi.fn(() =>
        Promise.resolve({
          ok: true as const,
          status: 200,
          data: {
            responses: [
              { faultId: "f1", kind: "DRIFT", targetType: "DEVICE" as const, targetId: "2001", status: "ACTIVE" as const, remainingSec: 2460 },
              { faultId: "f2", kind: "STUCK", targetType: "DEVICE" as const, targetId: "9999", status: "SCHEDULED" as const },
              { faultId: "f3", kind: "STUCK", targetType: "DEVICE" as const, targetId: "2001", status: "ENDED" as const },
            ],
          },
        }),
      ),
      cancelFault: vi.fn(() => failure(409, "SIM_RUN_STATE_CONFLICT")),
    });
    await renderRoute(<FaultDialog open onClose={vi.fn()} runId="42" targets={TARGETS} api={api} />, { session: meOf("OPERATOR") });
    const list = await screen.findByRole("region", { name: "진행 중·예정 장애" });
    expect(await within(list).findByText("남은 41분")).toBeInTheDocument();
    expect(within(list).getByText("드리프트")).toBeInTheDocument();
    expect(within(list).getByText("9999")).toBeInTheDocument();
    expect(within(list).getByText("예정")).toBeInTheDocument();
    expect(within(list).getAllByRole("row")).toHaveLength(2);
    await userEvent.click(within(list).getAllByRole("button", { name: "해제" })[0]);
    expect(api.cancelFault).toHaveBeenCalledWith("f1");
    expect(await screen.findByText("지금 상태에서는 할 수 없는 동작입니다")).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText("TH-1"));
    await userEvent.click(screen.getByRole("button", { name: "주입" }));
    expect(await screen.findByText("가상 기기에만 할 수 있습니다")).toBeInTheDocument();
  });
});
