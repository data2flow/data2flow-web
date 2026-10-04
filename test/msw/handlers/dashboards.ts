/**
 * 가짜 사용자 정의 대시보드·위젯·공유 링크·브랜딩(API-DSH-06·07·09·10·12·13·15·25, core `board`·`branding` 컨트롤러 모양).
 * 상태는 core.extra.dash에 둔다. 테스트는 dashState(core)로 꺼내 바꾼다.
 */
import { HttpResponse } from "msw";
import { fail, list, ok, type CoreHandler, type CoreState } from "../core-fixtures";
import { devicesHandler } from "./devices";
import { prefsOf } from "./home";

export interface FakeDashboard {
  id: string;
  name: string;
  description: string | null;
  visibility: "PRIVATE" | "ORG";
  ownerUserId: string;
  ownerName: string;
  layout: { widgets: Record<string, unknown>[] };
  variables: Record<string, unknown>[];
  timeRange: Record<string, unknown>;
  resolution: string;
  refresh: string;
  version: number;
  updatedBy: string | null;
  updatedAt: string;
}

export interface DashState {
  dashboards: FakeDashboard[];
  shareLinks: { id: string; dashboardId: string; token: string; expiresAt: string; revokedAt: string | null; lastUsedAt: string | null; createdBy: string; createdAt: string }[];
  widgetCalls: { dashboardId: string; widgetId: string; body: unknown }[];
  publicCalls: { path: string; headers: Record<string, string>; body: unknown }[];
  failWidget: Set<string>;
  branding: Record<string, unknown> & { version: number };
  /** 화면 설정 중 대시보드 몫(API-DSH-12 home·defaultDashboardId·toursDismissed). 나머지는 기기 핸들러가 맡는다 */
  prefs: Record<string, { home: string; defaultDashboardId: string | null; toursDismissed: string[] }>;
  seq: number;
}

export const SHARE_TOKEN = "tok_AbCdEfGhIjKlMnOpQrStUv0123456789";
export const DASH_ID = "501";
export const PRIVATE_DASH_ID = "502";

export const WIDGET_TYPES = [
  { type: "stat", label: "현재값", optionsSchema: { type: "object", properties: { unit: { type: "string" }, decimals: { type: "integer", minimum: 0, maximum: 4 }, thresholds: { type: "array" }, trend: { type: "boolean" }, sparkline: { type: "boolean" } } }, targetRule: { min: 1, max: 1, kinds: ["DEVICE_METRIC", "SPACE_AGGREGATE"] } },
  { type: "line", label: "선 차트", optionsSchema: { type: "object", properties: { yMin: { type: "number" }, yMax: { type: "number" }, legend: { type: "string", enum: ["bottom", "right", "hidden"] }, showQuality: { type: "boolean" }, annotations: { type: "array" } } }, targetRule: { min: 1, max: 20, kinds: ["DEVICE_METRIC", "SPACE_AGGREGATE"] } },
  { type: "gauge", label: "게이지", optionsSchema: { type: "object", properties: { min: { type: "number" }, max: { type: "number" }, ranges: { type: "array" } } }, targetRule: { min: 1, max: 1, kinds: ["DEVICE_METRIC", "SPACE_AGGREGATE"] } },
  { type: "table", label: "표", optionsSchema: { type: "object", properties: { columns: { type: "array" } } }, targetRule: { min: 1, max: 20, kinds: ["DEVICE_METRIC", "SPACE_AGGREGATE"] } },
  { type: "alarm-list", label: "알람 목록", optionsSchema: { type: "object", properties: { maxRows: { type: "integer", minimum: 5, maximum: 50 } } }, targetRule: { min: 0, max: 20, kinds: ["DEVICE", "SPACE"] } },
  { type: "markdown", label: "메모", optionsSchema: { type: "object", properties: { content: { type: "string", maxLength: 10000 } } }, targetRule: { min: 0, max: 0, kinds: [] } },
];

function seed(): DashState {
  const spaceVar = { name: "space", type: "SPACE", label: "공간", default: "31" };
  return {
    dashboards: [
      {
        id: DASH_ID,
        name: "실습실 운영",
        description: "3층 실습실 환경",
        visibility: "ORG",
        ownerUserId: "7",
        ownerName: "김운영",
        layout: {
          widgets: [
            { id: "w1", type: "stat", title: "CO2 현재값", x: 0, y: 0, w: 4, h: 4, targets: [{ kind: "SPACE_AGGREGATE", spaceId: "${space}", metricKey: "co2", agg: "avg" }], options: { unit: "ppm" } },
            { id: "w2", type: "line", title: "온도·CO2 추이", x: 4, y: 0, w: 12, h: 8, targets: [{ kind: "DEVICE_METRIC", deviceId: "1042", metricKey: "co2" }], options: {} },
            { id: "w3", type: "gauge", title: "습도", x: 16, y: 0, w: 4, h: 5, targets: [{ kind: "SPACE_AGGREGATE", spaceId: "${space}", metricKey: "humidity" }], options: { min: 0, max: 100 } },
            { id: "w4", type: "alarm-list", title: "열린 알람", x: 0, y: 8, w: 8, h: 6, targets: [{ kind: "SPACE", spaceId: "${space}" }], options: {} },
            { id: "w5", type: "markdown", title: "메모", x: 8, y: 8, w: 6, h: 4, options: { content: "<script>alert(1)</script> 점검일: 매주 월" } },
          ],
        },
        variables: [spaceVar],
        timeRange: { relative: "24h" },
        resolution: "AUTO",
        refresh: "LIVE",
        version: 3,
        updatedBy: "7",
        updatedAt: "2026-10-03T09:00:00Z",
      },
      {
        id: PRIVATE_DASH_ID,
        name: "내 개인 보드",
        description: null,
        visibility: "PRIVATE",
        ownerUserId: "7",
        ownerName: "김운영",
        layout: { widgets: [] },
        variables: [],
        timeRange: { relative: "6h" },
        resolution: "AUTO",
        refresh: "OFF",
        version: 1,
        updatedBy: "7",
        updatedAt: "2026-10-02T09:00:00Z",
      },
    ],
    shareLinks: [{ id: "71", dashboardId: DASH_ID, token: SHARE_TOKEN, expiresAt: "2026-10-11T00:00:00Z", revokedAt: null, lastUsedAt: null, createdBy: "7", createdAt: "2026-10-03T00:00:00Z" }],
    widgetCalls: [],
    publicCalls: [],
    failWidget: new Set(),
    branding: { logoLightUrl: null, logoDarkUrl: null, faviconUrl: null, primaryColor: "#206BC4", loginBackgroundUrl: null, loginMessage: null, mailSenderName: "data2flow 운영팀", mailSignature: null, publicTheme: "AUTO", appName: null, appShortName: null, contrastRatio: 5.2, version: 1 },
    prefs: {},
    seq: 600,
  };
}

export function dashState(core: CoreState): DashState {
  return (core.extra.dash ??= seed()) as DashState;
}

const visible = (d: FakeDashboard, userId: string) => d.visibility === "ORG" || d.ownerUserId === userId;
const editable = (d: FakeDashboard, user: { id: string }, can: (p: string) => boolean) => can("DASHBOARD_WRITE") && (d.ownerUserId === user.id || can("OPS_MANAGE"));

function response(d: FakeDashboard, user: { id: string }, can: (p: string) => boolean) {
  const { ownerName: _ownerName, ...rest } = d;
  return { ...rest, templateSource: null, editable: editable(d, user, can) };
}

/** API-DSH-09 위젯 데이터(종류별 모양) */
export function widgetPayload(widget: Record<string, unknown>, variables: Record<string, string>): unknown {
  const space = variables.space ?? "31";
  switch (widget.type) {
    case "stat":
      return { type: "stat", data: { value: space === "32" ? 640 : 1150, unit: "ppm", quality: 0, at: "2026-10-03T23:59:00Z", previous: 1100 } };
    case "line":
      return { type: "line", data: { series: [{ key: "1042.co2", label: "실습실 CO2", unit: "ppm", virtual: false, points: [["2026-10-03T23:00:00Z", 1000, 0], ["2026-10-03T23:30:00Z", 1100, 0], ["2026-10-04T00:00:00Z", 1150, 1]] }], effectiveResolution: "1m", annotations: [] } };
    case "gauge":
      return { type: "gauge", data: { value: 48, unit: "%", min: 0, max: 100 } };
    case "alarm-list":
      return { type: "alarm-list", data: { items: [{ alarmId: "9001", severity: "MAJOR", title: space === "32" ? "사무실 고온" : "실습실 고CO2", state: "ACTIVE", at: "2026-10-03T23:42:00Z" }] } };
    case "table":
      return { type: "table", data: { columns: ["대상", "현재값"], rows: [["실습실 CO2", 1150]] } };
    default:
      return { type: String(widget.type), data: null };
  }
}

export const dashboardsHandler: CoreHandler = async (core, req) => {
  const { request, method, path, url, body, user, can } = req;
  const state = dashState(core);
  const mine = (state.prefs[user.id] ??= { home: "HOME", defaultDashboardId: null, toursDismissed: [] });
  if (path === "/accounts/me/preferences") {
    const input = (body ?? {}) as { home?: string; toursDismissed?: string[]; defaultDashboardId?: string | null };
    const delegated = await devicesHandler(core, req);
    if (!delegated || !delegated.ok) return delegated;
    if (method === "PUT") {
      if (input.home) mine.home = input.home;
      if (input.toursDismissed) mine.toursDismissed = input.toursDismissed;
      if (input.defaultDashboardId !== undefined) mine.defaultDashboardId = input.defaultDashboardId;
    }
    const json = (await delegated.json()) as { response: Record<string, unknown> };
    return ok({ ...json.response, ...mine });
  }
  if (path === "/branding/assets" && method === "POST") {
    if (!can("BRANDING_MANAGE")) return fail(403, "PERMISSION_DENIED");
    const form = await request.formData();
    const file = form.get("file") as File | null;
    if (!file || file.size > 1024 * 1024 || (await file.text()).includes("<script")) return fail(400, "BRANDING_ASSET_INVALID");
    const id = String(++state.seq);
    return ok({ assetId: id, kind: String(form.get("kind")), url: `/api/v1/core/public/branding/assets/${id}`, contentType: file.type, sizeBytes: file.size }, 201);
  }
  if (path === "/widget-types" && method === "GET") return can("DASHBOARD_READ") ? ok(WIDGET_TYPES) : fail(403, "PERMISSION_DENIED");
  if (path === "/accounts/me/default-dashboard" && method === "PUT") {
    const id = (body as { dashboardId?: string | null })?.dashboardId ?? null;
    if (id && !state.dashboards.some((d) => d.id === id && visible(d, user.id))) return fail(404, "DASHBOARD_NOT_FOUND");
    mine.defaultDashboardId = id;
    return ok({ defaultDashboardId: id });
  }
  if (path === "/widgets/preview" && method === "POST") {
    const b = body as { widget?: Record<string, unknown>; variables?: Record<string, string> };
    state.widgetCalls.push({ dashboardId: "preview", widgetId: String(b.widget?.id ?? ""), body });
    return ok(widgetPayload(b.widget ?? {}, b.variables ?? {}));
  }
  if (path === "/branding" && method === "GET") return can("DASHBOARD_READ") ? ok(state.branding) : fail(403, "PERMISSION_DENIED");
  if (path === "/branding" && method === "PUT") {
    if (!can("BRANDING_MANAGE")) return fail(403, "PERMISSION_DENIED");
    const b = body as Record<string, unknown> & { baseVersion?: number };
    if (b.baseVersion !== state.branding.version) return fail(409, "VERSION_CONFLICT");
    const { baseVersion: _base, contrastWarningAcked: _ack, ...rest } = b;
    state.branding = { ...state.branding, ...rest, version: state.branding.version + 1 };
    return ok(state.branding);
  }
  if (!path.startsWith("/dashboards")) return undefined;
  if (!can("DASHBOARD_READ")) return fail(403, "PERMISSION_DENIED");

  if (path === "/dashboards" && method === "GET") {
    const tab = url.searchParams.get("tab") ?? "mine";
    const prefs = prefsOf(core, user.id);
    const favorites = new Set(prefs.favorites.filter((f) => f.type === "DASHBOARD").map((f) => f.id));
    const items = state.dashboards
      .filter((d) => visible(d, user.id))
      .filter((d) => (tab === "mine" ? d.ownerUserId === user.id : tab === "shared" ? d.visibility === "ORG" : favorites.has(d.id)))
      .map((d) => ({ id: d.id, name: d.name, description: d.description, visibility: d.visibility, ownerUserId: d.ownerUserId, ownerName: d.ownerName, favorite: favorites.has(d.id), widgetCount: d.layout.widgets.length, updatedAt: d.updatedAt }));
    return list(items, url);
  }
  if (path === "/dashboards" && method === "POST") {
    if (!can("DASHBOARD_WRITE")) return fail(403, "PERMISSION_DENIED");
    const b = body as Partial<FakeDashboard>;
    const id = String(++state.seq);
    state.dashboards.push({ id, name: String(b.name), description: null, visibility: (b.visibility as "PRIVATE") ?? "PRIVATE", ownerUserId: user.id, ownerName: user.name, layout: b.layout ?? { widgets: [] }, variables: b.variables ?? [], timeRange: b.timeRange ?? { relative: "24h" }, resolution: "AUTO", refresh: "LIVE", version: 1, updatedBy: user.id, updatedAt: "2026-10-04T00:00:00Z" });
    return ok({ id, name: b.name, visibility: b.visibility ?? "PRIVATE", version: 1 }, 201, { Location: `/api/v1/core/dashboards/${id}` });
  }
  if (path === "/dashboards/import" && method === "POST") {
    if (!can("DASHBOARD_WRITE")) return fail(403, "PERMISSION_DENIED");
    const b = body as { dashboard: Partial<FakeDashboard> };
    const id = String(++state.seq);
    state.dashboards.push({ id, name: String(b.dashboard.name), description: null, visibility: "PRIVATE", ownerUserId: user.id, ownerName: user.name, layout: b.dashboard.layout ?? { widgets: [] }, variables: b.dashboard.variables ?? [], timeRange: { relative: "24h" }, resolution: "AUTO", refresh: "LIVE", version: 1, updatedBy: user.id, updatedAt: "2026-10-04T00:00:00Z" });
    return ok({ id, name: b.dashboard.name, version: 1, unmapped: [{ ref: "w1/0", reason: "DEVICE_NOT_FOUND" }] }, 201);
  }
  const m = /^\/dashboards\/(\d+)(?:\/(.*))?$/.exec(path);
  if (!m) return undefined;
  const d = state.dashboards.find((x) => x.id === m[1]);
  if (!d || !visible(d, user.id)) return fail(404, "DASHBOARD_NOT_FOUND");
  const rest = m[2] ?? "";
  if (rest === "" && method === "GET") return ok(response(d, user, can));
  if (rest === "" && method === "PUT") {
    if (!editable(d, user, can)) return fail(403, "PERMISSION_DENIED");
    const b = body as Partial<FakeDashboard> & { baseVersion?: number };
    if (b.baseVersion !== d.version) return HttpResponse.json({ header: { isSuccessful: false, resultCode: "DASHBOARD_VERSION_CONFLICT", resultMessage: "msg:DASHBOARD_VERSION_CONFLICT" }, response: { version: d.version, updatedBy: d.updatedBy, updatedByName: "이통합", updatedAt: d.updatedAt } }, { status: 409 });
    const widgets = (b.layout?.widgets ?? []) as { x: number; y: number; w: number; h: number }[];
    if (widgets.length > 40 || widgets.some((w) => w.x + w.w > 24)) return fail(400, "DASHBOARD_LAYOUT_INVALID", { errors: [{ field: "layout.widgets", code: "OUT_OF_GRID", message: "" }] });
    Object.assign(d, { name: b.name ?? d.name, description: b.description ?? d.description, visibility: b.visibility ?? d.visibility, layout: b.layout ?? d.layout, variables: b.variables ?? d.variables, timeRange: b.timeRange ?? d.timeRange, resolution: b.resolution ?? d.resolution, refresh: b.refresh ?? d.refresh, version: d.version + 1, updatedBy: user.id });
    return ok(response(d, user, can));
  }
  if (rest === "" && method === "DELETE") {
    if (!editable(d, user, can)) return fail(403, "PERMISSION_DENIED");
    state.dashboards = state.dashboards.filter((x) => x !== d);
    return new HttpResponse(null, { status: 204 });
  }
  if (rest === "duplicate" && method === "POST") {
    if (!can("DASHBOARD_WRITE")) return fail(403, "PERMISSION_DENIED");
    const id = String(++state.seq);
    state.dashboards.push({ ...JSON.parse(JSON.stringify(d)), id, name: `${d.name} (복사본)`, visibility: "PRIVATE", ownerUserId: user.id, ownerName: user.name, version: 1 });
    return ok({ id, name: `${d.name} (복사본)`, visibility: "PRIVATE", version: 1 }, 201);
  }
  if (rest === "export" && method === "GET") {
    return ok({ formatVersion: 1, exportedAt: "2026-10-04T00:00:00Z", dashboard: { name: d.name, description: d.description, layout: d.layout, variables: d.variables, timeRange: d.timeRange, resolution: d.resolution, refresh: d.refresh }, targets: [] });
  }
  const wd = /^widgets\/([^/]+)\/data$/.exec(rest);
  if (wd && method === "POST") {
    state.widgetCalls.push({ dashboardId: d.id, widgetId: wd[1], body });
    if (state.failWidget.has(wd[1])) return fail(503, "SERVICE_UNAVAILABLE");
    const widget = d.layout.widgets.find((w) => w.id === wd[1]);
    if (!widget) return fail(404, "RESOURCE_NOT_FOUND");
    const vars = { ...Object.fromEntries(d.variables.map((v) => [String(v.name), String(v.default ?? "")])), ...((body as { variables?: Record<string, string> })?.variables ?? {}) };
    if (user.permissions.includes("DASHBOARD_READ") && user.role === "VIEWER" && wd[1] === "w3") return ok({ type: "gauge", data: { forbidden: true } });
    return ok(widgetPayload(widget, vars));
  }
  if (rest === "share-links") {
    if (!can("DASHBOARD_WRITE")) return fail(403, "PERMISSION_DENIED");
    if (method === "GET") return ok(state.shareLinks.filter((l) => l.dashboardId === d.id).map(({ token: _t, dashboardId: _d, ...l }) => l));
    if (method === "POST") {
      const days = (body as { expiresInDays?: number })?.expiresInDays ?? 7;
      if (!Number.isInteger(days) || days < 1 || days > 90) return fail(400, "INVALID_REQUEST", { errors: [{ field: "expiresInDays", code: "RANGE", message: "1~90" }] });
      const id = String(++state.seq);
      const token = `tok_new${id}abcdefghijklmnop`;
      const expiresAt = new Date(Date.parse("2026-10-04T00:00:00Z") + days * 86_400_000).toISOString();
      state.shareLinks.push({ id, dashboardId: d.id, token, expiresAt, revokedAt: null, lastUsedAt: null, createdBy: user.id, createdAt: "2026-10-04T00:00:00Z" });
      return ok({ id, url: `https://data2flow.java21.net/share/${token}`, expiresAt }, 201, { "Cache-Control": "no-store" });
    }
  }
  const sl = /^share-links\/(\d+)$/.exec(rest);
  if (sl && method === "DELETE") {
    if (!can("DASHBOARD_WRITE")) return fail(403, "PERMISSION_DENIED");
    const link = state.shareLinks.find((l) => l.id === sl[1] && l.dashboardId === d.id);
    if (!link) return fail(404, "RESOURCE_NOT_FOUND");
    link.revokedAt = "2026-10-04T00:00:00Z";
    return new HttpResponse(null, { status: 204 });
  }
  return undefined;
};

/** 공개 경로(로그인 없음): API-DSH-15 공유 보기·위젯 데이터, API-DSH-25 공개 브랜딩·자산 */
export function dashboardsPublicHandler(core: CoreState, request: Request, path: string, body: unknown): Response | undefined {
  const state = dashState(core);
  const headers: Record<string, string> = {};
  request.headers.forEach((v, k) => {
    headers[k] = v;
  });
  const share = /^\/public\/share\/([^/]+)(?:\/widgets\/([^/]+)\/data)?$/.exec(path);
  if (share) {
    state.publicCalls.push({ path, headers, body });
    const link = state.shareLinks.find((l) => l.token === decodeURIComponent(share[1]));
    const now = Date.parse("2026-10-04T00:00:00Z");
    if (!link || link.revokedAt || Date.parse(link.expiresAt) <= now) return fail(404, "SHARE_LINK_INVALID");
    const d = state.dashboards.find((x) => x.id === link.dashboardId);
    if (!d) return fail(404, "SHARE_LINK_INVALID");
    const publicHeaders = { "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex", "Cache-Control": "no-store" };
    if (!share[2] && request.method === "GET") {
      return ok({ dashboard: { name: d.name, layout: { widgets: d.layout.widgets.filter((w) => w.type !== "control") }, variables: d.variables, timeRange: d.timeRange, resolution: d.resolution, refresh: d.refresh }, expiresAt: link.expiresAt, branding: { logoUrl: null, primaryColor: "#0055AA", publicTheme: "AUTO" } }, 200, publicHeaders);
    }
    if (share[2] && request.method === "POST") {
      const widget = d.layout.widgets.find((w) => w.id === share[2]);
      if (!widget) return fail(404, "RESOURCE_NOT_FOUND");
      return ok(widgetPayload(widget, (body as { variables?: Record<string, string> })?.variables ?? {}), 200, publicHeaders);
    }
  }
  if (path === "/public/branding" && request.method === "GET") return ok({ ...state.branding });
  const asset = /^\/public\/branding\/assets\/(\d+)$/.exec(path);
  if (asset) {
    if (asset[1] === "404") return fail(404, "RESOURCE_NOT_FOUND");
    if (asset[1] === "77") return new HttpResponse("<html></html>", { headers: { "Content-Type": "text/html" } });
    return new HttpResponse(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), { headers: { "Content-Type": "image/png" } });
  }
  return undefined;
}
