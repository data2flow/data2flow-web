/**
 * 왼쪽 막대(목업 H.shell의 rail, 208px) 하위 메뉴(DSH-07.02). 상단 메뉴 하나에 딸린 화면 묶음을 보여 준다.
 * 경로와 묶음은 00-navigation.md §2와 각 메뉴의 구역 탭(기기·수집·규칙·알람·자동화·제어·가상 환경)과 같고,
 * 관리 메뉴는 상단에서 "관리" 하나로 접고 여기에서 항목을 보여 준다(목업 상단 메뉴: 홈 … 가상 환경 · 관리).
 * 권한 없는 항목은 숨긴다(보조 수단, 실제 거부는 서버, IAM-04.05).
 */
import { hasAny, isMenuActive, requiredPermissionsFor, visibleMenu, type MenuItem, type MenuKey } from "./permissions";

export interface RailItem {
  /** i18n 키 */
  label: string;
  path: string;
  /** 생략하면 경로 가드(ROUTE_GUARDS)로 거른다 */
  anyOf?: readonly string[];
}

export interface RailGroup {
  /** 막대 머리의 회색 소제목(i18n 키) */
  title: string;
  items: RailItem[];
}

export const RAIL: Partial<Record<MenuKey | "admin", RailItem[]>> = {
  spaces: [
    { label: "nav.spaces", path: "/spaces" },
    { label: "sites.title", path: "/sites" },
    { label: "calendar.title", path: "/calendar" },
  ],
  devices: [
    { label: "devices.area.all", path: "/devices" },
    { label: "devices.area.pending", path: "/devices/pending" },
    { label: "devices.area.models", path: "/models" },
    { label: "devices.area.metrics", path: "/metrics" },
    { label: "devices.area.groups", path: "/device-groups" },
    { label: "devices.area.jobs", path: "/device-jobs" },
    { label: "devmodel.gateways.title", path: "/gateways" },
    { label: "field.area.workOrders", path: "/work-orders" },
    { label: "field.area.installation", path: "/devices/installation" },
  ],
  explore: [
    { label: "explore.title", path: "/explore" },
    { label: "data.jobs.title", path: "/exports", anyOf: ["TS_EXPORT"] },
    { label: "data.imports.title", path: "/imports" },
  ],
  ingest: [
    { label: "ingest.area.monitor", path: "/ingest/monitor" },
    { label: "ingest.area.sources", path: "/sources" },
    { label: "ingest.area.scripts", path: "/scripts" },
    { label: "ingest.area.failures", path: "/ingest/failures" },
    { label: "ingest.area.reprocess", path: "/ingest/reprocess" },
    { label: "ingest.area.quality", path: "/ingest/quality" },
  ],
  alarms: [
    { label: "alarms.title", path: "/alarms" },
    { label: "rules.title", path: "/rules" },
    { label: "notify.tabs.policies", path: "/notifications/policies" },
    { label: "notify.tabs.templates", path: "/notifications/templates" },
    { label: "notify.tabs.silences", path: "/notifications/silences" },
    { label: "notify.tabs.onCall", path: "/notifications/on-call" },
    { label: "alarmStats.title", path: "/alarms/stats" },
  ],
  automation: [
    { label: "flowops.areas.flows", path: "/automation/flows", anyOf: ["FLOW_READ"] },
    { label: "flowops.areas.snapshots", path: "/automation/snapshots", anyOf: ["FLOW_WRITE"] },
    { label: "flowops.areas.pipelines", path: "/automation/pipelines", anyOf: ["FLOW_DEPLOY_CONTROL", "FLOW_APPROVE"] },
    { label: "flowops.areas.packages", path: "/automation/packages", anyOf: ["FLOW_DEPLOY_CONTROL", "NODE_PACKAGE_MANAGE"] },
    { label: "flowops.areas.sinks", path: "/automation/sink-connections", anyOf: ["SINK_CONNECTION_MANAGE"] },
  ],
  control: [
    { label: "control.area.scenes", path: "/control/scenes" },
    { label: "control.area.commands", path: "/control/commands" },
    { label: "control.area.schedules", path: "/control/schedules" },
    { label: "control.area.interlocks", path: "/control/interlocks" },
    { label: "control.area.drivers", path: "/control/drivers" },
    { label: "control.area.capabilities", path: "/control/capabilities" },
  ],
  // M6 분석(UI-ANA-01·04·06)·MCP 연결(UI-AIA-07)
  analytics: [
    { label: "analytics.area.templates", path: "/analytics/templates" },
    { label: "analytics.area.analyses", path: "/analytics", anyOf: ["ANALYTICS_READ"] },
    { label: "analytics.area.models", path: "/analytics/models" },
    { label: "analytics.area.mcp", path: "/ai/mcp" },
  ],
  sim: [
    { label: "sim.area.home", path: "/sim" },
    { label: "sim.area.catalog", path: "/sim/catalog" },
    { label: "sim.area.profiles", path: "/sim/profiles" },
    { label: "sim.area.spaces", path: "/sim/spaces" },
    { label: "sim.area.scenarios", path: "/sim/scenarios" },
    { label: "sim.area.replay", path: "/sim/replay" },
  ],
};

/** 캔버스가 넓어야 하는 편집 화면은 막대를 그리지 않는다(목업 flow-* 장면: rail 없음) */
const FULL_WIDTH = [/^\/automation\/flows\/[^/]+/];

const matches = (pathname: string, prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);

/** 상단에 보일 메뉴: 업무 메뉴 + (관리 항목이 하나라도 보이면) "관리" 하나. 관리는 첫 번째로 보이는 관리 화면으로 간다 */
export function topMenu(permissions: readonly string[] | undefined, locked: boolean): { main: MenuItem[]; admin: MenuItem[] } {
  const menu = visibleMenu(permissions, locked);
  return { main: menu.filter((m) => m.group === "main"), admin: menu.filter((m) => m.group === "admin") };
}

/** 지금 경로가 관리 메뉴 안인가 */
export function inAdmin(admin: MenuItem[], pathname: string): boolean {
  return admin.some((m) => isMenuActive(m, pathname));
}

/** 지금 경로의 막대 묶음. 막대가 없는 메뉴(홈·대시보드)와 메뉴 밖 경로는 null */
export function railFor(pathname: string, permissions: readonly string[] | undefined, locked: boolean): (RailGroup & { current?: string }) | null {
  if (locked || FULL_WIDTH.some((re) => re.test(pathname))) return null;
  const { main, admin } = topMenu(permissions, locked);
  let title: string;
  let items: RailItem[];
  if (inAdmin(admin, pathname)) {
    title = "nav.admin";
    items = admin.map((m) => ({ label: `nav.${m.key}`, path: m.path, anyOf: m.anyOf }));
  } else {
    const active = main.find((m) => m.path !== "/" && isMenuActive(m, pathname));
    if (!active || !RAIL[active.key]) return null;
    title = `nav.${active.key}`;
    items = RAIL[active.key]!.filter((i) => hasAny(permissions, i.anyOf ?? requiredPermissionsFor(i.path)));
  }
  if (items.length < 2) return null;
  const current = items
    .filter((i) => matches(pathname, i.path))
    .sort((a, b) => b.path.length - a.path.length)[0]?.path;
  return { title, items, current };
}
