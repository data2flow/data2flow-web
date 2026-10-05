/**
 * 사이트 지도(UI-DSH-09, DSH-09.01): API-DSH-17 사이트 상태와 API-DEV-25 사이트 요약을 합치고,
 * 위·경도를 SVG 좌표로 바꾼다(등장방형 투영, 외부 지도 타일 없음). 상태 색은 알람 > 오프라인 > 정상 순서다.
 */

/** API-DSH-17 `sites[]` */
export interface SiteMapRow {
  id: string;
  name: string;
  lat?: number | null;
  lng?: number | null;
  alarms?: number | null;
  offlineDevices?: number | null;
  comfortSummary?: unknown;
}

/** API-DEV-25 사이트 요약(기기 수·쾌적 점수) */
export interface SiteSummaryRow {
  siteId: string;
  name: string;
  lat?: number | null;
  lng?: number | null;
  devices?: number;
  offline?: number;
  openAlarms?: number;
  comfortScore?: number | null;
}

export interface SiteView {
  id: string;
  name: string;
  lat: number | null;
  lng: number | null;
  alarms: number;
  offline: number;
  devices: number | null;
  comfortScore: number | null;
  comfortSummary: string | null;
  status: SiteStatus;
}

export type SiteStatus = "ALARM" | "OFFLINE" | "OK";

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** 쾌적도 요약을 짧은 글로(문자열은 그대로, `{NORMAL: 3, WARNING: 1}` 같은 객체는 "NORMAL 3 · WARNING 1") */
export function comfortSummaryText(value: unknown): string | null {
  if (typeof value === "string") return value || null;
  if (typeof value === "number") return String(value);
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const parts = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => typeof v === "number" || typeof v === "string")
      .map(([k, v]) => `${k} ${v}`);
    return parts.length ? parts.join(" · ") : null;
  }
  return null;
}

export function siteStatus(alarms: number, offline: number): SiteStatus {
  if (alarms > 0) return "ALARM";
  if (offline > 0) return "OFFLINE";
  return "OK";
}

/** 지도 행(상태 원천)을 기준으로 요약 행(기기 수·쾌적 점수)을 붙인다. 지도 응답이 없으면 요약만으로 만든다 */
export function mergeSites(map: SiteMapRow[] | null, summary: SiteSummaryRow[] | null): SiteView[] {
  const bySummary = new Map((summary ?? []).map((s) => [String(s.siteId), s]));
  const base: SiteMapRow[] = map ?? (summary ?? []).map((s) => ({ id: String(s.siteId), name: s.name, lat: s.lat, lng: s.lng, alarms: s.openAlarms, offlineDevices: s.offline }));
  return base.map((row) => {
    const s = bySummary.get(String(row.id));
    const alarms = num(row.alarms) ?? num(s?.openAlarms) ?? 0;
    const offline = num(row.offlineDevices) ?? num(s?.offline) ?? 0;
    const lat = num(row.lat) ?? num(s?.lat);
    const lng = num(row.lng) ?? num(s?.lng);
    return {
      id: String(row.id),
      name: row.name,
      lat: lat !== null && lat >= -90 && lat <= 90 ? lat : null,
      lng: lng !== null && lng >= -180 && lng <= 180 ? lng : null,
      alarms,
      offline,
      devices: num(s?.devices),
      comfortScore: num(s?.comfortScore),
      comfortSummary: comfortSummaryText(row.comfortSummary),
      status: siteStatus(alarms, offline),
    };
  });
}

export interface Projected {
  site: SiteView;
  x: number;
  y: number;
}

/**
 * 좌표 있는 사이트를 width×height 안에 맞춘다(여백 padding). 범위가 아주 좁으면(한 곳뿐 등) 0.02도 범위를 둔다.
 * 위도가 클수록 위쪽(y 작음)
 */
export function projectSites(sites: SiteView[], width: number, height: number, padding = 32): Projected[] {
  const located = sites.filter((s) => s.lat !== null && s.lng !== null);
  if (located.length === 0) return [];
  const lats = located.map((s) => s.lat as number);
  const lngs = located.map((s) => s.lng as number);
  let [minLat, maxLat, minLng, maxLng] = [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)];
  const MIN_SPAN = 0.02;
  if (maxLat - minLat < MIN_SPAN) [minLat, maxLat] = [(minLat + maxLat) / 2 - MIN_SPAN / 2, (minLat + maxLat) / 2 + MIN_SPAN / 2];
  if (maxLng - minLng < MIN_SPAN) [minLng, maxLng] = [(minLng + maxLng) / 2 - MIN_SPAN / 2, (minLng + maxLng) / 2 + MIN_SPAN / 2];
  // 위도에 따른 경도 축소(가운데 위도의 cos)로 모양을 맞추고, 같은 배율로 맞춘다
  const k = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
  const spanX = (maxLng - minLng) * k;
  const spanY = maxLat - minLat;
  const scale = Math.min((width - padding * 2) / spanX, (height - padding * 2) / spanY);
  const offsetX = (width - spanX * scale) / 2;
  const offsetY = (height - spanY * scale) / 2;
  const round = (v: number) => Math.round(v * 10) / 10;
  return located.map((site) => ({ site, x: round(offsetX + ((site.lng as number) - minLng) * k * scale), y: round(offsetY + (maxLat - (site.lat as number)) * scale) }));
}

export const STATUS_STYLE: Record<SiteStatus, { color: string; icon: string }> = {
  ALARM: { color: "var(--color-bad)", icon: "▲" },
  OFFLINE: { color: "var(--color-fair)", icon: "!" },
  OK: { color: "var(--color-good)", icon: "✔" },
};
