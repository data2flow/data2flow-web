/** M4 제어 관리 화면 가짜 API 묶음(ControlAdminApi). 각 메서드는 vi.fn이라 호출을 확인하고 덮어쓸 수 있다 */
import { vi, type Mock } from "vitest";
import type { ControlAdminApi } from "../admin-api";
import type { Driver, EmergencyStop, Scene } from "../model/admin";

export const ok = <T>(data: T, status = 200) => ({ ok: true as const, status, data });
export const err = (status: number, code: string, message = "") => ({ ok: false as const, status, code, message });

export const SCENE: Scene = {
  sceneId: "501",
  name: "수업 모드",
  description: "강의 시작 전",
  spaceId: "31",
  itemCount: 2,
  items: [
    { target: { spaceId: "31", relation: "controls", capability: "Thermostat", includeChildren: false }, capability: "Thermostat", desired: { mode: "cool", targetTemperature: 24 } },
    { target: { deviceId: "2001" }, capability: "Switch", desired: { on: true } },
  ],
  version: 3,
  updatedAt: "2026-10-02T00:00:00Z",
};

export const STOP: EmergencyStop = {
  emergencyStopId: "9",
  scope: { type: "ORG" },
  reason: "냉방 오작동 점검",
  startedBy: { userId: "7", name: "김운영" },
  startedAt: "2026-10-04T01:20:00Z",
  active: true,
};

export const LG_DRIVER: Driver = {
  driverId: "303",
  name: "LG ThinQ 본관",
  type: "LG_THINQ",
  status: "CIRCUIT_OPEN",
  deviceCount: 1,
  config: { region: "KR", clientId: "d2f-client" },
  hasSecret: true,
  pollingSec: 60,
  ackTimeoutSec: 30,
  applyTimeoutSec: 60,
  retry: { maxAttempts: 3 },
  capabilities: ["Switch", "Thermostat"],
  version: 4,
};

export type FakeAdminApi = { [K in keyof ControlAdminApi]: ControlAdminApi[K] & Mock<ControlAdminApi[K]> };

export function fakeAdminApi(overrides: Partial<ControlAdminApi> = {}): FakeAdminApi {
  const api = {
    activeEmergencyStops: vi.fn(async () => ok({ responses: [] as EmergencyStop[] })),
    startEmergencyStop: vi.fn(async (body: { scope: EmergencyStop["scope"]; reason: string }) => ok({ id: "10", scope: body.scope, startedAt: "2026-10-04T00:00:00Z", cancelledCommands: 2 }, 201)),
    releaseEmergencyStop: vi.fn(async (id: string) => ok({ ...STOP, emergencyStopId: id, active: false })),
    activeMaintenance: vi.fn(async () => ok({ responses: [] })),
    scene: vi.fn(async () => ok(SCENE)),
    createScene: vi.fn(async (body: Record<string, unknown>) => ok({ ...SCENE, ...body, sceneId: "777", version: 1 } as Scene, 201)),
    updateScene: vi.fn(async (_id: string, body: Record<string, unknown>) => ok({ ...SCENE, ...body, version: SCENE.version + 1 } as Scene)),
    deleteScene: vi.fn(async () => ok(undefined, 204)),
    previewScene: vi.fn(async () =>
      ok({
        items: [
          {
            deviceId: "2001",
            name: "AC-1 실습실 에어컨",
            capability: "Thermostat",
            current: { mode: "off" },
            target: { mode: "cool", targetTemperature: 24 },
            willChange: true,
            predictedBlock: { reason: "INTERLOCK", message: "창문이 열려 있어 냉난방을 막았습니다" },
            offline: false,
          },
          { deviceId: "2002", name: "환기 3F-02", capability: "Ventilation", current: { mode: "off" }, target: { mode: "on", level: 2 }, willChange: true, offline: true },
          { deviceId: "2003", name: "실습실 조명", capability: "Dimmer", current: { level: 100 }, target: { level: 100 }, willChange: false },
        ],
      }),
    ),
    runScene: vi.fn(async () => ok({ sceneRunId: "sr-1" }, 202)),
    sceneRun: vi.fn(async () => ok({ status: "RUNNING", results: [{ deviceId: "2001", status: "SENT" }] })),
    schedule: vi.fn(),
    createSchedule: vi.fn(),
    updateSchedule: vi.fn(),
    deleteSchedule: vi.fn(async () => ok(undefined, 204)),
    setScheduleEnabled: vi.fn(async (id: string, enabled: boolean) => ok({ controlScheduleId: id, enabled, nextRunAt: enabled ? "2026-10-05T23:50:00Z" : null })),
    interlock: vi.fn(),
    createInterlock: vi.fn(),
    updateInterlock: vi.fn(),
    deleteInterlock: vi.fn(async () => ok(undefined, 204)),
    interlockBlocks: vi.fn(async () =>
      ok({
        responses: [
          {
            at: "2026-10-03T01:10:00Z",
            commandId: "c-2",
            deviceId: "2001",
            deviceName: "AC-1 실습실 에어컨",
            capability: "Thermostat",
            command: "set",
            message: "창문이 열려 있어 냉난방을 막았습니다",
          },
        ],
      }),
    ),
    driver: vi.fn(async () => ok(LG_DRIVER)),
    createDriver: vi.fn(),
    updateDriver: vi.fn(),
    deleteDriver: vi.fn(async () => ok(undefined, 204)),
    testDriver: vi.fn(async () => ok({ ok: true, latencyMs: 84, capabilities: ["Switch", "Thermostat"] })),
    healthcheck: vi.fn(async () => err(502, "DRIVER_HEALTHCHECK_FAILED", "드라이버에 연결할 수 없습니다: token expired")),
    driverMetrics: vi.fn(async () =>
      ok({
        status: "CIRCUIT_OPEN",
        circuit: { state: "OPEN", openedAt: "2026-10-03T23:58:00Z" },
        requests: 50,
        errors: 31,
        errorRate: 0.62,
        avgMs: null,
        p95Ms: null,
        recentErrors: [{ at: "2026-10-03T23:58:00Z", commandId: "c-x", message: "token expired" }],
      }),
    ),
    capability: vi.fn(),
    createCapability: vi.fn(),
    updateCapability: vi.fn(),
    bulkPreview: vi.fn(),
    bulkRun: vi.fn(),
    bulkJob: vi.fn(),
    runtime: vi.fn(),
    ...overrides,
  };
  return api as unknown as FakeAdminApi;
}
