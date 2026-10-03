/**
 * 데이터 소스 화면 모델 단위 테스트: 입력 검증(UI-DSC-02), client-id 미리 보기(BR-DSC-01), 대표 상태, 상태별 버튼(DSC-07.01),
 * 저장 본문(API-DSC-02·04), generic-json 매핑(ING-02.03), 커넥터 카탈로그(DSC-09.01).
 */
import { describe, expect, it } from "vitest";
import { BASIC_CONNECTORS, filterConnectors, isLossy, normalizeCatalog } from "../catalog";
import { evaluate, mappingFromConfig, mappingToConfig, parseJsonPath, previewMapping, validateMapping } from "../mapping";
import {
  DEFAULT_MAPPING,
  checkBrokerUrl,
  checkCode,
  checkTopic,
  clientIdPreview,
  connectorOfType,
  createBody,
  emptyForm,
  formFromSource,
  lifecycleActions,
  lifecycleTone,
  percent,
  sharedTopic,
  sparklinePath,
  statBucket,
  stateTone,
  testBody,
  testOutcome,
  typeOfConnector,
  updateBody,
  validateForm,
  worstState,
  type SourceFormValues,
} from "../source";

const mqtt = (patch: Partial<SourceFormValues> = {}): SourceFormValues => ({
  ...emptyForm("MQTT_SUBSCRIBE", "mqtt"),
  code: "chirpstack-s3",
  name: "ChirpStack",
  url: "wss://iot-data.java21.net:443/mqtt",
  topics: [{ topic: "application/+/device/+/event/up", qos: 1 }],
  ...patch,
});

describe("DSC-01.04 TC-DSC-031 입력 검증", () => {
  it("코드·URL·토픽 규칙", () => {
    expect(checkCode("chirpstack-s3")).toBe(true);
    expect(checkCode("Chirp")).toBe(false);
    expect(checkCode("a")).toBe(false);
    expect(checkBrokerUrl("http://x")).toBe(false);
    expect(checkBrokerUrl("wss://iot-data.java21.net:443/mqtt")).toBe(true);
    expect(checkBrokerUrl("tcp://broker:1883")).toBe(true);
    expect(checkBrokerUrl("mqtt://broker")).toBe(false);
    expect(checkBrokerUrl("ssl://broker:70000")).toBe(false);
    expect(checkTopic("a/#/b")).toBe(false);
    expect(checkTopic("a/b/#")).toBe(true);
    expect(checkTopic("a/+/c")).toBe(true);
    expect(checkTopic("a/b+/c")).toBe(false);
    expect(checkTopic("")).toBe(false);
  });

  it("폼 검증: 오류 키를 모은다, 편집 때 코드는 검사하지 않고 저장된 비밀값이 있으면 비워도 된다", () => {
    expect(validateForm(mqtt())).toEqual({});
    const errors = validateForm(mqtt({ code: "X", name: "", url: "http://x", clientIdBase: "bad id", keepaliveSec: "5", topics: [{ topic: "a/#/b", qos: 1 }], auth: "USERPASS", username: "", autoregLimitPerHour: "20000", noDataAlarmAfterSec: "30", decoderKey: "script" }));
    expect(errors).toEqual({ code: "code", name: "name", url: "url", clientIdBase: "clientId", keepaliveSec: "keepalive", topic0: "topic", secretValue: "secret", username: "username", decodeScriptId: "script", autoregLimitPerHour: "autoreg", noDataAlarmAfterSec: "noData" });
    expect(validateForm(mqtt({ code: "X", auth: "HEADER", headerName: "" }), { editing: true, secretConfigured: true })).toEqual({ headerName: "headerName" });
    expect(validateForm(mqtt({ topics: [] })).topics).toBe("topicRequired");
    expect(validateForm(mqtt({ topics: Array.from({ length: 21 }, () => ({ topic: "a", qos: 1 })) })).topics).toBe("topicLimit");
    expect(validateForm(mqtt({ protocolVersion: "5.0", sessionExpirySec: "-1" })).sessionExpirySec).toBe("sessionExpiry");
    expect(validateForm(mqtt({ protocolVersion: "3.1.1", sessionExpirySec: "-1" })).sessionExpirySec).toBeUndefined();
    expect(validateForm(mqtt({ decoderKey: "generic-json" }), { mappingError: "mapping" }).decoderConfig).toBe("mapping");
    expect(validateForm({ ...emptyForm("PLATFORM_BROKER", "platform-broker"), code: "esp-broker", name: "ESP" })).toEqual({});
  });

  it("TC-DSC-031 client-id를 비우면 data2flow-{code}-{env}-0/-1, 공유 구독 실제 토픽(TC-DSC-267)", () => {
    expect(clientIdPreview("", "chirpstack-s3")).toEqual(["data2flow-chirpstack-s3-prod-0", "data2flow-chirpstack-s3-prod-1"]);
    expect(clientIdPreview("lab", "x", "dev-kim", 1)).toEqual(["lab-dev-kim-0"]);
    expect(clientIdPreview("", "")).toEqual(["data2flow-{code}-prod-0", "data2flow-{code}-prod-1"]);
    expect(sharedTopic("a/b", "grp")).toBe("$share/grp/a/b");
    expect(sharedTopic("a/b", " ")).toBe("a/b");
  });
});

describe("DSC-02.01 대표 상태·DSC-07.01 상태별 버튼", () => {
  it("TC-DSC-061 대표 상태는 가장 나쁜 인스턴스", () => {
    expect(worstState(["CONNECTED", "ERROR"])).toBe("ERROR");
    expect(worstState(["CONNECTED", "CONNECTING"])).toBe("CONNECTING");
    expect(worstState(["CONNECTED", "DISCONNECTED", "CONNECTING"])).toBe("DISCONNECTED");
    expect(worstState([])).toBe("DISABLED");
    expect(stateTone("CONNECTED")).toBe("good");
    expect(stateTone("CONNECTING")).toBe("warn");
    expect(stateTone("ERROR")).toBe("bad");
    expect(stateTone(undefined)).toBe("muted");
    expect(["ACTIVE", "PAUSED", "DRAFT", "ARCHIVED"].map(lifecycleTone)).toEqual(["success", "warning", "info", "neutral"]);
  });

  it("TC-DSC-168 DRAFT: 활성화, ACTIVE: 일시정지·보관, PAUSED: 재개·보관, ARCHIVED: 복제·삭제", () => {
    expect(lifecycleActions("DRAFT")).toEqual(["activate", "clone", "delete"]);
    expect(lifecycleActions("ACTIVE")).toEqual(["pause", "clone", "archive"]);
    expect(lifecycleActions("PAUSED")).toEqual(["resume", "clone", "archive"]);
    expect(lifecycleActions("ARCHIVED")).toEqual(["clone", "delete"]);
    expect(lifecycleActions("X")).toEqual([]);
  });
});

describe("저장 본문(API-DSC-02·04)", () => {
  it("TC-DSC-053 기본 모델·공간, 비밀값은 값이 있을 때만, MQTT 3.1.1은 5.0 전용 필드를 보내지 않는다", () => {
    const body = createBody(mqtt({ defaultModelId: "11", defaultSpaceId: "31", auth: "HEADER", secretValue: "Basic x", sharedGroup: "g1", receiveMaximum: "10" }), true);
    expect(body).toMatchObject({ code: "chirpstack-s3", type: "MQTT_SUBSCRIBE", activate: true, defaultModelId: "11", defaultSpaceId: "31", secret: { kind: "HEADER", value: "Basic x" } });
    expect(body.connection).toMatchObject({ sessionExpirySec: 3600, receiveMaximum: 10, sharedGroup: "g1", headerName: "Authorization" });
    const v311 = updateBody(mqtt({ protocolVersion: "3.1.1", auth: "USERPASS", username: "u" }));
    expect(v311.connection).not.toHaveProperty("sessionExpirySec");
    expect(v311.connection).toMatchObject({ username: "u" });
    expect(v311).not.toHaveProperty("secret");
    expect(v311.defaultModelId).toBeNull();
    const pb = updateBody({ ...emptyForm("PLATFORM_BROKER", "platform-broker"), deviceKeyPattern: "" });
    expect(pb.connection).toEqual({ deviceKeyPattern: "{externalId}" });
    expect(pb.decoderConfig).toEqual(JSON.parse(DEFAULT_MAPPING));
    expect(updateBody({ ...emptyForm("SIMULATION", "simulation"), scenarioId: "s1" }).connection).toEqual({ scenarioId: "s1" });
    expect(updateBody(emptyForm("SIMULATION", "simulation")).connection).toEqual({});
    expect(updateBody(mqtt({ decoderKey: "generic-json", decoderConfig: "{bad" })).decoderConfig).toBeUndefined();
    expect(updateBody(mqtt({ decoderKey: "script", decodeScriptId: "5" })).decodeScriptId).toBe("5");
  });

  it("TC-DSC-093 테스트 본문은 저장 본문과 같은 설정이고 activate는 없다", () => {
    const values = mqtt();
    expect(testBody(values).activate).toBeUndefined();
    expect(testBody(values).connection).toEqual(createBody(values, false).connection);
  });

  it("저장된 소스 → 폼 값(비밀값 비움), 커넥터 키↔유형", () => {
    const form = formFromSource({ id: "7", code: "c", name: "n", type: "MQTT_SUBSCRIBE", lifecycle: "ACTIVE", version: 1, connection: { url: "wss://a", protocolVersion: "3.1.1", cleanStart: true, auth: "HEADER" }, topics: [{ topic: "t", qos: 0 }], decoderConfig: { a: 1 }, defaultModelId: "11", secret: { configured: true } });
    expect(form).toMatchObject({ url: "wss://a", protocolVersion: "3.1.1", cleanStart: true, auth: "HEADER", topics: [{ topic: "t", qos: 0 }], defaultModelId: "11", secretValue: "", connectorKey: "mqtt" });
    expect(JSON.parse(form.decoderConfig)).toEqual({ a: 1 });
    const bare = formFromSource({ id: "1", code: "c", name: "n", type: "PLATFORM_BROKER", lifecycle: "DRAFT", version: 1 });
    expect(bare.connectorKey).toBe("platform-broker");
    expect(bare.keepaliveSec).toBe("60");
    expect(typeOfConnector("simulation")).toBe("SIMULATION");
    expect(typeOfConnector("kafka")).toBe("CONNECTOR");
    expect(connectorOfType("MQTT_SUBSCRIBE", "sparkplug-b")).toBe("sparkplug-b");
    expect(connectorOfType("UNKNOWN")).toBe("mqtt");
  });

  it("표시 도우미: 실패율, 스파크라인, 기간별 묶음, 연결 테스트 판정(TC-DSC-268 부분 성공)", () => {
    expect(percent(0.123)).toBe("12.3%");
    expect(percent(12)).toBe("12%");
    expect(percent(null)).toBe("–");
    expect(sparklinePath([1])).toBe("");
    expect(sparklinePath([0, 10])).toBe("M0.0,16.0 L60.0,0.0");
    expect([statBucket("1h"), statBucket("24h"), statBucket("7d")]).toEqual(["1m", "5m", "1h"]);
    const steps = [{ name: "SUBSCRIBE", status: "OK" }];
    expect(testOutcome({ steps, preview: [] })).toBe("partial");
    expect(testOutcome({ steps, preview: [{ at: "", topic: "t", size: 1, rawExcerpt: "" }] })).toBe("success");
    expect(testOutcome({ steps: [{ name: "AUTH", status: "FAIL" }], preview: [] })).toBe("failed");
  });
});

describe("ING-02.03 generic-json 매핑(TC-ING-039·040, TC-DSC-045)", () => {
  it("JSONPath 해석과 문법 오류 위치", () => {
    expect(parseJsonPath("$.sensors[*].v")).toEqual({ ok: true, segments: [{ kind: "key", name: "sensors" }, { kind: "wildcard" }, { kind: "key", name: "v" }] });
    expect(parseJsonPath("$['a b'][0]")).toEqual({ ok: true, segments: [{ kind: "key", name: "a b" }, { kind: "index", index: 0 }] });
    expect(parseJsonPath("temp")).toEqual({ ok: false, position: 1 });
    expect(parseJsonPath("$..x")).toEqual({ ok: false, position: 3 });
    expect(parseJsonPath("$[x]")).toEqual({ ok: false, position: 2 });
    expect(parseJsonPath("$x")).toEqual({ ok: false, position: 2 });
    expect(evaluate({ a: [1, 2] }, [{ kind: "key", name: "a" }, { kind: "index", index: 5 }])).toEqual([]);
  });

  it("AT-ING-02.3 topic[1] 기기 ID + $.temp → temperature, 시각 epoch ms·ISO, 배열 경로, 없는 경로는 건너뜀", () => {
    const mapping = { deviceIdFrom: "topic[1]", timePath: "$.ts", metrics: [{ path: "$.temp", key: "temperature" }, { path: "$.missing", key: "co2" }] };
    expect(previewMapping(mapping, "devices/esp-01/telemetry", '{"temp":22.4,"ts":1759449600000}')).toEqual({ externalId: "esp-01", measuredAt: "2025-10-03T00:00:00.000Z", metrics: [{ key: "temperature", value: 22.4 }] });
    const iso = previewMapping({ deviceIdFrom: "$.dev", timePath: "$.t", metrics: [{ path: "$.sensors[*].v", key: "v" }] }, "x", '{"dev":7,"t":"2026-10-03T01:00:00Z","sensors":[{"v":1},{"v":2}]}');
    expect(iso).toEqual({ externalId: "7", measuredAt: "2026-10-03T01:00:00.000Z", metrics: [{ key: "v", value: 1 }, { key: "v", value: 2 }] });
    expect(previewMapping(mapping, "t", "{bad").error).toBe("json");
    expect(previewMapping({ deviceIdFrom: "$.none", timePath: "$.x", metrics: [] }, "t", "{}")).toEqual({ externalId: null, measuredAt: null, metrics: [] });
  });

  it("TC-ING-040 잘못된 JSONPath·키 중복·기기 ID 없음·키 형식", () => {
    expect(validateMapping({ deviceIdFrom: "topic[1]", metrics: [{ path: "$.a", key: "temperature" }] })).toEqual([]);
    const problems = validateMapping({ deviceIdFrom: "", timePath: "ts", metrics: [{ path: "$..a", key: "t" }, { path: "$.b", key: "t" }, { path: "$.c", key: "9x" }] });
    expect(problems).toEqual([
      { field: "deviceIdFrom", code: "required" },
      { field: "timePath", code: "path", position: 1, value: "ts" },
      { field: "metrics.0.path", code: "path", position: 3, value: "$..a" },
      { field: "metrics.1.key", code: "duplicate", value: "t" },
      { field: "metrics.2.key", code: "metricKey", value: "9x" },
    ]);
    expect(validateMapping({ deviceIdFrom: "$.d", metrics: [] })).toEqual([{ field: "metrics", code: "required" }]);
  });

  it("설정 문자열 ↔ 매핑", () => {
    expect(mappingFromConfig("{bad").deviceIdFrom).toBe("topic[1]");
    expect(mappingFromConfig('{"metrics":[{"path":"$.a"}]}')).toEqual({ deviceIdFrom: "", timePath: "", metrics: [{ path: "$.a", key: "" }] });
    expect(JSON.parse(mappingToConfig({ deviceIdFrom: " topic[1] ", timePath: " ", metrics: [{ path: "$.a ", key: " k" }] }))).toEqual({ deviceIdFrom: "topic[1]", metrics: [{ path: "$.a", key: "k" }] });
  });
});

describe("DSC-09.01 커넥터 카탈로그", () => {
  it("응답 모양 정리, 기본 유형 보장, 분류·검색, 유실 가능", () => {
    expect(normalizeCatalog(null).connectors.map((c) => c.connectorKey)).toEqual(["mqtt", "platform-broker", "simulation"]);
    const fromArray = normalizeCatalog([{ connectorKey: "kafka", name: "Kafka", category: "QUEUE", transports: ["tcp"], authMethods: [], enabled: true, ackMode: "BEFORE_STORE" }]);
    expect(fromArray.connectors).toHaveLength(4);
    const fromObject = normalizeCatalog({ connectors: [{ ...BASIC_CONNECTORS[0], name: "MQTT (서버)" }], templates: [{ key: "t", name: "T", connectorKey: "mqtt" }] });
    expect(fromObject.connectors.find((c) => c.connectorKey === "mqtt")?.name).toBe("MQTT (서버)");
    expect(fromObject.templates).toHaveLength(1);
    expect(normalizeCatalog({ responses: [] }).connectors).toHaveLength(3);
    const all = fromArray.connectors;
    expect(filterConnectors(all, "QUEUE", "").map((c) => c.connectorKey)).toEqual(["kafka"]);
    expect(filterConnectors(all, "ALL", "mqtt").map((c) => c.connectorKey)).toEqual(["mqtt", "platform-broker"]);
    expect(filterConnectors(all, "ALL", "nothing")).toEqual([]);
    expect(isLossy({ ackMode: "BEFORE_STORE" })).toBe(true);
    expect(isLossy({ ackMode: "AFTER_STORE" })).toBe(false);
    expect(isLossy({})).toBe(false);
  });
});
