/**
 * 알림 정책·템플릿·당직·채널·유지보수·수신 설정 가짜 API. core M4 실제 계약(data2flow-core-api NotifyController·MaintenanceController,
 * NotifyDtos·MaintenanceDtos, 발송 이력은 action DeliveryView)을 그대로 흉내 낸다(API-RUL-21·22·26·27·30, API-OPS-20~23·30~34).
 * 상태는 core.extra["notify"]. 테스트는 `notifyState(core)`로 상황(사용 중인 정책·채널, 실패할 테스트 발송)을 바꾼다.
 */
import { HttpResponse } from "msw";
import { envelope } from "../fake-gateway";
import { fail, list, noContent, ok, type CoreHandler, type CoreState } from "../core-fixtures";

/** 페이징하지 않는 작은 목록(core ItemsResponse `{header, responses, totalCount}`) */
function items<T>(rows: T[]) {
  return HttpResponse.json({ ...envelope(), responses: rows, totalCount: rows.length });
}

const USER_NAMES: Record<string, string> = { "1": "홍길동", "7": "김운영", "8": "이통합", "9": "조회자", "10": "박분석" };
const invalidField = (field: string, code: string) => fail(400, "INVALID_REQUEST", { errors: [{ field, code, message: `${field} ${code}` }] });

interface Policy {
  notificationPolicyId: string;
  name: string;
  minSeverity: string;
  spaceId: string | null;
  includeChildren: boolean;
  ruleIds: string[];
  timeWindow: unknown;
  recipients: { type: string; id?: string }[];
  channels: string[];
  templates: Record<string, string>;
  renotifyMinutes: number;
  aggregateWindowSec: number;
  notifyOnClear: boolean;
  steps: { stepNo: number; waitMinutes: number; recipients: unknown[] }[];
  version: number;
  createdAt: string;
  updatedAt: string;
}

interface Template {
  notificationTemplateId: string;
  key: string;
  channel: string;
  locale: string;
  subject: string | null;
  body: string;
  defaultBody: string;
  builtin: boolean;
  customized: boolean;
  version: number;
  updatedAt: string;
}

interface Channel {
  id: string;
  name: string;
  type: string;
  config: Record<string, unknown>;
  secret: Record<string, string>;
  rateLimitPerMin: number;
  digestWindowSec: number;
  enabled: boolean;
  status: "OK" | "DEGRADED" | "FAILING";
  version: number;
  updatedAt: string;
}

interface Maintenance {
  id: string;
  targetType: string;
  targetId: string;
  targetName: string;
  startsAt: string | null;
  endsAt: string | null;
  pauseAutomation: boolean;
  excludeFromAnalytics: boolean;
  reason: string;
  status: "SCHEDULED" | "ACTIVE" | "ENDED" | "CANCELED";
  /** core MaintenanceDtos.Window: 사용자 ID 문자열 */
  createdBy: string;
  version: number;
  createdAt: string;
}

export interface NotifyState {
  policies: Policy[];
  /** 정책 ID → 쓰는 규칙 수(삭제 거부 POLICY_IN_USE) */
  policyUsage: Record<string, number>;
  templates: Template[];
  onCall: { name: string; timezone: string; shifts: { dayOfWeek: number; from: string; to: string; userId: string; userName?: string }[]; version: number };
  overrides: { overrideId: string; startsAt: string; endsAt: string; originalUserId: string | null; substituteUserId: string; substituteUserName?: string }[];
  current: { userId: string | null; name: string | null; until: string | null; substitute: boolean };
  channels: Channel[];
  /** 채널 ID → 쓰는 정책 수(CHANNEL_IN_USE) */
  channelUsage: Record<string, number>;
  /** true면 테스트 발송이 502 CHANNEL_TEST_FAILED(원인 401 Unauthorized) */
  testFails: boolean;
  /** action 채널 SPI 목록(API-OPS-34 원천). null이면 action이 응답하지 않을 때 core가 주는 기본 목록 */
  channelTypes: unknown[] | null;
  deliveries: { deliveryId: string; alarmId: string | null; channelId: string | null; channel: string; recipient: string; status: string; skipReason?: string | null; attempts: number; lastError?: string | null; sentAt: string | null; createdAt: string; digestCount: number; stepNo: number | null }[];
  maintenance: Maintenance[];
  /** 사용자 ID → API-RUL-30 수신 설정(없으면 core 기본값) */
  prefs: Record<string, { channels: string[]; minSeverity: string; dndFrom: string | null; dndTo: string | null; dndAllowCritical: boolean; locale: string; version: number }>;
  /** 사용자 ID → 연결된 메신저 */
  links: Record<string, { channel: string; externalUserId: string; linkedAt: string }[]>;
  /** false면 수신 설정 조회가 503(core 장애)으로 화면 대체 문구를 시험 */
  prefsApi: boolean;
}

const NOW = "2026-10-04T00:00:00Z";
/** action 발송 ID는 UUID다(다시 보내기는 UUID가 아니면 404 DELIVERY_NOT_FOUND) */
export const DELIVERY_SENT = "0f6d3c1e-0000-4000-8000-000000000001";
export const DELIVERY_FAILED = "0f6d3c1e-0000-4000-8000-000000000002";
/** action TelegramChannel.configSchema 그대로(비밀값 botToken·webhookSecret은 스키마에 없다) */
const TELEGRAM_SCHEMA = {
  type: "object",
  required: ["chatIds"],
  additionalProperties: false,
  properties: {
    chatIds: { type: "array", minItems: 1, items: { type: "string", pattern: "^-?[0-9]+$" }, title: "기본 채팅방 chat_id" },
    botUsername: { type: "string", pattern: "^[A-Za-z0-9_]{5,32}$", title: "봇 사용자 이름(계정 연결 딥링크)" },
    parseMode: { enum: ["MarkdownV2", "PLAIN"], default: "MarkdownV2", title: "메시지 형식" },
  },
};

/** core ChannelService.builtinTypes(action 무응답일 때) */
const CORE_BUILTIN_TYPES = [
  {
    key: "TELEGRAM",
    displayName: "Telegram",
    available: true,
    configSchema: { type: "object", required: ["chatIds"], properties: { chatIds: { type: "array", minItems: 1, title: "기본 대화방 chat_id" }, parseMode: { type: "string", enum: ["MarkdownV2", "HTML", "PLAIN"] } } },
    secretSchema: { type: "object", required: ["botToken"], properties: { botToken: { type: "string" }, webhookSecret: { type: "string" } } },
    capabilities: { buttons: true, maxLength: 4096, defaultRatePerMin: 20 },
  },
  ...["EMAIL", "SLACK", "KAKAO_ALIMTALK", "SMS", "WEBHOOK"].map((key) => ({ key, displayName: key, available: false, configSchema: { type: "object" }, capabilities: {} })),
];

export function notifyState(core: CoreState): NotifyState {
  core.extra.notify ??= {
    policies: [
      {
        notificationPolicyId: "41",
        name: "시설팀 기본",
        minSeverity: "MAJOR",
        spaceId: "2",
        includeChildren: true,
        ruleIds: [],
        timeWindow: null,
        recipients: [
          { type: "ROLE", id: "OPERATOR" },
          { type: "ON_CALL" },
        ],
        channels: ["WEB", "TELEGRAM"],
        templates: {},
        renotifyMinutes: 30,
        aggregateWindowSec: 120,
        notifyOnClear: true,
        steps: [{ stepNo: 1, waitMinutes: 10, recipients: [{ type: "USER", id: "1" }] }],
        version: 3,
        createdAt: "2026-10-01T00:00:00Z",
        updatedAt: "2026-10-02T00:00:00Z",
      },
    ],
    policyUsage: { "41": 2 },
    templates: [
      { notificationTemplateId: "71", key: "alarm.raised", channel: "TELEGRAM", locale: "ko", subject: null, body: "[{{alarm.severity}}] {{alarm.title}}\n{{space.path}} {{value}}\n{{link}}", defaultBody: "[{{alarm.severity}}] {{alarm.title}}\n{{link}}", builtin: true, customized: false, version: 1, updatedAt: NOW },
      { notificationTemplateId: "72", key: "alarm.raised", channel: "TELEGRAM", locale: "en", subject: null, body: "[{{alarm.severity}}] {{alarm.title}}", defaultBody: "[{{alarm.severity}}] {{alarm.title}}", builtin: true, customized: false, version: 1, updatedAt: NOW },
      { notificationTemplateId: "73", key: "alarm.raised", channel: "WEB", locale: "ko", subject: "{{alarm.title}}", body: "{{space.path}}", defaultBody: "{{space.path}}", builtin: true, customized: false, version: 1, updatedAt: NOW },
    ],
    onCall: {
      name: "시설팀 당직",
      timezone: "Asia/Seoul",
      shifts: [
        { dayOfWeek: 1, from: "09:00", to: "18:00", userId: "7", userName: "김운영" },
        { dayOfWeek: 1, from: "18:00", to: "09:00", userId: "8", userName: "이통합" },
      ],
      version: 2,
    },
    overrides: [{ overrideId: "91", startsAt: "2026-10-03T09:00:00Z", endsAt: "2026-10-04T00:00:00Z", originalUserId: "8", substituteUserId: "1", substituteUserName: "홍길동" }],
    current: { userId: "8", name: "이통합", until: "2026-10-04T00:00:00Z", substitute: false },
    channels: [{ id: "51", name: "시설팀 텔레그램", type: "TELEGRAM", config: { chatIds: ["-1001234567890", "42"], botUsername: "data2flow_bot" }, secret: { botToken: "123456789:AAH-abcdefghijklmnopqrstuvwxyz", webhookSecret: "hook-secret" }, rateLimitPerMin: 20, digestWindowSec: 60, enabled: true, status: "OK", version: 1, updatedAt: NOW }],
    channelUsage: { "51": 3 },
    testFails: false,
    // action ChannelAdminService.types(): 등록된 SPI만(지금은 TELEGRAM), displayName 없음
    channelTypes: [{ key: "TELEGRAM", available: true, configSchema: TELEGRAM_SCHEMA, capabilities: { buttons: true, formats: ["PLAIN", "MARKDOWN_V2"], maxBodyLength: 4000, defaultRatePerMin: 20, callbackResponseLimitSec: 15 } }],
    deliveries: [
      { deliveryId: DELIVERY_SENT, alarmId: "501", channelId: "51", channel: "TELEGRAM", recipient: "-1001234567890", status: "SENT", skipReason: null, attempts: 1, lastError: null, sentAt: "2026-10-03T23:00:00Z", createdAt: "2026-10-03T23:00:00Z", digestCount: 0, stepNo: null },
      { deliveryId: DELIVERY_FAILED, alarmId: "502", channelId: "51", channel: "TELEGRAM", recipient: "42", status: "FAILED", skipReason: null, attempts: 5, lastError: "429 Too Many Requests", sentAt: null, createdAt: "2026-10-03T23:10:00Z", digestCount: 0, stepNo: null },
    ],
    maintenance: [
      { id: "61", targetType: "SPACE", targetId: "31", targetName: "본관 › 3층 › 실습실", startsAt: "2026-10-03T23:00:00Z", endsAt: "2026-10-04T09:00:00Z", pauseAutomation: true, excludeFromAnalytics: true, reason: "에어컨 필터 교체", status: "ACTIVE", createdBy: "7", version: 1, createdAt: "2026-10-03T23:00:00Z" },
      { id: "62", targetType: "SPACE", targetId: "32", targetName: "본관 › 3층 › 사무실", startsAt: "2026-10-05T00:00:00Z", endsAt: "2026-10-05T03:00:00Z", pauseAutomation: false, excludeFromAnalytics: true, reason: "도색", status: "SCHEDULED", createdBy: "1", version: 1, createdAt: "2026-10-03T00:00:00Z" },
    ],
    prefs: {},
    links: {},
    prefsApi: true,
  } satisfies NotifyState;
  return core.extra.notify as NotifyState;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const SEVERITY_LIST = ["CRITICAL", "MAJOR", "MINOR", "WARNING", "INFO"];
const KNOWN_VARIABLES = ["alarm.severity", "alarm.title", "alarm.id", "alarm.status", "device.name", "space.path", "space.name", "value", "threshold", "metric", "rule.name", "link", "occurredAt", "occurrenceCount"];

/** TC-OPS-057: core는 action 결과가 실패면 502 CHANNEL_TEST_FAILED(원인은 resultMessage)만 준다 */
function testFailed() {
  return Response.json({ header: { isSuccessful: false, resultCode: "CHANNEL_TEST_FAILED", resultMessage: "401 Unauthorized" } }, { status: 502 });
}

/** core NotifyDtos.Channel: 비밀값은 `secretConfigured`(참거짓)와 가린 `secret: "***"`만 */
function channelView(c: Channel) {
  const { secret, ...rest } = c;
  const configured = Object.keys(secret).length > 0;
  return { ...rest, secretConfigured: configured, ...(configured ? { secret: "***" } : {}) };
}

function templateView(t: Template) {
  const { defaultBody: _d, ...rest } = t;
  void _d;
  return rest;
}

/** core Recipient(JsonInclude NON_NULL): ON_CALL은 id 없음, ROLE은 대문자 */
function recipients(raw: unknown): { type: string; id?: string }[] | "invalid" {
  const out: { type: string; id?: string }[] = [];
  for (const r of (raw as { type?: string; id?: string | null }[] | undefined) ?? []) {
    const type = String(r.type ?? "").toUpperCase();
    if (type === "ON_CALL") out.push({ type });
    else if ((type === "USER" || type === "ROLE") && r.id) out.push({ type, id: type === "ROLE" ? String(r.id).toUpperCase() : String(r.id) });
    else return "invalid";
  }
  return out;
}

function onCallView(s: NotifyState) {
  return {
    scheduleId: "1",
    name: s.onCall.name,
    timezone: s.onCall.timezone,
    shifts: s.onCall.shifts,
    overrides: s.overrides.map((o) => ({ overrideId: o.overrideId, startsAt: o.startsAt, endsAt: o.endsAt, originalUser: { userId: o.originalUserId, name: USER_NAMES[o.originalUserId ?? ""] }, substituteUser: { userId: o.substituteUserId, name: o.substituteUserName ?? USER_NAMES[o.substituteUserId] } })),
    version: s.onCall.version,
  };
}

function prefsView(s: NotifyState, userId: string) {
  const p = s.prefs[userId] ?? { channels: ["WEB", "TELEGRAM"], minSeverity: "INFO", dndFrom: null, dndTo: null, dndAllowCritical: true, locale: "ko", version: 0 };
  return { ...p, links: s.links[userId] ?? [] };
}

export const notifyHandler: CoreHandler = (core, { method, path, url, body, user, can }) => {
  const s = notifyState(core);
  const b = (body ?? {}) as Record<string, unknown>;

  // API-RUL-21 알림 정책(조회 RULE_READ, 쓰기 NOTIFY_POLICY_WRITE)
  if (path === "/notification-policies" || path.startsWith("/notification-policies/")) {
    if (method === "GET" && !can("RULE_READ")) return fail(403, "PERMISSION_DENIED");
    if (method !== "GET" && !can("NOTIFY_POLICY_WRITE")) return fail(403, "PERMISSION_DENIED");
    const configured = new Set(["WEB", ...s.channels.filter((c) => c.enabled).map((c) => c.type)]);
    const parse = (selfId?: string): Partial<Policy> | Response => {
      if (!String(b.name ?? "").trim()) return invalidField("name", "Size");
      if (s.policies.some((p) => p.name === String(b.name).trim() && p.notificationPolicyId !== selfId)) return invalidField("name", "Duplicated");
      if (!SEVERITY_LIST.includes(String(b.minSeverity))) return invalidField("minSeverity", "Pattern");
      const main = recipients(b.recipients);
      if (main === "invalid") return invalidField("recipients", "Pattern");
      if (!main.length) return invalidField("recipients", "NotEmpty");
      const chs = ((b.channels as string[]) ?? []).map((c) => c.toUpperCase());
      if (!chs.length) return invalidField("channels", "NotEmpty");
      const missing = chs.find((c) => !configured.has(c));
      if (missing) return fail(409, "CHANNEL_NOT_CONFIGURED", { errors: [{ field: "channels", code: "NOT_CONFIGURED", message: `${missing} 채널이 설정되지 않았습니다` }] });
      const renotify = Number(b.renotifyMinutes ?? 30);
      if (renotify < 10 || renotify > 1440) return invalidField("renotifyMinutes", "Range");
      const steps = (b.steps as { stepNo?: number; waitMinutes: number; recipients: unknown }[]) ?? [];
      if (steps.length > 3) return invalidField("steps", "Range");
      const parsedSteps: Policy["steps"] = [];
      for (const [i, step] of steps.entries()) {
        const r = recipients(step.recipients);
        if (r === "invalid" || !r.length) return invalidField(`steps[${i}].recipients`, "NotEmpty");
        parsedSteps.push({ stepNo: i + 1, waitMinutes: step.waitMinutes, recipients: r });
      }
      return {
        name: String(b.name).trim(),
        minSeverity: String(b.minSeverity),
        spaceId: (b.spaceId as string | null) ?? null,
        includeChildren: b.includeChildren !== false,
        ruleIds: (b.ruleIds as string[]) ?? [],
        timeWindow: b.timeWindow && Object.keys(b.timeWindow as object).length ? b.timeWindow : null,
        recipients: main as Policy["recipients"],
        channels: chs,
        templates: (b.templates as Record<string, string>) ?? {},
        renotifyMinutes: renotify,
        aggregateWindowSec: Number(b.aggregateWindowSec ?? 0),
        notifyOnClear: b.notifyOnClear !== false,
        steps: parsedSteps,
      };
    };
    if (path === "/notification-policies" && method === "GET") {
      return list(
        s.policies.map((p) => ({ notificationPolicyId: p.notificationPolicyId, name: p.name, minSeverity: p.minSeverity, spaceId: p.spaceId, channels: p.channels, recipientCount: p.recipients.length, stepCount: p.steps.length, updatedAt: p.updatedAt })),
        url,
      );
    }
    if (path === "/notification-policies" && method === "POST") {
      const parsed = parse();
      if (parsed instanceof Response) return parsed;
      const created = { ...(parsed as Policy), notificationPolicyId: String(++core.seq), version: 0, createdAt: NOW, updatedAt: NOW };
      s.policies.push(created);
      return ok(created, 201, { Location: `/api/v1/core/notification-policies/${created.notificationPolicyId}` });
    }
    const id = path.split("/")[2];
    const policy = s.policies.find((p) => p.notificationPolicyId === id);
    if (!policy) return fail(404, "POLICY_NOT_FOUND");
    if (method === "GET") return ok(policy);
    if (method === "PUT") {
      if (b.baseVersion === undefined || b.baseVersion === null) return invalidField("baseVersion", "NotNull");
      const parsed = parse(id);
      if (parsed instanceof Response) return parsed;
      if (b.baseVersion !== policy.version) return fail(409, "VERSION_CONFLICT");
      Object.assign(policy, parsed, { version: policy.version + 1, updatedAt: NOW });
      return ok(policy);
    }
    if (method === "DELETE") {
      if (s.policyUsage[id]) return fail(409, "POLICY_IN_USE");
      s.policies = s.policies.filter((p) => p !== policy);
      return noContent();
    }
  }

  // API-RUL-22 템플릿(목록·변수 RULE_READ, 수정·미리 보기·되돌리기 NOTIFY_POLICY_WRITE). 목록은 ItemsResponse
  if (path === "/notification-templates/variables" && method === "GET") {
    if (!can("RULE_READ")) return fail(403, "PERMISSION_DENIED");
    return items(KNOWN_VARIABLES.map((name) => ({ name, description: null })));
  }
  if (path === "/notification-templates" && method === "GET") {
    if (!can("RULE_READ")) return fail(403, "PERMISSION_DENIED");
    const channel = url.searchParams.get("channel")?.toUpperCase();
    const locale = url.searchParams.get("locale")?.toLowerCase();
    return items(s.templates.filter((t) => (!channel || t.channel === channel) && (!locale || t.locale === locale)).map(templateView));
  }
  const template = /^\/notification-templates\/(\d+)(\/preview|\/reset)?$/.exec(path);
  if (template) {
    if (!can("NOTIFY_POLICY_WRITE")) return fail(403, "PERMISSION_DENIED");
    const t = s.templates.find((x) => x.notificationTemplateId === template[1]);
    if (!t) return fail(404, "RESOURCE_NOT_FOUND");
    if (template[2] === "/preview" && method === "POST") {
      if (!b.alarmId) return invalidField("alarmId", "NotNull");
      const fill = (text: string) => text.replace(/\{\{\s*alarm\.severity\s*\}\}/g, "MAJOR").replace(/\{\{\s*alarm\.title\s*\}\}/g, "실습실 CO2 높음").replace(/\{\{\s*space\.path\s*\}\}/g, "본관 › 3층 › 실습실").replace(/\{\{\s*value\s*\}\}/g, "1520").replace(/\{\{\s*link\s*\}\}/g, `https://data2flow.java21.net/alarms/${String(b.alarmId)}`);
      return ok({ ...(t.subject ? { subject: fill(t.subject) } : {}), body: fill(t.body) });
    }
    if (template[2] === "/reset" && method === "POST") {
      Object.assign(t, { body: t.defaultBody, builtin: true, customized: false, version: 1 });
      return ok(templateView(t));
    }
    if (!template[2] && method === "PUT") {
      const text = String(b.body ?? "");
      if (!text.trim() || (t.channel !== "WEB" && text.length > 4000)) return invalidField("body", "Size");
      if (t.customized && b.baseVersion !== t.version) return fail(409, "VERSION_CONFLICT");
      Object.assign(t, { subject: (b.subject as string | null) ?? null, body: text, version: t.customized ? t.version + 1 : 1, builtin: false, customized: true });
      const unknown = [...text.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1]).filter((n) => !KNOWN_VARIABLES.includes(n));
      const saved = { template: templateView(t), warnings: unknown.map((name) => ({ code: "TEMPLATE_VARIABLE_UNKNOWN", name })) };
      if (!unknown.length) return ok(saved);
      return HttpResponse.json({ header: { isSuccessful: true, resultCode: "TEMPLATE_VARIABLE_UNKNOWN", resultMessage: `알 수 없는 변수: ${unknown.join(", ")}` }, response: saved });
    }
  }

  // API-RUL-26 당직(조회 ALARM_READ, 쓰기 NOTIFY_POLICY_WRITE). 쓰기 응답은 근무표 전체
  if (path.startsWith("/on-call")) {
    if (method === "GET" && !can("ALARM_READ")) return fail(403, "PERMISSION_DENIED");
    if (method !== "GET" && !can("NOTIFY_POLICY_WRITE")) return fail(403, "PERMISSION_DENIED");
    if (path === "/on-call" && method === "GET") return ok(onCallView(s));
    if (path === "/on-call/current" && method === "GET") return ok(s.current);
    if (path === "/on-call" && method === "PUT") {
      const shifts = (b.shifts as { dayOfWeek: number; from: string; to: string; userId: string }[]) ?? [];
      const badShift = shifts.findIndex((x) => !HHMM.test(x.from) || !HHMM.test(x.to));
      if (badShift >= 0) return invalidField(`shifts[${badShift}]`, "Pattern");
      if (Number(b.baseVersion ?? 0) !== s.onCall.version) return fail(409, "VERSION_CONFLICT");
      s.onCall = { name: String(b.name ?? "당직"), timezone: String(b.timezone ?? "Asia/Seoul"), shifts: shifts.map((x) => ({ ...x, userName: USER_NAMES[x.userId] })), version: s.onCall.version + 1 };
      return ok(onCallView(s));
    }
    if (path === "/on-call/overrides" && method === "POST") {
      const starts = Date.parse(String(b.startsAt ?? ""));
      const ends = Date.parse(String(b.endsAt ?? ""));
      if (Number.isNaN(starts) || Number.isNaN(ends)) return invalidField("startsAt", "Pattern");
      if (ends <= starts) return invalidField("endsAt", "Range");
      if (!b.originalUserId) return invalidField("originalUserId", "Pattern");
      if (!b.substituteUserId) return invalidField("substituteUserId", "Pattern");
      s.overrides.push({ overrideId: String(++core.seq), startsAt: String(b.startsAt), endsAt: String(b.endsAt), originalUserId: String(b.originalUserId), substituteUserId: String(b.substituteUserId) });
      return ok(onCallView(s), 201);
    }
    const override = /^\/on-call\/overrides\/([^/]+)$/.exec(path);
    if (override && method === "DELETE") {
      if (!s.overrides.some((o) => o.overrideId === override[1])) return fail(404, "RESOURCE_NOT_FOUND");
      s.overrides = s.overrides.filter((o) => o.overrideId !== override[1]);
      return noContent();
    }
  }

  // API-OPS-34 채널 유형, API-OPS-30·31 채널(NOTIFY_CHANNEL_MANAGE). 목록은 ItemsResponse
  if (path === "/notification-channel-types" && method === "GET") {
    if (!can("NOTIFY_CHANNEL_MANAGE")) return fail(403, "PERMISSION_DENIED");
    return items(s.channelTypes ?? CORE_BUILTIN_TYPES);
  }
  if (path === "/notification-channels" || path.startsWith("/notification-channels/")) {
    if (!can("NOTIFY_CHANNEL_MANAGE")) return fail(403, "PERMISSION_DENIED");
    const types = (s.channelTypes ?? CORE_BUILTIN_TYPES) as { key: string; available: boolean; configSchema?: { required?: string[] } }[];
    const typeOf = (type: unknown) => types.find((x) => x.key === type && x.available);
    const check = (type: unknown): Response | undefined => {
      const def = typeOf(type);
      if (!def) return invalidField("type", "Pattern");
      if (!String(b.name ?? "").trim()) return invalidField("name", "Size");
      const config = (b.config as Record<string, unknown>) ?? {};
      for (const req of def.configSchema?.required ?? []) {
        const v = config[req];
        if (v === undefined || v === null || (Array.isArray(v) && !v.length)) return fail(400, "SETTING_INVALID", { errors: [{ field: `config.${req}`, code: "NotNull", message: req }] });
      }
      return undefined;
    };
    if (path === "/notification-channels" && method === "GET") return items(s.channels.map(channelView));
    if (path === "/notification-channels/test-draft" && method === "POST") {
      const problem = check(b.type);
      if (problem) return problem;
      if (s.testFails) return testFailed();
      return ok({ ok: true, latencyMs: 812, providerResponse: "200 OK" });
    }
    if (path === "/notification-channels" && method === "POST") {
      const problem = check(b.type);
      if (problem) return problem;
      const created: Channel = { id: String(++core.seq), name: String(b.name), type: String(b.type), config: (b.config as Record<string, unknown>) ?? {}, secret: (b.secret as Record<string, string>) ?? {}, rateLimitPerMin: Number(b.rateLimitPerMin ?? 20), digestWindowSec: Number(b.digestWindowSec ?? 60), enabled: b.enabled !== false, status: "OK", version: 1, updatedAt: NOW };
      s.channels.push(created);
      return ok(channelView(created), 201, { Location: `/api/v1/core/notification-channels/${created.id}` });
    }
    const m = /^\/notification-channels\/(\d+)(\/test)?$/.exec(path);
    const channel = m ? s.channels.find((c) => c.id === m[1]) : undefined;
    if (!channel) return fail(404, "CHANNEL_NOT_FOUND");
    if (m?.[2] === "/test" && method === "POST") {
      if (s.testFails) return testFailed();
      return ok({ ok: true, latencyMs: 812, providerResponse: "200 OK" });
    }
    if (method === "GET") return ok(channelView(channel));
    if (method === "PUT") {
      const problem = check(channel.type);
      if (problem) return problem;
      if ((b.baseVersion ?? b.version) !== channel.version) return fail(409, "VERSION_CONFLICT");
      Object.assign(channel, { name: b.name, config: b.config, rateLimitPerMin: b.rateLimitPerMin, digestWindowSec: b.digestWindowSec, enabled: b.enabled !== false, version: channel.version + 1 });
      if (b.secret) channel.secret = b.secret as Record<string, string>;
      return ok(channelView(channel));
    }
    if (method === "DELETE") {
      const others = s.channels.some((c) => c !== channel && c.type === channel.type && c.enabled);
      if (s.channelUsage[channel.id] && !others) return fail(409, "CHANNEL_IN_USE");
      s.channels = s.channels.filter((c) => c !== channel);
      return noContent();
    }
  }

  // API-RUL-27 발송 이력(action 커서 목록 그대로 `{header, size, responses, nextCursor}`), API-OPS-33 다시 보내기
  if (path === "/notification-deliveries" && method === "GET") {
    if (!can("ALARM_READ")) return fail(403, "PERMISSION_DENIED");
    const channelId = url.searchParams.get("channelId");
    const status = url.searchParams.get("status")?.toUpperCase();
    const size = Number(url.searchParams.get("size") ?? 50);
    const start = Number(url.searchParams.get("cursor") ?? 0);
    const rows = s.deliveries.filter((d) => (!channelId || d.channelId === channelId) && (!status || d.status === status));
    const page = rows.slice(start, start + size);
    const next = start + size < rows.length ? String(start + size) : null;
    return Response.json({ header: { isSuccessful: true, resultCode: "SUCCESS", resultMessage: "SUCCESS" }, size, responses: page, nextCursor: next });
  }
  const resend = /^\/notification-deliveries\/([^/]+)\/resend$/.exec(path);
  if (resend && method === "POST") {
    if (!can("NOTIFY_CHANNEL_MANAGE")) return fail(403, "PERMISSION_DENIED");
    const d = s.deliveries.find((x) => x.deliveryId === resend[1]);
    if (!d) return fail(404, "DELIVERY_NOT_FOUND");
    if (d.status === "SENT") return fail(409, "DELIVERY_NOT_RESENDABLE");
    const copy = { ...d, deliveryId: `0f6d3c1e-0000-4000-8000-${String(++core.seq).padStart(12, "0")}`, status: "PENDING", attempts: 0, lastError: null, createdAt: NOW };
    s.deliveries.unshift(copy);
    return ok({ newDeliveryId: copy.deliveryId });
  }

  // API-OPS-20~23 유지보수(조회 ALARM_READ, 쓰기 ALARM_HANDLE)
  if (path === "/maintenance-windows" && method === "GET") {
    if (!can("ALARM_READ")) return fail(403, "PERMISSION_DENIED");
    const statuses = (url.searchParams.get("status") ?? "").split(",").filter(Boolean).map((x) => x.trim().toUpperCase());
    if (statuses.some((x) => !["SCHEDULED", "ACTIVE", "ENDED", "CANCELED"].includes(x))) return invalidField("status", "Pattern");
    const targetId = url.searchParams.get("targetId");
    return list(
      s.maintenance.filter((w) => (!statuses.length || statuses.includes(w.status)) && (!targetId || w.targetId === targetId)),
      url,
    );
  }
  if (path === "/maintenance-windows" && method === "POST") {
    if (!can("ALARM_HANDLE")) return fail(403, "PERMISSION_DENIED");
    if (b.targetType !== "SPACE" && b.targetType !== "DEVICE") return invalidField("targetType", "Pattern");
    const target = b.targetType === "SPACE" ? core.spaces.find((x) => x.id === b.targetId)?.name : core.devices.find((d) => d.id === b.targetId)?.name;
    if (!target) return fail(404, "RESOURCE_NOT_FOUND");
    const start = b.startsAt ? Date.parse(String(b.startsAt)) : Date.parse(NOW);
    const end = b.endsAt ? Date.parse(String(b.endsAt)) : undefined;
    if (end !== undefined && (end <= start || end - start > 30 * 86_400_000)) return fail(400, "MAINTENANCE_RANGE_INVALID");
    if (!String(b.reason ?? "").trim()) return invalidField("reason", "Size");
    const overlap = s.maintenance.some((w) => w.targetId === b.targetId && w.targetType === b.targetType && (w.status === "ACTIVE" || w.status === "SCHEDULED"));
    if (overlap) return fail(409, "MAINTENANCE_OVERLAP");
    const created: Maintenance = { id: String(++core.seq), targetType: String(b.targetType), targetId: String(b.targetId), targetName: target, startsAt: (b.startsAt as string) ?? NOW, endsAt: (b.endsAt as string) ?? null, pauseAutomation: b.pauseAutomation !== false, excludeFromAnalytics: b.excludeFromAnalytics !== false, reason: String(b.reason).trim(), status: start > Date.parse(NOW) ? "SCHEDULED" : "ACTIVE", createdBy: user.id, version: 1, createdAt: NOW };
    s.maintenance.push(created);
    return ok({ id: created.id, status: created.status }, 201, { Location: `/api/v1/core/maintenance-windows/${created.id}` });
  }
  const mw = /^\/maintenance-windows\/([^/]+)\/(end|cancel)$/.exec(path);
  if (mw && method === "POST") {
    if (!can("ALARM_HANDLE")) return fail(403, "PERMISSION_DENIED");
    const w = s.maintenance.find((x) => x.id === mw[1]);
    if (!w) return fail(404, "RESOURCE_NOT_FOUND");
    // core: [종료]는 ACTIVE → ENDED, SCHEDULED → CANCELED. [취소]는 SCHEDULED만. 그 밖은 409 VERSION_CONFLICT
    if (mw[2] === "end" && w.status === "ACTIVE") Object.assign(w, { status: "ENDED", endsAt: NOW });
    else if (w.status === "SCHEDULED") w.status = "CANCELED";
    else return fail(409, "VERSION_CONFLICT");
    return noContent();
  }

  // API-RUL-30 내 수신 설정(채널·최소 심각도·방해 금지·언어·메신저 연결 상태). PUT은 보낸 키만 바꾼다
  if (path === "/accounts/me/notify-preferences") {
    if (!s.prefsApi) return fail(503, "SERVICE_UNAVAILABLE");
    if (method === "GET") return ok(prefsView(s, user.id));
    if (method === "PUT") {
      const { links: _links, ...current } = prefsView(s, user.id);
      void _links;
      const next = { ...current };
      if ("channels" in b) next.channels = ((b.channels as string[]) ?? []).map((c) => c.toUpperCase());
      if ("minSeverity" in b) next.minSeverity = String(b.minSeverity).toUpperCase();
      if (!SEVERITY_LIST.includes(next.minSeverity)) return invalidField("minSeverity", "Pattern");
      if ("dndFrom" in b) next.dndFrom = (b.dndFrom as string | null) || null;
      if ("dndTo" in b) next.dndTo = (b.dndTo as string | null) || null;
      if ((next.dndFrom === null) !== (next.dndTo === null)) return invalidField(next.dndFrom === null ? "dndFrom" : "dndTo", "NotNull");
      if ("dndAllowCritical" in b) next.dndAllowCritical = b.dndAllowCritical !== false;
      if ("locale" in b) next.locale = String(b.locale).toLowerCase();
      if (!["ko", "en", "ja", "zh"].includes(next.locale)) return invalidField("locale", "Pattern");
      if (b.baseVersion !== undefined && b.baseVersion !== null && b.baseVersion !== current.version) return fail(409, "VERSION_CONFLICT");
      s.prefs[user.id] = { ...next, version: current.version + 1 };
      return ok(prefsView(s, user.id));
    }
  }
  if (path === "/accounts/me/messenger-links/start" && method === "POST") {
    const channel = String(b.channel ?? "").toUpperCase();
    if (!s.channels.some((c) => c.type === channel && c.enabled)) return fail(409, "CHANNEL_NOT_CONFIGURED", { errors: [{ field: "channel", code: "NOT_CONFIGURED", message: channel }] });
    return ok({ code: "K7Q29XPAHM", deepLink: "https://t.me/data2flow_bot?start=K7Q29XPAHM", expiresAt: "2026-10-04T00:10:00Z" });
  }
  const unlink = /^\/accounts\/me\/messenger-links\/([^/]+)$/.exec(path);
  if (unlink && method === "DELETE") {
    const channel = unlink[1].toUpperCase();
    if (!(s.links[user.id] ?? []).some((l) => l.channel === channel)) return fail(404, "RESOURCE_NOT_FOUND");
    s.links[user.id] = (s.links[user.id] ?? []).filter((l) => l.channel !== channel);
    return noContent();
  }
  return undefined;
};
