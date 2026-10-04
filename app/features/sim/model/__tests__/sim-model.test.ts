/**
 * 가상 환경 화면 모델: 공간 물리(TC-SIM-005 일부), 배치(TC-SIM-092 일부), 특성 폼(TC-SIM-096·098 일부), 장애 주입(TC-SIM-066 일부),
 * 실행 제어 상태(TC-SIM-047 일부), 재생 매핑(TC-SIM-075 일부).
 */
import { describe, expect, it } from "vitest";
import { MAX_REPLAY_BYTES, checkMapping, checkReplayFile, guessMapping, replayBody } from "../replay";
import { errorDetails, simErrorText } from "../sim-error";
import {
  allowedControls,
  buildDeviceOutput,
  buildFault,
  changedFromPreset,
  checkAcceleration,
  checkPhysics,
  checkPlacement,
  checkProfileName,
  checkPropertyValue,
  coerceProperty,
  faultSpecs,
  formatDuration,
  formatElapsed,
  isGatewayFault,
  originLabelKey,
  overridesDiff,
  physicsFromForm,
  presetPhysics,
  runBody,
  usageTone,
} from "../sim";
import type { PropertyDef, PropertyRow } from "../types";

describe("SIM-01.02 공간 물리 프리셋·범위(TC-SIM-005)", () => {
  it("강의실 66㎡·층고 3m, 사무실·회의실은 다른 값, 사용자 정의는 강의실에서 시작", () => {
    expect(presetPhysics("CLASSROOM")).toMatchObject({ areaM2: 66, heightM: 3 });
    expect(presetPhysics("OFFICE").areaM2).toBe(120);
    expect(presetPhysics("MEETING").areaM2).toBe(30);
    expect(presetPhysics("CUSTOM").areaM2).toBe(66);
    // 복사본이라 바꿔도 다음 호출에 영향 없음
    const p = presetPhysics("CLASSROOM");
    p.initialState.temperature = 99;
    expect(presetPhysics("CLASSROOM").initialState.temperature).toBe(24);
  });

  it("범위 밖·숫자 아님은 필드별 문제, 선택 칸 비어 있으면 통과", () => {
    const bad = { ...presetPhysics("CLASSROOM"), areaM2: 0, heightM: 25, uValue: Number.NaN, windowM2: null, initialState: { temperature: 60, humidity: 50, co2: 200, pm2_5: 1, illumination: 1 } };
    const problems = checkPhysics(bad);
    expect(problems.areaM2).toEqual({ key: "range", values: { min: 1, max: 5000 } });
    expect(problems.heightM).toEqual({ key: "range", values: { min: 2, max: 20 } });
    expect(problems.uValue).toEqual({ key: "number" });
    expect(problems["initialState.temperature"].values).toEqual({ min: -20, max: 50 });
    expect(problems["initialState.co2"].values).toEqual({ min: 300, max: 5000 });
    expect(problems.windowM2).toBeUndefined();
    expect(checkPhysics(presetPhysics("OFFICE"))).toEqual({});
  });

  it("폼 값 → physics, 프리셋과 다른 필드 표시", () => {
    const form = new FormData();
    form.set("physics.areaM2", "70");
    form.set("physics.initialState.temperature", "");
    form.set("physics.outdoorLinked", "false");
    form.set("physics.windowOrientation", "N");
    const physics = physicsFromForm(form, presetPhysics("CLASSROOM"));
    expect(physics.areaM2).toBe(70);
    expect(physics.initialState.temperature).toBeNaN();
    expect(physics.outdoorLinked).toBe(false);
    expect(physics.windowOrientation).toBe("N");
    expect(changedFromPreset(physics, "CLASSROOM")).toEqual(["areaM2", "initialState.temperature"]);
  });
});

describe("SIM-09.01 배치·한도(TC-SIM-092), UI-SIM-01 사용량", () => {
  it("공간 필수, 수량 1~50, 남은 한도 초과, 접두어 40자", () => {
    expect(checkPlacement({ spaceId: "", count: 0, namePrefix: "x".repeat(41) }, null)).toEqual({ spaceId: { key: "spaceRequired" }, count: { key: "range", values: { min: 1, max: 50 } }, namePrefix: { key: "length", values: { min: 1, max: 40 } } });
    expect(checkPlacement({ spaceId: "41", count: 4, namePrefix: "TH-" }, 3).count).toEqual({ key: "quota", values: { limit: 500, remaining: 3 } });
    expect(checkPlacement({ spaceId: "41", count: 3, namePrefix: "" }, 3)).toEqual({});
  });
  it("한도의 80% 이상이면 주황", () => {
    expect(usageTone(400, 500)).toBe("warn");
    expect(usageTone(399, 500)).toBe("normal");
    expect(usageTone(1, 0)).toBe("normal");
  });
});

describe("SIM-09.02·09.03 특성 폼 규칙(TC-SIM-096·098)", () => {
  const cooling: PropertyDef = { key: "coolingCapacityKw", name: "냉방 능력", type: "number", unit: "kW", min: 0.5, max: 20, default: 3.5 };
  const mode: PropertyDef = { key: "mode", name: "모드", type: "enum", enumValues: ["cool", "heat"], default: "cool" };
  const inverter: PropertyDef = { key: "inverter", name: "인버터", type: "boolean", default: true };

  it("숫자·선택·불리언 검사, 범위 밖은 허용 범위와 단위", () => {
    expect(checkPropertyValue(cooling, 25)).toEqual({ key: "propertyRange", values: { min: 0.5, max: 20, unit: "kW" } });
    expect(checkPropertyValue(cooling, "abc")).toEqual({ key: "number" });
    expect(checkPropertyValue(cooling, "5")).toBeUndefined();
    expect(checkPropertyValue({ ...cooling, min: null, max: null, unit: null }, 1e9)).toBeUndefined();
    expect(checkPropertyValue(mode, "fan")).toEqual({ key: "enum" });
    expect(checkPropertyValue(mode, "heat")).toBeUndefined();
    expect(checkPropertyValue(inverter, "yes")).toEqual({ key: "boolean" });
    expect(checkPropertyValue(inverter, false)).toBeUndefined();
    expect(coerceProperty(inverter, "true")).toBe(true);
    expect(coerceProperty(mode, 3)).toBe("3");
  });

  it("바꾼 값만 보내고, 되돌리기는 null, 같은 값은 빼고, 모르는 키는 무시", () => {
    const rows: PropertyRow[] = [
      { key: "coolingCapacityKw", value: 5, origin: "PROFILE", def: cooling },
      { key: "mode", value: "cool", origin: "CATALOG", def: mode },
    ];
    expect(overridesDiff(rows, { coolingCapacityKw: "5", mode: "heat", other: 1 })).toEqual({ mode: "heat" });
    expect(overridesDiff(rows, { coolingCapacityKw: null })).toEqual({ coolingCapacityKw: null });
  });

  it("출처 표시: 편집 층은 직접 설정, 나머지는 카탈로그·프로필", () => {
    expect(originLabelKey("DEVICE", "DEVICE")).toBe("direct");
    expect(originLabelKey("PROFILE", "DEVICE")).toBe("profile");
    expect(originLabelKey("CATALOG", "PROFILE")).toBe("catalog");
    expect(checkProfileName("a")).toEqual({ key: "length", values: { min: 2, max: 80 } });
    expect(checkProfileName("강의실 표준")).toBeUndefined();
  });
});

describe("SIM-05.03 장애 주입 요청(TC-SIM-066)", () => {
  it("대상 필수, 지속 1~1,440분, 종류별 강도 범위, 지금/N분 뒤", () => {
    const bad = buildFault({ targetType: "DEVICE", targetIds: [], kind: "SPIKE", params: { magnitude: "x", count: "200" }, startMode: "later", startInMin: "0", durationMin: "0" });
    expect(bad.body).toBeUndefined();
    expect(Object.keys(bad.problems).sort()).toEqual(["durationMin", "params.count", "params.magnitude", "startInMin", "targetIds"]);
    const good = buildFault({ runId: "77", targetType: "DEVICE", targetIds: ["2001"], kind: "SPIKE", params: { magnitude: "20", count: "3" }, startMode: "later", startInMin: "5", durationMin: "30" });
    expect(good.body).toEqual({ runId: "77", targetType: "DEVICE", targetIds: ["2001"], kind: "SPIKE", params: { magnitude: 20, count: 3 }, startInSec: 300, durationSec: 1800 });
    // STUCK 값은 비우면 현재 값(선택), 게이트웨이 장애는 강도 없음
    expect(buildFault({ targetType: "DEVICE", targetIds: ["2001"], kind: "STUCK", params: {}, startMode: "now", startInMin: "", durationMin: "30" }).body).toMatchObject({ params: {}, startInSec: 0 });
    expect(faultSpecs("GATEWAY_DOWN")).toEqual([]);
    expect(faultSpecs("NOPE")).toEqual([]);
    expect(isGatewayFault("DUPLICATE")).toBe(true);
    expect(isGatewayFault("STUCK")).toBe(false);
  });
});

describe("SIM-04.02 실행 제어(TC-SIM-047 일부)", () => {
  it("상태별 가능한 제어: PAUSED면 재개(+정지·초기화), RUNNING이면 일시정지", () => {
    expect(allowedControls("PAUSED")).toEqual({ pause: false, resume: true, stop: true, reset: true, accelerate: true, inject: true });
    expect(allowedControls("RUNNING")).toMatchObject({ pause: true, resume: false });
    expect(allowedControls("COMPLETED")).toMatchObject({ pause: false, resume: false, stop: false, reset: true, inject: false });
    expect(allowedControls("PURGED").reset).toBe(false);
  });
  it("가속 1~60, 실행 본문(시드는 있을 때만)", () => {
    expect(checkAcceleration(61)).toEqual({ key: "range", values: { min: 1, max: 60 } });
    expect(checkAcceleration(60)).toBeUndefined();
    expect(runBody("601", { acceleration: 60, timestampPolicy: "SIMULATED", notificationPolicy: "PREFIX", seed: null })).toEqual({ scenarioId: "601", acceleration: 60, timestampPolicy: "SIMULATED", notificationPolicy: "PREFIX" });
    expect(runBody("601", { acceleration: 1, timestampPolicy: "WALL_CLOCK", notificationPolicy: "SUPPRESS", seed: 4711 }).seed).toBe(4711);
  });
  it("경과·길이 표시", () => {
    expect(formatElapsed(264)).toBe("0:04:24");
    expect(formatElapsed(undefined)).toBe("0:00:00");
    expect(formatDuration(8 * 3600)).toBe("8h");
    expect(formatDuration(7 * 86400)).toBe("7d");
    expect(formatDuration(5400)).toBe("90m");
  });
});

describe("UI-SIM-03 가상 기기 출력 설정", () => {
  it("보고 주기 5~86,400초, 지터 0~50, 장비면 응답 설정, 시드는 정수", () => {
    const bad = buildDeviceOutput({ reportIntervalSec: "1", jitterPct: "60", payloadFormat: "GENERIC_JSON", seed: "1.5", reactionDelaySec: "", ackDelayMs: "0", failurePct: "101" }, true);
    expect(Object.keys(bad.problems).sort()).toEqual(["failurePct", "jitterPct", "reactionDelaySec", "reportIntervalSec", "seed"]);
    expect(buildDeviceOutput({ reportIntervalSec: "60", jitterPct: "10", payloadFormat: "CHIRPSTACK_V4", seed: "" }, false).body).toEqual({ reportIntervalSec: 60, jitterPct: 10, payloadFormat: "CHIRPSTACK_V4" });
    expect(buildDeviceOutput({ reportIntervalSec: "60", jitterPct: "10", payloadFormat: "CHIRPSTACK_V4", seed: "7", reactionDelaySec: "120", ackDelayMs: "500", failurePct: "5" }, true).body).toEqual({ reportIntervalSec: 60, jitterPct: 10, payloadFormat: "CHIRPSTACK_V4", seed: 7, response: { reactionDelaySec: 120, ackDelayMs: 500, failurePct: 5 } });
  });
});

describe("SIM-06.03 재생 파일·매핑(TC-SIM-075 일부)", () => {
  it("파일 필수·10MB·확장자", () => {
    expect(checkReplayFile(null)).toEqual({ key: "fileRequired" });
    expect(checkReplayFile({ name: "a.csv", size: 11 * 1024 * 1024 })).toEqual({ key: "fileTooLarge", values: { max: 10 } });
    expect(checkReplayFile({ name: "a.xlsx", size: 1 })).toEqual({ key: "fileType" });
    expect(checkReplayFile({ name: "A.JSONL", size: 1 })).toBeUndefined();
  });
  it("열 추측과 검사, 재생 본문(현재부터·지정 시각)", () => {
    const mapping = guessMapping(["timestamp", "deviceId", "temperature", "Humidity"]);
    expect(mapping).toEqual({ time: "timestamp", deviceId: "deviceId", metrics: { temperature: "temperature", Humidity: "" } });
    expect(checkMapping({ time: "", deviceId: "x", metrics: { a: "Bad Key" } }, ["timestamp"])).toEqual({ time: { key: "columnRequired" }, deviceId: { key: "columnRequired" }, "metric.a": { key: "metricKey" } });
    expect(checkMapping({ time: "timestamp", deviceId: "deviceId", metrics: {} }, ["timestamp", "deviceId"])).toEqual({ metrics: { key: "metricRequired" } });
    const now = replayBody({ fileId: "f1", mapping, timeFormat: "ISO8601", basis: "NOW", acceleration: 60, cloneSpaceId: "41", cloneSuffix: " [재생]" });
    expect(now.body).toEqual({ source: { type: "FILE", fileId: "f1", columnMapping: { time: "timestamp", deviceId: "deviceId", metrics: { temperature: "temperature" } }, timeFormat: "ISO8601" }, timeShift: { basis: "NOW" }, acceleration: 60, cloneSpaceId: "41", cloneSuffix: " [재생]" });
    expect(replayBody({ fileId: "f1", mapping, timeFormat: "ISO8601", basis: "AT", at: "2026-10-02T00:00:00Z", acceleration: 1, cloneSpaceId: "41" }).body?.timeShift).toEqual({ basis: "AT", at: "2026-10-02T00:00:00.000Z" });
    expect(Object.keys(replayBody({ fileId: "f1", mapping, timeFormat: "ISO8601", basis: "AT", acceleration: 0, cloneSpaceId: "" }).problems).sort()).toEqual(["acceleration", "at", "cloneSpaceId"]);
  });
});

describe("SIM 오류 상세(api-rules §5 errors[], API-SIM-08·12·23)", () => {
  const t = ((key: string, options?: { defaultValue?: string }) => (key === "errors.SIM_PROPERTY_OUT_OF_RANGE" ? "허용 범위를 벗어난 값입니다" : (options?.defaultValue ?? key))) as never;

  it("TC-SIM-098 resultCode 문구에 field: message 상세를 붙이고 5개까지만", () => {
    const errors = Array.from({ length: 7 }, (_, i) => ({ field: `overrides.k${i}`, code: "SIM_PROPERTY_OUT_OF_RANGE", message: "범위 밖" }));
    expect(simErrorText(t, { code: "SIM_PROPERTY_OUT_OF_RANGE", errors: errors.slice(0, 1) })).toBe("허용 범위를 벗어난 값입니다 (overrides.k0: 범위 밖)");
    expect(errorDetails(errors)).toHaveLength(5);
    expect(errorDetails([{ field: null, code: "X", message: null }])).toEqual(["X"]);
    expect(simErrorText(t, { code: "SIM_PROPERTY_OUT_OF_RANGE" })).toBe("허용 범위를 벗어난 값입니다");
    expect(simErrorText(t, null)).toBeUndefined();
  });

  it("TC-SIM-075 재생 파일은 10MB까지(API-SIM-23, BFF 본문 한도)", () => {
    expect(MAX_REPLAY_BYTES).toBe(10 * 1024 * 1024);
    expect(checkReplayFile({ name: "a.csv", size: MAX_REPLAY_BYTES + 1 })).toEqual({ key: "fileTooLarge", values: { max: 10 } });
    expect(checkReplayFile({ name: "a.csv", size: MAX_REPLAY_BYTES })).toBeUndefined();
  });
});
