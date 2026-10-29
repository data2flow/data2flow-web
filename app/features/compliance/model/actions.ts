/**
 * 개선 조치(API-CMP-23·24, UI-CMP-10) 응답 모양과 입력 검증. core-api CorrectiveActionDtos와 같다.
 * 결과 상태 resultStatus: RECORDED(수동)·PENDING(24시간 전)·CONFIRMED·UNVERIFIABLE(결측 과다, BR-CMP-18).
 */
import type { UserRef } from "./reports";

export const CAUSES = ["VENTILATION", "EQUIPMENT", "OUTDOOR_INFLOW", "CROWDING", "SENSOR", "OTHER"] as const;
export type Cause = (typeof CAUSES)[number];
export const RESULT_MODES = ["AUTO", "MANUAL"] as const;
export type ResultMode = (typeof RESULT_MODES)[number];
export type ResultStatus = "RECORDED" | "PENDING" | "CONFIRMED" | "UNVERIFIABLE";

export interface CorrectiveAction {
  actionId: string;
  excursionId: string;
  excursion: { spaceId: string; metricKey: string; startedAt: string; endedAt?: string | null; peakValue: number };
  cause: Cause;
  causeNote?: string | null;
  actionText: string;
  actor: UserRef;
  actedAt: string;
  linkedAlarmIds: string[];
  linkedWorkOrderIds: string[];
  resultMode: ResultMode;
  resultRatio24h?: number | null;
  resultNote?: string | null;
  resultStatus: ResultStatus;
  updatedAt: string;
}

export interface ExcursionDetail {
  excursionId: string;
  spaceId: string;
  spaceName?: string | null;
  metricKey: string;
  startedAt: string;
  endedAt?: string | null;
  peakValue: number;
  alarmId?: string | null;
  actions: CorrectiveAction[];
}

export interface ActionForm {
  cause: string;
  causeNote: string;
  actionText: string;
  actorUserId: string;
  /** 조직 시간대 기준 `YYYY-MM-DDTHH:mm`(datetime-local) */
  actedAt: string;
  linkedAlarmIds: string[];
  linkedWorkOrderIds: string[];
  resultMode: string;
  resultNote: string;
}

/** UI-CMP-10 필드 검증(오류는 `compliance.actions.validation.*` 키). actedAt·startedAt·now는 ISO 시각 */
export function validateActionForm(form: ActionForm, actedAtIso: string | null, startedAt: string, now: string): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!(CAUSES as readonly string[]).includes(form.cause)) errors.cause = "causeRequired";
  if (form.cause === "OTHER" && !form.causeNote.trim()) errors.causeNote = "causeNoteRequired";
  if (form.causeNote.trim().length > 200) errors.causeNote = "causeNoteTooLong";
  if (!form.actionText.trim()) errors.actionText = "actionRequired";
  else if (form.actionText.trim().length > 1000) errors.actionText = "actionTooLong";
  if (!form.actorUserId) errors.actorUserId = "actorRequired";
  if (!actedAtIso) errors.actedAt = "actedAtRequired";
  else if (Date.parse(actedAtIso) < Date.parse(startedAt)) errors.actedAt = "beforeExcursion";
  else if (Date.parse(actedAtIso) > Date.parse(now) + 5 * 60_000) errors.actedAt = "future";
  if (!(RESULT_MODES as readonly string[]).includes(form.resultMode)) errors.resultMode = "resultModeRequired";
  else if (form.resultMode === "MANUAL" && !form.resultNote.trim()) errors.resultNote = "resultNoteRequired";
  if (form.resultNote.trim().length > 500) errors.resultNote = "resultNoteTooLong";
  return errors;
}

/** API-CMP-23 본문 */
export function actionBody(form: ActionForm, actedAtIso: string) {
  const note = (s: string) => s.trim() || null;
  return {
    cause: form.cause,
    causeNote: note(form.causeNote),
    actionText: form.actionText.trim(),
    actorUserId: form.actorUserId,
    actedAt: actedAtIso,
    linkedAlarmIds: form.linkedAlarmIds,
    linkedWorkOrderIds: form.linkedWorkOrderIds,
    resultMode: form.resultMode,
    resultNote: form.resultMode === "MANUAL" ? note(form.resultNote) : null,
  };
}

/** 쉼표·공백으로 나눈 ID 목록(숫자만, 중복 제거) */
export function parseIds(raw: string): string[] {
  return [...new Set(raw.split(/[\s,]+/).filter((s) => /^\d+$/.test(s)))];
}

/** 조치 결과 문구 키와 값: CONFIRMED는 충족률(정수 %) */
export function resultSummary(a: Pick<CorrectiveAction, "resultStatus" | "resultRatio24h" | "resultNote">): { key: string; ratio?: number; note?: string } {
  if (a.resultStatus === "CONFIRMED") return { key: "confirmed", ratio: Math.round(a.resultRatio24h ?? 0) };
  if (a.resultStatus === "RECORDED") return { key: "recorded", note: a.resultNote ?? "" };
  return { key: a.resultStatus === "UNVERIFIABLE" ? "unverifiable" : "pending" };
}
