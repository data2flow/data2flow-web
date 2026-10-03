import type { TFunction } from "i18next";

/** 오류 문구는 resultCode로 고르고, 번역이 없으면 서버 resultMessage, 그것도 없으면 일반 문구(ADR-037) */
export function errorText(t: TFunction, failure: { code: string; message?: string; retryAfter?: number } | null | undefined): string | undefined {
  if (!failure) return undefined;
  const key = `errors.${failure.code}`;
  const translated = t(key, { n: failure.retryAfter ?? 30, defaultValue: "" });
  if (translated) return translated;
  if (failure.message && failure.message !== failure.code) return failure.message;
  return t("errors.UNKNOWN");
}

/** 비밀번호 정책 위반은 서버가 사유를 담은 문구(Accept-Language로 현지화)를 준다. 있으면 그것을 보여 준다 */
export function policyErrorText(t: TFunction, failure: { code: string; message?: string; retryAfter?: number }): string | undefined {
  if (failure.code === "PASSWORD_POLICY_VIOLATION" && failure.message && failure.message !== failure.code) return failure.message;
  return errorText(t, failure);
}
