/**
 * 화면 입력 검증(UI-IAM-01~07). 서버가 최종 판정하고, 여기서는 빠른 안내만 한다.
 * 규칙: BR-IAM-02(아이디), BR-IAM-03(비밀번호), UI-IAM-04(이름·연락처)
 */
export const LOGIN_ID_PATTERN = /^[a-z0-9._-]{4,30}$/;
export const RESERVED_LOGIN_IDS = ["admin", "system", "root", "support"];

export type LoginIdProblem = "required" | "format" | "reserved";

export function checkLoginId(raw: string): LoginIdProblem | undefined {
  const value = raw.trim().toLowerCase();
  if (!value) return "required";
  if (!LOGIN_ID_PATTERN.test(value)) return "format";
  if (RESERVED_LOGIN_IDS.includes(value)) return "reserved";
  return undefined;
}

export type PasswordProblem = "required" | "length" | "containsLoginId" | "containsEmail" | "mismatch";

/** 길이·아이디 포함만 미리 본다. 유출 목록·재사용은 서버가 확인한다(PASSWORD_POLICY_VIOLATION) */
export function checkPassword(password: string, context: { loginId?: string; email?: string; confirm?: string } = {}): PasswordProblem | undefined {
  if (!password) return "required";
  if (password.length < 10 || password.length > 128) return "length";
  const lower = password.toLowerCase();
  const loginId = context.loginId?.trim().toLowerCase();
  if (loginId && loginId.length >= 3 && lower.includes(loginId)) return "containsLoginId";
  const local = context.email?.split("@")[0]?.toLowerCase();
  if (local && local.length >= 3 && lower.includes(local)) return "containsEmail";
  if (context.confirm !== undefined && context.confirm !== password) return "mismatch";
  return undefined;
}

/** 0~4 단계 강도(표시용) */
export function passwordStrength(password: string): number {
  if (!password) return 0;
  let score = 0;
  if (password.length >= 10) score++;
  if (password.length >= 14) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/\d/.test(password) && /[^A-Za-z0-9]/.test(password)) score++;
  return Math.min(score, 4);
}

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const E164_PATTERN = /^\+[1-9]\d{6,14}$/;
export const TOTP_PATTERN = /^\d{6}$/;
/** 복구 코드: 영숫자·하이픈 8~20자 */
export const RECOVERY_CODE_PATTERN = /^[A-Za-z0-9-]{8,20}$/;

export function checkName(name: string, max = 50): "required" | "length" | undefined {
  const value = name.trim();
  if (!value) return "required";
  if (value.length > max) return "length";
  return undefined;
}

/** 줄바꿈·쉼표로 나눈 이메일 목록(초대, 최대 20개) */
export function parseEmails(raw: string): { emails: string[]; invalid: string[] } {
  const items = raw
    .split(/[\n,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  const unique = [...new Set(items.map((item) => item.toLowerCase()))];
  return { emails: unique.filter((e) => EMAIL_PATTERN.test(e)), invalid: unique.filter((e) => !EMAIL_PATTERN.test(e)) };
}
