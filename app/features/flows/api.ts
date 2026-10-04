/**
 * 플로우 편집기가 브라우저에서 부르는 API(BFF `/bff/api/core/**`, design/api/FLW-api.md).
 * 화면 부품은 이 묶음을 받아 쓰고, 테스트는 가짜 묶음을 넣는다.
 */
import { bffJson, clientIdempotencyKey, type BffJsonResult } from "~/lib/bff-client";
import type { FlowDefinition, FlowMetrics, ValidateResponse, ValidationResult, VersionDiff, VersionRow } from "./model/types";

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
  apply(flowId: string, body: { version: number; baseVersion: number; memo?: string; acknowledgedRisks: boolean }): Promise<BffJsonResult<ApplyResult>>;
  /** API-FLW-04 `{responses, totalCount}`(페이징 없음, 최대 100개) */
  versions(flowId: string): Promise<BffJsonResult<{ responses: VersionRow[]; totalCount?: number }>>;
  diff(flowId: string, from: number, to: number): Promise<BffJsonResult<VersionDiff>>;
  rollback(flowId: string, body: { toVersion: number; memo?: string }): Promise<BffJsonResult<ApplyResult>>;
  metrics(flowId: string, window: "1h" | "24h" | "7d"): Promise<BffJsonResult<FlowMetrics>>;
  capabilities(): Promise<BffJsonResult<{ responses: CapabilitySummary[] }>>;
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
};
