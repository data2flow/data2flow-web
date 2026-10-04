/**
 * 외부 맥락 데이터(UI-DSC-04, DSC-06.01·06.02·06.04·06.05): 사이트별 기상청 날씨·대기질·공휴일·학사일정(iCal) 카드와 호출량.
 * API: GET /core/sites/{id}/context-sources(API-DSC-44 제안), PUT …/{type}(API-DSC-45 제안), 호출량 API-DSC-40, 지금 갱신 API-DSC-41,
 * 측정소 API-DSC-42, iCal 파일 API-DSC-43.
 */
export const CONTEXT_TYPES = ["KMA_WEATHER", "AIRKOREA", "HOLIDAY", "ICAL"] as const;
export type ContextType = (typeof CONTEXT_TYPES)[number];

export const WEATHER_ITEMS = ["T1H", "REH", "RN1", "WSD", "PTY", "VEC", "UUU", "VVV"] as const;
export const AIR_ITEMS = ["PM10", "PM25", "O3", "NO2", "CO", "SO2"] as const;
export const CALENDAR_TYPES = ["HOLIDAY", "CLOSURE", "EVENT", "VACATION", "EXAM", "OTHER"] as const;
export const ICS_MAX_BYTES = 2 * 1024 * 1024;
/** 일일 한도 경고 기준(DSC-06.05) */
export const QUOTA_WARN_RATIO = 0.8;

export interface UsageToday {
  day?: string;
  calls: number;
  failures: number;
  quota?: number | null;
  warning: boolean;
  exhausted: boolean;
  resumeAt?: string | null;
}

export interface LastSync {
  at?: string | null;
  status?: string | null;
  added: number;
  updated: number;
  removed: number;
  error?: string | null;
  nextDueAt?: string | null;
}

export interface ContextSourceView {
  type: ContextType | string;
  sourceId?: string | null;
  enabled: boolean;
  lifecycle?: string | null;
  connectionState?: string | null;
  provider?: { key: string; available: boolean; simulated: boolean } | null;
  config?: Record<string, unknown> | null;
  apiKeyConfigured: boolean;
  lastSync?: LastSync | null;
  usageToday?: UsageToday | null;
  version?: number | null;
}

export interface SiteContext {
  siteId: string;
  siteName: string;
  latitude?: number | null;
  longitude?: number | null;
  locationRequired: boolean;
  kmaNx?: number | null;
  kmaNy?: number | null;
  sources: ContextSourceView[];
}

export interface UsageDay {
  day: string;
  calls: number;
  failures: number;
  quota?: number | null;
  warning: boolean;
  exhausted: boolean;
  cost?: number | null;
}

export interface Station {
  stationName: string;
  address?: string | null;
  distanceKm: number;
  items?: string[];
}

export interface ContextInput {
  enabled: boolean;
  apiKey?: string;
  apiKeyConfigured?: boolean;
  url?: string;
  fileObjectKey?: string;
  hasFile?: boolean;
  nx?: string;
  ny?: string;
  refreshHours?: string;
  dailyQuota?: string;
  unitCost?: string;
}

/** 켜기 전 화면 검증(UI-DSC-04 입력 검증). 서버도 같은 규칙으로 400을 준다 */
export function checkContextInput(type: string, input: ContextInput): Record<string, string> {
  const errors: Record<string, string> = {};
  const needsKey = type === "KMA_WEATHER" || type === "AIRKOREA";
  if (needsKey && input.enabled && !input.apiKey?.trim() && !input.apiKeyConfigured) errors.apiKey = "apiKeyRequired";
  if (type === "KMA_WEATHER") {
    // 기상청 격자 범위(nx 1~149, ny 1~253)
    for (const [key, max] of [["nx", 149], ["ny", 253]] as const) {
      const raw = input[key]?.trim();
      if (raw && !(Number.isInteger(Number(raw)) && Number(raw) >= 1 && Number(raw) <= max)) errors[key] = "gridRange";
    }
  }
  if (type === "ICAL") {
    const url = input.url?.trim() ?? "";
    if (url && !/^(https|webcal):\/\/\S+$/i.test(url)) errors.url = "icalUrl";
    if (input.enabled && !url && !input.fileObjectKey && !input.hasFile) errors.url = "icalSourceRequired";
    const hours = input.refreshHours?.trim();
    if (hours && !(Number.isInteger(Number(hours)) && Number(hours) >= 1 && Number(hours) <= 168)) errors.refreshHours = "refreshRange";
  }
  const quota = input.dailyQuota?.trim();
  if (quota && !(Number.isInteger(Number(quota)) && Number(quota) >= 1)) errors.dailyQuota = "positiveInteger";
  const cost = input.unitCost?.trim();
  if (cost && !(Number(cost) >= 0 && Number(cost) <= 1_000_000)) errors.unitCost = "costRange";
  return errors;
}

/** 서버 검증 오류(errors[{field, code}])를 화면 문구 키로 바꾼다. 모르는 코드는 그대로(기본 문구) */
export function serverFieldCode(field: string, code: string): string {
  if (field === "apiKey" && code === "NotBlank") return "apiKeyRequired";
  if (field === "url" && code === "INVALID") return "icalUrl";
  if (field === "url" && code === "NotBlank") return "icalSourceRequired";
  if ((field === "nx" || field === "ny") && code === "Range") return "gridRange";
  if (field === "refreshHours" && code === "Range") return "refreshRange";
  if (field === "unitCost" && code === "Range") return "costRange";
  return code;
}

export type IcsProblem = "NOT_ICS" | "TOO_LARGE" | null;

export function checkIcsFile(file: { name: string; size: number }): IcsProblem {
  if (!/\.ics$/i.test(file.name)) return "NOT_ICS";
  if (file.size > ICS_MAX_BYTES) return "TOO_LARGE";
  return null;
}

export type UsageLevel = "ok" | "warn" | "exhausted";

/** 하루 막대: 한도 대비 비율과 경고 단계(80% 이상 경고, 100% 중지) */
export function usageLevel(day: { calls: number; quota?: number | null; warning?: boolean; exhausted?: boolean }): { pct: number | null; level: UsageLevel } {
  const pct = day.quota ? Math.round((day.calls / day.quota) * 100) : null;
  if (day.exhausted || (pct !== null && pct >= 100)) return { pct, level: "exhausted" };
  if (day.warning || (pct !== null && day.calls >= day.quota! * QUOTA_WARN_RATIO)) return { pct, level: "warn" };
  return { pct, level: "ok" };
}

/** 오늘·이번 달 비용(단가를 정한 소스만). 날짜는 서버가 준 사이트 날짜(YYYY-MM-DD) */
export function costTotals(days: readonly UsageDay[], today: string): { today: number; month: number } | null {
  const priced = days.filter((d) => typeof d.cost === "number");
  if (priced.length === 0) return null;
  const month = today.slice(0, 7);
  return {
    today: priced.filter((d) => d.day === today).reduce((n, d) => n + (d.cost ?? 0), 0),
    month: priced.filter((d) => d.day.startsWith(month)).reduce((n, d) => n + (d.cost ?? 0), 0),
  };
}

/** 마지막 동기화 결과 "+2 ~1 −1"(추가·변경·삭제) */
export function syncDelta(sync: LastSync | null | undefined): string {
  if (!sync) return "";
  const parts = [`+${sync.added}`];
  if (sync.updated) parts.push(`~${sync.updated}`);
  parts.push(`−${sync.removed}`);
  return parts.join(" ");
}

/** 카테고리 → 일정 유형 매핑 표(빈 행·잘못된 유형은 뺀다, 최대 50개) */
export function typeMappingBody(rows: readonly { category: string; type: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of rows) {
    const category = r.category.trim();
    if (!category || !(CALENDAR_TYPES as readonly string[]).includes(r.type)) continue;
    if (Object.keys(out).length >= 50) break;
    out[category.slice(0, 100)] = r.type;
  }
  return out;
}

export function typeMappingRows(config: Record<string, unknown> | null | undefined, categories: readonly string[] = []): { category: string; type: string }[] {
  const mapping = (config?.typeMapping as Record<string, string> | undefined) ?? {};
  const rows = Object.entries(mapping).map(([category, type]) => ({ category, type }));
  for (const c of categories) if (!(c in mapping)) rows.push({ category: c, type: "EVENT" });
  return rows;
}

/** 설정에서 고른 항목(없으면 서버 기본값) */
export function selectedItems(config: Record<string, unknown> | null | undefined, defaults: readonly string[]): string[] {
  const items = config?.items;
  return Array.isArray(items) && items.length ? items.map(String) : [...defaults];
}

/** 카드 상태 표시 톤 */
export function contextTone(view: ContextSourceView): "good" | "warn" | "bad" | "muted" {
  if (!view.enabled) return "muted";
  if (view.usageToday?.exhausted || view.connectionState === "ERROR" || view.lastSync?.status === "FAILED") return "bad";
  if (view.usageToday?.warning || view.provider?.simulated) return "warn";
  return "good";
}
