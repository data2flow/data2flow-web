/**
 * QR 현장 조회·현장 설치·설치 현황판 화면 모델(UI-DEV-17·21·22, DEV-09.04·13.05·13.06, API-DEV-24·26·137·138).
 * QR 내용은 `{웹}/d/{qrToken}`(24자 난수, TC-DEV-255). 설치 좌표는 평면도 비율(0~1), 사진은 0~5장(core 검증).
 * 첫 수신이 설치 뒤 10분 안에 없으면 PROBLEM + 점검 체크리스트(BR-DEV-38).
 */

export const COMMISSION_STATUSES = ["PLANNED", "INSTALLED", "VERIFIED", "PROBLEM"] as const;
export type CommissionStatus = (typeof COMMISSION_STATUSES)[number];
export const MAX_COMMISSION_PHOTOS = 5;
export const FIRST_DATA_WAIT_MS = 10 * 60_000;
export const CHECKLIST_KEYS = ["firstData", "position", "photo", "signal", "battery", "gateway", "source"] as const;
export const QR_LABEL_LAYOUTS = ["A4_3x8"] as const;
export const MAX_QR_LABELS = 200;

export interface QrInfo {
  deviceId: string;
  qrToken: string;
  url: string;
}

export interface CommissionResult {
  deviceId: string;
  status: string;
  installedAt?: string | null;
  installedBy?: string | null;
  waitUntil?: string | null;
}

export interface CommissionStatusView {
  deviceId: string;
  status: string;
  spaceId?: string | null;
  x?: number | null;
  y?: number | null;
  installedAt?: string | null;
  installedBy?: string | null;
  installedByName?: string | null;
  waitUntil?: string | null;
  firstSeenAt?: string | null;
  checklist?: Record<string, boolean> | null;
  latest?: unknown;
  photoUrls?: string[];
}

/** COMMISSION_CONFLICT(409) 응답의 서버 기록(AT-DEV-27.5) */
export interface ServerCommission {
  deviceId: string;
  status: string;
  spaceId?: string | null;
  x?: number | null;
  y?: number | null;
  installedAt?: string | null;
  installedBy?: string | null;
  installedByName?: string | null;
}

export interface BoardFloor {
  spaceId: string;
  name: string;
  planned: number;
  installed: number;
  verified: number;
  problem: number;
}

export interface BoardDevice {
  deviceId: string;
  name: string;
  spaceId?: string | null;
  status: string;
  checklist?: Record<string, boolean> | null;
  installedAt?: string | null;
}

/** `commissioning` 실시간 이벤트(`space:{id}` 토픽, AT-DEV-28.2) */
export interface CommissioningEvent {
  deviceId: string;
  spaceId: string;
  status: string;
  firstSeenAt?: string | null;
  checklist?: Record<string, boolean> | null;
}

const TOKEN = /^[A-Za-z0-9_-]{8,64}$/;

/** QR 내용(주소 또는 토큰)에서 토큰을 꺼낸다. 다른 형식이면 null */
export function qrTokenFrom(content: string | null | undefined): string | null {
  const text = (content ?? "").trim();
  if (!text) return null;
  const match = /\/d\/([^/?#\s]+)/.exec(text);
  const token = match ? decodeURIComponent(match[1]) : text;
  return TOKEN.test(token) ? token : null;
}

/** 진행률: 예정 대비 완료(설치 + 확인). 예정이 0이면 0 */
export function floorProgress(floor: BoardFloor): number {
  if (floor.planned <= 0) return 0;
  return Math.min(100, Math.round((floor.installed / floor.planned) * 100));
}

export function boardTotals(floors: BoardFloor[]): Omit<BoardFloor, "spaceId" | "name"> {
  return floors.reduce((acc, f) => ({ planned: acc.planned + f.planned, installed: acc.installed + f.installed, verified: acc.verified + f.verified, problem: acc.problem + f.problem }), { planned: 0, installed: 0, verified: 0, problem: 0 });
}

export function commissionTone(status: string): "good" | "warn" | "bad" | "muted" | "accent" {
  if (status === "VERIFIED") return "good";
  if (status === "PROBLEM") return "bad";
  if (status === "INSTALLED") return "accent";
  return "muted";
}

/** 첫 수신 대기 남은 시간(ms). waitUntil이 없으면 설치 시각 + 10분 */
export function remainingWaitMs(view: { waitUntil?: string | null; installedAt?: string | null }, nowMs: number): number {
  const until = view.waitUntil ? Date.parse(view.waitUntil) : view.installedAt ? Date.parse(view.installedAt) + FIRST_DATA_WAIT_MS : NaN;
  if (Number.isNaN(until)) return 0;
  return Math.max(0, until - nowMs);
}

export function formatCountdown(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** 실패한 체크리스트 항목(점검 안내에 쓴다) */
export function failedChecks(checklist: Record<string, boolean> | null | undefined): string[] {
  if (!checklist) return [];
  return Object.entries(checklist)
    .filter(([, ok]) => !ok)
    .map(([key]) => key);
}

export function checkLabelSelection(deviceIds: string[]): "empty" | "tooMany" | null {
  if (deviceIds.length === 0) return "empty";
  if (deviceIds.length > MAX_QR_LABELS) return "tooMany";
  return null;
}
