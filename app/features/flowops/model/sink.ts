/**
 * UI-FLW-08 Sink 저장소 연결(FLW-04.01, API-FLW-50·51, BR-FLW-27·28): 폼 값 읽기·검증·요청 본문.
 * 비밀값(사용자·비밀번호·토큰)은 쓰기 전용이다. 저장 후에는 다시 보여 주지 않고, 수정 때 비워 두면 서버 값을 그대로 둔다.
 */
export const SINK_TYPES = ["POSTGRESQL", "MYSQL", "INFLUXDB"] as const;
export type SinkType = (typeof SINK_TYPES)[number];
export const TEST_ERROR_KINDS = ["AUTH", "DNS", "TLS", "TIMEOUT", "OTHER"] as const;
export const DEFAULT_PORTS: Record<SinkType, number> = { POSTGRESQL: 5432, MYSQL: 3306, INFLUXDB: 8086 };

export interface SinkConfig {
  host: string;
  port: number;
  database?: string;
  bucket?: string;
  org?: string;
  tls: boolean;
}

export interface SinkConnection {
  sinkConnectionId: string;
  name: string;
  type: SinkType;
  config?: Partial<SinkConfig>;
  status: "OK" | "ERROR" | "UNTESTED";
  lastError?: string | null;
  usedFlowCount?: number;
  version?: number;
  updatedAt?: string;
}

export interface SinkTestResult {
  ok: boolean;
  latencyMs?: number;
  error?: { kind: string; message?: string } | null;
}

/** 화면 폼 값(문자열 그대로 — 실패하면 다시 채워 보여 준다) */
export interface SinkFormValues {
  name: string;
  type: SinkType;
  host: string;
  port: string;
  database: string;
  bucket: string;
  org: string;
  tls: boolean;
  username: string;
  password: string;
  token: string;
}

export type SinkFieldErrors = Partial<Record<keyof SinkFormValues, string>>;

const str = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
};

export function emptySinkForm(type: SinkType = "POSTGRESQL"): SinkFormValues {
  return { name: "", type, host: "", port: String(DEFAULT_PORTS[type]), database: "", bucket: "", org: "", tls: true, username: "", password: "", token: "" };
}

export function sinkFormFrom(connection: SinkConnection): SinkFormValues {
  const c = connection.config ?? {};
  return {
    ...emptySinkForm(connection.type),
    name: connection.name,
    host: c.host ?? "",
    port: c.port === undefined ? String(DEFAULT_PORTS[connection.type]) : String(c.port),
    database: c.database ?? "",
    bucket: c.bucket ?? "",
    org: c.org ?? "",
    tls: c.tls ?? true,
  };
}

export function readSinkForm(form: FormData): SinkFormValues {
  const rawType = str(form, "type");
  const type = (SINK_TYPES as readonly string[]).includes(rawType) ? (rawType as SinkType) : "POSTGRESQL";
  return {
    name: str(form, "name"),
    type,
    host: str(form, "host"),
    port: str(form, "port"),
    database: str(form, "database"),
    bucket: str(form, "bucket"),
    org: str(form, "org"),
    tls: form.get("tls") === "on" || form.get("tls") === "true",
    username: str(form, "username"),
    // 비밀번호·토큰은 앞뒤 공백도 값일 수 있다
    password: typeof form.get("password") === "string" ? (form.get("password") as string) : "",
    token: typeof form.get("token") === "string" ? (form.get("token") as string) : "",
  };
}

/**
 * 검증(UI-FLW-08: 호스트·포트 필수). `mode`가 create면 비밀값이 필요하고, update면 비워 둘 수 있다(서버 값 유지).
 * `test`는 저장 전 연결 테스트 — 이름 없이도 시험할 수 있다.
 */
export function validateSinkForm(values: SinkFormValues, mode: "create" | "update" | "test"): SinkFieldErrors {
  const errors: SinkFieldErrors = {};
  if (mode !== "test" && (values.name.length < 1 || values.name.length > 100)) errors.name = "required";
  if (!values.host) errors.host = "required";
  else if (values.host.length > 255 || /\s/.test(values.host)) errors.host = "invalid";
  const port = Number(values.port);
  if (!values.port) errors.port = "required";
  else if (!Number.isInteger(port) || port < 1 || port > 65535) errors.port = "range";
  if (values.type === "INFLUXDB") {
    if (!values.bucket) errors.bucket = "required";
    if (!values.org) errors.org = "required";
    if (mode !== "update" && !values.token) errors.token = "required";
  } else {
    if (!values.database) errors.database = "required";
    if (mode !== "update" && !values.username) errors.username = "required";
    if (mode !== "update" && !values.password) errors.password = "required";
  }
  return errors;
}

export function sinkConfigOf(values: SinkFormValues): SinkConfig {
  const config: SinkConfig = { host: values.host, port: Number(values.port), tls: values.tls };
  if (values.type === "INFLUXDB") {
    config.bucket = values.bucket;
    config.org = values.org;
  } else config.database = values.database;
  return config;
}

/** 비밀값 본문. 수정 때 아무것도 입력하지 않았으면 undefined(서버 값 유지) */
export function sinkSecretOf(values: SinkFormValues): Record<string, string> | undefined {
  if (values.type === "INFLUXDB") return values.token ? { token: values.token } : undefined;
  if (!values.username && !values.password) return undefined;
  const secret: Record<string, string> = {};
  if (values.username) secret.username = values.username;
  if (values.password) secret.password = values.password;
  return secret;
}

/** API-FLW-50 생성 본문 */
export function createSinkBody(values: SinkFormValues) {
  return { name: values.name, type: values.type, config: sinkConfigOf(values), secret: sinkSecretOf(values) ?? {} };
}

/** API-FLW-50 수정(PATCH) 본문: 비밀값은 바꿀 때만 */
export function updateSinkBody(values: SinkFormValues, baseVersion: number) {
  const body: Record<string, unknown> = { name: values.name, config: sinkConfigOf(values), baseVersion };
  const secret = sinkSecretOf(values);
  if (secret) body.secret = secret;
  return body;
}

/** API-FLW-51 저장 전 연결 테스트 본문 */
export function testSinkBody(values: SinkFormValues) {
  return { type: values.type, config: sinkConfigOf(values), secret: sinkSecretOf(values) ?? {} };
}

/** 폼을 다시 그릴 때 비밀값은 돌려보내지 않는다 */
export function withoutSecrets(values: SinkFormValues): SinkFormValues {
  return { ...values, password: "", token: "" };
}

/**
 * 연결 테스트 실패 원인. 200 `{ok:false, error:{kind}}`와 502 `SINK_CONNECTION_TEST_FAILED`(TC-FLW-083, 메시지 "연결할 수 없습니다: {원인}") 둘 다 받는다.
 */
export function testFailureKind(result: SinkTestResult | null | undefined, message?: string): string {
  const kind = result?.error?.kind;
  if (kind && (TEST_ERROR_KINDS as readonly string[]).includes(kind)) return kind;
  const fromMessage = TEST_ERROR_KINDS.find((k) => message?.toUpperCase().includes(k));
  return fromMessage ?? "OTHER";
}

/** 대상 테이블·측정 이름(스키마 확인): 영문·숫자·밑줄·점, 1~128자 */
export function isValidTarget(target: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_.]{0,127}$/.test(target);
}
