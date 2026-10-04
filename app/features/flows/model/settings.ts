/**
 * 플로우 설정(UI-FLW-09)·설명서(UI-FLW-22) 화면 모델: 설정 패치(API-FLW-10, 온 키만), 실행 모드·변수 정의(버전에 들어가므로 정의의 `mode`·`variables`),
 * 입력 검증(목적 1~200자, 설명 4,000자, 변수 이름 영문·숫자·`_` 1~40자·50개, 최대 동시 1~50, 오류율 기준 1~100%).
 */
import type { FlowSettingsPatch } from "../api";
import type { FlowDetail } from "./types";

export const PURPOSE_MAX = 200;
export const DESCRIPTION_MAX = 4000;
export const VARIABLE_LIMIT = 50;
export const VARIABLE_NAME = /^[A-Za-z0-9_]{1,40}$/;
export const VARIABLE_TYPES = ["number", "string", "boolean", "json"] as const;
export const CONCURRENCY = ["queued", "single", "restart", "parallel"] as const;
export const KEY_BY = ["deviceId", "spaceId", "flow"] as const;

export interface SettingsForm {
  purpose: string;
  description: string;
  ownerUserId: string;
  relatedSpaceIds: string[];
  tags: string;
  pauseMode: "DROP" | "BUFFER";
  autoPauseOnDegraded: boolean;
  /** 화면은 % (1~100), API는 비율(0.01~1) */
  errorRatePercent: string;
  catchFlowId: string;
}

export interface ModeForm {
  concurrency: (typeof CONCURRENCY)[number];
  keyBy: (typeof KEY_BY)[number];
  max: string;
}

export interface VariableDef {
  name: string;
  type: (typeof VARIABLE_TYPES)[number];
  initial: unknown;
}

export function settingsFormOf(flow: FlowDetail["flow"] | undefined): SettingsForm {
  return {
    purpose: flow?.purpose ?? "",
    description: flow?.description ?? "",
    ownerUserId: flow?.ownerUserId ?? "",
    relatedSpaceIds: (flow?.relatedSpaceIds ?? []).map(String),
    tags: (flow?.tags ?? []).join(", "),
    pauseMode: flow?.pauseMode ?? "DROP",
    autoPauseOnDegraded: Boolean(flow?.autoPauseOnDegraded),
    errorRatePercent: String(Math.round((flow?.errorRateThreshold ?? 0.1) * 1000) / 10),
    catchFlowId: flow?.catchFlowId ?? "",
  };
}

export type SettingsProblem = Partial<Record<"purpose" | "description" | "errorRatePercent" | "catchFlowId", string>>;

export function checkSettings(form: SettingsForm, flowId: string | null): SettingsProblem {
  const out: SettingsProblem = {};
  const purpose = form.purpose.trim();
  if (purpose.length < 1 || purpose.length > PURPOSE_MAX) out.purpose = "purpose";
  if (form.description.length > DESCRIPTION_MAX) out.description = "description";
  const rate = Number(form.errorRatePercent);
  if (!Number.isFinite(rate) || rate < 1 || rate > 100) out.errorRatePercent = "errorRate";
  if (form.catchFlowId && flowId && form.catchFlowId.trim() === flowId) out.catchFlowId = "catchSelf";
  return out;
}

const tagsOf = (raw: string) => [...new Set(raw.split(",").map((s) => s.trim()).filter(Boolean))];
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** 바뀐 키만 담은 PATCH 본문(API-FLW-10, api-rules "온 키만") */
export function settingsPatch(before: SettingsForm, after: SettingsForm): FlowSettingsPatch {
  const patch: FlowSettingsPatch = {};
  if (after.purpose.trim() !== before.purpose.trim()) patch.purpose = after.purpose.trim();
  if (after.description !== before.description) patch.description = after.description;
  if (after.ownerUserId !== before.ownerUserId) patch.ownerUserId = after.ownerUserId || null;
  if (!same([...after.relatedSpaceIds].sort(), [...before.relatedSpaceIds].sort())) patch.relatedSpaceIds = after.relatedSpaceIds;
  if (!same(tagsOf(after.tags), tagsOf(before.tags))) patch.tags = tagsOf(after.tags);
  if (after.pauseMode !== before.pauseMode) patch.pauseMode = after.pauseMode;
  if (after.autoPauseOnDegraded !== before.autoPauseOnDegraded) patch.autoPauseOnDegraded = after.autoPauseOnDegraded;
  if (Number(after.errorRatePercent) !== Number(before.errorRatePercent)) patch.errorRateThreshold = Math.round(Number(after.errorRatePercent) * 10) / 1000;
  if (after.catchFlowId.trim() !== before.catchFlowId.trim()) patch.catchFlowId = after.catchFlowId.trim() || null;
  return patch;
}

export function modeOf(mode: Record<string, unknown> | undefined): ModeForm {
  const concurrency = CONCURRENCY.includes(mode?.concurrency as ModeForm["concurrency"]) ? (mode!.concurrency as ModeForm["concurrency"]) : "queued";
  const keyBy = KEY_BY.includes(mode?.keyBy as ModeForm["keyBy"]) ? (mode!.keyBy as ModeForm["keyBy"]) : "deviceId";
  return { concurrency, keyBy, max: String(typeof mode?.max === "number" ? mode.max : 10) };
}

export function modeProblem(form: ModeForm): string | undefined {
  if (form.concurrency !== "parallel") return undefined;
  const max = Number(form.max);
  return Number.isInteger(max) && max >= 1 && max <= 50 ? undefined : "max";
}

export function toMode(form: ModeForm): Record<string, unknown> {
  return { concurrency: form.concurrency, keyBy: form.keyBy, ...(form.concurrency === "parallel" ? { max: Number(form.max) } : { max: 10 }) };
}

export function variablesOf(raw: unknown): VariableDef[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((v): v is Record<string, unknown> => Boolean(v) && typeof v === "object")
    .map((v) => ({ name: String(v.name ?? ""), type: (VARIABLE_TYPES.includes(v.type as VariableDef["type"]) ? v.type : "string") as VariableDef["type"], initial: v.initial ?? "" }));
}

export function variableProblems(vars: VariableDef[]): { index: number; rule: "name" | "duplicate" | "limit" }[] {
  const out: { index: number; rule: "name" | "duplicate" | "limit" }[] = [];
  const seen = new Set<string>();
  vars.forEach((v, index) => {
    if (!VARIABLE_NAME.test(v.name)) out.push({ index, rule: "name" });
    else if (seen.has(v.name)) out.push({ index, rule: "duplicate" });
    seen.add(v.name);
    if (index >= VARIABLE_LIMIT) out.push({ index, rule: "limit" });
  });
  return out;
}

/** 화면 입력(문자열)을 변수 타입 초기값으로 */
export function parseInitial(type: VariableDef["type"], raw: string): unknown {
  if (type === "number") return raw === "" ? 0 : Number(raw);
  if (type === "boolean") return raw === "true";
  if (type === "json") {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  return raw;
}

export function initialText(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}
