/**
 * UI-SCR-08 사용처(SCR-04.04): TC-SCR-076 — 비활성화 확인 창 "기기 12대, 24시간 17,280건", 삭제 버튼 비활성 사유.
 */
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { meOf, renderRoute } from "../../../../test/render";
import type { ScriptDetail } from "../api";
import { inUse, usageImpact } from "../model/usage";
import { ScriptUsageTab } from "../script-usage";

const script: ScriptDetail = {
  id: "501",
  name: "온도 보정",
  kind: "TRANSFORM",
  status: "ENABLED",
  activeVersion: null,
  draft: null,
  usage: {
    bindings: [
      { targetType: "MODEL", targetId: "11", name: "EM300-TH", deviceCount: 11, processed24h: 15840, failurePolicy: "fail-open" },
      { targetType: "DEVICE", targetId: "81", name: "AM103-081175", deviceCount: 1, processed24h: 1440, failurePolicy: "fail-closed" },
    ],
    flowNodes: [{ flowId: "f-1", flowName: "실습실 냉방", nodeId: "n-js-1", flowVersion: 13 }],
  },
};

describe("[SCR-04.04][AT-SCR-09.1] 사용처 합계", () => {
  it("기기 수·24시간 처리량 합계, 사용 중 판정", () => {
    expect(usageImpact(script.usage)).toEqual({ bindings: 2, deviceCount: 12, processed24h: 17280, flowNodes: 1 });
    expect(inUse(script.usage)).toBe(true);
    expect(inUse({ bindings: [], flowNodes: [] })).toBe(false);
    expect(inUse(undefined)).toBe(false);
    expect(usageImpact({ bindings: [{ name: "x" }] })).toEqual({ bindings: 1, deviceCount: 0, processed24h: 0, flowNodes: 0 });
  });
});

describe("[SCR-04.04] UI-SCR-08 사용처 탭", () => {
  it("TC-SCR-076 AT-SCR-09.1 비활성화 확인 창에 기기 12대, 24시간 17,280건 / AT-SCR-09.2 삭제 버튼 비활성과 사유", async () => {
    await renderRoute(<ScriptUsageTab script={script} canWrite lang="ko" />, { session: meOf("INTEGRATOR") });
    expect(await screen.findByText("EM300-TH")).toBeInTheDocument();
    expect(screen.getByText("15,840")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "실습실 냉방" })).toHaveAttribute("href", "/automation/flows/f-1");
    const del = screen.getByRole("button", { name: "삭제" });
    expect(del).toBeDisabled();
    expect(del).toHaveAccessibleDescription(/사용 중인 스크립트는 지울 수 없습니다/);
    await userEvent.click(screen.getByRole("button", { name: "비활성화" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("연결 2곳, 기기 12대, 24시간 17,280건이 이 스크립트 없이 처리됩니다.")).toBeInTheDocument();
    expect(within(dialog).getByText("플로우 노드 1곳도 이 스크립트를 참조합니다.")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "취소" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("사용처가 없으면 삭제 가능·안내, 비활성 상태면 [활성화], 읽기 전용은 버튼 없음, 처리 결과·오류 안내", async () => {
    const empty = { ...script, status: "DISABLED", usage: { bindings: [], flowNodes: [] } };
    const { unmount } = await renderRoute(<ScriptUsageTab script={empty} canWrite lang="ko" result={{ intent: "enable", error: { code: "SCRIPT_IN_USE" } }} />, { session: meOf("INTEGRATOR") });
    expect(await screen.findByText("연결된 소스·모델·기기가 없습니다.")).toBeInTheDocument();
    expect(screen.getByText("이 스크립트를 쓰는 플로우 노드가 없습니다.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "삭제" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "활성화" })).toBeInTheDocument();
    expect(screen.getByText("사용 중인 스크립트는 지울 수 없습니다.")).toBeInTheDocument();
    unmount();
    const { unmount: u2 } = await renderRoute(<ScriptUsageTab script={script} canWrite={false} lang="ko" result={{ intent: "disable", ok: true, impact: { deviceCount: 12, processed24h: 17280 } }} />, { session: meOf("OPERATOR") });
    expect(await screen.findByText("비활성화했습니다. 기기 12대, 24시간 17,280건에 영향이 있습니다.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "비활성화" })).toBeNull();
    u2();
    await renderRoute(<ScriptUsageTab script={script} canWrite={false} lang="ko" result={{ intent: "enable", ok: true }} />, { session: meOf("OPERATOR") });
    expect(await screen.findByText("활성화했습니다.")).toBeInTheDocument();
  });
});
