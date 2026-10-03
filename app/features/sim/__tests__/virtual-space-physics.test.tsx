/**
 * TC-SIM-005 UI-SIM-06 프리셋 선택 시 필드 채움, 범위 밖 입력 문구, 미리 보기 차트(SIM-01.02, AT-SIM-04.1).
 */
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { meOf, renderRoute } from "../../../../test/render";
import type { ChartHandle } from "~/components/charts/timeseries-chart";
import { PhysicsForm } from "../components/physics-form";
import { presetPhysics } from "../model/sim";
import { failure, fakeSimApi } from "./fake-sim-api";

function fakeChart() {
  const handle: ChartHandle & { options: Record<string, unknown>[] } = { options: [], setOption: vi.fn((o) => handle.options.push(o)), resize: vi.fn(), dispose: vi.fn() };
  return { handle, factory: vi.fn(async () => handle) };
}

describe("TC-SIM-005 AT-SIM-04.1 가상 공간 물리 설정", () => {
  it("프리셋을 바꾸면 값이 채워지고, 프리셋과 다른 값은 '(변경)' 표시", async () => {
    await renderRoute(<PhysicsForm initialPreset="CLASSROOM" initialPhysics={presetPhysics("CLASSROOM")} canEdit api={fakeSimApi()} timezone="Asia/Seoul" />, { session: meOf("INTEGRATOR") });
    const area = await screen.findByLabelText("면적(㎡)");
    expect(area).toHaveValue("66");
    expect(screen.getByLabelText("층고(m)")).toHaveValue("3");
    await userEvent.selectOptions(screen.getByLabelText("프리셋"), "OFFICE");
    expect(screen.getByLabelText(/^면적\(㎡\)/)).toHaveValue("120");
    expect(screen.getByLabelText("층고(m)")).toHaveValue("2.7");
    await userEvent.clear(screen.getByLabelText(/^면적\(㎡\)/));
    await userEvent.type(screen.getByLabelText(/^면적\(㎡\)/), "100");
    expect(screen.getByLabelText(/면적\(㎡\)\(변경\)/)).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText("외기 연결"));
    expect(screen.getByLabelText("외기 연결")).not.toBeChecked();
    expect(document.querySelector('input[name="physics.outdoorLinked"]')).toHaveValue("false");
    await userEvent.selectOptions(screen.getByLabelText("창 방위"), "N");
    // 사용자 정의로 바꾸면 값은 그대로 두고 변경 표시도 없다
    await userEvent.selectOptions(screen.getByLabelText("프리셋"), "CUSTOM");
    expect(screen.getByLabelText(/^면적\(㎡\)/)).toHaveValue("100");
  });

  it("범위 밖 입력은 칸 아래 문구, 미리 보기 버튼 비활성", async () => {
    await renderRoute(<PhysicsForm initialPreset="CLASSROOM" initialPhysics={presetPhysics("CLASSROOM")} canEdit api={fakeSimApi()} timezone="Asia/Seoul" serverErrors={{ "initialState.co2": "서버 오류" }} />, { session: meOf("INTEGRATOR") });
    const height = await screen.findByLabelText("층고(m)");
    await userEvent.clear(height);
    await userEvent.type(height, "25");
    expect(screen.getByText("2~20 사이로 입력하세요.")).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText(/^초기 온도/));
    await userEvent.type(screen.getByLabelText(/^초기 온도/), "abc");
    expect(screen.getByText("숫자를 입력하세요.")).toBeInTheDocument();
    expect(screen.getByText("서버 오류")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "미리 보기" })).toBeDisabled();
  });

  it("미리 보기: 조건(재실 30명)과 physics를 보내고 온도·CO2 곡선, 실패 문구", async () => {
    const api = fakeSimApi();
    const { handle, factory } = fakeChart();
    const { unmount } = await renderRoute(<PhysicsForm initialPreset="CLASSROOM" initialPhysics={presetPhysics("CLASSROOM")} canEdit api={api} spaceId="41" timezone="Asia/Seoul" chartFactory={factory} />, { session: meOf("INTEGRATOR") });
    await userEvent.selectOptions(await screen.findByLabelText("미리 보기 조건"), "30");
    await userEvent.click(screen.getByRole("button", { name: "미리 보기" }));
    expect(api.preview).toHaveBeenCalledWith(expect.objectContaining({ spaceId: "41", hours: 24, condition: { occupancy: 30 }, physics: expect.objectContaining({ areaM2: 66 }) }));
    await waitFor(() => expect(handle.setOption).toHaveBeenCalled());
    const option = handle.options.at(-1) as { series: { id: string }[] };
    expect(option.series.map((s) => s.id)).toEqual(expect.arrayContaining(["temperature", "co2"]));
    unmount();
    await renderRoute(<PhysicsForm initialPreset="MEETING" initialPhysics={presetPhysics("MEETING")} canEdit={false} api={fakeSimApi({ preview: vi.fn(() => failure(400, "SIM_PROPERTY_OUT_OF_RANGE")) })} timezone="Asia/Seoul" />, { session: meOf("OPERATOR") });
    expect(await screen.findByLabelText("면적(㎡)")).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "미리 보기" }));
    expect(await screen.findByText("허용 범위를 벗어난 값입니다")).toBeInTheDocument();
  });
});
