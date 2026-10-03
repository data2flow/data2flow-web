/**
 * 라우트 loader·action에서 gateway API를 부르는 도우미. 세션이 끝났으면 로그인 화면으로 보내고(IAM-03.01, IAM-07.05),
 * 권한이 없으면 403 화면(UI-IAM-13), 비밀번호 변경·2단계 인증 설정이 필요하면 내 정보 > 보안으로 보낸다(BR-IAM-06, BR-IAM-25).
 */
import { randomUUID } from "node:crypto";
import { data, redirect } from "react-router";
import type { ApiFailure, ListEnvelope } from "~/lib/api-types";
import { SessionEndedError, UpstreamUnavailableError, publicFetch, readEnvelope, retryAfterOf, sessionFetch, toFailure } from "./gateway.server";
import type { BffRequestContext } from "./middleware.server";

export type ApiResult<T> = { ok: true; status: number; data: T } | ApiFailure;
export type ListResult<T> = { ok: true; status: number; list: ListEnvelope<T> } | ApiFailure;

export interface CallOptions {
  method?: string;
  body?: unknown;
  /** 쓰기·제어 POST의 멱등 키(api-rules §6) */
  idempotencyKey?: string;
  /** 로그인 없이 부르는 공개 API */
  anonymous?: boolean;
  /** 비밀번호 변경·2단계 인증 설정 필요 응답을 리디렉트하지 않고 돌려준다 */
  noGuards?: boolean;
  /** JSON 대신 보낼 본문(multipart 업로드 등). Content-Type은 fetch가 정한다 */
  rawBody?: FormData;
}

/** 로그인 화면 주소. `next`에는 지금 경로를, `reason`에는 끝난 이유를 넣는다 */
export function loginUrl(request: Request, reason?: string): string {
  const url = new URL(request.url);
  const params = new URLSearchParams();
  const next = `${url.pathname.replace(/\.data$/, "")}${url.search}`;
  if (next && next !== "/") params.set("next", next);
  if (reason) params.set("reason", reason);
  const query = params.toString();
  return query ? `/login?${query}` : "/login";
}

function reasonOf(code: string) {
  return code === "AUTH_SESSION_EXPIRED" ? "expired" : "revoked";
}

async function send(ctx: BffRequestContext, request: Request, path: string, options: CallOptions): Promise<Response> {
  const headers: Record<string, string> = {};
  let body: string | undefined;
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }
  if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;
  const init = { method: options.method ?? "GET", headers, body: options.rawBody ?? body };
  try {
    if (options.anonymous) return await publicFetch(ctx.runtime, ctx.meta, path, init);
    if (!ctx.session.authenticated) throw redirect(loginUrl(request, ctx.session.expired ? "expired" : undefined));
    return await sessionFetch(ctx.session, path, init);
  } catch (error) {
    if (error instanceof SessionEndedError) throw redirect(loginUrl(request, reasonOf(error.code)));
    throw error;
  }
}

function handleGuards(options: CallOptions, failure: ApiFailure) {
  if (options.noGuards) return;
  if (failure.code === "AUTH_PASSWORD_CHANGE_REQUIRED") throw redirect("/me/security?required=password");
  if (failure.code === "MFA_SETUP_REQUIRED") throw redirect("/me/security?required=mfa");
}

/** 실패를 돌려준다(action에서 폼 오류로 보여 줄 때) */
export async function callApi<T>(ctx: BffRequestContext, request: Request, path: string, options: CallOptions = {}): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await send(ctx, request, path, options);
  } catch (error) {
    if (error instanceof UpstreamUnavailableError) return { ok: false, status: error.status, code: error.code, message: "" };
    throw error;
  }
  if (response.status === 204) return { ok: true, status: 204, data: undefined as T };
  const envelope = await readEnvelope<T>(response);
  if (response.ok) return { ok: true, status: response.status, data: envelope.response as T };
  const failure = toFailure(response.status, envelope, retryAfterOf(response));
  handleGuards(options, failure);
  return failure;
}

export async function callList<T>(ctx: BffRequestContext, request: Request, path: string, options: CallOptions = {}): Promise<ListResult<T>> {
  let response: Response;
  try {
    response = await send(ctx, request, path, options);
  } catch (error) {
    if (error instanceof UpstreamUnavailableError) return { ok: false, status: error.status, code: error.code, message: "" };
    throw error;
  }
  const envelope = (await readEnvelope<unknown>(response)) as unknown as ListEnvelope<T>;
  if (response.ok) return { ok: true, status: response.status, list: { ...envelope, responses: envelope.responses ?? [] } };
  const failure = toFailure(response.status, envelope, retryAfterOf(response));
  handleGuards(options, failure);
  return failure;
}

/** loader용: 실패하면 오류 화면으로(403·404·503) */
export function orThrow<T>(result: ApiResult<T>): T {
  if (result.ok) return result.data;
  throw data({ code: result.code }, { status: result.status === 401 ? 401 : result.status });
}

export function listOrThrow<T>(result: ListResult<T>): ListEnvelope<T> {
  if (result.ok) return result.list;
  throw data({ code: result.code }, { status: result.status });
}

/** 권한이 없으면 403 화면(UI-IAM-13). 실제 거부는 서버가 다시 한다 */
export function requirePermission(permissions: readonly string[] | undefined, ...required: string[]) {
  if (!required.some((p) => permissions?.includes(p))) {
    throw data({ code: "PERMISSION_DENIED", required }, { status: 403 });
  }
}

export function newIdempotencyKey() {
  return randomUUID();
}

/** 폼 값 하나를 문자열로 */
export function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}
