/**
 * 기기 검색식 목록 응답 도우미(DEV-13.03, API-DEV-133). 서버 전용(loader).
 */
import type { ListResult } from "~/bff/api.server";
import type { ListEnvelope } from "~/lib/api-types";
import type { QueryCounts, QueryProblem } from "./model/types";

const QUERY_ERRORS = new Set(["DEVICE_QUERY_INVALID", "DEVICE_QUERY_TIMEOUT"]);

/** 400 DEVICE_QUERY_INVALID·TIMEOUT이면 `response.column`과 함께 돌려준다. 그 밖의 실패는 undefined(오류 화면으로) */
export function queryProblem<T>(result: ListResult<T>): QueryProblem | null {
  if (result.ok || result.status !== 400 || !QUERY_ERRORS.has(result.code)) return null;
  const detail = (result.detail ?? {}) as { column?: unknown; message?: unknown };
  const column = Number(detail.column);
  return { code: result.code, column: Number.isFinite(column) && column > 0 ? column : 1, message: typeof detail.message === "string" ? detail.message : undefined };
}

/** 검색식으로 찾았을 때만 오는 `counts{total, tookMs}` */
export function queryCounts<T>(list: ListEnvelope<T>): QueryCounts | null {
  const counts = (list as ListEnvelope<T> & { counts?: { total?: unknown; tookMs?: unknown } }).counts;
  if (!counts || typeof counts.total !== "number") return null;
  return { total: counts.total, tookMs: typeof counts.tookMs === "number" ? counts.tookMs : 0 };
}
