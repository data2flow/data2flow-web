import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { coolingGraph, detailOf, renderEditor, stubReactFlowDom } from "./helpers";

beforeEach(() => stubReactFlowDom());

describe("FLW-05.06 TC-FLW-118 권한별 편집기", () => {
  it("ANALYST: 편집·적용 버튼과 팔레트 없음, 캔버스 읽기 전용 배지", async () => {
    await renderEditor({ role: "ANALYST", detail: detailOf(coolingGraph(), { status: "ACTIVE", activeVersion: 13, draftVersion: null }) });
    expect(await screen.findByText("보기 전용(권한 없음)")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "저장" })).toBeNull();
    expect(screen.queryByRole("button", { name: "적용" })).toBeNull();
    expect(screen.queryByRole("complementary", { name: "노드 팔레트" })).toBeNull();
    expect(screen.queryByRole("toolbar", { name: "편집 도구" })).toBeNull();
    expect(screen.getByText("실행 v13 · 편집 기준 v13")).toBeInTheDocument();
  });

  it("OPERATOR(FLOW_DEPLOY_CONTROL 없음): 제어 노드 팔레트 항목 비활성과 안내 문구", async () => {
    await renderEditor({ role: "OPERATOR" });
    const locked = await screen.findByRole("button", { name: "기기 제어 (잠김)" });
    expect(locked).toBeDisabled();
    expect(screen.getAllByText("제어·장면 노드는 제어 배포 권한이 있어야 쓸 수 있습니다").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "임계값 추가" })).toBeEnabled();
  });

  it("INTEGRATOR: 제어 노드 사용 가능, 비상 정지 배너·적용 상태·편집 중 사용자", async () => {
    const detail = { ...detailOf(coolingGraph(), { status: "ACTIVE", activeVersion: 13, draftVersion: null }), applyStatus: { targetVersion: 13, instances: [], converged: true }, editors: [{ userId: "8", name: "이통합", since: "2026-10-03T00:00:00Z" }], emergencyStop: { active: true } };
    await renderEditor({ role: "INTEGRATOR", detail });
    expect(await screen.findByRole("button", { name: "기기 제어 추가" })).toBeEnabled();
    expect(screen.getByText("자동 제어 비상 정지 중 — 제어 노드는 건너뜁니다")).toBeInTheDocument();
    expect(screen.getByText("모든 인스턴스 v13 적용됨")).toBeInTheDocument();
    expect(screen.getByText("편집 중: 이통합")).toBeInTheDocument();
    expect(screen.getByText("적용할 새 초안이 없습니다")).toBeInTheDocument();
  });
});
