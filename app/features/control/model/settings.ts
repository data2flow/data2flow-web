/**
 * UI-ACT-08 조직 제어 한계·보호 설정 화면 모델(ACT-06.01·06.04·02.05, API-ACT-17).
 * 절대 한계는 `{기능: {속성: {min, max}}}`이고 화면은 한 줄에 기능·속성 하나로 펼쳐 편집한다.
 * 한계는 표준 범위 안쪽이어야 하고(화면 검사), 그 기능을 쓰는 모든 모델 범위의 교집합 안쪽인지는 서버가 다시 본다(BR-ACT-09, LIMIT_WIDER_THAN_MODEL).
 */
import type { AttributeDef } from "./control";

export interface ControlSettings {
  absoluteLimits: Record<string, Record<string, { min?: number | null; max?: number | null; enum?: string[] | null }>> | null;
  manualOverrideMinutes: number;
  minIntervalSec: number;
  oscillation: { windowSec?: number; flips?: number } | null;
  defaultValiditySec: number;
  scheduleRespectsManualOverride: boolean;
  requireApprovalForControlNodes: boolean;
  version: number;
  updatedBy?: { userId: string; name?: string | null } | null;
  updatedAt?: string | null;
}

/** 한계를 둘 수 있는 기능 속성(쓰기 가능한 숫자 속성) */
export interface LimitTarget {
  capability: string;
  attributes: Pick<AttributeDef, "name" | "unit" | "min" | "max">[];
}

export interface LimitRow {
  capability: string;
  attribute: string;
  min: string;
  max: string;
}

export interface ControlSettingsForm {
  limits: LimitRow[];
  manualOverrideMinutes: string;
  minIntervalSec: string;
  oscillationWindowSec: string;
  oscillationFlips: string;
  defaultValiditySec: string;
  scheduleRespectsManualOverride: boolean;
  requireApprovalForControlNodes: boolean;
}

export function limitTargets(definitions: { name: string; attributes: AttributeDef[] }[]): LimitTarget[] {
  return definitions
    .map((d) => ({
      capability: d.name,
      attributes: d.attributes.filter((a) => !a.readOnly && (a.type === "number" || a.type === "integer")).map((a) => ({ name: a.name, unit: a.unit, min: a.min, max: a.max })),
    }))
    .filter((d) => d.attributes.length > 0);
}

const num = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(v));

export function settingsToForm(s: ControlSettings): ControlSettingsForm {
  const limits: LimitRow[] = [];
  for (const [capability, attrs] of Object.entries(s.absoluteLimits ?? {})) {
    for (const [attribute, range] of Object.entries(attrs ?? {})) limits.push({ capability, attribute, min: num(range?.min), max: num(range?.max) });
  }
  return {
    limits,
    manualOverrideMinutes: String(s.manualOverrideMinutes),
    minIntervalSec: String(s.minIntervalSec),
    oscillationWindowSec: num(s.oscillation?.windowSec ?? 60),
    oscillationFlips: num(s.oscillation?.flips ?? 3),
    defaultValiditySec: String(s.defaultValiditySec),
    scheduleRespectsManualOverride: s.scheduleRespectsManualOverride,
    requireApprovalForControlNodes: s.requireApprovalForControlNodes,
  };
}

/** 정수 범위(API-ACT-17 서버 검사와 같은 범위) */
export const SETTING_RANGES = {
  manualOverrideMinutes: [0, 1440],
  minIntervalSec: [0, 3600],
  oscillationWindowSec: [1, 3600],
  oscillationFlips: [2, 100],
  defaultValiditySec: [60, 3600],
} as const;

const isInt = (v: string, [lo, hi]: readonly [number, number]) => /^\d+$/.test(v.trim()) && Number(v) >= lo && Number(v) <= hi;
const isNum = (v: string) => v.trim() !== "" && Number.isFinite(Number(v));

/** 문제 키 목록. 한계 행은 `limits.{i}.{min|max|range|duplicate|target}` */
export function settingsProblems(form: ControlSettingsForm, targets: LimitTarget[]): string[] {
  const problems: string[] = [];
  for (const key of Object.keys(SETTING_RANGES) as (keyof typeof SETTING_RANGES)[]) {
    if (!isInt(form[key], SETTING_RANGES[key])) problems.push(key);
  }
  const seen = new Set<string>();
  form.limits.forEach((row, i) => {
    const attr = targets.find((t) => t.capability === row.capability)?.attributes.find((a) => a.name === row.attribute);
    if (!attr) {
      problems.push(`limits.${i}.target`);
      return;
    }
    const pair = `${row.capability}.${row.attribute}`;
    if (seen.has(pair)) problems.push(`limits.${i}.duplicate`);
    seen.add(pair);
    const hasMin = row.min.trim() !== "";
    const hasMax = row.max.trim() !== "";
    if (!hasMin && !hasMax) problems.push(`limits.${i}.range`);
    if (hasMin && !isNum(row.min)) problems.push(`limits.${i}.min`);
    if (hasMax && !isNum(row.max)) problems.push(`limits.${i}.max`);
    if (hasMin && hasMax && isNum(row.min) && isNum(row.max) && Number(row.min) > Number(row.max)) problems.push(`limits.${i}.range`);
    const lo = attr.min ?? -Infinity;
    const hi = attr.max ?? Infinity;
    if ((hasMin && isNum(row.min) && (Number(row.min) < lo || Number(row.min) > hi)) || (hasMax && isNum(row.max) && (Number(row.max) > hi || Number(row.max) < lo))) {
      problems.push(`limits.${i}.standard`);
    }
  });
  return problems;
}

export function settingsBody(form: ControlSettingsForm, baseVersion: number) {
  const absoluteLimits: Record<string, Record<string, { min?: number; max?: number }>> = {};
  for (const row of form.limits) {
    const range: { min?: number; max?: number } = {};
    if (row.min.trim() !== "") range.min = Number(row.min);
    if (row.max.trim() !== "") range.max = Number(row.max);
    (absoluteLimits[row.capability] ??= {})[row.attribute] = range;
  }
  return {
    absoluteLimits,
    manualOverrideMinutes: Number(form.manualOverrideMinutes),
    minIntervalSec: Number(form.minIntervalSec),
    oscillation: { windowSec: Number(form.oscillationWindowSec), flips: Number(form.oscillationFlips) },
    defaultValiditySec: Number(form.defaultValiditySec),
    scheduleRespectsManualOverride: form.scheduleRespectsManualOverride,
    requireApprovalForControlNodes: form.requireApprovalForControlNodes,
    baseVersion,
  };
}
