/**
 * TC-SIM-047 UI-SIM-09 실행 패널 상태(SIM-04.02, AT-SIM-08.2): SSE `sim.tick`·`sim.event`·`sim.status`·`sim.throttle` 반영 순서.
 */
import { describe, expect, it } from "vitest";
import { actuatorSummary, initialRunView, runChartSeries, runReducer } from "../run";
import type { SimRun } from "../types";

const RUN: SimRun = { runId: "42", status: "RUNNING", accelerationRequested: 60, accelerationEffective: 60, throttled: false, simClock: "2026-08-12T04:00:00Z", elapsedSec: 10, progressPct: 1, lastEvents: [{ simAt: "2026-08-12T04:00:00Z", type: "SCENARIO", message: "시작" }] };

describe("TC-SIM-047 AT-SIM-08.2 실행 상태 반영", () => {
  it("tick: 시뮬레이션 시각·진행률·경과(실제 시간)·공간별 계열·장비 상태", () => {
    let s = initialRunView(RUN);
    expect(s.log).toHaveLength(1);
    expect(s.throttle).toBeNull();
    s = runReducer(s, { type: "sim.tick", data: { simClock: "2026-08-12T04:01:00Z", progressPct: 2, spaces: { "41": { temperature: 27.4, co2: 900, occupancy: 30, humidity: null } }, actuators: { "2002": { power: "OFF" } } }, at: 1000 });
    s = runReducer(s, { type: "sim.tick", data: { simClock: "2026-08-12T04:02:00Z", spaces: { "41": { temperature: 27.2 } }, actuators: { "2002": { power: "ON", mode: "cool", targetTemperature: 24, version: 4 } } }, at: 3000 });
    expect(s.run).toMatchObject({ simClock: "2026-08-12T04:02:00Z", progressPct: 2, elapsedSec: 12 });
    expect(s.series["41.temperature"]).toEqual([
      ["2026-08-12T04:01:00Z", 27.4],
      ["2026-08-12T04:02:00Z", 27.2],
    ]);
    expect(s.series["41.humidity"]).toBeUndefined();
    expect(actuatorSummary(s.actuators["2002"])).toBe("power=ON mode=cool targetTemperature=24");
    expect(actuatorSummary(undefined)).toBe("–");
    expect(actuatorSummary({ a: { b: 1 } })).toBe('a={"b":1}');
    const series = runChartSeries(s, { "41": "데모 강의실" }, (m) => m);
    expect(series.map((x) => [x.label, x.unit])).toEqual([
      ["데모 강의실 temperature", "℃"],
      ["데모 강의실 co2", "ppm"],
      ["데모 강의실 occupancy", null],
    ]);
    expect(runChartSeries({ ...s, series: { "9.humidity": [["t", 1]], "9.pm2_5": [["t", 2]] } }, {}, (m) => m).map((x) => x.unit)).toEqual(["%", "㎍/㎥"]);
  });

  it("event는 최신이 위로, status는 상태·가속·실패 사유, 정지되면 경과를 더하지 않음", () => {
    let s = initialRunView(RUN);
    s = runReducer(s, { type: "sim.event", data: { simAt: "2026-08-12T04:12:00Z", type: "COMMAND", message: "AC-1 Thermostat.set(cool, 24)" } });
    expect(s.log[0].type).toBe("COMMAND");
    s = runReducer(s, { type: "sim.status", data: { status: "PAUSED" } });
    expect(s.run.status).toBe("PAUSED");
    s = runReducer(s, { type: "sim.tick", data: { simClock: "2026-08-12T04:13:00Z" }, at: 5000 });
    expect(s.run.elapsedSec).toBe(10);
    s = runReducer(s, { type: "sim.status", data: { status: "FAILED", failureReason: "INTERNAL", accelerationEffective: 30, simClock: "2026-08-12T04:20:00Z" } });
    expect(s.run).toMatchObject({ status: "FAILED", failureReason: "INTERNAL", accelerationEffective: 30, simClock: "2026-08-12T04:20:00Z" });
    s = runReducer(s, { type: "sim.status", data: { status: "RUNNING" } });
    expect(s.run.failureReason).toBe("INTERNAL");
  });

  it("throttle: 낮추면 띠(from→to), 되돌리면 띠 없음, 초기 상태가 제한 중이면 띠", () => {
    let s = initialRunView(RUN);
    s = runReducer(s, { type: "sim.throttle", data: { from: 60, to: 24, reason: "INGEST_PROTECTION" } });
    expect(s.throttle).toEqual({ from: 60, to: 24, reason: "INGEST_PROTECTION" });
    expect(s.run).toMatchObject({ accelerationEffective: 24, throttled: true });
    s = runReducer(s, { type: "sim.throttle", data: { from: 24, to: 60 } });
    expect(s.throttle).toBeNull();
    expect(initialRunView({ ...RUN, throttled: true, accelerationEffective: 24 }).throttle).toEqual({ from: 60, to: 24 });
    expect(runReducer(s, { type: "patch", data: { status: "STOPPED" } }).run.status).toBe("STOPPED");
    expect(runReducer(s, { type: "nope" } as never)).toBe(s);
  });

  it("공간 계열은 최대 3,600점", () => {
    let s = initialRunView(RUN);
    s = { ...s, series: { "41.co2": Array.from({ length: 3600 }, (_, i) => [String(i), i] as [string, number]) } };
    s = runReducer(s, { type: "sim.tick", data: { simClock: "x", spaces: { "41": { co2: 1 } } }, at: 0 });
    expect(s.series["41.co2"]).toHaveLength(3600);
    expect(s.series["41.co2"].at(-1)).toEqual(["x", 1]);
  });
});
