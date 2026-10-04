/**
 * M4 제어 관리 모델: 비상 정지 입력(API-ACT-20), 장면(BR-ACT-16), 예약 cron(API-ACT-15), 인터락 본문(BR-ACT-11), 드라이버 폼(API-ACT-30), 사용자 정의 기능(BR-ACT-22), 일괄·가동 요약.
 */
import { describe, expect, it } from "vitest";
import {
  bulkDone,
  conditionText,
  cronToDaysTime,
  daysTimeToCron,
  defaultStaleSec,
  desiredText,
  driverBody,
  driverProblems,
  driverToForm,
  driverTone,
  effectText,
  emergencyBody,
  emergencyProblems,
  emptyDriverForm,
  emptyInterlockForm,
  emptyScheduleForm,
  forbidText,
  interlockBody,
  interlockProblems,
  interlockToForm,
  isValidCron,
  normalizeSceneItem,
  parseCapabilityJson,
  parseDesired,
  parseScalar,
  previewSummary,
  runSummary,
  runtimeTotals,
  sceneProblems,
  scheduleBody,
  scheduleProblems,
  scheduleToForm,
  stateText,
} from "../admin";

describe("ACT-06.03 비상 정지 입력", () => {
  it("사유 1~200자, 공간 범위면 공간 필수, 확인 문구 일치", () => {
    expect(emergencyProblems({ scopeType: "SPACE", reason: " ", confirm: "", confirmWord: "정지" })).toEqual(["reason", "space", "confirm"]);
    expect(emergencyProblems({ scopeType: "ORG", reason: "x".repeat(201), confirm: "정지", confirmWord: "정지" })).toEqual(["reason"]);
    expect(emergencyProblems({ scopeType: "ORG", reason: "점검", confirm: " 정지 ", confirmWord: "정지" })).toEqual([]);
    expect(emergencyBody("ORG", "3", " 점검 ")).toEqual({ scope: { type: "ORG" }, reason: "점검" });
    expect(emergencyBody("SPACE", "3", "점검")).toEqual({ scope: { type: "SPACE", spaceId: "3", includeChildren: true }, reason: "점검" });
  });
});

describe("ACT-05 장면 모델", () => {
  it("BR-ACT-16 검사, 관계 대상 정리, 미리보기·실행 요약, 상태 문구", () => {
    expect(sceneProblems("", [])).toEqual([
      { field: "name", code: "nameLength" },
      { field: "items", code: "itemsRequired" },
    ]);
    const item = { target: {}, capability: "", desired: {} };
    expect(
      sceneProblems(
        "a",
        Array.from({ length: 101 }, () => ({ target: { deviceId: "1" }, capability: "Switch", desired: { on: true } })),
      ).map((p) => p.code),
    ).toEqual(["SCENE_ITEM_LIMIT_EXCEEDED"]);
    expect(sceneProblems("a", [item]).map((p) => p.field)).toEqual(["items[0].target", "items[0].capability", "items[0].desired"]);
    expect(normalizeSceneItem({ target: { deviceId: "1", spaceId: "3" }, capability: "Switch", desired: { on: true } })).toEqual({
      target: { deviceId: "1" },
      capability: "Switch",
      desired: { on: true },
    });
    expect(normalizeSceneItem({ target: { spaceId: "3" }, capability: "Dimmer", desired: { level: 1 } }).target).toEqual({
      spaceId: "3",
      relation: "controls",
      capability: "Dimmer",
      includeChildren: false,
    });
    expect(
      previewSummary([
        { deviceId: "1", capability: "a", willChange: true },
        { deviceId: "2", capability: "a", willChange: false, offline: true },
        { deviceId: "3", capability: "a", willChange: true, predictedBlock: { reason: "INTERLOCK" } },
      ]),
    ).toEqual({ change: 1, noChange: 1, blocked: 1, offline: 1 });
    expect(runSummary({ status: "PARTIAL", results: ["APPLIED", "QUEUED", "BLOCKED", "TIMEOUT", "SKIPPED"].map((status, i) => ({ deviceId: String(i), status })) })).toEqual({
      applied: 1,
      waiting: 1,
      blocked: 1,
      failed: 1,
      skipped: 1,
    });
    expect(stateText({ on: true, level: 2 })).toBe("ON · 2");
    expect(stateText(null)).toBe("–");
    expect(stateText({ on: false })).toBe("OFF");
    expect(parseDesired("mode=cool, targetTemperature=24, on=true")).toEqual({ mode: "cool", targetTemperature: 24, on: true });
    expect(parseDesired("bad")).toBeUndefined();
    expect(parseDesired("")).toEqual({});
    expect(desiredText({ mode: "cool", t: 24 })).toBe("mode=cool, t=24");
    expect(desiredText(null)).toBe("");
    expect(parseScalar("false")).toBe(false);
    expect(parseScalar("cool")).toBe("cool");
  });
});

describe("ACT-02.07 예약 모델", () => {
  it("cron 검사와 요일·시각 변환(일요일 0)", () => {
    expect(isValidCron("50 8 * * 1-5")).toBe(true);
    expect(isValidCron("*/5 * * * *")).toBe(true);
    expect(isValidCron("매일")).toBe(false);
    expect(isValidCron("1 2 3 4")).toBe(false);
    expect(daysTimeToCron([7, 1, 1], "08:50")).toBe("50 8 * * 0,1");
    expect(daysTimeToCron([], "08:50")).toBeUndefined();
    expect(daysTimeToCron([1], "8:5")).toBeUndefined();
    expect(cronToDaysTime("50 8 * * 0,1")).toEqual({ days: [7, 1], time: "08:50" });
    expect(cronToDaysTime("*/5 * * * *")).toBeUndefined();
  });

  it("검사·본문·되돌림", () => {
    const form = { ...emptyScheduleForm("Asia/Seoul"), name: "아침", sceneId: "501" };
    expect(scheduleProblems(form)).toEqual([]);
    expect(scheduleProblems({ ...form, name: "", sceneId: "", kind: "ONCE", at: "" })).toEqual(["name", "scene", "at"]);
    expect(scheduleProblems({ ...form, targetType: "device", args: "{" })).toEqual(["device", "args"]);
    expect(scheduleProblems({ ...form, targetType: "device", deviceId: "1", capability: "Switch", args: "null" })).toEqual(["args"]);
    expect(scheduleProblems({ ...form, days: [], cron: "" })).toEqual(["cron"]);
    expect(scheduleBody(form, () => undefined)).toEqual({ name: "아침", target: { sceneId: "501" }, kind: "RECURRING", skipHolidays: true, timezone: "Asia/Seoul", cron: "50 8 * * 1,2,3,4,5" });
    expect(scheduleBody({ ...form, kind: "ONCE", at: "2026-10-10T10:00", validTo: "2026-12-31", timezone: "" }, () => "2026-10-10T01:00:00Z")).toMatchObject({
      kind: "ONCE",
      at: "2026-10-10T01:00:00Z",
      validTo: "2026-12-31",
      timezone: undefined,
    });
    const back = scheduleToForm(
      { controlScheduleId: "1", name: "c", kind: "RECURRING", target: { sceneId: "501" }, cron: "*/5 * * * *", skipHolidays: false, enabled: true, version: 1 },
      "Asia/Seoul",
      (iso) => iso,
    );
    expect(back.cron).toBe("*/5 * * * *");
    expect(back.days).toEqual([]);
    const hours = scheduleToForm(
      {
        controlScheduleId: "2",
        name: "h",
        kind: "SPACE_HOURS",
        target: { sceneId: "1" },
        spaceHours: { spaceId: "31", edge: "START", offsetMinutes: -5 },
        skipHolidays: true,
        enabled: true,
        version: 1,
      },
      "Asia/Seoul",
      (iso) => iso,
    );
    expect(hours).toMatchObject({ spaceId: "31", edge: "START", offsetMinutes: "-5" });
  });
});

describe("ACT-06.02 인터락 모델", () => {
  it("상태 조건 기본값 → 본문, 측정값·기기 조건, 되돌림, 요약 문구", () => {
    const form = { ...emptyInterlockForm(), name: "창문", spaceId: "31", message: "막음" };
    expect(interlockProblems(form)).toEqual([]);
    expect(interlockBody(form)).toEqual({
      name: "창문",
      spaceId: "31",
      includeChildren: true,
      condition: { kind: "state", relation: "measures", capability: "Contact", attribute: "open", op: "==", value: true },
      forbid: { capability: "Thermostat", command: "set", argsMatch: { mode: { in: ["cool", "heat"] } } },
      message: "막음",
      enabled: true,
    });
    expect(interlockBody({ ...form, kind: "metric", deviceId: "9", metric: "pm2_5", op: ">", value: "75" }).condition).toEqual({ kind: "metric", deviceId: "9", metric: "pm2_5", op: ">", value: 75 });
    expect(interlockBody({ ...form, deviceId: "8" }).condition).toMatchObject({ deviceId: "8" });
    expect(interlockProblems({ ...emptyInterlockForm(), op: "~", value: "", kind: "state", capability: "", forbidCapability: "" })).toEqual([
      "name",
      "space",
      "state",
      "condition",
      "forbid",
      "message",
    ]);
    const back = interlockToForm({
      interlockId: "1",
      name: "x",
      spaceId: "31",
      includeChildren: false,
      condition: { kind: "metric", metric: "pm2_5", op: ">", value: 75 },
      forbid: { capability: "Ventilation", argsMatch: { mode: { eq: "on" } } },
      message: "m",
      enabled: false,
      version: 1,
    });
    expect(back).toMatchObject({ kind: "metric", metric: "pm2_5", value: "75", forbidAttribute: "mode", forbidValues: "on", forbidCommand: "" });
    expect(
      interlockToForm({
        interlockId: "1",
        name: "x",
        spaceId: "31",
        includeChildren: false,
        condition: { kind: "state", op: "==", value: true },
        forbid: { capability: "V" },
        message: "m",
        enabled: false,
        version: 1,
      }).forbidValues,
    ).toBe("");
    expect(conditionText({ kind: "metric", metric: "pm2_5", op: ">", value: 75 })).toBe("pm2_5 > 75");
    expect(conditionText(null)).toBe("–");
    expect(forbidText({ capability: "Ventilation", argsMatch: { mode: { eq: "on" } } })).toBe("Ventilation · mode = on");
    expect(forbidText(null)).toBe("–");
    expect(defaultStaleSec(60)).toBe(300);
    expect(defaultStaleSec(600)).toBe(1800);
    expect(defaultStaleSec(null)).toBe(300);
  });
});

describe("ACT-03.05 드라이버 폼", () => {
  it("종류별 기본값·검사·본문, 비밀값은 비우면 빼고 수정은 hasSecret이면 필수 아님", () => {
    const mqtt = emptyDriverForm("MQTT");
    expect(mqtt.config).toMatchObject({ commandTopic: "devices/{device-key}/command", qos: "1" });
    expect(driverProblems({ ...mqtt, name: "m" })).toEqual(["config.sourceId"]);
    const lora = { ...emptyDriverForm("LORAWAN"), name: "l", config: { chirpstackUrl: "http://cs", applicationId: "1", fPortDefault: "x", confirmed: true } };
    expect(driverProblems(lora)).toEqual(["config.fPortDefault", "secret"]);
    expect(driverProblems({ ...lora, config: { ...lora.config, fPortDefault: "10" } }, true)).toEqual([]);
    expect(driverProblems({ ...lora, pollingSec: "-1", ackTimeoutSec: "1.5" }, true)).toEqual(["config.fPortDefault", "pollingSec", "ackTimeoutSec"]);
    const body = driverBody({ ...lora, config: { ...lora.config, fPortDefault: "10" }, secret: { apiToken: " " } });
    expect(body).not.toHaveProperty("secret");
    expect(body.config).toEqual({ chirpstackUrl: "http://cs", applicationId: "1", fPortDefault: 10, confirmed: true });
    const back = driverToForm({ driverId: "1", name: "v", type: "UNKNOWN", status: "OK", config: {}, hasSecret: false, version: 1 });
    expect(back.type).toBe("VIRTUAL");
    expect(driverToForm({ driverId: "2", name: "s", type: "SMARTTHINGS", status: "OK", config: { locationId: null }, hasSecret: true, version: 1 }).config.locationId).toBe("");
    expect(["OK", "CIRCUIT_OPEN", "ERROR", "UNTESTED"].map(driverTone)).toEqual(["success", "warning", "danger", "neutral"]);
  });
});

describe("ACT-01.04 BR-ACT-22 사용자 정의 기능", () => {
  it("이름·속성·명령 검사", () => {
    expect(parseCapabilityJson("[]").problems).toEqual(["json"]);
    expect(parseCapabilityJson('{"name":5,"attributes":[{"name":"a","type":"x"}]}').problems).toEqual(["CAPABILITY_NAME_RESERVED", "attributeShape"]);
    const ok = parseCapabilityJson('{"name":"custom.Fan","attributes":[{"name":"on","type":"boolean"}]}');
    expect(ok.problems).toEqual([]);
    expect(ok.definition?.commands).toEqual([]);
  });
});

describe("ACT-02.06·08 일괄·가동 요약", () => {
  it("진행 끝 판정, 합계, 효과 문구", () => {
    expect(bulkDone({ total: 2, succeeded: 1, failed: 0, queued: 1, skipped: 0, items: [] })).toBe(true);
    expect(bulkDone({ total: 2, succeeded: 1, failed: 0, queued: 0, skipped: 0, items: [] })).toBe(false);
    expect(
      runtimeTotals({
        items: [
          { date: "d", onSeconds: 7200, cycles: 2, energyWh: 2400 },
          { date: "e", onSeconds: 3600, cycles: 1 },
        ],
        noEffectEvents: [],
      }),
    ).toEqual({ onHours: 3, cycles: 3, energyKwh: 2.4 });
    expect(effectText(null)).toBe("–");
    expect(effectText("문구")).toBe("문구");
    expect(effectText({ direction: "up" })).toBe("↑");
    expect(effectText({ start: 27, end: 26.5 })).toBe("-0.5");
    expect(effectText({})).toBe("–");
  });
});
