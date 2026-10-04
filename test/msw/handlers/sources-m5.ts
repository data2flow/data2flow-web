/**
 * M5 데이터 소스 가짜 core API — core M5 실제 계약(ConnectorController·DataSourceController·OutputConnectionController·EdgeController) 모양.
 * 커넥터 카탈로그 22종(기본 3 + ingress 보고 19, 스키마는 ingress `connectors/*.schema.json` 그대로)·템플릿 11종(API-DSC-55·56),
 * 카탈로그 커넥터·Webhook 소스 만들기(API-DSC-02, Webhook은 issuedSecret·webhookUrl), 비밀값 종류별 교체(API-DSC-58),
 * 출력 연결(API-DSC-30~33), 엣지 게이트웨이(API-DSC-62·64·65·67). sourcesHandler보다 먼저 본다.
 */
import { fail, list, noContent, ok, type CoreHandler, type CoreState, type FakeSource } from "../core-fixtures";
import SCHEMAS from "../connector-schemas.json";
import { detail } from "./sources";

type Json = Record<string, unknown>;
const schemas = SCHEMAS as unknown as Record<string, Json & { title?: string; properties: Json }>;

const AUTH_MATRIX: Record<string, { required: string[]; optional: string[] }> = {
  NONE: { required: [], optional: ["CA_CERT"] },
  USER_PASSWORD: { required: ["PASSWORD"], optional: ["CA_CERT"] },
  USERPASS: { required: ["PASSWORD"], optional: ["CA_CERT"] },
  WS_HEADER: { required: ["HEADER_VALUE"], optional: ["CA_CERT"] },
  MTLS: { required: ["CLIENT_CERT", "CLIENT_KEY"], optional: ["CA_CERT"] },
  TOKEN: { required: [], optional: ["CA_CERT", "SAS_KEY", "TOKEN"] },
  OAUTH2_CC: { required: ["OAUTH2_CLIENT"], optional: ["CA_CERT"] },
  SASL_PLAIN: { required: ["PASSWORD"], optional: ["CA_CERT"] },
  SASL_SCRAM_256: { required: ["PASSWORD"], optional: ["CA_CERT"] },
  SASL_SCRAM_512: { required: ["PASSWORD"], optional: ["CA_CERT"] },
  AWS_SIGV4: { required: [], optional: ["AWS_KEYS", "CA_CERT", "PASSWORD"] },
};

const c = (connectorKey: string, name: string, category: string, authMethods: string[], ackMode: string, scaling: string, transports: string[], extra: Json = {}) => ({
  connectorKey,
  version: "1.0.0",
  name,
  category,
  standard: name,
  transports,
  authMethods,
  payloadFormats: ["JSON"],
  ackMode,
  scaling,
  supportsSend: false,
  lossPossible: ackMode === "AUTO" || ackMode === "NONE",
  enabled: true,
  disabledReason: null,
  sourceType: connectorKey === "webhook" ? "WEBHOOK" : connectorKey === "mqtt" ? "MQTT_SUBSCRIBE" : connectorKey === "platform-broker" ? "PLATFORM_BROKER" : connectorKey === "simulation" ? "SIMULATION" : "CONNECTOR",
  ...extra,
});

/** ingress가 보고하는 카탈로그(connectors.md §5)와 기본 유형 3개 = 22종 */
export const CATALOG = [
  c("mqtt", "MQTT 3.1.1/5.0", "MQTT", ["NONE", "USER_PASSWORD", "WS_HEADER", "MTLS"], "AFTER_WRITE", "DUAL_ACTIVE", ["tcp", "ssl", "ws", "wss"]),
  c("platform-broker", "Platform broker", "PLATFORM", ["USER_PASSWORD"], "AFTER_WRITE", "DUAL_ACTIVE", ["wss"]),
  c("simulation", "Simulation", "PLATFORM", ["NONE"], "AFTER_WRITE", "SCALABLE", ["internal"]),
  c("sparkplug-b", "Sparkplug B", "MQTT", ["NONE", "USER_PASSWORD", "MTLS"], "AFTER_WRITE", "DUAL_ACTIVE", ["tcp", "ssl"]),
  c("tts-v3", "The Things Stack v3", "LORAWAN", ["USER_PASSWORD"], "AFTER_WRITE", "DUAL_ACTIVE", ["ssl"]),
  c("aws-iot-core", "AWS IoT Core", "CLOUD_HUB", ["MTLS"], "AFTER_WRITE", "DUAL_ACTIVE", ["ssl"]),
  c("azure-iot-hub", "Azure IoT Hub (MQTT)", "CLOUD_HUB", ["TOKEN"], "AFTER_WRITE", "DUAL_ACTIVE", ["ssl"]),
  c("gcp-pubsub", "Google Cloud Pub/Sub", "CLOUD_HUB", ["OAUTH2_CC", "NONE"], "AFTER_WRITE", "SCALABLE", ["https"]),
  c("amqp091", "AMQP 0-9-1 (RabbitMQ)", "QUEUE", ["USER_PASSWORD", "MTLS"], "AFTER_WRITE", "SCALABLE", ["tcp", "ssl"]),
  c("amqp10", "AMQP 1.0", "QUEUE", ["NONE", "USER_PASSWORD", "TOKEN", "MTLS"], "AFTER_WRITE", "SCALABLE", ["tcp", "ssl"]),
  c("kafka", "Apache Kafka", "QUEUE", ["NONE", "SASL_PLAIN", "SASL_SCRAM_256", "SASL_SCRAM_512", "MTLS"], "AFTER_WRITE", "SCALABLE", ["tcp", "ssl"]),
  c("nats-jetstream", "NATS JetStream", "QUEUE", ["NONE", "USER_PASSWORD", "TOKEN", "MTLS"], "AFTER_WRITE", "SCALABLE", ["tcp", "tls"]),
  c("http-poll", "HTTP 폴링", "HTTP", ["NONE", "USER_PASSWORD", "TOKEN", "OAUTH2_CC", "MTLS"], "CURSOR", "SINGLETON", ["http", "https"]),
  c("http-sse", "HTTP SSE 스트림", "HTTP", ["NONE", "USER_PASSWORD", "TOKEN", "OAUTH2_CC", "MTLS"], "CURSOR", "SINGLETON", ["http", "https"]),
  c("webhook", "HTTP Webhook 수신", "HTTP", ["TOKEN"], "AFTER_WRITE", "SCALABLE", ["https"]),
  c("coap", "CoAP observe", "LIGHTWEIGHT", ["NONE"], "NONE", "SINGLETON", ["udp"]),
  c("opcua", "OPC UA 구독", "INDUSTRIAL", ["NONE", "USER_PASSWORD", "MTLS"], "NONE", "SINGLETON", ["opc.tcp"]),
  c("modbus-tcp", "Modbus TCP", "INDUSTRIAL", ["NONE"], "CURSOR", "SINGLETON", ["tcp"]),
  c("bacnet-ip", "BACnet/IP", "INDUSTRIAL", ["NONE"], "CURSOR", "SINGLETON", ["udp"]),
  c("onem2m", "oneM2M (Mobius)", "INDUSTRIAL", ["NONE", "TOKEN"], "CURSOR", "SINGLETON", ["http"]),
  c("file-s3", "파일 가져오기(S3 호환)", "FILE", ["AWS_SIGV4"], "CURSOR", "SINGLETON", ["https"]),
  c("nats-core", "NATS Core", "QUEUE", ["NONE"], "NONE", "SCALABLE", ["tcp"], { enabled: false, disabledReason: "LICENSE" }),
];

/** core 시드 템플릿 11종(V202610050940·V202610120950) */
export const TEMPLATES: { key: string; name: string; connectorKey: string; description: string; preset: Json }[] = [
  { key: "chirpstack-v4", name: "ChirpStack v4 (MQTT)", connectorKey: "mqtt", description: "application/+/device/+/event/up", preset: { connection: { protocolVersion: "5.0", qos: 1, keepaliveSec: 60, cleanStart: false, auth: "USERPASS" }, topics: [{ topic: "application/+/device/+/event/up", qos: 1 }], decoderKey: "chirpstack-v4" } },
  { key: "academy-iot-data", name: "아카데미 iot-data (WSS)", connectorKey: "mqtt", description: "wss://iot-data.java21.net/mqtt", preset: { connection: { url: "wss://iot-data.java21.net:443/mqtt", protocolVersion: "5.0", qos: 1, keepaliveSec: 60, cleanStart: false, auth: "HEADER", headerName: "Authorization", headerScheme: "Basic" }, topics: [{ topic: "application/+/device/+/event/up", qos: 1 }], decoderKey: "chirpstack-v4" } },
  { key: "tts-v3", name: "The Things Stack v3", connectorKey: "tts-v3", description: "v3/{앱}@{테넌트}/devices/+/up", preset: { connection: { host: "eu1.cloud.thethings.network", applicationId: "", tenantId: "ttn", event: "up", qos: 1 }, decoderKey: "generic-json", decoderConfig: { deviceIdFrom: "$.end_device_ids.dev_eui", timePath: "$.received_at", timeFormat: "ISO8601", metrics: [{ path: "$.uplink_message.decoded_payload.temperature", key: "temperature", unit: "℃" }] } } },
  { key: "aws-iot-core", name: "AWS IoT Core", connectorKey: "aws-iot-core", description: "mTLS 8883", preset: { connection: { endpoint: "", topics: ["dt/+/telemetry"], qos: 1 }, decoderKey: "generic-json", decoderConfig: { deviceIdFrom: "$.deviceId", metrics: [{ path: "$.temperature", key: "temperature" }] } } },
  { key: "azure-iot-hub", name: "Azure IoT Hub (MQTT)", connectorKey: "azure-iot-hub", description: "SAS", preset: { connection: { hubName: "", deviceId: "", sasTtlSec: 86400 }, decoderKey: "generic-json", decoderConfig: { deviceIdFrom: "$.deviceId", metrics: [{ path: "$.temperature", key: "temperature" }] } } },
  { key: "hivemq-cloud", name: "HiveMQ Cloud", connectorKey: "mqtt", description: "TLS 8883", preset: { connection: { url: "ssl://CLUSTER.s1.eu.hivemq.cloud:8883", protocolVersion: "5.0", qos: 1, auth: "USERPASS" }, topics: [{ topic: "devices/+/telemetry", qos: 1 }], decoderKey: "generic-json" } },
  { key: "emqx", name: "EMQX", connectorKey: "mqtt", description: "tcp 1883", preset: { connection: { url: "tcp://emqx.example.com:1883", protocolVersion: "5.0", qos: 1, auth: "USERPASS" }, topics: [{ topic: "sensors/#", qos: 1 }], decoderKey: "generic-json" } },
  { key: "sparkplug-b", name: "Sparkplug B", connectorKey: "sparkplug-b", description: "spBv1.0/{groupId}/#", preset: { connection: { url: "tcp://broker.example.com:1883", groupId: "+", qos: 1 } } },
  { key: "rabbitmq", name: "RabbitMQ (AMQP 0-9-1)", connectorKey: "amqp091", description: "amqps 5671", preset: { connection: { url: "amqps://rabbitmq.example.com:5671", vhost: "/", queue: "telemetry", batchSize: 100 }, decoderKey: "generic-json" } },
  { key: "kafka", name: "Apache Kafka", connectorKey: "kafka", description: "SASL_SSL", preset: { connection: { bootstrapServers: "kafka.example.com:9093", topics: ["iot.telemetry"], securityProtocol: "SASL_SSL", saslMechanism: "SCRAM-SHA-512", startFrom: "earliest" }, decoderKey: "generic-json" } },
  { key: "milesight-gateway", name: "Milesight 게이트웨이 (내장 NS MQTT)", connectorKey: "mqtt", description: "UG6x", preset: { connection: { url: "tcp://GATEWAY_IP:1883", protocolVersion: "3.1.1", qos: 1, auth: "USERPASS" }, topics: [{ topic: "/milesight/uplink", qos: 1 }], decoderKey: "generic-json" } },
];

interface Output {
  id: string;
  name: string;
  type: string;
  target: Json;
  filter: Json;
  format: string;
  template: string | null;
  secretKinds: string[];
  enabled: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}
interface Edge {
  id: string;
  name: string;
  site: { id: string; name: string };
  status: string;
  agentVersion: string | null;
  arch: string | null;
  certFingerprint: string | null;
  appliedConfigVersion: number | null;
  desiredConfigVersion: number | null;
  bufferUsedBytes: number | null;
  bufferItems: number | null;
  droppedItems: number;
  throughput: number | null;
  lastSeenAt: string | null;
  revokedAt: string | null;
  latestAgentVersion: string;
  updateAvailable: boolean;
  version: number;
}
interface M5State {
  secrets: Record<string, Record<string, string>>;
  webhook: Record<string, string>;
  outputs: Output[];
  edges: Edge[];
  configs: Record<string, { version: number; targets: unknown; decoders: unknown; result: string | null; error: string | null; createdAt: string; deployedAt: string | null; desired: boolean; applied: boolean }[]>;
  updates: Record<string, { updateId: string; fromVersion: string | null; toVersion: string; status: string; createdAt: string }[]>;
  requests: { edgeId: string; kind: string; minutes?: number }[];
  replays: { id: string; from?: string; to?: string }[];
  lastOutputTest?: Json;
}

const NOW = "2026-10-04T00:00:00Z";

export function m5State(core: CoreState): M5State {
  if (!core.extra.sourcesM5) {
    core.extra.sourcesM5 = {
      secrets: {},
      webhook: {},
      outputs: [
        { id: "301", name: "본사 MQTT 전달", type: "MQTT_PUBLISH", target: { url: "mqtts://hq.example.com:8883", topicTemplate: "d2f/{spaceCode}/{deviceName}/{metric}", qos: 1, retain: false }, filter: { deviceIds: [], groupIds: [], spaceIds: ["31"], metrics: ["co2"], qualityMin: 0 }, format: "CANONICAL", template: null, secretKinds: ["PASSWORD"], enabled: true, version: 2, createdAt: NOW, updatedAt: NOW },
      ],
      edges: [
        { id: "401", name: "광주-1층-엣지", site: { id: "1", name: "광주캠퍼스" }, status: "ONLINE", agentVersion: "1.4.2", arch: "arm64", certFingerprint: "ab:cd:ef", appliedConfigVersion: 3, desiredConfigVersion: 3, bufferUsedBytes: 32_212_254, bufferItems: 1200, droppedItems: 0, throughput: 86, lastSeenAt: "2026-10-03T23:59:30Z", revokedAt: null, latestAgentVersion: "1.4.2", updateAvailable: false, version: 4 },
        { id: "402", name: "부산-기계실", site: { id: "1", name: "광주캠퍼스" }, status: "OFFLINE", agentVersion: "1.4.1", arch: "amd64", certFingerprint: "12:34", appliedConfigVersion: 5, desiredConfigVersion: 5, bufferUsedBytes: 440_000_000, bufferItems: 88_000, droppedItems: 0, throughput: null, lastSeenAt: "2026-10-03T20:00:00Z", revokedAt: null, latestAgentVersion: "1.4.2", updateAvailable: true, version: 7 },
      ],
      configs: { "401": [{ version: 3, targets: [{ connectorKey: "modbus-tcp", config: { host: "192.168.0.10" } }], decoders: {}, result: "APPLIED", error: null, createdAt: NOW, deployedAt: NOW, desired: true, applied: true }, { version: 2, targets: [{ connectorKey: "modbus-tcp", config: { host: "192.168.0.9" } }], decoders: {}, result: "APPLIED", error: null, createdAt: NOW, deployedAt: NOW, desired: false, applied: false }] },
      updates: { "402": [] },
      requests: [],
      replays: [],
    } satisfies M5State;
  }
  return core.extra.sourcesM5 as M5State;
}

function fingerprint(value: string) {
  return `••••${value.slice(-4)}`;
}

function connectorDetail(core: CoreState, s: FakeSource) {
  const x = m5State(core);
  const kinds = x.secrets[s.id] ?? {};
  return {
    ...detail(s),
    secrets: Object.entries(kinds).map(([kind, value]) => ({ kind, configured: true, fingerprint: fingerprint(value), rotatedAt: NOW, rotating: false, certificateExpiresAt: kind === "CA_CERT" ? "2026-10-20T00:00:00Z" : null })),
    webhookUrl: x.webhook[s.id] ?? null,
  };
}

function outputJson(o: Output) {
  return { ...o, secretConfigured: o.secretKinds.length > 0 };
}

export const sourcesM5Handler: CoreHandler = (core, { method, path, url, body, can }) => {
  const x = m5State(core);
  const b = (body ?? {}) as Json;
  const read = () => (can("SRC_READ") ? undefined : fail(403, "PERMISSION_DENIED"));
  const admin = () => (can("SRC_ADMIN") ? undefined : fail(403, "PERMISSION_DENIED"));

  // ---- 카탈로그(API-DSC-55·56)
  if (path === "/connectors" && method === "GET") return read() ?? ok({ connectors: CATALOG, templates: TEMPLATES.map(({ preset: _p, ...t }) => t) });
  const schema = /^\/connectors\/([^/]+)\/schema$/.exec(path);
  if (schema && method === "GET") {
    const s = schemas[schema[1]];
    const entry = CATALOG.find((e) => e.connectorKey === schema[1]);
    if (!s || !entry) return fail(404, "CONNECTOR_NOT_FOUND");
    return read() ?? ok({ key: schema[1], version: "1.0.0", jsonSchema: s, uiHints: s["x-ui"] ?? {}, authSecretKinds: Object.fromEntries(entry.authMethods.map((m) => [m, AUTH_MATRIX[m] ?? { required: [], optional: ["CA_CERT"] }])) });
  }
  const template = /^\/connector-templates\/([^/]+)$/.exec(path);
  if (template && method === "GET") {
    const tpl = TEMPLATES.find((t) => t.key === template[1]);
    return tpl ? ok({ key: tpl.key, connectorKey: tpl.connectorKey, name: tpl.name, description: tpl.description, builtin: true, preset: tpl.preset }) : fail(404, "CONNECTOR_NOT_FOUND");
  }

  // ---- 카탈로그 커넥터·Webhook 소스(API-DSC-02·03·57·58)
  if (path === "/sources" && method === "POST" && (b.type === "CONNECTOR" || b.type === "WEBHOOK")) {
    const denied = admin();
    if (denied) return denied;
    if (core.sources.some((s) => s.code === b.code)) return fail(409, "SOURCE_CODE_DUPLICATE");
    const connection = { ...((b.connection ?? {}) as Json) };
    const key = String(b.connectorKey ?? (b.type === "WEBHOOK" ? "webhook" : ""));
    const props = (schemas[key]?.properties ?? {}) as Json;
    const unknown = Object.keys(connection).filter((k) => !(k in props));
    if (unknown.length > 0) return fail(400, "SOURCE_CONFIG_INVALID", { errors: unknown.map((k) => ({ field: `connection.${k}`, code: "UNKNOWN_FIELD", message: "" })) });
    if (connection.tlsInsecure === true && b.isDev !== true) return fail(400, "SOURCE_TLS_VERIFY_REQUIRED", { errors: [{ field: "connection.tlsInsecure", code: "TLS_VERIFY_REQUIRED", message: "" }] });
    const id = core.nextId();
    const secret = b.secret as Json | undefined;
    const kinds: Record<string, string> = {};
    if (secret?.cert) Object.assign(kinds, { CLIENT_CERT: String(secret.cert), CLIENT_KEY: String(secret.key), ...(secret.ca ? { CA_CERT: String(secret.ca) } : {}) });
    else if (secret?.kind) kinds[String(secret.kind) === "USERPASS" ? "PASSWORD" : String(secret.kind)] = String(secret.value);
    let issuedSecret: { kind: string; value: string } | null = null;
    if (b.type === "WEBHOOK") {
      connection.sourceKey = "Wh7Qk2LmP9xVb3NcR8sT1uY6zA4dE5fG";
      x.webhook[id] = `https://data2flow-hook.java21.net/ingest/webhook/${connection.sourceKey}`;
      issuedSecret = { kind: "HMAC_KEY", value: "hk_9f8e7d6c5b4a39281706f5e4d3c23f2a" };
      kinds.HMAC_KEY = issuedSecret.value;
    }
    x.secrets[id] = kinds;
    const created: FakeSource = {
      id,
      code: String(b.code),
      name: String(b.name),
      type: String(b.type),
      connectorKey: key,
      lifecycle: b.activate ? "ACTIVE" : "DRAFT",
      state: b.activate ? "CONNECTING" : "DISABLED",
      connection,
      topics: [],
      decoderKey: String(b.decoderKey ?? "generic-json"),
      decoderConfig: b.decoderConfig,
      decodeScriptId: null,
      unknownDevicePolicy: (b.unknownDevicePolicy as "AUTO_REGISTER" | "REJECT") ?? "AUTO_REGISTER",
      defaultModelId: (b.defaultModelId as string | null) ?? null,
      defaultSpaceId: (b.defaultSpaceId as string | null) ?? null,
      autoregLimitPerHour: Number(b.autoregLimitPerHour ?? 100),
      noDataAlarmAfterSec: Number(b.noDataAlarmAfterSec ?? 600),
      secret: { kind: Object.keys(kinds)[0] ?? "NONE", configured: Object.keys(kinds).length > 0, fingerprint: Object.values(kinds)[0] ? fingerprint(Object.values(kinds)[0]) : null, rotatedAt: null },
      runtime: [],
      ratePerMin: 0,
      decodeErrorRate1h: 0,
      lastReceivedAt: null,
      version: 1,
    };
    core.sources.push(created);
    return ok({ ...connectorDetail(core, created), issuedSecret }, 201, { Location: `/api/v1/core/sources/${id}` });
  }
  const secretKind = /^\/sources\/([^/]+)\/secrets\/([^/]+)$/.exec(path);
  if (secretKind && method === "PUT") {
    const denied = admin();
    if (denied) return denied;
    const source = core.sources.find((s) => s.id === secretKind[1]);
    if (!source) return fail(404, "SOURCE_NOT_FOUND");
    const value = String(b.value ?? "");
    if (!value) return fail(400, "SOURCE_SECRET_REQUIRED");
    (x.secrets[source.id] ??= {})[secretKind[2]] = value;
    return ok({ kind: secretKind[2], fingerprint: fingerprint(value), rotatedAt: NOW });
  }
  const sourceGet = /^\/sources\/([^/]+)$/.exec(path);
  if (sourceGet && method === "GET") {
    const source = core.sources.find((s) => s.id === sourceGet[1]);
    if (source && (x.secrets[source.id] || source.type === "CONNECTOR" || source.type === "WEBHOOK")) return read() ?? ok(connectorDetail(core, source));
    return undefined;
  }

  // ---- 출력 연결(API-DSC-30~33)
  if (path === "/output-connections" && method === "GET") return read() ?? list(x.outputs.map(outputJson), url);
  if (path === "/output-connections/test" && method === "POST") {
    const denied = admin();
    if (denied) return denied;
    x.lastOutputTest = b;
    const target = (b.target ?? {}) as Json;
    const device = core.devices.find((d) => d.id === String(b.sampleDeviceId));
    if (!device) return fail(400, "INVALID_REQUEST", { errors: [{ field: "sampleDeviceId", code: "NOT_FOUND", message: "" }] });
    if (String(target.url ?? "").includes("unreachable")) return ok({ ok: false, failureKind: "REFUSED", rendered: { deviceName: device.name }, response: null });
    const topic = String(target.topicTemplate ?? "").replace("{deviceName}", device.name).replace("{deviceId}", device.id).replace("{spaceCode}", "room-301").replace("{metric}", "co2");
    return ok({ ok: true, rendered: b.type === "MQTT_PUBLISH" ? { topic, payload: { deviceId: device.id, metrics: [{ key: "co2", value: 812 }] } } : [{ deviceId: device.id }], response: b.type === "WEBHOOK" ? { status: 200, bodyPreview: '{"ok":true}' } : null });
  }
  if (path === "/output-connections" && method === "POST") {
    const denied = admin();
    if (denied) return denied;
    const target = (b.target ?? {}) as Json;
    if (String(target.url ?? "").includes("iot-data.java21.net")) return fail(400, "SOURCE_CONFIG_INVALID", { errors: [{ field: "target.url", code: "FORBIDDEN_HOST", message: "" }] });
    if (/\{(?!spaceCode|deviceName|deviceId|metric)[^}]*\}/.test(String(target.topicTemplate ?? ""))) return fail(400, "SOURCE_CONFIG_INVALID", { errors: [{ field: "target.topicTemplate", code: "UNKNOWN_VARIABLE", message: "" }] });
    const o: Output = { id: core.nextId(), name: String(b.name), type: String(b.type), target, filter: (b.filter ?? {}) as Json, format: String(b.format ?? "CANONICAL"), template: (b.template as string | null) ?? null, secretKinds: Object.keys((b.secret ?? {}) as Json), enabled: b.enabled !== false, version: 1, createdAt: NOW, updatedAt: NOW };
    x.outputs.push(o);
    return ok(outputJson(o), 201, { Location: `/api/v1/core/output-connections/${o.id}` });
  }
  const output = /^\/output-connections\/(\d+)(\/.*)?$/.exec(path);
  if (output) {
    const o = x.outputs.find((e) => e.id === output[1]);
    if (!o) return fail(404, "OUTPUT_NOT_FOUND");
    const sub = output[2] ?? "";
    if (method === "GET" && sub === "") return read() ?? ok(outputJson(o));
    if (method === "GET" && sub === "/stats") {
      const to = Date.parse(url.searchParams.get("to") ?? NOW);
      return read() ?? ok(Array.from({ length: 3 }, (_, i) => ({ t: new Date(to - (2 - i) * 60_000).toISOString(), sent: 12, failed: i === 1 ? 2 : 0, retried: i === 1 ? 2 : 0, lagMs: 140 })));
    }
    const denied = admin();
    if (denied) return denied;
    if (method === "PATCH" && sub === "") {
      if (Number(b.baseVersion) !== o.version) return fail(409, "VERSION_CONFLICT");
      Object.assign(o, { name: b.name ?? o.name, target: b.target ?? o.target, filter: b.filter ?? o.filter, format: b.format ?? o.format, template: b.template === undefined ? o.template : b.template, enabled: b.enabled ?? o.enabled, version: o.version + 1 });
      if (b.secret) o.secretKinds = Array.from(new Set([...o.secretKinds, ...Object.keys(b.secret as Json)]));
      return ok(outputJson(o));
    }
    if (method === "DELETE" && sub === "") {
      x.outputs = x.outputs.filter((e) => e !== o);
      return noContent();
    }
    if (method === "POST" && sub === "/replay-failed") {
      x.replays.push({ id: o.id, from: b.from as string | undefined, to: b.to as string | undefined });
      return ok({ queued: 7 });
    }
    return undefined;
  }

  // ---- 엣지 게이트웨이(API-DSC-62·64·65·67)
  if (path === "/edges" && method === "GET") return read() ?? list(x.edges, url);
  if (path === "/edges" && method === "POST") {
    const denied = admin();
    if (denied) return denied;
    const site = core.spaces.find((s) => s.id === String(b.siteId));
    if (!site) return fail(400, "INVALID_REQUEST", { errors: [{ field: "siteId", code: "NOT_FOUND", message: "" }] });
    const e: Edge = { id: core.nextId(), name: String(b.name), site: { id: site.id, name: site.name }, status: "REGISTERING", agentVersion: null, arch: null, certFingerprint: null, appliedConfigVersion: null, desiredConfigVersion: null, bufferUsedBytes: null, bufferItems: null, droppedItems: 0, throughput: null, lastSeenAt: null, revokedAt: null, latestAgentVersion: "1.4.2", updateAvailable: false, version: 1 };
    x.edges.push(e);
    return ok({ id: e.id, name: e.name, status: e.status, registrationToken: "edg_reg_7c1f9a2b4d", expiresAt: "2026-10-05T00:00:00Z", installCommand: "curl -fsSL https://data2flow-hook.java21.net/edge/install.sh | sudo sh -s -- edg_reg_7c1f9a2b4d", offlinePackageUrl: "/api/v1/core/edges/packages/latest" }, 201);
  }
  const edge = /^\/edges\/(\d+)(\/.*)?$/.exec(path);
  if (edge) {
    const e = x.edges.find((g) => g.id === edge[1]);
    if (!e) return fail(404, "EDGE_NOT_FOUND");
    const sub = edge[2] ?? "";
    const configs = (x.configs[e.id] ??= []);
    if (method === "GET" && sub === "") return read() ?? ok(e);
    if (method === "GET" && sub === "/config-versions") return read() ?? ok(configs);
    if (method === "GET" && sub === "/updates") return read() ?? ok({ currentVersion: e.agentVersion, latestVersion: e.latestAgentVersion, availableVersions: ["1.4.2"], updates: x.updates[e.id] ?? [] });
    const denied = admin();
    if (denied) return denied;
    if (method === "POST" && sub === "/config-versions") {
      const version = (configs.reduce((m, v) => Math.max(m, v.version), 0) || 0) + 1;
      const v = { version, targets: b.targets, decoders: b.decoders ?? {}, result: null, error: null, createdAt: NOW, deployedAt: null, desired: false, applied: false };
      configs.unshift(v);
      return ok(v, 201);
    }
    const deploy = /^\/config-versions\/(\d+)\/(deploy|rollback)$/.exec(sub);
    if (method === "POST" && deploy) {
      const v = configs.find((c2) => c2.version === Number(deploy[1]));
      if (!v) return fail(404, "EDGE_NOT_FOUND");
      if (e.status === "REVOKED") return fail(409, "EDGE_STATE_CONFLICT");
      configs.forEach((c2) => (c2.desired = c2 === v));
      v.deployedAt = NOW;
      v.result = "PENDING";
      e.desiredConfigVersion = v.version;
      return ok(v);
    }
    if (method === "POST" && sub === "/updates") {
      const u = { updateId: core.nextId(), fromVersion: e.agentVersion, toVersion: String(b.toVersion), status: "PENDING", createdAt: NOW };
      (x.updates[e.id] ??= []).push(u);
      return ok(u, 201);
    }
    if (method === "POST" && sub === "/registration-tokens") {
      if (e.status !== "REGISTERING") return fail(409, "EDGE_STATE_CONFLICT");
      return ok({ id: e.id, name: e.name, status: e.status, registrationToken: "edg_reg_new_55aa", expiresAt: "2026-10-05T00:00:00Z", installCommand: "curl … edg_reg_new_55aa", offlinePackageUrl: null }, 201);
    }
    const command = /^\/(restart|collect-logs|revoke)$/.exec(sub);
    if (method === "POST" && command) {
      if (e.status === "REVOKED") return fail(409, "EDGE_STATE_CONFLICT");
      x.requests.push({ edgeId: e.id, kind: command[1], minutes: b.minutes as number | undefined });
      if (command[1] === "revoke") {
        e.status = "REVOKED";
        e.revokedAt = NOW;
      }
      return ok({ requestId: `req-${x.requests.length}` }, 202);
    }
  }
  return undefined;
};
