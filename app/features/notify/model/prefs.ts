/**
 * 내 정보 > 알림 수신(UI-IAM-04, UI-RUL-11) 모델: OPS-06.05 사용자별 수신 설정(최소 심각도, 방해 금지 시간, CRITICAL 예외),
 * RUL-05.02 메신저 계정 연결(일회용 코드 10분), RUL-05.04 방해 금지.
 * API: 최소 심각도·종류 API-DSH-26(`/accounts/me/notification-preferences`), 방해 금지 API-RUL-30(`/accounts/me/notify-preferences`),
 * 계정 연결 API-RUL-30(`/accounts/me/messenger-links`).
 */
import { SEVERITIES, type Severity } from "./types";

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export interface DndInput {
  enabled: boolean;
  dndFrom: string;
  dndTo: string;
  dndAllowCritical: boolean;
  locale: string;
}

export type DndProblem = "timeFormat" | "timeSame" | "localeInvalid";

export function checkDnd(input: DndInput): DndProblem | undefined {
  if (!["ko", "en", "ja", "zh"].includes(input.locale)) return "localeInvalid";
  if (!input.enabled) return undefined;
  if (!HHMM.test(input.dndFrom) || !HHMM.test(input.dndTo)) return "timeFormat";
  if (input.dndFrom === input.dndTo) return "timeSame";
  return undefined;
}

/** API-RUL-30 본문. 방해 금지를 끄면 시각을 비운다(null) */
export function dndBody(input: DndInput) {
  return { dndFrom: input.enabled ? input.dndFrom : null, dndTo: input.enabled ? input.dndTo : null, dndAllowCritical: input.dndAllowCritical, locale: input.locale };
}

/** HH:mm 시각이 방해 금지 구간 안인지(자정을 넘는 구간 포함). 화면의 "지금 방해 금지 중" 표시 */
export function inDnd(time: string, from: string | null, to: string | null): boolean {
  if (!from || !to || !HHMM.test(time) || !HHMM.test(from) || !HHMM.test(to)) return false;
  return from < to ? time >= from && time < to : time >= from || time < to;
}

export function isSeverity(value: string): value is Severity {
  return (SEVERITIES as readonly string[]).includes(value);
}

/** 일회용 코드 남은 시간(초). 지나면 0 */
export function secondsLeft(expiresAt: string | null | undefined, nowMs: number): number {
  const t = expiresAt ? Date.parse(expiresAt) : NaN;
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.ceil((t - nowMs) / 1000));
}

export function formatCountdown(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** 딥링크는 텔레그램(https://t.me/…)만 링크로 보인다. 다른 주소는 보이지 않는다(피싱 방지) */
export function safeDeepLink(link: string | null | undefined): string | undefined {
  if (!link) return undefined;
  try {
    const url = new URL(link);
    return url.protocol === "https:" && (url.hostname === "t.me" || url.hostname === "telegram.me") ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}
