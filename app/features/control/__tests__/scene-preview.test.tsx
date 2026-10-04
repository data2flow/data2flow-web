/**
 * ACT-05 UI-ACT-04 장면 — TC-ACT-096(AT-ACT-05.1): 미리보기 표(현재 → 바뀔 상태, "변경 없음", 인터락 경고, 오프라인)와 실행 결과 요약(적용·대기·차단),
 * 저장 검증(이름 1~60자, 항목 필요, 목표 상태 형식), 수정은 baseVersion, 권한별(SCENE_MANAGE·SCENE_RUN) 버튼.
 */
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderRoute } from "../../../../test/render";
import { SceneEditor, sceneSpaceName } from "../scenes";
import { SCENE, err, fakeAdminApi, ok } from "./fake-admin";

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => vi.useRealTimers());

const DEVICES = [
  { id: "2001", name: "AC-1 실습실 에어컨" },
  { id: "2002", name: "환기 3F-02" },
];
const SPACES = [{ id: "31", name: "실습실", type: "ROOM", children: [] }] as never;
const CAPS = ["Switch", "Thermostat", "Ventilation", "Dimmer"];

describe("TC-ACT-096 AT-ACT-05.1 장면 미리보기·실행", () => {
  it("미리보기: 변경 1 · 변경 없음 1 · 차단 예상 1 · 오프라인 1, 실행 결과는 부분 성공 요약", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const api = fakeAdminApi();
    api.sceneRun.mockResolvedValueOnce(ok({ status: "RUNNING", results: [{ deviceId: "2001", status: "SENT" }] })).mockResolvedValueOnce(
      ok({
        status: "PARTIAL",
        results: [
          { deviceId: "2001", commandId: "c-9", status: "BLOCKED", reason: "INTERLOCK" },
          { deviceId: "2002", status: "QUEUED" },
          { deviceId: "2003", status: "SKIPPED", reason: "NO_CHANGE" },
        ],
      }),
    );
    await renderRoute(<SceneEditor scene={SCENE} devices={DEVICES} spaces={SPACES} capabilities={CAPS} canManage canRun api={api} pollMs={2000} />);
    await user.click(await screen.findByRole("button", { name: "미리보기" }));
    expect(await screen.findByText("변경 1 · 변경 없음 1 · 차단 예상 1 · 오프라인 1")).toBeInTheDocument();
    expect(screen.getByText("변경 없음", { selector: "td" })).toBeInTheDocument();
    expect(screen.getByText(/차단 예상: 창문이 열려 있어 냉난방을 막았습니다/)).toBeInTheDocument();
    expect(screen.getAllByText("off")).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: "실행" }));
    expect(await screen.findByRole("status")).toHaveTextContent("실행 중");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("부분 성공 — 적용 0 · 대기 1 · 차단 1 · 실패 0 · 건너뜀 1"));
    expect(screen.getAllByText("인터락").length).toBeGreaterThan(0);
    expect(api.runScene).toHaveBeenCalledWith("501");
  });

  it("편집 중에는 미리보기·실행을 막고 저장을 먼저 하게 한다. 수정 저장은 baseVersion을 보낸다", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const api = fakeAdminApi();
    await renderRoute(<SceneEditor scene={SCENE} devices={DEVICES} spaces={SPACES} capabilities={CAPS} canManage canRun api={api} />);
    const desired = await screen.findByLabelText("항목 2 목표 상태");
    await user.clear(desired);
    await user.type(desired, "on=false");
    expect(screen.getByRole("button", { name: "미리보기" })).toBeDisabled();
    expect(screen.getByText("바뀐 내용을 저장해야 미리보기·실행할 수 있습니다")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "저장" }));
    await screen.findByText("장면을 저장했습니다");
    const body = api.updateScene.mock.calls[0][1] as { baseVersion: number; items: { target: unknown }[] };
    expect(body.baseVersion).toBe(3);
    expect(body.items[1]).toEqual({ target: { deviceId: "2001" }, capability: "Switch", desired: { on: false } });
    expect(body.items[0].target).toEqual({ spaceId: "31", relation: "controls", capability: "Thermostat", includeChildren: false });
  });

  it("새 장면 검증: 이름·항목·목표 상태 형식, 버전 충돌 문구", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onSaved = vi.fn();
    const api = fakeAdminApi();
    await renderRoute(<SceneEditor scene={null} devices={DEVICES} spaces={SPACES} capabilities={CAPS} canManage canRun={false} api={api} onSaved={onSaved} />);
    expect(await screen.findByText("항목이 없습니다. [항목 추가]로 대상 기기와 목표 상태를 넣으세요")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "저장" }));
    expect(screen.getByText("이름은 1~60자로 입력하세요")).toBeInTheDocument();
    expect(screen.getByText("항목을 하나 이상 넣으세요")).toBeInTheDocument();
    await user.type(screen.getByLabelText("이름"), "퇴실 모드");
    await user.click(screen.getByRole("button", { name: "항목 추가" }));
    await user.selectOptions(screen.getByLabelText("항목 1 대상 종류"), "relation");
    await user.selectOptions(screen.getByLabelText("항목 1 공간"), "31");
    await user.selectOptions(screen.getByLabelText("항목 1 기능"), "Ventilation");
    await user.type(screen.getByLabelText("항목 1 목표 상태"), "mode off");
    await user.click(screen.getByRole("button", { name: "저장" }));
    expect(screen.getByText('"속성=값"을 쉼표로 이어 입력하세요')).toBeInTheDocument();
    await user.clear(screen.getByLabelText("항목 1 목표 상태"));
    await user.type(screen.getByLabelText("항목 1 목표 상태"), "mode=off");
    await user.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(api.createScene.mock.calls[0][0]).toMatchObject({
      name: "퇴실 모드",
      items: [{ target: { spaceId: "31", relation: "controls", capability: "Ventilation", includeChildren: true }, capability: "Ventilation", desired: { mode: "off" } }],
    });
    expect(screen.queryByRole("button", { name: "실행" })).not.toBeInTheDocument();
  });

  it("버전 충돌·삭제·권한 없음(읽기 전용)", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const api = fakeAdminApi({ updateScene: vi.fn(async () => err(409, "VERSION_CONFLICT")) });
    const onDeleted = vi.fn();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { unmount } = await renderRoute(<SceneEditor scene={SCENE} devices={DEVICES} spaces={SPACES} capabilities={CAPS} canManage canRun api={api} onDeleted={onDeleted} />);
    await user.click(await screen.findByRole("button", { name: "저장" }));
    expect(await screen.findByText("다른 사용자가 변경했습니다. 새로 고친 뒤 다시 저장하세요")).toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: "삭제" }).at(-1)!);
    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
    unmount();
    await renderRoute(<SceneEditor scene={SCENE} devices={DEVICES} spaces={SPACES} capabilities={CAPS} canManage={false} canRun={false} api={api} />);
    await screen.findByText("장면 편집");
    expect(screen.queryByRole("button", { name: "저장" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "항목 추가" })).not.toBeInTheDocument();
    expect(sceneSpaceName(SPACES, "31")).toBe("실습실");
    expect(sceneSpaceName(SPACES, "99")).toBe("#99");
    expect(sceneSpaceName(SPACES, null)).toBe("–");
  });
});
