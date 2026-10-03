/**
 * 화면 메뉴와 권한(IAM-04.01, IAM-04.05). 메뉴를 숨기는 것은 보조 수단이고 실제 거부는 서버가 한다.
 * 권한 이름은 spec/IAM-identity.md의 Permission 목록을 따른다.
 */
export type MenuKey = "home" | "members" | "roles" | "security" | "audit" | "settings";

export interface MenuItem {
  key: MenuKey;
  path: string;
  /** 이 권한 중 하나라도 있어야 보인다. 비어 있으면 로그인한 모두 */
  anyOf: string[];
  group: "main" | "admin";
}

export const MENU: MenuItem[] = [
  { key: "home", path: "/", anyOf: [], group: "main" },
  { key: "members", path: "/admin/members", anyOf: ["IAM_MANAGE"], group: "admin" },
  { key: "roles", path: "/admin/roles", anyOf: ["IAM_MANAGE"], group: "admin" },
  { key: "security", path: "/admin/security", anyOf: ["IAM_MANAGE"], group: "admin" },
  { key: "audit", path: "/admin/audit", anyOf: ["AUDIT_READ"], group: "admin" },
  { key: "settings", path: "/admin/settings", anyOf: ["OPS_MANAGE"], group: "admin" },
];

export function hasAny(permissions: readonly string[] | undefined, required: readonly string[]): boolean {
  if (required.length === 0) return true;
  const owned = new Set(permissions ?? []);
  return required.some((permission) => owned.has(permission));
}

/** 보이는 메뉴. 비밀번호 변경이 필요한 상태(IAM-01.02)면 메뉴를 하나도 보여 주지 않는다 */
export function visibleMenu(permissions: readonly string[] | undefined, mustChangePassword = false): MenuItem[] {
  if (mustChangePassword) return [];
  return MENU.filter((item) => hasAny(permissions, item.anyOf));
}

/** 경로에 필요한 권한(라우트 가드) */
export function requiredPermissionsFor(pathname: string): string[] {
  const item = MENU.filter((m) => m.path !== "/" && (pathname === m.path || pathname.startsWith(`${m.path}/`))).sort((a, b) => b.path.length - a.path.length)[0];
  return item?.anyOf ?? [];
}
