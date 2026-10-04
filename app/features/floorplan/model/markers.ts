/**
 * 평면도 보기 마커(DSH-02.02, UI-DSH-02 평면도 탭): 평면도 마커 좌표(API-DSH-03/API-DEV-09)와 공간 요약의 기기 현재값(API-DSH-02)을 합친다.
 * core 평면도 응답은 좌표만 주므로 현재값·연결 상태는 공간 요약과 실시간 `device-update`(API-DSH-20 `space:{id}`)에서 온다.
 * 상태는 색만으로 나타내지 않고 기호·글자를 함께 쓴다(NFR-08.03).
 */
import type { MetricValue, OverviewDevice } from "~/features/spaces/model/live-devices";

export interface PlanMarker {
  deviceId: string | number;
  deviceName?: string | null;
  x: number | string;
  y: number | string;
}

export type MarkerState = "ALARM" | "OFFLINE" | "NORMAL" | "UNKNOWN";

export interface LiveMarker {
  deviceId: string;
  name: string;
  x: number;
  y: number;
  state: MarkerState;
  metrics: MetricValue[];
  alarmSeverity?: string | null;
  lastSeenAt?: string | null;
}

export interface DeviceAlarmSummary {
  deviceId?: string | number | null;
  severity?: string | null;
}

const SEVERITY_ORDER = ["CRITICAL", "MAJOR", "MINOR", "WARNING", "INFO"];

/** 상태별 화면 표시(색 이름은 ui.tsx 톤) */
export const MARKER_LOOK: Record<MarkerState, { tone: "bad" | "warn" | "good" | "muted"; icon: string }> = {
  ALARM: { tone: "bad", icon: "▲" },
  OFFLINE: { tone: "muted", icon: "✕" },
  NORMAL: { tone: "good", icon: "✔" },
  UNKNOWN: { tone: "warn", icon: "?" },
};

export function markerState(device: OverviewDevice | undefined, alarmSeverity: string | null | undefined): MarkerState {
  if (alarmSeverity) return "ALARM";
  if (!device) return "UNKNOWN";
  if (device.connection === "OFFLINE") return "OFFLINE";
  if (device.connection === "ONLINE" || (device.metrics?.length ?? 0) > 0) return "NORMAL";
  return "UNKNOWN";
}

function worstSeverity(alarms: readonly DeviceAlarmSummary[] | undefined, deviceId: string): string | null {
  let best: string | null = null;
  for (const a of alarms ?? []) {
    if (String(a.deviceId ?? "") !== deviceId || !a.severity) continue;
    if (best === null || SEVERITY_ORDER.indexOf(a.severity) < SEVERITY_ORDER.indexOf(best)) best = a.severity;
  }
  return best;
}

/** 좌표가 0~1을 벗어나거나 숫자가 아니면 그 마커는 빼고 그린다 */
export function liveMarkers(markers: readonly PlanMarker[] | undefined, devices: readonly OverviewDevice[], alarms?: readonly DeviceAlarmSummary[]): LiveMarker[] {
  const byId = new Map(devices.map((d) => [String(d.id), d]));
  const out: LiveMarker[] = [];
  for (const m of markers ?? []) {
    const id = String(m.deviceId);
    const x = Number(m.x);
    const y = Number(m.y);
    if (!(x >= 0 && x <= 1 && y >= 0 && y <= 1)) continue;
    const device = byId.get(id);
    const severity = worstSeverity(alarms, id);
    out.push({ deviceId: id, name: device?.name ?? m.deviceName ?? id, x, y, state: markerState(device, severity), metrics: device?.metrics ?? [], alarmSeverity: severity, lastSeenAt: device?.lastSeenAt ?? null });
  }
  return out;
}

/** 히트 컬러로 고를 수 있는 측정 항목(숫자 값이 있는 것) */
export function heatMetricOptions(markers: readonly LiveMarker[]): { key: string; unit?: string | null }[] {
  const seen = new Map<string, string | null | undefined>();
  for (const m of markers) for (const v of m.metrics) if (typeof v.value === "number" && !seen.has(v.key)) seen.set(v.key, v.unit);
  return [...seen.entries()].map(([key, unit]) => ({ key, unit })).sort((a, b) => a.key.localeCompare(b.key));
}

/** 히트 컬러 입력점: 그 측정 항목 값이 있는 마커만 */
export function heatPoints(markers: readonly LiveMarker[], metricKey: string) {
  return markers.flatMap((m) => {
    const v = m.metrics.find((x) => x.key === metricKey)?.value;
    return typeof v === "number" && Number.isFinite(v) ? [{ x: m.x, y: m.y, value: v }] : [];
  });
}
