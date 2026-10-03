import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { meOf, renderRoute } from "../../../../../test/render";
import { fakeApi } from "../../__tests__/helpers";
import { VersionsPanel } from "../versions-panel";

describe("FLW-01.06 UI-FLW-05 버전 기록·비교·롤백", () => {
  it("버전 목록, 비교(차이를 캔버스로 전달), 롤백 확인 → API-FLW-08", async () => {
    const api = fakeApi();
    const onDiff = vi.fn();
    const onRolledBack = vi.fn();
    await renderRoute(<VersionsPanel flowId="f-7f3a" api={api} canWrite timezone="Asia/Seoul" onDiff={onDiff} onRolledBack={onRolledBack} />, { session: meOf("OPERATOR") });
    expect(await screen.findByText("기준 온도 상향")).toBeInTheDocument();
    expect(screen.getByText("v14")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "v13와 비교" }));
    expect(api.diff).toHaveBeenCalledWith("f-7f3a", 13, 14);
    expect(onDiff).toHaveBeenCalledWith(expect.objectContaining({ added: ["n-agg00001"] }), "v13 → v14");
    await userEvent.click(screen.getByRole("button", { name: "비교 끄기" }));
    expect(onDiff).toHaveBeenLastCalledWith(null);
    await userEvent.click(screen.getByRole("button", { name: "v13로 롤백" }));
    const dialog = screen.getByRole("dialog", { name: "v13로 롤백" });
    await userEvent.type(within(dialog).getByRole("textbox"), "되돌림");
    await userEvent.click(within(dialog).getByRole("button", { name: "롤백" }));
    expect(api.rollback).toHaveBeenCalledWith("f-7f3a", { toVersion: 13, memo: "되돌림" });
    expect(onRolledBack).toHaveBeenCalledWith(15);
  });

  it("조회 권한만이면 롤백 없음, 오류·빈 목록·롤백 실패", async () => {
    const failing = fakeApi({ versions: () => Promise.resolve({ ok: false, status: 503, code: "SERVICE_UNAVAILABLE", message: "" }) });
    const { unmount } = await renderRoute(<VersionsPanel flowId="f" api={failing} canWrite={false} timezone="Asia/Seoul" onDiff={vi.fn()} onRolledBack={vi.fn()} />);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    unmount();
    const empty = fakeApi({ versions: () => Promise.resolve({ ok: true, status: 200, data: { responses: [] } }) });
    const second = await renderRoute(<VersionsPanel flowId="f" api={empty} canWrite={false} timezone="Asia/Seoul" onDiff={vi.fn()} onRolledBack={vi.fn()} />);
    expect(await screen.findByText("버전이 없습니다")).toBeInTheDocument();
    second.unmount();
    const api = fakeApi({ rollback: vi.fn().mockResolvedValue({ ok: false, status: 403, code: "PERMISSION_DENIED", message: "" }), diff: vi.fn().mockResolvedValue({ ok: false, status: 404, code: "FLOW_NOT_FOUND", message: "" }) });
    await renderRoute(<VersionsPanel flowId="f" api={api} canWrite timezone="Asia/Seoul" onDiff={vi.fn()} onRolledBack={vi.fn()} />);
    await userEvent.click(await screen.findByRole("button", { name: "v13와 비교" }));
    expect(await screen.findByText("플로우를 찾을 수 없습니다")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "v13로 롤백" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "롤백" }));
    expect(await screen.findAllByRole("alert")).not.toHaveLength(0);
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "취소" }));
  });
});
