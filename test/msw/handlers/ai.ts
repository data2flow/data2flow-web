/**
 * 가짜 ai API(design/api/AIA-api.md, gateway `/api/v1/ai/**` → data2flow-ai `/ai/**`). 상태는 core.extra["ai"].
 * `enabled=false`면 AI_DISABLED(409, API-AIA-07 제외), 해설 생성은 SSE 본문(delta·verification·done)을 돌려준다.
 */
import { HttpResponse } from "msw";
import { fail, list, ok, type CoreRequest, type CoreState } from "../core-fixtures";

export interface AiState {
  enabled: boolean;
  provider: string;
  commentaries: Record<string, unknown>[];
}

export function aiState(core: CoreState): AiState {
  core.extra.ai ??= { enabled: true, provider: "FAKE", commentaries: [] } satisfies AiState;
  return core.extra.ai as AiState;
}

export function aiHandler(core: CoreState, { method, path, url, body, can }: CoreRequest): Response {
  const s = aiState(core);
  const b = (body ?? {}) as Record<string, unknown>;
  if (path === "/settings") {
    if (!can("IAM_MANAGE")) return fail(403, "PERMISSION_DENIED");
    return ok({ enabled: s.enabled, provider: s.provider, model: "fake-model", embeddingModel: "hashing-1024", dailyRequestLimit: 1000, dailyTokenLimit: 0, perUserDailyLimit: 100, logRetentionDays: 90, autoCommentary: false, evalThreshold: 0.9, suggestionTtlMinutes: 30, version: 1, updatedAt: "2026-10-03T00:00:00Z", providers: [{ provider: "NONE", available: true, allowed: true, note: null }, { provider: "FAKE", available: true, allowed: true, note: null }] });
  }
  if (!s.enabled) return fail(409, "AI_DISABLED");
  if (!can("AI_USE")) return fail(403, "PERMISSION_DENIED");
  if (path === "/commentaries" && method === "GET") return list(s.commentaries.filter((c) => c.subjectId === url.searchParams.get("subjectId")), url);
  if (path === "/commentaries" && method === "POST") {
    if (!can("ANALYTICS_RUN")) return fail(403, "PERMISSION_DENIED");
    if (s.provider === "NONE") return fail(503, "AI_PROVIDER_UNAVAILABLE");
    const content = "이상이 [12건](#result-table-anomalies) 있었습니다.";
    s.commentaries.unshift({ commentaryId: "901", subjectType: "ANALYSIS_RUN", subjectId: b.subjectId, status: "VERIFIED", contentMd: content, model: "fake-model", mismatches: [], supersededBy: null, createdAt: "2026-10-04T00:00:00Z" });
    const text = [`event:delta\ndata:${JSON.stringify({ text: content })}\n\n`, `event:verification\ndata:${JSON.stringify({ status: "VERIFIED", mismatches: [] })}\n\n`, `event:done\ndata:${JSON.stringify({ commentaryId: "901", model: "fake-model", tokensIn: 10, tokensOut: 5, citations: [] })}\n\n`].join("");
    return new HttpResponse(text, { headers: { "Content-Type": "text/event-stream" } });
  }
  if (path === "/mcp/tools") return ok([{ name: "query_telemetry", version: "v1", description: "시계열 조회", scope: "read:telemetry", inputSchema: {} }]);
  if (path === "/conversations" && method === "GET") return list([], url);
  if (path === "/usage" || path === "/usage/me") {
    if (path === "/usage" && !can("IAM_MANAGE")) return fail(403, "PERMISSION_DENIED");
    return ok({ series: [], totals: { requests: 0, tokensIn: 0, tokensOut: 0, costEstimate: 0 }, limits: { dailyRequestLimit: 1000, dailyTokenLimit: 0, perUserDailyLimit: 100, usedRequestsToday: 0, usedTokensToday: 0, resetAt: null } });
  }
  return fail(404, "RESOURCE_NOT_FOUND");
}
