/**
 * M5 데이터 관리 화면이 브라우저에서 부르는 API(BFF `/bff/api/core/**`, design/api/TSD-api.md §2~§4, OPS-api.md API-OPS-03).
 * 화면 부품은 이 묶음을 받아 쓰고, 테스트는 가짜 묶음을 넣는다.
 */
import { bffFetch, bffJson, clientIdempotencyKey, type BffJsonResult } from "~/lib/bff-client";
import type { ExportCreated, ExportJob, ExportSchedule, TargetTestResult } from "./model/exports";
import type { ImportError, ImportJob } from "./model/imports";
import type { PreviewResponse, SaveResponse } from "./model/retention";

type R<T> = Promise<BffJsonResult<T>>;
export type ListOf<T> = { responses: T[]; totalCount?: number; totalPages?: number; page?: number };

export interface DataApi {
  /** API-TSD-20 */
  createExport(body: unknown): R<ExportCreated>;
  /** API-TSD-21 */
  listExports(page?: number): R<ListOf<ExportJob>>;
  getExport(id: string): R<ExportJob>;
  /** API-TSD-22 */
  cancelExport(id: string): R<ExportJob>;
  /** API-TSD-23 */
  listSchedules(): R<ListOf<ExportSchedule>>;
  createSchedule(body: unknown): R<ExportSchedule>;
  updateSchedule(id: string, body: unknown): R<ExportSchedule>;
  deleteSchedule(id: string): R<void>;
  /** API-TSD-56 */
  testTarget(body: unknown): R<TargetTestResult>;
  /** API-TSD-30 CSV(multipart) */
  createCsvImport(file: File, mapping: unknown, originLabel: string, dryRun: boolean): R<ImportJob>;
  /** API-TSD-30 InfluxDB */
  createInfluxImport(body: unknown): R<ImportJob>;
  /** API-TSD-31 */
  getImport(id: string): R<ImportJob>;
  importErrors(id: string): R<ListOf<ImportError>>;
  /** API-TSD-32 */
  runImport(id: string): R<ImportJob>;
  /** API-TSD-41 */
  previewRetention(items: unknown[]): R<PreviewResponse>;
  /** API-TSD-42 */
  saveRetention(items: unknown[], confirmToken?: string | null): R<SaveResponse>;
}

const enc = encodeURIComponent;

export const defaultDataApi: DataApi = {
  createExport: (body) => bffJson("/bff/api/core/exports", { method: "POST", body, idempotencyKey: clientIdempotencyKey() }),
  listExports: (page = 1) => bffJson(`/bff/api/core/exports?page=${page}&size=20`),
  getExport: (id) => bffJson(`/bff/api/core/exports/${enc(id)}`),
  cancelExport: (id) => bffJson(`/bff/api/core/exports/${enc(id)}/cancel`, { method: "POST", idempotencyKey: clientIdempotencyKey() }),
  listSchedules: () => bffJson("/bff/api/core/export-schedules?size=100"),
  createSchedule: (body) => bffJson("/bff/api/core/export-schedules", { method: "POST", body, idempotencyKey: clientIdempotencyKey() }),
  updateSchedule: (id, body) => bffJson(`/bff/api/core/export-schedules/${enc(id)}`, { method: "PATCH", body }),
  deleteSchedule: (id) => bffJson(`/bff/api/core/export-schedules/${enc(id)}`, { method: "DELETE" }),
  testTarget: (body) => bffJson("/bff/api/core/export-schedules/test-target", { method: "POST", body }),
  createCsvImport: async (file, mapping, originLabel, dryRun) => {
    const form = new FormData();
    form.set("file", file);
    form.set("mapping", JSON.stringify(mapping));
    form.set("originLabel", originLabel);
    form.set("dryRun", String(dryRun));
    let response: Response;
    try {
      response = await bffFetch("/bff/api/core/imports", { method: "POST", body: form, headers: { Accept: "application/json", "Idempotency-Key": clientIdempotencyKey() } });
    } catch {
      return { ok: false, status: 0, code: "SERVICE_UNAVAILABLE", message: "" };
    }
    const body = (await response.json().catch(() => null)) as { header?: { resultCode?: string; resultMessage?: string }; response?: ImportJob; errors?: { field: string; code: string; message: string }[] } | null;
    if (response.ok && body?.response) return { ok: true, status: response.status, data: body.response };
    return { ok: false, status: response.status, code: body?.header?.resultCode ?? "UNKNOWN", message: body?.header?.resultMessage ?? "", errors: body?.errors };
  },
  createInfluxImport: (body) => bffJson("/bff/api/core/imports", { method: "POST", body, idempotencyKey: clientIdempotencyKey() }),
  getImport: (id) => bffJson(`/bff/api/core/imports/${enc(id)}`),
  importErrors: (id) => bffJson(`/bff/api/core/imports/${enc(id)}/errors?size=100`),
  runImport: (id) => bffJson(`/bff/api/core/imports/${enc(id)}/run`, { method: "POST", idempotencyKey: clientIdempotencyKey() }),
  previewRetention: (items) => bffJson("/bff/api/core/retention-policies/preview", { method: "POST", body: { items } }),
  saveRetention: (items, confirmToken) => bffJson("/bff/api/core/retention-policies", { method: "PUT", body: { items, ...(confirmToken ? { confirmToken } : {}) } }),
};

/** 파일 내려받기(동기 내보내기·사전 JSON). 테스트에서는 바꿔 넣는다 */
export type Downloader = (href: string, fileName?: string) => void;

export const browserDownload: Downloader = (href, fileName) => {
  const a = document.createElement("a");
  a.href = href;
  if (fileName) a.download = fileName;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
};
