/**
 * 시각 표시. 저장·API는 UTC(ISO-8601)이고 화면은 사용자(없으면 조직) 시간대로 보여 준다(AT-IAM-08.1, AT-OPS-14.1).
 */
export const DEFAULT_TIMEZONE = "Asia/Seoul";

const LOCALE_TAGS: Record<string, string> = { ko: "ko-KR", en: "en-US", ja: "ja-JP", zh: "zh-CN" };

export function isValidTimezone(timezone: string | null | undefined): boolean {
  if (!timezone) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

export function resolveTimezone(...candidates: (string | null | undefined)[]): string {
  for (const candidate of candidates) if (isValidTimezone(candidate)) return candidate as string;
  return DEFAULT_TIMEZONE;
}

/** `2026-10-03T02:12:09Z` → `2026-10-03 11:12` (Asia/Seoul) */
export function formatDateTime(iso: string | null | undefined, timezone: string, lang = "ko", withSeconds = false): string {
  if (!iso) return "–";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "–";
  const parts = new Intl.DateTimeFormat(LOCALE_TAGS[lang] ?? "en-US", {
    timeZone: resolveTimezone(timezone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: withSeconds ? "2-digit" : undefined,
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const time = `${get("hour")}:${get("minute")}${withSeconds ? `:${get("second")}` : ""}`;
  return `${get("year")}-${get("month")}-${get("day")} ${time}`;
}

/** 자주 쓰는 시간대 목록(시간대 선택 상자). 목록 밖 값도 IANA 이름이면 서버가 받는다 */
export const COMMON_TIMEZONES = [
  "Asia/Seoul",
  "UTC",
  "Asia/Tokyo",
  "Asia/Shanghai",
  "Asia/Singapore",
  "Europe/London",
  "Europe/Berlin",
  "America/New_York",
  "America/Los_Angeles",
];

function offsetMs(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second")) - utcMs;
}

/** 시간대 기준 날짜(`2026-10-03`)의 0시를 UTC ISO로. 감사 로그 기간 검색(from 포함·to 제외) */
export function zonedDayStartUtc(date: string, timeZone: string): string | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return undefined;
  const guess = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const zone = resolveTimezone(timeZone);
  let utc = guess - offsetMs(guess, zone);
  utc = guess - offsetMs(utc, zone);
  return new Date(utc).toISOString().replace(".000Z", "Z");
}

/** 시간대 기준 오늘 날짜(`YYYY-MM-DD`)에서 days일 더한 날 */
export function zonedDate(nowMs: number, timeZone: string, days = 0): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: resolveTimezone(timeZone), year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(nowMs));
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const date = new Date(Date.UTC(n("year"), n("month") - 1, n("day") + days));
  return date.toISOString().slice(0, 10);
}

/** 상대 시각("12초 전", "2시간 전"). 기준 시각은 호출하는 쪽이 준다(테스트에서 고정) */
export function formatRelative(iso: string | null | undefined, nowMs: number, lang = "ko"): string {
  if (!iso) return "–";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "–";
  const diff = Math.round((t - nowMs) / 1000);
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(LOCALE_TAGS[lang] ?? "en-US", { numeric: "auto" });
  if (abs < 60) return rtf.format(diff, "second");
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  return rtf.format(Math.round(diff / 86400), "day");
}

/** 숫자 표시(언어별 자릿수 구분, TC-DSH-076). 단위는 영어만 띄어 쓴다(`1,240.5 ppm`, 한국어 `1,240.5ppm`) */
export function formatNumber(value: number | null | undefined, lang = "ko", options: { precision?: number | null; unit?: string | null } = {}): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "–";
  const digits = options.precision ?? undefined;
  const text = new Intl.NumberFormat(LOCALE_TAGS[lang] ?? "en-US", digits === undefined ? { maximumFractionDigits: 3 } : { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
  if (!options.unit) return text;
  return lang === "en" ? `${text} ${options.unit}` : `${text}${options.unit}`;
}

/** 시간대 기준 날짜만(`2026. 10. 3.`·`Oct 3, 2026`·`2026/10/3`, TC-DSH-076) */
export function formatDate(iso: string | null | undefined, timezone: string, lang = "ko"): string {
  if (!iso) return "–";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "–";
  const style: Intl.DateTimeFormatOptions = lang === "en" ? { year: "numeric", month: "short", day: "numeric" } : { year: "numeric", month: "numeric", day: "numeric" };
  return new Intl.DateTimeFormat(LOCALE_TAGS[lang] ?? "en-US", { timeZone: resolveTimezone(timezone), ...style }).format(date);
}

/** 기간 키(1h·24h·7d·30d)를 [from, to] UTC ISO로 */
export function rangeOf(key: string, nowMs: number): { from: string; to: string } {
  const hours: Record<string, number> = { "1h": 1, "6h": 6, "24h": 24, "7d": 168, "30d": 720, "90d": 2160 };
  const h = hours[key] ?? 24;
  const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
  return { from: iso(nowMs - h * 3600_000), to: iso(nowMs) };
}
