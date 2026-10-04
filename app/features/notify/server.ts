/**
 * 알림·운영 화면 loader·action 공용(서버 전용 라우트 모듈에서만 부른다).
 * 다른 권한이 필요한 보조 목록(회원 API-IAM-31은 관리자만, 규칙 API-RUL-01, 채널 유형 API-OPS-34)은 실패해도 화면을 그린다.
 */
import { data } from "react-router";
import { callApi, callList } from "~/bff/api.server";
import type { BffRequestContext } from "~/bff/middleware.server";
import type { ApiFailure } from "~/lib/api-types";
import type { SpaceNode } from "~/lib/spaces";
import { rowsOf, type ChannelType } from "./model/types";

/** action 결과: 성공 문구 키 또는 오류(코드·필드 오류) */
export interface NotifyActionResult {
  intent: string;
  done?: string;
  error?: { code: string; message?: string };
  fieldErrors?: Record<string, string>;
  /** 화면이 다시 보여 줄 값(테스트 결과, 경고 등) */
  payload?: Record<string, unknown>;
}

export function done(intent: string, key: string, payload?: Record<string, unknown>) {
  return { intent, done: key, payload } satisfies NotifyActionResult;
}

export function failed(intent: string, failure: Pick<ApiFailure, "status" | "code" | "message">, fieldErrors?: Record<string, string>, payload?: Record<string, unknown>) {
  return data({ intent, error: { code: failure.code, message: failure.message }, fieldErrors, payload } satisfies NotifyActionResult, { status: failure.status || 500 });
}

export function invalid(intent: string, fieldErrors: Record<string, string>, payload?: Record<string, unknown>) {
  return data({ intent, fieldErrors, payload } satisfies NotifyActionResult, { status: 400 });
}

export interface UserOption {
  id: string;
  name: string;
}

export async function loadSpaces(ctx: BffRequestContext, request: Request): Promise<SpaceNode[]> {
  const result = await callApi<SpaceNode[]>(ctx, request, "/api/v1/core/spaces");
  return result.ok ? (result.data ?? []) : [];
}

/** 회원 목록(API-IAM-31)은 관리자만 볼 수 있다. 실패하면 빈 목록이고 화면은 사용자 ID를 직접 입력받는다 */
export async function loadUsers(ctx: BffRequestContext, request: Request): Promise<{ users: UserOption[]; available: boolean }> {
  const result = await callList<{ id: string | number; name: string; loginId?: string }>(ctx, request, "/api/v1/core/users?status=ACTIVE&size=100", { noGuards: true });
  if (!result.ok) return { users: [], available: false };
  return { users: result.list.responses.map((u) => ({ id: String(u.id), name: u.name || u.loginId || String(u.id) })), available: true };
}

/** 등록된 채널 유형(API-OPS-34). 받지 못하면 문서의 기본값(TELEGRAM만 가능, ADR-033) */
export const FALLBACK_CHANNEL_TYPES: ChannelType[] = [
  { key: "TELEGRAM", displayName: "Telegram", available: true, configSchema: null, capabilities: { buttons: true, maxBodyLength: 4000, defaultRatePerMin: 20 } },
  { key: "EMAIL", displayName: "Email", available: false, configSchema: null },
  { key: "SLACK", displayName: "Slack", available: false, configSchema: null },
  { key: "KAKAO_ALIMTALK", displayName: "KakaoTalk", available: false, configSchema: null },
  { key: "SMS", displayName: "SMS", available: false, configSchema: null },
  { key: "WEBHOOK", displayName: "Webhook", available: false, configSchema: null },
];

/** 목록 응답이 `ListApiResponse`(`responses`)든 `ApiResponse`(`response`: 배열)든 행 배열로 */
export async function loadRows<T>(ctx: BffRequestContext, request: Request, path: string): Promise<{ ok: boolean; rows: T[]; nextCursor?: string | null; status: number; code?: string }> {
  const result = await callList<T>(ctx, request, path, { noGuards: true });
  if (!result.ok) return { ok: false, rows: [], status: result.status, code: result.code };
  const envelope = result.list as typeof result.list & { response?: unknown };
  const rows = result.list.responses.length ? result.list.responses : rowsOf<T>(envelope.response);
  const nextCursor = result.list.nextCursor ?? (envelope.response as { nextCursor?: string | null } | undefined)?.nextCursor ?? null;
  return { ok: true, rows, nextCursor, status: result.status };
}

/**
 * API-OPS-34 `{header, responses, totalCount}`. action이 응답하면 등록된 SPI(지금은 TELEGRAM 하나, displayName 없음)만 오므로
 * 문서의 "준비 중" 유형을 뒤에 붙이고 이름은 기본 목록에서 채운다. 비어 있으면 기본값
 */
export function mergeChannelTypes(rows: Partial<ChannelType>[]): ChannelType[] {
  if (!rows.length) return FALLBACK_CHANNEL_TYPES;
  const received = rows
    .filter((r) => r.key)
    .map((r) => {
      const key = String(r.key);
      const fallback = FALLBACK_CHANNEL_TYPES.find((f) => f.key === key);
      return { ...r, key, displayName: r.displayName || fallback?.displayName || key, available: r.available === true, configSchema: r.configSchema ?? null } as ChannelType;
    });
  const upcoming = FALLBACK_CHANNEL_TYPES.filter((f) => !f.available && !received.some((r) => r.key === f.key));
  return [...received, ...upcoming];
}

export async function loadChannelTypes(ctx: BffRequestContext, request: Request): Promise<ChannelType[]> {
  const result = await loadRows<Partial<ChannelType>>(ctx, request, "/api/v1/core/notification-channel-types");
  return mergeChannelTypes(result.rows);
}

export function str(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}
