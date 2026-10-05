/**
 * ACT-04.02 명령 결과 실시간 표시 — TC-ACT-085(AT-ACT-01.6): 명령 상태 SSE 순서 REQUESTED→SENT→ACKED→APPLIED에 따라 진행 표시가 바뀌고,
 * TIMEOUT이면 "기기가 응답하지 않습니다", REJECTED는 사유 문구(인터락 message)를 보여 준다.
 */
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderRoute } from "../../../../test/render";
import { CommandProgress, DeviceControlPanel } from "../control-panel";
import { FakeES, fakeApi, live } from "./fake-live";
import { aircon } from "./fixtures";

beforeEach(() => {
  FakeES.all = [];
});

async function applyCooling(api = fakeApi()) {
  const user = userEvent.setup();
  await renderRoute(<DeviceControlPanel deviceId="2001" spaceId="31" initial={aircon()} canControl timezone="Asia/Seoul" lang="ko" api={api} live={live} />);
  const input = await screen.findByRole("spinbutton", { name: "Thermostat 목표 온도" });
  await user.clear(input);
  await user.type(input, "24");
  await user.click(screen.getAllByRole("button", { name: "적용" })[1]);
  await screen.findByRole("status", { name: "명령 상태: 요청됨" });
  return { api, es: FakeES.all[0] };
}

const steps = () =>
  screen
    .getByRole("status", { name: /^명령 상태/ })
    .querySelectorAll("span.text-good-ink").length;

describe("TC-ACT-085 AT-ACT-01.6 명령 상태 실시간 표시(ACT-04.02)", () => {
  it("REQUESTED→SENT→ACKED→APPLIED 순서로 진행, 뒤늦은 SENT는 무시, APPLIED면 섀도를 다시 읽는다(가상 에어컨 냉방 24℃)", async () => {
    const { api, es } = await applyCooling();
    expect(steps()).toBe(1);
    act(() => es.emit("command-status", { commandId: "c-new", status: "SENT" }));
    expect(await screen.findByRole("status", { name: "명령 상태: 전송됨" })).toBeInTheDocument();
    expect(steps()).toBe(2);
    act(() => es.emit("command-status", { commandId: "c-new", status: "ACKED" }));
    act(() => es.emit("command-status", { commandId: "c-new", status: "SENT" }));
    expect(await screen.findByRole("status", { name: "명령 상태: 응답받음" })).toBeInTheDocument();
    act(() => es.emit("command-status", { commandId: "c-new", status: "APPLIED" }));
    expect(await screen.findByRole("status", { name: "명령 상태: 적용됨" })).toBeInTheDocument();
    expect(steps()).toBe(4);
    await waitFor(() => expect(api.shadow).toHaveBeenCalledWith("2001"));
    expect(api.commandDetail).not.toHaveBeenCalled();
  });

  it("TIMEOUT → '기기가 응답하지 않습니다'", async () => {
    const { es } = await applyCooling();
    act(() => es.emit("command-status", { commandId: "c-new", deviceId: "2001", capability: "Thermostat", command: "set", status: "TIMEOUT", reason: "TIMEOUT_ACK" }));
    expect(await screen.findByText(/기기가 응답하지 않습니다/)).toBeInTheDocument();
  });

  it("REJECTED·BLOCKED 사유는 이벤트의 message(차단 사유 문구)를 바로 쓴다", async () => {
    const api = fakeApi();
    const { es } = await applyCooling(api);
    act(() => es.emit("command-status", { commandId: "c-new", deviceId: "2001", capability: "Thermostat", command: "set", status: "BLOCKED", reason: "INTERLOCK", message: "창문이 열려 있어 냉방을 막았습니다" }));
    expect(await screen.findByText("차단됨 — 창문이 열려 있어 냉방을 막았습니다")).toBeInTheDocument();
    expect(api.commandDetail).not.toHaveBeenCalled();
  });

  it("REJECTED·BLOCKED는 사유: 이벤트의 오류 코드 문구, 사유가 없으면 명령 상세(API-ACT-02)의 인터락 message", async () => {
    const api = fakeApi({ commandDetail: vi.fn(async (id: string) => ({ ok: true as const, status: 200, data: { id, status: "BLOCKED", deviceId: "2001", capability: "Thermostat", command: "set", message: "창문이 열려 있어 냉방을 막았습니다" } })) });
    const { es } = await applyCooling(api);
    act(() => es.emit("command-status", { commandId: "c-new", status: "BLOCKED" }));
    expect(await screen.findByText("차단됨 — 창문이 열려 있어 냉방을 막았습니다")).toBeInTheDocument();
    expect(api.commandDetail).toHaveBeenCalledWith("c-new");
  });

  it("다른 출처(플로우) 명령은 이벤트의 capability·source(flowName)로 바로 칩에 표시", async () => {
    const api = fakeApi();
    await renderRoute(<DeviceControlPanel deviceId="2001" initial={aircon()} canControl timezone="Asia/Seoul" lang="ko" api={api} live={live} />);
    await screen.findAllByText("원하는 상태 = 실제 상태");
    act(() =>
      FakeES.all[0].emit("command-status", {
        commandId: "c-flow2",
        deviceId: "2001",
        capability: "Switch",
        command: "set",
        status: "SENT",
        source: { type: "FLOW", flowId: "f-7f3a", flowName: "고온이면 냉방", flowVersion: 14, nodeId: "n-act00001" },
        at: "2026-10-04T00:00:07Z",
      }),
    );
    expect(await screen.findByRole("status", { name: "명령 상태: 전송됨" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "플로우 고온이면 냉방 v14 · n-act00001" })).toHaveAttribute("href", "/automation/flows/f-7f3a");
    expect(api.commandDetail).not.toHaveBeenCalled();
    // 다른 기기의 명령 이벤트는 무시
    act(() => FakeES.all[0].emit("command-status", { commandId: "c-other", deviceId: "9999", capability: "Thermostat", status: "SENT" }));
    expect(screen.getAllByRole("status", { name: "명령 상태: 전송됨" })).toHaveLength(1);
  });

  it("기능 이름이 없는 이벤트는 상세를 읽어 해당 기능 칩에 표시, 형식이 틀린 이벤트는 무시", async () => {
    const api = fakeApi({ commandDetail: vi.fn(async (id: string) => ({ ok: true as const, status: 200, data: { id, status: "SENT", deviceId: "2001", capability: "Switch", command: "set" } })) });
    await renderRoute(<DeviceControlPanel deviceId="2001" initial={aircon()} canControl timezone="Asia/Seoul" lang="ko" api={api} live={live} />);
    await screen.findAllByText("원하는 상태 = 실제 상태");
    expect(FakeES.all[0].url).toBe(`/bff/stream/live?topics=${encodeURIComponent("commands:2001")}`);
    act(() => FakeES.all[0].emit("command-status", { status: "SENT" }));
    act(() => FakeES.all[0].emit("command-status", { commandId: "c-flow", status: "SENT" }));
    expect(await screen.findByRole("status", { name: "명령 상태: 전송됨" })).toBeInTheDocument();
    expect(api.commandDetail).toHaveBeenCalledWith("c-flow");
  });

  it("진행 칩: 대기열·오류 코드 문구·알 수 없는 사유", async () => {
    await renderRoute(
      <>
        <CommandProgress command={{ status: "QUEUED" }} />
        <CommandProgress command={{ status: "REJECTED", reason: "COMMAND_ABSOLUTE_LIMIT" }} />
        <CommandProgress command={{ status: "FAILED", reason: "DRIVER_ERROR_X" }} />
        <CommandProgress command={{ status: "CANCELLED" }} />
      </>,
    );
    expect(await screen.findByText("대기열")).toBeInTheDocument();
    expect(screen.getByText("거부됨 — 조직 절대 한계를 넘는 값이라 거부했습니다")).toBeInTheDocument();
    expect(screen.getByText("실패 — DRIVER_ERROR_X")).toBeInTheDocument();
    expect(screen.getByText("취소됨")).toBeInTheDocument();
  });

  it("처음부터 진행 중이던 명령(pending)도 칩으로 보이고 '적용 대기'", async () => {
    const info = aircon({ pending: [{ commandId: "c-old", capability: "Switch", command: "set", status: "SENT" }] });
    info.shadow = { ...info.shadow!, desired: { ...info.shadow!.desired!, Switch: { on: false } } };
    await renderRoute(<DeviceControlPanel deviceId="2001" initial={info} canControl timezone="Asia/Seoul" lang="ko" api={fakeApi()} live={live} />);
    expect(await screen.findByRole("status", { name: "명령 상태: 전송됨" })).toBeInTheDocument();
    expect(screen.getByText("적용 대기")).toBeInTheDocument();
  });
});
