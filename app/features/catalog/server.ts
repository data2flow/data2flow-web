/**
 * 카탈로그 화면 loader·action 공용(서버 전용 모듈에서만 부른다).
 */
import { data } from "react-router";
import type { ApiFailure } from "~/lib/api-types";

export type CatalogActionResult = {
  intent: string;
  done?: boolean;
  error?: { code: string; message?: string; references?: { type: string; id: string; name: string }[] };
  fieldErrors?: Record<string, string>;
  remapJobId?: string | null;
};

export function failed(intent: string, failure: ApiFailure & { references?: { type: string; id: string; name: string }[] }) {
  return data<CatalogActionResult>({ intent, error: { code: failure.code, message: failure.message, references: failure.references } }, { status: failure.status });
}

export function invalid(intent: string, fieldErrors: Record<string, string>) {
  return data<CatalogActionResult>({ intent, fieldErrors }, { status: 400 });
}

export function can(permissions: readonly string[] | undefined, permission: string) {
  return Boolean(permissions?.includes(permission));
}

/** 결과 없는 쓰기: 성공이면 done, 실패면 오류 응답 */
export function outcome(intent: string, result: { ok: true } | (ApiFailure & { ok: false })) {
  return result.ok ? ({ intent, done: true } as CatalogActionResult) : failed(intent, result);
}
