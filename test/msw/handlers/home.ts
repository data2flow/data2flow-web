/**
 * 가짜 홈 요약(API-DSH-01)과 내 화면 설정·즐겨찾기·최근 본 항목(API-DSH-12). 사용자별로 core.extra에 둔다.
 */
import { fail, ok, type CoreHandler, type CoreState } from "../core-fixtures";
import { comfortRows } from "./spaces";

interface Prefs {
  theme: string;
  favorites: { type: string; id: string }[];
  recent: { type: string; id: string; at: string }[];
  version: number;
}

export function prefsOf(core: CoreState, userId: string): Prefs {
  const all = (core.extra.prefs ??= {}) as Record<string, Prefs>;
  return (all[userId] ??= { theme: "SYSTEM", favorites: [], recent: [], version: 1 });
}

function nameOf(core: CoreState, type: string, id: string) {
  if (type === "SPACE") return core.spaces.find((s) => s.id === id)?.name ?? null;
  if (type === "DEVICE") return core.devices.find((d) => d.id === id)?.name ?? null;
  return null;
}

export const homeHandler: CoreHandler = (core, { method, path, body, user, can }) => {
  if (path === "/home/summary" && method === "GET") {
    if (core.extra.homeFails) return fail(503, "SERVICE_UNAVAILABLE");
    const comfort = comfortRows(core);
    return ok({
      alarms: { critical: 1, major: 3, minor: 2, warning: 0, info: 0 },
      offlineDevices: core.devices.filter((d) => d.connectivity === "OFFLINE").length,
      ...(can("DEV_PLACE") ? { pendingDevices: core.devices.filter((d) => d.status === "PENDING").length } : {}),
      ingestPerMinute: core.sources.reduce((n, s) => n + s.ratePerMin, 0),
      ...(can("SRC_READ") ? { sources: { connected: core.sources.filter((s) => s.state === "CONNECTED").length, total: core.sources.length } } : {}),
      comfort,
      comfortTotal: comfort.length,
      timeline: [
        { type: "CONTROL", at: "2026-10-03T02:43:00Z", title: "환기 2단", origin: "FLOW", link: "/control/commands" },
        { type: "ALARM_RAISED", at: "2026-10-03T02:42:00Z", title: "실습실 고CO2", severity: "MAJOR", link: "/alarms/1" },
      ],
      aiSummary: null,
    });
  }
  if (!path.startsWith("/accounts/me/")) return undefined;
  const prefs = prefsOf(core, user.id);
  if (path === "/accounts/me/preferences" && method === "GET") {
    return ok({ theme: prefs.theme, locale: user.locale ?? "ko", timeZone: user.timezone ?? "Asia/Seoul", home: "HOME", defaultDashboardId: null, favorites: prefs.favorites.map((f) => ({ ...f, name: nameOf(core, f.type, f.id) })), recent: prefs.recent.map((r) => ({ ...r, name: nameOf(core, r.type, r.id) })), toursDismissed: [], temperatureUnit: "C", version: prefs.version });
  }
  if (path === "/accounts/me/preferences" && method === "PUT") {
    const input = body as Partial<Prefs> & { baseVersion?: number };
    if (input.baseVersion !== prefs.version) return fail(409, "VERSION_CONFLICT");
    if (input.favorites) prefs.favorites = input.favorites.map((f) => ({ type: f.type, id: String(f.id) }));
    if (input.theme) prefs.theme = input.theme;
    prefs.version += 1;
    return ok({ theme: prefs.theme, favorites: prefs.favorites, version: prefs.version });
  }
  if (path === "/accounts/me/recent" && method === "POST") {
    const item = body as { type: string; id: string };
    prefs.recent = [{ type: item.type, id: String(item.id), at: "2026-10-04T00:00:00Z" }, ...prefs.recent.filter((r) => !(r.type === item.type && r.id === String(item.id)))].slice(0, 20);
    return new Response(null, { status: 204 });
  }
  return undefined;
};
