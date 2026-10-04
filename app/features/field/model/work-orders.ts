/**
 * 작업 지시·정기 점검·자산 정보 화면 모델(UI-DEV-13, DEV-08.01·08.02·08.06, design/api/DEV-api.md §9 API-DEV-90~96).
 * 상태: OPEN → ASSIGNED → IN_PROGRESS → DONE / CANCELLED(core WorkOrderRules). "마감 임박"은 48시간 이내(DEV-08.06, 2026-10-03 확정).
 */

export const WORK_ORDER_TYPES = ["BATTERY", "CALIBRATION", "INSPECTION", "REPAIR", "REPLACE", "RELOCATE", "OTHER"] as const;
export const WORK_ORDER_PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;
export const WORK_ORDER_STATUSES = ["OPEN", "ASSIGNED", "IN_PROGRESS", "DONE", "CANCELLED"] as const;
export const OPEN_STATUSES = ["OPEN", "ASSIGNED", "IN_PROGRESS"] as const;
export const WORK_ORDER_VIEWS = ["mine", "all", "dueSoon", "overdue"] as const;
export type WorkOrderView = (typeof WORK_ORDER_VIEWS)[number];
export type WorkOrderAction = "ASSIGN" | "START" | "COMPLETE" | "CANCEL";

export const DUE_SOON_MS = 48 * 3600_000;
export const MAX_TITLE = 150;
export const MAX_CHECKLIST = 50;
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
export const PLAN_INTERVAL_MIN = 7;
export const PLAN_INTERVAL_MAX = 1095;

export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
  doneBy?: string | null;
  doneAt?: string | null;
}

export interface WorkOrderTarget {
  deviceId?: string | null;
  spaceId?: string | null;
}

export interface WorkOrder {
  id: string;
  title: string;
  type: string;
  status: string;
  priority?: string | null;
  targets: WorkOrderTarget[];
  assigneeId?: string | null;
  requesterId?: string | null;
  dueAt?: string | null;
  origin?: string | null;
  originRef?: string | null;
  checklist: ChecklistItem[];
  result?: Record<string, unknown> | null;
  completedAt?: string | null;
  linkedToExisting?: boolean;
  version?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface Attachment {
  id: string;
  workOrderId?: string;
  kind: "PHOTO" | "FILE" | string;
  fileName: string;
  sizeBytes: number;
  url: string;
  uploadedBy?: string | null;
  createdAt?: string;
}

export interface Comment {
  id: string;
  authorId?: string | null;
  authorName?: string | null;
  body: string;
  createdAt: string;
}

export interface WorkOrderDetail extends WorkOrder {
  linkedOrigins?: { origin?: string; originRef?: string; at?: string }[] | null;
  attachments: Attachment[];
  comments: Comment[];
}

export interface MaintenancePlan {
  id: string;
  name: string;
  targetGroupId: string;
  workType: string;
  intervalDays: number;
  leadDays: number;
  nextDueOn: string;
  defaultAssigneeId?: string | null;
  checklistTemplate: string[];
  enabled: boolean;
  version: number;
  updatedAt?: string;
}

export interface AssetInfo {
  deviceId: string;
  serialNo?: string | null;
  purchasedOn?: string | null;
  installedOn?: string | null;
  warrantyUntil?: string | null;
  supplier?: string | null;
  installer?: string | null;
  photoUrls: string[];
  updatedAt?: string | null;
}

/** core가 주는 `/api/v1/…` 내려받기 경로를 브라우저 중계 경로(`/bff/api/…`)로 바꾼다 */
export function browserUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  return url.replace(/^(https?:\/\/[^/]+)?\/api\/v1\//, "/bff/api/");
}

/** 사진·첨부 경로 끝의 ID(`…/photos/{id}`, `…/attachments/{id}/content`) */
export function idFromUrl(url: string, segment: "photos" | "attachments"): string | null {
  const match = new RegExp(`/${segment}/([^/?]+)`).exec(url);
  return match ? decodeURIComponent(match[1]) : null;
}

/** 목록 보기 → API-DEV-91 쿼리. 내 작업·마감 임박·지연은 열린 작업만 */
export function workOrderQuery(view: WorkOrderView, options: { userId?: string | null; spaceId?: string | null; page?: number; size?: number; nowMs: number }): URLSearchParams {
  const q = new URLSearchParams();
  if (view !== "all") for (const s of OPEN_STATUSES) q.append("status", s);
  if (view === "mine") q.set("assigneeId", "me");
  if (view === "dueSoon") q.set("dueBefore", new Date(options.nowMs + DUE_SOON_MS).toISOString());
  if (view === "overdue") q.set("overdue", "true");
  if (options.spaceId) q.set("spaceId", options.spaceId);
  q.set("page", String(options.page ?? 1));
  q.set("size", String(options.size ?? 20));
  return q;
}

/** 통계·보기 탭 숫자용 쿼리(size=1, totalCount만 쓴다). "open"은 담당자와 관계없이 열린 작업 전체 */
export function countQuery(kind: "open" | "dueSoon" | "overdue", options: { spaceId?: string | null; nowMs: number }): URLSearchParams {
  const q = workOrderQuery(kind === "open" ? "all" : kind, { ...options, size: 1 });
  if (kind === "open") for (const s of OPEN_STATUSES) q.append("status", s);
  return q;
}

export function parseView(value: string | null | undefined): WorkOrderView {
  return (WORK_ORDER_VIEWS as readonly string[]).includes(value ?? "") ? (value as WorkOrderView) : "mine";
}

export function isOpen(status: string): boolean {
  return (OPEN_STATUSES as readonly string[]).includes(status);
}

export function isOverdue(order: Pick<WorkOrder, "dueAt" | "status">, nowMs: number): boolean {
  return Boolean(order.dueAt) && isOpen(order.status) && Date.parse(order.dueAt as string) < nowMs;
}

export function isDueSoon(order: Pick<WorkOrder, "dueAt" | "status">, nowMs: number): boolean {
  if (!order.dueAt || !isOpen(order.status)) return false;
  const due = Date.parse(order.dueAt);
  return due >= nowMs && due <= nowMs + DUE_SOON_MS;
}

/** 지금 상태에서 할 수 있는 동작(core WorkOrderRules와 같음) */
export function allowedActions(status: string): WorkOrderAction[] {
  switch (status) {
    case "OPEN":
    case "ASSIGNED":
      return ["ASSIGN", "START", "CANCEL"];
    case "IN_PROGRESS":
      return ["COMPLETE", "CANCEL"];
    default:
      return [];
  }
}

export function statusTone(status: string): "info" | "success" | "warning" | "danger" | "neutral" {
  if (status === "DONE") return "success";
  if (status === "CANCELLED") return "neutral";
  if (status === "IN_PROGRESS") return "warning";
  return "info";
}

export function priorityTone(priority: string | null | undefined): "info" | "warning" | "danger" | "neutral" {
  if (priority === "URGENT") return "danger";
  if (priority === "HIGH") return "warning";
  if (priority === "LOW") return "neutral";
  return "info";
}

export function checklistProgress(items: ChecklistItem[]): { done: number; total: number } {
  return { done: items.filter((i) => i.done).length, total: items.length };
}

export interface WorkOrderInput {
  title: string;
  type: string;
  priority: string;
  deviceIds: string[];
  spaceIds: string[];
  assigneeId: string;
  dueAt: string;
  checklist: string;
}

/** 입력 검증(UI-DEV-13): 제목 1~150, 대상 1개 이상, 마감은 현재 이후, 체크리스트 50개까지 */
export function checkWorkOrderInput(input: WorkOrderInput, nowMs: number): Record<string, string> {
  const errors: Record<string, string> = {};
  const title = input.title.trim();
  if (!title) errors.title = "required";
  else if (title.length > MAX_TITLE) errors.title = "tooLong";
  if (!(WORK_ORDER_TYPES as readonly string[]).includes(input.type)) errors.type = "required";
  if (input.deviceIds.length + input.spaceIds.length === 0) errors.targets = "required";
  if (input.dueAt) {
    const due = Date.parse(input.dueAt);
    if (Number.isNaN(due)) errors.dueAt = "invalid";
    else if (due <= nowMs) errors.dueAt = "past";
  }
  if (checklistLines(input.checklist).length > MAX_CHECKLIST) errors.checklist = "tooMany";
  return errors;
}

export function checklistLines(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

/** API-DEV-90 요청 본문 */
export function workOrderBody(input: WorkOrderInput) {
  return {
    title: input.title.trim(),
    type: input.type,
    priority: input.priority || "NORMAL",
    targets: [...input.deviceIds.map((deviceId) => ({ deviceId })), ...input.spaceIds.map((spaceId) => ({ spaceId }))],
    assigneeId: input.assigneeId || undefined,
    dueAt: input.dueAt ? new Date(input.dueAt).toISOString() : undefined,
    checklist: checklistLines(input.checklist),
    origin: "MANUAL",
  };
}

/** 첨부: 이미지·PDF, 20MB 이하(API-DEV-93) */
export function checkAttachment(file: { type: string; size: number }): "type" | "size" | null {
  if (!(file.type.startsWith("image/") || file.type === "application/pdf")) return "type";
  if (file.size > MAX_ATTACHMENT_BYTES) return "size";
  return null;
}

/** 완료 결과(BR-DEV-22): BATTERY 교체일, CALIBRATION 속성·값, REPLACE 새 기기 */
export function completionResult(type: string, values: { replacedOn?: string; attributeKey?: string; attributeValue?: string; newDeviceId?: string }): Record<string, unknown> | undefined {
  if (type === "BATTERY" && values.replacedOn) return { replacedOn: values.replacedOn };
  if (type === "CALIBRATION" && values.attributeKey?.trim()) {
    const raw = values.attributeValue?.trim() ?? "";
    const num = Number(raw);
    return { attributes: { [values.attributeKey.trim()]: raw !== "" && Number.isFinite(num) ? num : raw } };
  }
  if (type === "REPLACE" && values.newDeviceId?.trim()) return { newDeviceId: values.newDeviceId.trim() };
  return undefined;
}

export interface PlanInput {
  name: string;
  targetGroupId: string;
  workType: string;
  intervalDays: string;
  leadDays: string;
  nextDueOn: string;
  defaultAssigneeId: string;
  checklistTemplate: string;
  enabled: boolean;
}

/** 계획 검증: 이름 1~100, 그룹 필수, 주기 7~1,095일, lead 0 이상 주기 미만, 다음 마감 날짜 */
export function checkPlanInput(input: PlanInput): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!input.name.trim()) errors.name = "required";
  else if (input.name.trim().length > 100) errors.name = "tooLong";
  if (!input.targetGroupId) errors.targetGroupId = "required";
  const interval = Number(input.intervalDays);
  if (!Number.isInteger(interval) || interval < PLAN_INTERVAL_MIN || interval > PLAN_INTERVAL_MAX) errors.intervalDays = "range";
  const lead = input.leadDays === "" ? 0 : Number(input.leadDays);
  if (!Number.isInteger(lead) || lead < 0 || (Number.isInteger(interval) && lead >= interval)) errors.leadDays = "range";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.nextDueOn)) errors.nextDueOn = "required";
  if (checklistLines(input.checklistTemplate).length > MAX_CHECKLIST) errors.checklistTemplate = "tooMany";
  return errors;
}

export function planBody(input: PlanInput) {
  return {
    name: input.name.trim(),
    targetGroupId: input.targetGroupId,
    workType: input.workType,
    intervalDays: Number(input.intervalDays),
    leadDays: input.leadDays === "" ? 0 : Number(input.leadDays),
    nextDueOn: input.nextDueOn,
    defaultAssigneeId: input.defaultAssigneeId || undefined,
    checklistTemplate: checklistLines(input.checklistTemplate),
    enabled: input.enabled,
  };
}

export interface AssetInput {
  serialNo: string;
  purchasedOn: string;
  installedOn: string;
  warrantyUntil: string;
  supplier: string;
  installer: string;
}

/** 자산 정보 검증: 문자열 100자, 날짜 순서(구매 ≤ 설치, 구매 ≤ 보증 만료) */
export function checkAssetInput(input: AssetInput): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const key of ["serialNo", "supplier", "installer"] as const) if (input[key].trim().length > 100) errors[key] = "tooLong";
  if (input.purchasedOn && input.installedOn && input.installedOn < input.purchasedOn) errors.installedOn = "order";
  if (input.purchasedOn && input.warrantyUntil && input.warrantyUntil < input.purchasedOn) errors.warrantyUntil = "order";
  return errors;
}

/** API-DEV-96 전체 교체 본문(빈 값은 null) */
export function assetBody(input: AssetInput) {
  const v = (s: string) => (s.trim() ? s.trim() : null);
  return { serialNo: v(input.serialNo), purchasedOn: v(input.purchasedOn), installedOn: v(input.installedOn), warrantyUntil: v(input.warrantyUntil), supplier: v(input.supplier), installer: v(input.installer) };
}

/** 보증 만료까지 남은 날(지났으면 음수). 날짜가 없으면 null */
export function warrantyDaysLeft(warrantyUntil: string | null | undefined, nowMs: number): number | null {
  if (!warrantyUntil) return null;
  const end = Date.parse(`${warrantyUntil}T00:00:00Z`);
  if (Number.isNaN(end)) return null;
  return Math.floor((end - nowMs) / 86_400_000);
}

/** 작업 대상 요약: 기기 하나면 이름, 여럿이면 "기기 n대" */
export function targetDeviceIds(order: Pick<WorkOrder, "targets">): string[] {
  return order.targets.map((t) => t.deviceId).filter((id): id is string => Boolean(id));
}
