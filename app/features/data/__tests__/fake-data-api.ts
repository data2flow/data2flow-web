/**
 * 화면 부품 테스트용 가짜 DataApi. 부른 기록(calls)을 남기고, 응답은 `next`로 바꿔 넣는다.
 */
import { vi } from "vitest";
import type { DataApi } from "../api";
import type { ExportJob, ExportSchedule } from "../model/exports";
import type { ImportJob } from "../model/imports";

type Result<T> = { ok: true; status: number; data: T } | { ok: false; status: number; code: string; message: string; errors?: { field: string; code: string; message: string }[] };
const ok = <T>(data: T, status = 200): Result<T> => ({ ok: true, status, data });
export const failed = (status: number, code: string): Result<never> => ({ ok: false, status, code, message: "" });

export const JOB: ExportJob = {
  id: "71",
  status: "RUNNING",
  format: "CSV",
  query: { series: [{ deviceId: "1042", metric: "temperature" }], from: "2025-10-04T00:00:00Z", to: "2026-10-04T00:00:00Z" },
  rows: null,
  bytes: null,
  estimatedRows: 3_000_000,
  createdAt: "2026-10-04T00:00:00Z",
};

export const SCHEDULE: ExportSchedule = {
  id: "5",
  name: "일별 실내환경",
  query: { series: [{ deviceId: "1042", metric: "temperature" }] },
  format: "CSV",
  cron: "0 7 * * *",
  relativePeriod: "PREVIOUS_DAY",
  delivery: "EMAIL",
  recipients: ["ops@java21.net"],
  enabled: true,
  lastStatus: "FAILED",
  lastError: "인증 실패",
  lastRunAt: "2026-10-03T22:00:00Z",
  nextRunAt: "2026-10-04T22:00:00Z",
  version: 3,
};

export const IMPORT: ImportJob = {
  id: "9",
  sourceKind: "INFLUXDB",
  status: "DRY_RUN_DONE",
  dryRun: true,
  total: 1_284_300,
  inserted: 0,
  skippedDuplicate: 12_000,
  failed: 2,
  originLabel: "아카데미 iot-bucket 2026-09",
  sample: [{ devEui: "24e1…9818", error: "DEVICE_NOT_MAPPED" }],
  createdAt: "2026-10-04T00:00:00Z",
};

export function fakeDataApi(overrides: Partial<DataApi> = {}) {
  const api: DataApi = {
    createExport: vi.fn(async () => ok({ mode: "ASYNC" as const, jobId: "72", estimatedRows: 3_000_000 }, 202)),
    listExports: vi.fn(async () => ok({ responses: [JOB] })),
    getExport: vi.fn(async () => ok(JOB)),
    cancelExport: vi.fn(async () => ok({ ...JOB, status: "CANCELLED" as const })),
    listSchedules: vi.fn(async () => ok({ responses: [SCHEDULE] })),
    createSchedule: vi.fn(async (body: unknown) => ok({ ...SCHEDULE, ...(body as object), id: "6", version: 0 }, 201)),
    updateSchedule: vi.fn(async (_id: string, body: unknown) => ok({ ...SCHEDULE, ...(body as object), version: SCHEDULE.version + 1 })),
    deleteSchedule: vi.fn(async () => ok(undefined, 204)),
    testTarget: vi.fn(async () =>
      ok({
        ok: false,
        steps: [
          { name: "CONNECT", ok: true },
          { name: "WRITE", ok: false, detail: "AccessDenied" },
        ],
      }),
    ),
    createCsvImport: vi.fn(async () => ok({ ...IMPORT, id: "10", sourceKind: "CSV" as const }, 202)),
    createInfluxImport: vi.fn(async () => ok(IMPORT, 202)),
    getImport: vi.fn(async () => ok(IMPORT)),
    importErrors: vi.fn(async () => ok({ responses: [{ lineOrPoint: "24e1…9818", errorCode: "DEVICE_NOT_MAPPED", message: "매핑 안 된 기기" }] })),
    runImport: vi.fn(async () => ok({ ...IMPORT, status: "RUNNING" as const, dryRun: false, inserted: 0 }, 202)),
    previewRetention: vi.fn(async () => ok({ affectedRows: 1_200_000, affectedBytes: 180 * 1024 * 1024, byMetric: [{ scope: "METRIC", scopeRef: "LAeq", dataClass: "TELEMETRY", rows: 1_200_000, bytes: 180 * 1024 * 1024 }], shortened: true, confirmToken: "1760000000.abc" })),
    saveRetention: vi.fn(async () => ok({ effective: [], appliesAt: "2026-10-04T02:00:00Z" })),
    ...overrides,
  };
  return api;
}
