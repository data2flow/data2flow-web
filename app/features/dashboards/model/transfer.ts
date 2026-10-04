/**
 * 대시보드 저장 본문·JSON 내보내기·가져오기·공유 링크 입력(DSH-04.07, DSH-06.03, API-DSH-07·10).
 */
import { validateLayout, type LayoutError } from "./layout";
import { validateVariables, type VariableError } from "./variables";
import { validateWidget, type WidgetError } from "./widgets";
import type { Dashboard, WidgetTypeInfo } from "./types";

export const NAME_MAX = 100;
export const DESCRIPTION_MAX = 500;
export const SHARE_MIN_DAYS = 1;
export const SHARE_MAX_DAYS = 90;
/** 가져오기 파일 크기 상한 */
export const IMPORT_MAX_BYTES = 1024 * 1024;

export type Draft = Pick<Dashboard, "name" | "description" | "visibility" | "layout" | "variables" | "timeRange" | "resolution" | "refresh">;

export interface DraftErrors {
  name?: "REQUIRED";
  layout: LayoutError[];
  variables: VariableError[];
  widgets: { id: string; errors: WidgetError[] }[];
}

export function hasErrors(e: DraftErrors): boolean {
  return Boolean(e.name) || e.layout.length > 0 || e.variables.length > 0 || e.widgets.length > 0;
}

/** 저장 전 검사(UI-DSH-04 입력 검증, BR-DSH-18) */
export function validateDraft(draft: Draft, types: readonly WidgetTypeInfo[]): DraftErrors {
  const name = draft.name.trim();
  const variableNames = new Set(draft.variables.map((v) => v.name));
  const widgets = draft.layout.widgets.map((w) => ({ id: w.id, errors: types.length ? validateWidget(w, types, variableNames) : [] })).filter((w) => w.errors.length > 0);
  return {
    name: name.length === 0 || name.length > NAME_MAX ? "REQUIRED" : undefined,
    layout: validateLayout(draft.layout.widgets),
    variables: validateVariables(draft.variables),
    widgets,
  };
}

/** PUT 본문(API-DSH-07, baseVersion으로 낙관적 잠금) */
export function saveBody(draft: Draft, baseVersion: number): Record<string, unknown> {
  return {
    name: draft.name.trim(),
    description: draft.description?.trim() || null,
    visibility: draft.visibility,
    layout: { widgets: draft.layout.widgets },
    variables: draft.variables,
    timeRange: draft.timeRange,
    resolution: draft.resolution,
    refresh: draft.refresh,
    baseVersion,
  };
}

export function draftOf(d: Dashboard): Draft {
  return {
    name: d.name,
    description: d.description ?? "",
    visibility: d.visibility,
    layout: { widgets: (d.layout?.widgets ?? []).map((w) => ({ ...w })) },
    variables: [...(d.variables ?? [])],
    timeRange: d.timeRange ?? { relative: "24h" },
    resolution: d.resolution ?? "AUTO",
    refresh: d.refresh ?? "LIVE",
  };
}

export type ImportCheck = { ok: true; body: Record<string, unknown> } | { ok: false; reason: "TOO_LARGE" | "NOT_JSON" | "NOT_DASHBOARD" };

/** 가져오기 파일 읽기: API-DSH-07 내보내기 모양 `{formatVersion, dashboard{…}, targets[]}` 그대로 보낸다 */
export function parseImport(text: string, size = text.length): ImportCheck {
  if (size > IMPORT_MAX_BYTES) return { ok: false, reason: "TOO_LARGE" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: "NOT_JSON" };
  }
  const body = parsed as { dashboard?: { name?: unknown; layout?: unknown } } | null;
  if (!body || typeof body !== "object" || !body.dashboard || typeof body.dashboard.name !== "string") return { ok: false, reason: "NOT_DASHBOARD" };
  return { ok: true, body: body as Record<string, unknown> };
}

export function shareDaysValid(days: number): boolean {
  return Number.isInteger(days) && days >= SHARE_MIN_DAYS && days <= SHARE_MAX_DAYS;
}

/** 공유 링크 상태(목록 표시) */
export function shareLinkStatus(link: { expiresAt: string; revokedAt?: string | null }, now: number): "ACTIVE" | "EXPIRED" | "REVOKED" {
  if (link.revokedAt) return "REVOKED";
  return Date.parse(link.expiresAt) <= now ? "EXPIRED" : "ACTIVE";
}

/** 409 응답의 최신 판 `{version, updatedBy, updatedByName, updatedAt}`(BR-DSH-07) */
export interface ConflictInfo {
  version: number;
  updatedByName?: string | null;
  updatedAt?: string | null;
}
