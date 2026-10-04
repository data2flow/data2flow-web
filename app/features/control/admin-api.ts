/**
 * M4 제어 관리 화면이 브라우저에서 부르는 API(BFF `/bff/api/core/**`, design/api/ACT-api.md·OPS-api.md·DEV-api.md).
 * 화면 부품은 이 묶음을 받아 쓰고, 테스트는 가짜 묶음을 넣는다.
 */
import { bffJson, clientIdempotencyKey, type BffJsonResult } from "~/lib/bff-client";
import type {
  BulkJob,
  BulkPreviewDevice,
  CapabilityDefinition,
  Driver,
  DriverMetrics,
  EmergencyStop,
  HealthcheckResult,
  Interlock,
  MaintenanceWindow,
  RuntimeReport,
  Scene,
  ScenePreviewItem,
  SceneRun,
  Schedule,
} from "./model/admin";

type R<T> = Promise<BffJsonResult<T>>;
type ListOf<T> = { responses: T[]; totalCount?: number };

export interface BulkRequest {
  target: { deviceIds: string[] } | { spaceId: string; includeChildren: boolean; capability: string };
  capability: string;
  command: string;
  args: Record<string, unknown>;
  preview?: boolean;
}

export interface ControlAdminApi {
  /** API-ACT-21 전역 띠(모든 로그인 사용자) */
  activeEmergencyStops(): R<ListOf<EmergencyStop>>;
  /** API-ACT-20 */
  startEmergencyStop(body: { scope: EmergencyStop["scope"]; reason: string }): R<{ id: string; scope: EmergencyStop["scope"]; startedAt: string; cancelledCommands?: number }>;
  /** API-ACT-21 */
  releaseEmergencyStop(id: string, note?: string): R<EmergencyStop>;
  /** API-OPS-23 진행 중 유지보수 */
  activeMaintenance(): R<ListOf<MaintenanceWindow>>;

  /** API-ACT-10~12 */
  scene(id: string): R<Scene>;
  createScene(body: Record<string, unknown>): R<Scene>;
  updateScene(id: string, body: Record<string, unknown>): R<Scene>;
  deleteScene(id: string): R<void>;
  previewScene(id: string): R<{ items: ScenePreviewItem[] }>;
  runScene(id: string): R<{ sceneRunId: string }>;
  sceneRun(runId: string): R<SceneRun>;

  /** API-ACT-15 */
  schedule(id: string): R<Schedule>;
  createSchedule(body: Record<string, unknown>): R<Schedule>;
  updateSchedule(id: string, body: Record<string, unknown>): R<Schedule>;
  deleteSchedule(id: string): R<void>;
  setScheduleEnabled(id: string, enabled: boolean): R<{ controlScheduleId: string; enabled: boolean; nextRunAt?: string | null }>;

  /** API-ACT-16 */
  interlock(id: string): R<Interlock>;
  createInterlock(body: Record<string, unknown>): R<Interlock>;
  updateInterlock(id: string, body: Record<string, unknown>): R<Interlock>;
  deleteInterlock(id: string): R<void>;
  interlockBlocks(id: string): R<ListOf<{ at: string; commandId: string; deviceId: string; deviceName?: string; capability: string; command: string; message?: string }>>;

  /** API-ACT-30~32 */
  driver(id: string): R<Driver>;
  createDriver(body: Record<string, unknown>): R<Driver>;
  updateDriver(id: string, body: Record<string, unknown>): R<Driver>;
  deleteDriver(id: string): R<void>;
  testDriver(body: Record<string, unknown>): R<HealthcheckResult>;
  healthcheck(id: string): R<HealthcheckResult>;
  driverMetrics(id: string, window: "1h" | "24h"): R<DriverMetrics>;

  /** API-ACT-25 */
  capability(name: string): R<CapabilityDefinition>;
  createCapability(body: CapabilityDefinition): R<CapabilityDefinition>;
  updateCapability(name: string, body: Omit<CapabilityDefinition, "name">): R<CapabilityDefinition>;

  /** API-ACT-05 */
  bulkPreview(body: BulkRequest): R<{ devices: BulkPreviewDevice[] }>;
  bulkRun(body: BulkRequest, idempotencyKey?: string): R<{ bulkJobId: string; total: number }>;
  bulkJob(id: string): R<BulkJob>;

  /** API-ACT-35 */
  runtime(deviceId: string, from: string, to: string, step: "day" | "month"): R<RuntimeReport>;
}

const base = "/bff/api/core";
const enc = encodeURIComponent;

export const controlAdminApi: ControlAdminApi = {
  activeEmergencyStops: () => bffJson(`${base}/emergency-stops?active=true`),
  startEmergencyStop: (body) => bffJson(`${base}/emergency-stops`, { method: "POST", body, idempotencyKey: clientIdempotencyKey() }),
  releaseEmergencyStop: (id, note) => bffJson(`${base}/emergency-stops/${enc(id)}/release`, { method: "POST", body: note ? { note } : {} }),
  activeMaintenance: () => bffJson(`${base}/maintenance-windows?status=ACTIVE`),

  scene: (id) => bffJson(`${base}/scenes/${enc(id)}`),
  createScene: (body) => bffJson(`${base}/scenes`, { method: "POST", body, idempotencyKey: clientIdempotencyKey() }),
  updateScene: (id, body) => bffJson(`${base}/scenes/${enc(id)}`, { method: "PUT", body }),
  deleteScene: (id) => bffJson(`${base}/scenes/${enc(id)}`, { method: "DELETE" }),
  previewScene: (id) => bffJson(`${base}/scenes/${enc(id)}/preview`, { method: "POST", body: {} }),
  runScene: (id) => bffJson(`${base}/scenes/${enc(id)}/run`, { method: "POST", body: {}, idempotencyKey: clientIdempotencyKey() }),
  sceneRun: (runId) => bffJson(`${base}/scene-runs/${enc(runId)}`),

  schedule: (id) => bffJson(`${base}/control-schedules/${enc(id)}`),
  createSchedule: (body) => bffJson(`${base}/control-schedules`, { method: "POST", body, idempotencyKey: clientIdempotencyKey() }),
  updateSchedule: (id, body) => bffJson(`${base}/control-schedules/${enc(id)}`, { method: "PUT", body }),
  deleteSchedule: (id) => bffJson(`${base}/control-schedules/${enc(id)}`, { method: "DELETE" }),
  setScheduleEnabled: (id, enabled) => bffJson(`${base}/control-schedules/${enc(id)}/${enabled ? "enable" : "disable"}`, { method: "POST", body: {} }),

  interlock: (id) => bffJson(`${base}/interlocks/${enc(id)}`),
  createInterlock: (body) => bffJson(`${base}/interlocks`, { method: "POST", body, idempotencyKey: clientIdempotencyKey() }),
  updateInterlock: (id, body) => bffJson(`${base}/interlocks/${enc(id)}`, { method: "PUT", body }),
  deleteInterlock: (id) => bffJson(`${base}/interlocks/${enc(id)}`, { method: "DELETE" }),
  interlockBlocks: (id) => bffJson(`${base}/interlocks/${enc(id)}/blocks?size=20`),

  driver: (id) => bffJson(`${base}/drivers/${enc(id)}`),
  createDriver: (body) => bffJson(`${base}/drivers`, { method: "POST", body, idempotencyKey: clientIdempotencyKey() }),
  updateDriver: (id, body) => bffJson(`${base}/drivers/${enc(id)}`, { method: "PUT", body }),
  deleteDriver: (id) => bffJson(`${base}/drivers/${enc(id)}`, { method: "DELETE" }),
  testDriver: (body) => bffJson(`${base}/drivers/test`, { method: "POST", body }),
  healthcheck: (id) => bffJson(`${base}/drivers/${enc(id)}/healthcheck`, { method: "POST", body: {} }),
  driverMetrics: (id, window) => bffJson(`${base}/drivers/${enc(id)}/metrics?window=${window}`),

  capability: (name) => bffJson(`${base}/capabilities/${enc(name)}`),
  createCapability: (body) => bffJson(`${base}/capabilities`, { method: "POST", body }),
  updateCapability: (name, body) => bffJson(`${base}/capabilities/${enc(name)}`, { method: "PUT", body }),

  bulkPreview: (body) => bffJson(`${base}/commands/bulk`, { method: "POST", body: { ...body, preview: true }, idempotencyKey: clientIdempotencyKey() }),
  bulkRun: (body, key) => bffJson(`${base}/commands/bulk`, { method: "POST", body: { ...body, preview: false }, idempotencyKey: key ?? clientIdempotencyKey() }),
  bulkJob: (id) => bffJson(`${base}/command-bulk-jobs/${enc(id)}`),

  runtime: (deviceId, from, to, step) => bffJson(`${base}/devices/${enc(deviceId)}/runtime?${new URLSearchParams({ from, to, step })}`),
};
