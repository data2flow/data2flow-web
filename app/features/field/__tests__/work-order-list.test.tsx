/**
 * DEV-08.02·08.06 UI-DEV-13 작업 지시 목록·생성 대화상자 — TC-DEV-213·237: 제목 1~150, 대상 1개 이상, 마감은 현재 이후,
 * 보기 탭 개수, 통계(평균 처리 시간), 마감 임박·지연 강조, 모바일 카드. DEV-08.05 계획 탭(주기 7~1,095일, baseVersion).
 */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderRoute } from "../../../../test/render";
import { PlanManager } from "../components/plans";
import { CreateWorkOrderDialog, NewWorkOrderButton, SpaceFilter, WorkOrderStats, WorkOrderTable, WorkOrderViewTabs } from "../components/work-order-list";
import type { MaintenancePlan, WorkOrder } from "../model/work-orders";
import { fail, fakeFieldApi, ok, order } from "./helpers";

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => vi.useRealTimers());

const NOW = Date.parse("2026-10-04T00:00:00Z");
const SPACES = [{ id: "1", name: "광주캠퍼스", type: "SITE", children: [{ id: "31", name: "실습실", type: "ROOM", children: [] }] }] as never;
const DEVICES = [
  { id: "1042", name: "AM107-067999" },
  { id: "1050", name: "EM300-TH-151606" },
];

describe("TC-DEV-237 목록", () => {
  it("보기 탭(마감 임박·지연 개수)·통계·표, 지연은 붉게, 마감 임박은 주황", async () => {
    const orders: WorkOrder[] = [order({ id: "1", dueAt: "2026-10-03T00:00:00Z", status: "OPEN" }), order({ id: "2", title: "교정", dueAt: "2026-10-05T00:00:00Z", targets: [{ deviceId: "1042" }, { deviceId: "1050" }], assigneeId: null, origin: null }), order({ id: "3", title: "공간 점검", dueAt: null, targets: [{ spaceId: "31" }] })];
    await renderRoute(
      <>
        <WorkOrderViewTabs view="overdue" counts={{ dueSoon: 1, overdue: 0 }} base="/work-orders" spaceId="31" />
        <WorkOrderStats counts={{ open: 3, overdue: 1 }} avgLeadTimeHours={6.25} lang="ko" />
        <WorkOrderTable orders={orders} timezone="Asia/Seoul" nowMs={NOW} deviceNames={{ "1042": "AM107-067999" }} />
      </>,
    );
    expect(await screen.findByRole("link", { name: "지연 (0)" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "마감 임박 (1)" })).toHaveAttribute("href", "/work-orders?view=dueSoon&spaceId=31");
    expect(screen.getByTestId("work-order-stats")).toHaveTextContent("열린 3 · 지연 1 · 평균 처리 6.3시간");
    const rows = screen.getAllByRole("row");
    expect(within(rows[1]).getByText(/지연/).className).toContain("text-bad-ink");
    expect(within(rows[1]).getByText("AM107-067999")).toBeInTheDocument();
    expect(within(rows[2]).getByText("기기 2대")).toBeInTheDocument();
    expect(within(rows[2]).getByText("미배정")).toBeInTheDocument();
    expect(within(rows[2]).getByText(/2026/).className).toContain("text-fair-ink");
    expect(within(rows[3]).getByText("공간 1곳")).toBeInTheDocument();
  });

  it("모바일 카드 목록·빈 목록, 통계 없음은 –", async () => {
    await renderRoute(
      <>
        <WorkOrderTable compact base="/m/work-orders" orders={[order()]} timezone="Asia/Seoul" nowMs={NOW} />
        <WorkOrderTable orders={[]} timezone="Asia/Seoul" nowMs={NOW} emptyText="나에게 배정된 열린 작업이 없습니다" />
        <WorkOrderStats counts={{}} lang="ko" />
      </>,
    );
    const card = await screen.findByRole("link", { name: /실습실 EM300 배터리 교체/ });
    expect(card).toHaveAttribute("href", "/m/work-orders/1042");
    expect(card.className).toContain("min-h-11");
    expect(screen.getByText("나에게 배정된 열린 작업이 없습니다")).toBeInTheDocument();
    expect(screen.getByTestId("work-order-stats")).toHaveTextContent("열린 – · 지연 – · 평균 처리 –시간");
  });

  it("공간 필터는 하위 공간까지 고를 수 있다", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await renderRoute(<SpaceFilter spaces={SPACES} value="" onChange={onChange} />);
    await user.selectOptions(await screen.findByLabelText("공간(하위 포함)"), "31");
    expect(onChange).toHaveBeenCalledWith("31");
  });
});

describe("TC-DEV-213 새 작업 지시", () => {
  it("입력 검증: 제목·대상·마감(현재 이후) → 통과하면 API-DEV-90(멱등 키), 기존 연결이면 onCreated에 linkedToExisting", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const api = fakeFieldApi({ createWorkOrder: async () => ok({ ...order({ id: "2001" }), linkedToExisting: true }) });
    const onCreated = vi.fn();
    await renderRoute(<CreateWorkOrderDialog open onClose={vi.fn()} devices={DEVICES} spaces={SPACES} meId="7" api={api} now={() => NOW} onCreated={onCreated} />);
    const dialog = await screen.findByRole("dialog", { name: "새 작업 지시" });
    await user.click(within(dialog).getByRole("button", { name: "만들기" }));
    expect(within(dialog).getByText("제목을 입력하세요")).toBeInTheDocument();
    expect(within(dialog).getByText("대상을 1개 이상 고르세요")).toBeInTheDocument();
    expect(api.createWorkOrder).not.toHaveBeenCalled();

    await user.type(within(dialog).getByLabelText("제목"), "배터리 교체");
    await user.type(within(dialog).getByLabelText("기기 이름으로 찾기"), "AM107");
    expect(within(dialog).queryByLabelText("EM300-TH-151606")).not.toBeInTheDocument();
    await user.click(within(dialog).getByLabelText("AM107-067999"));
    await user.selectOptions(within(dialog).getByLabelText("유형"), "BATTERY");
    await user.selectOptions(within(dialog).getByLabelText("담당자"), "7");
    await user.type(within(dialog).getByLabelText("마감"), "2026-10-01T09:00");
    await user.click(within(dialog).getByRole("button", { name: "만들기" }));
    expect(within(dialog).getByText("마감은 현재 이후여야 합니다")).toBeInTheDocument();
    await user.clear(within(dialog).getByLabelText("마감"));
    await user.type(within(dialog).getByLabelText(/체크리스트/), "분리{enter}장착");
    expect(within(dialog).getByLabelText("체크리스트(한 줄에 하나, 2개)")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "만들기" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: "2001", linkedToExisting: true })));
    expect(api.createWorkOrder).toHaveBeenCalledWith(expect.objectContaining({ title: "배터리 교체", type: "BATTERY", targets: [{ deviceId: "1042" }], assigneeId: "7", checklist: ["분리", "장착"] }), expect.any(String));
  });

  it("제목 150자 초과·서버 오류, 공간 대상, 버튼으로 열고 닫기", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const api = fakeFieldApi({ createWorkOrder: async () => fail(403, "PERMISSION_DENIED") });
    await renderRoute(<NewWorkOrderButton devices={[]} spaces={SPACES} api={api} now={() => NOW} onCreated={vi.fn()} />);
    await user.click(await screen.findByRole("button", { name: "+ 새 작업 지시" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("맞는 기기가 없습니다")).toBeInTheDocument();
    await user.click(within(dialog).getByLabelText("제목"));
    await user.paste("가".repeat(151));
    await user.selectOptions(within(dialog).getByLabelText("공간"), "31");
    await user.click(within(dialog).getByRole("button", { name: "만들기" }));
    expect(within(dialog).getByText("제목은 150자 이하입니다")).toBeInTheDocument();
    await user.clear(within(dialog).getByLabelText("제목"));
    await user.type(within(dialog).getByLabelText("제목"), "점검");
    await user.click(within(dialog).getByRole("button", { name: "만들기" }));
    expect(await within(dialog).findByRole("alert")).toBeInTheDocument();
    expect(api.createWorkOrder).toHaveBeenCalledWith(expect.objectContaining({ targets: [{ spaceId: "31" }] }), expect.any(String));
    await user.click(within(dialog).getByRole("button", { name: "취소" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

const PLAN: MaintenancePlan = { id: "5", name: "배터리 반기 점검", targetGroupId: "61", workType: "INSPECTION", intervalDays: 180, leadDays: 7, nextDueOn: "2026-12-01", checklistTemplate: ["외관"], enabled: true, version: 3 };

describe("DEV-08.05 정기 점검 계획", () => {
  it("TC-DEV-213: 주기 7~1,095일 검증 → 새 계획 저장, 수정은 baseVersion, 충돌·삭제", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const api = fakeFieldApi({ updatePlan: async () => fail(409, "VERSION_CONFLICT") });
    await renderRoute(<PlanManager initial={[PLAN]} groups={[{ id: "61", name: "실습실 센서" }]} canManage api={api} today="2026-10-04" />);
    expect(await screen.findByText("180일마다(마감 7일 전 생성)")).toBeInTheDocument();
    expect(screen.getByText("실습실 센서")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "새 계획" }));
    await user.type(screen.getByLabelText("이름"), "분기 점검");
    await user.clear(screen.getByLabelText("주기(일)"));
    await user.type(screen.getByLabelText("주기(일)"), "6");
    await user.click(screen.getByRole("button", { name: "저장" }));
    expect(screen.getByText("주기는 7~1095일입니다")).toBeInTheDocument();
    await user.clear(screen.getByLabelText("주기(일)"));
    await user.type(screen.getByLabelText("주기(일)"), "90");
    await user.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(api.createPlan).toHaveBeenCalledWith(expect.objectContaining({ name: "분기 점검", targetGroupId: "61", intervalDays: 90, leadDays: 7, nextDueOn: "2026-10-04" })));
    expect(await screen.findByText("분기 점검")).toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { name: "편집" })[0]);
    await user.click(screen.getByLabelText("사용"));
    await user.click(screen.getByRole("button", { name: "저장" }));
    expect(api.updatePlan).toHaveBeenCalledWith("5", expect.objectContaining({ enabled: false, baseVersion: 3 }));
    expect(await screen.findByText("다른 사람이 먼저 고쳤습니다. 새로 고친 뒤 다시 저장하세요")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "취소" }));
    await user.click(screen.getByRole("button", { name: "배터리 반기 점검 삭제" }));
    expect(await screen.findByText("계획을 삭제했습니다")).toBeInTheDocument();
  });

  it("수정 성공은 목록을 바꾸고, 관리 권한이 없으면 편집 버튼이 없다, 삭제 실패 안내", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const api = fakeFieldApi({ deletePlan: async () => fail(404, "RESOURCE_NOT_FOUND") });
    const { unmount } = await renderRoute(<PlanManager initial={[PLAN]} groups={[]} canManage api={api} today="2026-10-04" />);
    await user.click(await screen.findByRole("button", { name: "편집" }));
    await user.clear(screen.getByLabelText("이름"));
    await user.type(screen.getByLabelText("이름"), "반기 점검 v2");
    await user.click(screen.getByRole("button", { name: "저장" }));
    expect(await screen.findByText("반기 점검 v2")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "반기 점검 v2 삭제" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    unmount();
    await renderRoute(<PlanManager initial={[]} groups={[]} canManage={false} api={api} today="2026-10-04" />);
    expect(await screen.findByText("정기 점검 계획이 없습니다")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "새 계획" })).not.toBeInTheDocument();
  });
});
