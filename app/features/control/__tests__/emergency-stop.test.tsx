/**
 * ACT-06.03 UI-ACT-07 자동화 비상 정지 — TC-ACT-105(AT-ACT-09.3: OPERATOR는 해제 못 함), TC-ACT-107(AT-ACT-09.4: 다른 사용자 화면에 5초 안에 띠),
 * 실행 대화상자 검증(범위·사유 1~200자·확인 입력 "정지"), 유지보수 띠(00-navigation §1.3).
 */
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderRoute } from "../../../../test/render";
import { BAND_POLL_MS, EmergencyStopButton, GlobalBands, MAX_NOTICES } from "../emergency-stop";
import { STOP, err, fakeAdminApi, ok } from "./fake-admin";
import { FakeES, live } from "./fake-live";

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => vi.useRealTimers());

const SPACES = [{ id: "1", name: "광주캠퍼스", type: "SITE", children: [{ id: "2", name: "본관", type: "BUILDING", children: [] }] }] as never;

describe("TC-ACT-107 AT-ACT-09.4 전역 띠", () => {
  it("다른 사용자가 실행한 비상 정지가 실시간 emergency-stop 이벤트로 바로 붉은 띠가 되고, 목록을 다시 읽어 실행자를 채운다", async () => {
    FakeES.all = [];
    const api = fakeAdminApi();
    await renderRoute(
      <>
        <p>본문</p>
        <GlobalBands initialStops={[]} initialMaintenance={[]} canRelease={false} canEndMaintenance={false} timezone="Asia/Seoul" lang="ko" api={api} pollMs={null} streamOptions={live} />
      </>,
    );
    await screen.findByText("본문");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await waitFor(() => expect(FakeES.all).toHaveLength(1));
    const es = FakeES.all[0];
    // 비상 정지는 토픽과 상관없이 모든 연결에 온다. 본인 웹 알림 토픽 하나로 연결한다
    expect(es.url).toBe("/bff/stream/live?topics=notifications");
    api.activeEmergencyStops.mockResolvedValue(ok({ responses: [STOP] }));
    act(() => es.emit("emergency-stop", { id: 9, state: "STARTED", scope: { type: "ORG" }, reason: "냉방 오작동 점검", at: "2026-10-04T01:20:00Z" }));
    expect(screen.getByRole("alert")).toHaveTextContent("자동화 비상 정지 중 — 조직 전체");
    expect(screen.getByRole("alert")).toHaveTextContent("냉방 오작동 점검");
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("김운영"));
    expect(api.activeEmergencyStops).toHaveBeenCalledTimes(1);
    act(() => es.emit("emergency-stop", { id: "9", state: "RELEASED", scope: { type: "ORG" }, reason: "냉방 오작동 점검", at: "2026-10-04T02:00:00Z" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("공간 범위 시작 이벤트(숫자 spaceId)는 공간 이름으로, 다시 연결되면 놓친 변화를 목록으로 맞춘다", async () => {
    FakeES.all = [];
    const api = fakeAdminApi({ activeEmergencyStops: vi.fn(async () => ok({ responses: [] })) });
    await renderRoute(<GlobalBands initialStops={[]} initialMaintenance={[]} spaces={SPACES} canRelease={false} canEndMaintenance={false} timezone="Asia/Seoul" lang="ko" api={api} pollMs={null} streamOptions={live} />);
    await waitFor(() => expect(FakeES.all).toHaveLength(1));
    const first = FakeES.all[0];
    act(() => first.onopen?.(new Event("open")));
    act(() => first.emit("emergency-stop", { id: 11, state: "STARTED", scope: { type: "SPACE", spaceId: 2, includeChildren: true }, reason: "점검", at: "2026-10-04T01:20:00Z" }));
    expect(screen.getByRole("alert")).toHaveTextContent("본관 전체");
    // 시작 이벤트 뒤 목록 조회가 빈 목록이면(이미 해제됨) 띠를 지운다
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    api.activeEmergencyStops.mockResolvedValue(ok({ responses: [STOP] }));
    act(() => first.onerror?.(new Event("error")));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    await waitFor(() => expect(FakeES.all).toHaveLength(2));
    act(() => FakeES.all[1].onopen?.(new Event("open")));
    expect(await screen.findByRole("alert")).toHaveTextContent("김운영");
  });

  it("비상 정지는 더 이상 주기 조회하지 않고, 유지보수만 5초마다 다시 읽는다", async () => {
    FakeES.all = [];
    const api = fakeAdminApi();
    await renderRoute(<GlobalBands initialStops={[]} initialMaintenance={[]} canRelease={false} canEndMaintenance={false} timezone="Asia/Seoul" lang="ko" api={api} streamOptions={live} />);
    await waitFor(() => expect(FakeES.all).toHaveLength(1));
    api.activeMaintenance.mockResolvedValue(ok({ responses: [{ id: "77", targetType: "SPACE", targetId: "31", targetName: "실습실", endsAt: "2026-10-04T09:00:00Z", reason: "필터 교체", status: "ACTIVE" }] }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BAND_POLL_MS);
    });
    expect(await screen.findByRole("status")).toHaveTextContent("유지보수 중 — 실습실");
    expect(api.activeMaintenance).toHaveBeenCalled();
    expect(api.activeEmergencyStops).not.toHaveBeenCalled();
  });

  it("RUL-03.01 본인 웹 알림(notification 이벤트)은 오른쪽 아래 알림으로, [열기]는 링크로 간다(읽음 수 없음)", async () => {
    FakeES.all = [];
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await renderRoute(<GlobalBands initialStops={[]} initialMaintenance={[]} canRelease={false} canEndMaintenance={false} timezone="Asia/Seoul" lang="ko" api={fakeAdminApi()} pollMs={null} streamOptions={live} />);
    await waitFor(() => expect(FakeES.all).toHaveLength(1));
    const es = FakeES.all[0];
    act(() => es.emit("notification", { id: "5f0c2c1e-1111-4a5b-9c2d-0e1f2a3b4c5d", category: "ALARM", title: "고CO2 · 실습실", link: "/alarms/501", createdAt: "2026-10-04T01:00:00Z", alarmId: "501" }));
    const list = screen.getByRole("list", { name: "새 알림" });
    expect(list).toHaveTextContent("고CO2 · 실습실");
    expect(list).toHaveTextContent("2026-10-04 10:00");
    expect(screen.getByRole("link", { name: "열기" })).toHaveAttribute("href", "/alarms/501");
    for (let i = 0; i < MAX_NOTICES + 1; i += 1) act(() => es.emit("notification", { id: `n-${i}`, category: "ALARM", title: `알림 ${i}`, link: null, createdAt: null, alarmId: null }));
    expect(list.querySelectorAll("li")).toHaveLength(MAX_NOTICES);
    await user.click(screen.getAllByRole("button", { name: "알림 닫기" })[0]);
    expect(list.querySelectorAll("li")).toHaveLength(MAX_NOTICES - 1);
  });

  it("TC-ACT-105 AT-ACT-09.3: 해제 권한이 없으면(OPERATOR) [해제]가 없다, 서버 403도 안내", async () => {
    const api = fakeAdminApi({ releaseEmergencyStop: vi.fn(async () => err(403, "PERMISSION_DENIED")) });
    const { unmount } = await renderRoute(
      <GlobalBands initialStops={[STOP]} initialMaintenance={[]} canRelease={false} canEndMaintenance={false} timezone="Asia/Seoul" lang="ko" api={api} pollMs={null} />,
    );
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "해제" })).not.toBeInTheDocument();
    unmount();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await renderRoute(<GlobalBands initialStops={[STOP]} initialMaintenance={[]} canRelease canEndMaintenance={false} timezone="Asia/Seoul" lang="ko" api={api} pollMs={null} />);
    await user.click(await screen.findByRole("button", { name: "해제" }));
    const dialog = await screen.findByRole("dialog", { name: "비상 정지 해제" });
    await user.click(dialog.querySelectorAll("footer button")[1] as HTMLElement);
    expect(await screen.findByText("이 작업을 할 권한이 없습니다", { exact: false })).toBeInTheDocument();
  });

  it("ADMIN·INTEGRATOR 해제 → 띠가 사라진다(해제 사유 전달)", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const api = fakeAdminApi();
    await renderRoute(<GlobalBands initialStops={[STOP]} initialMaintenance={[]} canRelease canEndMaintenance={false} timezone="Asia/Seoul" lang="ko" api={api} pollMs={null} />);
    await user.click(await screen.findByRole("button", { name: "해제" }));
    await user.type(screen.getByLabelText("해제 사유(선택)"), "점검 끝");
    const dialog = screen.getByRole("dialog", { name: "비상 정지 해제" });
    await user.click(dialog.querySelectorAll("footer button")[1] as HTMLElement);
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(api.releaseEmergencyStop).toHaveBeenCalledWith("9", "점검 끝");
  });

  it("공간 범위 띠는 공간 이름, 유지보수 띠와 [종료](DEV_PLACE)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await renderRoute(
      <GlobalBands
        initialStops={[{ ...STOP, scope: { type: "SPACE", spaceId: "2", includeChildren: true } }]}
        initialMaintenance={[{ id: "77", targetType: "SPACE", targetId: "31", targetName: "실습실", endsAt: "2026-10-04T09:00:00Z", reason: "필터 교체", status: "ACTIVE" }]}
        spaces={SPACES}
        canRelease={false}
        canEndMaintenance
        timezone="Asia/Seoul"
        lang="ko"
        api={fakeAdminApi()}
        pollMs={null}
      />,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("본관 전체");
    expect(screen.getByRole("status")).toHaveTextContent("유지보수 중 — 실습실 · 2026-10-04 18:00까지 · 필터 교체");
    await user.click(screen.getByRole("button", { name: "종료" }));
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument(), { timeout: 5000 });
    expect(fetchSpy.mock.calls.map((call) => String(call[0]))).toContain("/bff/api/core/maintenance-windows/77/end");
    fetchSpy.mockRestore();
  });
});

describe("UI-ACT-07 실행 대화상자", () => {
  it("범위·사유·확인 입력 검증 후 API-ACT-20 본문 {scope:{type:SPACE, spaceId, includeChildren:true}, reason}", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const api = fakeAdminApi();
    const onStarted = vi.fn();
    await renderRoute(<EmergencyStopButton api={api} loadSpaces={async () => SPACES} onStarted={onStarted} />);
    await user.click(await screen.findByRole("button", { name: "자동화 비상 정지" }));
    const dialog = await screen.findByRole("dialog", { name: "자동화 비상 정지" });
    expect(dialog).toHaveTextContent("수동 제어는 계속 할 수 있습니다.");
    await user.click(screen.getByRole("radio", { name: "공간(하위 포함)" }));
    await user.click(screen.getByRole("button", { name: "비상 정지" }));
    expect(screen.getByText("공간을 고르세요")).toBeInTheDocument();
    expect(screen.getByText("사유를 1~200자로 입력하세요")).toBeInTheDocument();
    expect(screen.getByText('"정지"를 정확히 입력하세요')).toBeInTheDocument();
    expect(api.startEmergencyStop).not.toHaveBeenCalled();
    await user.selectOptions(screen.getByLabelText("공간"), "2");
    await user.type(screen.getByLabelText("사유"), "냉방 오작동 점검");
    await user.type(screen.getByLabelText('확인을 위해 "정지"를 입력하세요'), "정지");
    await user.click(screen.getByRole("button", { name: "비상 정지" }));
    await waitFor(() => expect(onStarted).toHaveBeenCalled());
    expect(api.startEmergencyStop).toHaveBeenCalledWith({ scope: { type: "SPACE", spaceId: "2", includeChildren: true }, reason: "냉방 오작동 점검" });
  });

  it("이미 정지 중이면 EMERGENCY_STOP_ACTIVE 문구", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const api = fakeAdminApi({ startEmergencyStop: vi.fn(async () => err(409, "EMERGENCY_STOP_ACTIVE")) });
    await renderRoute(<EmergencyStopButton api={api} loadSpaces={async () => []} />);
    await user.click(await screen.findByRole("button", { name: "자동화 비상 정지" }));
    await user.type(await screen.findByLabelText("사유"), "점검");
    await user.type(screen.getByLabelText('확인을 위해 "정지"를 입력하세요'), "정지");
    await user.click(screen.getByRole("button", { name: "비상 정지" }));
    expect(await screen.findByText("이미 비상 정지 중입니다")).toBeInTheDocument();
  });
});
