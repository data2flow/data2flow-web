/**
 * TC-RUL-029 AT-RUL-03.2 규칙 시뮬레이션(UI-RUL-03, RUL-01.11): 기준 1200으로 다시 실행하면 이전 결과(1000)와 나란히 비교.
 * core는 동기 200으로 결과를 준다(작업 조회 없음). 데이터 10% 미만 안내, 폼 오류·30일 초과·실패 문구, 히트맵 옵션.
 */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { meOf, renderRoute } from "../../../../test/render";
import { fakeChart, fakeRulesApi, result } from "../../rules/__tests__/fakes";
import { SimulationPanel, formatSeconds } from "../../rules/components/simulation-panel";
import type { RulePayload } from "../../rules/model/types";

const rule = (value: number): RulePayload => ({ name: "고CO2", scope: { type: "SPACE", ids: ["2"], includeChildren: true }, condition: { kind: "threshold", metric: "co2", op: ">", value, for: "PT5M" }, severity: "MAJOR", titleTemplate: "t", autoClear: true });
const NOW = Date.parse("2026-10-04T00:00:00Z");

describe("TC-RUL-029 AT-RUL-03.1·03.2 시뮬레이션", () => {
  it("기준 1000 → 14건, 1200으로 다시 실행 → 이번 5건 · 이전 14건 나란히, 기기별 표와 히트맵", async () => {
    const api = fakeRulesApi();
    const chart = fakeChart();
    let value = 1000;
    const user = userEvent.setup();
    renderRoute(<SimulationPanel api={api} payload={() => rule(value)} now={() => NOW} chartFactory={chart.factory} />, { session: meOf("OPERATOR") });
    await user.click(await screen.findByRole("button", { name: "실행" }));
    expect(await screen.findByRole("columnheader", { name: "이번 (기준 1000)" })).toBeInTheDocument();
    expect(api.simulate).toHaveBeenCalledWith({ rule: rule(1000), from: "2026-09-27T00:00:00.000Z", to: "2026-10-04T00:00:00.000Z" }, undefined);
    value = 1200;
    await user.selectOptions(screen.getByLabelText("기간"), "30");
    await user.click(screen.getByRole("button", { name: "다시 실행" }));
    expect(await screen.findByRole("columnheader", { name: "이전 (기준 1000)" })).toBeInTheDocument();
    const row = screen.getByRole("row", { name: /예상 알람/ });
    expect(within(row).getAllByRole("cell").map((c) => c.textContent)).toEqual(["5", "14"]);
    expect(screen.getByRole("row", { name: /평균 지속/ })).toHaveTextContent("9분");
    expect(screen.getByRole("cell", { name: "EM500-152590" })).toBeInTheDocument();
    await waitFor(() => expect(chart.options.length).toBeGreaterThan(0));
    expect((chart.options.at(-1) as { series: { type: string }[] }).series[0].type).toBe("heatmap");
    expect(api.simulate).toHaveBeenLastCalledWith(expect.objectContaining({ from: "2026-09-04T00:00:00.000Z" }), undefined);
  });

  it("저장된 규칙은 규칙 ID 경로로, 실행 중 문구 뒤 결과와 데이터 10% 미만 안내", async () => {
    let resolve: (v: unknown) => void = () => undefined;
    const pending = new Promise((r) => (resolve = r));
    const api = fakeRulesApi({ simulate: vi.fn(async () => (await pending) as never) });
    const user = userEvent.setup();
    renderRoute(<SimulationPanel api={api} payload={() => rule(1000)} ruleId="r-1" now={() => NOW} chartFactory={fakeChart().factory} />, { session: meOf("OPERATOR") });
    await user.click(await screen.findByRole("button", { name: "실행" }));
    expect(api.simulate).toHaveBeenCalledWith(expect.anything(), "r-1");
    expect(screen.getByText("계산 중…")).toBeInTheDocument();
    resolve({ ok: true, status: 200, data: result(7, { coverage: { dataRatio: 0.05 } }) });
    expect(await screen.findByText("기간 중 데이터가 10% 미만입니다")).toBeInTheDocument();
    expect(screen.queryByText("계산 중…")).not.toBeInTheDocument();
  });

  it("폼 오류면 실행하지 않고 안내, 실패·작업 실패 문구, 기기 없음", async () => {
    const user = userEvent.setup();
    const failing = fakeRulesApi({ simulate: vi.fn(async () => ({ ok: false as const, status: 400, code: "RULE_SIMULATION_RANGE_INVALID", message: "" })) });
    const { unmount } = await renderRoute(<SimulationPanel api={failing} payload={() => null} now={() => NOW} />, { session: meOf("OPERATOR") });
    await user.click(await screen.findByRole("button", { name: "실행" }));
    expect(screen.getByText("규칙 입력 오류를 먼저 고치세요")).toBeInTheDocument();
    expect(failing.simulate).not.toHaveBeenCalled();
    unmount();
    renderRoute(<SimulationPanel api={failing} payload={() => rule(1000)} now={() => NOW} />, { session: meOf("OPERATOR") });
    await user.click(await screen.findByRole("button", { name: "실행" }));
    expect(await screen.findByText("시뮬레이션 기간은 30일까지입니다")).toBeInTheDocument();
  });

  it("결과가 비면 \"예상 알람이 없습니다\", 자동 실행(목록 [시뮬레이션])", async () => {
    const empty = fakeRulesApi({ simulate: vi.fn(async () => ({ ok: true as const, status: 200, data: { ...result(0), byDevice: [], heatmap: [], avgDurationSec: null } })) });
    renderRoute(<SimulationPanel api={empty} payload={() => rule(1000)} now={() => NOW} autoRun />, { session: meOf("OPERATOR") });
    expect(await screen.findByText("예상 알람이 없습니다")).toBeInTheDocument();
  });

  it("엔진·core가 실패하면 오류 문구, 초·분·시간 표시", async () => {
    const api = fakeRulesApi({ simulate: vi.fn(async () => ({ ok: false as const, status: 503, code: "SERVICE_UNAVAILABLE", message: "" })) });
    renderRoute(<SimulationPanel api={api} payload={() => rule(1000)} now={() => NOW} autoRun />, { session: meOf("OPERATOR") });
    await waitFor(() => expect(api.simulate).toHaveBeenCalled());
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    const t = (key: string, o?: Record<string, unknown>) => `${key}:${String(o?.n)}`;
    expect(formatSeconds(null, t)).toBe("–");
    expect(formatSeconds(30, t)).toBe("rules.sim.seconds:30");
    expect(formatSeconds(5400, t)).toBe("rules.sim.hours:1.5");
  });
});
