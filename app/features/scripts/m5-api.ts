/**
 * 스크립트 M5 화면이 브라우저에서 부르는 API(BFF `/bff/api/core/**`, design/api/SCR-api.md, core ScriptM5Controller).
 * 화면 부품은 이 묶음을 받아 쓰고, 테스트는 가짜 묶음을 넣는다.
 */
import { bffJson, clientIdempotencyKey, type BffJsonResult } from "~/lib/bff-client";
import type { RunCasesResult, ScriptStats, TestCase, TestCaseBody } from "./model/m5";

const enc = encodeURIComponent;
const scripts = "/bff/api/core/scripts";

export interface ErrorSnapshot {
  id: string;
  occurredAt: string;
  versionNo: number;
  errorCode: string;
  message?: string | null;
  line?: number | null;
  col?: number | null;
  deviceId?: string | null;
  /** SCRIPT_WRITE에게만 온다 */
  inputSnapshot?: unknown;
}

export interface LogLine {
  at: string;
  versionNo: number;
  deviceId?: string | null;
  message: string;
}

export interface ListEnvelope<T> {
  responses: T[];
  totalCount?: number;
}

export interface ScriptOpsApi {
  listCases(scriptId: string): Promise<BffJsonResult<ListEnvelope<TestCase>>>;
  createCase(scriptId: string, body: TestCaseBody): Promise<BffJsonResult<TestCase>>;
  updateCase(scriptId: string, caseId: string, body: TestCaseBody): Promise<BffJsonResult<TestCase>>;
  deleteCase(scriptId: string, caseId: string): Promise<BffJsonResult<void>>;
  runCases(scriptId: string, body: { versionId?: string; code?: string }): Promise<BffJsonResult<RunCasesResult>>;
  stats(scriptId: string, query: { from: string; to: string; step: string }): Promise<BffJsonResult<ScriptStats>>;
  errors(scriptId: string, page?: number, size?: number): Promise<BffJsonResult<ListEnvelope<ErrorSnapshot>>>;
  logCapture(scriptId: string, enabled: boolean): Promise<BffJsonResult<{ enabled: boolean; until: string | null }>>;
  logs(scriptId: string): Promise<BffJsonResult<ListEnvelope<LogLine>>>;
  saveConfig(scriptId: string, body: { config: Record<string, string | number | boolean>; baseVersion?: number }): Promise<BffJsonResult<{ scriptId: string; config: Record<string, unknown>; version: number }>>;
}

export const scriptOpsApi: ScriptOpsApi = {
  listCases: (id) => bffJson(`${scripts}/${enc(id)}/test-cases`),
  createCase: (id, body) => bffJson(`${scripts}/${enc(id)}/test-cases`, { method: "POST", body }),
  updateCase: (id, caseId, body) => bffJson(`${scripts}/${enc(id)}/test-cases/${enc(caseId)}`, { method: "PUT", body }),
  deleteCase: (id, caseId) => bffJson(`${scripts}/${enc(id)}/test-cases/${enc(caseId)}`, { method: "DELETE" }),
  runCases: (id, body) => bffJson(`${scripts}/${enc(id)}/test-cases/run`, { method: "POST", body }),
  stats: (id, q) => bffJson(`${scripts}/${enc(id)}/stats?${new URLSearchParams(q)}`),
  errors: (id, page = 1, size = 100) => bffJson(`${scripts}/${enc(id)}/errors?page=${page}&size=${size}`),
  logCapture: (id, enabled) => bffJson(`${scripts}/${enc(id)}/log-capture`, { method: "POST", body: { enabled } }),
  logs: (id) => bffJson(`${scripts}/${enc(id)}/logs?page=1&size=100`),
  saveConfig: (id, body) => bffJson(`${scripts}/${enc(id)}/config`, { method: "PUT", body }),
};

// ---------------------------------------------------------------- 공유 모듈(API-SCR-18·19)

export interface ModuleSummary {
  id: string;
  name: string;
  description?: string | null;
  latestVersionNo?: number | null;
  usedBy?: number | null;
  updatedAt?: string | null;
}

export interface ModuleDetail {
  id: string;
  name: string;
  description?: string | null;
  draftCode?: string | null;
  latestVersionNo?: number | null;
  versions?: { versionNo: number; status?: string | null; releasedAt?: string | null }[] | null;
  updatedAt?: string | null;
}

export interface ModuleUsage {
  moduleId: string;
  scripts: { scriptId: string; scriptName: string; versionNo: number }[];
}

export interface ModuleApi {
  create(body: { name: string; description?: string; code: string }): Promise<BffJsonResult<ModuleDetail>>;
  save(id: string, body: { name: string; description?: string; code: string }): Promise<BffJsonResult<ModuleDetail>>;
  release(id: string): Promise<BffJsonResult<{ moduleId: string; versionNo: number; releasedAt: string }>>;
  deleteVersion(id: string, versionNo: number): Promise<BffJsonResult<void>>;
  usage(id: string): Promise<BffJsonResult<ModuleUsage>>;
}

const modules = "/bff/api/core/script-modules";

export const moduleApi: ModuleApi = {
  create: (body) => bffJson(modules, { method: "POST", body }),
  save: (id, body) => bffJson(`${modules}/${enc(id)}`, { method: "PUT", body }),
  release: (id) => bffJson(`${modules}/${enc(id)}/release`, { method: "POST", idempotencyKey: clientIdempotencyKey() }),
  deleteVersion: (id, versionNo) => bffJson(`${modules}/${enc(id)}/versions/${versionNo}`, { method: "DELETE" }),
  usage: (id) => bffJson(`${modules}/${enc(id)}/usage`),
};

// ---------------------------------------------------------------- 수식 항목(API-SCR-20·21)

export type FormulaTarget = "MODEL" | "DEVICE" | "SPACE";

export interface FormulaMetric {
  id: string;
  resultKey: string;
  displayName: string;
  unit?: string | null;
  expression: string;
  targetType: FormulaTarget;
  targetId: string;
  targetName?: string | null;
  status: "ACTIVE" | "DISABLED";
  version: number;
  updatedAt?: string | null;
}

export interface FormulaBody {
  resultKey: string;
  displayName: string;
  unit?: string;
  expression: string;
  targetType: FormulaTarget;
  targetId: string;
  status: "ACTIVE" | "DISABLED";
  baseVersion?: number;
}

export interface FormulaPreview {
  series?: { t: string; value: number | null }[] | null;
  inputs?: Record<string, { t: string; value: number | null }[]> | null;
}

export interface FormulaApi {
  create(body: FormulaBody): Promise<BffJsonResult<FormulaMetric>>;
  update(id: string, body: FormulaBody): Promise<BffJsonResult<FormulaMetric>>;
  remove(id: string): Promise<BffJsonResult<void>>;
  preview(body: { expression: string; targetType: FormulaTarget; targetId: string; hours: number }): Promise<BffJsonResult<FormulaPreview>>;
}

const formulas = "/bff/api/core/formula-metrics";

export const formulaApi: FormulaApi = {
  create: (body) => bffJson(formulas, { method: "POST", body }),
  update: (id, body) => bffJson(`${formulas}/${enc(id)}`, { method: "PUT", body }),
  remove: (id) => bffJson(`${formulas}/${enc(id)}`, { method: "DELETE" }),
  preview: (body) => bffJson(`${formulas}/preview`, { method: "POST", body }),
};
