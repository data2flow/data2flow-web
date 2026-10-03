/**
 * 데이터 소스(DSC) 가짜 core API — design/api/DSC-api.md 계약 모양.
 * 소스 목록·상세·생성·수정·상태 변경·삭제·복제(API-DSC-01~07·12), 지표·런타임·사용처·무시 목록(API-DSC-09·11·13·14),
 * 연결 테스트(API-DSC-57), 커넥터 카탈로그(API-DSC-55·56), 플랫폼 브로커 정보·기기 자격증명(API-DSC-20~23).
 * 연결 테스트: URL에 `badauth`가 있으면 인증 단계 실패, `quiet`이면 구독 성공·메시지 없음(부분 성공).
 */
import { fail, list, noContent, ok, type CoreHandler, type CoreState, type FakeSource } from "../core-fixtures";

interface SourcesExtra {
  ignore: Record<string, { externalId: string; reason: string; createdAt: string }[]>;
  credentials: Record<string, { id: string; type: string; username: string; status: string; expiresAt: string | null; lastUsedAt: string | null }[]>;
  rateSeries: Record<string, number[]>;
}

function extra(core: CoreState): SourcesExtra {
  if (!core.extra.sources) {
    core.extra.sources = {
      ignore: { "7": [{ externalId: "24e1240000000001", reason: "REJECTED", createdAt: "2026-10-02T00:00:00Z" }] },
      credentials: {},
      rateSeries: { "7": [9, 10, 11, 10, 9, 12, 10] },
    } satisfies SourcesExtra;
  }
  return core.extra.sources as SourcesExtra;
}

function summary(core: CoreState, s: FakeSource) {
  return {
    id: s.id,
    code: s.code,
    name: s.name,
    type: s.type,
    lifecycle: s.lifecycle,
    state: s.lifecycle === "ACTIVE" ? s.state : "DISABLED",
    stateDetail: { connectedInstances: s.runtime.filter((r) => r.state === "CONNECTED").length, totalInstances: s.runtime.length },
    lastReceivedAt: s.lastReceivedAt,
    ratePerMin: s.ratePerMin,
    decodeErrorRate1h: s.decodeErrorRate1h,
    deviceCount: core.devices.filter((d) => d.sourceId === s.id).length,
    rateSeries: extra(core).rateSeries[s.id] ?? null,
    version: s.version,
  };
}

function detail(s: FakeSource) {
  return {
    id: s.id,
    code: s.code,
    name: s.name,
    type: s.type,
    connectorKey: s.connectorKey ?? null,
    lifecycle: s.lifecycle,
    connection: s.connection,
    topics: s.topics,
    secret: s.secret,
    decoderKey: s.decoderKey,
    decoderConfig: s.decoderConfig ?? null,
    decodeScriptId: s.decodeScriptId ?? null,
    unknownDevicePolicy: s.unknownDevicePolicy,
    defaultModelId: s.defaultModelId ?? null,
    defaultSpaceId: s.defaultSpaceId ?? null,
    autoregLimitPerHour: s.autoregLimitPerHour,
    noDataAlarmAfterSec: s.noDataAlarmAfterSec,
    clientIds: s.runtime.map((r) => r.clientId).filter(Boolean),
    runtime: s.runtime.map((r) => ({ instanceId: r.instanceId, state: r.state, errorKind: r.errorKind ?? null, errorMessage: r.errorMessage ?? null, connectedSince: r.connectedSince ?? null, reportedAt: r.reportedAt ?? null })),
    version: s.version,
    updatedAt: "2026-10-03T00:00:00Z",
  };
}

const CONNECTORS = [
  { connectorKey: "mqtt", version: "5.0", name: "MQTT 3.1.1/5.0", category: "MQTT", standard: "MQTT 5.0", transports: ["tcp", "ssl", "ws", "wss"], authMethods: ["NONE", "USERPASS", "HEADER", "MTLS", "OAUTH2", "SAS", "AWS_SIGV4"], payloadFormats: ["JSON"], ackMode: "AFTER_STORE", scaling: "DUAL_ACTIVE", supportsSend: false, enabled: true },
  { connectorKey: "sparkplug-b", version: "3.0", name: "Sparkplug B", category: "MQTT", standard: "Eclipse Tahu", transports: ["tcp", "ssl"], authMethods: ["NONE", "USERPASS", "MTLS", "HEADER", "OAUTH2"], payloadFormats: ["PROTOBUF"], ackMode: "AFTER_STORE", scaling: "SCALABLE", enabled: true },
  { connectorKey: "kafka", version: "3.7", name: "Apache Kafka", category: "QUEUE", standard: "Kafka 3", transports: ["tcp"], authMethods: ["NONE", "SASL"], ackMode: "BEFORE_STORE", scaling: "SCALABLE", enabled: true },
  { connectorKey: "bacnet-ip", version: "1", name: "BACnet/IP", category: "BUILDING", standard: "ASHRAE 135", transports: ["udp"], authMethods: [], ackMode: "AFTER_STORE", scaling: "SINGLETON", enabled: false, disabledReason: "LICENSE" },
];
const TEMPLATES = [
  { key: "academy-iot-data", name: "아카데미 iot-data(WSS)", connectorKey: "mqtt", description: "wss://iot-data.java21.net/mqtt" },
  { key: "chirpstack-v4", name: "ChirpStack v4", connectorKey: "mqtt", description: "application/+/device/+/event/up" },
];

function testResult(body: Record<string, unknown>) {
  const url = String((body.connection as Record<string, unknown> | undefined)?.url ?? "");
  const ok = [
    { name: "DNS", status: "OK", ms: 12, detail: "iot-data.java21.net → 220.67.216.13" },
    { name: "TCP", status: "OK", ms: 18 },
    { name: "TLS", status: "OK", ms: 41, tlsChain: [{ subject: "CN=iot-data.java21.net", issuer: "Let's Encrypt R11", notAfter: "2027-01-01" }] },
  ];
  if (url.includes("badauth")) return { steps: [...ok, { name: "AUTH", status: "FAIL", ms: 22, code: "AUTH_FAILED", detail: "HTTP 401" }, { name: "SUBSCRIBE", status: "SKIPPED" }], preview: [], lossPossible: false };
  const steps = [...ok, { name: "AUTH", status: "OK", ms: 22, detail: "HTTP 101 Switching Protocols" }, { name: "SUBSCRIBE", status: "OK", ms: 9 }];
  if (url.includes("quiet")) return { steps, preview: [], lossPossible: false };
  const topics = (body.topics as { qos: number }[] | undefined) ?? [];
  return {
    steps,
    preview: [
      { at: "2026-10-04T00:00:01Z", topic: "application/1/device/24e124136d151606/event/up", size: 412, rawExcerpt: '{"deviceInfo":{"deviceName":"EM300-TH-151606"},"object":{"temperature":22.3,"humidity":43}}', decoded: { externalId: "24e124136d151606", metrics: [{ key: "temperature", value: 22.3, unit: "℃" }, { key: "humidity", value: 43, unit: "%" }] } },
    ],
    lossPossible: topics.some((t) => t.qos === 0),
  };
}

export const sourcesHandler: CoreHandler = (core, { method, path, url, body, can }) => {
  const x = extra(core);
  const read = () => (can("SRC_READ") ? undefined : fail(403, "PERMISSION_DENIED"));
  const admin = () => (can("SRC_ADMIN") ? undefined : fail(403, "PERMISSION_DENIED"));
  const b = (body ?? {}) as Record<string, unknown>;

  // 소스 설정 화면이 기본 모델 이름을 찾을 때 쓰는 모델 상세(모델 도메인 핸들러가 먼저 처리하지 않았을 때만)
  const model = /^\/device-models\/([^/]+)$/.exec(path);
  if (model && method === "GET") {
    const found = core.model(model[1]);
    return found ? ok({ ...found, deviceCount: 0 }) : fail(404, "MODEL_NOT_FOUND");
  }
  if (path === "/connectors" && method === "GET") return read() ?? ok({ connectors: CONNECTORS, templates: TEMPLATES });
  const template = /^\/connector-templates\/([^/]+)$/.exec(path);
  if (template && method === "GET") {
    const tpl = TEMPLATES.find((t) => t.key === template[1]);
    if (!tpl) return fail(404, "CONNECTOR_NOT_FOUND");
    return ok({ ...tpl, preset: { connection: { url: "wss://iot-data.java21.net:443/mqtt", auth: "HEADER", headerName: "Authorization" }, topics: [{ topic: "application/+/device/+/event/up", qos: 1 }], decoderKey: "chirpstack-v4" } });
  }
  if (path === "/platform-broker" && method === "GET") return read() ?? ok({ wssUrl: "wss://iot-data.java21.net/mqtt", auth: "BASIC", signing: "HMAC-SHA256", topicRules: ["devices/{deviceKey}/telemetry"] });

  if (path === "/sources" && method === "GET") {
    const denied = read();
    if (denied) return denied;
    const q = url.searchParams.get("q")?.toLowerCase();
    const types = url.searchParams.getAll("type");
    const lifecycles = (url.searchParams.get("lifecycle") ?? "DRAFT,ACTIVE,PAUSED").split(",");
    const items = core.sources.filter((s) => (!q || s.name.toLowerCase().includes(q) || s.code.includes(q)) && (types.length === 0 || types.includes(s.type)) && lifecycles.includes(s.lifecycle));
    return list(items.map((s) => summary(core, s)), url);
  }
  if ((path === "/sources/test" || /^\/sources\/[^/]+\/test$/.test(path)) && method === "POST") return admin() ?? ok(testResult(b));
  if (path === "/sources" && method === "POST") {
    const denied = admin();
    if (denied) return denied;
    if (core.sources.some((s) => s.code === b.code)) return fail(409, "SOURCE_CODE_DUPLICATE");
    const connection = (b.connection ?? {}) as Record<string, unknown>;
    if (connection.clientIdBase && core.sources.some((s) => s.connection.clientIdBase === connection.clientIdBase)) return fail(409, "SOURCE_CLIENT_ID_DUPLICATE");
    const secret = b.secret as { kind: string; value: string } | undefined;
    const created: FakeSource = {
      id: core.nextId(),
      code: String(b.code),
      name: String(b.name),
      type: String(b.type),
      connectorKey: b.connectorKey ? String(b.connectorKey) : undefined,
      lifecycle: b.activate ? "ACTIVE" : "DRAFT",
      state: b.activate ? "CONNECTING" : "DISABLED",
      connection,
      topics: (b.topics as { topic: string; qos: number }[] | undefined) ?? [],
      decoderKey: String(b.decoderKey ?? "chirpstack-v4"),
      decoderConfig: b.decoderConfig,
      decodeScriptId: (b.decodeScriptId as string | undefined) ?? null,
      unknownDevicePolicy: (b.unknownDevicePolicy as "AUTO_REGISTER" | "REJECT") ?? "AUTO_REGISTER",
      defaultModelId: (b.defaultModelId as string | null) ?? null,
      defaultSpaceId: (b.defaultSpaceId as string | null) ?? null,
      autoregLimitPerHour: Number(b.autoregLimitPerHour ?? 100),
      noDataAlarmAfterSec: Number(b.noDataAlarmAfterSec ?? 600),
      secret: { kind: secret?.kind ?? String(connection.auth ?? "NONE"), configured: Boolean(secret), fingerprint: secret ? `••••${secret.value.slice(-4)}` : null, rotatedAt: null },
      runtime: [],
      ratePerMin: 0,
      decodeErrorRate1h: 0,
      lastReceivedAt: null,
      version: 1,
    };
    core.sources.push(created);
    return ok(detail(created), 201, { Location: `/api/v1/core/sources/${created.id}` });
  }

  const match = /^\/sources\/([^/]+)(\/.*)?$/.exec(path);
  if (!match) return deviceCredentials(core, x, method, path, body, can);
  const source = core.sources.find((s) => s.id === match[1]);
  const sub = match[2] ?? "";
  if (!source) return read() ?? fail(404, "SOURCE_NOT_FOUND");

  if (method === "GET") {
    const denied = sub === "/live" ? admin() : read();
    if (denied) return denied;
    if (sub === "") return ok(detail(source));
    if (sub === "/runtime") return ok({ sourceId: source.id, instances: source.runtime });
    if (sub === "/stats") {
      const base = Date.parse(url.searchParams.get("to") ?? "2026-10-04T00:00:00Z");
      return ok(Array.from({ length: 6 }, (_, i) => ({ t: new Date(base - (5 - i) * 3600_000).toISOString(), received: 600, accepted: 590, decodeErrors: i === 3 ? 4 : 0, scriptErrors: 0, rejectedUnknown: 0, invalid: 1, dup: 9, reconnects: 0 })));
    }
    if (sub === "/usage") return ok({ deviceCount: core.devices.filter((d) => d.sourceId === source.id).length, flows: [{ id: "201", name: "실습실 환기" }], volume7d: [{ day: "2026-10-03", count: 14400 }, { day: "2026-10-02", count: 14100 }] });
    if (sub === "/ignore-list") return list(x.ignore[source.id] ?? [], url);
    return undefined;
  }
  const denied = admin();
  if (denied) return denied;
  const versionOk = () => Number(b.baseVersion) === source.version;
  if (method === "PATCH" && sub === "") {
    if (!versionOk()) return fail(409, "VERSION_CONFLICT");
    if (source.lifecycle === "ARCHIVED") return fail(409, "SOURCE_STATE_CONFLICT");
    const secret = b.secret as { kind: string; value: string } | undefined;
    Object.assign(source, {
      name: b.name ?? source.name,
      connection: b.connection ?? source.connection,
      topics: b.topics ?? source.topics,
      decoderKey: b.decoderKey ?? source.decoderKey,
      decoderConfig: b.decoderConfig ?? source.decoderConfig,
      unknownDevicePolicy: b.unknownDevicePolicy ?? source.unknownDevicePolicy,
      defaultModelId: b.defaultModelId === undefined ? source.defaultModelId : b.defaultModelId,
      defaultSpaceId: b.defaultSpaceId === undefined ? source.defaultSpaceId : b.defaultSpaceId,
      autoregLimitPerHour: b.autoregLimitPerHour ?? source.autoregLimitPerHour,
      noDataAlarmAfterSec: b.noDataAlarmAfterSec ?? source.noDataAlarmAfterSec,
      version: source.version + 1,
    });
    if (secret) source.secret = { kind: secret.kind, configured: true, fingerprint: `••••${secret.value.slice(-4)}`, rotatedAt: "2026-10-04T00:00:00Z" };
    return ok(detail(source));
  }
  if (method === "POST" && ["/activate", "/pause", "/resume", "/archive"].includes(sub)) {
    if (!versionOk()) return fail(409, "VERSION_CONFLICT");
    const from: Record<string, string[]> = { "/activate": ["DRAFT"], "/pause": ["ACTIVE"], "/resume": ["PAUSED"], "/archive": ["ACTIVE", "PAUSED"] };
    if (!from[sub].includes(source.lifecycle)) return fail(409, "SOURCE_STATE_CONFLICT");
    source.lifecycle = ({ "/activate": "ACTIVE", "/pause": "PAUSED", "/resume": "ACTIVE", "/archive": "ARCHIVED" } as const)[sub as "/activate"];
    source.version += 1;
    return ok({ id: source.id, lifecycle: source.lifecycle, version: source.version });
  }
  if (method === "DELETE" && sub === "") {
    if (source.lifecycle === "ACTIVE" || source.lifecycle === "PAUSED") return fail(409, "SOURCE_STATE_CONFLICT");
    if (core.devices.some((d) => d.sourceId === source.id)) return fail(409, "SOURCE_IN_USE");
    core.sources = core.sources.filter((s) => s !== source);
    return noContent();
  }
  if (method === "POST" && sub === "/clone") {
    if (core.sources.some((s) => s.code === b.code)) return fail(409, "SOURCE_CODE_DUPLICATE");
    const copy: FakeSource = { ...structuredClone(source), id: core.nextId(), code: String(b.code), name: String(b.name), lifecycle: "DRAFT", runtime: [], secret: { kind: source.secret.kind, configured: false }, version: 1 };
    core.sources.push(copy);
    return ok(detail(copy), 201);
  }
  const unignore = /^\/ignore-list\/([^/]+)$/.exec(sub);
  if (method === "DELETE" && unignore) {
    x.ignore[source.id] = (x.ignore[source.id] ?? []).filter((e) => e.externalId !== decodeURIComponent(unignore[1]));
    return noContent();
  }
  return undefined;
};

/** 기기 자격증명(API-DSC-20~22): 플랫폼 브로커 소스의 기기만 */
function deviceCredentials(core: CoreState, x: SourcesExtra, method: string, path: string, body: unknown, can: (p: string) => boolean): Response | undefined {
  const match = /^\/devices\/([^/]+)\/credentials(?:\/([^/]+)\/revoke)?$/.exec(path);
  if (!match) return undefined;
  const [, deviceId, credentialId] = match;
  const device = core.devices.find((d) => d.id === deviceId);
  if (!device) return fail(404, "DEVICE_NOT_FOUND");
  const items = (x.credentials[deviceId] ??= []);
  if (method === "GET") return can("SRC_READ") ? ok(items) : fail(403, "PERMISSION_DENIED");
  if (!can("SRC_ADMIN")) return fail(403, "PERMISSION_DENIED");
  if (method === "POST" && !credentialId) {
    if (core.source(device.sourceId)?.type !== "PLATFORM_BROKER") return fail(409, "SOURCE_STATE_CONFLICT");
    const id = core.nextId();
    const expiresAt = ((body ?? {}) as { expiresAt?: string }).expiresAt ?? null;
    items.push({ id, type: "PASSWORD", username: `dev-${device.externalId}`, status: "ACTIVE", expiresAt, lastUsedAt: null });
    return ok({ credentialId: id, username: `dev-${device.externalId}`, password: "Pw-Once-7f3a91", signingKey: "sk-once-9b2c" }, 201);
  }
  if (method === "POST" && credentialId) {
    const item = items.find((c) => c.id === credentialId);
    if (!item) return fail(404, "RESOURCE_NOT_FOUND");
    if (item.status === "REVOKED") return fail(409, "CREDENTIAL_REVOKED");
    item.status = "REVOKED";
    return ok({ id: item.id, deviceId, type: item.type, username: item.username, status: "REVOKED", revokedAt: "2026-10-04T00:00:00Z" });
  }
  return undefined;
}
