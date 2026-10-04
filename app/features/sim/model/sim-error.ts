/**
 * 가상 환경 오류 문구: resultCode 문구에 api-rules §5 검증 상세 `errors[{field, code, message}]`(SIM 중계 오류, 예: SIM_PROPERTY_OUT_OF_RANGE
 * `overrides.setpoint`, SIM_SCENARIO_INVALID `events[3].at`)를 붙여 무엇이 틀렸는지 보이게 한다. 상세는 5개까지.
 */
import type { TFunction } from "i18next";
import { errorText } from "~/lib/error-text";

export interface SimFailure {
  code: string;
  message?: string;
  retryAfter?: number;
  errors?: { field?: string | null; code?: string | null; message?: string | null }[] | null;
}

export const MAX_ERROR_DETAILS = 5;

export function errorDetails(errors: SimFailure["errors"]): string[] {
  return (errors ?? [])
    .map((e) => {
      const text = e.message || e.code || "";
      if (!text) return "";
      return e.field ? `${e.field}: ${text}` : text;
    })
    .filter(Boolean)
    .slice(0, MAX_ERROR_DETAILS);
}

export function simErrorText(t: TFunction, failure: SimFailure | null | undefined): string | undefined {
  if (!failure) return undefined;
  const base = errorText(t, failure);
  const details = errorDetails(failure.errors);
  return details.length ? `${base} (${details.join("; ")})` : base;
}
