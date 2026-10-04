/**
 * 재처리 작업(API-ING-09·10·12·14)과 품질 추이(core IngestInsightController)를 브라우저에서 부르는 API(BFF `/bff/api/core/ingest/**`).
 */
import { bffJson, clientIdempotencyKey, type BffJsonResult } from "~/lib/bff-client";
import type { QualityGroup, QualityTrendPoint, ReprocessBody, ReprocessJob, ReprocessPreview } from "./model/m5";

const base = "/bff/api/core/ingest";

export interface ReprocessApi {
  preview(body: ReprocessBody): Promise<BffJsonResult<ReprocessPreview>>;
  create(body: ReprocessBody, idempotencyKey: string): Promise<BffJsonResult<{ jobId: string; status: string; total: number }>>;
  cancel(jobId: string): Promise<BffJsonResult<{ jobId: string; status: string; processed: number }>>;
  list(): Promise<BffJsonResult<{ responses: ReprocessJob[]; totalCount?: number }>>;
}

export const reprocessApi: ReprocessApi = {
  preview: (body) => bffJson(`${base}/reprocess-jobs/preview`, { method: "POST", body }),
  create: (body, idempotencyKey) => bffJson(`${base}/reprocess-jobs`, { method: "POST", body, idempotencyKey }),
  cancel: (jobId) => bffJson(`${base}/reprocess-jobs/${encodeURIComponent(jobId)}/cancel`, { method: "POST", idempotencyKey: clientIdempotencyKey() }),
  list: () => bffJson(`${base}/reprocess-jobs?page=1&size=20`),
};

export interface QualityApi {
  trend(query: { groupBy: QualityGroup; targetId: string; from: string; to: string }): Promise<BffJsonResult<{ points: QualityTrendPoint[] }>>;
}

export const qualityApi: QualityApi = {
  trend: (q) => bffJson(`${base}/quality/trend?${new URLSearchParams(q)}`),
};
