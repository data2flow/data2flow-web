/**
 * 카탈로그 커넥터 소스(type CONNECTOR, Webhook 수신은 WEBHOOK) 폼 값과 저장 본문(API-DSC-02·04·58, DSC-09.01·09.05·09.06·01.03).
 * 연결 설정은 커넥터 스키마 그대로(`connection`), 비밀값은 인증 방식 매트릭스의 종류별 쓰기 전용 값.
 */
import { DECODERS } from "./source";
import { authChoices, authField, defaultsOf, getPath, missingSecrets, prune, secretKindsFor, splitSecrets, tlsFrom, validateConnection, validateTls, type ConnectorSchema, type SchemaErrors, type SchemaValue } from "./schema-form";

export interface ConnectorFormValues {
  code: string;
  name: string;
  type: "CONNECTOR" | "WEBHOOK";
  connectorKey: string;
  isDev: boolean;
  connection: SchemaValue;
  /** 저장하지 않는 인증 방식 선택(스키마에 auth 필드가 없을 때 비밀값 칸만 바꾼다) */
  authMethod: string;
  secrets: Record<string, string>;
  decoderKey: string;
  decoderConfig: string;
  decodeScriptId: string;
  unknownDevicePolicy: string;
  defaultModelId: string;
  defaultSpaceId: string;
  autoregLimitPerHour: string;
  noDataAlarmAfterSec: string;
}

/** 커넥터별 기본 디코더(Sparkplug B는 Protobuf payload를 pipeline sparkplug-b 디코더가 푼다) */
export const CONNECTOR_DECODERS: Record<string, string> = { "sparkplug-b": "sparkplug-b" };

export function decoderChoices(connectorKey: string, current?: string): string[] {
  const list: string[] = [...DECODERS];
  const extra = CONNECTOR_DECODERS[connectorKey];
  if (extra && !list.includes(extra)) list.unshift(extra);
  if (current && !list.includes(current)) list.unshift(current);
  return list;
}

export interface TemplatePresetLike {
  connection?: SchemaValue;
  decoderKey?: string | null;
  decoderConfig?: unknown;
}

export function sourceTypeOf(connectorKey: string): "CONNECTOR" | "WEBHOOK" {
  return connectorKey === "webhook" ? "WEBHOOK" : "CONNECTOR";
}

export function emptyConnectorForm(schema: ConnectorSchema, supportedAuth: string[], preset?: TemplatePresetLike | null): ConnectorFormValues {
  const connection = defaultsOf(schema.jsonSchema, preset?.connection ?? {});
  const { methods } = authChoices(schema, supportedAuth);
  const field = authField(schema);
  const storedMethod = field ? getPath(connection, field.path) : undefined;
  const authMethod = typeof storedMethod === "string" ? storedMethod : (methods[0] ?? "NONE");
  return {
    code: "",
    name: "",
    type: sourceTypeOf(schema.key),
    connectorKey: schema.key,
    isDev: false,
    connection,
    authMethod,
    secrets: {},
    decoderKey: preset?.decoderKey ?? CONNECTOR_DECODERS[schema.key] ?? "generic-json",
    decoderConfig: preset?.decoderConfig ? JSON.stringify(preset.decoderConfig, null, 2) : "",
    decodeScriptId: "",
    unknownDevicePolicy: "AUTO_REGISTER",
    defaultModelId: "",
    defaultSpaceId: "",
    autoregLimitPerHour: "100",
    noDataAlarmAfterSec: "600",
  };
}

export interface ConnectorSourceDetail {
  id: string;
  code: string;
  name: string;
  type: string;
  connectorKey?: string | null;
  connection?: SchemaValue | null;
  isDev?: boolean;
  secrets?: { kind: string; configured: boolean; fingerprint?: string | null; certificateExpiresAt?: string | null }[] | null;
  decoderKey?: string;
  decoderConfig?: unknown;
  decodeScriptId?: string | null;
  unknownDevicePolicy?: string;
  defaultModelId?: string | null;
  defaultSpaceId?: string | null;
  autoregLimitPerHour?: number;
  noDataAlarmAfterSec?: number;
}

export function connectorFormFromSource(schema: ConnectorSchema, supportedAuth: string[], source: ConnectorSourceDetail): ConnectorFormValues {
  const base = emptyConnectorForm(schema, supportedAuth);
  const connection = { ...(source.connection ?? {}) };
  const { methods } = authChoices(schema, supportedAuth);
  const field = authField(schema);
  const storedMethod = field ? getPath(connection, field.path) : undefined;
  const configured = (source.secrets ?? []).filter((s) => s.configured).map((s) => s.kind);
  // 저장되지 않는 방식 선택은 저장된 비밀값 종류가 필수인 방식으로 되살린다
  const guessed = methods.find((m) => {
    const req = secretKindsFor(schema, m).required;
    return req.length > 0 && req.every((k) => configured.includes(k));
  });
  return {
    ...base,
    code: source.code,
    name: source.name,
    isDev: Boolean(source.isDev),
    connection,
    authMethod: typeof storedMethod === "string" ? storedMethod : (guessed ?? base.authMethod),
    decoderKey: source.decoderKey ?? base.decoderKey,
    decoderConfig: source.decoderConfig ? JSON.stringify(source.decoderConfig, null, 2) : "",
    decodeScriptId: source.decodeScriptId ?? "",
    unknownDevicePolicy: source.unknownDevicePolicy ?? "AUTO_REGISTER",
    defaultModelId: source.defaultModelId ?? "",
    defaultSpaceId: source.defaultSpaceId ?? "",
    autoregLimitPerHour: String(source.autoregLimitPerHour ?? 100),
    noDataAlarmAfterSec: String(source.noDataAlarmAfterSec ?? 600),
  };
}

const CODE = /^[a-z][a-z0-9-]{1,49}$/;
const intIn = (raw: string, min: number, max: number) => /^\d+$/.test(raw.trim()) && Number(raw) >= min && Number(raw) <= max;

/** 전체 검사. 연결은 스키마 경로(`connection.` 접두사), 그 밖은 필드 이름. 값은 오류 코드 */
export function validateConnectorForm(schema: ConnectorSchema, supportedAuth: string[], values: ConnectorFormValues, options: { editing?: boolean; configuredSecrets?: string[] } = {}): SchemaErrors {
  const errors: SchemaErrors = {};
  if (!options.editing && !CODE.test(values.code)) errors.code = "code";
  if (!values.name.trim() || values.name.trim().length > 100) errors.name = "name";
  for (const [path, code] of Object.entries(validateConnection(schema, values.connection))) errors[`connection.${path}`] = code;
  if (values.connection.tlsInsecure === true && !values.isDev) errors["connection.tlsInsecure"] = "tlsDevOnly";
  if ("tls" in (schema.jsonSchema.properties ?? {}) && Object.keys(validateTls(tlsFrom(values.connection.tls))).length > 0) errors["connection.tls"] = "tls";
  const required = values.type === "WEBHOOK" ? [] : secretKindsFor(schema, authMethodOf(schema, supportedAuth, values)).required;
  // 새 소스는 필수 비밀값이 모두 있어야 활성화할 수 있다. 초안 저장은 비밀값 없이도 되지만 화면은 미리 알린다(활성화 버튼만 막음)
  for (const kind of missingSecrets(required, values.secrets, options.configuredSecrets ?? [])) errors[`secret.${kind}`] = "secret";
  if (values.decoderKey === "script" && !values.decodeScriptId) errors.decodeScriptId = "script";
  if (!values.decoderKey.trim() || values.decoderKey.length > 30) errors.decoderKey = "decoder";
  if (!intIn(values.autoregLimitPerHour, 0, 10000)) errors.autoregLimitPerHour = "autoreg";
  if (!intIn(values.noDataAlarmAfterSec, 60, 86400)) errors.noDataAlarmAfterSec = "noData";
  return errors;
}

/** 저장(초안)을 막는 오류: 비밀값 누락은 활성화만 막는다 */
export function blocksDraft(errors: SchemaErrors): boolean {
  return Object.keys(errors).some((k) => !k.startsWith("secret."));
}

export function authMethodOf(schema: ConnectorSchema, _supportedAuth: string[], values: ConnectorFormValues): string {
  const field = authField(schema);
  if (!field) return values.authMethod;
  const stored = getPath(values.connection, field.path);
  return typeof stored === "string" && stored ? stored : (values.authMethod ?? "NONE");
}

function parseJson(raw: string): unknown {
  if (!raw.trim()) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/** API-DSC-02 생성 본문과 저장 뒤 보낼 비밀값(API-DSC-58) */
export function connectorCreateBody(schema: ConnectorSchema, supportedAuth: string[], values: ConnectorFormValues, activate: boolean): { body: Record<string, unknown>; extras: { kind: string; value: string }[] } {
  const { primary, extras } = splitSecrets(authMethodOf(schema, supportedAuth, values), values.secrets);
  return {
    body: {
      code: values.code.trim(),
      type: values.type,
      ...connectorUpdateBody(schema, values),
      ...(primary ? { secret: primary } : {}),
      activate,
    },
    extras,
  };
}

/** API-DSC-04 수정 본문(비밀값은 API-DSC-58로 따로) */
export function connectorUpdateBody(schema: ConnectorSchema, values: ConnectorFormValues): Record<string, unknown> {
  return {
    name: values.name.trim(),
    connectorKey: values.connectorKey,
    isDev: values.isDev,
    connection: prune(schema, values.connection),
    decoderKey: values.decoderKey,
    decoderConfig: values.decoderKey === "generic-json" || values.decoderKey === "single-value" ? parseJson(values.decoderConfig) : undefined,
    decodeScriptId: values.decoderKey === "script" ? values.decodeScriptId : undefined,
    unknownDevicePolicy: values.unknownDevicePolicy,
    defaultModelId: values.defaultModelId || null,
    defaultSpaceId: values.defaultSpaceId || null,
    autoregLimitPerHour: Number(values.autoregLimitPerHour),
    noDataAlarmAfterSec: Number(values.noDataAlarmAfterSec),
  };
}

/** API-DSC-57 연결 테스트 본문(저장 안 함) */
export function connectorTestBody(schema: ConnectorSchema, supportedAuth: string[], values: ConnectorFormValues): Record<string, unknown> {
  const { body } = connectorCreateBody(schema, supportedAuth, values, false);
  return { ...body, activate: undefined };
}

/** 폴링형 커넥터(첫 폴링 단계, TC-DSC-301): 확장 방식 SINGLETON이고 MQTT·큐가 아닌 것 */
export function isPolling(connectorKey: string): boolean {
  return ["http-poll", "modbus-tcp", "bacnet-ip", "onem2m", "opcua", "file-s3", "coap"].includes(connectorKey);
}
