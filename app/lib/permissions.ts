/**
 * 화면 메뉴와 권한(IAM-04.01, IAM-04.05). 메뉴를 숨기는 것은 보조 수단이고 실제 거부는 서버가 한다.
 * 권한 이름은 spec/IAM-identity.md의 Permission 목록을, 경로는 spec/detail/00-navigation.md §2를 따른다.
 */
export type MenuKey = "home" | "spaces" | "devices" | "explore" | "ingest" | "alarms" | "automation" | "control" | "sim" | "members" | "roles" | "security" | "audit" | "settings" | "maintenance" | "channels";

export interface MenuItem {
  key: MenuKey;
  path: string;
  /** 이 권한 중 하나라도 있어야 보인다. 비어 있으면 로그인한 모두 */
  anyOf: string[];
  group: "main" | "admin";
  /** 이 메뉴가 현재 메뉴로 표시되는 다른 경로 접두사(예: 수집 메뉴는 /sources·/scripts도 포함) */
  sections?: string[];
  /** 경로 권한이 메뉴 노출 권한과 다를 때(예: 명령 이력은 메뉴는 제어 권한, 화면은 조회 권한) */
  guard?: string[];
}

export const MENU: MenuItem[] = [
  { key: "home", path: "/", anyOf: [], group: "main" },
  { key: "spaces", path: "/spaces", anyOf: ["DEV_READ"], group: "main", sections: ["/sites"] },
  { key: "devices", path: "/devices", anyOf: ["DEV_READ"], group: "main", sections: ["/models", "/metrics", "/device-groups"] },
  { key: "explore", path: "/explore", anyOf: ["TS_READ"], group: "main" },
  { key: "ingest", path: "/ingest/monitor", anyOf: ["INGEST_READ"], group: "main", sections: ["/ingest", "/sources", "/scripts"] },
  // M4 자동화 완성: 규칙·알람(RUL) — 알람 목록은 VIEWER부터, 규칙·알림 설정은 하위 경로 가드로 좁힌다
  { key: "alarms", path: "/alarms", anyOf: ["ALARM_READ"], group: "main", sections: ["/rules", "/notifications"] },
  // M3 폐루프(가상): 자동화(FLW), 제어(ACT 명령 이력), 가상 환경(SIM) — 00-navigation.md §2
  { key: "automation", path: "/automation/flows", anyOf: ["FLOW_READ"], group: "main", sections: ["/automation"] },
  { key: "control", path: "/control/commands", anyOf: ["DEVICE_CONTROL"], group: "main", sections: ["/control"], guard: ["DEV_READ"] },
  { key: "sim", path: "/sim", anyOf: ["SIM_READ"], group: "main" },
  { key: "members", path: "/admin/members", anyOf: ["IAM_MANAGE"], group: "admin" },
  { key: "roles", path: "/admin/roles", anyOf: ["IAM_MANAGE"], group: "admin" },
  { key: "security", path: "/admin/security", anyOf: ["IAM_MANAGE"], group: "admin" },
  { key: "audit", path: "/admin/audit", anyOf: ["AUDIT_READ"], group: "admin" },
  { key: "settings", path: "/admin/settings", anyOf: ["OPS_MANAGE"], group: "admin" },
  // M4: 유지보수 일정(UI-OPS-05, OPERATOR 이상 — API-OPS-20은 권한 이름 없이 "ADMIN, OPERATOR(공간 범위)"라 DEV_PLACE로 가린다), 알림 채널(UI-OPS-06)
  { key: "maintenance", path: "/admin/maintenance", anyOf: ["DEV_PLACE"], group: "admin" },
  { key: "channels", path: "/admin/channels", anyOf: ["NOTIFY_CHANNEL_MANAGE"], group: "admin" },
];

/** 메뉴 밖 경로의 권한(라우트 가드). 가장 긴 접두사가 이긴다 */
export const ROUTE_GUARDS: { prefix: string; anyOf: string[] }[] = [
  ...MENU.filter((m) => m.path !== "/").map((m) => ({ prefix: m.path, anyOf: m.guard ?? m.anyOf })),
  { prefix: "/sites", anyOf: ["DEV_READ"] },
  { prefix: "/models", anyOf: ["DEV_READ"] },
  { prefix: "/metrics", anyOf: ["DEV_READ"] },
  { prefix: "/device-groups", anyOf: ["DEV_READ"] },
  { prefix: "/devices/new", anyOf: ["DEV_ADMIN"] },
  { prefix: "/ingest", anyOf: ["INGEST_READ"] },
  { prefix: "/sources", anyOf: ["SRC_READ"] },
  { prefix: "/sources/new", anyOf: ["SRC_ADMIN"] },
  { prefix: "/scripts", anyOf: ["SCRIPT_READ"] },
  { prefix: "/automation", anyOf: ["FLOW_READ"] },
  { prefix: "/automation/flows/new", anyOf: ["FLOW_WRITE"] },
  { prefix: "/automation/templates", anyOf: ["FLOW_WRITE"] },
  { prefix: "/automation/approvals", anyOf: ["FLOW_WRITE", "FLOW_APPROVE"] },
  // 명령 이력(UI-ACT-02)은 조회 권한으로 연다(VIEWER 이상). 메뉴는 제어 권한이 있을 때만 보인다
  { prefix: "/control", anyOf: ["DEV_READ"] },
  // M4 자동화 완성(spec/detail/00-navigation.md §2)
  { prefix: "/alarms/stats", anyOf: ["RULE_READ"] },
  { prefix: "/rules", anyOf: ["RULE_READ"] },
  { prefix: "/rules/new", anyOf: ["RULE_WRITE"] },
  { prefix: "/notifications", anyOf: ["NOTIFY_POLICY_WRITE"] },
  { prefix: "/notifications/silences", anyOf: ["ALARM_HANDLE", "NOTIFY_POLICY_WRITE"] },
  { prefix: "/automation/sink-connections", anyOf: ["SINK_CONNECTION_MANAGE"] },
  // 스냅샷(UI-FLW-18)은 ANALYST도 본다(/automation의 FLOW_READ). 승격 요청(UI-FLW-19)은 OPERATOR부터, 확장 노드 목록(UI-FLW-21)도 OPERATOR부터 본다
  { prefix: "/automation/pipelines", anyOf: ["FLOW_WRITE"] },
  { prefix: "/automation/packages", anyOf: ["FLOW_WRITE"] },
  { prefix: "/settings/git-sync", anyOf: ["GIT_SYNC_MANAGE"] },
  { prefix: "/control/scenes", anyOf: ["SCENE_RUN", "SCENE_MANAGE"] },
  { prefix: "/control/schedules", anyOf: ["SCHEDULE_MANAGE"] },
  { prefix: "/control/interlocks", anyOf: ["INTERLOCK_MANAGE"] },
  { prefix: "/control/drivers", anyOf: ["DRIVER_MANAGE"] },
  { prefix: "/control/capabilities", anyOf: ["DEVICE_CONTROL", "CAPABILITY_MANAGE"] },
  { prefix: "/device-jobs", anyOf: ["DEV_READ"] },
  { prefix: "/me/notifications", anyOf: [] },
  // M5 scripts: 재처리 INTEGRATOR·ADMIN(UI-ING-05), 데이터 품질 OPERATOR·ANALYST 이상(UI-ING-06)
  { prefix: "/ingest/reprocess", anyOf: ["INGEST_REPROCESS"] },
  { prefix: "/ingest/quality", anyOf: ["INGEST_READ", "ANALYTICS_READ"] },
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
