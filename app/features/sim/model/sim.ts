/**
 * 가상 환경 화면 모델(SIM): 한도·사용량 표시, 공간 물리 프리셋과 범위 검사(UI-SIM-06), 배치 검사(UI-SIM-02),
 * 특성 폼(UI-SIM-04, BR-SIM-02·03), 장애 주입 파라미터(UI-SIM-10), 실행 옵션(API-SIM-14), 가상 기기 출력 설정(UI-SIM-03).
 * 화면 부품과 route action이 같은 검사를 쓴다. 오류는 i18n 키(`sim.validation.*`)와 보간 값으로 돌려준다.
 */
import type { PropertyDef, PropertyOrigin, PropertyRow, RunStatus, SpacePhysics, SpacePreset } from "./types";

/** BR-SIM-08 한도 */
export const DEVICE_LIMIT = 500;
export const RUN_LIMIT = 5;
export const MAX_ACCELERATION = 60;

export interface Problem {
  key: string;
  values?: Record<string, string | number>;
}

/** 한도의 80%를 넘으면 주황(UI-SIM-01) */
export function usageTone(used: number, limit: number): "warn" | "normal" {
  return limit > 0 && used / limit >= 0.8 ? "warn" : "normal";
}

/** 데모 프리셋 5종(API-SIM-18). M3 시연은 heatwave-afternoon x60 */
export const PRESET_KEYS = ["classroom-crowded", "heatwave-afternoon", "sensor-failure", "gateway-outage", "night-unmanned"] as const;
export const DEFAULT_DEMO_ACCELERATION = 30;
export const ACCELERATION_CHOICES = [1, 5, 10, 30, 60] as const;

// ───────── 공간 물리(UI-SIM-06) ─────────

export const SPACE_PRESETS: SpacePreset[] = ["CLASSROOM", "OFFICE", "MEETING", "CUSTOM"];

const BASE: SpacePhysics = {
  areaM2: 66,
  heightM: 3,
  uValue: 1.2,
  envelopeM2: 80,
  windowM2: 12,
  windowOrientation: "S",
  solarGainFactor: 0.4,
  initialState: { temperature: 24, humidity: 50, co2: 450, pm2_5: 15, illumination: 300 },
  outdoorLinked: true,
  outdoorCo2Ppm: 420,
  perPerson: { heatW: 100, co2Lph: 18, moistureGph: 50, noiseDb: 8 },
  backgroundNoiseDb: 30,
  noiseStd: { temperature: 0.1, humidity: 0.5, co2: 10 },
};

/** 프리셋 기본값(TC-SIM-003: 강의실 66㎡·층고 3m). 사용자 정의는 강의실 값에서 시작한다 */
export function presetPhysics(preset: SpacePreset): SpacePhysics {
  const copy = (p: SpacePhysics): SpacePhysics => ({ ...p, initialState: { ...p.initialState }, perPerson: { ...p.perPerson }, noiseStd: { ...(p.noiseStd ?? {}) } });
  switch (preset) {
    case "OFFICE":
      return copy({ ...BASE, areaM2: 120, heightM: 2.7, uValue: 1.0, envelopeM2: 110, windowM2: 20, solarGainFactor: 0.35, backgroundNoiseDb: 35 });
    case "MEETING":
      return copy({ ...BASE, areaM2: 30, heightM: 2.7, uValue: 1.1, envelopeM2: 45, windowM2: 6, solarGainFactor: 0.3, backgroundNoiseDb: 28 });
    default:
      return copy(BASE);
  }
}

/** 입력 범위(UI-SIM-06 입력 검증, domain-model SimSpace) */
export const PHYSICS_RANGES: Record<string, [number, number]> = {
  areaM2: [1, 5000],
  heightM: [2, 20],
  uValue: [0.1, 6],
  envelopeM2: [0, 100_000],
  windowM2: [0, 100_000],
  solarGainFactor: [0, 1],
  "initialState.temperature": [-20, 50],
  "initialState.humidity": [0, 100],
  "initialState.co2": [300, 5000],
  "initialState.pm2_5": [0, 1000],
  "initialState.illumination": [0, 100_000],
  outdoorCo2Ppm: [300, 5000],
  "perPerson.heatW": [0, 1000],
  "perPerson.co2Lph": [0, 200],
  "perPerson.moistureGph": [0, 1000],
  "perPerson.noiseDb": [0, 60],
  backgroundNoiseDb: [0, 120],
};

export const PHYSICS_FIELDS = Object.keys(PHYSICS_RANGES);

export function getPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, part) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[part] : undefined), obj);
}

function setPath(obj: Record<string, unknown>, path: string, value: unknown) {
  const parts = path.split(".");
  let cur = obj;
  for (const part of parts.slice(0, -1)) {
    if (!cur[part] || typeof cur[part] !== "object") cur[part] = {};
    cur = cur[part] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]] = value;
}

/** 범위 검사: 숫자가 아니거나 범위 밖이면 필드별 문제 */
export function checkPhysics(physics: SpacePhysics): Record<string, Problem> {
  const out: Record<string, Problem> = {};
  for (const [path, [min, max]] of Object.entries(PHYSICS_RANGES)) {
    const raw = getPath(physics, path);
    if ((path === "windowM2" || path === "initialState.pm2_5" || path === "initialState.illumination") && (raw === null || raw === undefined)) continue;
    const value = typeof raw === "number" ? raw : Number.NaN;
    if (!Number.isFinite(value)) out[path] = { key: "number" };
    else if (value < min || value > max) out[path] = { key: "range", values: { min, max } };
  }
  return out;
}

/** 폼 값(문자열) → physics 객체. 숫자가 아니면 NaN으로 남겨 검사에서 걸린다 */
export function physicsFromForm(form: FormData | Map<string, string>, base: SpacePhysics): SpacePhysics {
  const get = (k: string) => (form instanceof Map ? form.get(k) : form.get(k)) as string | null | undefined;
  const out = JSON.parse(JSON.stringify(base)) as Record<string, unknown>;
  for (const path of PHYSICS_FIELDS) {
    const raw = get(`physics.${path}`);
    if (raw === null || raw === undefined) continue;
    setPath(out, path, raw.trim() === "" ? Number.NaN : Number(raw));
  }
  const linked = get("physics.outdoorLinked");
  if (linked !== null && linked !== undefined) out.outdoorLinked = linked === "true" || linked === "on";
  const orientation = get("physics.windowOrientation");
  if (orientation !== null && orientation !== undefined) out.windowOrientation = orientation || null;
  return out as unknown as SpacePhysics;
}

/** 프리셋과 다른 필드(바꾼 값 표시) */
export function changedFromPreset(physics: SpacePhysics, preset: SpacePreset): string[] {
  const base = presetPhysics(preset);
  return PHYSICS_FIELDS.filter((p) => getPath(physics, p) !== getPath(base, p));
}

// ───────── 배치(UI-SIM-02) ─────────

export function checkPlacement(input: { spaceId: string; count: number; namePrefix: string }, remaining: number | null): Record<string, Problem> {
  const out: Record<string, Problem> = {};
  if (!input.spaceId) out.spaceId = { key: "spaceRequired" };
  if (!Number.isInteger(input.count) || input.count < 1 || input.count > 50) out.count = { key: "range", values: { min: 1, max: 50 } };
  else if (remaining !== null && input.count > remaining) out.count = { key: "quota", values: { limit: DEVICE_LIMIT, remaining: Math.max(0, remaining) } };
  if (input.namePrefix && (input.namePrefix.length < 1 || input.namePrefix.length > 40)) out.namePrefix = { key: "length", values: { min: 1, max: 40 } };
  return out;
}

// ───────── 특성 폼(UI-SIM-04) ─────────

/** 숫자·선택·불리언 값 검사(BR-SIM-03). 범위 밖이면 허용 범위를 알려 준다 */
export function checkPropertyValue(def: PropertyDef, value: unknown): Problem | undefined {
  if (def.type === "number") {
    const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN;
    if (!Number.isFinite(n)) return { key: "number" };
    const min = def.min ?? Number.NEGATIVE_INFINITY;
    const max = def.max ?? Number.POSITIVE_INFINITY;
    if (n < min || n > max) return { key: "propertyRange", values: { min: def.min ?? "-∞", max: def.max ?? "∞", unit: def.unit ?? "" } };
    return undefined;
  }
  if (def.type === "enum") return (def.enumValues ?? []).includes(String(value)) ? undefined : { key: "enum" };
  return typeof value === "boolean" ? undefined : { key: "boolean" };
}

/** 입력 문자열을 정의 타입으로 */
export function coerceProperty(def: PropertyDef, raw: unknown): unknown {
  if (def.type === "number") return typeof raw === "number" ? raw : Number(raw);
  if (def.type === "boolean") return raw === true || raw === "true";
  return String(raw);
}

/**
 * 저장 본문(바꾼 값만, BR-SIM-02): 편집 층(PROFILE 또는 DEVICE)에서 새로 정한 값과 되돌린 값(null).
 * 값이 원래와 같으면 넣지 않는다.
 */
export function overridesDiff(rows: PropertyRow[], edits: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(edits)) {
    const row = rows.find((r) => r.key === key);
    if (!row) continue;
    if (value === null) {
      out[key] = null;
      continue;
    }
    const coerced = coerceProperty(row.def, value);
    if (coerced !== row.value) out[key] = coerced;
  }
  return out;
}

/** 출처 표시: 편집 층의 값은 "직접 설정", 그 밖은 상속(카탈로그·프로필) */
export function originLabelKey(origin: PropertyOrigin, layer: PropertyOrigin): "direct" | "catalog" | "profile" {
  if (origin === layer) return "direct";
  return origin === "CATALOG" ? "catalog" : "profile";
}

/** 프로필 이름 2~80자(UI-SIM-05) */
export function checkProfileName(name: string): Problem | undefined {
  return name.trim().length < 2 || name.trim().length > 80 ? { key: "length", values: { min: 2, max: 80 } } : undefined;
}

// ───────── 장애 주입(UI-SIM-10, API-SIM-20) ─────────

export interface FaultParamSpec {
  name: string;
  min: number;
  max: number;
  step?: number;
  optional?: boolean;
}

export const SENSOR_FAULTS: Record<string, FaultParamSpec[]> = {
  STUCK: [{ name: "value", min: -100_000, max: 100_000, optional: true }],
  SPIKE: [
    { name: "magnitude", min: -100_000, max: 100_000 },
    { name: "count", min: 1, max: 100 },
  ],
  DRIFT: [{ name: "perHour", min: -1000, max: 1000 }],
  DROPOUT: [{ name: "ratio", min: 0, max: 1, step: 0.05 }],
  INTERMITTENT: [
    { name: "onSec", min: 1, max: 86_400 },
    { name: "offSec", min: 1, max: 86_400 },
  ],
  BATTERY_DRAIN: [{ name: "pctPerHour", min: 0.1, max: 100 }],
  OUT_OF_RANGE: [{ name: "value", min: -1_000_000, max: 1_000_000 }],
};

export const GATEWAY_FAULTS: Record<string, FaultParamSpec[]> = {
  GATEWAY_DOWN: [],
  DUPLICATE: [{ name: "factor", min: 2, max: 5 }],
  REORDER: [{ name: "windowSec", min: 1, max: 3600 }],
  DELAY: [{ name: "delaySec", min: 1, max: 86_400 }],
  MALFORMED: [{ name: "ratio", min: 0, max: 1, step: 0.05 }],
};

export function faultSpecs(kind: string): FaultParamSpec[] {
  return SENSOR_FAULTS[kind] ?? GATEWAY_FAULTS[kind] ?? [];
}

export function isGatewayFault(kind: string): boolean {
  return kind in GATEWAY_FAULTS;
}

export interface FaultInput {
  runId?: string | null;
  targetType: "DEVICE" | "GATEWAY";
  targetIds: string[];
  kind: string;
  params: Record<string, string>;
  startMode: "now" | "later";
  startInMin: string;
  durationMin: string;
}

/** 장애 주입 요청 본문과 문제(지속 1분~24시간, 강도는 종류별 범위) */
export function buildFault(input: FaultInput): { body?: Record<string, unknown>; problems: Record<string, Problem> } {
  const problems: Record<string, Problem> = {};
  if (input.targetIds.length === 0) problems.targetIds = { key: "targetRequired" };
  const duration = Number(input.durationMin);
  if (!Number.isFinite(duration) || duration < 1 || duration > 1440) problems.durationMin = { key: "range", values: { min: 1, max: 1440 } };
  let startInSec = 0;
  if (input.startMode === "later") {
    const start = Number(input.startInMin);
    if (!Number.isFinite(start) || start < 1 || start > 10_080) problems.startInMin = { key: "range", values: { min: 1, max: 10_080 } };
    else startInSec = Math.round(start * 60);
  }
  const params: Record<string, number> = {};
  for (const spec of faultSpecs(input.kind)) {
    const raw = input.params[spec.name];
    if ((raw === undefined || raw === "") && spec.optional) continue;
    const value = Number(raw);
    if (raw === undefined || raw === "" || !Number.isFinite(value)) problems[`params.${spec.name}`] = { key: "number" };
    else if (value < spec.min || value > spec.max) problems[`params.${spec.name}`] = { key: "range", values: { min: spec.min, max: spec.max } };
    else params[spec.name] = value;
  }
  if (Object.keys(problems).length > 0) return { problems };
  const body: Record<string, unknown> = { targetType: input.targetType, targetIds: input.targetIds, kind: input.kind, params, startInSec, durationSec: Math.round(duration * 60) };
  if (input.runId) body.runId = input.runId;
  return { body, problems };
}

// ───────── 실행(API-SIM-14·15) ─────────

export interface RunOptions {
  acceleration: number;
  timestampPolicy: "SIMULATED" | "WALL_CLOCK";
  seed?: number | null;
  notificationPolicy: "PREFIX" | "SUPPRESS";
}

export function checkAcceleration(value: number): Problem | undefined {
  if (!Number.isInteger(value) || value < 1 || value > MAX_ACCELERATION) return { key: "range", values: { min: 1, max: MAX_ACCELERATION } };
  return undefined;
}

export function runBody(scenarioId: string, options: RunOptions): Record<string, unknown> {
  const body: Record<string, unknown> = { scenarioId, acceleration: options.acceleration, timestampPolicy: options.timestampPolicy, notificationPolicy: options.notificationPolicy };
  if (options.seed !== null && options.seed !== undefined && Number.isFinite(options.seed)) body.seed = options.seed;
  return body;
}

/** 상태별로 누를 수 있는 제어(domain-model SimRun 상태 전이) */
export function allowedControls(status: RunStatus): { pause: boolean; resume: boolean; stop: boolean; reset: boolean; accelerate: boolean; inject: boolean } {
  return {
    pause: status === "RUNNING",
    resume: status === "PAUSED",
    stop: status === "RUNNING" || status === "PAUSED",
    reset: status !== "PURGED" && status !== "EVALUATING",
    accelerate: status === "RUNNING" || status === "PAUSED",
    inject: status === "RUNNING" || status === "PAUSED",
  };
}

export const FINISHED: RunStatus[] = ["COMPLETED", "STOPPED", "FAILED", "PURGED"];

/** 경과 시간 `h:mm:ss` */
export function formatElapsed(sec: number | null | undefined): string {
  const s = Math.max(0, Math.floor(sec ?? 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

/** 길이 표시(초 → `8h`, `7d`, `90m`) */
export function formatDuration(sec: number): string {
  if (sec % 86_400 === 0) return `${sec / 86_400}d`;
  if (sec % 3600 === 0) return `${sec / 3600}h`;
  return `${Math.round(sec / 60)}m`;
}

// ───────── 가상 기기 출력(UI-SIM-03) ─────────

export interface DeviceOutputInput {
  reportIntervalSec: string;
  jitterPct: string;
  payloadFormat: string;
  seed: string;
  reactionDelaySec?: string;
  ackDelayMs?: string;
  failurePct?: string;
}

export function buildDeviceOutput(input: DeviceOutputInput, actuator: boolean): { body?: Record<string, unknown>; problems: Record<string, Problem> } {
  const problems: Record<string, Problem> = {};
  const num = (name: string, raw: string | undefined, min: number, max: number) => {
    const v = Number(raw);
    if (raw === undefined || raw === "" || !Number.isFinite(v)) problems[name] = { key: "number" };
    else if (v < min || v > max) problems[name] = { key: "range", values: { min, max } };
    return v;
  };
  const body: Record<string, unknown> = {
    reportIntervalSec: num("reportIntervalSec", input.reportIntervalSec, 5, 86_400),
    jitterPct: num("jitterPct", input.jitterPct, 0, 50),
    payloadFormat: input.payloadFormat,
  };
  if (input.seed.trim() !== "") {
    const seed = Number(input.seed);
    if (!Number.isInteger(seed)) problems.seed = { key: "number" };
    else body.seed = seed;
  }
  if (actuator) {
    body.response = {
      reactionDelaySec: num("reactionDelaySec", input.reactionDelaySec, 0, 3600),
      ackDelayMs: num("ackDelayMs", input.ackDelayMs, 0, 600_000),
      failurePct: num("failurePct", input.failurePct, 0, 100),
    };
  }
  return Object.keys(problems).length ? { problems } : { body, problems };
}
