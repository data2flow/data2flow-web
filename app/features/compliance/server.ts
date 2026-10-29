/**
 * 환경 기준 화면 loader·action 공용(서버 전용 모듈에서만 부른다).
 */
import { data, redirect } from "react-router";
import { callApi, field } from "~/bff/api.server";
import type { BffRequestContext } from "~/bff/middleware.server";
import type { ApiFailure } from "~/lib/api-types";
import { fieldKeyOf, type ProfileDraft } from "./model/profile-form";
import type { ProfileDetail } from "./model/types";

export type ComplianceActionResult = {
  intent: string;
  done?: boolean;
  error?: { code: string; message?: string };
  fieldErrors?: Record<string, string>;
};

export function failed(intent: string, failure: ApiFailure, fieldErrors?: Record<string, string>) {
  return data<ComplianceActionResult>({ intent, error: { code: failure.code, message: failure.message }, fieldErrors }, { status: failure.status });
}

export function invalid(intent: string, fieldErrors: Record<string, string>) {
  return data<ComplianceActionResult>({ intent, fieldErrors }, { status: 400 });
}

/** [복제해 수정](API-CMP-06): 복제하고 그 v1 편집 화면으로 간다 */
export async function cloneProfile(ctx: BffRequestContext, request: Request, form: FormData) {
  const profileId = encodeURIComponent(field(form, "profileId"));
  const name = field(form, "name").trim();
  if (!name) return invalid("clone", { name: "nameRequired" });
  const result = await callApi<ProfileDetail>(ctx, request, `/api/v1/core/compliance/profiles/${profileId}/clone`, { method: "POST", body: { name } });
  if (!result.ok) return failed("clone", result);
  throw redirect(`/compliance/profiles/${result.data.profileId}/edit`);
}

/** 서버 필드 오류(`metrics[co2].lower`)를 편집 화면 경로로. 코드는 `compliance.validation.*` 문구로 쓴다 */
export function editorFieldErrors(draft: ProfileDraft, failure: ApiFailure): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of failure.errors ?? []) out[fieldKeyOf(draft, e.field)] = SERVER_CODES[e.code] ?? "threshold";
  return out;
}

const SERVER_CODES: Record<string, string> = { NotBlank: "required", Size: "tooLong", Pattern: "url" };
