/** 공통 응답 형식(design/api-rules.md §3, ADR-035) */
export interface ResultHeader {
  isSuccessful: boolean;
  resultCode: string;
  resultMessage: string;
}

export interface FieldError {
  field: string;
  code: string;
  message: string;
}

export interface ApiEnvelope<T> {
  header: ResultHeader;
  response?: T;
  errors?: FieldError[];
}

export interface ListEnvelope<T> {
  header: ResultHeader;
  page?: number;
  size?: number;
  totalPages?: number;
  responses: T[];
  totalCount?: number;
  /** 커서 목록(감사 로그 등)에만 */
  nextCursor?: string | null;
}

/** 화면에서 쓰는 실패 결과. 문구는 resultCode로 고른다(ADR-037) */
export interface ApiFailure {
  ok: false;
  status: number;
  code: string;
  message: string;
  errors?: FieldError[];
  retryAfter?: number;
  /** 실패 응답의 `response`(예: DEVICE_QUERY_INVALID의 `{column, message}`, DEV-13.03) */
  detail?: unknown;
}

export type BuiltinRole = "ADMIN" | "INTEGRATOR" | "OPERATOR" | "ANALYST" | "VIEWER";
export const BUILTIN_ROLES: BuiltinRole[] = ["ADMIN", "INTEGRATOR", "OPERATOR", "ANALYST", "VIEWER"];

/** API-IAM-04 내 정보 */
export interface Me {
  id: string;
  loginId: string;
  email?: string;
  name?: string;
  phone?: string;
  locale?: string;
  timezone?: string;
  role?: string;
  customRole?: { id: string; name: string } | string | null;
  permissions: string[];
  spaceScope?: unknown[];
  mustChangePassword?: boolean;
  mfaEnabled?: boolean;
  version?: number;
}
