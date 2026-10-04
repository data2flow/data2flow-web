/**
 * 기기·모델 데이터 관리 화면이 브라우저에서 부르는 API(BFF `/bff/api/core/**`, design/api/DEV-api.md).
 * - 저장된 검색 API-DEV-134 · 모델 가져오기·내보내기 API-DEV-44·45 · 표준 형식 내보내기 API-DEV-135 · NGSI-LD 주기 전송 API-DEV-136
 * - 출력 연결 목록(주기 전송 대상, API-DSC-30)
 */
import { bffFetch, bffJson, clientIdempotencyKey, type BffJsonResult } from "~/lib/bff-client";
import type { ExportJob, ImportResult, ModelExportFormat, NgsiPush, SavedSearch, StandardExportRequest } from "./model/types";

export interface ListBody<T> {
  responses: T[];
  totalCount?: number;
}

export interface ImportInput {
  file: File;
  format?: "" | "data2flow" | "dtdl";
  createMissingMetrics: boolean;
  dryRun: boolean;
}

export interface DevModelApi {
  savedSearches(): Promise<BffJsonResult<ListBody<SavedSearch>>>;
  saveSearch(body: { name: string; query: string; shared: boolean }, id?: string): Promise<BffJsonResult<SavedSearch>>;
  deleteSearch(id: string): Promise<BffJsonResult<void>>;
  exportModel(modelId: string, format: ModelExportFormat): Promise<BffJsonResult<unknown>>;
  importModel(input: ImportInput): Promise<BffJsonResult<ImportResult>>;
  exportStandard(body: StandardExportRequest): Promise<BffJsonResult<{ jobId: string; status: string }>>;
  exportJob(jobId: string): Promise<BffJsonResult<ExportJob>>;
  ngsiPushes(): Promise<BffJsonResult<ListBody<NgsiPush>>>;
  createNgsiPush(body: { outputConnectionId: string; scope: StandardExportRequest["scope"]; intervalSec: number }): Promise<BffJsonResult<NgsiPush>>;
  deleteNgsiPush(id: string): Promise<BffJsonResult<void>>;
  outputConnections(): Promise<BffJsonResult<ListBody<{ id: string; name: string }>>>;
}

const base = "/bff/api/core";

/** multipart 업로드(API-DEV-45). 응답은 공통 봉투 */
async function upload<T>(path: string, form: FormData): Promise<BffJsonResult<T>> {
  let response: Response;
  try {
    response = await bffFetch(path, { method: "POST", headers: { Accept: "application/json" }, body: form });
  } catch {
    return { ok: false, status: 0, code: "SERVICE_UNAVAILABLE", message: "" };
  }
  const body = (await response.json().catch(() => null)) as { header?: { resultCode?: string; resultMessage?: string }; response?: T; errors?: { field: string; code: string; message: string }[] } | null;
  if (response.ok) return { ok: true, status: response.status, data: body?.response as T };
  return { ok: false, status: response.status, code: body?.header?.resultCode ?? "UNKNOWN", message: body?.header?.resultMessage ?? "", errors: body?.errors };
}

export const devModelApi: DevModelApi = {
  savedSearches: () => bffJson(`${base}/saved-searches?size=100`),
  saveSearch: (body, id) => (id ? bffJson(`${base}/saved-searches/${encodeURIComponent(id)}`, { method: "PUT", body }) : bffJson(`${base}/saved-searches`, { method: "POST", body, idempotencyKey: clientIdempotencyKey() })),
  deleteSearch: (id) => bffJson(`${base}/saved-searches/${encodeURIComponent(id)}`, { method: "DELETE" }),
  exportModel: (modelId, format) => bffJson(`${base}/device-models/${encodeURIComponent(modelId)}/export?format=${format}`),
  importModel: (input) => {
    const form = new FormData();
    form.set("file", input.file);
    if (input.format) form.set("format", input.format);
    form.set("createMissingMetrics", String(input.createMissingMetrics));
    form.set("dryRun", String(input.dryRun));
    return upload(`${base}/device-models/import`, form);
  },
  exportStandard: (body) => bffJson(`${base}/devices/export-standard`, { method: "POST", body, idempotencyKey: clientIdempotencyKey() }),
  exportJob: (jobId) => bffJson(`${base}/export-jobs/${encodeURIComponent(jobId)}`),
  ngsiPushes: () => bffJson(`${base}/ngsi-pushes`),
  createNgsiPush: (body) => bffJson(`${base}/ngsi-pushes`, { method: "POST", body, idempotencyKey: clientIdempotencyKey() }),
  deleteNgsiPush: (id) => bffJson(`${base}/ngsi-pushes/${encodeURIComponent(id)}`, { method: "DELETE" }),
  outputConnections: () => bffJson(`${base}/output-connections?size=100`),
};

/** JSON을 파일로 내려받는다(모델 내보내기). 테스트에서는 바꿔 끼운다 */
export type Downloader = (fileName: string, content: string, mime: string) => void;

export const browserDownload: Downloader = (fileName, content, mime) => {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
};
