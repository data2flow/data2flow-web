/**
 * 제어 화면 모델(ACT-02.04 상태 쌍, ACT-04.01 컨트롤 범위, ACT-04.02 진행 표시, ACT-04.03 이력 표시).
 */
import { describe, expect, it } from "vitest";
import { FLOW_COMMAND, SWITCH, THERMOSTAT, aircon } from "../../__tests__/fixtures";
import {
  attributeRange,
  changedArgs,
  commandDurationMs,
  commandLabel,
  createDebounceGuard,
  currentValue,
  failureReason,
  historyQuery,
  localToUtc,
  mergeReported,
  nextStatus,
  progressOf,
  requestedAt,
  syncState,
  validateArgs,
  writableAttributes,
} from "../control";

describe("ACT-04.01 컨트롤 범위(기능 정의 ∩ 모델 제약·조직 한계)", () => {
  it("목표 온도는 좁은 범위 18~28, 0.5 단위, 모드는 모델이 지원하는 것만", () => {
    expect(attributeRange(THERMOSTAT, "targetTemperature")).toEqual({ min: 18, max: 28, step: 0.5, enum: undefined, unit: "℃" });
    expect(attributeRange(THERMOSTAT, "mode").enum).toEqual(["off", "cool", "heat", "auto"]);
    expect(attributeRange(SWITCH, "on")).toEqual({ min: undefined, max: undefined, step: undefined, enum: undefined, unit: undefined });
    expect(attributeRange({ ...THERMOSTAT, effectiveConstraints: null }, "targetTemperature")).toMatchObject({ min: 5, max: 35 });
    expect(attributeRange({ name: "X", attributes: [{ name: "level", type: "integer" }], commands: [], effectiveConstraints: { level: { min: 1, max: 3 } } }, "level")).toMatchObject({ min: 1, max: 3, step: 1 });
  });

  it("읽기 전용 속성과 set 명령이 바꾸지 않는 속성은 입력을 만들지 않는다", () => {
    expect(writableAttributes(THERMOSTAT).map((a) => a.name)).toEqual(["mode", "targetTemperature"]);
    expect(writableAttributes({ name: "Contact", attributes: [{ name: "open", type: "boolean", readOnly: true }], commands: [] })).toEqual([]);
    expect(writableAttributes({ name: "C", attributes: [{ name: "a", type: "string" }], commands: [{ name: "set" }] }).map((a) => a.name)).toEqual(["a"]);
  });

  it("범위·단위·선택지·타입 검증(TC-ACT-085 입력 단계 거부)", () => {
    expect(validateArgs(THERMOSTAT, { targetTemperature: 24 })).toEqual([]);
    expect(validateArgs(THERMOSTAT, { targetTemperature: 30 })).toEqual([{ attribute: "targetTemperature", kind: "range", min: 18, max: 28 }]);
    expect(validateArgs(THERMOSTAT, { targetTemperature: 24.3 })[0]?.kind).toBe("range");
    expect(validateArgs(THERMOSTAT, { targetTemperature: "x" })[0]?.kind).toBe("type");
    expect(validateArgs(THERMOSTAT, { mode: "dry" })[0]?.kind).toBe("enum");
    expect(validateArgs(SWITCH, { on: "yes" })[0]?.kind).toBe("type");
    expect(validateArgs(THERMOSTAT, { unknown: 1 })).toEqual([]);
  });

  it("명령은 목표 상태 설정이고 바꾼 값만 보낸다(BR-ACT-03)", () => {
    const shadow = aircon().shadow;
    expect(currentValue(shadow, "Thermostat", "targetTemperature")).toBe(26);
    expect(currentValue({ reported: { Switch: { on: false } } }, "Switch", "on")).toBe(false);
    expect(changedArgs(shadow, "Thermostat", { mode: "cool", targetTemperature: 24, x: undefined, y: "" })).toEqual({ targetTemperature: 24 });
    expect(changedArgs(shadow, "Thermostat", {})).toEqual({});
  });
});

describe("ACT-02.04 원하는 상태·실제 상태(TC-ACT-044)", () => {
  it("차이 없음 → 일치, 진행 중 명령·오프라인 → 적용 대기, 그 밖의 차이 → 기기에서 직접 변경됨", () => {
    const base = aircon().shadow!;
    expect(syncState(base, "Thermostat", new Set())).toBe("synced");
    const changed = mergeReported(base, { Thermostat: { targetTemperature: 22 } }, "2026-10-04T00:00:00Z");
    expect(changed.desired?.Thermostat.targetTemperature).toBe(26);
    expect(changed.delta).toEqual({ Thermostat: { targetTemperature: 26 } });
    expect(changed.reportedAt).toBe("2026-10-04T00:00:00Z");
    expect(syncState(changed, "Thermostat", new Set())).toBe("deviceChanged");
    expect(syncState(changed, "Thermostat", new Set(["Thermostat"]))).toBe("pending");
    expect(syncState({ ...changed, connectivity: "OFFLINE" }, "Thermostat", new Set())).toBe("pending");
    // delta가 없으면 desired·reported를 직접 비교한다
    expect(syncState({ desired: { Switch: { on: true } }, reported: { Switch: { on: false } } }, "Switch", new Set())).toBe("deviceChanged");
    expect(syncState(null, "Switch", new Set())).toBe("synced");
  });

  it("상태가 객체가 아니면 그대로, 보고 시각이 없으면 이전 값", () => {
    const base = aircon().shadow!;
    expect(mergeReported(base, null)).toEqual(base);
    expect(mergeReported(undefined, { Switch: { on: false }, bad: 3 }).reported).toEqual({ Switch: { on: false } });
    expect(mergeReported(base, { Switch: { on: true } }).reportedAt).toBe(base.reportedAt);
  });
});

describe("ACT-04.02 진행 표시", () => {
  it("단계 수·끝·실패·대기", () => {
    expect(progressOf("REQUESTED")).toEqual({ done: 1, terminal: false, failed: false, waiting: false });
    expect(progressOf("APPLIED")).toEqual({ done: 4, terminal: true, failed: false, waiting: false });
    expect(progressOf("QUEUED")).toMatchObject({ waiting: true, terminal: false });
    expect(progressOf("TIMEOUT")).toMatchObject({ failed: true, terminal: true });
    expect(progressOf("WHATEVER")).toMatchObject({ failed: false, terminal: true });
  });

  it("뒤바뀐 이벤트는 단계를 되돌리지 않고, 끝난 명령은 바뀌지 않는다", () => {
    expect(nextStatus(undefined, "SENT")).toBe("SENT");
    expect(nextStatus("ACKED", "SENT")).toBe("ACKED");
    expect(nextStatus("SENT", "ACKED")).toBe("ACKED");
    expect(nextStatus("APPLIED", "SENT")).toBe("APPLIED");
    expect(nextStatus("SENT", "TIMEOUT")).toBe("TIMEOUT");
    expect(nextStatus("SENT", "QUEUED")).toBe("QUEUED");
  });

  it("1초 연타 방지", () => {
    let now = 0;
    const guard = createDebounceGuard(1000, () => now);
    expect(guard()).toBe(true);
    now = 500;
    expect(guard()).toBe(false);
    now = 1000;
    expect(guard()).toBe(true);
  });
});

describe("ACT-04.03 이력 표시", () => {
  it("명령 표기·소요 시간·요청 시각·사유", () => {
    expect(commandLabel(FLOW_COMMAND)).toBe("Thermostat.set(cool, 24)");
    expect(commandLabel({ capability: "Switch", command: "set", args: null })).toBe("Switch.set()");
    expect(commandDurationMs(FLOW_COMMAND)).toBe(2100);
    expect(commandDurationMs({ timeline: [] })).toBeNull();
    expect(commandDurationMs({ timeline: [{ status: "A", at: "x" }, { status: "B", at: "y" }] })).toBeNull();
    expect(requestedAt(FLOW_COMMAND)).toBe("2026-10-03T01:12:03Z");
    expect(requestedAt({ createdAt: "c", timeline: [] })).toBe("c");
    expect(failureReason({ message: "창문 열림", statusReason: "INTERLOCK" })).toBe("창문 열림");
    expect(failureReason({ message: null, statusReason: "INTERLOCK" })).toBe("INTERLOCK");
    expect(failureReason({})).toBeUndefined();
  });

  it("필터를 API 쿼리로(시각은 조직 시간대 → UTC), 커서·크기", () => {
    const q = historyQuery(new URLSearchParams("from=2026-10-03T09:00&to=2026-10-04T00:00:00Z&status=APPLIED&sourceType=&cursor=50&tab=commands"), 50, { spaceId: "31", x: null });
    expect(q.get("from")).toBe("2026-10-03T00:00:00Z");
    expect(q.get("to")).toBe("2026-10-04T00:00:00Z");
    expect(q.get("status")).toBe("APPLIED");
    expect(q.has("sourceType")).toBe(false);
    expect(q.get("cursor")).toBe("50");
    expect(q.get("size")).toBe("50");
    expect(q.get("spaceId")).toBe("31");
    expect(q.has("tab")).toBe(false);
    expect(localToUtc("garbage", "Asia/Seoul")).toBeUndefined();
    expect(localToUtc("2026-13-40T09:00", "Asia/Seoul")).toBeUndefined();
  });
});
