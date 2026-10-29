/**
 * ENE-01.04 UI-ENE-04 기준선 설정 — TC-ENE-028: 방식·기간·R²가 보이고 R² < 0.5면 경고 배지, 409 ENE_BASELINE_INSUFFICIENT_DATA면 "5일 더 필요".
 * 계산·적용은 ENE_ANALYZE만(VIEWER는 결과만 본다).
 */
import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { meOf, renderRoute } from "../../../../test/render";
import { BaselineSettings, type BaselineSettingsProps } from "../components/baseline-settings";
import { baselineBody, lowFit, neededDaysOf, periodDays, validateBaselineForm, type BaselineForm } from "../model/baseline";

const VERSIONS: BaselineSettingsProps["versions"] = [
  { versionId: "702", baselineId: "601", method: "DEGREE_DAY_REGRESSION", trainFrom: "2026-06-01", trainTo: "2026-09-30", status: "READY", r2: 0.41, warning: "LOW_FIT" },
  { versionId: "701", baselineId: "601", method: "PERIOD_AVERAGE", trainFrom: "2026-03-01", trainTo: "2026-05-31", status: "ACTIVE", r2: 0.82 },
];

function props(over: Partial<BaselineSettingsProps> = {}): BaselineSettingsProps {
  return {
    scopeSpaceId: "2",
    baseline: { baselineId: "601", scopeSpace: { id: "2", name: "본관" }, activeVersion: { versionId: "701", method: "PERIOD_AVERAGE", r2: 0.82, trainFrom: "2026-03-01", trainTo: "2026-05-31" } },
    versions: VERSIONS,
    detail: { ...VERSIONS[0], scopeSpaceId: "2", coefficients: { intercept: 180.5, cdd: 9.2, hdd: 0, weekend: -40.1 }, residuals: [] },
    devices: [{ id: "1001", name: "외기 온도계" }],
    defaults: { trainFrom: "2026-07-05", trainTo: "2026-10-02" },
    versionHref: (v) => `/energy?scope=2&tab=baseline&version=${v}`,
    ...over,
  };
}

describe("TC-ENE-028 UI-ENE-04 기준선 설정", () => {
  it("방식·기간·R²와 계수, R² < 0.5 경고 배지, READY에만 [적용]", async () => {
    await renderRoute(<BaselineSettings {...props()} />, { session: meOf("INTEGRATOR") });
    expect(await screen.findByText("적용 중: 기간 평균 · 2026-03-01 ~ 2026-05-31 · R² 0.820")).toBeTruthy();
    const result = document.querySelector("[data-version='702']") as HTMLElement;
    expect(within(result).getByText("외기 온도 보정 회귀")).toBeTruthy();
    expect(within(result).getByText("2026-06-01 ~ 2026-09-30")).toBeTruthy();
    expect(within(result).getByText("R² 0.410")).toBeTruthy();
    expect(within(result).getByText("적합도 낮음(R² < 0.5)")).toBeTruthy();
    expect(within(result).getByText("9.20")).toBeTruthy();
    const ready = document.querySelector("[data-version-row='702']") as HTMLElement;
    const active = document.querySelector("[data-version-row='701']") as HTMLElement;
    expect(within(ready).getByRole("button", { name: "적용" })).toBeTruthy();
    expect(within(active).queryByRole("button", { name: "적용" })).toBeNull();
    expect(within(active).queryByText("적합도 낮음(R² < 0.5)")).toBeNull();
    expect(screen.getByRole("button", { name: "계산" })).toBeTruthy();
    expect((screen.getByLabelText("학습 시작일") as HTMLInputElement).value).toBe("2026-07-05");
  });

  it('409 ENE_BASELINE_INSUFFICIENT_DATA면 "5일 더 필요", 실패 버전은 사유', async () => {
    const error = { code: "ENE_BASELINE_INSUFFICIENT_DATA", errors: [{ field: "neededDays", code: "NeededDays", message: "5" }] };
    await renderRoute(<BaselineSettings {...props({ error })} />, { session: meOf("INTEGRATOR") });
    expect(await screen.findByText("학습 기간이 짧습니다. 5일 더 필요합니다(최소 30일)")).toBeTruthy();
  });

  it("VIEWER는 결과·버전만 보고 계산·적용은 없다, 기준선이 없으면 안내", async () => {
    await renderRoute(<BaselineSettings {...props({ baseline: null, versions: [], detail: { ...VERSIONS[0], status: "FAILED", r2: null, warning: null, errorCode: "NO_WEATHER", scopeSpaceId: "2", residuals: [] } })} />, {
      session: meOf("VIEWER"),
    });
    expect(await screen.findByText(/적용된 기준선이 없습니다/)).toBeTruthy();
    expect(screen.getByText("학습 기간에 기온 데이터가 없습니다")).toBeTruthy();
    expect(screen.getByText("아직 계산한 기준선이 없습니다")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "계산" })).toBeNull();
  });
});

describe("기준선 화면 계산", () => {
  const form: BaselineForm = { method: "DEGREE_DAY_REGRESSION", trainFrom: "2026-07-01", trainTo: "2026-09-30", coolingBaseC: "24", heatingBaseC: "", splitWeekday: true, temperatureDeviceId: "1001", temperatureMetricKey: "" };

  it("기간 일 수·LOW_FIT·neededDays", () => {
    expect(periodDays("2026-09-01", "2026-09-30")).toBe(30);
    expect(lowFit({ r2: 0.49 })).toBe(true);
    expect(lowFit({ r2: 0.5 })).toBe(false);
    expect(lowFit({ r2: 0.9, warning: "LOW_FIT" })).toBe(true);
    expect(neededDaysOf({ code: "ENE_BASELINE_INSUFFICIENT_DATA", errors: [{ field: "neededDays", message: "1" }] })).toBe(1);
    expect(neededDaysOf({ code: "SPACE_NOT_FOUND" })).toBeNull();
  });

  it("검사와 요청 본문(기온 원천은 회귀일 때만, 항목 기본 temperature)", () => {
    expect(validateBaselineForm(form)).toEqual({});
    expect(validateBaselineForm({ ...form, temperatureDeviceId: "" })).toEqual({ temperatureDeviceId: "required" });
    expect(validateBaselineForm({ ...form, trainTo: "2026-06-01" })).toEqual({ trainTo: "order" });
    expect(validateBaselineForm({ ...form, trainFrom: "2024-01-01" })).toEqual({ trainTo: "tooLong" });
    expect(validateBaselineForm({ ...form, coolingBaseC: "x" })).toEqual({ coolingBaseC: "number" });
    expect(baselineBody("2", form)).toEqual({ scopeSpaceId: "2", method: "DEGREE_DAY_REGRESSION", trainFrom: "2026-07-01", trainTo: "2026-09-30",
      params: { coolingBaseC: 24, heatingBaseC: undefined, splitWeekday: true }, temperatureSource: { deviceId: "1001", metricKey: "temperature" } });
    expect(baselineBody("2", { ...form, method: "PERIOD_AVERAGE" }).temperatureSource).toBeNull();
  });
});
