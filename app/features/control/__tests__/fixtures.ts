/** 제어 화면 테스트 공용 데이터: 가상 실습실 에어컨(Switch·Thermostat, 모델·조직 한계 18~28℃) */
import type { CapabilityControl, Command, ControlInfo } from "../model/control";

export const THERMOSTAT: CapabilityControl = {
  name: "Thermostat",
  version: 1,
  attributes: [
    { name: "mode", type: "enum", enum: ["off", "cool", "heat", "dry", "fan", "auto"] },
    { name: "targetTemperature", type: "number", unit: "℃", min: 5, max: 35, step: 0.5 },
    { name: "currentTemperature", type: "number", unit: "℃", readOnly: true },
  ],
  commands: [{ name: "set", sets: ["mode", "targetTemperature"] }],
  effectiveConstraints: { mode: { enum: ["off", "cool", "heat", "auto"] }, targetTemperature: { min: 18, max: 28 } },
};

export const SWITCH: CapabilityControl = { name: "Switch", attributes: [{ name: "on", type: "boolean" }], commands: [{ name: "set", sets: ["on"] }] };

export function aircon(overrides: Partial<ControlInfo> = {}): ControlInfo {
  return {
    controllable: true,
    driver: { id: "301", name: "가상 드라이버", type: "VIRTUAL", status: "OK" },
    capabilities: [SWITCH, THERMOSTAT],
    shadow: {
      desired: { Switch: { on: true }, Thermostat: { mode: "cool", targetTemperature: 26 } },
      desiredVersion: 4,
      reported: { Switch: { on: true }, Thermostat: { mode: "cool", targetTemperature: 26, currentTemperature: 27.4 } },
      reportedAt: "2026-10-03T23:59:00Z",
      delta: {},
      connectivity: "ONLINE",
    },
    pending: [],
    ...overrides,
  };
}

export const FLOW_COMMAND: Command = {
  id: "c-1",
  status: "APPLIED",
  deviceId: "2001",
  deviceName: "AC-1 실습실 에어컨",
  capability: "Thermostat",
  command: "set",
  args: { mode: "cool", targetTemperature: 24 },
  priority: "AUTO",
  source: { type: "FLOW", flowId: "f-7f3a", flowName: "고온이면 냉방", flowVersion: 13, nodeId: "n-act-1" },
  timeline: [
    { status: "REQUESTED", at: "2026-10-03T01:12:03Z" },
    { status: "APPLIED", at: "2026-10-03T01:12:05.100Z" },
  ],
  idempotencyKey: "b3c1sha256",
};
