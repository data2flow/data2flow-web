/**
 * 알림 정책·템플릿·당직·채널·유지보수·수신 설정 가짜 API(design/api/RUL-api.md §3 API-RUL-21·22·26·27·30, OPS-api §4·5 API-OPS-20~23·30~34,
 * DSH-api API-DSH-26). 상태는 core.extra["notify"]. 테스트는 `notifyState(core)`로 상황(사용 중인 정책·채널, 실패할 테스트 발송)을 바꾼다.
 */
import { fail, list, noContent, ok, type CoreHandler, type CoreState } from "../core-fixtures";

interface Policy {
  notificationPolicyId: string;
  name: string;
  minSeverity: string;
  spaceId: string | null;
  includeChildren: boolean;
  ruleIds: string[];
  timeWindow: unknown;
  recipients: { type: string; id: string | null }[];
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
  templateKey: string;
  channel: string;
  locale: string;
  subject: string | null;
  body: string;
  defaultBody: string;
  builtin: boolean;
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
  createdBy: { userId: string; name: string };
  version: number;
}

export interface NotifyState {
  policies: Policy[];
  /** 정책 ID → 쓰는 규칙 수(삭제 거부 POLICY_IN_USE) */
  policyUsage: Record<string, number>;
  templates: Template[];
  onCall: { name: string; timezone: string; shifts: { dayOfWeek: number; from: string; to: string; userId: string; userName?: string }[]; version: number };
  overrides: { overrideId: string; startsAt: string; endsAt: string; originalUserId: string | null; substituteUserId: string; substituteUserName?: string }[];
  current: { userId: string | null; name: string | null; until: string | null };
  channels: Channel[];
  /** 채널 ID → 쓰는 정책 수(CHANNEL_IN_USE) */
  channelUsage: Record<string, number>;
  /** true면 테스트 발송이 502 CHANNEL_TEST_FAILED(원인 401 Unauthorized) */
  testFails: boolean;
  /** API-OPS-34 응답. null이면 404(엔드포인트 없음)로 화면 대체값을 시험 */
  channelTypes: unknown[] | null;
  deliveries: { deliveryId: string; alarmId: string | null; channelId: string; channel: string; recipient: string; status: string; skipReason?: string | null; attempts: number; lastError?: string | null; sentAt: string | null }[];
  maintenance: Maintenance[];
  /** 사용자 ID → API-DSH-26 설정 */
  pushPrefs: Record<string, { push: { alarm: boolean; workOrderAssigned: boolean; approvalRequest: boolean }; minSeverity: string; webPushSubscribed: boolean }>;
  /** 사용자 ID → API-RUL-30 방해 금지 설정 */
  dnd: Record<string, { dndFrom: string | null; dndTo: string | null; dndAllowCritical: boolean; locale: string }>;
  /** 사용자 ID → 연결된 메신저 */
  links: Record<string, { channel: string; linkedAt: string }[]>;
  /** 메신저 연결 상태 조회(문서에 없는 GET)를 지원하는지. false면 404 */
  linkStatusApi: boolean;
}

const NOW = "2026-10-04T00:00:00Z";
const TELEGRAM_SCHEMA = {
  type: "object",
  required: ["chatIds"],
  additionalProperties: false,
  properties: {
    chatIds: { type: "array", title: "chat_id", items: { type: "integer" }, minItems: 1, maxItems: 20 },
    botToken: { type: "string", writeOnly: true, pattern: "^\\d{3,20}:[A-Za-z0-9_-]{20,}$" },
    webhookSecret: { type: "string", writeOnly: true, pattern: "^[A-Za-z0-9_-]{1,256}$" },
  },
};

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
          { type: "ON_CALL", id: null },
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
      { notificationTemplateId: "71", templateKey: "alarm.raised", channel: "TELEGRAM", locale: "ko", subject: null, body: "[{{alarm.severity}}] {{alarm.title}}\n{{space.path}} {{value}}\n{{link}}", defaultBody: "[{{alarm.severity}}] {{alarm.title}}\n{{link}}", builtin: true, version: 1, updatedAt: NOW },
      { notificationTemplateId: "72", templateKey: "alarm.raised", channel: "TELEGRAM", locale: "en", subject: null, body: "[{{alarm.severity}}] {{alarm.title}}", defaultBody: "[{{alarm.severity}}] {{alarm.title}}", builtin: true, version: 1, updatedAt: NOW },
      { notificationTemplateId: "73", templateKey: "alarm.raised", channel: "WEB", locale: "ko", subject: "{{alarm.title}}", body: "{{space.path}}", defaultBody: "{{space.path}}", builtin: true, version: 1, updatedAt: NOW },
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
    current: { userId: "8", name: "이통합", until: "2026-10-04T00:00:00Z" },
    channels: [{ id: "51", name: "시설팀 텔레그램", type: "TELEGRAM", config: { chatIds: [-1001234567890, 42] }, secret: { botToken: "123456789:AAH-abcdefghijklmnopqrstuvwxyz", webhookSecret: "hook-secret" }, rateLimitPerMin: 20, digestWindowSec: 60, enabled: true, status: "OK", version: 1, updatedAt: NOW }],
    channelUsage: { "51": 3 },
    testFails: false,
    channelTypes: [
      { key: "TELEGRAM", displayName: "Telegram", available: true, configSchema: TELEGRAM_SCHEMA, capabilities: { buttons: true, formats: ["MARKDOWN_V2"], maxBodyLength: 4096, defaultRatePerMin: 20, callbackResponseLimitSec: 10 } },
      { key: "EMAIL", displayName: "Email", available: false, configSchema: null, capabilities: null },
      { key: "SLACK", displayName: "Slack", available: false, configSchema: null, capabilities: null },
      { key: "KAKAO_ALIMTALK", displayName: "KakaoTalk", available: false, configSchema: null, capabilities: null },
      { key: "SMS", displayName: "SMS", available: false, configSchema: null, capabilities: null },
      { key: "WEBHOOK", displayName: "Webhook", available: false, configSchema: null, capabilities: null },
    ],
    deliveries: [
      { deliveryId: "d-1", alarmId: "501", channelId: "51", channel: "TELEGRAM", recipient: "-1001234567890", status: "SENT", attempts: 1, lastError: null, sentAt: "2026-10-03T23:00:00Z" },
      { deliveryId: "d-2", alarmId: "502", channelId: "51", channel: "TELEGRAM", recipient: "42", status: "FAILED", attempts: 5, lastError: "429 Too Many Requests", sentAt: null },
    ],
    maintenance: [
      { id: "61", targetType: "SPACE", targetId: "31", targetName: "본관 › 3층 › 실습실", startsAt: "2026-10-03T23:00:00Z", endsAt: "2026-10-04T09:00:00Z", pauseAutomation: true, excludeFromAnalytics: true, reason: "에어컨 필터 교체", status: "ACTIVE", createdBy: { userId: "7", name: "김운영" }, version: 1 },
      { id: "62", targetType: "SPACE", targetId: "32", targetName: "본관 › 3층 › 사무실", startsAt: "2026-10-05T00:00:00Z", endsAt: "2026-10-05T03:00:00Z", pauseAutomation: false, excludeFromAnalytics: true, reason: "도색", status: "SCHEDULED", createdBy: { userId: "1", name: "홍길동" }, version: 1 },
    ],
    pushPrefs: {},
    dnd: {},
    links: {},
    linkStatusApi: true,
  } satisfies NotifyState;
  return core.extra.notify as NotifyState;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** TC-OPS-057: 502 CHANNEL_TEST_FAILED, 원인은 resultMessage에(텔레그램 401 Unauthorized) */
function testFailed() {
  return Response.json({ header: { isSuccessful: false, resultCode: "CHANNEL_TEST_FAILED", resultMessage: "401 Unauthorized" }, response: { ok: false, providerResponse: "401 Unauthorized" } }, { status: 502 });
}

function channelView(c: Channel) {
  const { secret, ...rest } = c;
  return { ...rest, secretConfigured: Object.keys(secret).length ? "***" : false };
}

export const notifyHandler: CoreHandler = (core, { method, path, url, body, user, can }) => {
  const s = notifyState(core);
  const b = (body ?? {}) as Record<string, unknown>;

  // API-RUL-21 알림 정책
  if (path === "/notification-policies" || path.startsWith("/notification-policies/")) {
    if (method === "GET" && !can("RULE_READ") && !can("NOTIFY_POLICY_WRITE")) return fail(403, "PERMISSION_DENIED");
    if (method !== "GET" && !can("NOTIFY_POLICY_WRITE")) return fail(403, "PERMISSION_DENIED");
    const configured = new Set(["WEB", ...s.channels.filter((c) => c.enabled).map((c) => c.type)]);
    const validate = () => {
      const missing = ((b.channels as string[]) ?? []).find((c) => !configured.has(c));
      if (missing) return fail(409, "CHANNEL_NOT_CONFIGURED", { errors: [{ field: "channels", code: "CHANNEL_NOT_CONFIGURED", message: `${missing}이 설정되지 않았습니다` }] });
      if (((b.steps as unknown[]) ?? []).length > 3) return fail(400, "INVALID_REQUEST", { errors: [{ field: "steps", code: "MAX", message: "최대 3단계" }] });
      return undefined;
    };
    if (path === "/notification-policies" && method === "GET") {
      return list(
        s.policies.map((p) => ({ notificationPolicyId: p.notificationPolicyId, name: p.name, minSeverity: p.minSeverity, spaceId: p.spaceId, channels: p.channels, recipientCount: p.recipients.length, stepCount: p.steps.length, updatedAt: p.updatedAt })),
        url,
      );
    }
    if (path === "/notification-policies" && method === "POST") {
      const problem = validate();
      if (problem) return problem;
      const created: Policy = { ...(b as unknown as Policy), notificationPolicyId: String(++core.seq), version: 1, createdAt: NOW, updatedAt: NOW };
      s.policies.push(created);
      return ok(created, 201, { Location: `/api/v1/core/notification-policies/${created.notificationPolicyId}` });
    }
    const id = path.split("/")[2];
    const policy = s.policies.find((p) => p.notificationPolicyId === id);
    if (!policy) return fail(404, "RESOURCE_NOT_FOUND");
    if (method === "GET") return ok(policy);
    if (method === "PUT") {
      if (b.baseVersion !== policy.version) return fail(409, "VERSION_CONFLICT");
      const problem = validate();
      if (problem) return problem;
      const { baseVersion: _ignored, ...rest } = b;
      void _ignored;
      Object.assign(policy, rest, { version: policy.version + 1, updatedAt: NOW });
      return ok(policy);
    }
    if (method === "DELETE") {
      if (s.policyUsage[id]) return fail(409, "POLICY_IN_USE");
      s.policies = s.policies.filter((p) => p !== policy);
      return noContent();
    }
  }

  // API-RUL-22 템플릿
  if (path === "/notification-templates/variables" && method === "GET") {
    return ok(["alarm.severity", "alarm.title", "device.name", "space.path", "value", "threshold", "rule.name", "link", "occurredAt"].map((name) => ({ name })));
  }
  if (path === "/notification-templates" && method === "GET") {
    const channel = url.searchParams.get("channel");
    const locale = url.searchParams.get("locale");
    return list(
      s.templates.filter((t) => (!channel || t.channel === channel) && (!locale || t.locale === locale)).map(({ defaultBody: _d, ...t }) => (void _d, t)),
      url,
    );
  }
  const template = /^\/notification-templates\/([^/]+)(\/preview|\/reset)?$/.exec(path);
  if (template) {
    if (!can("NOTIFY_POLICY_WRITE")) return fail(403, "PERMISSION_DENIED");
    const t = s.templates.find((x) => x.notificationTemplateId === template[1]);
    if (!t) return fail(404, "RESOURCE_NOT_FOUND");
    if (template[2] === "/preview" && method === "POST") {
      const fill = (text: string) => text.replace(/\{\{\s*alarm\.severity\s*\}\}/g, "MAJOR").replace(/\{\{\s*alarm\.title\s*\}\}/g, "실습실 CO2 높음").replace(/\{\{\s*space\.path\s*\}\}/g, "본관 › 3층 › 실습실").replace(/\{\{\s*value\s*\}\}/g, "1520").replace(/\{\{\s*link\s*\}\}/g, `https://data2flow.java21.net/alarms/${String(b.alarmId)}`);
      return ok({ subject: t.subject ? fill(t.subject) : null, body: fill(t.body) });
    }
    if (template[2] === "/reset" && method === "POST") {
      Object.assign(t, { body: t.defaultBody, version: t.version + 1 });
      return ok({ notificationTemplateId: t.notificationTemplateId, version: t.version });
    }
    if (!template[2] && method === "PUT") {
      if (b.baseVersion !== t.version) return fail(409, "VERSION_CONFLICT");
      Object.assign(t, { subject: (b.subject as string | null) ?? null, body: String(b.body ?? ""), version: t.version + 1, builtin: false });
      const known = new Set(["alarm.severity", "alarm.title", "device.name", "space.path", "value", "threshold", "rule.name", "link", "occurredAt"]);
      const unknown = [...String(b.body).matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1]).filter((n) => !known.has(n));
      return ok({ warnings: unknown.map((name) => ({ code: "TEMPLATE_VARIABLE_UNKNOWN", name })) });
    }
  }

  // API-RUL-26 당직
  if (path.startsWith("/on-call")) {
    if (method === "GET" && !can("ALARM_READ")) return fail(403, "PERMISSION_DENIED");
    if (method !== "GET" && !can("NOTIFY_POLICY_WRITE")) return fail(403, "PERMISSION_DENIED");
    if (path === "/on-call" && method === "GET") return ok({ ...s.onCall, overrides: s.overrides });
    if (path === "/on-call/current" && method === "GET") return ok(s.current);
    if (path === "/on-call" && method === "PUT") {
      if (b.baseVersion !== s.onCall.version) return fail(409, "VERSION_CONFLICT");
      const shifts = (b.shifts as { dayOfWeek: number; from: string; to: string; userId: string }[]) ?? [];
      if (shifts.some((x) => !HHMM.test(x.from) || !HHMM.test(x.to))) return fail(400, "INVALID_REQUEST", { errors: [{ field: "shifts", code: "FORMAT", message: "HH:mm" }] });
      s.onCall = { name: String(b.name), timezone: String(b.timezone), shifts, version: s.onCall.version + 1 };
      return ok({ ...s.onCall, overrides: s.overrides });
    }
    if (path === "/on-call/overrides" && method === "POST") {
      const created = { overrideId: String(++core.seq), startsAt: String(b.startsAt), endsAt: String(b.endsAt), originalUserId: (b.originalUserId as string) ?? null, substituteUserId: String(b.substituteUserId) };
      s.overrides.push(created);
      return ok(created, 201);
    }
    const override = /^\/on-call\/overrides\/([^/]+)$/.exec(path);
    if (override && method === "DELETE") {
      if (!s.overrides.some((o) => o.overrideId === override[1])) return fail(404, "RESOURCE_NOT_FOUND");
      s.overrides = s.overrides.filter((o) => o.overrideId !== override[1]);
      return noContent();
    }
  }

  // API-OPS-34 채널 유형, API-OPS-30·31 채널
  if (path === "/notification-channel-types" && method === "GET") {
    if (!s.channelTypes) return fail(404, "RESOURCE_NOT_FOUND");
    return ok(s.channelTypes);
  }
  if (path === "/notification-channels" || path.startsWith("/notification-channels/")) {
    if (!can("NOTIFY_CHANNEL_MANAGE")) return fail(403, "PERMISSION_DENIED");
    const known = (type: unknown) => (s.channelTypes ?? []).some((x) => (x as { key: string; available: boolean }).key === type && (x as { available: boolean }).available);
    if (path === "/notification-channels" && method === "GET") return list(s.channels.map(channelView), url);
    if (path === "/notification-channels/test-draft" && method === "POST") {
      if (s.testFails) return testFailed();
      return ok({ ok: true, latencyMs: 812, providerResponse: "200 OK" });
    }
    if (path === "/notification-channels" && method === "POST") {
      if (!known(b.type)) return fail(400, "INVALID_REQUEST");
      const created: Channel = { id: String(++core.seq), name: String(b.name), type: String(b.type), config: (b.config as Record<string, unknown>) ?? {}, secret: (b.secret as Record<string, string>) ?? {}, rateLimitPerMin: Number(b.rateLimitPerMin), digestWindowSec: Number(b.digestWindowSec), enabled: b.enabled !== false, status: "OK", version: 1, updatedAt: NOW };
      s.channels.push(created);
      return ok(channelView(created), 201);
    }
    const m = /^\/notification-channels\/([^/]+)(\/test)?$/.exec(path);
    const channel = m ? s.channels.find((c) => c.id === m[1]) : undefined;
    if (!channel) return fail(404, "CHANNEL_NOT_FOUND");
    if (m?.[2] === "/test" && method === "POST") {
      if (s.testFails) return testFailed();
      return ok({ ok: true, latencyMs: 812, providerResponse: "200 OK" });
    }
    if (method === "GET") return ok(channelView(channel));
    if (method === "PUT") {
      if (b.baseVersion !== channel.version) return fail(409, "VERSION_CONFLICT");
      Object.assign(channel, { name: b.name, config: b.config, rateLimitPerMin: b.rateLimitPerMin, digestWindowSec: b.digestWindowSec, enabled: b.enabled, version: channel.version + 1 });
      if (b.secret) channel.secret = { ...channel.secret, ...(b.secret as Record<string, string>) };
      return ok(channelView(channel));
    }
    if (method === "DELETE") {
      if (s.channelUsage[channel.id]) return fail(409, "CHANNEL_IN_USE", { response: { usage: s.channelUsage[channel.id] } });
      s.channels = s.channels.filter((c) => c !== channel);
      return noContent();
    }
  }

  // API-RUL-27 발송 이력(커서 목록), API-OPS-33 다시 보내기
  if (path === "/notification-deliveries" && method === "GET") {
    if (!can("ALARM_READ")) return fail(403, "PERMISSION_DENIED");
    const channelId = url.searchParams.get("channelId");
    const status = url.searchParams.get("status");
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
    if (!d) return fail(404, "RESOURCE_NOT_FOUND");
    if (d.status === "SENT") return fail(409, "INVALID_REQUEST");
    const copy = { ...d, deliveryId: `d-${++core.seq}`, status: "PENDING", attempts: 0, lastError: null };
    s.deliveries.unshift(copy);
    return ok({ newDeliveryId: copy.deliveryId });
  }

  // API-OPS-20~23 유지보수
  if (path === "/maintenance-windows" && method === "GET") {
    const statuses = (url.searchParams.get("status") ?? "").split(",").filter(Boolean);
    return list(
      s.maintenance.filter((w) => !statuses.length || statuses.includes(w.status)),
      url,
    );
  }
  if (path === "/maintenance-windows" && method === "POST") {
    if (!can("DEV_PLACE")) return fail(403, "PERMISSION_DENIED");
    const start = b.startsAt ? Date.parse(String(b.startsAt)) : Date.parse(NOW);
    const end = b.endsAt ? Date.parse(String(b.endsAt)) : undefined;
    if (end !== undefined && (end <= start || end - start > 30 * 86_400_000)) return fail(400, "MAINTENANCE_RANGE_INVALID");
    const overlap = s.maintenance.some((w) => w.targetId === b.targetId && w.targetType === b.targetType && (w.status === "ACTIVE" || w.status === "SCHEDULED"));
    if (overlap) return fail(409, "MAINTENANCE_OVERLAP");
    const target = b.targetType === "SPACE" ? core.spaces.find((x) => x.id === b.targetId)?.name : core.devices.find((d) => d.id === b.targetId)?.name;
    if (!target) return fail(404, "RESOURCE_NOT_FOUND");
    const created: Maintenance = { id: String(++core.seq), targetType: String(b.targetType), targetId: String(b.targetId), targetName: target, startsAt: (b.startsAt as string) ?? NOW, endsAt: (b.endsAt as string) ?? null, pauseAutomation: b.pauseAutomation !== false, excludeFromAnalytics: b.excludeFromAnalytics !== false, reason: String(b.reason), status: b.startsAt && Date.parse(String(b.startsAt)) > Date.parse(NOW) ? "SCHEDULED" : "ACTIVE", createdBy: { userId: user.id, name: user.name }, version: 1 };
    s.maintenance.push(created);
    return ok({ id: created.id, status: created.status }, 201);
  }
  const mw = /^\/maintenance-windows\/([^/]+)\/(end|cancel)$/.exec(path);
  if (mw && method === "POST") {
    if (!can("DEV_PLACE")) return fail(403, "PERMISSION_DENIED");
    const w = s.maintenance.find((x) => x.id === mw[1]);
    if (!w) return fail(404, "RESOURCE_NOT_FOUND");
    if (mw[2] === "end" ? w.status !== "ACTIVE" : w.status !== "SCHEDULED") return fail(409, "INVALID_REQUEST");
    w.status = mw[2] === "end" ? "ENDED" : "CANCELED";
    if (mw[2] === "end") w.endsAt = NOW;
    return noContent();
  }

  // API-DSH-26 받을 알림 종류·최소 심각도, API-RUL-30 방해 금지·메신저 연결
  if (path === "/accounts/me/notification-preferences") {
    s.pushPrefs[user.id] ??= { push: { alarm: true, workOrderAssigned: true, approvalRequest: true }, minSeverity: "MAJOR", webPushSubscribed: false };
    if (method === "GET") return ok(s.pushPrefs[user.id]);
    if (method === "PUT") {
      if (!["CRITICAL", "MAJOR", "MINOR", "WARNING", "INFO"].includes(String(b.minSeverity))) return fail(400, "INVALID_REQUEST", { errors: [{ field: "minSeverity", code: "ENUM", message: "?" }] });
      s.pushPrefs[user.id] = { ...s.pushPrefs[user.id], push: b.push as never, minSeverity: String(b.minSeverity) };
      return ok({ push: b.push, minSeverity: b.minSeverity });
    }
  }
  if (path === "/accounts/me/notify-preferences") {
    if (method === "GET") return s.dnd[user.id] ? ok(s.dnd[user.id]) : fail(404, "RESOURCE_NOT_FOUND");
    if (method === "PUT") {
      s.dnd[user.id] = { dndFrom: (b.dndFrom as string) ?? null, dndTo: (b.dndTo as string) ?? null, dndAllowCritical: b.dndAllowCritical === true, locale: String(b.locale) };
      return noContent();
    }
  }
  if (path === "/accounts/me/messenger-links" && method === "GET") {
    if (!s.linkStatusApi) return fail(404, "RESOURCE_NOT_FOUND");
    return ok(s.links[user.id] ?? []);
  }
  if (path === "/accounts/me/messenger-links/start" && method === "POST") {
    if (b.channel !== "TELEGRAM") return fail(400, "INVALID_REQUEST");
    return ok({ code: "K7Q2-9XPA", deepLink: "https://t.me/data2flow_bot?start=K7Q2-9XPA", expiresAt: "2026-10-04T00:10:00Z" });
  }
  const unlink = /^\/accounts\/me\/messenger-links\/([^/]+)$/.exec(path);
  if (unlink && method === "DELETE") {
    s.links[user.id] = (s.links[user.id] ?? []).filter((l) => l.channel !== unlink[1]);
    return noContent();
  }
  return undefined;
};
