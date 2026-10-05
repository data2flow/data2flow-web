/**
 * UI-DEV-10 게이트웨이(DEV-05.01~03). 목록 API-DEV-60, 수신 분포 API-DEV-61(DEV-05.02: 게이트웨이별 수신 기기 수, 기기별 평균 rssi·snr·최적 경로 비율,
 * rssi 분포), 수정 API-DEV-62(이름·공간·오프라인 기준 60~86400초). 필드는 core GatewayDtos.
 */
import { LIGHT_TOKENS } from "~/lib/tokens";

export interface Gateway {
  id: string;
  gatewayEui: string;
  name: string;
  source?: { id: string; name: string } | null;
  space?: { id: string; name: string } | null;
  status: "ONLINE" | "OFFLINE" | "UNKNOWN" | string;
  lastSeenAt?: string | null;
  offlineAfterSec: number;
  deviceCount24h: number;
  uplinks24h: number;
}

export interface GatewayStats {
  gatewayId: string;
  from: string;
  to: string;
  deviceCount: number;
  uplinksByHour: { t: string; count: number }[];
  devices: { deviceId: string; name: string; avgRssi: number | null; avgSnr: number | null; uplinks: number; share: number }[];
  rssiHistogram: { fromDbm: number; toDbm: number; count: number }[];
}

export const GATEWAY_PERIODS = ["24h", "7d", "30d"] as const;
export type GatewayPeriod = (typeof GATEWAY_PERIODS)[number];

export function statusTone(status: string): "good" | "bad" | "muted" {
  return status === "ONLINE" ? "good" : status === "OFFLINE" ? "bad" : "muted";
}

/** 최적 경로 비율(0~1) → "62%" */
export function sharePercent(share: number | null | undefined): string {
  if (share === null || share === undefined || Number.isNaN(share)) return "–";
  return `${Math.round(share * 100)}%`;
}

/** 평균 신호 표시(소수 첫째 자리) */
export function signal(value: number | null | undefined): string {
  return value === null || value === undefined || Number.isNaN(value) ? "–" : (Math.round(value * 10) / 10).toFixed(1);
}

/** 수정 입력 검사(API-DEV-62와 같은 범위) */
export function checkGatewayInput(input: { name: string; offlineAfterSec: string }): Record<string, string> {
  const errors: Record<string, string> = {};
  const name = input.name.trim();
  if (!name || name.length > 100) errors.name = "name";
  const offline = Number(input.offlineAfterSec);
  if (!Number.isInteger(offline) || offline < 60 || offline > 86_400) errors.offlineAfterSec = "offline";
  return errors;
}

/** 막대 색: 강조 파랑(업링크), AI·분포 보조색(RSSI 분포). 차트 캔버스라 토큰 값을 직접 쓴다 */
const PALETTE = { bar: LIGHT_TOKENS.accent, hist: LIGHT_TOKENS.ai2 };

/** 시간대별 업링크 막대(UI-DEV-10 상세) */
export function uplinkChartOption(stats: Pick<GatewayStats, "uplinksByHour">, labels: { uplinks: string }, formatHour: (iso: string) => string): Record<string, unknown> {
  return {
    grid: { left: 40, right: 12, top: 16, bottom: 40 },
    tooltip: { trigger: "axis" },
    xAxis: { type: "category", data: stats.uplinksByHour.map((h) => formatHour(h.t)) },
    yAxis: { type: "value", name: labels.uplinks, minInterval: 1 },
    series: [{ type: "bar", name: labels.uplinks, data: stats.uplinksByHour.map((h) => h.count), itemStyle: { color: PALETTE.bar } }],
  };
}

/** rssi 분포 히스토그램 */
export function rssiChartOption(stats: Pick<GatewayStats, "rssiHistogram">, labels: { devices: string }): Record<string, unknown> {
  return {
    grid: { left: 40, right: 12, top: 16, bottom: 40 },
    tooltip: { trigger: "axis" },
    xAxis: { type: "category", name: "dBm", data: stats.rssiHistogram.map((b) => `${b.fromDbm}~${b.toDbm}`) },
    yAxis: { type: "value", name: labels.devices, minInterval: 1 },
    series: [{ type: "bar", name: labels.devices, data: stats.rssiHistogram.map((b) => b.count), itemStyle: { color: PALETTE.hist } }],
  };
}

/** 기간 키 → from/to(UTC ISO) */
export function gatewayRange(period: string | null, nowMs: number): { period: GatewayPeriod; from: string; to: string } {
  const p = (GATEWAY_PERIODS as readonly string[]).includes(period ?? "") ? (period as GatewayPeriod) : "24h";
  const hours = p === "24h" ? 24 : p === "7d" ? 168 : 720;
  return { period: p, from: new Date(nowMs - hours * 3_600_000).toISOString(), to: new Date(nowMs).toISOString() };
}
