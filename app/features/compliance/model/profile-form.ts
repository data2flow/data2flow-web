/**
 * UI-CMP-03 프로필 편집 상태와 검사(CMP-01.01, TC-CMP-007). 화면은 이 상태를 JSON 한 덩어리로 보내고, BFF가 다시 검사한 뒤
 * API-CMP-04·05 본문(§1.1)으로 바꾼다. 최종 검사(단위·평가 단위·등급 겹침)는 서버가 다시 한다(CMP_THRESHOLD_INVALID).
 */
import { EVAL_WINDOWS, REQUIREMENTS, type Band, type ProfileVersion } from "./types";

export const MAX_BANDS = 4;

export interface BandDraft {
  name: string;
  lower: string;
  upper: string;
}

export interface MetricDraft {
  metricKey: string;
  facilityType: string;
  evalWindow: string;
  lower: string;
  upper: string;
  inclusive: boolean;
  unit: string;
  requirement: string;
  note: string;
  /** 기준 등급 이름(기준값과 같은 구간). 비우면 서버가 "기준"으로 만든다 */
  baseName: string;
  /** 기준 등급 안쪽의 더 엄격한 등급 */
  bands: BandDraft[];
}

export interface ProfileDraft {
  name: string;
  sourceTitle: string;
  sourceUrl: string;
  effectiveDate: string;
  description: string;
  streakDays: string;
  streakRatio: string;
  facilityTypeRequired: boolean;
  changeNote: string;
  metrics: MetricDraft[];
  /** 측정 적정성 규칙은 화면에서 고치지 않고 원본 그대로 넘긴다 */
  coverage: { kind: string; params: Record<string, unknown> }[];
}

export type DraftErrors = Record<string, string>;

const str = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n));

export function emptyMetric(): MetricDraft {
  return { metricKey: "", facilityType: "", evalWindow: "HOUR_1", lower: "", upper: "", inclusive: true, unit: "", requirement: "LIMIT", note: "", baseName: "", bands: [] };
}

export function emptyDraft(): ProfileDraft {
  return { name: "", sourceTitle: "", sourceUrl: "", effectiveDate: "", description: "", streakDays: "", streakRatio: "", facilityTypeRequired: false, changeNote: "", metrics: [emptyMetric()], coverage: [] };
}

/** 저장된 버전에서 편집 상태를 만든다(새 버전 저장·복제 편집) */
export function draftFrom(version: ProfileVersion, name = ""): ProfileDraft {
  return {
    name,
    sourceTitle: version.sourceTitle ?? "",
    sourceUrl: version.sourceUrl ?? "",
    effectiveDate: version.effectiveDate ?? "",
    description: version.description ?? "",
    streakDays: str(version.streak?.days),
    streakRatio: str(version.streak?.dailyRatio),
    facilityTypeRequired: version.facilityTypeRequired,
    changeNote: "",
    coverage: version.coverage ?? [],
    metrics: version.metrics.map((m) => {
      const bands = m.bands ?? [];
      const base = bands.find((b) => b.isBase);
      return {
        metricKey: m.metricKey,
        facilityType: m.facilityType ?? "",
        evalWindow: m.evalWindow,
        lower: str(m.lower),
        upper: str(m.upper),
        inclusive: m.inclusive,
        unit: m.unit,
        requirement: m.requirement,
        note: m.note ?? "",
        baseName: base?.name ?? "",
        bands: bands.filter((b) => !b.isBase).map((b) => ({ name: b.name, lower: str(b.lower), upper: str(b.upper) })),
      };
    }),
  };
}

function num(value: string): number | null | "NaN" {
  const v = value.trim();
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : "NaN";
}

const isHttps = (url: string) => /^https:\/\/[^\s]+$/.test(url.trim());

/**
 * 편집 상태 검사. 오류 키는 필드 경로(`metrics.0.upper`), 값은 문구 코드(i18n `compliance.validation.*`).
 * @param mode create는 이름, version은 변경 메모가 필수
 */
export function checkDraft(draft: ProfileDraft, mode: "create" | "version" | "update"): DraftErrors {
  const errors: DraftErrors = {};
  if (mode === "create") {
    if (!draft.name.trim()) errors.name = "nameRequired";
    else if (draft.name.trim().length > 100) errors.name = "nameTooLong";
  }
  if (!draft.sourceTitle.trim()) errors.sourceTitle = "sourceRequired";
  else if (draft.sourceTitle.trim().length > 200) errors.sourceTitle = "sourceTooLong";
  if (draft.sourceUrl.trim() && !isHttps(draft.sourceUrl)) errors.sourceUrl = "url";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.effectiveDate)) errors.effectiveDate = "dateRequired";
  const days = num(draft.streakDays);
  if (days !== null && (days === "NaN" || !Number.isInteger(days) || days < 1 || days > 365)) errors.streakDays = "streakDays";
  const ratio = num(draft.streakRatio);
  if (ratio !== null && (ratio === "NaN" || ratio < 50 || ratio > 100)) errors.streakRatio = "streakRatio";
  if (mode === "version" && !draft.changeNote.trim()) errors.changeNote = "changeNoteRequired";
  if (draft.changeNote.trim().length > 500) errors.changeNote = "changeNoteTooLong";
  if (draft.metrics.length === 0) errors.metrics = "metricsRequired";
  const seen = new Set<string>();
  draft.metrics.forEach((m, i) => {
    const at = `metrics.${i}`;
    if (!m.metricKey) {
      errors[`${at}.metricKey`] = "metricRequired";
      return;
    }
    const key = `${m.metricKey}\u0000${m.facilityType}`;
    if (seen.has(key)) errors[`${at}.metricKey`] = "duplicateMetric";
    seen.add(key);
    if (!(EVAL_WINDOWS as readonly string[]).includes(m.evalWindow)) errors[`${at}.evalWindow`] = "evalWindow";
    if (!(REQUIREMENTS as readonly string[]).includes(m.requirement)) errors[`${at}.requirement`] = "requirement";
    if (!m.unit.trim()) errors[`${at}.unit`] = "unitRequired";
    if (m.requirement === "CONTINUOUS_MONITORING_ONLY") return;
    const lower = num(m.lower);
    const upper = num(m.upper);
    if (lower === "NaN") errors[`${at}.lower`] = "number";
    if (upper === "NaN") errors[`${at}.upper`] = "number";
    if (lower === null && upper === null) errors[`${at}.upper`] = "limitRequired";
    if (typeof lower === "number" && typeof upper === "number" && lower > upper) errors[`${at}.lower`] = "range";
    if (m.bands.length + 1 > MAX_BANDS) errors[`${at}.bands`] = "bandCount";
    const names = new Set([m.baseName.trim() || "기준"]);
    m.bands.forEach((b, j) => {
      const bt = `${at}.bands.${j}`;
      if (!b.name.trim() || b.name.trim().length > 30) errors[`${bt}.name`] = "bandName";
      else if (names.has(b.name.trim())) errors[`${bt}.name`] = "bandNameDuplicate";
      names.add(b.name.trim());
      const bl = num(b.lower);
      const bu = num(b.upper);
      if (bl === "NaN" || bu === "NaN" || (bl === null && bu === null)) {
        errors[`${bt}.upper`] = "number";
        return;
      }
      // 등급은 기준 등급 안쪽(같거나 더 엄격)이어야 한다
      const lowerOk = typeof lower !== "number" || (typeof bl === "number" && bl >= lower);
      const upperOk = typeof upper !== "number" || (typeof bu === "number" && bu <= upper);
      const ordered = typeof bl !== "number" || typeof bu !== "number" || bl <= bu;
      if (!lowerOk || !upperOk || !ordered) errors[`${bt}.upper`] = "bandOverlap";
    });
  });
  return errors;
}

function bandsOf(m: MetricDraft, lower: number | null, upper: number | null): Band[] | undefined {
  if (!m.baseName.trim() && m.bands.length === 0) return undefined;
  return [
    { name: m.baseName.trim() || "기준", lower, upper, isBase: true },
    ...m.bands.map((b) => ({ name: b.name.trim(), lower: num(b.lower) as number | null, upper: num(b.upper) as number | null, isBase: false })),
  ];
}

/** API-CMP-04·05 버전 본문(§1.1). 검사를 통과한 상태만 넘긴다 */
export function versionBody(draft: ProfileDraft) {
  const days = num(draft.streakDays);
  const ratio = num(draft.streakRatio);
  return {
    sourceTitle: draft.sourceTitle.trim(),
    sourceUrl: draft.sourceUrl.trim() || null,
    effectiveDate: draft.effectiveDate,
    description: draft.description.trim() || null,
    streak: days === null && ratio === null ? null : { days, dailyRatio: ratio },
    facilityTypeRequired: draft.facilityTypeRequired,
    changeNote: draft.changeNote.trim() || null,
    metrics: draft.metrics.map((m) => {
      const continuous = m.requirement === "CONTINUOUS_MONITORING_ONLY";
      const lower = continuous ? null : (num(m.lower) as number | null);
      const upper = continuous ? null : (num(m.upper) as number | null);
      const bands = continuous ? undefined : bandsOf(m, lower, upper);
      return {
        metricKey: m.metricKey,
        facilityType: m.facilityType.trim() || null,
        evalWindow: m.evalWindow,
        lower,
        upper,
        inclusive: m.inclusive,
        unit: m.unit.trim(),
        requirement: m.requirement,
        note: m.note.trim() || null,
        ...(bands ? { bands } : {}),
      };
    }),
    coverage: draft.coverage,
  };
}

/** BFF가 받은 JSON을 편집 상태로 읽는다. 모양이 틀리면 null */
export function parseDraft(raw: string): ProfileDraft | null {
  try {
    const value = JSON.parse(raw) as Partial<ProfileDraft>;
    if (!value || typeof value !== "object" || !Array.isArray(value.metrics)) return null;
    const base = emptyDraft();
    const text = (v: unknown) => (typeof v === "string" ? v : "");
    return {
      name: text(value.name),
      sourceTitle: text(value.sourceTitle),
      sourceUrl: text(value.sourceUrl),
      effectiveDate: text(value.effectiveDate),
      description: text(value.description),
      streakDays: text(value.streakDays),
      streakRatio: text(value.streakRatio),
      facilityTypeRequired: value.facilityTypeRequired === true,
      changeNote: text(value.changeNote),
      coverage: Array.isArray(value.coverage) ? value.coverage : base.coverage,
      metrics: value.metrics.map((m) => ({
        ...emptyMetric(),
        metricKey: text(m?.metricKey),
        facilityType: text(m?.facilityType),
        evalWindow: text(m?.evalWindow),
        lower: text(m?.lower),
        upper: text(m?.upper),
        inclusive: m?.inclusive !== false,
        unit: text(m?.unit),
        requirement: text(m?.requirement) || "LIMIT",
        note: text(m?.note),
        baseName: text(m?.baseName),
        bands: Array.isArray(m?.bands) ? m.bands.map((b) => ({ name: text(b?.name), lower: text(b?.lower), upper: text(b?.upper) })) : [],
      })),
    };
  } catch {
    return null;
  }
}

/** 서버 필드 경로(`metrics[co2].lower`, `metrics[co2].bands[우수]`)를 화면 경로(`metrics.0.lower`)로 바꾼다 */
export function fieldKeyOf(draft: ProfileDraft, serverField: string): string {
  const m = /^metrics\[([^\]]+)\](?:\.(.+))?$/.exec(serverField);
  if (!m) return serverField.replace(/^version\./, "");
  const index = draft.metrics.findIndex((r) => r.metricKey === m[1]);
  const rest = m[2] ?? "metricKey";
  if (index < 0) return serverField;
  const band = /^bands\[([^\]]+)\]/.exec(rest);
  if (band) {
    const j = draft.metrics[index].bands.findIndex((b) => b.name === band[1]);
    return j < 0 ? `metrics.${index}.upper` : `metrics.${index}.bands.${j}.upper`;
  }
  return `metrics.${index}.${rest === "bands" ? "upper" : rest}`;
}
