/**
 * ENE-02.01 UI-ENE-05 가상 센서 탭 — TC-ENE-048: 카드에 계산식·입력 항목·마지막 계산 시각과 "추정치" 배지가 보이고,
 * 층고가 없어 409가 오면 "공간 면적과 층고를 입력하세요"와 공간 편집 링크가 나온다. 켜기·설정은 ENE_ADMIN만
 */
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { meOf, renderRoute } from "../../../../test/render";
import { VirtualSensorTab, type VirtualSensorTabProps } from "../components/virtual-sensors";
import { achBody, failureKind, latest, validateAchForm, type SensorView } from "../model/virtual-sensors";

const SENSOR: SensorView = {
  kind: "ACH",
  enabled: true,
  params: { outdoorCo2Mode: "FIXED", outdoorCo2Ppm: 430, minDecayMinutes: 30 },
  outputMetrics: ["ach", "ventilation_m3h"],
  inputs: [{ metricKey: "co2", available: true, deviceIds: ["1042"] }],
  lastComputedAt: "2026-10-03T17:00:05Z",
  status: "OK",
  missing: null,
  volumeM3: 150,
};

const factory = async () => ({ setOption: () => undefined, resize: () => undefined, dispose: () => undefined, showLoading: () => undefined, hideLoading: () => undefined });

function props(over: Partial<VirtualSensorTabProps> = {}): VirtualSensorTabProps {
  return {
    spaceId: "31",
    sensors: [SENSOR],
    ach: { spaceId: "31", volumeM3: 150, outdoorCo2Ppm: 430, items: [{ day: "2026-10-03", ach: 2, ciLow: 1.9, ciHigh: 2.1, ventilationM3h: 300, decayWindow: null, fitR2: 0.99 }] },
    chartFactory: factory as unknown as VirtualSensorTabProps["chartFactory"],
    ...over,
  };
}

describe("TC-ENE-048 UI-ENE-05 가상 센서 탭", () => {
  it("계산식·입력 항목·마지막 계산 시각, 추정치 배지, 최근 ACH·환기량·신뢰 구간", async () => {
    await renderRoute(<VirtualSensorTab {...props()} />, { session: meOf("INTEGRATOR") });
    expect(await screen.findByText("환기율(ACH)")).toBeTruthy();
    expect(screen.getByText("추정치")).toBeTruthy();
    expect(screen.getByText("정상")).toBeTruthy();
    expect(document.querySelector("[data-formula]")?.textContent).toContain("환기량 = ACH × 부피");
    expect(document.querySelector("[data-inputs]")?.textContent).toBe("CO2: 기기 1대");
    expect(document.querySelector("[data-last-computed]")?.textContent).toContain("2026");
    expect(screen.getByText("150.0 ㎥")).toBeTruthy();
    expect(screen.getByText("2.00 1/h")).toBeTruthy();
    expect(screen.getByText("300 ㎥/h")).toBeTruthy();
    expect(screen.getByText("신뢰 구간 1.90~2.10")).toBeTruthy();
    expect((screen.getByLabelText("실외 CO2 기준(ppm)") as HTMLInputElement).value).toBe("430");
    expect(screen.getByRole("button", { name: "저장" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "끄기" })).toBeTruthy();
  });

  it("409 ENE_SPACE_VOLUME_REQUIRED면 안내와 공간 편집 링크, 입력 없음이면 없는 항목", async () => {
    const off: SensorView = { ...SENSOR, enabled: false, status: "DISABLED", lastComputedAt: null, volumeM3: null };
    await renderRoute(<VirtualSensorTab {...props({ sensors: [off], ach: null, error: { code: "ENE_SPACE_VOLUME_REQUIRED" } })} />, { session: meOf("INTEGRATOR") });
    expect(await screen.findByText("공간 면적과 층고를 입력하세요")).toBeTruthy();
    const links = screen.getAllByRole("link", { name: /공간 정보 편집|면적·층고를 입력하세요/ });
    expect(links.every((a) => a.getAttribute("href") === "/spaces/31?tab=props")).toBe(true);
    expect(screen.getByText("꺼짐")).toBeTruthy();
    expect(screen.getByText("아직 계산하지 않았습니다")).toBeTruthy();
    expect(screen.getByRole("button", { name: "켜기" })).toBeTruthy();
  });

  it("입력 센서가 없다는 409와 VIEWER(설정 폼 없음)", async () => {
    const error = { code: "ENE_VIRTUAL_SENSOR_INPUT_MISSING", errors: [{ field: "inputs", code: "co2" }] };
    await renderRoute(<VirtualSensorTab {...props({ error })} />, { session: meOf("VIEWER") });
    expect(await screen.findByText("공간에 필요한 입력 센서가 없습니다: CO2")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "저장" })).toBeNull();
    expect(screen.queryByLabelText("실외 CO2 기준(ppm)")).toBeNull();
  });

  it("설정값 검사·본문·최근값·409 분류", () => {
    expect(validateAchForm({ outdoorCo2Ppm: "420", minDecayMinutes: "30" })).toEqual({});
    expect(validateAchForm({ outdoorCo2Ppm: "200", minDecayMinutes: "30.5" })).toEqual({ outdoorCo2Ppm: "outdoorRange", minDecayMinutes: "minutesRange" });
    expect(achBody(true, { outdoorCo2Ppm: "450", minDecayMinutes: "45" })).toEqual({ enabled: true, params: { outdoorCo2Mode: "FIXED", outdoorCo2Ppm: 450, minDecayMinutes: 45 } });
    expect(achBody(false, { outdoorCo2Ppm: "", minDecayMinutes: "" })).toEqual({ enabled: false });
    expect(latest({ spaceId: "1", outdoorCo2Ppm: 420, items: [] })).toBeNull();
    expect(failureKind({ code: "ENE_VIRTUAL_SENSOR_INPUT_MISSING", errors: [{ code: "co2" }] })).toEqual({ kind: "input", missing: ["co2"] });
    expect(failureKind({ code: "SPACE_NOT_FOUND" })).toBeNull();
  });
});
