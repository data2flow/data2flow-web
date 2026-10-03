import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { coolingGraph, detailOf, fakeApi, renderEditor, stubReactFlowDom } from "./helpers";

beforeEach(() => stubReactFlowDom());

describe("FLW-01.05 TC-FLW-021 AT-FLW-01.2 템플릿으로 만든 플로우: 대상 기기 없음 경고(차단 아님)", () => {
  it("제어 노드에 '대상 기기 없음' 배지, 적용 검증 경고만 있고 적용 가능", async () => {
    const warnings = [{ code: "TARGET_MISSING", nodeId: "n-act00001", message: "대상 기기 없음" }];
    const api = fakeApi({ validate: () => Promise.resolve({ ok: true, status: 200, data: { errors: [], warnings, changeSummary: { added: ["n-trg00001", "n-agg00001", "n-thr00001", "n-act00001"], removed: [], changed: [] }, risky: { controlNodesChanged: true, executionModeChanged: false }, approvalRequired: false } }) });
    const { container } = await renderEditor({ detail: detailOf(coolingGraph(), { draftVersion: 1 }, { errors: [], warnings }), api });
    await screen.findByRole("tablist", { name: "하단 패널" });
    const card = container.querySelector('.react-flow__node[data-id="n-act00001"]') as HTMLElement;
    expect(within(card).getByText("대상 기기 없음")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "검증 (1)" })).toBeInTheDocument();
    expect(screen.getByText("경고: 기기 제어: 대상 기기 없음")).toBeInTheDocument();
    const apply = screen.getByRole("button", { name: "적용" });
    expect(apply).toBeEnabled();
    await userEvent.click(apply);
    const dialog = await screen.findByRole("dialog", { name: "적용 확인: 고온이면 냉방 – → v1" });
    expect(within(dialog).getByText("검증: 오류 0 · 경고 1")).toBeInTheDocument();
    expect(within(dialog).getByText("+ 기기 제어 · 상태: 새로 시작")).toBeInTheDocument();
    // 위험 변경: "이해했습니다" 체크 전에는 적용 불가
    const confirm = within(dialog).getByRole("button", { name: "적용" });
    expect(confirm).toBeDisabled();
    await userEvent.click(within(dialog).getByRole("checkbox", { name: "이해했습니다" }));
    expect(confirm).toBeEnabled();
    await userEvent.type(within(dialog).getByRole("textbox", { name: "배포 메모(0~500자)" }), "시연");
    await userEvent.click(confirm);
    expect(api.apply).toHaveBeenCalledWith("f-7f3a", { version: 1, baseVersion: 0, memo: "시연", acknowledgedRisks: true });
    expect(await screen.findByText("v2을(를) 적용했습니다")).toBeInTheDocument();
  });
});

describe("FLW-03.07 가상 공간을 대상으로 한 플로우", () => {
  it("[가상] 배너와 가상 환경 실행 링크", async () => {
    await renderEditor({ detail: detailOf(coolingGraph("90")) });
    expect(await screen.findByText("이 플로우는 가상 공간을 대상으로 합니다. 가상 환경에서 시나리오를 실행해 동작을 확인하세요.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "가상 환경에서 실행" })).toHaveAttribute("href", "/sim");
  });
});
