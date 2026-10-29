/**
 * 정기 발행(API-CMP-21·22, UI-CMP-09) 응답 모양과 입력 검증. core-api ReportScheduleDtos와 같다.
 * 일정은 조직 시간대의 매월 N일(또는 분기 첫 달 N일) HH:mm에 돌고, 대상 기간은 직전 달·직전 분기다.
 */
import type { ReportType } from "./reports";

export const CADENCES = ["MONTHLY", "QUARTERLY"] as const;
export const PERIOD_RULES = ["PREVIOUS_MONTH", "PREVIOUS_QUARTER"] as const;
export const SCHEDULE_FORMATS = ["PDF", "PDF_CSV"] as const;
export type RunStatus = "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED";
export const MAX_RECIPIENTS = 50;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export interface ScheduleTemplate {
  type: ReportType;
  title?: string | null;
  spaceIds: string[];
  facilityType?: string | null;
  options?: Record<string, unknown> | null;
}

export interface Recipients {
  userIds: string[];
  emails: string[];
}

export interface Delivery {
  recipient: string;
  status: string;
}

export interface ScheduleRun {
  runId: string;
  scheduledAt: string;
  trigger: "SCHEDULED" | "MANUAL";
  status: RunStatus;
  attempts: number;
  reportId?: string | null;
  revisionNo?: number | null;
  error?: string | null;
  deliveries: Delivery[];
}

export interface ReportSchedule {
  reportScheduleId: string;
  name: string;
  reportTemplate: ScheduleTemplate;
  cadence: (typeof CADENCES)[number];
  dayOfPeriod: number;
  publishTime: string;
  periodRule: (typeof PERIOD_RULES)[number];
  recipients: Recipients;
  format: (typeof SCHEDULE_FORMATS)[number];
  enabled: boolean;
  nextRunAt?: string | null;
  version: number;
  updatedAt: string;
  lastRun?: ScheduleRun | null;
}

export interface ScheduleForm {
  name: string;
  type: string;
  title: string;
  spaceIds: string[];
  facilityType: string;
  cadence: string;
  dayOfPeriod: string;
  publishTime: string;
  periodRule: string;
  userIds: string[];
  /** 쉼표·줄바꿈으로 나눈 이메일 */
  emails: string;
  format: string;
  enabled: boolean;
}

/** 쉼표·세미콜론·공백으로 나눈 이메일(소문자, 중복 제거) */
export function parseEmails(raw: string): string[] {
  return [...new Set(raw.split(/[\s,;]+/).map((s) => s.trim().toLowerCase()).filter(Boolean))];
}

/** UI-CMP-09 필드 검증(오류는 `compliance.schedules.validation.*` 키) */
export function validateScheduleForm(form: ScheduleForm): Record<string, string> {
  const errors: Record<string, string> = {};
  const name = form.name.trim();
  if (!name) errors.name = "nameRequired";
  else if (name.length > 100) errors.name = "nameTooLong";
  if (form.type !== "KR_SELF_CHECK") errors.type = "typeUnsupported";
  if (!form.spaceIds.length) errors.spaceIds = "spaceRequired";
  if (form.title.trim().length > 200) errors.title = "titleTooLong";
  if (!(CADENCES as readonly string[]).includes(form.cadence)) errors.cadence = "cadenceRequired";
  const day = Number(form.dayOfPeriod);
  if (!/^\d+$/.test(form.dayOfPeriod) || day < 1 || day > 28) errors.dayOfPeriod = "dayRange";
  if (!TIME.test(form.publishTime)) errors.publishTime = "timeFormat";
  if (!(PERIOD_RULES as readonly string[]).includes(form.periodRule)) errors.periodRule = "periodRuleRequired";
  if (!(SCHEDULE_FORMATS as readonly string[]).includes(form.format)) errors.format = "formatRequired";
  const emails = parseEmails(form.emails);
  if (emails.some((e) => e.length > 254 || !EMAIL.test(e))) errors.recipients = "emailInvalid";
  else if (!form.userIds.length && !emails.length) errors.recipients = "recipientsRequired";
  else if (form.userIds.length + emails.length > MAX_RECIPIENTS) errors.recipients = "tooManyRecipients";
  return errors;
}

/** API-CMP-21 본문. 수정이면 version을 싣는다 */
export function scheduleBody(form: ScheduleForm, version?: number) {
  return {
    name: form.name.trim(),
    reportTemplate: { type: form.type, title: form.title.trim() || null, spaceIds: form.spaceIds, facilityType: form.facilityType || null },
    cadence: form.cadence,
    dayOfPeriod: Number(form.dayOfPeriod),
    publishTime: form.publishTime,
    periodRule: form.periodRule,
    recipients: { userIds: form.userIds, emails: parseEmails(form.emails) },
    format: form.format,
    enabled: form.enabled,
    ...(version === undefined ? {} : { version }),
  };
}

export function formOf(s: ReportSchedule): ScheduleForm {
  return {
    name: s.name,
    type: s.reportTemplate.type,
    title: s.reportTemplate.title ?? "",
    spaceIds: s.reportTemplate.spaceIds,
    facilityType: s.reportTemplate.facilityType ?? "",
    cadence: s.cadence,
    dayOfPeriod: String(s.dayOfPeriod),
    publishTime: s.publishTime,
    periodRule: s.periodRule,
    userIds: s.recipients.userIds,
    emails: s.recipients.emails.join(", "),
    format: s.format,
    enabled: s.enabled,
  };
}

export const EMPTY_FORM: ScheduleForm = {
  name: "",
  type: "KR_SELF_CHECK",
  title: "",
  spaceIds: [],
  facilityType: "",
  cadence: "MONTHLY",
  dayOfPeriod: "1",
  publishTime: "09:00",
  periodRule: "PREVIOUS_MONTH",
  userIds: [],
  emails: "",
  format: "PDF",
  enabled: true,
};

/** 서버 필드 오류(CMP_SCHEDULE_INVALID errors[].field)를 폼 필드와 문구 키로 */
export function serverFieldError(field: string, code: string): [string, string] {
  if (field.startsWith("recipients")) return ["recipients", code === "Email" ? "emailInvalid" : code === "Size" ? "tooManyRecipients" : code === "NotFound" ? "userNotFound" : "recipientsRequired"];
  if (field.startsWith("reportTemplate.spaceIds")) return ["spaceIds", "spaceRequired"];
  if (field === "reportTemplate.title") return ["title", "titleTooLong"];
  if (field === "dayOfPeriod") return ["dayOfPeriod", "dayRange"];
  if (field === "publishTime") return ["publishTime", "timeFormat"];
  if (field === "name") return ["name", code === "Size" ? "nameTooLong" : "nameRequired"];
  return ["form", "invalid"];
}

export function runTone(status: RunStatus | undefined): "success" | "danger" | "info" {
  return status === "SUCCEEDED" ? "success" : status === "FAILED" ? "danger" : "info";
}
