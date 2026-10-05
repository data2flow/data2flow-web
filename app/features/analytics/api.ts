/**
 * 분석 화면이 브라우저에서 부르는 API(BFF `/bff/api/core/analytics/**`, design/api/ANA-api.md §1).
 * 대시보드 고정은 API-DSH-08 `pin-analysis`. 화면 부품은 이 묶음을 받아 쓰고, 테스트는 가짜 묶음을 넣는다.
 */
import { bffJson, clientIdempotencyKey, type BffJsonResult } from "~/lib/bff-client";
import type { Analysis, AnalysisSummary, Candidate, CheckResult, CompareResult, ExportResult, ModelItem, Run, RunWithResult, SourceKind, Template, TemplateDetail } from "./model/types";

type R<T> = Promise<BffJsonResult<T>>;
export type ListOf<T> = { responses: T[]; totalCount?: number; totalPages?: number; page?: number };

export interface TemplateQuery {
  keyword?: string;
  view?: "runnable";
  spaceId?: string;
  category?: string;
  kind?: string;
}

export interface RunRequested {
  runId?: string;
  status?: string;
  queuePosition?: number | null;
  run?: Run;
}

export interface DashboardOption {
  id: string;
  name: string;
  visibility?: string;
}

export interface AnalyticsApi {
  /** API-ANA-01·03·04 */
  listTemplates(query?: TemplateQuery): R<ListOf<Template>>;
  /** API-ANA-02 */
  getTemplate(key: string, version?: string): R<TemplateDetail>;
  /** API-ANA-19 */
  candidates(key: string, role: string, query: { kind: SourceKind; keyword?: string; spaceId?: string }): R<ListOf<Candidate>>;
  /** API-ANA-05 */
  check(key: string, body: unknown): R<CheckResult>;
  /** API-ANA-06 */
  createAnalysis(body: unknown): R<Analysis>;
  /** API-ANA-07 */
  listAnalyses(query: Record<string, string>): R<ListOf<AnalysisSummary>>;
  /** API-ANA-22 */
  deleteAnalysis(id: string): R<void>;
  /** API-ANA-08 */
  runAnalysis(id: string, acknowledgeWarnings: boolean): R<RunRequested>;
  /** API-ANA-09 */
  getRun(analysisId: string, runId: string): R<RunWithResult>;
  listRuns(analysisId: string): R<ListOf<Run>>;
  /** API-ANA-10 */
  cancelRun(analysisId: string, runId: string): R<Run>;
  /** API-ANA-13 */
  compare(analysisId: string, base: string, target: string): R<CompareResult>;
  /** API-ANA-12 */
  exportRun(analysisId: string, runId: string, body: { format: "CSV" | "PNG" | "PDF"; chartId?: string; tableId?: string }): R<ExportResult>;
  /** API-ANA-15 */
  feedback(body: { runId: string; occurredAt: string; seriesKey: string; verdict: "TRUE_POSITIVE" | "FALSE_POSITIVE" }): R<unknown>;
  /** API-ANA-23·24·14 */
  listModels(): R<ListOf<ModelItem>>;
  activateModel(modelId: string, force: boolean): R<unknown>;
  trainModel(analysisId: string): R<{ modelId: string; version: number }>;
  /** 고정할 대시보드(API-DSH-04 내 것·공유) */
  listDashboards(): R<DashboardOption[]>;
  /** API-DSH-08 pin-analysis */
  pin(dashboardId: string, body: { analysisId: string; chartId?: string; metricKeys?: string[] }): R<{ dashboardId: string; widgetId: string; version: number }>;
}

const enc = encodeURIComponent;
const base = "/bff/api/core/analytics";

function query(params: Record<string, string | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") q.set(k, v);
  const s = q.toString();
  return s ? `?${s}` : "";
}

export const defaultAnalyticsApi: AnalyticsApi = {
  listTemplates: (q = {}) => bffJson(`${base}/templates${query({ ...q, size: "100" })}`),
  getTemplate: (key, version) => bffJson(`${base}/templates/${enc(key)}${query({ version })}`),
  candidates: (key, role, q) => bffJson(`${base}/templates/${enc(key)}/roles/${enc(role)}/candidates${query({ kind: q.kind, keyword: q.keyword, spaceId: q.spaceId, size: "50" })}`),
  check: (key, body) => bffJson(`${base}/templates/${enc(key)}/check`, { method: "POST", body }),
  createAnalysis: (body) => bffJson(`${base}/analyses`, { method: "POST", body, idempotencyKey: clientIdempotencyKey() }),
  listAnalyses: (q) => bffJson(`${base}/analyses${query(q)}`),
  deleteAnalysis: (id) => bffJson(`${base}/analyses/${enc(id)}`, { method: "DELETE" }),
  runAnalysis: (id, acknowledgeWarnings) => bffJson(`${base}/analyses/${enc(id)}/runs`, { method: "POST", body: { acknowledgeWarnings }, idempotencyKey: clientIdempotencyKey() }),
  getRun: (a, r) => bffJson(`${base}/analyses/${enc(a)}/runs/${enc(r)}`),
  listRuns: (a) => bffJson(`${base}/analyses/${enc(a)}/runs?size=20`),
  cancelRun: (a, r) => bffJson(`${base}/analyses/${enc(a)}/runs/${enc(r)}/cancel`, { method: "POST" }),
  compare: (a, b, t) => bffJson(`${base}/analyses/${enc(a)}/runs/compare${query({ base: b, target: t })}`),
  exportRun: (a, r, body) => bffJson(`${base}/analyses/${enc(a)}/runs/${enc(r)}/export`, { method: "POST", body }),
  feedback: (body) => bffJson(`${base}/feedback`, { method: "POST", body }),
  listModels: () => bffJson(`${base}/models?size=100`),
  activateModel: (id, force) => bffJson(`${base}/models/${enc(id)}/activate`, { method: "POST", body: { force } }),
  trainModel: (a) => bffJson(`${base}/analyses/${enc(a)}/models/train`, { method: "POST", body: {} }),
  listDashboards: async () => {
    const [mine, shared] = await Promise.all([
      bffJson<ListOf<DashboardOption>>("/bff/api/core/dashboards?tab=mine&size=100"),
      bffJson<ListOf<DashboardOption>>("/bff/api/core/dashboards?tab=shared&size=100"),
    ]);
    if (!mine.ok) return mine;
    const seen = new Set<string>();
    const all = [...mine.data.responses, ...(shared.ok ? shared.data.responses : [])].filter((d) => (seen.has(d.id) ? false : (seen.add(d.id), true)));
    return { ok: true, status: 200, data: all };
  },
  pin: (dashboardId, body) => bffJson(`/bff/api/core/dashboards/${enc(dashboardId)}/widgets/pin-analysis`, { method: "POST", body }),
};
