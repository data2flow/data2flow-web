/**
 * AI(AIA) 화면이 쓰는 API 모양(design/api/AIA-api.md §1·§5, data2flow-ai 컨트롤러 DTO 기준).
 */

export type CommentaryStatus = "GENERATING" | "VERIFIED" | "UNVERIFIED" | "FAILED";

export interface Mismatch {
  value: string;
  context?: string;
}

/** API-AIA-01 조회 항목 */
export interface Commentary {
  commentaryId: string;
  subjectType: string;
  subjectId: string;
  status: CommentaryStatus;
  contentMd: string;
  model?: string | null;
  mismatches?: Mismatch[];
  supersededBy?: string | null;
  createdAt?: string | null;
}

/** API-AIA-01 `done`의 근거(§5: 본문 숫자 링크와 같은 대상) */
export interface Citation {
  text: string;
  target: { type: "METRIC" | "TABLE" | "CHART" | string; id: string };
}

/** 결과 화면의 AI 상태: 조직에서 꺼짐(409 AI_DISABLED)·쓸 수 있음·알 수 없음(조회 실패) */
export type AiState = "ENABLED" | "DISABLED" | "UNKNOWN";

/** API-AIA-03 */
export interface ScriptAssistTest {
  status: "PASS" | "FAIL";
  input?: unknown;
  output?: unknown;
  diff?: unknown;
  error?: unknown;
  durationMs?: number | null;
}

export interface ScriptAssist {
  assistId: string;
  attempt: number;
  code: string;
  explanation?: string | null;
  test?: ScriptAssistTest | null;
  aiAssisted?: boolean;
}

export const MAX_ASSIST_ATTEMPTS = 5;

export type Provider = "NONE" | "FAKE" | "ANTHROPIC" | "OPENAI" | "GOOGLE" | "OLLAMA";

/** API-AIA-07 */
export interface AiSettings {
  enabled: boolean;
  provider: Provider | string;
  model: string;
  embeddingModel?: string | null;
  dailyRequestLimit: number;
  dailyTokenLimit: number;
  perUserDailyLimit: number;
  logRetentionDays: number;
  autoCommentary: boolean;
  evalThreshold: number;
  suggestionTtlMinutes: number;
  version: number;
  updatedAt?: string | null;
  providers?: { provider: string; available: boolean; allowed: boolean; note?: string | null }[];
}

/** API-AIA-08 */
export interface Usage {
  series: { key: string; requests: number; tokensIn: number; tokensOut: number; costEstimate: number | null; limited: boolean }[];
  totals: { requests: number; tokensIn: number; tokensOut: number; costEstimate: number | null };
  limits: { dailyRequestLimit: number; dailyTokenLimit: number; perUserDailyLimit: number; usedRequestsToday: number; usedTokensToday: number; resetAt?: string | null };
}

/** API-AIA-16 */
export interface EvalCase {
  evalSetId?: string;
  caseId: string;
  kind?: string;
  question: string;
  expectedNumbers?: number[];
  expectedRefusal?: boolean;
  injection?: boolean;
}

export interface EvalRun {
  runId: string;
  evalSetId?: string;
  model: string;
  promptVersion?: string | null;
  accuracy: number | null;
  numberMatchRate: number | null;
  injectionBlockRate: number | null;
  passed: boolean | null;
  createdAt?: string | null;
}

/** API-AIA-17 */
export interface McpTool {
  name: string;
  version: string;
  description: string;
  scope: string;
  inputSchema?: unknown;
}

/** API-AIA-10 */
export interface ConversationSummary {
  conversationId: string;
  title: string;
  mode: "DATA" | "HELP";
  createdAt?: string;
  updatedAt?: string;
}

export interface ConversationMessage {
  messageId: string;
  role: "USER" | "ASSISTANT" | "TOOL";
  content: string;
  citations?: { tool?: string; target?: string; period?: string | null; link?: string | null }[] | null;
  createdAt?: string;
}

export interface ConversationDetail extends ConversationSummary {
  messages: ConversationMessage[];
}
