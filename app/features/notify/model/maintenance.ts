/**
 * UI-OPS-05 유지보수 일정 모델(OPS-05.01~05.03, BR-OPS-10·11, API-OPS-20~23).
 * 입력 검증: 종료 > 시작, 최대 30일, 사유 1~200자. 겹침은 서버가 409 MAINTENANCE_OVERLAP으로 거부한다.
 */
import { idOf, type MaintenanceStatus, type MaintenanceWindow } from "./types";

export const MAX_MAINTENANCE_DAYS = 30;
export const REASON_MAX = 200;
const DAY = 86_400_000;

export type MaintenanceTab = "active" | "scheduled" | "past";
export const MAINTENANCE_TABS: MaintenanceTab[] = ["active", "scheduled", "past"];

/** 탭 → 목록 조회 상태(API-OPS-23 `status`) */
export function statusesOf(tab: MaintenanceTab): MaintenanceStatus[] {
  if (tab === "active") return ["ACTIVE"];
  if (tab === "scheduled") return ["SCHEDULED"];
  return ["ENDED", "CANCELED"];
}

export function tabOf(value: string | null): MaintenanceTab {
  return (MAINTENANCE_TABS as string[]).includes(value ?? "") ? (value as MaintenanceTab) : "active";
}

export interface MaintenanceInput {
  targetType: string;
  targetId: string;
  /** 비어 있으면 지금 */
  startsAt: string | null;
  /** 비어 있으면 끝 없음(직접 종료) */
  endsAt: string | null;
  pauseAutomation: boolean;
  excludeFromAnalytics: boolean;
  reason: string;
}

export type MaintenanceField = "target" | "range" | "reason";
export type MaintenanceErrors = Partial<Record<MaintenanceField, string>>;

/** 오류 키는 문구 키(`ops.maintenance.errors.*`). nowMs는 "지금 시작"의 기준 */
export function checkMaintenance(input: MaintenanceInput, nowMs: number): MaintenanceErrors {
  const errors: MaintenanceErrors = {};
  if (!["SPACE", "DEVICE"].includes(input.targetType) || !input.targetId) errors.target = "targetRequired";
  const start = input.startsAt ? Date.parse(input.startsAt) : nowMs;
  const end = input.endsAt ? Date.parse(input.endsAt) : undefined;
  if (Number.isNaN(start) || (end !== undefined && Number.isNaN(end))) errors.range = "rangeInvalid";
  else if (end !== undefined && end <= start) errors.range = "endBeforeStart";
  else if (end !== undefined && end - start > MAX_MAINTENANCE_DAYS * DAY) errors.range = "tooLong";
  const reason = input.reason.trim();
  if (!reason) errors.reason = "reasonRequired";
  else if (reason.length > REASON_MAX) errors.reason = "reasonTooLong";
  return errors;
}

export function maintenanceBody(input: MaintenanceInput) {
  return {
    targetType: input.targetType,
    targetId: input.targetId,
    ...(input.startsAt ? { startsAt: input.startsAt } : {}),
    ...(input.endsAt ? { endsAt: input.endsAt } : {}),
    pauseAutomation: input.pauseAutomation,
    excludeFromAnalytics: input.excludeFromAnalytics,
    reason: input.reason.trim(),
  };
}

export function normalizeMaintenance(raw: Record<string, unknown>): MaintenanceWindow {
  // core(MaintenanceDtos.Window)는 만든 사람의 사용자 ID 문자열만 준다
  const createdBy = (typeof raw.createdBy === "string" || typeof raw.createdBy === "number" ? { userId: raw.createdBy } : raw.createdBy) as { userId?: unknown; name?: string } | null | undefined;
  return {
    id: idOf(raw, "maintenanceWindowId"),
    targetType: raw.targetType === "DEVICE" ? "DEVICE" : "SPACE",
    targetId: String(raw.targetId ?? ""),
    targetName: (raw.targetName as string | undefined) ?? null,
    startsAt: (raw.startsAt as string | undefined) ?? null,
    endsAt: (raw.endsAt as string | undefined) ?? null,
    pauseAutomation: raw.pauseAutomation !== false,
    excludeFromAnalytics: raw.excludeFromAnalytics !== false,
    reason: String(raw.reason ?? ""),
    status: (raw.status as MaintenanceStatus) ?? "SCHEDULED",
    createdBy: createdBy?.userId ? { userId: String(createdBy.userId), name: String(createdBy.name ?? "") } : null,
    version: raw.version === undefined ? undefined : Number(raw.version),
  };
}

/** 지금 진행 중인 창에서 쓸 수 있는 동작(종료는 ACTIVE, 취소는 SCHEDULED만, API-OPS-21·22) */
export function maintenanceActions(status: MaintenanceStatus): ("end" | "cancel")[] {
  if (status === "ACTIVE") return ["end"];
  if (status === "SCHEDULED") return ["cancel"];
  return [];
}
