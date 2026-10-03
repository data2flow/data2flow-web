/** 역할 선택 값: 기본 역할 이름 또는 `CUSTOM:{id}`(사용자 정의 역할, IAM-04.03) */
export function parseRole(value: string): { role: string; customRoleId?: string } {
  if (value.startsWith("CUSTOM:")) return { role: "CUSTOM", customRoleId: value.slice(7) };
  return { role: value };
}

export function roleValue(role: string | undefined, customRoleId?: string | null): string {
  if (role === "CUSTOM" && customRoleId) return `CUSTOM:${customRoleId}`;
  return role ?? "";
}

/** 사용자 정의 역할에 넣을 수 없는 권한(spec/IAM-identity.md Permission 목록) */
export const ADMIN_ONLY_PERMISSIONS = ["IAM_MANAGE", "AUDIT_READ"];

/** 공간 ID 목록 입력(쉼표·공백 구분) */
export function parseScope(raw: string): string[] {
  return raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 폼의 공간 범위(트리 선택은 `spaceScope` 여러 개, 예전 입력은 쉼표 구분 하나). 중복은 하나로 */
export function scopeFromForm(form: FormData, name = "spaceScope"): string[] {
  const values = form.getAll(name).filter((v): v is string => typeof v === "string");
  return [...new Set(values.flatMap(parseScope))];
}
