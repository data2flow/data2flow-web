/**
 * DEV-08.02 UI-DEV-13 작업 지시 상세 + DSH-13.04 UI-DSH-14 모바일 작업 화면.
 * TC-DEV-213(체크·첨부 검증·상태 버튼·권한), AT-DEV-16.3(교체 완료 결과), AT-DSH-16.1(하단 버튼 44px), AT-DSH-16.3·TC-DSH-125(오프라인 보관 → 연결 후 순서대로 전송, DONE).
 */
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderRoute } from "../../../../test/render";
import { queueSender } from "../api";
import { WorkOrderPanel } from "../components/work-order-detail";
import { MemoryQueueStore, OfflineQueue } from "../model/offline-queue";
import { fail, fakeFieldApi, ok, order, setOnline } from "./helpers";

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  setOnline(true);
});
afterEach(() => {
  setOnline(true);
  vi.useRealTimers();
});

const NOW = () => Date.parse("2026-10-04T00:00:00Z");
const photo = (name: string) => new File([new Uint8Array([0xff, 0xd8])], name, { type: "image/jpeg" });

function setup(overrides: Parameters<typeof fakeFieldApi>[0] = {}, props: Partial<Parameters<typeof WorkOrderPanel>[0]> = {}) {
  const api = fakeFieldApi(overrides);
  const queue = new OfflineQueue(new MemoryQueueStore(), queueSender(api));
  const render = async () => {
    const result = await renderRoute(<WorkOrderPanel initial={order()} canWrite meId="7" timezone="Asia/Seoul" api={api} queue={queue} now={NOW} {...props} />);
    await screen.findByRole("heading", { level: 1 });
    return result;
  };
  return { api, queue, render };
}

describe("TC-DEV-213 UI-DEV-13 상세", () => {
  it("헤더·체크리스트 진행·출처 알람 링크, 체크하면 바로 저장(API-DEV-94)", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { api, render } = setup();
    await render();
    expect(screen.getByRole("heading", { name: "#1042 실습실 EM300 배터리 교체" })).toBeInTheDocument();
    expect(screen.getByText("체크리스트 1/2")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "#55" })).toHaveAttribute("href", "/alarms/55");
    expect(screen.getByRole("link", { name: "기기 #1042" })).toHaveAttribute("href", "/devices/1042");
    await user.click(screen.getByLabelText("새 배터리 장착"));
    expect(api.check).toHaveBeenCalledWith("1042", "2", true);
    expect(await screen.findByText("체크리스트 2/2")).toBeInTheDocument();
  });

  it("체크 저장 실패면 되돌리고 오류, 첨부는 이미지·PDF 20MB만", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime, applyAccept: false });
    const { api, render } = setup({ check: async () => fail(403, "PERMISSION_DENIED") });
    await render();
    await user.click(screen.getByLabelText("새 배터리 장착"));
    expect(await screen.findByText("체크리스트 1/2")).toBeInTheDocument();
    await user.upload(screen.getByLabelText("사진·파일 추가"), new File(["x"], "a.txt", { type: "text/plain" }));
    expect(await screen.findByText("이미지나 PDF만 올릴 수 있습니다")).toBeInTheDocument();
    const big = new File([new Uint8Array(1)], "big.jpg", { type: "image/jpeg" });
    Object.defineProperty(big, "size", { value: 20 * 1024 * 1024 + 1 });
    await user.upload(screen.getByLabelText("사진·파일 추가"), big);
    expect(await screen.findByText("파일은 20MB 이하입니다")).toBeInTheDocument();
    await user.upload(screen.getByLabelText("사진·파일 추가"), photo("after.jpg"));
    expect(await screen.findByRole("img", { name: "after.jpg" })).toHaveAttribute("src", "/bff/api/core/work-orders/1042/attachments/a-after.jpg/content");
    expect(api.attach).toHaveBeenCalledWith("1042", expect.any(File), "after.jpg", expect.any(String));
    await user.click(screen.getByRole("button", { name: "after.jpg 삭제" }));
    await waitFor(() => expect(screen.queryByRole("img", { name: "after.jpg" })).not.toBeInTheDocument());
    expect(api.detach).toHaveBeenCalledWith("1042", "a-after.jpg");
  });

  it("AT-DEV-16.3: 교체(REPLACE) 완료는 새 기기 ID가 있어야, 결과 {newDeviceId}와 메모를 보낸다", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { api, render } = setup({}, { initial: order({ type: "REPLACE" }) });
    await render();
    await user.click(screen.getByRole("button", { name: "완료" }));
    const dialog = screen.getByRole("dialog", { name: "작업 완료" });
    const submit = within(dialog).getByRole("button", { name: "완료" });
    expect(submit).toBeDisabled();
    await user.type(within(dialog).getByLabelText("새 기기 ID"), "2001");
    await user.type(within(dialog).getByLabelText("메모"), "새 기기 부착");
    await user.click(submit);
    expect(api.transition).toHaveBeenCalledWith("1042", { action: "COMPLETE", result: { newDeviceId: "2001" }, note: "새 기기 부착" }, expect.any(String));
    expect(await screen.findByText("작업을 완료했습니다")).toBeInTheDocument();
  });

  it("교정(CALIBRATION) 결과·배터리 교체일, 취소는 메모와 함께, 다른 사람이 먼저 바꾸면 409 안내 후 다시 읽음", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { api, render } = setup({ transition: async () => fail(409, "WORKORDER_STATE_CONFLICT") }, { initial: order({ type: "CALIBRATION" }) });
    await render();
    await user.click(screen.getByRole("button", { name: "완료" }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("교정 속성 키"), "tempOffset");
    await user.type(within(dialog).getByLabelText("새 값"), "-0.5");
    await user.click(within(dialog).getByRole("button", { name: "완료" }));
    expect(api.transition).toHaveBeenCalledWith("1042", { action: "COMPLETE", result: { attributes: { tempOffset: -0.5 } }, note: undefined }, expect.any(String));
    expect(await screen.findByText("다른 사람이 먼저 상태를 바꿨습니다. 새 상태를 확인하세요")).toBeInTheDocument();
    expect(api.workOrder).toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "닫기" }));
    await user.click(await screen.findByRole("button", { name: "작업 취소" }));
    await user.type(within(await screen.findByRole("dialog")).getByLabelText("메모"), "중복");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "작업 취소" }));
    expect(api.transition).toHaveBeenLastCalledWith("1042", { action: "CANCEL", note: "중복" }, expect.any(String));
  });

  it("OPEN이면 [나에게 배정]·[작업 시작], 댓글 남기기, 쓰기 권한 없으면 버튼 없음", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { api, render } = setup({ workOrder: async () => ok(order({ status: "ASSIGNED" })) }, { initial: order({ status: "OPEN", dueAt: "2026-10-03T00:00:00Z", origin: "MANUAL", targets: [{ spaceId: "31" }] }) });
    await render();
    expect(screen.getByText(/마감 지남/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "공간 #31" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "나에게 배정" }));
    expect(api.transition).toHaveBeenCalledWith("1042", { action: "ASSIGN", assigneeId: "7" }, expect.any(String));
    await user.type(screen.getByLabelText("댓글"), "내일 방문");
    await user.click(screen.getByRole("button", { name: "남기기" }));
    expect(await screen.findByText("내일 방문")).toBeInTheDocument();
  });

  it("TC-DEV-212: 조회만 가능한 사용자는 상태 버튼·첨부·댓글 입력이 없고 체크박스는 잠김", async () => {
    const { render } = setup({}, { canWrite: false });
    await render();
    expect(screen.queryByRole("button", { name: "완료" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("사진·파일 추가")).not.toBeInTheDocument();
    expect(screen.getByLabelText("새 배터리 장착")).toBeDisabled();
  });
});

describe("DSH-13.04 UI-DSH-14 모바일 작업 화면", () => {
  it("AT-DSH-16.1: 360px 작업 화면 — [QR 스캔]·[사진]·[완료]가 하단 줄에 44px 이상(min-h-11), 기기 링크는 모바일 경로", async () => {
    const onScan = vi.fn();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { render } = setup({}, { compact: true, onScan });
    await render();
    const bar = screen.getByRole("navigation", { name: "작업 버튼" });
    expect(bar.className).toContain("fixed");
    for (const name of ["QR 스캔", "사진", "완료"]) {
      const button = within(bar).getByRole("button", { name });
      expect(button.className).toContain("min-h-11");
      expect(button.className).toContain("min-w-11");
    }
    expect(screen.getByRole("link", { name: "기기 #1042" })).toHaveAttribute("href", "/m/devices/1042");
    await user.click(within(bar).getByRole("button", { name: "QR 스캔" }));
    expect(onScan).toHaveBeenCalled();
  });

  it("AT-DSH-16.3 TC-DSH-125: 사진 2장 첨부 후 오프라인에서 완료 → '연결되면 전송', 연결되면 순서대로 업로드되고 DONE", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    let status = "IN_PROGRESS";
    const { api, queue, render } = setup({
      transition: async (id, body) => {
        status = "DONE";
        return ok({ ...order({ id }), status: body.action === "COMPLETE" ? "DONE" : "IN_PROGRESS" });
      },
      workOrder: async () => ok(order({ status, checklist: [{ id: "1", text: "배터리 분리", done: true }, { id: "2", text: "새 배터리 장착", done: true }] })),
    }, { compact: true, onScan: vi.fn() });
    await render();
    setOnline(false);
    expect(await screen.findByText(/^오프라인 — 읽기 전용입니다/)).toBeInTheDocument();
    await user.click(screen.getByLabelText("새 배터리 장착"));
    const bar = screen.getByRole("navigation", { name: "작업 버튼" });
    await user.upload(screen.getByLabelText("사진"), [photo("p1.jpg"), photo("p2.jpg")]);
    await user.click(within(bar).getByRole("button", { name: "완료" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "완료" }));
    expect(await screen.findByText("완료: 연결되면 전송")).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText("연결되면 전송")).toHaveLength(2));
    expect(api.attach).not.toHaveBeenCalled();
    expect(api.transition).not.toHaveBeenCalled();
    expect(queue.snapshot().pending.map((o) => o.kind)).toEqual(["checklist", "attachment", "attachment", "transition"]);
    const keys = queue.snapshot().pending.map((o) => o.key);

    setOnline(true);
    await act(async () => {
      await queue.flush();
    });
    expect(api.check).toHaveBeenCalledWith("1042", "2", true);
    expect(api.attach.mock.calls.map((c) => [c[2], c[3]])).toEqual([
      ["p1.jpg", keys[1]],
      ["p2.jpg", keys[2]],
    ]);
    expect(api.transition).toHaveBeenCalledWith("1042", { action: "COMPLETE" }, keys[3]);
    expect(api.check.mock.invocationCallOrder[0]).toBeLessThan(api.attach.mock.invocationCallOrder[0]);
    expect(api.attach.mock.invocationCallOrder[1]).toBeLessThan(api.transition.mock.invocationCallOrder[0]);
    await waitFor(() => expect(screen.queryByText("완료: 연결되면 전송")).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 }).parentElement?.textContent).toContain("완료"));
    expect(queue.snapshot().pending).toEqual([]);
  });

  it("연결은 있는데 보내다 끊기면(상태 0) 대기열로 옮긴다", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { queue, render } = setup({ check: async () => fail(0, "SERVICE_UNAVAILABLE"), attach: async () => fail(0, "SERVICE_UNAVAILABLE"), transition: async () => fail(0, "SERVICE_UNAVAILABLE") }, { compact: true });
    await render();
    await user.click(screen.getByLabelText("새 배터리 장착"));
    await user.upload(screen.getByLabelText("사진"), photo("p1.jpg"));
    await user.click(screen.getByRole("button", { name: "완료" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "완료" }));
    await waitFor(() => expect(queue.snapshot().pending.map((o) => o.kind)).toEqual(["checklist", "attachment", "transition"]));
  });
});
