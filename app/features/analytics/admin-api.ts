/**
 * 분석 관리·데이터셋 화면이 브라우저에서 부르는 API(BFF `/bff/api/core/analytics/**`, design/api/ANA-api.md §1):
 * 템플릿 설정 API-ANA-18, 조직 분석 설정 API-ANA-25, 데이터셋 API-ANA-20. 화면 부품은 이 묶음을 받아 쓰고, 테스트는 가짜 묶음을 넣는다.
 */
import { bffJson, clientIdempotencyKey, type BffJsonResult } from "~/lib/bff-client";
import type { Binding, Period, QualityFilter } from "./model/types";

type R<T> = Promise<BffJsonResult<T>>;

/** API-ANA-17 항목 */
export interface TemplateSetting {
  key: string;
  name: string;
  version: string;
  enabled: boolean;
  analysisCount: number;
  scheduleCount: number;
  realtimeCount: number;
  pausedAnalysisIds?: string[];
}

/** API-ANA-20 데이터셋 */
export interface Dataset {
  datasetId: string;
  name: string;
  bindings: Binding[];
  period: Period;
  qualityFilter: QualityFilter;
  includeVirtual: boolean;
  version: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface DatasetSummary {
  datasetId: string;
  name: string;
  bindingCount: number;
  version: number;
  analysisCount: number;
  updatedAt?: string;
}

export interface DatasetVersion {
  version: number;
  bindingCount: number;
  updatedBy?: { userId: string; name?: string | null } | null;
  updatedAt?: string;
}

export type DatasetBody = Omit<Dataset, "datasetId" | "version" | "createdAt" | "updatedAt">;

export interface AnalyticsAdminApi {
  setTemplateEnabled(key: string, enabled: boolean): R<TemplateSetting>;
  saveSettings(resultRetentionDays: number): R<{ resultRetentionDays: number }>;
  createDataset(body: DatasetBody): R<Dataset>;
  renameDataset(dataset: Dataset, name: string): R<Dataset>;
  deleteDataset(id: string): R<void>;
  upgradeAnalysis(datasetId: string, analysisId: string): R<{ analysisId: string; datasetId: string; datasetVersion: number }>;
}

const base = "/bff/api/core/analytics";
const enc = encodeURIComponent;

export const analyticsAdminApi: AnalyticsAdminApi = {
  setTemplateEnabled: (key, enabled) => bffJson(`${base}/template-settings/${enc(key)}`, { method: "PUT", body: { enabled } }),
  saveSettings: (resultRetentionDays) => bffJson(`${base}/settings`, { method: "PUT", body: { resultRetentionDays } }),
  createDataset: (body) => bffJson(`${base}/datasets`, { method: "POST", body, idempotencyKey: clientIdempotencyKey() }),
  renameDataset: (d, name) =>
    bffJson(`${base}/datasets/${enc(d.datasetId)}`, { method: "PUT", body: { name, bindings: d.bindings, period: d.period, qualityFilter: d.qualityFilter, includeVirtual: d.includeVirtual, baseVersion: d.version } }),
  deleteDataset: (id) => bffJson(`${base}/datasets/${enc(id)}`, { method: "DELETE" }),
  upgradeAnalysis: (datasetId, analysisId) => bffJson(`${base}/datasets/${enc(datasetId)}/analyses/${enc(analysisId)}/upgrade-dataset`, { method: "POST" }),
};
