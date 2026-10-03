/**
 * UI-ACT-02 명령 이력(ACT-04.03) — TC-ACT-087(AT-ACT-14.1): 플로우가 보낸 명령의 출처 "플로우 고온이면 냉방 v13 · n-act-1"와 플로우 링크.
 * 거부·차단 명령도 이력에 남고, 행을 펼치면 타임라인·멱등 키, 대기 명령은 취소할 수 있다(API-ACT-02).
 */
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderRoute } from "../../../../test/render";
import { CommandHistory, HistoryFilters, SourceLabel, statusTone } from "../command-history";
import type { Command } from "../model/control";
import { fakeApi } from "./fake-live";
import { FLOW_COMMAND } from "./fixtures";

const BLOCKED: Command = {
  id: "c-2",
  status: "BLOCKED",
  statusReason: "INTERLOCK",
  message: "창문이 열려 있어 냉방을 막았습니다",
  deviceId: "2001",
  capability: "Thermostat",
  command: "set",
  args: { mode: "cool" },
  source: { type: "USER", userId: "7", userName: "김운영" },
  timeline: [{ status: "REQUESTED", at: "2026-10-03T01:10:00Z" }, { status: "BLOCKED", at: "2026-10-03T01:10:00.300Z", reason: "INTERLOCK" }],
};
const QUEUED: Command = { id: "c-3", status: "QUEUED", deviceId: "2001", capability: "Switch", command: "set", args: { on: true }, source: { type: "SCHEDULE", scheduleId: "s-1" }, createdAt: "2026-10-03T02:00:00Z", timeline: [] };
const REJECTED: Command = { id: "c-4", status: "REJECTED", statusReason: "COMMAND_ABSOLUTE_LIMIT", deviceId: "2001", capability: "Thermostat", command: "set", args: { targetTemperature: 30 }, source: null, timeline: [] };

describe("TC-ACT-087 AT-ACT-14.1 명령 이력과 출처(ACT-04.03)", () => {
  it("플로우 출처는 이름·버전·노드와 플로우 링크, 거부·차단도 사유와 함께 남는다", async () => {
    await renderRoute(<CommandHistory rows={[FLOW_COMMAND, BLOCKED, REJECTED]} showDevice canControl timezone="Asia/Seoul" lang="ko" />);
    const flow = await screen.findByRole("link", { name: "플로우 고온이면 냉방 v13 · n-act-1" });
    expect(flow).toHaveAttribute("href", "/automation/flows/f-7f3a");
    expect(screen.getByText("Thermostat.set(cool, 24)")).toBeInTheDocument();
    expect(screen.getByText("적용됨")).toBeInTheDocument();
    expect(screen.getByText("2.1s")).toBeInTheDocument();
    expect(screen.getByText("차단됨")).toBeInTheDocument();
    expect(screen.getByText("창문이 열려 있어 냉방을 막았습니다")).toBeInTheDocument();
    expect(screen.getByText("거부됨")).toBeInTheDocument();
    expect(screen.getByText("조직 절대 한계를 넘는 값이라 거부했습니다")).toBeInTheDocument();
    expect(screen.getByText("사용자 김운영")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "AC-1 실습실 에어컨" })[0]).toHaveAttribute("href", "/devices/2001?tab=commands");
  });

  it("행을 펼치면 상태 타임라인과 멱등 키", async () => {
    const user = userEvent.setup();
    await renderRoute(<CommandHistory rows={[FLOW_COMMAND, BLOCKED]} showDevice={false} canControl={false} timezone="Asia/Seoul" lang="ko" />);
    const buttons = await screen.findAllByRole("button", { name: "펼치기" });
    await user.click(buttons[0]);
    const timeline = screen.getByRole("list", { name: "상태 타임라인" });
    expect(within(timeline).getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("b3c1sha256")).toBeInTheDocument();
    expect(screen.getByText(/우선순위: AUTO/)).toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: "펼치기" })[0]);
    expect(screen.getByText(/— INTERLOCK/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "접기" }));
    expect(screen.queryByRole("list", { name: "상태 타임라인" })).not.toBeInTheDocument();
  });

  it("대기 명령 취소(API-ACT-02 cancel), 취소할 수 없으면 오류 문구, 권한 없으면 버튼 없음", async () => {
    const user = userEvent.setup();
    const api = fakeApi();
    const { unmount } = await renderRoute(<CommandHistory rows={[QUEUED, FLOW_COMMAND]} showDevice canControl timezone="Asia/Seoul" lang="ko" api={api} />);
    expect(await screen.findAllByRole("button", { name: "취소" })).toHaveLength(1);
    expect(screen.getByText("예약")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "2001" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "취소" }));
    expect(api.cancel).toHaveBeenCalledWith("c-3");
    expect(await screen.findByText("취소됨")).toBeInTheDocument();
    unmount();
    const conflict = fakeApi({ cancel: vi.fn(async () => ({ ok: false as const, status: 409, code: "COMMAND_NOT_CANCELLABLE", message: "" })) });
    await renderRoute(<CommandHistory rows={[QUEUED]} showDevice={false} canControl timezone="Asia/Seoul" lang="ko" api={conflict} />);
    await user.click(await screen.findByRole("button", { name: "취소" }));
    expect(await screen.findByText("취소할 수 없는 상태입니다")).toBeInTheDocument();
  });

  it("빈 이력·읽기 실패·더 보기", async () => {
    const { unmount } = await renderRoute(<CommandHistory rows={[]} showDevice canControl={false} timezone="Asia/Seoul" lang="ko" />);
    expect(await screen.findByText("명령 이력이 없습니다")).toBeInTheDocument();
    unmount();
    await renderRoute(<CommandHistory rows={[]} failed moreHref="?cursor=50" showDevice canControl={false} timezone="Asia/Seoul" lang="ko" />);
    expect(await screen.findByText("명령 이력을 불러오지 못했습니다")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "더 보기" })).toHaveAttribute("href", "/?cursor=50");
  });

  it("출처 표기·상태 색·필터 폼", async () => {
    await renderRoute(
      <>
        <SourceLabel source={null} />
        <SourceLabel source={{ type: "FLOW", flowId: "f-9" }} />
        <SourceLabel source={{ type: "USER", userId: "8" }} />
        <HistoryFilters hidden={{ tab: "commands" }} />
      </>,
      { url: "/?status=APPLIED" },
    );
    expect(await screen.findByRole("link", { name: /^플로우 f-9 v\?/ })).toBeInTheDocument();
    expect(screen.getByText("사용자 8")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "상태" })).toHaveValue("APPLIED");
    expect(document.querySelector('input[name="tab"]')).toHaveValue("commands");
    expect(statusTone("APPLIED")).toBe("success");
    expect(statusTone("QUEUED")).toBe("warning");
    expect(statusTone("FAILED")).toBe("danger");
    expect(statusTone("SENT")).toBe("info");
  });
});
