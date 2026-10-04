/**
 * TC-RUL-036 AT-RUL-05.1 데이터 탐색 차트에서 규칙 만들기(RUL-01.13): 실습실 co2 계열 y=1000 → /rules/new?fromChart=1&metric=co2&op=>&value=1000&spaceId=31.
 * RULE_WRITE가 없으면 보이지 않는다.
 */
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { meOf, renderRoute } from "../../../../test/render";
import { RuleFromChart, ruleDraftUrl } from "../../rules/components/rule-from-chart";

const series = [
  { kind: "space" as const, id: "31", metric: "co2", label: "실습실 CO2" },
  { kind: "device" as const, id: "1042", metric: "temperature", label: "AM107 온도" },
  { kind: "device" as const, id: "9", metric: "x", label: "숨김", hidden: true },
];

describe("TC-RUL-036 차트 기준선 → 규칙 초안", () => {
  it("y=1000 기준선 → 규칙 만들기 링크(공간은 spaceId, 기기는 deviceIds)", async () => {
    const user = userEvent.setup();
    renderRoute(<RuleFromChart series={series} />, { session: meOf("OPERATOR") });
    expect(await screen.findByText("기준선 값을 입력하세요")).toBeInTheDocument();
    await user.type(screen.getByLabelText("기준선 값"), "1000");
    expect(screen.getByRole("link", { name: "규칙 만들기" })).toHaveAttribute("href", "/rules/new?fromChart=1&metric=co2&op=%3E&value=1000&spaceId=31");
    await user.selectOptions(screen.getByLabelText("계열"), "1");
    await user.selectOptions(screen.getByLabelText("연산자"), "<");
    expect(screen.getByRole("link", { name: "규칙 만들기" })).toHaveAttribute("href", "/rules/new?fromChart=1&metric=temperature&op=%3C&value=1000&deviceIds=1042");
    expect(screen.queryByRole("option", { name: "숨김" })).toBeNull();
    expect(ruleDraftUrl({ kind: "device", id: "7", metric: "co2" }, ">=", 1.5)).toBe("/rules/new?fromChart=1&metric=co2&op=%3E%3D&value=1.5&deviceIds=7");
  });

  it("ANALYST(RULE_WRITE 없음)나 계열이 없으면 그리지 않는다", async () => {
    const { container } = await renderRoute(<RuleFromChart series={series} />, { session: meOf("ANALYST") });
    await new Promise((r) => setTimeout(r, 0));
    expect(container.textContent).toBe("");
    const other = await renderRoute(<RuleFromChart series={[]} />, { session: meOf("OPERATOR") });
    await new Promise((r) => setTimeout(r, 0));
    expect(other.container.textContent).toBe("");
  });
});
