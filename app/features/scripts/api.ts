/**
 * 스크립트 편집기가 브라우저에서 부르는 API(BFF `/bff/api/core/scripts/**`, design/api/SCR-api.md).
 * 화면 부품은 이 묶음을 받아 쓰고, 테스트는 가짜 묶음을 넣는다.
 */
import { bffJson, clientIdempotencyKey, type BffJsonResult } from "~/lib/bff-client";
import type { ScriptKind, StaticCheck, TestRunResult } from "./model/script-model";

export interface ScriptVersionRow {
  versionId: string;
  versionNo: number;
  status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  savedBy?: string | null;
  savedAt?: string | null;
  deployMemo?: string | null;
  deployedBy?: string | null;
  deployedAt?: string | null;
  forced?: boolean;
  staticCheck?: StaticCheck;
}

export interface ScriptDetail {
  id: string;
  name: string;
  kind: ScriptKind;
  status: string;
  description?: string | null;
  activeVersion: { versionId: string; versionNo: number; code: string; deployedAt?: string; deployMemo?: string } | null;
  draft: { versionId: string; versionNo: number; code: string; staticCheck: StaticCheck } | null;
  versions?: ScriptVersionRow[];
  bindings?: { targetType: string; targetId: string; name?: string; failurePolicy?: string }[];
  usage?: { bindings?: { processed24h?: number }[] };
  config?: Record<string, unknown>;
  version?: number;
}

export interface DeployRequest {
  versionId: string;
  memo: string;
  force?: boolean;
  forceReason?: string;
  baseActiveVersionId: string | null;
}

export interface DeployResult {
  activeVersionId: string;
  applied?: { reported: number; total: number };
}

export interface TestRunRequest {
  kind: ScriptKind;
  code: string;
  input?: unknown;
  rawMessageId?: string;
  context?: unknown;
  scriptId?: string;
}

export interface ScriptApi {
  check(kind: ScriptKind, code: string): Promise<BffJsonResult<StaticCheck>>;
  save(id: string, body: { code: string; baseVersionNo: number }): Promise<BffJsonResult<{ versionId: string; versionNo: number; staticCheck: StaticCheck }>>;
  detail(id: string): Promise<BffJsonResult<ScriptDetail>>;
  deploy(id: string, body: DeployRequest): Promise<BffJsonResult<DeployResult>>;
  testRun(body: TestRunRequest): Promise<BffJsonResult<TestRunResult>>;
  version(id: string, versionId: string): Promise<BffJsonResult<{ versionNo: number; code: string }>>;
}

const base = "/bff/api/core/scripts";

export const scriptApi: ScriptApi = {
  check: (kind, code) => bffJson(`${base}/check`, { method: "POST", body: { kind, code } }),
  save: (id, body) => bffJson(`${base}/${encodeURIComponent(id)}/draft`, { method: "PUT", body }),
  detail: (id) => bffJson(`${base}/${encodeURIComponent(id)}?include=versions,usage,config`),
  deploy: (id, body) => bffJson(`${base}/${encodeURIComponent(id)}/deploy`, { method: "POST", body, idempotencyKey: clientIdempotencyKey() }),
  // API-SCR-08: `/scripts/test-run`(TC-SCR-045의 `/scripts/{script-id}/test-run`과 다름, 문서 불일치로 보고)
  testRun: (body) => bffJson(`${base}/test-run`, { method: "POST", body }),
  version: (id, versionId) => bffJson(`${base}/${encodeURIComponent(id)}/versions/${encodeURIComponent(versionId)}`),
};

/** 마지막 버전 번호(DRAFT 저장의 baseVersionNo) */
export function latestVersionNo(detail: Pick<ScriptDetail, "versions" | "draft" | "activeVersion">): number {
  const numbers = [...(detail.versions ?? []).map((v) => v.versionNo), detail.draft?.versionNo ?? 0, detail.activeVersion?.versionNo ?? 0];
  return Math.max(0, ...numbers);
}
