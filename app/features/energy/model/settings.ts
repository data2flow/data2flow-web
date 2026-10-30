/**
 * 에너지 설정(API-ENE-01·02·04·05, UI-ENE-01·02) 응답 모양과 입력 검증. core-api EnergySettingDtos·TouSchedule과 같다.
 * 화면의 시간대별 단가 편집기는 계절 하나(연중)만 만든다. 계절을 나눈 단가는 목록에서 계절별로 보여 준다.
 */
export const DAY_TYPES = ["WEEKDAY", "WEEKEND_HOLIDAY"] as const;
export type DayType = (typeof DAY_TYPES)[number];
export const TARIFF_MODES = ["FLAT", "TOU"] as const;

export interface Ref {
  id: string;
  name: string;
}

export interface TouBand {
  dayType: DayType;
  from: string;
  to: string;
  rate: number;
  label?: string | null;
}

export interface TouSeason {
  name: string;
  months: number[];
  bands: TouBand[];
}

export interface TouSchedule {
  seasons: TouSeason[];
}

export interface Tariff {
  tariffId: string;
  scopeSpace?: Ref | null;
  validFrom: string;
  validTo?: string | null;
  mode: "FLAT" | "TOU";
  flatRateKrwPerKwh?: number | null;
  touSchedule?: TouSchedule | null;
  baseChargeKrwPerMonth?: number | null;
  version: number;
  updatedAt: string;
}

export interface EmissionFactor {
  emissionFactorId: string;
  validFrom: string;
  validTo?: string | null;
  factorTco2PerMwh: number;
  sourceTitle: string;
  sourceYear: number;
  system: boolean;
}

export interface EnergySource {
  sourceId: string;
  space: Ref;
  kind: "METERED" | "ESTIMATED";
  device: Ref;
  metricKey?: "energy" | "power" | null;
  cumulative?: boolean | null;
  coversDescendants: boolean;
  ratedPowerW?: number | null;
  standbyPowerW?: number | null;
  enabled: boolean;
  lastValueAt?: string | null;
  status: "OK" | "NO_DATA" | "DISABLED";
  version: number;
}

export interface SourceCandidate {
  device: Ref;
  space: Ref;
  metricKeys: string[];
  linkedMetricKeys: string[];
}

export interface Bill {
  billId: string;
  spaceId: string;
  month: string;
  kwh: number;
  amountKrw?: number | null;
  attachmentObjectKey?: string | null;
  meteredKwh?: number | null;
  diffRatio?: number | null;
}

/** 편집기 한 줄(문자열 그대로) */
export interface BandInput {
  from: string;
  to: string;
  rate: string;
  label: string;
}

export interface TariffForm {
  scopeSpaceId: string;
  validFrom: string;
  mode: string;
  flatRate: string;
  baseCharge: string;
  bands: Record<DayType, BandInput[]>;
}

export const DEFAULT_BANDS: Record<DayType, BandInput[]> = {
  WEEKDAY: [
    { from: "00:00", to: "09:00", rate: "", label: "" },
    { from: "09:00", to: "18:00", rate: "", label: "" },
    { from: "18:00", to: "24:00", rate: "", label: "" },
  ],
  WEEKEND_HOLIDAY: [{ from: "00:00", to: "24:00", rate: "", label: "" }],
};

const TIME = /^(([01]\d|2[0-3]):[0-5]\d|24:00)$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
const money = (raw: string, decimals: number) => new RegExp(`^\\d+(\\.\\d{1,${decimals}})?$`).test(raw);

/** 한 요일 유형의 구간이 00:00~24:00을 빈틈·겹침 없이 덮는가(BR: API-ENE-01 §1.1) */
export function coversDay(bands: { from: string; to: string }[]): boolean {
  if (!bands.length || bands.some((b) => !TIME.test(b.from) || !TIME.test(b.to) || minutes(b.from) >= minutes(b.to))) return false;
  let at = 0;
  for (const b of [...bands].sort((a, c) => minutes(a.from) - minutes(c.from))) {
    if (minutes(b.from) !== at) return false;
    at = minutes(b.to);
  }
  return at === 24 * 60;
}

/** UI-ENE-01 필드 검증(오류는 `energy.settings.validation.*` 키) */
export function validateTariffForm(form: TariffForm): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!DATE.test(form.validFrom)) errors.validFrom = "dateRequired";
  if (form.mode === "FLAT") {
    if (!money(form.flatRate, 2) || Number(form.flatRate) <= 0) errors.flatRate = "ratePositive";
  } else if (form.mode === "TOU") {
    for (const dayType of DAY_TYPES) {
      const bands = form.bands[dayType];
      if (!coversDay(bands)) errors.bands = "coverage";
      else if (bands.some((b) => !money(b.rate, 2) || Number(b.rate) <= 0)) errors.bands = "ratePositive";
    }
  } else errors.mode = "modeRequired";
  if (form.baseCharge && !/^\d+$/.test(form.baseCharge)) errors.baseCharge = "wholeWon";
  return errors;
}

/** API-ENE-01 본문 */
export function tariffBody(form: TariffForm) {
  const tou: TouSchedule = {
    seasons: [
      {
        name: "ALL",
        months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
        bands: DAY_TYPES.flatMap((dayType) => form.bands[dayType].map((b) => ({ dayType, from: b.from, to: b.to, rate: Number(b.rate), label: b.label.trim() || null }))),
      },
    ],
  };
  return {
    scopeSpaceId: form.scopeSpaceId || null,
    validFrom: form.validFrom,
    mode: form.mode,
    flatRateKrwPerKwh: form.mode === "FLAT" ? Number(form.flatRate) : null,
    touSchedule: form.mode === "TOU" ? tou : null,
    baseChargeKrwPerMonth: form.baseCharge ? Number(form.baseCharge) : null,
  };
}

/** 배출계수 입력 검증 */
export function validateFactorForm(form: { validFrom: string; factor: string; sourceTitle: string; sourceYear: string }): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!DATE.test(form.validFrom)) errors.validFrom = "dateRequired";
  if (!money(form.factor, 4) || Number(form.factor) > 2) errors.factor = "factorRange";
  if (!form.sourceTitle.trim()) errors.sourceTitle = "sourceRequired";
  else if (form.sourceTitle.trim().length > 200) errors.sourceTitle = "sourceTooLong";
  const year = Number(form.sourceYear);
  if (!/^\d{4}$/.test(form.sourceYear) || year < 1990 || year > 2100) errors.sourceYear = "yearRange";
  return errors;
}

/** 고지서 입력 검증 */
export function validateBillForm(form: { month: string; kwh: string; amountKrw: string }): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(form.month)) errors.month = "monthRequired";
  if (!money(form.kwh, 1) || Number(form.kwh) <= 0) errors.kwh = "kwhPositive";
  if (form.amountKrw && !/^\d+$/.test(form.amountKrw)) errors.amountKrw = "wholeWon";
  return errors;
}

/** 단가 요약: FLAT은 원/kWh, TOU는 계절·요일 유형별 구간 */
export function touSummary(schedule: TouSchedule | null | undefined): { season: string; dayType: DayType; bands: TouBand[] }[] {
  return (schedule?.seasons ?? []).flatMap((s) =>
    DAY_TYPES.map((dayType) => ({ season: s.name, dayType, bands: s.bands.filter((b) => b.dayType === dayType).sort((a, b) => minutes(a.from) - minutes(b.from)) })),
  );
}

/** 차이 비율(0.0781) → "7.8%" */
export const percent = (ratio: number | null | undefined) => (ratio == null ? null : `${(ratio * 100).toFixed(1)}%`);
