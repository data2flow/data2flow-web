/**
 * 기간·지속 시간 위젯(UI-FLW-16): 숫자 + 단위(초/분/시간) ↔ ISO-8601 기간(`PT5M`). 최소 1초, 최대 24시간.
 */
export type DurationUnit = "s" | "m" | "h";
export const UNIT_SECONDS: Record<DurationUnit, number> = { s: 1, m: 60, h: 3600 };
export const MIN_DURATION_SEC = 1;
export const MAX_DURATION_SEC = 24 * 3600;

/** `PT5M`·`PT1H30M`·`PT45S` → 초. 형식이 틀리면 null */
export function isoToSeconds(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const m = /^PT(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(value.trim());
  if (!m || (!m[1] && !m[2] && !m[3])) return null;
  return Math.round(Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0));
}

export function secondsToIso(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s > 0 && s % 3600 === 0) return `PT${s / 3600}H`;
  if (s > 0 && s % 60 === 0) return `PT${s / 60}M`;
  return `PT${s}S`;
}

/** 화면 표시용: 가장 큰 단위로 나눠 떨어지는 값 */
export function splitDuration(value: unknown): { amount: string; unit: DurationUnit } {
  const seconds = isoToSeconds(value);
  if (seconds === null) return { amount: "", unit: "m" };
  if (seconds % 3600 === 0 && seconds > 0) return { amount: String(seconds / 3600), unit: "h" };
  if (seconds % 60 === 0 && seconds > 0) return { amount: String(seconds / 60), unit: "m" };
  return { amount: String(seconds), unit: "s" };
}

export function joinDuration(amount: string, unit: DurationUnit): string | null {
  if (amount.trim() === "") return null;
  const n = Number(amount);
  if (!Number.isFinite(n) || n < 0) return null;
  return secondsToIso(n * UNIT_SECONDS[unit]);
}

export type DurationProblem = "format" | "range";

export function checkDuration(value: unknown): DurationProblem | undefined {
  const seconds = isoToSeconds(value);
  if (seconds === null) return "format";
  if (seconds < MIN_DURATION_SEC || seconds > MAX_DURATION_SEC) return "range";
  return undefined;
}
