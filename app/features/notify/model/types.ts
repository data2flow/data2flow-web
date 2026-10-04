/**
 * 알림 정책·템플릿·당직·개인 수신 설정(design/api/RUL-api.md §3, 부록 A)과 유지보수·알림 채널(design/api/OPS-api.md §4·5) 모양.
 * ID는 JSON 문자열, 시각은 ISO-8601 UTC다(api-rules). 서버가 `id` 또는 `{리소스}Id`로 줄 수 있어 화면 모델에서 하나로 맞춘다.
 */
export const SEVERITIES = ["CRITICAL", "MAJOR", "MINOR", "WARNING", "INFO"] as const;
export type Severity = (typeof SEVERITIES)[number];

/** 정책 수신자 종류(core API-RUL-21 PolicyService: USER·ROLE·ON_CALL만 받는다. CHANNEL_DEFAULT는 시스템 알림 전용이라 정책에 쓰지 않는다) */
export const RECIPIENT_TYPES = ["USER", "ROLE", "ON_CALL"] as const;
export type RecipientType = (typeof RECIPIENT_TYPES)[number];

export interface Recipient {
  type: RecipientType;
  id?: string | null;
  /** 화면 표시용(서버가 주면) */
  name?: string | null;
}

export interface TimeWindow {
  /** 1~7, 월=1 */
  days: number[];
  /** HH:mm */
  from: string;
  to: string;
}

export interface PolicyStep {
  stepNo: number;
  waitMinutes: number;
  recipients: Recipient[];
}

/** API-RUL-21 상세 */
export interface NotificationPolicy {
  notificationPolicyId: string;
  name: string;
  minSeverity: Severity;
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
  version: number;
  createdAt?: string;
  updatedAt?: string;
}

/** API-RUL-21 목록 행 */
export interface PolicyRow {
  notificationPolicyId: string;
  name: string;
  minSeverity: Severity;
  spaceId: string | null;
  channels: string[];
  recipientCount: number;
  stepCount: number;
  updatedAt?: string;
}

/** API-RUL-22 템플릿 */
export interface NotificationTemplate {
  notificationTemplateId: string;
  templateKey: string;
  channel: string;
  locale: string;
  subject: string | null;
  body: string;
  builtin: boolean;
  /** 조직이 고친 행(기본값으로 되돌리기 가능) */
  customized: boolean;
  version: number;
  updatedAt?: string;
}

export interface TemplateVariable {
  name: string;
  description?: string;
}

/** API-RUL-26 당직 */
export interface OnCallShift {
  dayOfWeek: number;
  from: string;
  to: string;
  userId: string;
  userName?: string | null;
}

export interface OnCallOverride {
  overrideId: string;
  startsAt: string;
  endsAt: string;
  originalUserId: string | null;
  originalUserName?: string | null;
  substituteUserId: string;
  substituteUserName?: string | null;
}

export interface OnCallSchedule {
  name: string;
  timezone: string;
  shifts: OnCallShift[];
  overrides: OnCallOverride[];
  version: number;
}

export interface OnCallCurrent {
  userId: string | null;
  name: string | null;
  until: string | null;
  /** 대체 근무로 정해진 당직자 */
  substitute: boolean;
}

/** API-OPS-23 유지보수 */
export type MaintenanceStatus = "SCHEDULED" | "ACTIVE" | "ENDED" | "CANCELED";
export interface MaintenanceWindow {
  id: string;
  targetType: "SPACE" | "DEVICE";
  targetId: string;
  targetName?: string | null;
  startsAt: string | null;
  endsAt: string | null;
  pauseAutomation: boolean;
  excludeFromAnalytics: boolean;
  reason: string;
  status: MaintenanceStatus;
  /** core는 만든 사람의 사용자 ID(문자열)만 준다. 이름은 화면이 회원 목록에서 찾는다 */
  createdBy?: { userId: string; name: string } | null;
  version?: number;
}

/** API-OPS-34 채널 유형(채널 SPI) */
export interface ChannelType {
  key: string;
  /** action 채널 SPI 목록에는 없다(core 기본 목록에만). 화면 모델에서 채운다 */
  displayName: string;
  available: boolean;
  configSchema: JsonSchema | null;
  /** core 기본 목록(action 무응답)의 비밀값 스키마. 속성은 모두 비밀값 필드 */
  secretSchema?: JsonSchema | null;
  capabilities?: { buttons?: boolean; formats?: string[]; maxBodyLength?: number; defaultRatePerMin?: number; callbackResponseLimitSec?: number } | null;
}

/** API-OPS-30 채널 */
export interface NotificationChannel {
  id: string;
  name: string;
  type: string;
  config: Record<string, unknown>;
  secretConfigured: boolean | string;
  rateLimitPerMin: number;
  digestWindowSec: number;
  enabled: boolean;
  status: "OK" | "DEGRADED" | "FAILING";
  version: number;
  updatedAt?: string;
}

/** API-RUL-27 발송 이력(커서 목록, action DeliveryView 그대로) */
export interface Delivery {
  deliveryId: string;
  alarmId?: string | null;
  /** 웹 알림은 null */
  channelId?: string | null;
  channel: string;
  recipient: string;
  status: "PENDING" | "RETRYING" | "SENT" | "FAILED" | "SKIPPED" | "DIGESTED";
  skipReason?: string | null;
  attempts: number;
  lastError?: string | null;
  sentAt?: string | null;
  createdAt?: string | null;
  digestCount?: number;
  stepNo?: number | null;
}

/** JSON Schema(2020-12) 중 채널 설정 화면이 그리는 부분 */
export interface JsonSchema {
  type?: string | string[];
  title?: string;
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  default?: unknown;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  pattern?: string;
  writeOnly?: boolean;
  format?: string;
  "x-secret"?: boolean;
  "x-widget"?: string;
}

/** 서버가 `id`나 `{리소스}Id`로 줄 수 있는 ID를 문자열 하나로 */
export function idOf(row: Record<string, unknown>, ...keys: string[]): string {
  for (const key of [...keys, "id"]) {
    const value = row[key];
    if (value !== undefined && value !== null && value !== "") return String(value);
  }
  return "";
}

/** 목록 응답이 배열이든 `{responses}`든 배열로 */
export function rowsOf<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  const wrapped = value as { responses?: T[] } | null | undefined;
  return wrapped?.responses ?? [];
}
