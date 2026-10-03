/**
 * 시나리오 타임라인 편집 모델(UI-SIM-08, SIM-04.01, SIM-05.03): 이벤트를 시작 기준 초(offset)로 다루고,
 * 끌어 옮기기·길이 조정의 포인터 계산(px → 초, 1분 격자), 검사, 저장 본문(API-SIM-12) 변환을 맡는다.
 * 화면 부품은 reducer만 부른다(테스트는 스토어 단위, frontend.md §3.4).
 */
import type { Expectation, ExpectationKind, Scenario, ScenarioEvent, Track } from "./types";
import type { Problem } from "./sim";

export const TRACKS: Track[] = ["OCCUPANCY", "OPENING", "ACTUATOR", "FAULT"];
export const EXPECTATION_KINDS: ExpectationKind[] = ["DEVICE_STATE_REACHED", "ALARM_COUNT", "METRIC_RANGE_RATIO", "CONTROL_COUNT_MAX"];
export const MIN_DURATION_SEC = 3600;
export const MAX_DURATION_SEC = 604_800;
export const MAX_EVENTS = 2000;
export const SNAP_SEC = 60;

export interface EditorEvent {
  id: string;
  track: Track;
  atSec: number;
  untilSec: number | null;
  target: Record<string, unknown>;
  params: Record<string, unknown>;
}

export interface EditorExpectation {
  id: string;
  kind: ExpectationKind;
  target: Record<string, unknown>;
  condition: Record<string, unknown>;
  deadlineSec: number | null;
}

export interface ScenarioState {
  scenarioId: string | null;
  name: string;
  spaceIds: string[];
  simStartAt: string;
  durationSec: number;
  seed: number | null;
  useCalendar: boolean;
  outdoor: { max: number; min: number; peakHour: number };
  events: EditorEvent[];
  expectations: EditorExpectation[];
  selectedId: string | null;
  baseVersion: number;
  dirty: boolean;
  /** 서버가 돌려준 위치별 오류(SIM_SCENARIO_INVALID) */
  serverProblems: Record<string, string>;
  seq: number;
}

export type ScenarioAction =
  | { type: "meta"; patch: Partial<Pick<ScenarioState, "name" | "spaceIds" | "simStartAt" | "durationSec" | "seed" | "useCalendar" | "outdoor">> }
  | { type: "add"; track: Track; atSec: number }
  | { type: "select"; id: string | null }
  | { type: "drag"; id: string; mode: "move" | "start" | "end"; deltaPx: number; pxPerSec: number }
  | { type: "update"; id: string; patch: Partial<Pick<EditorEvent, "atSec" | "untilSec" | "target" | "params">> }
  | { type: "remove"; id: string }
  | { type: "addExpectation"; kind: ExpectationKind }
  | { type: "updateExpectation"; id: string; patch: Partial<Omit<EditorExpectation, "id">> }
  | { type: "removeExpectation"; id: string }
  | { type: "saved"; scenarioId: string; version: number }
  | { type: "serverProblems"; problems: Record<string, string> };

const DEFAULT_LENGTH: Record<Track, number | null> = { OCCUPANCY: 3600, OPENING: 600, ACTUATOR: null, FAULT: 1800 };

function defaultParams(track: Track): Record<string, unknown> {
  switch (track) {
    case "OCCUPANCY":
      return { count: 30 };
    case "OPENING":
      return { opening: "WINDOW", open: true };
    case "ACTUATOR":
      return { capability: "Switch", command: "set", args: { on: false } };
    default:
      return { kind: "STUCK", params: {} };
  }
}

function defaultCondition(kind: ExpectationKind): Record<string, unknown> {
  switch (kind) {
    case "DEVICE_STATE_REACHED":
      return { power: "ON" };
    case "ALARM_COUNT":
      return { op: "==", value: 1 };
    case "METRIC_RANGE_RATIO":
      return { min: 22, max: 26, ratio: 0.9 };
    default:
      return { max: 10 };
  }
}

const snap = (sec: number) => Math.round(sec / SNAP_SEC) * SNAP_SEC;
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export function toOffset(simStartAt: string, iso: string | null | undefined): number | null {
  if (!iso) return null;
  const start = Date.parse(simStartAt);
  const at = Date.parse(iso);
  if (Number.isNaN(start) || Number.isNaN(at)) return null;
  return Math.round((at - start) / 1000);
}

export function toIso(simStartAt: string, offsetSec: number): string {
  return new Date(Date.parse(simStartAt) + offsetSec * 1000).toISOString().replace(/\.000Z$/, "Z");
}

export function emptyScenario(simStartAt: string, spaceIds: string[] = []): ScenarioState {
  return {
    scenarioId: null,
    name: "",
    spaceIds,
    simStartAt,
    durationSec: 8 * 3600,
    seed: null,
    useCalendar: false,
    outdoor: { max: 33, min: 25, peakHour: 14 },
    events: [],
    expectations: [],
    selectedId: null,
    baseVersion: 0,
    dirty: false,
    serverProblems: {},
    seq: 0,
  };
}

export function fromScenario(s: Scenario): ScenarioState {
  const d = s.outdoor?.diurnal ?? {};
  return {
    scenarioId: s.scenarioId,
    name: s.name,
    spaceIds: s.spaceIds ?? [],
    simStartAt: s.simStartAt,
    durationSec: s.durationSec,
    seed: s.seed ?? null,
    useCalendar: Boolean(s.useCalendar),
    outdoor: { max: d.max ?? 33, min: d.min ?? 25, peakHour: d.peakHour ?? 14 },
    events: (s.events ?? []).map((e: ScenarioEvent) => ({ id: e.id, track: e.track, atSec: toOffset(s.simStartAt, e.at) ?? 0, untilSec: toOffset(s.simStartAt, e.until), target: { ...(e.target ?? {}) }, params: { ...(e.params ?? {}) } })),
    expectations: (s.expectations ?? []).map((x: Expectation) => ({ id: x.id, kind: x.kind, target: { ...(x.target ?? {}) }, condition: { ...(x.condition ?? {}) }, deadlineSec: toOffset(s.simStartAt, x.deadline) })),
    selectedId: null,
    baseVersion: s.version,
    dirty: false,
    serverProblems: {},
    seq: 0,
  };
}

function nextId(state: ScenarioState, prefix: string): { id: string; seq: number } {
  let seq = state.seq;
  const used = new Set([...state.events.map((e) => e.id), ...state.expectations.map((x) => x.id)]);
  let id: string;
  do {
    seq += 1;
    id = `${prefix}-${seq}`;
  } while (used.has(id));
  return { id, seq };
}

/** 끌기 계산: px → 초(1분 격자). 옮기기는 길이를 유지하고 범위 안으로, 길이 조정은 최소 1분 */
export function dragEvent(event: EditorEvent, mode: "move" | "start" | "end", deltaPx: number, pxPerSec: number, durationSec: number): EditorEvent {
  const delta = snap(deltaPx / pxPerSec);
  if (mode === "move") {
    const length = event.untilSec === null ? 0 : event.untilSec - event.atSec;
    const at = clamp(event.atSec + delta, 0, durationSec - length);
    return { ...event, atSec: at, untilSec: event.untilSec === null ? null : at + length };
  }
  if (event.untilSec === null) return mode === "start" ? { ...event, atSec: clamp(event.atSec + delta, 0, durationSec) } : event;
  if (mode === "start") return { ...event, atSec: clamp(event.atSec + delta, 0, event.untilSec - SNAP_SEC) };
  return { ...event, untilSec: clamp(event.untilSec + delta, event.atSec + SNAP_SEC, durationSec) };
}

export function scenarioReducer(state: ScenarioState, action: ScenarioAction): ScenarioState {
  switch (action.type) {
    case "meta":
      return { ...state, ...action.patch, dirty: true };
    case "add": {
      if (state.events.length >= MAX_EVENTS) return state;
      const { id, seq } = nextId(state, "ev");
      const length = DEFAULT_LENGTH[action.track];
      const atSec = clamp(snap(action.atSec), 0, Math.max(0, state.durationSec - (length ?? 0)));
      const target: Record<string, unknown> = action.track === "OCCUPANCY" || action.track === "OPENING" ? { spaceId: state.spaceIds[0] ?? "" } : { deviceId: "" };
      const event: EditorEvent = { id, track: action.track, atSec, untilSec: length === null ? null : atSec + length, target, params: defaultParams(action.track) };
      return { ...state, seq, events: [...state.events, event], selectedId: id, dirty: true };
    }
    case "select":
      return { ...state, selectedId: action.id };
    case "drag":
      return { ...state, dirty: true, events: state.events.map((e) => (e.id === action.id ? dragEvent(e, action.mode, action.deltaPx, action.pxPerSec, state.durationSec) : e)) };
    case "update":
      return { ...state, dirty: true, events: state.events.map((e) => (e.id === action.id ? { ...e, ...action.patch } : e)) };
    case "remove":
      return { ...state, dirty: true, events: state.events.filter((e) => e.id !== action.id), selectedId: state.selectedId === action.id ? null : state.selectedId };
    case "addExpectation": {
      const { id, seq } = nextId(state, "ex");
      const target: Record<string, unknown> = action.kind === "METRIC_RANGE_RATIO" ? { spaceId: state.spaceIds[0] ?? "", metric: "temperature" } : action.kind === "ALARM_COUNT" ? { spaceId: state.spaceIds[0] ?? "" } : { deviceId: "" };
      return { ...state, seq, dirty: true, expectations: [...state.expectations, { id, kind: action.kind, target, condition: defaultCondition(action.kind), deadlineSec: action.kind === "DEVICE_STATE_REACHED" ? Math.min(state.durationSec, 3600) : null }] };
    }
    case "updateExpectation":
      return { ...state, dirty: true, expectations: state.expectations.map((x) => (x.id === action.id ? { ...x, ...action.patch } : x)) };
    case "removeExpectation":
      return { ...state, dirty: true, expectations: state.expectations.filter((x) => x.id !== action.id) };
    case "saved":
      return { ...state, scenarioId: action.scenarioId, baseVersion: action.version, dirty: false, serverProblems: {} };
    case "serverProblems":
      return { ...state, serverProblems: action.problems };
    default:
      return state;
  }
}

/** 검사(UI-SIM-08 입력 검증). 키는 `name`, `durationSec`, `events.{id}`, `expectations.{id}` */
export function checkScenario(state: ScenarioState): Record<string, Problem> {
  const out: Record<string, Problem> = {};
  if (state.name.trim().length < 1 || state.name.trim().length > 80) out.name = { key: "length", values: { min: 1, max: 80 } };
  if (state.spaceIds.length === 0) out.spaceIds = { key: "spaceRequired" };
  if (Number.isNaN(Date.parse(state.simStartAt))) out.simStartAt = { key: "dateTime" };
  if (!Number.isInteger(state.durationSec) || state.durationSec < MIN_DURATION_SEC || state.durationSec > MAX_DURATION_SEC) out.durationSec = { key: "durationRange" };
  if (state.events.length > MAX_EVENTS) out.events = { key: "tooManyEvents", values: { max: MAX_EVENTS } };
  for (const e of state.events) {
    const outside = e.atSec < 0 || e.atSec > state.durationSec || (e.untilSec !== null && (e.untilSec > state.durationSec || e.untilSec <= e.atSec));
    if (outside) {
      out[`events.${e.id}`] = { key: "eventOutOfRange" };
      continue;
    }
    if (e.track === "OCCUPANCY") {
      const count = Number(e.params.count);
      if (!Number.isInteger(count) || count < 0 || count > 1000) out[`events.${e.id}`] = { key: "occupancy" };
    }
  }
  for (const x of state.expectations) {
    if (x.deadlineSec !== null && (x.deadlineSec < 0 || x.deadlineSec > state.durationSec)) out[`expectations.${x.id}`] = { key: "deadlineOutOfRange" };
  }
  return out;
}

/** 저장 본문(API-SIM-12 POST·PUT) */
export function scenarioBody(state: ScenarioState): Record<string, unknown> {
  const body: Record<string, unknown> = {
    name: state.name.trim(),
    spaceIds: state.spaceIds,
    simStartAt: state.simStartAt,
    durationSec: state.durationSec,
    useCalendar: state.useCalendar,
    outdoor: { mode: "DIURNAL", diurnal: { ...state.outdoor } },
    events: state.events.map((e) => {
      const out: Record<string, unknown> = { id: e.id, track: e.track, at: toIso(state.simStartAt, e.atSec), target: e.target, params: e.params };
      if (e.untilSec !== null) out.until = toIso(state.simStartAt, e.untilSec);
      return out;
    }),
    expectations: state.expectations.map((x) => {
      const out: Record<string, unknown> = { id: x.id, kind: x.kind, target: x.target, condition: x.condition };
      if (x.deadlineSec !== null) out.deadline = toIso(state.simStartAt, x.deadlineSec);
      return out;
    }),
  };
  if (state.seed !== null) body.seed = state.seed;
  if (state.scenarioId) body.baseVersion = state.baseVersion;
  return body;
}

/** 서버 위치(`events[3].at`)를 이벤트 ID 키로 */
export function mapServerProblems(state: ScenarioState, errors: { field: string; message: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const err of errors) {
    const match = /^(events|expectations)\[(\d+)\]/.exec(err.field);
    if (match) {
      const list = match[1] === "events" ? state.events : state.expectations;
      const item = list[Number(match[2])];
      if (item) {
        out[`${match[1]}.${item.id}`] = err.message;
        continue;
      }
    }
    out[err.field || "_"] = err.message;
  }
  return out;
}

/** 시간축 눈금(1시간 간격, 7일이면 6시간) */
export function axisTicks(durationSec: number): number[] {
  const step = durationSec > 2 * 86_400 ? 6 * 3600 : durationSec > 86_400 ? 3 * 3600 : 3600;
  const out: number[] = [];
  for (let t = 0; t <= durationSec; t += step) out.push(t);
  return out;
}
