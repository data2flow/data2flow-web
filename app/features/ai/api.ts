/**
 * AI 화면이 브라우저에서 부르는 API(BFF `/bff/api/ai/**` → gateway `/api/v1/ai/**`, design/api/AIA-api.md).
 * 스트리밍(해설 API-AIA-01, 도움말 API-AIA-02)은 POST 본문을 SSE로 읽는다(model/sse.ts).
 */
import { bffJson, clientIdempotencyKey, type BffJsonResult } from "~/lib/bff-client";
import { postStream, type SseEvent, type StreamOutcome } from "./model/sse";
import type { AiSettings, Commentary, ConversationDetail, ConversationSummary, EvalCase, EvalRun, McpTool, ScriptAssist, Usage } from "./model/types";

type R<T> = Promise<BffJsonResult<T>>;
export type ListOf<T> = { responses: T[]; totalCount?: number; totalPages?: number; page?: number };

export interface CommentaryRequest {
  subjectType: "ANALYSIS_RUN";
  subjectId: string;
  analysisId?: string;
  regenerate: boolean;
}

export interface AskRequest {
  content: string;
  mode: "HELP" | "DATA";
  context?: { screenId?: string; selection?: unknown; errorCode?: string };
}

export interface AiApi {
  /** API-AIA-01 이력(최신순) */
  listCommentaries(runId: string): R<ListOf<Commentary>>;
  /** API-AIA-01 생성(스트리밍) */
  streamCommentary(body: CommentaryRequest, onEvent: (e: SseEvent) => void): Promise<StreamOutcome>;
  /** API-AIA-03 */
  scriptAssist(body: unknown): R<ScriptAssist>;
  /** API-AIA-07 */
  getSettings(): R<AiSettings>;
  saveSettings(body: unknown): R<AiSettings>;
  /** API-AIA-08 */
  usage(query: { from?: string; to?: string; groupBy: "day" | "feature" | "user" }): R<Usage>;
  usageMe(): R<Usage>;
  /** API-AIA-16 */
  evalCases(): R<EvalCase[]>;
  evalRuns(): R<ListOf<EvalRun>>;
  startEval(body: { model: string; promptVersion?: string; provider?: string }): R<EvalRun>;
  /** API-AIA-17 */
  mcpTools(): R<McpTool[]>;
  /** API-AIA-10 */
  conversations(): R<ListOf<ConversationSummary>>;
  conversation(id: string): R<ConversationDetail>;
  deleteConversation(id: string): R<void>;
  deleteAllConversations(): R<void>;
  /** API-AIA-02 새 대화·이어서 묻기(스트리밍) */
  ask(conversationId: string | null, body: AskRequest, onEvent: (e: SseEvent) => void, signal?: AbortSignal): Promise<StreamOutcome>;
}

const enc = encodeURIComponent;
const base = "/bff/api/ai";

export const defaultAiApi: AiApi = {
  listCommentaries: (runId) => bffJson(`${base}/commentaries?subjectType=ANALYSIS_RUN&subjectId=${enc(runId)}`),
  streamCommentary: (body, onEvent) => postStream(`${base}/commentaries`, body, onEvent),
  scriptAssist: (body) => bffJson(`${base}/script-assists`, { method: "POST", body }),
  getSettings: () => bffJson(`${base}/settings`),
  saveSettings: (body) => bffJson(`${base}/settings`, { method: "PUT", body }),
  usage: (q) => bffJson(`${base}/usage?${new URLSearchParams(Object.entries(q).filter(([, v]) => v) as [string, string][])}`),
  usageMe: () => bffJson(`${base}/usage/me`),
  evalCases: () => bffJson(`${base}/evals/cases`),
  evalRuns: () => bffJson(`${base}/evals/runs?size=20`),
  startEval: (body) => bffJson(`${base}/evals/runs`, { method: "POST", body, idempotencyKey: clientIdempotencyKey() }),
  mcpTools: () => bffJson(`${base}/mcp/tools`),
  conversations: () => bffJson(`${base}/conversations?size=50`),
  conversation: (id) => bffJson(`${base}/conversations/${enc(id)}`),
  deleteConversation: (id) => bffJson(`${base}/conversations/${enc(id)}`, { method: "DELETE" }),
  deleteAllConversations: () => bffJson(`${base}/conversations/delete-all`, { method: "POST" }),
  ask: (id, body, onEvent, signal) => postStream(id ? `${base}/conversations/${enc(id)}/messages` : `${base}/conversations`, body, onEvent, { signal }),
};
