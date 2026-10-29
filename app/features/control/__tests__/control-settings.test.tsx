/**
 * ACT-06.04 UI-ACT-08 조직 제어 한계·보호 설정: 화면 검사(표준 범위·최소>최대·정수 범위), 저장 본문(API-ACT-17 baseVersion),
 * 서버 거절 LIMIT_WIDER_THAN_MODEL(BR-ACT-09)은 그 줄에 표시.
 */
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderRoute } from "../../../../test/render";
import { ControlSettingsEditor } from "../control-settings";
import { limitTargets, settingsBody, settingsProblems, settingsToForm, type ControlSettings } from "../model/settings";

const SETTINGS: ControlSettings = {
  absoluteLimits: { Thermostat: { targetTemperature: { min: 18, max: 28 } } },
  manualOverrideMinutes: 30,
  minIntervalSec: 10,
  oscillation: { windowSec: 60, flips: 3 },
  defaultValiditySec: 600,
  scheduleRespectsManualOverride: true,
  requireApprovalForControlNodes: false,
  version: 2,
  updatedBy: { userId: "1", name: "관리자" },
  updatedAt: "2026-10-04T00:00:00Z",
};
const TARGETS = limitTargets([
  { name: "Thermostat", attributes: [{ name: "mode", type: "enum" }, { name: "targetTemperature", type: "number", unit: "°C", min: 5, max: 35 }, { name: "currentTemperature", type: "number", readOnly: true }] },
  { name: "Dimmer", attributes: [{ name: "level", type: "integer", unit: "%", min: 0, max: 100 }] },
  { name: "Switch", attributes: [{ name: "on", type: "boolean" }] },
]);

describe("UI-ACT-08 화면 모델", () => {
  it("한계를 둘 수 있는 속성은 쓰기 가능한 숫자 속성뿐이다", () => {
    expect(TARGETS.map((t) => [t.capability, t.attributes.map((a) => a.name)])).toEqual([
      ["Thermostat", ["targetTemperature"]],
      ["Dimmer", ["level"]],
    ]);
  });

  it("표준 범위 밖·최소>최대·중복·정수 범위를 검사하고, 본문은 기능별로 묶는다", () => {
    const form = settingsToForm(SETTINGS);
    expect(settingsProblems(form, TARGETS)).toEqual([]);
    const bad = { ...form, manualOverrideMinutes: "-1", limits: [{ capability: "Thermostat", attribute: "targetTemperature", min: "30", max: "20" }, { capability: "Thermostat", attribute: "targetTemperature", min: "1", max: "" }] };
    expect(settingsProblems(bad, TARGETS)).toEqual(["manualOverrideMinutes", "limits.0.range", "limits.1.duplicate", "limits.1.standard"]);
    expect(settingsBody({ ...form, limits: [...form.limits, { capability: "Dimmer", attribute: "level", min: "", max: "80" }] }, 2)).toMatchObject({
      absoluteLimits: { Thermostat: { targetTemperature: { min: 18, max: 28 } }, Dimmer: { level: { max: 80 } } },
      oscillation: { windowSec: 60, flips: 3 },
      baseVersion: 2,
    });
  });
});

describe("UI-ACT-08 ControlSettingsEditor", () => {
  it("한계를 추가해 저장하고, 모델 범위보다 넓으면 그 줄에 안내한다", async () => {
    const user = userEvent.setup();
    const save = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 400, code: "LIMIT_WIDER_THAN_MODEL", message: "", errors: [{ field: "absoluteLimits.Dimmer.level", code: "LIMIT_WIDER_THAN_MODEL", message: "" }] })
      .mockImplementationOnce(async (body) => ({ ok: true, status: 200, data: { ...SETTINGS, absoluteLimits: body.absoluteLimits, version: 3 } }));
    await renderRoute(<ControlSettingsEditor initial={SETTINGS} targets={TARGETS} timezone="Asia/Seoul" lang="ko" api={{ save }} />);
    expect(await screen.findByDisplayValue("18")).toBeInTheDocument();
    expect(screen.getByText("5 ~ 35 °C")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "+ 한계 추가" }));
    await user.selectOptions(screen.getByLabelText("2번째 한계 기능"), "Dimmer");
    await user.click(screen.getByRole("button", { name: "저장" }));
    expect(await screen.findByText("최소 또는 최대를 넣고, 최소는 최대보다 클 수 없습니다.")).toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText("2번째 한계 최대"), "90");
    await user.click(screen.getByRole("button", { name: "저장" }));
    expect(await screen.findByText("모델 범위보다 넓게 정할 수 없습니다.")).toBeInTheDocument();
    expect(save.mock.calls[0][0]).toMatchObject({ absoluteLimits: { Dimmer: { level: { max: 90 } } }, baseVersion: 2 });

    await user.clear(screen.getByLabelText("2번째 한계 최대"));
    await user.type(screen.getByLabelText("2번째 한계 최대"), "80");
    await user.click(screen.getByRole("button", { name: "저장" }));
    expect(await screen.findByText("제어 설정을 저장했습니다.")).toBeInTheDocument();
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  });

  it("보호 기본값의 정수 범위를 검사한다", async () => {
    const user = userEvent.setup();
    const save = vi.fn();
    await renderRoute(<ControlSettingsEditor initial={SETTINGS} targets={TARGETS} timezone="Asia/Seoul" lang="ko" api={{ save }} />);
    const validity = await screen.findByLabelText("명령 기본 유효 시간(초)");
    await user.clear(validity);
    await user.type(validity, "30");
    await user.click(screen.getByRole("button", { name: "저장" }));
    expect(await screen.findByText("60~3600 사이 정수를 넣으세요.")).toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
  });
});
