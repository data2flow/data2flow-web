/**
 * 플로우 편집기가 브라우저에서 부르는 API(BFF `/bff/api/core/**`, design/api/FLW-api.md).
 * 화면 부품은 이 묶음을 받아 쓰고, 테스트는 가짜 묶음을 넣는다.
 */
import { bffJson, clientIdempotencyKey, type BffJsonResult } from "~/lib/bff-client";
import type { FlowDefinition, FlowMetrics, FlowSettings, FlowVariable, RawMessageRow, ReplayJob, ShadowStatus, Trace, ValidateResponse, ValidationResult, VersionDiff, VersionRow } from "./model/types";

/** API-FLW-12 시험 입력: 저장된 원본 메시지 또는 직접 넣은 표준 메시지 */
export type TestRunInput = { rawMessageId: string } | { message: Record<string, unknown> };
export interface TestRunBody {
  version?: number;
  definition?: FlowDefinition;
  input: TestRunInput;
  startNodeId?: string;
}

/** API-FLW-10 부분 수정(온 키만) */
export type FlowSettingsPatch = Partial<Omit<FlowSettings, "flowId" | "version">>;

export interface SaveResult {
  flowId: string;
  draftVersion: number;
  validation?: ValidationResult;
}

/** API-FLW-07·08: 바로 적용 200 {appliedVersion, applyStatus} · 승인 대기 202 FLOW_APPROVAL_REQUIRED {approvalId, version} */
export interface ApplyResult {
  appliedVersion?: number;
  applyStatus?: { targetVersion: number; converged: boolean; instances?: unknown[] };
  approvalId?: string;
  version?: number;
}

export interface CapabilitySummary {
  name: string;
  version?: number;
  standard?: boolean;
}

export interface CapabilityAttribute {
  name: string;
  type: string;
  enum?: string[];
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  readOnly?: boolean;
}

export interface CapabilityDetail {
  name: string;
  version?: number;
  attributes: CapabilityAttribute[];
  commands: { name: string; sets?: string[]; args?: unknown }[];
}

export interface FlowApi {
  create(body: { name: string; description?: string; environment?: string; definition: FlowDefinition }): Promise<BffJsonResult<SaveResult>>;
  rename(flowId: string, name: string): Promise<BffJsonResult<{ flowId: string; name: string }>>;
  saveDraft(flowId: string, body: { name?: string; baseVersion: number; definition: FlowDefinition }): Promise<BffJsonResult<SaveResult>>;
  validate(flowId: string, version: number): Promise<BffJsonResult<ValidateResponse>>;
  apply(flowId: string, body: { version: number; baseVersion: number; memo?: string; acknowledgedRisks: boolean; shadow?: { durationMinutes: number } }): Promise<BffJsonResult<ApplyResult>>;
  /** API-FLW-04 `{responses, totalCount}`(페이징 없음, 최대 100개) */
  versions(flowId: string): Promise<BffJsonResult<{ responses: VersionRow[]; totalCount?: number }>>;
  diff(flowId: string, from: number, to: number): Promise<BffJsonResult<VersionDiff>>;
  rollback(flowId: string, body: { toVersion: number; memo?: string }): Promise<BffJsonResult<ApplyResult>>;
  metrics(flowId: string, window: "1h" | "24h" | "7d"): Promise<BffJsonResult<FlowMetrics>>;
  capabilities(): Promise<BffJsonResult<{ responses: CapabilitySummary[] }>>;
  /** API-FLW-12 시험 실행(드라이런) */
  testRun(flowId: string, body: TestRunBody): Promise<BffJsonResult<{ trace: Trace }>>;
  /** API-FLW-13 과거 재생: 202 {jobId, status:"QUEUED"} */
  replay(flowId: string, body: { version: number; from: string; to: string; deviceIds?: string[] }): Promise<BffJsonResult<{ jobId: string; status?: ReplayJob["status"] }>>;
  replayJob(jobId: string): Promise<BffJsonResult<ReplayJob>>;
  /** API-FLW-13 재생 취소 → 작업(CANCELLED) */
  cancelReplay(jobId: string): Promise<BffJsonResult<ReplayJob>>;
  /** API-FLW-41 실행 추적 */
  trace(flowId: string, messageId: string): Promise<BffJsonResult<Trace>>;
  /** API-FLW-11 바이패스·디버그 */
  overlay(flowId: string, body: { bypass: string[]; debug: string[]; revision: number }): Promise<BffJsonResult<{ revision: number }>>;
  /** API-FLW-18 섀도우 */
  shadow(flowId: string): Promise<BffJsonResult<ShadowStatus>>;
  startShadow(flowId: string, body: { version: number; durationMinutes: number }): Promise<BffJsonResult<ShadowStatus>>;
  endShadow(flowId: string, action: "promote" | "cancel"): Promise<BffJsonResult<unknown>>;
  /** API-FLW-10 플로우 설정·설명서 */
  updateSettings(flowId: string, patch: FlowSettingsPatch): Promise<BffJsonResult<FlowSettings>>;
  /** API-FLW-21 변수 */
  variables(flowId: string): Promise<BffJsonResult<{ responses: FlowVariable[]; totalCount?: number }>>;
  resetVariable(flowId: string, name: string): Promise<BffJsonResult<unknown>>;
  /** API-FLW-22 서브플로우 생성(고른 노드 묶음을 서브플로우 노드 하나로) */
  createSubflow(body: { name: string; description: string; definition: Record<string, unknown>; fromFlow: { flowId: string; nodeIds: string[] } }): Promise<BffJsonResult<{ subflowId: string; version: number; replacedNodeId?: string }>>;
  /** API-FLW-23 조회(최신 버전·사용 중인 플로우) */
  subflow(subflowId: string): Promise<BffJsonResult<{ subflowId: string; name?: string; version: number; usedBy?: { flowId: string; name: string; version: number }[] }>>;
  /** API-ING-05 최근 원본 메시지(시험 실행 입력) */
  rawMessages(query: { from: string; to: string; deviceIds?: string[] }): Promise<BffJsonResult<{ responses: RawMessageRow[] }>>;
  capability(name: string): Promise<BffJsonResult<CapabilityDetail>>;
}

const base = "/bff/api/core";
const flow = (id: string) => `${base}/flows/${encodeURIComponent(id)}`;

export const flowApi: FlowApi = {
  create: (body) => bffJson(`${base}/flows`, { method: "POST", body, idempotencyKey: clientIdempotencyKey() }),
  rename: (id, name) => bffJson(flow(id), { method: "PATCH", body: { name } }),
  saveDraft: (id, body) => bffJson(`${flow(id)}/draft`, { method: "PUT", body }),
  validate: (id, version) => bffJson(`${flow(id)}/validate`, { method: "POST", body: { version } }),
  apply: (id, body) => bffJson(`${flow(id)}/apply`, { method: "POST", body, idempotencyKey: clientIdempotencyKey() }),
  versions: (id) => bffJson(`${flow(id)}/versions`),
  diff: (id, from, to) => bffJson(`${flow(id)}/version-diff?from=${from}&to=${to}`),
  rollback: (id, body) => bffJson(`${flow(id)}/rollback`, { method: "POST", body, idempotencyKey: clientIdempotencyKey() }),
  metrics: (id, window) => bffJson(`${flow(id)}/metrics?window=${window}&step=${window === "1h" ? "1m" : "1h"}`),
  capabilities: () => bffJson(`${base}/capabilities?size=100`),
  capability: (name) => bffJson(`${base}/capabilities/${encodeURIComponent(name)}`),
  testRun: (id, body) => bffJson(`${flow(id)}/test-run`, { method: "POST", body }),
  replay: (id, body) => bffJson(`${flow(id)}/replay`, { method: "POST", body, idempotencyKey: clientIdempotencyKey() }),
  replayJob: (jobId) => bffJson(`${base}/flow-replays/${encodeURIComponent(jobId)}`),
  cancelReplay: (jobId) => bffJson(`${base}/flow-replays/${encodeURIComponent(jobId)}/cancel`, { method: "POST" }),
  trace: (id, messageId) => bffJson(`${flow(id)}/traces/${encodeURIComponent(messageId)}`),
  overlay: (id, body) => bffJson(`${flow(id)}/overlay`, { method: "PUT", body }),
  shadow: (id) => bffJson(`${flow(id)}/shadow`),
  startShadow: (id, body) => bffJson(`${flow(id)}/shadow`, { method: "POST", body, idempotencyKey: clientIdempotencyKey() }),
  endShadow: (id, action) => bffJson(`${flow(id)}/shadow/${action}`, { method: "POST", idempotencyKey: clientIdempotencyKey() }),
  updateSettings: (id, patch) => bffJson(flow(id), { method: "PATCH", body: patch }),
  variables: (id) => bffJson(`${flow(id)}/variables`),
  resetVariable: (id, name) => bffJson(`${flow(id)}/variables/${encodeURIComponent(name)}/reset`, { method: "POST" }),
  createSubflow: (body) => bffJson(`${base}/subflows`, { method: "POST", body, idempotencyKey: clientIdempotencyKey() }),
  subflow: (id) => bffJson(`${base}/subflows/${encodeURIComponent(id)}`),
  rawMessages: (q) => {
    const params = new URLSearchParams({ from: q.from, to: q.to, size: "20" });
    for (const id of q.deviceIds ?? []) params.append("deviceId", id);
    return bffJson(`${base}/ingest/raw-messages?${params}`);
  },
};
