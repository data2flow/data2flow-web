/**
 * DEV-02.09 UI-DEV-12 일괄 작업 — TC-DEV-079: 대상 1~5,000대("한 번에 5,000대까지 실행할 수 있습니다"), 동시 작업 3개("실행 중인 작업이 끝난 뒤 다시 시도하세요"),
 * 미리 보기(dryRun) 뒤 실행, 권한(명령 전송은 DEVICE_CONTROL), 상세: 진행률·실패만 보기·실패분 다시 실행(AT-DEV-14.1·14.2)·취소, 진행 중 3초 폴링.
 */
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { renderRoute } from "../../../../test/render";
import { JobDetail, JobWizard, type DeviceJobsApi } from "../device-jobs";
import type { DeviceJob, DeviceJobItem } from "../model/jobs";

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => vi.useRealTimers());

const ok = <T,>(data: T, status = 200) => ({ ok: true as const, status, data });
const fail = (status: number, code: string) => ({ ok: false as const, status, code, message: "" });

const JOB: DeviceJob = {
  id: "42",
  type: "SET_SPACE",
  status: "PARTIALLY_FAILED",
  total: 50,
  succeeded: 48,
  failed: 2,
  progressPercent: 100,
  createdBy: { userId: "8", name: "이통합" },
  createdAt: "2026-10-03T01:00:00Z",
};
const ITEMS: DeviceJobItem[] = [
  { id: "1", deviceId: "1042", deviceName: "AM107-067999", status: "SUCCEEDED", finishedAt: "2026-10-03T01:00:30Z" },
  { id: "2", deviceId: "151777", deviceName: "EM300-TH-151777", status: "FAILED", errorCode: "DEVICE_NOT_FOUND", errorMessage: "권한 밖 공간", finishedAt: "2026-10-03T01:00:31Z" },
];

function fakeJobsApi(overrides: Partial<DeviceJobsApi> = {}) {
  return {
    create: vi.fn(async (body: { dryRun?: boolean }) =>
      body.dryRun ? ok({ ...JOB, targetCount: 2, sample: [{ deviceId: "1042", name: "AM107-067999" }], deniedCount: 1 }) : ok({ ...JOB, id: "43", status: "QUEUED" }, 201),
    ),
    job: vi.fn(async () => ok(JOB)),
    items: vi.fn(async () => ok({ responses: ITEMS })),
    retryFailed: vi.fn(async () => ok({ ...JOB, id: "44", status: "QUEUED", total: 2, retryOfJobId: "42" }, 201)),
    cancel: vi.fn(async () => ok({ ...JOB, status: "CANCELLED" })),
    ...overrides,
  } as unknown as { [K in keyof DeviceJobsApi]: DeviceJobsApi[K] & Mock<DeviceJobsApi[K]> };
}

const SPACES = [{ id: "31", name: "실습실", type: "ROOM", children: [] }] as never;

describe("TC-DEV-079 UI-DEV-12 마법사", () => {
  it("선택한 기기 2대 → 공간 이동 → 미리 보기(대상 수·권한 밖 경고) → 실행", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const api = fakeJobsApi();
    const onCreated = vi.fn();
    await renderRoute(<JobWizard deviceIds={["1042", "2001"]} groups={[]} models={[]} spaces={SPACES} canControl={false} api={api} onCreated={onCreated} />);
    expect(await screen.findByRole("option", { name: "선택한 기기 2대" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "명령 전송" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "실행" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "미리 보기" }));
    expect(screen.getByText("값을 입력하세요")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("공간"), "31");
    await user.click(screen.getByRole("button", { name: "미리 보기" }));
    expect(await screen.findByText("대상 2대 · 공간 이동")).toBeInTheDocument();
    expect(screen.getByText("권한 밖 기기 1대는 실패로 끝납니다")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "실행" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: "43" })));
    expect(api.create.mock.calls[1][0]).toEqual({ type: "SET_SPACE", target: { deviceIds: ["1042", "2001"] }, params: { spaceId: "31" }, dryRun: false });
  });

  it("5,000대 초과·대상 없음·동시 작업 3개(JOB_LIMIT_EXCEEDED), 명령 전송·태그·속성 입력 검사", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { unmount } = await renderRoute(
      <JobWizard deviceIds={Array.from({ length: 5001 }, (_, i) => String(i))} groups={[]} models={[]} spaces={SPACES} canControl api={fakeJobsApi()} onCreated={vi.fn()} />,
    );
    expect(await screen.findByText("한 번에 5,000대까지 실행할 수 있습니다")).toBeInTheDocument();
    unmount();
    const api = fakeJobsApi({ create: vi.fn(async () => fail(429, "JOB_LIMIT_EXCEEDED")) });
    await renderRoute(<JobWizard deviceIds={[]} groups={[{ id: "g1", name: "3층 센서" }]} models={[{ id: "11", name: "EM300-TH" }]} spaces={SPACES} canControl api={api} onCreated={vi.fn()} />);
    await user.click(await screen.findByRole("button", { name: "미리 보기" }));
    expect(screen.getByText("대상 기기를 고르세요")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("그룹"), "g1");
    await user.selectOptions(screen.getByLabelText("작업 유형"), "SEND_COMMAND");
    await user.clear(screen.getByLabelText("인자(JSON)"));
    await user.type(screen.getByLabelText("인자(JSON)"), "x");
    await user.click(screen.getByRole("button", { name: "미리 보기" }));
    expect(screen.getByText("JSON 객체로 입력하세요")).toBeInTheDocument();
    await user.type(screen.getByLabelText("기능"), "Switch");
    await user.clear(screen.getByLabelText("인자(JSON)"));
    await user.type(screen.getByLabelText("인자(JSON)"), "{{}");
    await user.click(screen.getByRole("button", { name: "미리 보기" }));
    expect(await screen.findByText("실행 중인 작업이 끝난 뒤 다시 시도하세요")).toBeInTheDocument();
    expect(api.create.mock.calls[0][0]).toMatchObject({ type: "SEND_COMMAND", target: { groupId: "g1" }, params: { capability: "Switch", command: "set", args: {} }, dryRun: true });
    await user.selectOptions(screen.getByLabelText("작업 유형"), "ADD_TAGS");
    await user.click(screen.getByRole("button", { name: "미리 보기" }));
    expect(screen.getByText("값을 입력하세요")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("작업 유형"), "SET_ATTRIBUTES");
    expect(screen.getByLabelText("속성 종류")).toHaveValue("SERVER");
    await user.selectOptions(screen.getByLabelText("작업 유형"), "SET_MODEL");
    await user.selectOptions(screen.getByLabelText("모델"), "11");
    await user.selectOptions(screen.getByLabelText("작업 유형"), "SET_STATUS");
    expect(screen.getByLabelText("상태")).toHaveValue("INACTIVE");
  });
});

describe("TC-DEV-079 UI-DEV-12 상세", () => {
  it("AT-DEV-14.1: 48 성공 · 2 실패, 실패만 보기, AT-DEV-14.2: 실패분 다시 실행(새 작업)", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const api = fakeJobsApi();
    const onRetried = vi.fn();
    await renderRoute(<JobDetail initial={JOB} initialItems={ITEMS} canAdmin timezone="Asia/Seoul" lang="ko" api={api} onRetried={onRetried} />);
    expect(await screen.findByText("48 성공 · 2 실패 / 50")).toBeInTheDocument();
    expect(screen.getByText("일부 실패")).toBeInTheDocument();
    expect(screen.getByText("AM107-067999")).toBeInTheDocument();
    await user.click(screen.getByLabelText("실패만 보기"));
    expect(screen.queryByText("AM107-067999")).not.toBeInTheDocument();
    expect(screen.getByText("DEVICE_NOT_FOUND")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "취소" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "실패분 다시 실행" }));
    await waitFor(() => expect(onRetried).toHaveBeenCalledWith(expect.objectContaining({ id: "44", total: 2, retryOfJobId: "42" })));
  });

  it("진행 중이면 3초마다 다시 읽고, 취소(I+)·권한 없으면 버튼 없음·재실행 오류 문구", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const running: DeviceJob = { ...JOB, id: "50", status: "RUNNING", succeeded: 10, failed: 0, progressPercent: null, retryOfJobId: "42" };
    const api = fakeJobsApi({ job: vi.fn(async () => ok({ ...running, succeeded: 30 })), items: vi.fn(async () => ok({ responses: [ITEMS[0]] })) });
    const { unmount } = await renderRoute(<JobDetail initial={running} initialItems={[]} canAdmin timezone="Asia/Seoul" lang="ko" api={api} onRetried={vi.fn()} />);
    expect(await screen.findByText("10 성공 · 0 실패 / 50")).toBeInTheDocument();
    expect(screen.getByText("#42의 실패분 재실행")).toBeInTheDocument();
    expect(screen.getByText("표시할 기기가 없습니다")).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(await screen.findByText("30 성공 · 0 실패 / 50")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "취소" }));
    expect(api.cancel).toHaveBeenCalledWith("50");
    unmount();
    const failing = fakeJobsApi({ retryFailed: vi.fn(async () => fail(429, "JOB_LIMIT_EXCEEDED")) });
    const { unmount: u2 } = await renderRoute(<JobDetail initial={JOB} initialItems={ITEMS} canAdmin timezone="Asia/Seoul" lang="ko" api={failing} onRetried={vi.fn()} />);
    await user.click(await screen.findByRole("button", { name: "실패분 다시 실행" }));
    expect(await screen.findByText("실행 중인 작업이 끝난 뒤 다시 시도하세요")).toBeInTheDocument();
    u2();
    await renderRoute(<JobDetail initial={JOB} initialItems={ITEMS} canAdmin={false} timezone="Asia/Seoul" lang="ko" api={failing} onRetried={vi.fn()} />);
    await screen.findByText("48 성공 · 2 실패 / 50");
    expect(screen.queryByRole("button", { name: "실패분 다시 실행" })).not.toBeInTheDocument();
  });
});
