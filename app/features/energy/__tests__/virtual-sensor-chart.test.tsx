/**
 * ENE-02.02 UI-ENE-05 재실 추정 카드 — TC-ENE-042: 추정 2명·정원 4 공간의 관리 화면 차트는 축과 툴팁에 숫자 대신 "사용 중"을 보여 준다.
 * 입력 신호 선택(2개 이상), 현재 상태, 정확도 메모, 인원 숫자 없음(NFR-13.02)
 */
import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { meOf, renderRoute } from "../../../../test/render";
import { VirtualSensorTab, type VirtualSensorTabProps } from "../components/virtual-sensors";
import { occupancyBody, occupancyOption, occupancySignalsOf, validateOccupancySignals, type SensorView } from "../model/virtual-sensors";

const ACH: SensorView = { kind: "ACH", enabled: false, params: {}, outputMetrics: ["ach"], inputs: [], status: "DISABLED" };
const OCC: SensorView = {
  kind: "OCCUPANCY",
  enabled: true,
  params: { inputs: ["pir", "co2"] },
  outputMetrics: ["occupancy_est"],
  inputs: [
    { metricKey: "activity", signal: "pir", selected: true, available: true, deviceIds: ["1043"] },
    { metricKey: "co2", signal: "co2", selected: true, available: true, deviceIds: ["1042"] },
    { metricKey: "LAeq", signal: "noise", selected: false, available: false, deviceIds: [] },
    { metricKey: "illumination", signal: "illuminance", selected: false, available: false, deviceIds: [] },
  ],
  lastComputedAt: "2026-10-03T03:00:05Z",
  status: "OK",
  outputDeviceId: "9031",
  current: { state: "OCCUPIED", band: null, at: "2026-10-03T03:00:00Z" },
};
// 추정 2명·정원 4: 서버가 상태만 준다(BR-ENE-10)
const SERIES = {
  spaceId: "31",
  estimated: true,
  items: [
    { ts: "2026-10-03T01:00:00Z", state: "VACANT" as const, band: null },
    { ts: "2026-10-03T02:00:00Z", state: "OCCUPIED" as const, band: null },
  ],
};

function chart() {
  const options: Record<string, unknown>[] = [];
  const factory = async () => ({
    setOption: (o: Record<string, unknown>) => options.push(o),
    resize: () => undefined,
    dispose: () => undefined,
    showLoading: () => undefined,
    hideLoading: () => undefined,
  });
  return { options, factory: factory as unknown as VirtualSensorTabProps["chartFactory"] };
}

describe("TC-ENE-042 UI-ENE-05 재실 추정 카드", () => {
  it("차트 세로축과 툴팁은 숫자 대신 '사용 중/비어 있음', 화면에 인원 숫자가 없다", async () => {
    const { options, factory } = chart();
    await renderRoute(<VirtualSensorTab spaceId="31" sensors={[ACH, OCC]} ach={null} occupancy={SERIES} chartFactory={factory} />, { session: meOf("INTEGRATOR") });
    expect(await screen.findByText("재실 추정")).toBeTruthy();
    await waitFor(() => expect(options.length).toBeGreaterThan(0));
    const option = options[options.length - 1] as { yAxis: { type: string; data: string[] }; series: { data: [string, string | null][] }[]; tooltip: { valueFormatter: (v: unknown) => string } };
    expect(option.yAxis).toEqual({ type: "category", data: ["비어 있음", "사용 중"] });
    expect(option.series[0].data).toEqual([
      ["2026-10-03T01:00:00Z", "비어 있음"],
      ["2026-10-03T02:00:00Z", "사용 중"],
    ]);
    expect(option.tooltip.valueFormatter("사용 중")).toBe("사용 중");
    const card = document.querySelector('[data-sensor="OCCUPANCY"]')!;
    expect(card.querySelector("[data-occupancy-state]")?.textContent).toContain("사용 중");
    expect(card.textContent).not.toMatch(/\d+\s*명/);
    expect(card.querySelector("[data-accuracy]")?.textContent).toContain("정확도는 아직 계산하지 않았습니다");
    expect(card.querySelector("[data-inputs]")?.textContent).toBe("적외선(PIR): 기기 1대CO2: 기기 1대");
    expect((screen.getByRole("checkbox", { name: "적외선(PIR)" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("checkbox", { name: "소음 (기기 없음)" }) as HTMLInputElement).checked).toBe(false);
  });

  it("VIEWER는 신호 선택 폼이 없다", async () => {
    await renderRoute(<VirtualSensorTab spaceId="31" sensors={[ACH, OCC]} ach={null} occupancy={SERIES} chartFactory={chart().factory} />, { session: meOf("VIEWER") });
    expect(await screen.findByText("재실 추정")).toBeTruthy();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("신호 검사·본문·기본값, UNKNOWN은 빈칸", () => {
    expect(validateOccupancySignals(["co2"])).toEqual({ signals: "signalsMin" });
    expect(validateOccupancySignals(["co2", "co2"])).toEqual({ signals: "signalsMin" });
    expect(validateOccupancySignals(["noise", "co2"])).toEqual({});
    expect(occupancyBody(true, ["noise", "pir"])).toEqual({ enabled: true, params: { inputs: ["pir", "noise"] } });
    expect(occupancyBody(false, [])).toEqual({ enabled: false });
    expect(occupancySignalsOf(null)).toEqual(["pir", "co2", "noise"]);
    const o = occupancyOption([{ ts: "t", state: "UNKNOWN" }], { occupied: "O", vacant: "V", series: "S" }, false) as { series: { data: unknown[] }[] };
    expect(o.series[0].data).toEqual([["t", null]]);
  });
});
