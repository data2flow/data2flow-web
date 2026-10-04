/**
 * M5 데이터 소스 화면 모델: 커넥터 스키마 폼(DSC-09.01, BR-DSC-22)·인증 방식 매트릭스(DSC-09.05)·TLS(DSC-09.06)·토픽 템플릿(DSC-09.08)·
 * 커넥터 소스 본문(API-DSC-02·58)·출력 연결(DSC-04.01, BR-DSC-19)·엣지(DSC-08.03).
 */
import { describe, expect, it } from "vitest";
import SCHEMAS from "../../../../../test/msw/connector-schemas.json";
import { authMethodOf, blocksDraft, connectorCreateBody, connectorFormFromSource, connectorTestBody, decoderChoices, emptyConnectorForm, isPolling, sourceTypeOf, validateConnectorForm } from "../connector-source";
import { bufferPercent, compactCount, edgeActions, edgeTone, parseConfigVersion } from "../edge";
import { checkTopicTemplate, emptyOutput, filterSummary, outputBody, outputForm, renderTopic, statTotals, unknownTemplateVars, validateOutput } from "../output";
import {
  authChoices,
  authMatrixRows,
  conditionsOf,
  defaultsOf,
  getPath,
  isPrivateKeyPem,
  isSecretField,
  isVisible,
  missingSecrets,
  newItem,
  parseNumberInput,
  pemCount,
  prune,
  schemaTabs,
  secretKindsFor,
  serverErrorsToPaths,
  setPath,
  splitSecrets,
  tlsBody,
  tlsFrom,
  typeOf,
  validateConnection,
  validateSchema,
  validateTls,
  type ConnectorSchema,
  type JsonSchema,
} from "../schema-form";
import { emptyForm, extraSecrets, mqttFromPreset, updateBody, validateForm } from "../source";
import { applyTopicRefs, matchTopic, parseTopicTemplate, roleOf, subscriptionFilter, topicRefs } from "../topic-template";

const schemas = SCHEMAS as unknown as Record<string, JsonSchema>;
const connector = (key: string, extra: Partial<ConnectorSchema> = {}): ConnectorSchema => ({ key, version: "1.0.0", jsonSchema: schemas[key], uiHints: schemas[key]["x-ui"], ...extra });

describe("DSC-09.01 커넥터 스키마 폼(BR-DSC-22, core JsonSchemaLite와 같은 규칙)", () => {
  it("TC-DSC-232 22종 스키마 모두 탭을 만들고, 탭에 없는 필드는 기타 탭, 서버 필드(webhook sourceKey)·auth·tls는 폼 탭에서 빠진다", () => {
    for (const key of Object.keys(schemas)) {
      const tabs = schemaTabs(connector(key));
      expect(tabs.length, key).toBeGreaterThan(0);
      const fields = tabs.flatMap((t) => t.fields);
      expect(new Set(fields).size).toBe(fields.length);
      expect(fields).not.toContain("auth");
    }
    expect(schemaTabs(connector("webhook")).flatMap((t) => t.fields)).toEqual(["toleranceSec", "idHeader", "topic"]);
    expect(schemaTabs({ key: "x", jsonSchema: { type: "object", properties: { a: { type: "string" } } } })).toEqual([{ name: "connection", fields: ["a"] }]);
    expect(schemaTabs({ key: "x", jsonSchema: { type: "object", properties: { a: { type: "string" }, b: { type: "string" } } }, uiHints: { tabs: [{ name: "main", fields: ["a", "zz"] }] } })).toEqual([
      { name: "main", fields: ["a"] },
      { name: "other", fields: ["b"] },
    ]);
  });

  it("기본값·템플릿 preset, 형식 판정, 비밀 필드", () => {
    const modbus = defaultsOf(schemas["modbus-tcp"]);
    expect(modbus).toMatchObject({ port: 502, unitId: 1, mode: "snapshot", intervalSec: 60 });
    expect(defaultsOf(schemas.kafka, { bootstrapServers: "k:9093" }).bootstrapServers).toBe("k:9093");
    expect(defaultsOf({ type: "object", required: ["o"], properties: { o: { type: "object", properties: { n: { type: "integer", default: 3 } } } } })).toEqual({ o: { n: 3 } });
    expect(typeOf({ type: ["null", "integer"] })).toBe("integer");
    expect(typeOf({ properties: {} })).toBe("object");
    expect(typeOf({ enum: [1, 2] })).toBe("integer");
    expect(typeOf({ enum: ["a"] })).toBe("string");
    expect(typeOf({})).toBe("string");
    expect(isSecretField({ writeOnly: true })).toBe(true);
    expect(isSecretField({ format: "password" })).toBe(true);
    expect(isSecretField({ type: "string" })).toBe(false);
  });

  it("검사: 필수·형식·enum·pattern·길이·범위·개수·모르는 필드(UNKNOWN_FIELD)·배열 항목 경로", () => {
    const errors = validateConnection(connector("modbus-tcp"), { host: "", port: 70000, unitId: 1.5, mode: "bad", extra: 1, points: [{ name: "temp sensor!", register: "40001" }] });
    expect(errors).toEqual({ host: "NotNull", port: "Max", unitId: "Type", mode: "INVALID", extra: "UNKNOWN_FIELD" });
    expect(validateConnection(connector("modbus-tcp"), { host: "h", mode: "snapshot", points: [{ name: "temp sensor!", register: "40001" }] })).toEqual({ "points[0].name": "Pattern" });
    expect(validateConnection(connector("modbus-tcp"), { host: "10.0.0.1" })).toEqual({});
    expect(validateSchema({ type: "string", minLength: 3 }, "ab")).toEqual({ "": "Size" });
    expect(validateSchema({ type: "string", maxLength: 1 }, "ab")).toEqual({ "": "Size" });
    expect(validateSchema({ type: "integer", minimum: 10 }, 5)).toEqual({ "": "Min" });
    expect(validateSchema({ type: "array", minItems: 1 }, [])).toEqual({ "": "Size" });
    expect(validateSchema({ type: "array", maxItems: 1, items: { type: "string" } }, ["a", 2])).toEqual({ "": "Size", "[1]": "Type" });
    expect(validateSchema({ const: "x" }, "y")).toEqual({ "": "INVALID" });
    expect(validateSchema({ type: "boolean" }, true)).toEqual({});
    expect(validateSchema({ type: "number" }, Number.NaN)).toEqual({ "": "Type" });
    expect(validateSchema({ type: "weird" }, 1)).toEqual({});
    expect(validateSchema({ type: "string", pattern: "(" }, "x")).toEqual({});
    expect(validateSchema({ type: "object", required: ["a"], properties: { a: { type: "integer" } } }, { a: 0 })).toEqual({});
    // webhook sourceKey는 필수지만 서버가 만든다
    expect(validateConnection(connector("webhook"), { toleranceSec: 300 })).toEqual({});
  });

  it("조건부 필드: 인증 방식별 사용자 이름, Kafka SASL, Modbus 기록 모드 — 숨긴 필드는 본문에서도 빠진다", () => {
    const sparkplug = connector("sparkplug-b");
    const cond = conditionsOf(sparkplug);
    expect(isVisible("username", { auth: "NONE" }, cond)).toBe(false);
    expect(isVisible("username", { auth: "USERPASS" }, cond)).toBe(true);
    expect(prune(sparkplug, { url: "tcp://b:1883", auth: "NONE", username: "u", groupId: "" })).toEqual({ url: "tcp://b:1883", auth: "NONE" });
    const modbus = connector("modbus-tcp");
    expect(isVisible("log", { mode: "snapshot" }, conditionsOf(modbus))).toBe(false);
    expect(isVisible("log", { mode: "log" }, conditionsOf(modbus))).toBe(true);
    expect(isVisible("saslMechanism", { securityProtocol: "PLAINTEXT" }, conditionsOf(connector("kafka")))).toBe(false);
    expect(conditionsOf({ key: "x", jsonSchema: { properties: { a: {}, b: {} } }, uiHints: { conditions: { a: { field: "b", in: [true] } } } })).toEqual({ a: { field: "b", in: [true] } });
    expect(prune(connector("webhook"), { sourceKey: "abc", topic: "t", nested: { a: "", b: [""] } })).toEqual({ topic: "t" });
  });

  it("경로 읽기·쓰기, 숫자 입력, 새 배열 항목, 서버 오류 경로", () => {
    let v = setPath({}, "points[0].name", "t1");
    v = setPath(v, "log.ringSize", 100);
    expect(v).toEqual({ points: [{ name: "t1" }], log: { ringSize: 100 } });
    expect(getPath(v, "points[0].name")).toBe("t1");
    expect(getPath(v, "missing.x")).toBeUndefined();
    expect(setPath({ a: [1, 2, 3] }, "a[1]", undefined)).toEqual({ a: [1, 3] });
    expect(setPath({ a: 1, b: 2 }, "a", undefined)).toEqual({ b: 2 });
    expect(parseNumberInput("", true)).toBeUndefined();
    expect(parseNumberInput("12", true)).toBe(12);
    expect(parseNumberInput("1.5", true)).toBe("1.5");
    expect(parseNumberInput("1.5", false)).toBe(1.5);
    expect(newItem({ type: "object", properties: { qos: { type: "integer", default: 1 } } })).toEqual({ qos: 1 });
    expect(newItem({ type: "integer" })).toBeUndefined();
    expect(newItem({ type: "boolean" })).toBe(false);
    expect(newItem({ enum: ["A", "B"] })).toBe("A");
    expect(newItem({ type: "string", default: "x" })).toBe("x");
    expect(newItem(undefined)).toBe("");
    expect(serverErrorsToPaths([{ field: "connection.port", code: "Max" }, { field: "code", code: "Pattern" }])).toEqual({ port: "Max", code: "Pattern" });
    expect(serverErrorsToPaths(undefined)).toEqual({});
  });
});

describe("DSC-09.05 인증 방식 매트릭스", () => {
  it("TC-DSC-269 스키마 auth enum이 있으면 저장되는 방식, 없으면 지원 방식으로 비밀값 칸만, 응답 매트릭스가 기본값보다 우선, CA_CERT는 언제나 선택", () => {
    expect(authChoices(connector("sparkplug-b"), ["NONE", "USER_PASSWORD", "MTLS"])).toEqual({ methods: ["NONE", "USERPASS", "MTLS"], stored: true });
    expect(authChoices(connector("kafka"), ["NONE", "SASL_SCRAM_512"])).toEqual({ methods: ["NONE", "SASL_SCRAM_512"], stored: false });
    expect(authChoices(connector("kafka"), [])).toEqual({ methods: ["NONE"], stored: false });
    expect(secretKindsFor(connector("kafka"), "SASL_SCRAM_512")).toEqual({ required: ["PASSWORD"], optional: ["CA_CERT"] });
    expect(secretKindsFor(connector("azure-iot-hub", { authSecretKinds: { TOKEN: { required: ["SAS_KEY"], optional: [] } } }), "TOKEN")).toEqual({ required: ["SAS_KEY"], optional: ["CA_CERT"] });
    expect(secretKindsFor(connector("x" in schemas ? "x" : "coap"), "UNKNOWN")).toEqual({ required: [], optional: ["CA_CERT"] });
    const rows = authMatrixRows(connector("http-poll"), ["NONE", "USER_PASSWORD", "TOKEN", "OAUTH2_CC", "MTLS"]);
    expect(rows.find((r) => r.method === "MTLS")).toEqual({ method: "MTLS", required: ["CLIENT_CERT", "CLIENT_KEY"], optional: ["CA_CERT"] });
    expect(rows.map((r) => r.method)).toContain("OAUTH2_CC");
    expect(missingSecrets(["PASSWORD", "TOKEN"], { PASSWORD: " " }, ["TOKEN"])).toEqual(["PASSWORD"]);
  });

  it("비밀값 나누기: mTLS는 {cert,key,ca} 한 건, 그 밖에는 필수 종류 하나 + 나머지는 API-DSC-58", () => {
    expect(splitSecrets("MTLS", { CLIENT_CERT: "c", CLIENT_KEY: "k", CA_CERT: "ca", TOKEN: "t" })).toEqual({ primary: { cert: "c", key: "k", ca: "ca" }, extras: [{ kind: "TOKEN", value: "t" }] });
    expect(splitSecrets("MTLS", { CLIENT_CERT: "c", CLIENT_KEY: "k" }).primary).toEqual({ cert: "c", key: "k" });
    expect(splitSecrets("SASL_SCRAM_512", { CA_CERT: "ca", PASSWORD: "p" })).toEqual({ primary: { kind: "PASSWORD", value: "p" }, extras: [{ kind: "CA_CERT", value: "ca" }] });
    expect(splitSecrets("NONE", { CA_CERT: "ca" })).toEqual({ primary: { kind: "CA_CERT", value: "ca" }, extras: [] });
    expect(splitSecrets("NONE", { PASSWORD: "" })).toEqual({ primary: null, extras: [] });
  });
});

describe("DSC-09.06 TLS 설정(BR-DSC-29)", () => {
  it("TC-DSC-274 최소 1.2·1.3, SNI 호스트 이름, 고정 지문 SHA-256 최대 5개, PEM 개수", () => {
    expect(tlsFrom({ minVersion: "1.3", sni: "h", pinnedSha256: ["a"] })).toEqual({ minVersion: "1.3", sni: "h", pinnedSha256: ["a"] });
    expect(tlsFrom({ minVersion: "1.0" }).minVersion).toBe("");
    expect(tlsFrom(null)).toEqual({ minVersion: "", sni: "", pinnedSha256: [] });
    const hex = "a".repeat(64);
    expect(validateTls({ minVersion: "1.2", sni: "iot-data.java21.net", pinnedSha256: [hex, `sha256/${"B".repeat(43)}=`] })).toEqual({});
    expect(validateTls({ minVersion: "", sni: "bad host!", pinnedSha256: ["xyz", ...Array(5).fill(hex)] })).toMatchObject({ sni: "sni", pinnedSha256: "pinCount", "pinnedSha256[0]": "pin" });
    expect(tlsBody({ minVersion: "", sni: " ", pinnedSha256: [" "] })).toBeUndefined();
    expect(tlsBody({ minVersion: "1.2", sni: "h", pinnedSha256: [hex] })).toEqual({ minVersion: "1.2", sni: "h", pinnedSha256: [hex] });
    const pem = "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----";
    expect(pemCount(`${pem}\n${pem}`)).toBe(2);
    expect(pemCount("nope")).toBe(0);
    expect(isPrivateKeyPem("-----BEGIN EC PRIVATE KEY-----\nx\n-----END EC PRIVATE KEY-----")).toBe(true);
  });

  it("MQTT 구독: connection.tls 저장, mTLS는 {cert,key,ca} 한 건, 그 밖의 CA는 저장 뒤 API-DSC-58", () => {
    const base = { ...emptyForm("MQTT_SUBSCRIBE", "mqtt"), code: "lab", name: "실습실", url: "ssl://h:8883", topics: [{ topic: "a", qos: 1 }] };
    const body = updateBody({ ...base, auth: "MTLS", tls: { minVersion: "1.3", sni: "", pinnedSha256: [] }, tlsSecrets: { CLIENT_CERT: "c", CLIENT_KEY: "k", CA_CERT: "ca" } });
    expect((body.connection as Record<string, unknown>).tls).toEqual({ minVersion: "1.3" });
    expect(body.secret).toEqual({ cert: "c", key: "k", ca: "ca" });
    expect(extraSecrets({ ...base, auth: "MTLS", tlsSecrets: { CLIENT_CERT: "c", CLIENT_KEY: "k", CA_CERT: "ca" } })).toEqual([]);
    expect(extraSecrets({ ...base, auth: "USERPASS", tlsSecrets: { CA_CERT: "ca" } })).toEqual([{ kind: "CA_CERT", value: "ca" }]);
    expect(extraSecrets({ ...emptyForm("SIMULATION", "simulation"), tlsSecrets: { CA_CERT: "ca" } })).toEqual([]);
    expect(validateForm({ ...base, tls: { minVersion: "", sni: "bad host", pinnedSha256: [] } }).tls).toBe("tls");
  });

  it("TC-DSC-309 아카데미 iot-data 템플릿 preset → 주소·헤더 Basic·토픽·QoS·디코더, 비밀번호만 빈칸", () => {
    const filled = mqttFromPreset(emptyForm("MQTT_SUBSCRIBE", "mqtt"), { connection: { url: "wss://iot-data.java21.net:443/mqtt", protocolVersion: "3.1.1", qos: 1, keepaliveSec: 30, cleanStart: true, auth: "HEADER", headerName: "Authorization", headerScheme: "Basic" }, topics: [{ topic: "application/+/device/+/event/up", qos: 1 }], decoderKey: "chirpstack-v4", decoderConfig: { a: 1 } });
    expect(filled).toMatchObject({ url: "wss://iot-data.java21.net:443/mqtt", protocolVersion: "3.1.1", qos: 1, keepaliveSec: "30", cleanStart: true, auth: "HEADER", headerScheme: "Basic", secretValue: "", decoderKey: "chirpstack-v4" });
    expect(mqttFromPreset(emptyForm("MQTT_SUBSCRIBE", "mqtt"), {}).url).toBe("");
  });
});

describe("DSC-09.08 토픽 템플릿(BR-DSC-28)", () => {
  it("TC-DSC-289 site/{site}/room/{room}/{deviceId}/{metric} 추출, 불일치는 미처리, +·#·잘못된 변수·중복 거부", () => {
    const parsed = parseTopicTemplate("site/{site}/room/{room}/{deviceId}/{metric}");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(matchTopic(parsed.levels, "site/gwangju/room/301/em300-01/temperature")).toEqual({ site: "gwangju", room: "301", deviceId: "em300-01", metric: "temperature" });
    expect(matchTopic(parsed.levels, "site/gwangju/hall/301/em300-01/temperature")).toBeNull();
    expect(matchTopic(parsed.levels, "site/gwangju/room/301/em300-01")).toBeNull();
    expect(matchTopic(parsed.levels, "site//room/301/em300-01/t")).toBeNull();
    expect(subscriptionFilter(parsed.levels)).toBe("site/+/room/+/+/+");
    expect(topicRefs(parsed.levels)).toEqual({ deviceIdFrom: "topic[4]", metricFrom: "topic[5]" });
    expect(parseTopicTemplate("")).toEqual({ ok: false, error: "empty" });
    expect(parseTopicTemplate("a/+/b")).toEqual({ ok: false, error: "wildcard", level: 1 });
    expect(parseTopicTemplate("a/x{id}")).toEqual({ ok: false, error: "variable", level: 1 });
    expect(parseTopicTemplate("{a}/{a}")).toEqual({ ok: false, error: "duplicate", level: 1 });
    expect(roleOf("deviceId")).toBe("device");
    expect(roleOf("metric")).toBe("metric");
    expect(roleOf("room")).toBe("space");
    expect(roleOf("x")).toBe("other");
  });

  it("디코더 설정에 토픽 참조를 넣는다(generic-json deviceIdFrom, single-value metricFrom), 잘못된 JSON은 새로 만든다", () => {
    const p = parseTopicTemplate("devices/{deviceId}/{metric}");
    if (!p.ok) throw new Error("parse");
    expect(JSON.parse(applyTopicRefs("generic-json", '{"metrics":[{"path":"$.v","key":"t"}]}', p.levels))).toEqual({ metrics: [{ path: "$.v", key: "t" }], deviceIdFrom: "topic[1]" });
    expect(JSON.parse(applyTopicRefs("single-value", "", p.levels))).toEqual({ deviceIdFrom: "topic[1]", metricFrom: "topic[2]" });
    expect(JSON.parse(applyTopicRefs("generic-json", "{bad", p.levels))).toEqual({ deviceIdFrom: "topic[1]" });
    expect(JSON.parse(applyTopicRefs("generic-json", "[1]", p.levels))).toEqual({ deviceIdFrom: "topic[1]" });
    const noDevice = parseTopicTemplate("a/{room}");
    if (!noDevice.ok) throw new Error("parse");
    expect(topicRefs(noDevice.levels)).toEqual({ deviceIdFrom: null, metricFrom: null });
  });
});

describe("DSC-09.01·09.05 카탈로그 커넥터 소스 본문(API-DSC-02·04·57·58)", () => {
  const kafka = connector("kafka");
  const supported = ["NONE", "SASL_PLAIN", "SASL_SCRAM_256", "SASL_SCRAM_512", "MTLS"];

  it("시작 값: preset·기본값, 유형(CONNECTOR·WEBHOOK), 커넥터별 디코더", () => {
    const form = emptyConnectorForm(kafka, supported, { connection: { bootstrapServers: "k:9093", topics: ["iot"] }, decoderKey: "generic-json", decoderConfig: { deviceIdFrom: "$.id" } });
    expect(form).toMatchObject({ type: "CONNECTOR", connectorKey: "kafka", authMethod: "NONE", decoderKey: "generic-json" });
    expect(form.connection).toMatchObject({ bootstrapServers: "k:9093", topics: ["iot"] });
    expect(JSON.parse(form.decoderConfig)).toEqual({ deviceIdFrom: "$.id" });
    expect(emptyConnectorForm(connector("sparkplug-b"), ["NONE", "USERPASS"]).decoderKey).toBe("sparkplug-b");
    expect(emptyConnectorForm(connector("sparkplug-b"), [], { connection: { auth: "MTLS" } }).authMethod).toBe("MTLS");
    expect(sourceTypeOf("webhook")).toBe("WEBHOOK");
    expect(decoderChoices("sparkplug-b")[0]).toBe("sparkplug-b");
    expect(decoderChoices("kafka", "custom-x")[0]).toBe("custom-x");
    expect(isPolling("http-poll")).toBe(true);
    expect(isPolling("kafka")).toBe(false);
  });

  it("검사: 코드·이름·스키마·TLS 검증 끄기(개발만)·필수 비밀값(활성화만 막음)·스크립트·정책 범위", () => {
    const form = { ...emptyConnectorForm(kafka, supported), code: "kafka-hq", name: "본사 Kafka", authMethod: "SASL_SCRAM_512", connection: { bootstrapServers: "k:9093", topics: ["iot"] } };
    const errors = validateConnectorForm(kafka, supported, form);
    expect(errors).toEqual({ "secret.PASSWORD": "secret" });
    expect(blocksDraft(errors)).toBe(false);
    expect(validateConnectorForm(kafka, supported, form, { configuredSecrets: ["PASSWORD"] })).toEqual({});
    const bad = validateConnectorForm(kafka, supported, { ...form, code: "1x", name: "", connection: { topics: [] }, decoderKey: "script", decodeScriptId: "", autoregLimitPerHour: "x", noDataAlarmAfterSec: "10" });
    expect(bad).toMatchObject({ code: "code", name: "name", "connection.bootstrapServers": "NotNull", "connection.topics": "NotNull", decodeScriptId: "script", autoregLimitPerHour: "autoreg", noDataAlarmAfterSec: "noData" });
    expect(blocksDraft(bad)).toBe(true);
    expect(validateConnectorForm(connector("amqp091"), ["USER_PASSWORD"], { ...emptyConnectorForm(connector("amqp091"), ["USER_PASSWORD"]), code: "rmq", name: "r", connection: { url: "amqps://h", queue: "q", tlsInsecure: true }, secrets: { PASSWORD: "p" } })["connection.tlsInsecure"]).toBe("tlsDevOnly");
    expect(validateConnectorForm(kafka, supported, { ...form, decoderKey: "" }).decoderKey).toBe("decoder");
    const tlsSchema: ConnectorSchema = { key: "t", jsonSchema: { type: "object", properties: { tls: { type: "object" } } } };
    expect(validateConnectorForm(tlsSchema, [], { ...emptyConnectorForm(tlsSchema, []), code: "tt", name: "t", connection: { tls: { sni: "bad host" } } })["connection.tls"]).toBe("tls");
    expect(validateConnectorForm(connector("webhook"), ["TOKEN"], { ...emptyConnectorForm(connector("webhook"), ["TOKEN"]), code: "wh", name: "w" })).toEqual({});
  });

  it("본문: 스키마 값만(빈 칸·숨긴 필드 제외), 첫 비밀값은 secret, 나머지는 API-DSC-58, 테스트 본문은 activate 없음", () => {
    const form = { ...emptyConnectorForm(kafka, supported), code: "kafka-hq", name: " 본사 Kafka ", authMethod: "SASL_SCRAM_512", connection: { bootstrapServers: "k:9093", topics: ["iot", ""], securityProtocol: "PLAINTEXT", saslMechanism: "PLAIN", groupId: "" }, secrets: { PASSWORD: "pw", CA_CERT: "ca" }, decoderConfig: '{"deviceIdFrom":"$.id","metrics":[]}' };
    const { body, extras } = connectorCreateBody(kafka, supported, form, true);
    expect(body).toMatchObject({ code: "kafka-hq", type: "CONNECTOR", connectorKey: "kafka", name: "본사 Kafka", secret: { kind: "PASSWORD", value: "pw" }, activate: true, decoderConfig: { deviceIdFrom: "$.id", metrics: [] } });
    expect(body.connection).toEqual({ bootstrapServers: "k:9093", topics: ["iot"], securityProtocol: "PLAINTEXT" });
    expect(extras).toEqual([{ kind: "CA_CERT", value: "ca" }]);
    expect(connectorTestBody(kafka, supported, form).activate).toBeUndefined();
    expect(connectorCreateBody(kafka, supported, { ...form, secrets: {}, decoderKey: "script", decodeScriptId: "5" }, false).body).toMatchObject({ decodeScriptId: "5", decoderConfig: undefined });
    expect(connectorCreateBody(kafka, supported, { ...form, decoderConfig: "{bad" }, false).body.decoderConfig).toBeUndefined();
    expect(connectorCreateBody(kafka, supported, { ...form, decoderConfig: "" }, false).body.decoderConfig).toBeUndefined();
  });

  it("저장된 소스 → 폼(비밀값 비움, 저장된 비밀값으로 인증 방식 되살림)", () => {
    const back = connectorFormFromSource(kafka, supported, { id: "1", code: "k", name: "K", type: "CONNECTOR", connectorKey: "kafka", connection: { bootstrapServers: "k:9093" }, isDev: true, secrets: [{ kind: "PASSWORD", configured: true }], decoderKey: "generic-json", decoderConfig: { a: 1 }, defaultSpaceId: "31", autoregLimitPerHour: 5, noDataAlarmAfterSec: 120 });
    expect(back).toMatchObject({ code: "k", isDev: true, authMethod: "SASL_PLAIN", secrets: {}, defaultSpaceId: "31", autoregLimitPerHour: "5", noDataAlarmAfterSec: "120" });
    const sp = connectorFormFromSource(connector("sparkplug-b"), ["NONE", "USERPASS", "MTLS"], { id: "2", code: "s", name: "S", type: "CONNECTOR", connection: { auth: "MTLS" } });
    expect(authMethodOf(connector("sparkplug-b"), [], sp)).toBe("MTLS");
    expect(sp).toMatchObject({ decoderKey: "sparkplug-b", decoderConfig: "", unknownDevicePolicy: "AUTO_REGISTER", autoregLimitPerHour: "100" });
  });
});

describe("DSC-04.01 출력 연결(BR-DSC-19)", () => {
  it("TC-DSC-130 토픽 템플릿 변수는 {spaceCode}·{deviceName}·{deviceId}·{metric}만, 와일드카드 금지, 표본 렌더", () => {
    expect(checkTopicTemplate("d2f/{spaceCode}/{deviceName}/{metric}")).toEqual({ ok: true, unknown: [], wildcard: false });
    expect(checkTopicTemplate("d2f/{room}/{deviceId}")).toEqual({ ok: false, unknown: ["room"], wildcard: false });
    expect(checkTopicTemplate("d2f/#").wildcard).toBe(true);
    expect(renderTopic("d2f/{spaceCode}/{deviceName}/{metric}", { spaceCode: "room-301", deviceName: "co2-1" })).toBe("d2f/room-301/co2-1/{metric}");
    expect(unknownTemplateVars("{{deviceName}} {{{value}}} {{bogus}}")).toEqual(["bogus"]);
  });

  it("검사: 이름·URL 스킴·공용 브로커 금지·비밀 헤더·배치 범위·품질·템플릿", () => {
    const mqtt = { ...emptyOutput("MQTT_PUBLISH"), name: "본사", url: "mqtts://hq.example.com:8883" };
    expect(validateOutput(mqtt)).toEqual({});
    expect(validateOutput({ ...mqtt, name: "", url: "https://x" })).toMatchObject({ name: "name", url: "url" });
    expect(validateOutput({ ...mqtt, url: "wss://iot-data.java21.net:443/mqtt" }).url).toBe("forbiddenHost");
    expect(validateOutput({ ...mqtt, topicTemplate: "" }).topicTemplate).toBe("required");
    expect(validateOutput({ ...mqtt, topicTemplate: "a/{x}" }).topicTemplate).toBe("topicVars");
    expect(validateOutput({ ...mqtt, qualityMin: "5", format: "TEMPLATE", template: "" })).toMatchObject({ qualityMin: "quality", template: "required" });
    expect(validateOutput({ ...mqtt, format: "TEMPLATE", template: "x".repeat(9000) }).template).toBe("templateSize");
    const hook = { ...emptyOutput("WEBHOOK"), name: "웹훅", url: "https://example.com/h", headers: [{ name: "X-Org", value: "1" }, { name: "Authorization", value: "x" }, { name: "bad name", value: "" }], batchSize: "0", batchWaitMs: "20000" };
    expect(validateOutput(hook)).toEqual({ headers1: "useSecret", headers2: "headerName", batchSize: "batchSize", batchWaitMs: "batchWait" });
    expect(validateOutput({ ...hook, url: "ftp://x" }).url).toBe("url");
  });

  it("본문·폼 되살리기·필터 요약·지표 합계", () => {
    const body = outputBody({ ...emptyOutput("MQTT_PUBLISH"), name: " 본사 ", url: "mqtts://hq:8883", username: "u", spaceIds: "31, 32", metrics: "co2 temperature", qualityMin: "0", secrets: { PASSWORD: "pw", HMAC_KEY: "x" } });
    expect(body).toMatchObject({ name: "본사", type: "MQTT_PUBLISH", target: { url: "mqtts://hq:8883", username: "u", qos: 1 }, filter: { spaceIds: ["31", "32"], metrics: ["co2", "temperature"], qualityMin: 0, deviceIds: [] }, format: "CANONICAL", template: null, secret: { PASSWORD: "pw" } });
    const hook = outputBody({ ...emptyOutput("WEBHOOK"), name: "h", url: "https://h", headers: [{ name: "X-A", value: "1" }, { name: " ", value: "" }], format: "TEMPLATE", authHeaderName: "" });
    expect(hook).toMatchObject({ target: { method: "POST", headers: { "X-A": "1" }, authHeaderName: "Authorization", batchSize: 100 }, format: "TEMPLATE" });
    expect(hook.secret).toBeUndefined();
    const form = outputForm({ id: "1", name: "n", type: "WEBHOOK", target: { url: "https://h", method: "PUT", headers: { "X-A": "1" } }, filter: { deviceIds: ["1"], qualityMin: 1 }, format: "TEMPLATE", template: null, enabled: false, version: 2 });
    expect(form).toMatchObject({ method: "PUT", headers: [{ name: "X-A", value: "1" }], deviceIds: "1", qualityMin: "1", enabled: false });
    expect(form.template).toContain("{{deviceName}}");
    expect(outputForm({ id: "1", name: "n", type: "MQTT_PUBLISH", target: {}, filter: null, format: "CANONICAL", enabled: true, version: 1 }).qualityMin).toBe("");
    expect(filterSummary({ deviceIds: ["1"], metrics: ["co2"] })).toEqual({ devices: 1, groups: 0, spaces: 0, metrics: ["co2"], qualityMin: null });
    expect(filterSummary(null).devices).toBe(0);
    expect(statTotals([{ t: "a", sent: 10, failed: 1, retried: 1, lagMs: 100 }, { t: "b", sent: 5, failed: 0, retried: 0, lagMs: null }])).toEqual({ sent: 15, failed: 1, retried: 1, lagMs: 100, perMin: 7.5 });
    expect(statTotals([])).toEqual({ sent: 0, failed: 0, retried: 0, lagMs: null, perMin: 0 });
  });
});

describe("DSC-08.03 엣지 게이트웨이(BR-DSC-31·32)", () => {
  it("상태 색·버퍼 사용률·건수 축약·상태별 동작·설정 판 JSON 검사", () => {
    expect([edgeTone("ONLINE"), edgeTone("REGISTERING"), edgeTone("OFFLINE"), edgeTone("ERROR"), edgeTone("REVOKED")]).toEqual(["success", "info", "warning", "danger", "neutral"]);
    expect(bufferPercent(536_870_912)).toBe(50);
    expect(bufferPercent(null)).toBeNull();
    expect(bufferPercent(5, 1)).toBe(100);
    expect([compactCount(1200), compactCount(88_000), compactCount(2_500_000), compactCount(12), compactCount(null)]).toEqual(["1.2k", "88k", "2.5M", "12", "–"]);
    expect(edgeActions({ status: "REGISTERING" })).toEqual(["reissue", "revoke"]);
    expect(edgeActions({ status: "ONLINE" })).toEqual(["restart", "collect-logs", "revoke"]);
    expect(edgeActions({ status: "ONLINE", revokedAt: "x" })).toEqual([]);
    expect(parseConfigVersion("{")).toEqual({ ok: false, error: "json" });
    expect(parseConfigVersion("1")).toEqual({ ok: false, error: "json" });
    expect(parseConfigVersion('{"targets":[{"config":{}}]}')).toEqual({ ok: false, error: "targets" });
    expect(parseConfigVersion('{"targets":[{"connectorKey":"modbus-tcp","config":{}}]}')).toEqual({ ok: true, body: { targets: [{ connectorKey: "modbus-tcp", config: {} }], decoders: {} } });
  });
});
