import { EMPTY_TLS, tlsBody, tlsFrom, validateTls, type TlsSettings } from "./schema-form";

/**
 * 데이터 소스 화면 모델(DSC-01·02·07·09). 입력 검증(UI-DSC-02 표), 실제 client-id 미리 보기(BR-DSC-01),
 * 대표 연결 상태(가장 나쁜 인스턴스), 상태별 버튼(DSC-07.01), 저장 요청 본문(API-DSC-02·04).
 */

export const BASIC_TYPES = ["MQTT_SUBSCRIBE", "PLATFORM_BROKER", "SIMULATION"] as const;
/** UI-DSC-02 1단계 유형 카드 7종(TC-DSC-015). M2는 앞의 셋만 만들 수 있다 */
export const TYPE_CARDS = ["MQTT_SUBSCRIBE", "PLATFORM_BROKER", "WEBHOOK", "SIMULATION", "ONEM2M", "OPCUA", "MODBUS_TCP"] as const;
export const LIFECYCLES = ["DRAFT", "ACTIVE", "PAUSED", "ARCHIVED"] as const;
export const RUNTIME_STATES = ["CONNECTED", "CONNECTING", "DISCONNECTED", "ERROR", "DISABLED"] as const;
export const DECODERS = ["chirpstack-v4", "generic-json", "single-value", "script"] as const;
export const AUTH_METHODS = ["NONE", "USERPASS", "HEADER", "MTLS"] as const;
/** 소스당 토픽 기본 한도(BR-DSC-06). 조직 한도는 API-DSC-71 `maxTopicsPerSource`가 정한다 */
export const MAX_TOPICS = 20;

/** 연결 테스트 제한 시간(BR-DSC-07, API-DSC-57): 기본 15초, 요청 `timeoutSec`로 5~30초 */
export const TEST_TIMEOUT_SEC = 15;
export const TEST_TIMEOUT_RANGE = { min: 5, max: 30 } as const;

export function clampTestTimeout(value: number | null | undefined): number {
  if (value === null || value === undefined || !Number.isFinite(value)) return TEST_TIMEOUT_SEC;
  return Math.max(TEST_TIMEOUT_RANGE.min, Math.min(TEST_TIMEOUT_RANGE.max, Math.round(value)));
}

/** 연결 테스트 단계 실패 표기는 FAILED(API-DSC-57, 문서·ingress·core 같음). 예전 core 표기 FAIL도 실패로 본다 */
export function isFailedStep(status: string | null | undefined): boolean {
  return status === "FAILED" || status === "FAIL";
}

/** 조직 소스 한도(API-DSC-71) */
export interface SourceLimits {
  maxSources: number;
  maxTopicsPerSource: number;
  maxMessageBytes: number;
  maxMessagesPerSec: number;
  activeSources: number;
  version?: number;
}

/** 커넥터 키 → 소스 유형(M2 기본 유형) */
export const CONNECTOR_TYPES: Record<string, string> = { mqtt: "MQTT_SUBSCRIBE", "platform-broker": "PLATFORM_BROKER", simulation: "SIMULATION" };

export function typeOfConnector(key: string): string {
  return CONNECTOR_TYPES[key] ?? "CONNECTOR";
}

export function connectorOfType(type: string, connectorKey?: string | null): string {
  if (connectorKey) return connectorKey;
  return Object.entries(CONNECTOR_TYPES).find(([, t]) => t === type)?.[0] ?? "mqtt";
}

export type Tone = "good" | "warn" | "bad" | "muted" | "accent";

const STATE_RANK: Record<string, number> = { ERROR: 0, DISCONNECTED: 1, CONNECTING: 2, DISABLED: 3, CONNECTED: 4 };

/** 대표 상태: 가장 나쁜 인스턴스 상태(TC-DSC-061). 인스턴스가 없으면 DISABLED */
export function worstState(states: (string | null | undefined)[]): string {
  const known = states.filter((s): s is string => Boolean(s));
  if (known.length === 0) return "DISABLED";
  return [...known].sort((a, b) => (STATE_RANK[a] ?? 2) - (STATE_RANK[b] ?? 2))[0];
}

export function stateTone(state: string | null | undefined): Tone {
  if (state === "CONNECTED") return "good";
  if (state === "CONNECTING") return "warn";
  if (state === "ERROR" || state === "DISCONNECTED") return "bad";
  return "muted";
}

export function lifecycleTone(lifecycle: string): "success" | "warning" | "neutral" | "info" {
  if (lifecycle === "ACTIVE") return "success";
  if (lifecycle === "PAUSED") return "warning";
  if (lifecycle === "DRAFT") return "info";
  return "neutral";
}

export type LifecycleAction = "activate" | "pause" | "resume" | "archive" | "delete" | "clone";

/** 상태에 맞는 버튼만(DSC-07.01, TC-DSC-168). 삭제는 DRAFT·ARCHIVED에서만(BR-DSC-04, 상태 전이 §3.1) */
export function lifecycleActions(lifecycle: string): LifecycleAction[] {
  switch (lifecycle) {
    case "DRAFT":
      return ["activate", "clone", "delete"];
    case "ACTIVE":
      return ["pause", "clone", "archive"];
    case "PAUSED":
      return ["resume", "clone", "archive"];
    case "ARCHIVED":
      return ["clone", "delete"];
    default:
      return [];
  }
}

export const CODE_PATTERN = /^[a-z][a-z0-9-]{1,49}$/;
/** client-id base(core SourceConfigValidator, contracts ClientIds): 소문자·숫자·하이픈, 뒤에 `-{env}-{n}`이 붙는다 */
export const CLIENT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,80}$/;

export function checkCode(code: string): boolean {
  return CODE_PATTERN.test(code);
}

/** 브로커 주소: tcp/ssl/ws/wss 스킴, 호스트 필수, 포트 1~65535 */
export function checkBrokerUrl(raw: string): boolean {
  const match = /^(tcp|ssl|ws|wss|mqtt|mqtts):\/\/([^/:\s]+)(?::(\d+))?(\/\S*)?$/i.exec(raw.trim());
  if (!match) return false;
  if (!["tcp", "ssl", "ws", "wss"].includes(match[1].toLowerCase())) return false;
  if (match[3] !== undefined) {
    const port = Number(match[3]);
    if (!(port >= 1 && port <= 65535)) return false;
  }
  return true;
}

/** MQTT 토픽 필터: 1~256자, `#`은 마지막 단계에만 홀로, `+`는 단계 전체로만 */
export function checkTopic(topic: string): boolean {
  // 공유 구독 접두사는 토픽이 아니라 sharedGroup으로 쓴다(core 검증과 같음)
  if (topic.length < 1 || topic.length > 256 || topic.startsWith("$share/")) return false;
  const levels = topic.split("/");
  return levels.every((level, i) => {
    if (level.includes("#")) return level === "#" && i === levels.length - 1;
    if (level.includes("+")) return level === "+";
    return true;
  });
}

/** 공유 구독 실제 토픽 미리 보기(DSC-09.04, TC-DSC-267) */
export function sharedTopic(topic: string, group: string | null | undefined): string {
  const g = (group ?? "").trim();
  return g ? `$share/${g}/${topic}` : topic;
}

/** 실제 접속 client-id 미리 보기(BR-DSC-01): `{base}-{env}-{ordinal}`. base가 비면 `data2flow-{code}` */
export function clientIdPreview(base: string, code: string, env = "prod", instances = 2): string[] {
  const effective = base.trim() || `data2flow-${code.trim() || "{code}"}`;
  return Array.from({ length: instances }, (_, i) => `${effective}-${env}-${i}`);
}

export interface TopicRow {
  topic: string;
  qos: number;
}

export interface SourceFormValues {
  code: string;
  name: string;
  type: string;
  connectorKey: string;
  url: string;
  clientIdBase: string;
  protocolVersion: "3.1.1" | "5.0";
  qos: number;
  keepaliveSec: string;
  cleanStart: boolean;
  sessionExpirySec: string;
  receiveMaximum: string;
  auth: string;
  headerName: string;
  /** 헤더 인증 스킴(Basic 등, 템플릿 `academy-iot-data`). 화면에서 바꾸지 않고 그대로 보존한다 */
  headerScheme: string;
  username: string;
  secretValue: string;
  tlsInsecure: boolean;
  /** 개발 소스(BR-DSC-29: 이 표시가 있을 때만 TLS 검증 끄기 허용) */
  isDev: boolean;
  sharedGroup: string;
  topics: TopicRow[];
  deviceKeyPattern: string;
  scenarioId: string;
  decoderKey: string;
  decoderConfig: string;
  decodeScriptId: string;
  unknownDevicePolicy: string;
  defaultModelId: string;
  defaultSpaceId: string;
  autoregLimitPerHour: string;
  noDataAlarmAfterSec: string;
  /** TLS 설정(DSC-09.06): SNI·최소 버전·인증서 고정. 없으면 기본 */
  tls?: TlsSettings;
  /** TLS 비밀값(CA_CERT, mTLS의 CLIENT_CERT·CLIENT_KEY). 쓰기 전용 */
  tlsSecrets?: Record<string, string>;
}

/** generic-json 기본 매핑(ING-02.03 예: `devices/esp-01/telemetry` + `{"temp":22.4}`) */
export const DEFAULT_MAPPING = JSON.stringify({ deviceIdFrom: "topic[1]", timePath: "$.ts", metrics: [{ path: "$.temp", key: "temperature" }] }, null, 2);

export function emptyForm(type: string, connectorKey: string): SourceFormValues {
  return {
    code: "",
    name: "",
    type,
    connectorKey,
    url: "",
    clientIdBase: "",
    protocolVersion: "5.0",
    qos: 1,
    keepaliveSec: "60",
    cleanStart: false,
    sessionExpirySec: "3600",
    receiveMaximum: "",
    auth: "NONE",
    headerName: "Authorization",
    headerScheme: "",
    username: "",
    secretValue: "",
    tlsInsecure: false,
    isDev: false,
    sharedGroup: "",
    topics: type === "MQTT_SUBSCRIBE" ? [{ topic: "", qos: 1 }] : [],
    deviceKeyPattern: "{externalId}",
    scenarioId: "",
    decoderKey: type === "MQTT_SUBSCRIBE" ? "chirpstack-v4" : "generic-json",
    decoderConfig: type === "MQTT_SUBSCRIBE" ? "" : DEFAULT_MAPPING,
    decodeScriptId: "",
    unknownDevicePolicy: "AUTO_REGISTER",
    defaultModelId: "",
    defaultSpaceId: "",
    autoregLimitPerHour: "100",
    noDataAlarmAfterSec: "600",
  };
}

/** 저장된 소스(API-DSC-03) → 폼 값. 비밀값은 비운다(빈 값이면 기존 유지, BR-DSC-02) */
export function formFromSource(source: SourceDetail): SourceFormValues {
  const c = (source.connection ?? {}) as Record<string, unknown>;
  const str = (v: unknown, fallback = "") => (v === undefined || v === null ? fallback : String(v));
  const base = emptyForm(source.type, connectorOfType(source.type, source.connectorKey));
  return {
    ...base,
    code: source.code,
    name: source.name,
    url: str(c.url),
    clientIdBase: str(c.clientIdBase),
    protocolVersion: c.protocolVersion === "3.1.1" ? "3.1.1" : "5.0",
    qos: Number(c.qos ?? 1),
    keepaliveSec: str(c.keepaliveSec, "60"),
    cleanStart: Boolean(c.cleanStart),
    sessionExpirySec: str(c.sessionExpirySec, "3600"),
    receiveMaximum: str(c.receiveMaximum),
    auth: str(c.auth, "NONE"),
    headerName: str(c.headerName, "Authorization"),
    headerScheme: str(c.headerScheme),
    username: str(c.username),
    tlsInsecure: Boolean(c.tlsInsecure),
    isDev: Boolean(source.isDev),
    sharedGroup: str(c.sharedGroup),
    topics: (source.topics ?? []).map((t) => ({ topic: t.topic, qos: Number(t.qos ?? 1) })),
    deviceKeyPattern: str(c.deviceKeyPattern, "{externalId}"),
    scenarioId: str(c.scenarioId),
    decoderKey: source.decoderKey ?? base.decoderKey,
    decoderConfig: source.decoderConfig ? JSON.stringify(source.decoderConfig, null, 2) : "",
    decodeScriptId: str(source.decodeScriptId),
    unknownDevicePolicy: source.unknownDevicePolicy ?? "AUTO_REGISTER",
    defaultModelId: str(source.defaultModelId),
    defaultSpaceId: str(source.defaultSpaceId),
    autoregLimitPerHour: str(source.autoregLimitPerHour, "100"),
    noDataAlarmAfterSec: str(source.noDataAlarmAfterSec, "600"),
    tls: tlsFrom(c.tls),
    tlsSecrets: {},
  };
}

export type FieldErrors = Partial<Record<keyof SourceFormValues | `topic${number}`, string>>;

const inRange = (raw: string, min: number, max: number) => raw.trim() !== "" && Number.isInteger(Number(raw)) && Number(raw) >= min && Number(raw) <= max;

/** 입력 검증(UI-DSC-02 표). 값은 오류 문구 키(`sources.validation.*`) */
export function validateForm(values: SourceFormValues, options: { editing?: boolean; secretConfigured?: boolean; mappingError?: string | null; maxTopics?: number } = {}): FieldErrors {
  const errors: FieldErrors = {};
  if (!options.editing && !checkCode(values.code)) errors.code = "code";
  if (values.name.trim().length < 1 || values.name.trim().length > 100) errors.name = "name";
  if (values.type === "MQTT_SUBSCRIBE") {
    if (!checkBrokerUrl(values.url)) errors.url = "url";
    if (values.clientIdBase && !CLIENT_ID_PATTERN.test(values.clientIdBase)) errors.clientIdBase = "clientId";
    if (!inRange(values.keepaliveSec, 10, 600)) errors.keepaliveSec = "keepalive";
    if (values.protocolVersion === "5.0" && !inRange(values.sessionExpirySec, 0, 4294967295)) errors.sessionExpirySec = "sessionExpiry";
    if (values.topics.length === 0) errors.topics = "topicRequired";
    if (values.topics.length > (options.maxTopics ?? MAX_TOPICS)) errors.topics = "topicLimit";
    values.topics.forEach((row, i) => {
      if (!checkTopic(row.topic)) errors[`topic${i}`] = "topic";
    });
    if ((values.auth === "USERPASS" || values.auth === "HEADER") && !values.secretValue && !(options.editing && options.secretConfigured)) errors.secretValue = "secret";
    if (values.auth === "USERPASS" && !values.username.trim()) errors.username = "username";
    if (values.auth === "HEADER" && !values.headerName.trim()) errors.headerName = "headerName";
    if (values.tlsInsecure && !values.isDev) errors.tlsInsecure = "tlsDevOnly";
    const ts = values.tlsSecrets ?? {};
    if (values.auth === "MTLS" && !(options.editing && options.secretConfigured) && (!ts.CLIENT_CERT?.trim() || !ts.CLIENT_KEY?.trim())) errors.secretValue = "secret";
    if (Object.keys(validateTls(values.tls ?? EMPTY_TLS)).length > 0) errors.tls = "tls";
  }
  if (values.decoderKey === "script" && !values.decodeScriptId) errors.decodeScriptId = "script";
  if (values.decoderKey === "generic-json" && options.mappingError) errors.decoderConfig = "mapping";
  if (!inRange(values.autoregLimitPerHour, 0, 10000)) errors.autoregLimitPerHour = "autoreg";
  if (!inRange(values.noDataAlarmAfterSec, 60, 86400)) errors.noDataAlarmAfterSec = "noData";
  return errors;
}

function connectionOf(values: SourceFormValues): Record<string, unknown> {
  if (values.type === "PLATFORM_BROKER") return { deviceKeyPattern: values.deviceKeyPattern || "{externalId}" };
  if (values.type === "SIMULATION") return values.scenarioId ? { scenarioId: values.scenarioId } : {};
  const mqtt5 = values.protocolVersion === "5.0";
  const connection: Record<string, unknown> = {
    url: values.url.trim(),
    clientIdBase: values.clientIdBase.trim() || undefined,
    protocolVersion: values.protocolVersion,
    qos: values.qos,
    keepaliveSec: Number(values.keepaliveSec),
    cleanStart: values.cleanStart,
    auth: values.auth,
    tlsInsecure: values.tlsInsecure,
  };
  if (mqtt5) connection.sessionExpirySec = Number(values.sessionExpirySec);
  if (mqtt5 && values.receiveMaximum) connection.receiveMaximum = Number(values.receiveMaximum);
  if (values.sharedGroup.trim()) connection.sharedGroup = values.sharedGroup.trim();
  if (values.auth === "HEADER") connection.headerName = values.headerName.trim();
  if (values.auth === "HEADER" && values.headerScheme.trim()) connection.headerScheme = values.headerScheme.trim();
  if (values.auth === "USERPASS") connection.username = values.username.trim();
  const tls = tlsBody(values.tls ?? EMPTY_TLS);
  if (tls) connection.tls = tls;
  return connection;
}

function parseConfig(raw: string): unknown {
  if (!raw.trim()) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/** API-DSC-02 생성 본문. 비밀값은 값이 있을 때만(쓰기 전용) */
export function createBody(values: SourceFormValues, activate: boolean): Record<string, unknown> {
  return {
    code: values.code.trim(),
    ...updateBody(values),
    type: values.type,
    activate,
  };
}

/** API-DSC-04 수정 본문(type·code 제외, baseVersion은 호출하는 쪽이 붙인다). 빈 비밀값은 보내지 않는다(기존 유지) */
export function updateBody(values: SourceFormValues): Record<string, unknown> {
  const body: Record<string, unknown> = {
    name: values.name.trim(),
    connectorKey: values.connectorKey,
    isDev: values.isDev,
    connection: connectionOf(values),
    topics: values.type === "MQTT_SUBSCRIBE" ? values.topics.map((t) => ({ topic: t.topic.trim(), qos: Number(t.qos) })) : undefined,
    decoderKey: values.decoderKey,
    decoderConfig: values.decoderKey === "generic-json" ? parseConfig(values.decoderConfig) : undefined,
    decodeScriptId: values.decoderKey === "script" ? values.decodeScriptId : undefined,
    unknownDevicePolicy: values.unknownDevicePolicy,
    defaultModelId: values.defaultModelId || null,
    defaultSpaceId: values.defaultSpaceId || null,
    autoregLimitPerHour: Number(values.autoregLimitPerHour),
    noDataAlarmAfterSec: Number(values.noDataAlarmAfterSec),
  };
  // 비밀값 종류: core는 인증 방식 이름(USERPASS→PASSWORD, HEADER→HEADER_VALUE)을 받는다. MTLS 인증서·키 올리기는 M5(DSC-09.06)
  if (values.secretValue && (values.auth === "USERPASS" || values.auth === "HEADER")) body.secret = { kind: values.auth, value: values.secretValue };
  // mTLS(DSC-09.06): 클라이언트 인증서·키(+ CA)를 한 건으로(`{cert, key, ca}`)
  const ts = values.tlsSecrets ?? {};
  if (values.type === "MQTT_SUBSCRIBE" && values.auth === "MTLS" && ts.CLIENT_CERT?.trim() && ts.CLIENT_KEY?.trim()) body.secret = { cert: ts.CLIENT_CERT, key: ts.CLIENT_KEY, ...(ts.CA_CERT?.trim() ? { ca: ts.CA_CERT } : {}) };
  return body;
}

/**
 * 저장 본문 `secret` 한 건에 못 들어간 비밀값(사설 CA 묶음 등). 저장 뒤 API-DSC-58 `PUT …/secrets/{kind}`로 보낸다(DSC-09.06).
 */
export function extraSecrets(values: SourceFormValues): { kind: string; value: string }[] {
  if (values.type !== "MQTT_SUBSCRIBE") return [];
  const ts = values.tlsSecrets ?? {};
  const sentWithMtls = values.auth === "MTLS" && ts.CLIENT_CERT?.trim() && ts.CLIENT_KEY?.trim();
  if (ts.CA_CERT?.trim() && !sentWithMtls) return [{ kind: "CA_CERT", value: ts.CA_CERT }];
  return [];
}

/** 연결 테스트 본문(API-DSC-57): 소스 설정 전체(저장 안 함). 테스트는 저장 본문에 영향이 없다(TC-DSC-093) */
export function testBody(values: SourceFormValues): Record<string, unknown> {
  return { ...createBody(values, false), activate: undefined };
}

export interface SourceSummary {
  id: string;
  code: string;
  name: string;
  type: string;
  lifecycle: string;
  state?: string | null;
  stateDetail?: { connectedInstances?: number; totalInstances?: number; errorKind?: string | null; errorMessage?: string | null } | null;
  lastReceivedAt?: string | null;
  ratePerMin?: number | null;
  decodeErrorRate1h?: number | null;
  deviceCount?: number | null;
  /** 최근 1시간 분당 수신(스파크라인) — 있으면 그린다 */
  rateSeries?: number[] | null;
  version?: number;
}

export interface RuntimeInstance {
  instanceId: string;
  state: string;
  errorKind?: string | null;
  errorMessage?: string | null;
  clientId?: string | null;
  connectedSince?: string | null;
  reportedAt?: string | null;
  reconnects24h?: number | null;
  /** 90초 넘게 보고 없음(대표 상태에서 빠진다) */
  stale?: boolean;
}

export const SOURCE_STATES = ["CONNECTED", "CONNECTING", "DISCONNECTED", "ERROR", "DISABLED"] as const;

/** 실시간 `sources` 토픽의 `source-state` 이벤트(API-DSH-20, DSC-02.01) */
export interface SourceStateEvent {
  sourceId: string;
  state: string;
  previousState?: string | null;
  errorKind?: string | null;
  at?: string | null;
}

/** 이벤트 data를 읽는다. 형식이 틀리거나 모르는 상태면 null(무시) */
export function parseSourceStateEvent(data: unknown): SourceStateEvent | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const id = typeof d.sourceId === "string" || typeof d.sourceId === "number" ? String(d.sourceId) : null;
  const state = typeof d.state === "string" && (SOURCE_STATES as readonly string[]).includes(d.state) ? d.state : null;
  if (!id || !state) return null;
  return { sourceId: id, state, previousState: typeof d.previousState === "string" ? d.previousState : null, errorKind: typeof d.errorKind === "string" ? d.errorKind : null, at: typeof d.at === "string" ? d.at : null };
}

/** 실시간 상태를 덮어쓴 목록 표시 상태: ACTIVE 소스만 연결 상태가 있고, 그 밖의 생애주기는 DISABLED(TC-DSC-060) */
export function displayState(source: { id: string; lifecycle: string; state?: string | null }, live: Record<string, string>): string {
  if (source.lifecycle === "PAUSED" || source.lifecycle === "DRAFT") return "DISABLED";
  if (source.lifecycle !== "ACTIVE") return source.state ?? "DISABLED";
  return live[source.id] ?? source.state ?? "DISABLED";
}

/** 대표 상태: core가 계산한 `state`를 쓰고, 없으면 보고가 끊기지 않은 인스턴스 중 가장 나쁜 상태 */
export function representativeState(source: Pick<SourceDetail, "lifecycle" | "state">, runtime: RuntimeInstance[]): string {
  if (source.lifecycle !== "ACTIVE") return "DISABLED";
  if (source.state) return source.state;
  return worstState(runtime.filter((r) => !r.stale).map((r) => r.state));
}

export interface SourceDetail {
  id: string;
  code: string;
  name: string;
  type: string;
  connectorKey?: string | null;
  lifecycle: string;
  connection?: Record<string, unknown> | null;
  topics?: { topic: string; qos: number }[];
  secret?: { kind?: string; configured?: boolean; fingerprint?: string | null; rotatedAt?: string | null } | null;
  decoderKey?: string;
  decoderConfig?: unknown;
  decodeScriptId?: string | null;
  unknownDevicePolicy?: string;
  defaultModelId?: string | null;
  defaultSpaceId?: string | null;
  autoregLimitPerHour?: number;
  noDataAlarmAfterSec?: number;
  webhookUrl?: string | null;
  clientIdBase?: string | null;
  clientIds?: string[];
  runtime?: RuntimeInstance[];
  /** 대표 연결 상태(core 계산) */
  state?: string | null;
  stateDetail?: { connectedInstances?: number; totalInstances?: number; errorKind?: string | null; errorMessage?: string | null } | null;
  lastReceivedAt?: string | null;
  ratePerMin?: number | null;
  decodeErrorRate1h?: number | null;
  isDev?: boolean;
  version: number;
  updatedAt?: string;
}

/** 비율(0~1 소수, `*Rate`)을 퍼센트 문자열로 */
export function percent(rate: number | null | undefined): string {
  if (rate === null || rate === undefined || Number.isNaN(rate)) return "–";
  // `*Rate`는 0~1 소수(API-DSC-01·ING 문서). 100을 곱해 퍼센트로
  const value = rate * 100;
  return `${Math.round(value * 10) / 10}%`;
}

/** 스파크라인 SVG 경로(0~1 정규화). 값이 없으면 빈 문자열 */
export function sparklinePath(values: number[] | null | undefined, width = 60, height = 16): string {
  if (!values || values.length < 2) return "";
  const max = Math.max(...values, 1);
  const step = width / (values.length - 1);
  return values.map((v, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${(height - (v / max) * height).toFixed(1)}`).join(" ");
}

/** 상태 탭 기간(최대 7일, TC-DSC-076) */
export const STAT_RANGES = ["1h", "24h", "7d"] as const;

export function statBucket(range: string): "1m" | "5m" | "1h" {
  return range === "1h" ? "1m" : range === "24h" ? "5m" : "1h";
}

export const STAT_SERIES = ["received", "accepted", "decodeErrors", "scriptErrors", "rejectedUnknown", "invalid"] as const;

export interface TestStep {
  name: string;
  status: "OK" | "FAILED" | "FAIL" | "SKIPPED" | string;
  ms?: number | null;
  code?: string | null;
  detail?: string | null;
  tlsChain?: { subject?: string; issuer?: string; notAfter?: string }[] | null;
}

export interface TestPreview {
  at: string;
  topic: string;
  size: number;
  rawExcerpt: string;
  decoded?: { externalId?: string | null; metrics?: { key: string; value: unknown; unit?: string | null }[] } | Record<string, unknown> | null;
}

export interface TestResult {
  ok?: boolean;
  /** 처음 실패한 단계 이름 */
  stage?: string | null;
  steps: TestStep[];
  preview: TestPreview[];
  lossPossible?: boolean;
}

/** 연결 테스트 결과 판정(UI-DSC-09): 실패 / 부분 성공(구독 성공·메시지 없음, TC-DSC-268) / 성공 */
export function testOutcome(result: TestResult): "failed" | "partial" | "success" {
  if (result.ok === false && result.steps.length === 0) return "failed";
  if (result.steps.some((s) => isFailedStep(s.status))) return "failed";
  if (result.preview.length === 0) return "partial";
  return "success";
}

/** 커넥터 템플릿 preset(API-DSC-56) */
export interface MqttPreset {
  connection?: Record<string, unknown>;
  topics?: { topic: string; qos: number }[];
  decoderKey?: string | null;
  decoderConfig?: unknown;
}

const str = (v: unknown, fallback: string) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : fallback);

/** MQTT 템플릿 preset → 기본 폼 값(TC-DSC-309: 주소·헤더 Basic·토픽·QoS가 채워지고 비밀번호만 빈칸) */
export function mqttFromPreset(initial: SourceFormValues, preset: MqttPreset): SourceFormValues {
  const c = preset.connection ?? {};
  return {
    ...initial,
    url: str(c.url, initial.url),
    protocolVersion: c.protocolVersion === "3.1.1" ? "3.1.1" : initial.protocolVersion,
    qos: typeof c.qos === "number" ? c.qos : initial.qos,
    keepaliveSec: str(c.keepaliveSec, initial.keepaliveSec),
    cleanStart: typeof c.cleanStart === "boolean" ? c.cleanStart : initial.cleanStart,
    auth: str(c.auth, initial.auth),
    headerName: str(c.headerName, initial.headerName),
    headerScheme: str(c.headerScheme, initial.headerScheme),
    username: str(c.username, initial.username),
    topics: preset.topics?.length ? preset.topics : initial.topics,
    decoderKey: preset.decoderKey ?? initial.decoderKey,
    decoderConfig: preset.decoderConfig ? JSON.stringify(preset.decoderConfig, null, 2) : initial.decoderConfig,
  };
}

