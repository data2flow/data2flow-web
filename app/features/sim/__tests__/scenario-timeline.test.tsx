/**
 * TC-SIM-042 UI-SIM-08 트랙 추가·이벤트 끌기, 저장 후 다시 불러와 표시, 검증 오류 위치 표시(SIM-04.01, AT-SIM-07.1),
 * [실행] → 실행 옵션 → API-SIM-14 → 실행 패널(SIM-04.02).
 */
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { meOf, renderRoute } from "../../../../test/render";
import { RunOptionsDialog, ScenarioEditor } from "../components/scenario-editor";
import { emptyScenario, fromScenario } from "../model/scenario";
import type { Scenario } from "../model/types";
import { failure, fakeSimApi } from "./fake-sim-api";

const SPACES = [
  { spaceId: "41", name: "데모 강의실" },
  { spaceId: "42", name: "데모 사무실" },
];
const DEVICES = [
  { deviceId: "2001", name: "TH-1" },
  { deviceId: "2002", name: "AC-1" },
];
const SAVED: Scenario = {
  scenarioId: "601",
  name: "폭염 오후",
  spaceIds: ["41"],
  simStartAt: "2026-08-12T00:00:00Z",
  durationSec: 4 * 3600,
  seed: 4711,
  useCalendar: false,
  outdoor: { mode: "DIURNAL", diurnal: { max: 35, min: 27, peakHour: 15 } },
  events: [{ id: "ev-1", track: "OCCUPANCY", at: "2026-08-12T00:00:00Z", until: "2026-08-12T01:00:00Z", target: { spaceId: "41" }, params: { count: 30 } }],
  expectations: [{ id: "ex-1", kind: "DEVICE_STATE_REACHED", target: { deviceId: "2002" }, condition: { power: "ON" }, deadline: "2026-08-12T01:00:00Z" }],
  version: 3,
};

afterEach(() => vi.restoreAllMocks());

describe("TC-SIM-042 AT-SIM-07.1 시나리오 타임라인 편집기", () => {
  it("새 시나리오: 트랙에 이벤트 추가·속성 편집, 검사 오류는 칸 옆, 저장하면 POST 후 편집 주소로", async () => {
    const api = fakeSimApi();
    const navigate = vi.fn();
    await renderRoute(<ScenarioEditor initial={emptyScenario("2026-08-12T00:00:00Z", ["41"])} spaces={SPACES} devices={DEVICES} canEdit canRun api={api} navigate={navigate} />, { session: meOf("INTEGRATOR") });
    await userEvent.click(await screen.findByRole("button", { name: "저장" }));
    expect(screen.getByText("1~80자로 입력하세요.")).toBeInTheDocument();
    expect(api.createScenario).not.toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText("이름"), "여름 강의실 과밀");
    await userEvent.click(screen.getByRole("button", { name: "재실 이벤트 추가" }));
    const occupancy = within(screen.getByRole("list", { name: "재실" })).getByRole("listitem");
    expect(occupancy).toHaveAccessibleName("30명 +0m~+60m");
    // 선택한 이벤트 속성: 인원 1,001명은 검사에서 걸린다
    const count = screen.getByLabelText("인원");
    await userEvent.clear(count);
    await userEvent.type(count, "1001");
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(screen.getByText("재실 인원은 0~1,000명입니다.")).toBeInTheDocument();
    expect(occupancy).toHaveAttribute("aria-invalid", "true");
    await userEvent.clear(count);
    await userEvent.type(count, "25");
    await userEvent.click(screen.getByRole("button", { name: "장비 조작 이벤트 추가" }));
    await userEvent.selectOptions(screen.getByLabelText("대상 기기"), "2002");
    await userEvent.click(screen.getByRole("button", { name: "+ 기기 상태 도달" }));
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(api.createScenario).toHaveBeenCalled());
    const body = api.createScenario.mock.calls[0][0] as Record<string, unknown>;
    expect(body).toMatchObject({ name: "여름 강의실 과밀", spaceIds: ["41"], durationSec: 28_800 });
    expect(body.events).toEqual([
      { id: "ev-1", track: "OCCUPANCY", at: "2026-08-12T00:00:00Z", until: "2026-08-12T01:00:00Z", target: { spaceId: "41" }, params: { count: 25 } },
      { id: "ev-2", track: "ACTUATOR", at: "2026-08-12T00:00:00Z", target: { deviceId: "2002" }, params: { capability: "Switch", command: "set", args: { on: false } } },
    ]);
    expect(navigate).toHaveBeenCalledWith("/sim/scenarios/700/edit", { replace: true });
    expect(screen.getByText("시나리오를 저장했습니다.")).toBeInTheDocument();
  });

  it("끌기: 포인터로 옮기고(1분 격자) 키보드 ←/→·Shift, Delete로 삭제", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 400, height: 32, top: 0, left: 0, right: 400, bottom: 32, x: 0, y: 0, toJSON: () => ({}) });
    await renderRoute(<ScenarioEditor initial={fromScenario(SAVED)} spaces={SPACES} devices={DEVICES} canEdit canRun api={fakeSimApi()} navigate={vi.fn()} />, { session: meOf("INTEGRATOR") });
    const bar = within(await screen.findByRole("list", { name: "재실" })).getByRole("listitem");
    expect(bar).toHaveAccessibleName("30명 +0m~+60m");
    // 400px = 4시간 → 100px = 1시간
    fireEvent.pointerDown(bar, { clientX: 10 });
    fireEvent.pointerUp(bar, { clientX: 110 });
    expect(bar).toHaveAccessibleName("30명 +60m~+120m");
    fireEvent.keyDown(bar, { key: "ArrowRight" });
    expect(bar).toHaveAccessibleName("30명 +65m~+125m");
    fireEvent.keyDown(bar, { key: "ArrowLeft", shiftKey: true });
    expect(bar).toHaveAccessibleName("30명 +65m~+120m");
    expect(screen.getByText("저장 안 된 변경")).toBeInTheDocument();
    // 저장 전에는 실행 비활성
    expect(screen.getByRole("button", { name: "실행" })).toBeDisabled();
    fireEvent.keyDown(bar, { key: "Delete" });
    expect(within(screen.getByRole("list", { name: "재실" })).queryByRole("listitem")).toBeNull();
  });

  it("저장된 시나리오: 수정 저장은 baseVersion으로, 서버 위치 오류는 해당 이벤트에, 버전 충돌 문구", async () => {
    const api = fakeSimApi({
      saveScenario: vi
        .fn()
        .mockImplementationOnce(() => failure(400, "SIM_SCENARIO_INVALID", [{ field: "events[0].at", code: "OUT_OF_RANGE", message: "공간 정원을 넘습니다" }]))
        .mockImplementationOnce(() => failure(409, "VERSION_CONFLICT")),
    });
    await renderRoute(<ScenarioEditor initial={fromScenario(SAVED)} spaces={SPACES} devices={DEVICES} canEdit canRun api={api} navigate={vi.fn()} />, { session: meOf("INTEGRATOR") });
    expect(await screen.findByLabelText("이름")).toHaveValue("폭염 오후");
    expect(screen.getByLabelText("데모 강의실")).toBeChecked();
    await userEvent.click(screen.getByLabelText("데모 사무실"));
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(api.saveScenario).toHaveBeenCalledWith("601", expect.objectContaining({ baseVersion: 3, spaceIds: ["41", "42"] })));
    expect(await screen.findByText("시나리오 설정이 올바르지 않습니다")).toBeInTheDocument();
    const bar = within(screen.getByRole("list", { name: "재실" })).getByRole("listitem");
    expect(bar).toHaveAttribute("aria-invalid", "true");
    await userEvent.click(bar);
    expect(screen.getByText("공간 정원을 넘습니다")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(await screen.findByText("다른 사용자가 먼저 수정했습니다. 새로고침 후 다시 시도해 주세요.")).toBeInTheDocument();
  });

  it("문·창문·장애 이벤트 속성, 기대 결과 편집·삭제, 외기·시드·달력, 조회 전용", async () => {
    const api = fakeSimApi();
    const { unmount } = await renderRoute(<ScenarioEditor initial={fromScenario(SAVED)} spaces={SPACES} devices={DEVICES} canEdit canRun api={api} navigate={vi.fn()} />, { session: meOf("INTEGRATOR") });
    await userEvent.click(await screen.findByRole("button", { name: "문·창문 이벤트 추가" }));
    await userEvent.selectOptions(screen.getByLabelText("종류"), "DOOR");
    await userEvent.click(screen.getByLabelText("열림"));
    await userEvent.click(screen.getByRole("button", { name: "장애 이벤트 추가" }));
    await userEvent.selectOptions(screen.getByLabelText("유형"), "DRIFT");
    const faultParams = screen.getByLabelText("강도(JSON)");
    fireEvent.change(faultParams, { target: { value: "{bad" } });
    expect(screen.getByText("JSON 객체 형식이 아닙니다.")).toBeInTheDocument();
    fireEvent.change(faultParams, { target: { value: '{"perHour":2}' } });
    expect(screen.queryByText("JSON 객체 형식이 아닙니다.")).toBeNull();
    const deadline = screen.getByLabelText("기한(시작 후 분)");
    await userEvent.clear(deadline);
    await userEvent.type(deadline, "300");
    await userEvent.click(screen.getByRole("button", { name: "+ 측정값 범위 유지" }));
    await userEvent.selectOptions(within(screen.getByRole("listitem", { name: "측정값 범위 유지" })).getByLabelText("대상 공간"), "42");
    fireEvent.change(screen.getByLabelText("외기 최고(℃)"), { target: { value: "36" } });
    fireEvent.change(screen.getByLabelText("시드"), { target: { value: "" } });
    await userEvent.click(screen.getByLabelText("달력 반영"));
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(screen.getByText("기한이 시나리오 범위를 벗어납니다.")).toBeInTheDocument();
    await userEvent.clear(deadline);
    await userEvent.type(deadline, "60");
    await userEvent.click(within(screen.getByRole("listitem", { name: "측정값 범위 유지" })).getByRole("button", { name: "삭제" }));
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(api.saveScenario).toHaveBeenCalled());
    const body = api.saveScenario.mock.calls[0][1] as { events: { track: string; params: unknown }[]; outdoor: unknown; useCalendar: boolean; seed?: number; expectations: unknown[] };
    expect(body.events.map((e) => e.track)).toEqual(["OCCUPANCY", "OPENING", "FAULT"]);
    expect(body.events[1].params).toEqual({ opening: "DOOR", open: false });
    expect(body.events[2].params).toEqual({ kind: "DRIFT", params: { perHour: 2 } });
    expect(body.outdoor).toEqual({ mode: "DIURNAL", diurnal: { max: 36, min: 27, peakHour: 15 } });
    expect(body.useCalendar).toBe(true);
    expect(body.seed).toBeUndefined();
    expect(body.expectations).toHaveLength(1);
    unmount();
    await renderRoute(<ScenarioEditor initial={fromScenario(SAVED)} spaces={SPACES} devices={DEVICES} canEdit={false} canRun={false} api={api} navigate={vi.fn()} />, { session: meOf("ANALYST") });
    expect(await screen.findByLabelText("이름")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "저장" })).toBeNull();
    expect(screen.queryByRole("button", { name: "재실 이벤트 추가" })).toBeNull();
  });

  it("실행 옵션: 가속 x60 허용·61 거부, 시드·정책 → API-SIM-14 → 실행 패널, 실패 문구", async () => {
    const api = fakeSimApi();
    const navigate = vi.fn();
    const { unmount } = await renderRoute(<ScenarioEditor initial={fromScenario(SAVED)} spaces={SPACES} devices={DEVICES} canEdit canRun api={api} navigate={navigate} />, { session: meOf("OPERATOR") });
    await userEvent.click(await screen.findByRole("button", { name: "실행" }));
    const dialog = screen.getByRole("dialog", { name: "실행 옵션" });
    const accel = within(dialog).getByLabelText("가속(x1~x60)");
    expect(accel).toHaveValue("30");
    await userEvent.clear(accel);
    await userEvent.type(accel, "61");
    expect(within(dialog).getByText("1~60 사이로 입력하세요.")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "실행" })).toBeDisabled();
    await userEvent.clear(accel);
    await userEvent.type(accel, "60");
    await userEvent.selectOptions(within(dialog).getByLabelText("측정 시각"), "WALL_CLOCK");
    await userEvent.selectOptions(within(dialog).getByLabelText("알림"), "SUPPRESS");
    await userEvent.type(within(dialog).getByLabelText("시드"), "4711");
    await userEvent.click(within(dialog).getByRole("button", { name: "실행" }));
    await waitFor(() => expect(api.startRun).toHaveBeenCalledWith({ scenarioId: "601", acceleration: 60, timestampPolicy: "WALL_CLOCK", notificationPolicy: "SUPPRESS", seed: 4711 }));
    expect(navigate).toHaveBeenCalledWith("/sim/runs/42");
    unmount();
    const onClose = vi.fn();
    await renderRoute(<RunOptionsDialog scenarioId="601" api={fakeSimApi({ startRun: vi.fn(() => failure(409, "SIM_SPACE_BUSY")) })} navigate={vi.fn()} onClose={onClose} defaultAcceleration={60} />, { session: meOf("OPERATOR") });
    await userEvent.click(await screen.findByRole("button", { name: "실행" }));
    expect(await screen.findByText("이 공간에서 이미 시나리오가 실행 중입니다")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "취소" }));
    expect(onClose).toHaveBeenCalled();
  });
});
