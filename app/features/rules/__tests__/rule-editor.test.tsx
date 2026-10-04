/**
 * TC-RUL-019 조건 빌더(UI-RUL-02, RUL-01.06): AND/OR 그룹 추가, 조건 10개 초과·중첩 3단계 시 추가 버튼 비활성과 안내,
 * 해제 기준이 발생 기준보다 엄격하면 필드 오류 문구, 저장 전 시뮬레이션 버튼. 템플릿·범위(현재 대상 수)·저장 본문도 본다.
 */
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { meOf, renderRoute } from "../../../../test/render";
import { RuleEditor, type RuleEditorProps } from "../components/rule-editor";
import { emptyForm, formFromRule } from "../model/rule-form";
import { devices, fakeChart, fakeRulesApi, metrics, spaces, templates } from "./fakes";

function setup(props: Partial<RuleEditorProps> = {}, role = "OPERATOR") {
  const onSave = vi.fn();
  const api = fakeRulesApi();
  const chart = fakeChart();
  renderRoute(
    <RuleEditor initial={emptyForm()} templates={templates} policies={[{ notificationPolicyId: "p-1", name: "시설팀 기본" }]} spaces={spaces} devices={devices} models={[{ code: "AM107", name: "AM107" }]} metrics={metrics} canWrite={role !== "ANALYST"} onSave={onSave} api={api} chartFactory={chart.factory} now={() => Date.parse("2026-10-04T00:00:00Z")} {...props} />,
    { session: meOf(role) },
  );
  return { onSave, api, user: userEvent.setup() };
}

describe("TC-RUL-019 조건 빌더", () => {
  it("템플릿 고CO2 → 조건·제목이 채워지고, 본관(하위 포함)을 고르면 현재 대상 1대, 저장 본문", async () => {
    const { onSave, user } = setup();
    await user.selectOptions(await screen.findByLabelText("템플릿"), "high-co2");
    expect(screen.getByLabelText("이름")).toHaveValue("고CO2");
    expect(screen.getByLabelText("값")).toHaveValue(1000);
    expect(screen.getByLabelText("해제 기준")).toHaveValue(900);
    await user.click(screen.getByRole("checkbox", { name: "본관" }));
    expect(screen.getByRole("status", { name: "현재 대상 수" })).toHaveTextContent("현재 대상 1대");
    await user.selectOptions(screen.getByLabelText("알림 정책"), "p-1");
    await user.click(screen.getByRole("button", { name: "저장" }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ name: "고CO2", templateKey: "high-co2", scope: { type: "SPACE", ids: ["2"], includeChildren: true }, condition: { kind: "threshold", metric: "co2", op: ">", value: 1000, for: "PT5M", clear: 900 }, severity: "MAJOR", policyId: "p-1", autoClear: true }),
    );
  });

  it("해제 기준이 발생 기준보다 엄격하면 \"해제 기준은 1000보다 작아야 합니다\", 값 범위 밖이면 \"co2의 유효 범위는 0~10000입니다\"", async () => {
    const { onSave, user } = setup({ initial: formFromRule({ name: "고CO2", scope: { type: "SPACE", ids: ["2"], includeChildren: true }, condition: { kind: "threshold", metric: "co2", op: ">", value: 1000, clear: 1100 }, severity: "MAJOR", titleTemplate: "t" }) });
    await user.click(await screen.findByRole("button", { name: "저장" }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText("해제 기준은 1000보다 작아야 합니다")).toBeInTheDocument();
    expect(screen.getByText("입력을 확인하세요")).toBeInTheDocument();
    await user.clear(screen.getByLabelText("값"));
    await user.type(screen.getByLabelText("값"), "12000");
    expect(screen.getByText("co2의 유효 범위는 0~10000입니다")).toBeInTheDocument();
  });

  it("조건을 10개 넣으면 [조건 추가]가 꺼지고 안내, 안쪽 그룹에는 그룹을 더 넣을 수 없다(중첩 2단계), OR 그룹", async () => {
    const { user } = setup();
    const root = await screen.findByRole("group", { name: "조건 그룹 1단계" });
    await user.click(within(root).getAllByRole("button", { name: "그룹 추가" }).at(-1)!);
    const inner = screen.getByRole("group", { name: "조건 그룹 2단계" });
    expect(within(inner).queryByRole("button", { name: "그룹 추가" })).toBeNull();
    expect(within(inner).getByLabelText("그룹 2단계 묶음 방식")).toHaveValue("OR");
    for (let i = 0; i < 8; i += 1) await user.click(within(inner).getByRole("button", { name: "조건 추가" }));
    expect(screen.getAllByRole("group", { name: "조건 항목" })).toHaveLength(10);
    for (const button of screen.getAllByRole("button", { name: "조건 추가" })) expect(button).toBeDisabled();
    expect(screen.getByText("조건은 10개까지 넣을 수 있습니다")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("그룹 1단계 묶음 방식"), "OR");
    expect(screen.getByLabelText("그룹 1단계 묶음 방식")).toHaveValue("OR");
    await user.click(screen.getByRole("button", { name: "그룹 삭제" }));
    expect(screen.getAllByRole("group", { name: "조건 항목" })).toHaveLength(1);
  });

  it("조건 종류(변화율·무수신)와 범위 연산자, 불리언 값, 조건 삭제", async () => {
    const { user } = setup();
    const kind = await screen.findByLabelText("조건 종류");
    await user.selectOptions(kind, "rateOfChange");
    expect(screen.getByLabelText("방향")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("조건 종류"), "noData");
    expect(screen.getByLabelText("측정 항목")).toHaveValue("");
    await user.selectOptions(screen.getByLabelText("조건 종류"), "threshold");
    await user.selectOptions(screen.getByLabelText("연산자"), "outside");
    expect(screen.getByLabelText("범위 아래")).toBeInTheDocument();
    expect(screen.queryByLabelText("해제 기준")).toBeNull();
    await user.selectOptions(screen.getByLabelText("연산자"), "==");
    await user.selectOptions(screen.getByLabelText("측정 항목"), "occupancy");
    await user.selectOptions(screen.getByLabelText("값"), "true");
    await user.selectOptions(screen.getByLabelText("대상 기준"), "spaceAvg");
    await user.click(screen.getByRole("button", { name: "조건 추가" }));
    await user.click(screen.getAllByRole("button", { name: "조건 삭제" })[0]);
    expect(screen.getAllByRole("group", { name: "조건 항목" })).toHaveLength(1);
  });

  it("범위 종류(기기·모델·태그), 시간 조건(운영 시간표 밖), 저장 전 [시뮬레이션] 패널", async () => {
    const { onSave, api, user } = setup({ initial: formFromRule({ name: "야간 문열림", scope: { type: "SPACE", ids: [], includeChildren: true }, condition: { kind: "threshold", metric: "co2", op: ">", value: 1000 }, severity: "MAJOR", titleTemplate: "t" }) });
    await user.click(await screen.findByRole("radio", { name: "기기" }));
    await user.click(screen.getByRole("checkbox", { name: "AM107-067999" }));
    await user.click(screen.getByRole("radio", { name: "태그" }));
    await user.click(screen.getByRole("checkbox", { name: "pilot" }));
    await user.click(screen.getByRole("radio", { name: "기기 모델" }));
    await user.click(screen.getByRole("checkbox", { name: "AM107" }));
    expect(screen.getByRole("status", { name: "현재 대상 수" })).toHaveTextContent("현재 대상 1대");
    await user.click(screen.getByRole("checkbox", { name: "시간 조건 사용" }));
    await user.selectOptions(screen.getByLabelText("공간 운영 시간표"), "OUTSIDE");
    await user.click(screen.getByRole("checkbox", { name: "토" }));
    await user.click(screen.getByRole("checkbox", { name: "월" }));
    await user.click(screen.getByRole("button", { name: "시뮬레이션" }));
    await user.click(screen.getByRole("button", { name: "실행" }));
    expect(api.simulate).toHaveBeenCalledWith(expect.objectContaining({ rule: expect.objectContaining({ scope: { type: "MODEL", ids: ["AM107"], includeChildren: false }, timeCondition: { days: [2, 3, 4, 5, 6], spaceSchedule: "OUTSIDE" } }), from: "2026-09-27T00:00:00.000Z" }), undefined);
    expect(await screen.findByText("EM500-152590")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "저장" }));
    expect(onSave).toHaveBeenCalled();
  });

  it("대상이 0대면 오류(NO_TARGET) 예고, ANALYST·변환된 규칙은 읽기 전용, ERROR 사유·경고·서버 오류 표시", async () => {
    renderRoute(
      <RuleEditor
        initial={formFromRule({ name: "사무실", scope: { type: "SPACE", ids: ["32"], includeChildren: true }, condition: { kind: "threshold", metric: "co2", op: ">", value: 1000 }, severity: "MAJOR", titleTemplate: "t" })}
        rule={{ ruleId: "r-1", version: 2, status: "CONVERTED", errorReason: null, targetCount: 0, flowId: "f-9" }}
        templates={templates}
        policies={[]}
        spaces={spaces}
        devices={devices}
        models={[]}
        metrics={metrics}
        canWrite
        serverError="서버 오류"
        warnings={["대상 기기가 없습니다"]}
        serverProblems={{ name: { key: "errors.RULE_NAME_DUPLICATED" } }}
        onSave={vi.fn()}
        api={fakeRulesApi()}
      />,
      { session: meOf("OPERATOR") },
    );
    expect(await screen.findByText("플로우로 변환된 규칙은 폼으로 편집할 수 없습니다.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "플로우로 열기" })).toHaveAttribute("href", "/automation/flows/f-9");
    expect(screen.queryByRole("button", { name: "저장" })).toBeNull();
    expect(screen.getByText("대상 기기가 없으면 규칙이 오류(NO_TARGET)가 됩니다")).toBeInTheDocument();
    expect(screen.getByText("저장 시 0대")).toBeInTheDocument();
    expect(screen.getByText("같은 이름의 규칙이 있습니다")).toBeInTheDocument();
    expect(screen.getByText("서버 오류")).toBeInTheDocument();
    expect(screen.getByText("대상 기기가 없습니다")).toBeInTheDocument();
  });

  it("ERROR 규칙은 사유를 보여 준다(RUL-06.03)", async () => {
    setup({ rule: { ruleId: "r-2", version: 1, status: "ERROR", errorReason: "METRIC_DELETED" } });
    expect(await screen.findByText("규칙 오류: 측정 항목 삭제됨")).toBeInTheDocument();
  });
});
