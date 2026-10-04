import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { coolingGraph, detailOf, fakeApi, renderEditor, stubReactFlowDom } from "./helpers";

beforeEach(() => stubReactFlowDom());

const validated = (extra: object = {}) => () => Promise.resolve({ ok: true as const, status: 200, data: { errors: [], warnings: [], changeSummary: { added: [], removed: [{ nodeId: "n-gone0001", retainedState: true }], changed: [{ nodeId: "n-thr00001", statePolicy: "KEEP" as const }] }, risky: { controlNodesChanged: false, executionModeChanged: false }, ...extra } });

describe("FLW-05.06 TC-FLW-113 AT-FLW-03.5 제어 배포 권한 없이 제어 노드 적용 → 403", () => {
  it("적용 거부 문구를 대화상자에 보여 주고 실행 버전은 그대로", async () => {
    const api = fakeApi({ validate: validated(), apply: vi.fn().mockResolvedValue({ ok: false, status: 403, code: "PERMISSION_DENIED", message: "" }) });
    const onReload = vi.fn();
    await renderEditor({ role: "OPERATOR", detail: detailOf(coolingGraph(), { status: "ACTIVE", activeVersion: 13, draftVersion: 14 }), api, onReload });
    await userEvent.click(await screen.findByRole("button", { name: "적용" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("~ 임계값 · 상태: 유지(KEEP)")).toBeInTheDocument();
    expect(within(dialog).getByText("- n-gone0001 · 남은 상태 24시간 보관")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "적용" }));
    expect(await within(dialog).findByText("제어 노드가 있는 플로우를 적용할 권한이 없습니다")).toBeInTheDocument();
    expect(api.apply).toHaveBeenCalledWith("f-7f3a", expect.objectContaining({ version: 14, baseVersion: 13 }));
    expect(onReload).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole("button", { name: "취소" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("FLW-05.06 TC-FLW-120 AT-FLW-23.1 승인 필요 → 202 FLOW_APPROVAL_REQUIRED", () => {
  it("승인 요청 안내, 실행 버전 유지", async () => {
    const onReload = vi.fn();
    const api = fakeApi({ validate: validated({ approvalRequired: true }), apply: vi.fn().mockResolvedValue({ ok: true, status: 202, data: { approvalId: "ap-1" } }) });
    await renderEditor({ role: "OPERATOR", detail: detailOf(coolingGraph(), { status: "ACTIVE", activeVersion: 13, draftVersion: 14 }), api, onReload });
    await userEvent.click(await screen.findByRole("button", { name: "적용" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("제어 노드 변경이라 ADMIN 승인 뒤에 적용됩니다")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "적용" }));
    expect(await screen.findByText("승인 요청을 보냈습니다")).toBeInTheDocument();
    expect(onReload).not.toHaveBeenCalled();
  });
});

describe("FLW-05.06 AT-FLW-03.5 위험 변경 확인 없이 적용 → 400 acknowledgedRisks", () => {
  it("검증이 위험을 말하지 않았어도 서버가 확인을 요구하면 위험을 보여 주고 확인 뒤 다시 보낸다", async () => {
    const apply = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 400, code: "INVALID_REQUEST", message: "", errors: [{ field: "acknowledgedRisks", code: "AssertTrue", message: "" }] })
      .mockResolvedValueOnce({ ok: true, status: 202, data: { approvalId: "41", version: 14 } });
    const onReload = vi.fn();
    const api = fakeApi({ validate: validated(), apply });
    await renderEditor({ role: "INTEGRATOR", detail: detailOf(coolingGraph(), { status: "ACTIVE", activeVersion: 13, draftVersion: 14 }), api, onReload });
    await userEvent.click(await screen.findByRole("button", { name: "적용" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByRole("checkbox", { name: "이해했습니다" })).toBeNull();
    await userEvent.click(within(dialog).getByRole("button", { name: "적용" }));
    expect(await within(dialog).findByText(/위험 변경이 있습니다/)).toBeInTheDocument();
    expect(within(dialog).getByText("제어 노드가 추가·변경됩니다")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "적용" })).toBeDisabled();
    await userEvent.click(within(dialog).getByRole("checkbox", { name: "이해했습니다" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "적용" }));
    expect(apply).toHaveBeenLastCalledWith("f-7f3a", expect.objectContaining({ version: 14, baseVersion: 13, acknowledgedRisks: true }));
    expect(await screen.findByText("승인 요청을 보냈습니다")).toBeInTheDocument();
    expect(onReload).not.toHaveBeenCalled();
  });
});

describe("FLW-01.02 적용 거부 400 FLOW_VALIDATION_FAILED → 노드 배지, 검증 실패 503", () => {
  it("서버 검증 오류를 노드에 표시", async () => {
    const api = fakeApi({ validate: validated(), apply: vi.fn().mockResolvedValue({ ok: false, status: 400, code: "FLOW_VALIDATION_FAILED", message: "", errors: [{ field: "nodes[n-agg00001]", code: "CYCLE", message: "연결선이 순환합니다" }] }) });
    const { container } = await renderEditor({ detail: detailOf(coolingGraph(), { draftVersion: 2 }), api });
    await userEvent.click(await screen.findByRole("button", { name: "적용" }));
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "적용" }));
    expect(await screen.findByText("검증에 실패해 적용하지 못했습니다")).toBeInTheDocument();
    expect(within(container.querySelector('.react-flow__node[data-id="n-agg00001"]') as HTMLElement).getByText("오류 1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "적용" })).toBeDisabled();
  });

  it("검증 호출 실패와 오류가 있는 검증 결과(오류 항목 클릭 시 노드 선택)", async () => {
    const api = fakeApi({ validate: vi.fn().mockResolvedValueOnce({ ok: false, status: 503, code: "SERVICE_UNAVAILABLE", message: "" }).mockResolvedValueOnce({ ok: true, status: 200, data: { errors: [{ field: "nodes[n-act00001].config.target.spaceId", code: "TARGET_MISSING", message: "대상 공간이 없습니다" }], warnings: [] } }) });
    await renderEditor({ detail: detailOf(coolingGraph(), { draftVersion: 2 }), api });
    await userEvent.click(await screen.findByRole("button", { name: "적용" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "적용" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "적용" })).toBeDisabled();
    await userEvent.click(within(dialog).getByRole("button", { name: "기기 제어: 대상 기기 없음 · target.spaceId" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(await screen.findByRole("region", { name: "기기 제어 설정" })).toBeInTheDocument();
  });
});
