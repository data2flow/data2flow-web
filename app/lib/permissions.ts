/**
 * 화면 메뉴와 권한(IAM-04.01, IAM-04.05). 메뉴를 숨기는 것은 보조 수단이고 실제 거부는 서버가 한다.
 * 권한 이름은 spec/IAM-identity.md의 Permission 목록을, 경로는 spec/detail/00-navigation.md §2를 따른다.
 */
export type MenuKey = "home" | "spaces" | "devices" | "explore" | "ingest" | "members" | "roles" | "security" | "audit" | "settings";

export interface MenuItem {
  key: MenuKey;
  path: string;
  /** 이 권한 중 하나라도 있어야 보인다. 비어 있으면 로그인한 모두 */
  anyOf: string[];
  group: "main" | "admin";
  /** 이 메뉴가 현재 메뉴로 표시되는 다른 경로 접두사(예: 수집 메뉴는 /sources·/scripts도 포함) */
  sections?: string[];
}

export const MENU: MenuItem[] = [
  { key: "home", path: "/", anyOf: [], group: "main" },
  { key: "spaces", path: "/spaces", anyOf: ["DEV_READ"], group: "main", sections: ["/sites"] },
  { key: "devices", path: "/devices", anyOf: ["DEV_READ"], group: "main", sections: ["/models", "/metrics", "/device-groups"] },
  { key: "explore", path: "/explore", anyOf: ["TS_READ"], group: "main" },
  { key: "ingest", path: "/ingest/monitor", anyOf: ["INGEST_READ"], group: "main", sections: ["/ingest", "/sources", "/scripts"] },
  { key: "members", path: "/admin/members", anyOf: ["IAM_MANAGE"], group: "admin" },
  { key: "roles", path: "/admin/roles", anyOf: ["IAM_MANAGE"], group: "admin" },
  { key: "security", path: "/admin/security", anyOf: ["IAM_MANAGE"], group: "admin" },
  { key: "audit", path: "/admin/audit", anyOf: ["AUDIT_READ"], group: "admin" },
  { key: "settings", path: "/admin/settings", anyOf: ["OPS_MANAGE"], group: "admin" },
];

/** 메뉴 밖 경로의 권한(라우트 가드). 가장 긴 접두사가 이긴다 */
export const ROUTE_GUARDS: { prefix: string; anyOf: string[] }[] = [
  ...MENU.filter((m) => m.path !== "/").map((m) => ({ prefix: m.path, anyOf: m.anyOf })),
  { prefix: "/sites", anyOf: ["DEV_READ"] },
  { prefix: "/models", anyOf: ["DEV_READ"] },
  { prefix: "/metrics", anyOf: ["DEV_READ"] },
  { prefix: "/device-groups", anyOf: ["DEV_READ"] },
  { prefix: "/devices/new", anyOf: ["DEV_ADMIN"] },
  { prefix: "/ingest", anyOf: ["INGEST_READ"] },
  { prefix: "/sources", anyOf: ["SRC_READ"] },
  { prefix: "/sources/new", anyOf: ["SRC_ADMIN"] },
  { prefix: "/scripts", anyOf: ["SCRIPT_READ"] },
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

const matches = (pathname: string, prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);

/** 경로에 필요한 권한(라우트 가드) */
export function requiredPermissionsFor(pathname: string): string[] {
  const guard = ROUTE_GUARDS.filter((g) => matches(pathname, g.prefix)).sort((a, b) => b.prefix.length - a.prefix.length)[0];
  return guard?.anyOf ?? [];
}

/** 현재 경로가 이 메뉴에 속하는지(상단 메뉴 밑줄) */
export function isMenuActive(item: MenuItem, pathname: string): boolean {
  if (item.path === "/") return pathname === "/";
  return [item.path, ...(item.sections ?? [])].some((prefix) => matches(pathname, prefix));
}
