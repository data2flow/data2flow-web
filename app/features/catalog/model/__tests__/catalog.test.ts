/**
 * 기기 모델·측정 항목·그룹 입력 규칙(UI-DEV-08·09·11): DEV-03.01, DEV-04.01, DEV-04.02, DEV-06.01, DEV-07.05.
 */
import { describe, expect, it } from "vitest";
import {
  buildCriteria,
  checkGroupInput,
  checkMetricInput,
  checkModelInput,
  coerceAttribute,
  criteriaSize,
  criteriaToInput,
  editDistance,
  metricBody,
  modelBody,
  parseAttributeSchema,
  parseCriteria,
  parseEnumMap,
  parseList,
  readModelForm,
  recommendKeys,
  similarity,
  validateAttributes,
} from "../catalog";

const model = { code: "ESP32-TH", vendor: "자체 제작", name: "ESP32-TH", protocol: "MQTT", kind: "SENSOR", defaultIntervalSec: "60", metrics: ["temperature"], capabilities: [] };

describe("DEV-03.01 TC-DEV-093 모델 입력 검증", () => {
  it("코드 형식 `^[A-Z0-9][A-Z0-9._-]{1,49}$`, 이름 필수, 센서는 측정 항목 1개 이상, 주기 범위", () => {
    expect(checkModelInput(model, { creating: true })).toEqual({});
    expect(checkModelInput({ ...model, code: "esp32" }, { creating: true }).code).toBe("modelCode");
    expect(checkModelInput({ ...model, code: "A" }, { creating: true }).code).toBe("modelCode");
    expect(checkModelInput({ ...model, code: "esp32" }, { creating: false }).code).toBeUndefined();
    expect(checkModelInput({ ...model, name: " ", vendor: "", protocol: "X", kind: "Y", metrics: [], defaultIntervalSec: "5" }, { creating: false })).toEqual({ name: "nameRequired", vendor: "vendorRequired", protocol: "required", kind: "required", defaultIntervalSec: "interval" });
    expect(checkModelInput({ ...model, metrics: [] }, { creating: true }).metrics).toBe("sensorMetric");
    expect(checkModelInput({ ...model, kind: "ACTUATOR", metrics: [] }, { creating: true }).metrics).toBeUndefined();
  });

  it("요청 본문: 기능은 이름만, 필수 여부, 생성할 때만 코드", () => {
    expect(modelBody({ ...model, capabilities: ["Switch"], requiredMetrics: [] }, true)).toMatchObject({ code: "ESP32-TH", metrics: [{ key: "temperature", required: false }], capabilities: [{ capability: "Switch", constraints: null }], defaultIntervalSec: 60, description: null });
    expect(modelBody({ ...model, defaultIntervalSec: "" }, false)).not.toHaveProperty("code");
    expect(modelBody({ ...model, defaultIntervalSec: "" }, false).metrics).toEqual([{ key: "temperature", required: true }]);
  });

  it("폼 값 읽기", () => {
    const form = new FormData();
    form.set("code", "X1");
    form.append("metrics", "co2");
    form.set("capabilities", "Switch, Dimmer, Switch");
    const input = readModelForm(form);
    expect(input).toMatchObject({ code: "X1", metrics: ["co2"], capabilities: ["Switch", "Dimmer"], requiredMetrics: undefined, vendor: "" });
    form.append("requiredMetrics", "co2");
    expect(readModelForm(form).requiredMetrics).toEqual(["co2"]);
  });
});

const metric = { key: "illuminance", displayName: "조도", unit: "lux", valueType: "NUMBER", aggDefault: "AVG", validMin: "0", validMax: "100000", precision: "0" };

describe("DEV-04.01 TC-DEV-126 측정 항목 입력 검증", () => {
  it("키 형식, 유효 범위 최소 < 최대, ENUM이면 값 매핑 필수", () => {
    expect(checkMetricInput(metric, { creating: true })).toEqual({});
    expect(checkMetricInput({ ...metric, key: "Illuminance" }, { creating: true }).key).toBe("metricKey");
    expect(checkMetricInput({ ...metric, key: `a${"b".repeat(64)}` }, { creating: true }).key).toBe("metricKey");
    expect(checkMetricInput({ ...metric, validMin: "50", validMax: "10" }, { creating: false }).validMin).toBe("minMax");
    expect(checkMetricInput({ ...metric, validMin: "x", validMax: "y" }, { creating: false })).toMatchObject({ validMin: "number", validMax: "number" });
    expect(checkMetricInput({ ...metric, valueType: "ENUM", enumMap: "" }, { creating: false }).enumMap).toBe("enumMap");
    expect(checkMetricInput({ ...metric, valueType: "ENUM", enumMap: "open=1, close=0" }, { creating: false })).toEqual({});
    expect(checkMetricInput({ ...metric, displayName: "", valueType: "X", aggDefault: "Y", precision: "9" }, { creating: false })).toEqual({ displayName: "nameRequired", valueType: "required", aggDefault: "required", precision: "precision" });
  });

  it("값 매핑 해석(라벨=숫자 또는 JSON), 요청 본문", () => {
    expect(parseEnumMap("open=1, close=0")).toEqual({ open: 1, close: 0 });
    expect(parseEnumMap('{"open":1}')).toEqual({ open: 1 });
    expect(parseEnumMap('{"open":"x"}')).toBeNull();
    expect(parseEnumMap("{bad")).toBeNull();
    expect(parseEnumMap("{}")).toBeNull();
    expect(parseEnumMap("open")).toBeNull();
    expect(parseEnumMap("")).toBeNull();
    expect(metricBody(metric, true)).toEqual({ key: "illuminance", displayName: "조도", unit: "lux", valueType: "NUMBER", enumMap: null, validMin: 0, validMax: 100000, precision: 0, aggDefault: "AVG" });
    expect(metricBody({ ...metric, unit: "", validMin: "", valueType: "ENUM", enumMap: "a=1" }, false)).toMatchObject({ unit: null, validMin: null, enumMap: { a: 1 } });
  });
});

describe("DEV-04.02 TC-DEV-133 미검증 항목: 비슷한 표준 키 추천", () => {
  it("문자열 유사도로 60% 이상을 높은 순 최대 3개", () => {
    expect(editDistance("kitten", "sitting")).toBe(3);
    expect(similarity("", "")).toBe(1);
    expect(recommendKeys("illuminance", ["illumination", "temperature", "humidity"])).toEqual([{ key: "illumination", score: 0.67 }]);
    expect(recommendKeys("temp", ["temperature"])).toEqual([]);
    expect(recommendKeys("co_2", ["co2", "co2"])[0]).toEqual({ key: "co2", score: 1 });
    expect(recommendKeys("co2", ["co2"])).toEqual([]);
  });
});

describe("DEV-07.05 모델 속성 스키마와 기기 입력값 검증", () => {
  const schema = JSON.stringify({ type: "object", properties: { serialNo: { type: "string", title: "시리얼" }, setpoint: { type: "number", unit: "℃", default: 24 }, floor: { type: "integer" }, outdoor: { type: "boolean" } }, required: ["serialNo", "setpoint"] });

  it("문법·형식 검사", () => {
    const parsed = parseAttributeSchema(schema);
    expect(parsed.ok && parsed.fields.map((f) => [f.key, f.type, f.required])).toEqual([
      ["serialNo", "string", true],
      ["setpoint", "number", true],
      ["floor", "integer", false],
      ["outdoor", "boolean", false],
    ]);
    expect(parseAttributeSchema("")).toEqual({ ok: true, fields: [], schema: null });
    expect(parseAttributeSchema("{oops")).toMatchObject({ ok: false, error: "json" });
    expect(parseAttributeSchema("[]")).toMatchObject({ ok: false, error: "schema" });
    expect(parseAttributeSchema('{"type":"array","properties":{}}')).toMatchObject({ ok: false, error: "schema", detail: "type" });
    expect(parseAttributeSchema('{"type":"object"}')).toMatchObject({ ok: false, detail: "properties" });
    expect(parseAttributeSchema('{"properties":{},"required":"a"}')).toMatchObject({ ok: false, detail: "required" });
    expect(parseAttributeSchema('{"properties":{"a":{"type":"date"}}}')).toMatchObject({ ok: false, detail: "a" });
    expect(parseAttributeSchema('{"properties":{"a":{"type":"number","default":"x"}}}')).toMatchObject({ ok: false, detail: "a" });
    expect(parseAttributeSchema('{"properties":{"a":{"type":"number","default":3}}}')).toMatchObject({ ok: true });
    expect(parseAttributeSchema('{"properties":{"a":{"type":"string"}},"required":["b"]}')).toMatchObject({ ok: false, detail: "required" });
  });

  it("필수·타입·스키마 밖 키, 기본값이 있으면 필수를 채운 것으로 본다", () => {
    const parsed = parseAttributeSchema(schema);
    if (!parsed.ok) throw new Error("schema");
    expect(validateAttributes(parsed.fields, {})).toEqual({ serialNo: "required" });
    expect(validateAttributes(parsed.fields, { serialNo: 1, setpoint: "warm", floor: 2.5, outdoor: "yes", extra: 1 })).toEqual({ serialNo: "type", setpoint: "type", floor: "type", outdoor: "type", extra: "unknown" });
    expect(validateAttributes(parsed.fields, { serialNo: "SN-1", setpoint: 3, floor: 3, outdoor: false })).toEqual({});
    const [, setpoint, , outdoor] = parsed.fields;
    expect(coerceAttribute(setpoint, "")).toBeUndefined();
    expect(coerceAttribute(setpoint, "24.5")).toBe(24.5);
    expect(coerceAttribute(setpoint, "x")).toBe("x");
    expect(coerceAttribute(outdoor, "true")).toBe(true);
    expect(coerceAttribute(outdoor, "false")).toBe(false);
    expect(coerceAttribute(outdoor, "maybe")).toBe("maybe");
    expect(coerceAttribute(parsed.fields[0], "SN")).toBe("SN");
  });
});

describe("DEV-06.01 TC-DEV-087 TC-DEV-167 그룹 입력과 동적 조건", () => {
  it("조건 작성기 → criteria(빈 조건 제외), 화면값으로 되돌리기", () => {
    const criteria = buildCriteria({ modelIds: ["12"], spaceIds: ["3"], includeDescendants: true, tags: ["pilot"], tagMatch: "any", statuses: ["ACTIVE"] });
    expect(criteria).toEqual({ modelIds: ["12"], spaceIds: ["3"], includeDescendants: true, tags: { match: "any", values: ["pilot"] }, statuses: ["ACTIVE"] });
    expect(criteriaSize(criteria)).toBe(4);
    expect(buildCriteria({ modelIds: [], spaceIds: [], includeDescendants: true, tags: [], tagMatch: "all", statuses: [] })).toEqual({});
    expect(criteriaToInput(criteria)).toEqual({ modelIds: ["12"], spaceIds: ["3"], includeDescendants: true, tags: ["pilot"], tagMatch: "any", statuses: ["ACTIVE"] });
    expect(criteriaToInput(null)).toEqual({ modelIds: [], spaceIds: [], includeDescendants: true, tags: [], tagMatch: "any", statuses: [] });
    expect(criteriaSize(undefined)).toBe(0);
  });

  it("이름 필수, 동적은 조건 1개 이상, 1,000대 초과 거부", () => {
    expect(checkGroupInput({ name: "3층 CO2", type: "STATIC", deviceIds: ["1"] })).toEqual({});
    expect(checkGroupInput({ name: "", type: "X" })).toEqual({ name: "nameRequired", type: "required" });
    expect(checkGroupInput({ name: "a", type: "DYNAMIC", criteria: {} }).criteria).toBe("criteriaRequired");
    expect(checkGroupInput({ name: "a", type: "DYNAMIC", criteria: { statuses: ["ACTIVE"] }, previewCount: 1001 }).criteria).toBe("groupLimit");
    expect(checkGroupInput({ name: "a", type: "STATIC", deviceIds: Array.from({ length: 1001 }, (_, i) => String(i)) }).deviceIds).toBe("groupLimit");
  });

  it("목록·조건 JSON 해석", () => {
    expect(parseList("a, b\nb,,c")).toEqual(["a", "b", "c"]);
    expect(parseList(undefined)).toEqual([]);
    expect(parseCriteria('{"statuses":["ACTIVE"]}')).toEqual({ statuses: ["ACTIVE"] });
    expect(parseCriteria("[]")).toBeUndefined();
    expect(parseCriteria("{x")).toBeUndefined();
    expect(parseCriteria("")).toEqual({});
  });
});
