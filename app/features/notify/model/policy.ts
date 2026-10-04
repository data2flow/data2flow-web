/**
 * UI-RUL-06 알림 정책 폼 모델(RUL-03.02·03.03·03.06, BR-RUL-12·13·15·16, API-RUL-21).
 * 폼(FormData) → 검증 → 요청 본문. 화면과 서버(action)가 같은 규칙을 쓴다.
 */
import { RECIPIENT_TYPES, SEVERITIES, idOf, type NotificationPolicy, type PolicyRow, type PolicyStep, type Recipient, type RecipientType, type Severity, type TimeWindow } from "./types";

/** 재알림 간격 10분~24시간, 기본 30분(UI-RUL-06) */
export const RENOTIFY_OPTIONS = [10, 15, 30, 60, 120, 240, 720, 1440];
export const RENOTIFY_MIN = 10;
export const RENOTIFY_MAX = 1440;
export const RENOTIFY_DEFAULT = 30;
/** 묶기: 끔(0) 또는 1~10분(ADR-048 aggregateWindowSec 0 또는 60~600) */
export const AGGREGATE_OPTIONS = [0, 60, 120, 180, 300, 600];
export const MAX_STEPS = 3;
/** 웹 알림은 채널 설정 없이 늘 쓸 수 있다. 나머지는 등록된 채널 SPI 키(지금은 TELEGRAM, ADR-033) */
export const WEB_CHANNEL = "WEB";

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export type PolicyField = "name" | "recipients" | "channels" | "renotifyMinutes" | "aggregateWindowSec" | "timeWindow" | "steps" | "minSeverity";
export type PolicyErrors = Partial<Record<PolicyField, string>>;

export interface PolicyInput {
  name: string;
  minSeverity: string;
  spaceId: string | null;
  includeChildren: boolean;
  ruleIds: string[];
  timeWindow: TimeWindow | null;
  recipients: Recipient[];
  channels: string[];
  templates: Record<string, string>;
  renotifyMinutes: number;
  aggregateWindowSec: number;
  notifyOnClear: boolean;
  steps: PolicyStep[];
}

/** 수신자 하나를 폼 값(`TYPE:id`)으로. 당직자·채널 기본 수신자는 id가 없다 */
export function encodeRecipient(recipient: Recipient): string {
  return `${recipient.type}:${recipient.id ?? ""}`;
}

export function decodeRecipient(raw: string): Recipient | undefined {
  const index = raw.indexOf(":");
  const type = (index < 0 ? raw : raw.slice(0, index)) as RecipientType;
  const id = index < 0 ? "" : raw.slice(index + 1).trim();
  if (!(RECIPIENT_TYPES as readonly string[]).includes(type)) return undefined;
  if ((type === "USER" || type === "ROLE") && !id) return undefined;
  return type === "ON_CALL" || type === "CHANNEL_DEFAULT" ? { type } : { type, id };
}

/** 같은 수신자는 한 번만 */
export function uniqueRecipients(list: Recipient[]): Recipient[] {
  const seen = new Set<string>();
  return list.filter((r) => {
    const key = encodeRecipient(r);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseSteps(raw: string): PolicyStep[] | undefined {
  if (!raw.trim()) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return undefined;
    return value.map((step, index) => {
      const s = step as { waitMinutes?: unknown; recipients?: unknown };
      const recipients = Array.isArray(s.recipients) ? s.recipients.map((r) => (typeof r === "string" ? decodeRecipient(r) : decodeRecipient(encodeRecipient(r as Recipient)))).filter((r): r is Recipient => Boolean(r)) : [];
      return { stepNo: index + 1, waitMinutes: Number(s.waitMinutes), recipients: uniqueRecipients(recipients) };
    });
  } catch {
    return undefined;
  }
}

const str = (form: FormData, name: string) => {
  const v = form.get(name);
  return typeof v === "string" ? v : "";
};

/** 폼 → 입력값. 단계 표는 클라이언트 편집기가 JSON 하나(`steps`)로 보낸다 */
export function parsePolicyForm(form: FormData): { input: PolicyInput; stepsInvalid: boolean } {
  const days = form
    .getAll("days")
    .map(Number)
    .filter((d) => Number.isInteger(d) && d >= 1 && d <= 7);
  const timeWindow = str(form, "timeMode") === "WINDOW" ? { days: [...new Set(days)].sort((a, b) => a - b), from: str(form, "from"), to: str(form, "to") } : null;
  const channels = [...new Set(form.getAll("channel").map(String).filter(Boolean))];
  const templates: Record<string, string> = {};
  for (const channel of channels) {
    const value = str(form, `template_${channel}`);
    if (value) templates[channel] = value;
  }
  const steps = parseSteps(str(form, "steps"));
  return {
    input: {
      name: str(form, "name").trim(),
      minSeverity: str(form, "minSeverity"),
      spaceId: str(form, "spaceId") || null,
      includeChildren: form.get("includeChildren") === "on" || form.get("includeChildren") === "true",
      ruleIds: [...new Set(form.getAll("ruleIds").map(String).filter(Boolean))],
      timeWindow,
      recipients: uniqueRecipients(
        form
          .getAll("recipient")
          .map(String)
          .map(decodeRecipient)
          .filter((r): r is Recipient => Boolean(r)),
      ),
      channels,
      templates,
      renotifyMinutes: Number(str(form, "renotifyMinutes") || RENOTIFY_DEFAULT),
      aggregateWindowSec: Number(str(form, "aggregateWindowSec") || 0),
      notifyOnClear: form.get("notifyOnClear") === "on" || form.get("notifyOnClear") === "true",
      steps: steps ?? [],
    },
    stepsInvalid: steps === undefined,
  };
}

/** 오류 키는 문구 키(`notify.policy.errors.*`) */
export function checkPolicy(input: PolicyInput, stepsInvalid = false): PolicyErrors {
  const errors: PolicyErrors = {};
  if (!input.name) errors.name = "nameRequired";
  else if (input.name.length > 100) errors.name = "nameTooLong";
  if (!(SEVERITIES as readonly string[]).includes(input.minSeverity)) errors.minSeverity = "severityRequired";
  if (input.recipients.length === 0) errors.recipients = "recipientsRequired";
  if (input.channels.length === 0) errors.channels = "channelsRequired";
  if (!Number.isInteger(input.renotifyMinutes) || input.renotifyMinutes < RENOTIFY_MIN || input.renotifyMinutes > RENOTIFY_MAX) errors.renotifyMinutes = "renotifyRange";
  if (!Number.isInteger(input.aggregateWindowSec) || (input.aggregateWindowSec !== 0 && (input.aggregateWindowSec < 60 || input.aggregateWindowSec > 600))) errors.aggregateWindowSec = "aggregateRange";
  if (input.timeWindow) {
    const { days, from, to } = input.timeWindow;
    if (days.length === 0) errors.timeWindow = "daysRequired";
    else if (!HHMM.test(from) || !HHMM.test(to)) errors.timeWindow = "timeFormat";
    else if (from === to) errors.timeWindow = "timeSame";
  }
  if (stepsInvalid) errors.steps = "stepsInvalid";
  else if (input.steps.length > MAX_STEPS) errors.steps = "stepsTooMany";
  else if (input.steps.some((s) => !Number.isInteger(s.waitMinutes) || s.waitMinutes < 1 || s.waitMinutes > 1440)) errors.steps = "stepWaitRange";
  else if (input.steps.some((s) => s.recipients.length === 0)) errors.steps = "stepRecipientsRequired";
  return errors;
}

/** 요청 본문(API-RUL-21). 수정이면 baseVersion을 붙인다 */
export function policyBody(input: PolicyInput, baseVersion?: number) {
  const recipients = (list: Recipient[]) => list.map((r) => ({ type: r.type, id: r.id ?? null }));
  return {
    name: input.name,
    minSeverity: input.minSeverity as Severity,
    spaceId: input.spaceId,
    includeChildren: input.spaceId ? input.includeChildren : true,
    ruleIds: input.ruleIds,
    timeWindow: input.timeWindow,
    recipients: recipients(input.recipients),
    channels: input.channels,
    templates: input.templates,
    renotifyMinutes: input.renotifyMinutes,
    aggregateWindowSec: input.aggregateWindowSec,
    notifyOnClear: input.notifyOnClear,
    steps: input.steps.map((s, i) => ({ stepNo: i + 1, waitMinutes: s.waitMinutes, recipients: recipients(s.recipients) })),
    ...(baseVersion !== undefined ? { baseVersion } : {}),
  };
}

/** 새 정책 기본값(UI-RUL-06: 재알림 30분, 묶기 끔, 해제 알림 보냄, 웹 채널) */
export function emptyPolicy(): NotificationPolicy {
  return {
    notificationPolicyId: "",
    name: "",
    minSeverity: "MAJOR",
    spaceId: null,
    includeChildren: true,
    ruleIds: [],
    timeWindow: null,
    recipients: [{ type: "ON_CALL" }],
    channels: [WEB_CHANNEL],
    templates: {},
    renotifyMinutes: RENOTIFY_DEFAULT,
    aggregateWindowSec: 0,
    notifyOnClear: true,
    steps: [],
    version: 0,
  };
}

function normalizeRecipients(value: unknown): Recipient[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((r) => {
      const row = r as { type?: string; id?: unknown; name?: string };
      const decoded = decodeRecipient(`${row.type ?? ""}:${row.id ?? ""}`);
      return decoded ? { ...decoded, name: row.name ?? null } : undefined;
    })
    .filter((r): r is NonNullable<typeof r> => Boolean(r));
}

/** 서버 응답 → 화면 모델(ID 문자열, 빠진 값 기본값) */
export function normalizePolicy(raw: Record<string, unknown>): NotificationPolicy {
  const base = emptyPolicy();
  const steps = Array.isArray(raw.steps) ? (raw.steps as Record<string, unknown>[]) : [];
  const tw = raw.timeWindow as TimeWindow | null | undefined;
  return {
    ...base,
    notificationPolicyId: idOf(raw, "notificationPolicyId"),
    name: String(raw.name ?? ""),
    minSeverity: (SEVERITIES as readonly string[]).includes(String(raw.minSeverity)) ? (raw.minSeverity as Severity) : base.minSeverity,
    spaceId: raw.spaceId === null || raw.spaceId === undefined ? null : String(raw.spaceId),
    includeChildren: raw.includeChildren !== false,
    ruleIds: Array.isArray(raw.ruleIds) ? raw.ruleIds.map(String) : [],
    timeWindow: tw && Array.isArray(tw.days) ? { days: tw.days.map(Number), from: String(tw.from ?? ""), to: String(tw.to ?? "") } : null,
    recipients: normalizeRecipients(raw.recipients),
    channels: Array.isArray(raw.channels) ? raw.channels.map(String) : [],
    templates: (raw.templates as Record<string, string> | null) ?? {},
    renotifyMinutes: Number(raw.renotifyMinutes ?? base.renotifyMinutes),
    aggregateWindowSec: Number(raw.aggregateWindowSec ?? 0),
    notifyOnClear: raw.notifyOnClear !== false,
    steps: steps.map((s, i) => ({ stepNo: Number(s.stepNo ?? i + 1), waitMinutes: Number(s.waitMinutes ?? 0), recipients: normalizeRecipients(s.recipients) })).sort((a, b) => a.stepNo - b.stepNo),
    version: Number(raw.version ?? 0),
    createdAt: raw.createdAt as string | undefined,
    updatedAt: raw.updatedAt as string | undefined,
  };
}

export function normalizePolicyRow(raw: Record<string, unknown>): PolicyRow {
  return {
    notificationPolicyId: idOf(raw, "notificationPolicyId"),
    name: String(raw.name ?? ""),
    minSeverity: (raw.minSeverity as Severity) ?? "MAJOR",
    spaceId: raw.spaceId === null || raw.spaceId === undefined ? null : String(raw.spaceId),
    channels: Array.isArray(raw.channels) ? raw.channels.map(String) : [],
    recipientCount: Number(raw.recipientCount ?? 0),
    stepCount: Number(raw.stepCount ?? 0),
    updatedAt: raw.updatedAt as string | undefined,
  };
}

/** 서버 검증 오류(`errors[{field, code}]`)와 CHANNEL_NOT_CONFIGURED(409)를 필드 오류로(TC-RUL-071) */
export function serverPolicyErrors(failure: { code: string; errors?: { field: string; code: string }[] }): PolicyErrors {
  const out: PolicyErrors = {};
  if (failure.code === "CHANNEL_NOT_CONFIGURED") out.channels = "channelNotConfigured";
  for (const e of failure.errors ?? []) {
    const root = e.field.split(/[.[]/)[0] as PolicyField;
    if (["name", "recipients", "channels", "renotifyMinutes", "aggregateWindowSec", "timeWindow", "steps", "minSeverity"].includes(root) && !out[root]) {
      out[root] = e.code === "CHANNEL_NOT_CONFIGURED" ? "channelNotConfigured" : "serverInvalid";
    }
  }
  return out;
}
