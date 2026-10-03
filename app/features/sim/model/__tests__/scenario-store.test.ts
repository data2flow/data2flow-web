/**
 * TC-SIM-042 UI-SIM-08 시나리오 타임라인 스토어(SIM-04.01, AT-SIM-07.1): 트랙 이벤트 추가·끌기 옮기기·길이 조정(px → 초, 1분 격자),
 * 검사(범위·재실 인원·기한·길이), 저장 본문(ISO 시각, baseVersion), 서버 위치 오류 매핑.
 */
import { describe, expect, it } from "vitest";
import { axisTicks, checkScenario, dragEvent, emptyScenario, fromScenario, mapServerProblems, scenarioBody, scenarioReducer, toIso, toOffset, type ScenarioState } from "../scenario";
import type { Scenario } from "../types";

const START = "2026-08-12T00:00:00Z";

function withEvents(): ScenarioState {
  let s = emptyScenario(START, ["41"]);
  s = scenarioReducer(s, { type: "meta", patch: { name: "여름 강의실 과밀" } });
  s = scenarioReducer(s, { type: "add", track: "OCCUPANCY", atSec: 3600 });
  s = scenarioReducer(s, { type: "add", track: "ACTUATOR", atSec: 7200 });
  return s;
}

describe("TC-SIM-042 AT-SIM-07.1 타임라인 스토어", () => {
  it("트랙 이벤트 추가: 기본 길이·대상·파라미터, 선택, dirty", () => {
    const s = withEvents();
    expect(s.events).toHaveLength(2);
    expect(s.events[0]).toMatchObject({ id: "ev-1", track: "OCCUPANCY", atSec: 3600, untilSec: 7200, target: { spaceId: "41" }, params: { count: 30 } });
    expect(s.events[1]).toMatchObject({ id: "ev-2", track: "ACTUATOR", untilSec: null, target: { deviceId: "" } });
    expect(s.selectedId).toBe("ev-2");
    expect(s.dirty).toBe(true);
    const all = (["OPENING", "FAULT"] as const).reduce((acc, track) => scenarioReducer(acc, { type: "add", track, atSec: 28_000 * 2 }), s);
    // 범위 끝을 넘지 않게 당긴다(FAULT 기본 30분)
    expect(all.events.at(-1)).toMatchObject({ track: "FAULT", atSec: 8 * 3600 - 1800, untilSec: 8 * 3600, params: { kind: "STUCK" } });
  });

  it("끌어 옮기기: px/초 비율로 계산, 1분 격자, 길이 유지, 범위 안으로", () => {
    let s = withEvents();
    // 트랙 폭 800px = 8시간 → 1px = 36초. 100px = 3600초
    const pxPerSec = 800 / s.durationSec;
    s = scenarioReducer(s, { type: "drag", id: "ev-1", mode: "move", deltaPx: 100, pxPerSec });
    expect(s.events[0]).toMatchObject({ atSec: 7200, untilSec: 10_800 });
    s = scenarioReducer(s, { type: "drag", id: "ev-1", mode: "move", deltaPx: 5000, pxPerSec });
    expect(s.events[0]).toMatchObject({ atSec: 8 * 3600 - 3600, untilSec: 8 * 3600 });
    s = scenarioReducer(s, { type: "drag", id: "ev-1", mode: "move", deltaPx: -5000, pxPerSec });
    expect(s.events[0].atSec).toBe(0);
    // 37px ≈ 1332초 → 1분 격자 1320초
    s = scenarioReducer(s, { type: "drag", id: "ev-1", mode: "end", deltaPx: 37, pxPerSec });
    expect(s.events[0].untilSec).toBe(3600 + 1320);
    // 길이 조정 최소 1분
    s = scenarioReducer(s, { type: "drag", id: "ev-1", mode: "end", deltaPx: -5000, pxPerSec });
    expect(s.events[0].untilSec).toBe(60);
    s = scenarioReducer(s, { type: "drag", id: "ev-1", mode: "start", deltaPx: 5000, pxPerSec });
    expect(s.events[0].atSec).toBe(0);
  });

  it("끝 없는 이벤트(장비 조작)는 시작만 옮긴다", () => {
    const e = { id: "a", track: "ACTUATOR" as const, atSec: 600, untilSec: null, target: {}, params: {} };
    expect(dragEvent(e, "end", 100, 1, 3600)).toBe(e);
    expect(dragEvent(e, "start", 120, 1, 3600).atSec).toBe(720);
    expect(dragEvent(e, "move", -10_000, 1, 3600).atSec).toBe(0);
  });

  it("수정·삭제·기대 결과 추가·수정·삭제, 저장 후 dirty 해제", () => {
    let s = withEvents();
    s = scenarioReducer(s, { type: "update", id: "ev-1", patch: { params: { count: 5 } } });
    expect(s.events[0].params.count).toBe(5);
    s = scenarioReducer(s, { type: "addExpectation", kind: "DEVICE_STATE_REACHED" });
    s = scenarioReducer(s, { type: "addExpectation", kind: "METRIC_RANGE_RATIO" });
    s = scenarioReducer(s, { type: "addExpectation", kind: "ALARM_COUNT" });
    s = scenarioReducer(s, { type: "addExpectation", kind: "CONTROL_COUNT_MAX" });
    expect(s.expectations.map((x) => x.id)).toEqual(["ex-3", "ex-4", "ex-5", "ex-6"]);
    expect(s.expectations[0]).toMatchObject({ condition: { power: "ON" }, deadlineSec: 3600 });
    expect(s.expectations[1]).toMatchObject({ target: { spaceId: "41", metric: "temperature" }, condition: { min: 22, max: 26, ratio: 0.9 } });
    s = scenarioReducer(s, { type: "updateExpectation", id: "ex-3", patch: { target: { deviceId: "2002" } } });
    s = scenarioReducer(s, { type: "removeExpectation", id: "ex-6" });
    s = scenarioReducer(s, { type: "remove", id: "ev-2" });
    expect(s.selectedId).toBeNull();
    s = scenarioReducer(s, { type: "select", id: "ev-1" });
    s = scenarioReducer(s, { type: "remove", id: "ev-1" });
    expect(s.events).toEqual([]);
    s = scenarioReducer(s, { type: "saved", scenarioId: "601", version: 4 });
    expect(s).toMatchObject({ scenarioId: "601", baseVersion: 4, dirty: false });
    expect(scenarioReducer(s, { type: "unknown" } as never)).toBe(s);
  });

  it("검사: 이름·대상 공간·길이 1시간~7일·이벤트 범위·재실 0~1,000·기한", () => {
    let s = emptyScenario("not-a-date");
    s = scenarioReducer(s, { type: "meta", patch: { durationSec: 1800 } });
    expect(Object.keys(checkScenario(s)).sort()).toEqual(["durationSec", "name", "simStartAt", "spaceIds"]);
    s = withEvents();
    s = scenarioReducer(s, { type: "update", id: "ev-1", patch: { untilSec: 9 * 3600 } });
    s = scenarioReducer(s, { type: "update", id: "ev-2", patch: { atSec: -60 } });
    s = scenarioReducer(s, { type: "add", track: "OCCUPANCY", atSec: 0 });
    s = scenarioReducer(s, { type: "update", id: s.events[2].id, patch: { params: { count: 1001 } } });
    s = scenarioReducer(s, { type: "addExpectation", kind: "DEVICE_STATE_REACHED" });
    s = scenarioReducer(s, { type: "updateExpectation", id: s.expectations[0].id, patch: { deadlineSec: 9 * 3600 } });
    const problems = checkScenario(s);
    expect(problems["events.ev-1"]).toEqual({ key: "eventOutOfRange" });
    expect(problems["events.ev-2"]).toEqual({ key: "eventOutOfRange" });
    expect(problems[`events.${s.events[2].id}`]).toEqual({ key: "occupancy" });
    expect(problems[`expectations.${s.expectations[0].id}`]).toEqual({ key: "deadlineOutOfRange" });
  });

  it("저장 본문: 오프셋 → ISO, 끝 없는 이벤트는 until 없음, 수정이면 baseVersion, 시드 있을 때만", () => {
    let s = withEvents();
    s = scenarioReducer(s, { type: "meta", patch: { seed: 4711 } });
    const body = scenarioBody(s);
    expect(body).toMatchObject({ name: "여름 강의실 과밀", spaceIds: ["41"], simStartAt: START, durationSec: 28_800, seed: 4711, outdoor: { mode: "DIURNAL", diurnal: { max: 33, min: 25, peakHour: 14 } } });
    expect(body.baseVersion).toBeUndefined();
    expect((body.events as Record<string, unknown>[])[0]).toEqual({ id: "ev-1", track: "OCCUPANCY", at: "2026-08-12T01:00:00Z", until: "2026-08-12T02:00:00Z", target: { spaceId: "41" }, params: { count: 30 } });
    expect((body.events as Record<string, unknown>[])[1].until).toBeUndefined();
    const saved = scenarioReducer(s, { type: "saved", scenarioId: "601", version: 3 });
    expect(scenarioBody(saved).baseVersion).toBe(3);
  });

  it("불러오기(API-SIM-12) ↔ 저장 본문 왕복이 같다", () => {
    const scenario: Scenario = {
      scenarioId: "601",
      name: "폭염 오후",
      spaceIds: ["41"],
      simStartAt: START,
      durationSec: 14_400,
      seed: 4711,
      useCalendar: true,
      outdoor: { mode: "DIURNAL", diurnal: { max: 35, min: 27, peakHour: 15 } },
      events: [{ id: "ev-1", track: "OCCUPANCY", at: "2026-08-12T00:00:00Z", until: "2026-08-12T03:00:00Z", target: { spaceId: "41" }, params: { count: 30 } }],
      expectations: [{ id: "ex-1", kind: "DEVICE_STATE_REACHED", target: { deviceId: "2002" }, condition: { power: "ON" }, deadline: "2026-08-12T01:00:00Z" }],
      version: 3,
    };
    const state = fromScenario(scenario);
    expect(state).toMatchObject({ baseVersion: 3, outdoor: { max: 35, min: 27, peakHour: 15 }, useCalendar: true });
    const body = scenarioBody(state);
    expect(body.events).toEqual(scenario.events);
    expect(body.expectations).toEqual(scenario.expectations);
    expect(fromScenario({ ...scenario, outdoor: { mode: "WEATHER" }, events: undefined as never, expectations: undefined as never }).outdoor).toEqual({ max: 33, min: 25, peakHour: 14 });
  });

  it("서버 위치 오류(SIM_SCENARIO_INVALID events[1].at) → 이벤트 키, 시각 변환·눈금", () => {
    const s = withEvents();
    expect(mapServerProblems(s, [{ field: "events[1].at", message: "범위 밖" }, { field: "expectations[9]", message: "x" }, { field: "name", message: "y" }])).toEqual({ "events.ev-2": "범위 밖", "expectations[9]": "x", name: "y" });
    expect(toOffset(START, "2026-08-12T00:10:00Z")).toBe(600);
    expect(toOffset(START, null)).toBeNull();
    expect(toOffset("bad", START)).toBeNull();
    expect(toIso(START, 90)).toBe("2026-08-12T00:01:30Z");
    expect(axisTicks(4 * 3600)).toEqual([0, 3600, 7200, 10_800, 14_400]);
    expect(axisTicks(7 * 86_400)).toHaveLength(29);
    expect(axisTicks(2 * 86_400)[1]).toBe(3 * 3600);
  });
});
