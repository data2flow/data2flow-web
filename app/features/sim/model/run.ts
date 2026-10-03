/**
 * 실행 제어 패널 상태(UI-SIM-09, SIM-04.02): API-SIM-16 초기 상태에 SSE(API-SIM-31) 이벤트를 차례로 반영한다.
 * - `sim.tick`(1초): 시뮬레이션 시각·진행률·공간 측정값·장비 상태 → 차트 점(공간·항목별 최대 3,600점)
 * - `sim.event`: 이벤트 로그(최신 200건)
 * - `sim.status`: 상태·가속·실패 사유
 * - `sim.throttle`: 속도 제한 띠(`from` → `to`)
 */
import type { RunStatus, SimRun } from "./types";

export const RUN_METRICS = ["temperature", "humidity", "co2", "pm2_5", "occupancy"] as const;
const MAX_POINTS = 3600;
const MAX_LOG = 200;

export interface RunViewState {
  run: SimRun;
  /** `spaceId.metric` → [시뮬레이션 시각, 값] */
  series: Record<string, [string, number][]>;
  actuators: Record<string, Record<string, unknown>>;
  log: { simAt: string; type: string; message: string }[];
  throttle: { from: number; to: number; reason?: string } | null;
  /** 이 화면을 연 뒤 받은 첫 tick의 실제 시각(경과 계산 보정용) */
  lastTickAt: number | null;
}

export function initialRunView(run: SimRun): RunViewState {
  return {
    run,
    series: {},
    actuators: {},
    log: [...(run.lastEvents ?? [])].slice(0, MAX_LOG),
    throttle: run.throttled && run.accelerationRequested !== run.accelerationEffective ? { from: run.accelerationRequested, to: run.accelerationEffective } : null,
    lastTickAt: null,
  };
}

export type RunEvent =
  | { type: "sim.tick"; data: { simClock: string; progressPct?: number; spaces?: Record<string, Record<string, number | null>>; actuators?: Record<string, Record<string, unknown>> }; at: number }
  | { type: "sim.event"; data: { simAt: string; type: string; message: string } }
  | { type: "sim.status"; data: { status: RunStatus; simClock?: string; accelerationEffective?: number; failureReason?: string | null; partial?: boolean } }
  | { type: "sim.throttle"; data: { from: number; to: number; reason?: string } }
  | { type: "patch"; data: Partial<SimRun> };

export function runReducer(state: RunViewState, event: RunEvent): RunViewState {
  switch (event.type) {
    case "sim.tick": {
      const { data } = event;
      const series = { ...state.series };
      for (const [spaceId, values] of Object.entries(data.spaces ?? {})) {
        for (const metric of RUN_METRICS) {
          const v = values?.[metric];
          if (typeof v !== "number") continue;
          const key = `${spaceId}.${metric}`;
          const next = [...(series[key] ?? []), [data.simClock, v] as [string, number]];
          series[key] = next.length > MAX_POINTS ? next.slice(next.length - MAX_POINTS) : next;
        }
      }
      const elapsed = state.lastTickAt === null ? (state.run.elapsedSec ?? 0) : (state.run.elapsedSec ?? 0) + Math.round((event.at - state.lastTickAt) / 1000);
      return {
        ...state,
        series,
        actuators: { ...state.actuators, ...(data.actuators ?? {}) },
        lastTickAt: event.at,
        run: { ...state.run, simClock: data.simClock, progressPct: data.progressPct ?? state.run.progressPct, elapsedSec: state.run.status === "RUNNING" ? elapsed : state.run.elapsedSec },
      };
    }
    case "sim.event":
      return { ...state, log: [event.data, ...state.log].slice(0, MAX_LOG) };
    case "sim.status": {
      const { data } = event;
      return {
        ...state,
        lastTickAt: data.status === "RUNNING" ? state.lastTickAt : null,
        run: {
          ...state.run,
          status: data.status,
          simClock: data.simClock ?? state.run.simClock,
          accelerationEffective: data.accelerationEffective ?? state.run.accelerationEffective,
          failureReason: data.failureReason ?? state.run.failureReason,
        },
      };
    }
    case "sim.throttle":
      return { ...state, throttle: event.data.to < event.data.from ? event.data : null, run: { ...state.run, accelerationEffective: event.data.to, throttled: event.data.to < event.data.from } };
    case "patch":
      return { ...state, run: { ...state.run, ...event.data } };
    default:
      return state;
  }
}

/** 차트 계열(공간·항목별). 값이 있는 계열만 */
export function runChartSeries(state: RunViewState, spaceNames: Record<string, string>, metricLabel: (m: string) => string) {
  return Object.entries(state.series)
    .filter(([, points]) => points.length > 0)
    .map(([key, points]) => {
      const [spaceId, metric] = key.split(".");
      return { key, label: `${spaceNames[spaceId] ?? spaceId} ${metricLabel(metric)}`, unit: metric === "co2" ? "ppm" : metric === "temperature" ? "℃" : metric === "humidity" ? "%" : metric === "pm2_5" ? "㎍/㎥" : null, virtual: true, points: points.map(([t, v]) => [t, v, null] as [string, number, null]) };
    });
}

/** 장비 상태 요약 문자열(`power=ON mode=cool targetTemperature=24`) */
export function actuatorSummary(state: Record<string, unknown> | undefined): string {
  if (!state) return "–";
  return Object.entries(state)
    .filter(([k]) => k !== "version")
    .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join(" ");
}
