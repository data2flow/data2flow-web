/**
 * 가상 환경(SIM) 화면이 쓰는 API 모양(design/api/SIM-api.md API-SIM-01~31, 부록 A). ID는 문자열.
 */
export type SimCategory = "SENSOR" | "ACTUATOR";
export type PresetState = "NOT_PREPARED" | "PREPARED" | "RUNNING";
export type RunStatus = "CREATED" | "RUNNING" | "PAUSED" | "EVALUATING" | "COMPLETED" | "STOPPED" | "FAILED" | "PURGED";
export type PropertyOrigin = "CATALOG" | "PROFILE" | "DEVICE";
export type SpacePreset = "CLASSROOM" | "OFFICE" | "MEETING" | "CUSTOM";

/** API-SIM-01 */
export interface SimOverview {
  usage: { devices: number; devicesLimit: number; runningRuns: number; runsLimit: number; virtualThroughputPct: number };
  presets: { key: string; name: string; description?: string; estimatedMinutes?: number; state: PresetState }[];
  runs: { runId: string; scenarioName: string; spaces?: string[] | string; accelerationEffective: number; progressPct: number; simClock: string }[];
  spaces: { spaceId: string; name: string; sensors: number; actuators: number; current?: { temperature?: number | null; co2?: number | null } | null; running: boolean }[];
  recentResults: { runId: string; passed: number; total: number; finishedAt: string }[];
}

/** 특성 정의(BR-SIM-03: 폼은 이것만으로 만든다) */
export interface PropertyDef {
  key: string;
  name: string;
  type: "number" | "enum" | "boolean";
  unit?: string | null;
  min?: number | null;
  max?: number | null;
  enumValues?: string[] | null;
  default: unknown;
  description?: string | null;
}

export interface PropertyRow {
  key: string;
  value: unknown;
  origin: PropertyOrigin;
  def: PropertyDef;
}

/** API-SIM-02 */
export interface SimType {
  id: string;
  key: string;
  name: string;
  category: SimCategory;
  builtin: boolean;
  metrics?: (string | { key: string; defaultSource?: unknown })[] | null;
  capabilities?: string[] | null;
  propertyDefs: PropertyDef[];
  linkedModelCode?: string | null;
  summary?: string[] | null;
}

export interface SimKit {
  key: string;
  name: string;
  items: { typeKey: string; count: number }[];
  suggestedFlowTemplates?: string[] | null;
}

export interface SimCatalog {
  types: SimType[];
  kits: SimKit[];
}

/** API-SIM-06 응답 */
export interface KitPlacement {
  spaceId: string;
  devices: { deviceId: string; name: string; typeKey: string; relation?: string }[];
  suggestedFlows: { templateKey: string; name: string; bindings?: unknown }[];
}

/** API-SIM-08 */
export interface SimProfile {
  id: string;
  name: string;
  typeId: string;
  typeName?: string | null;
  overrides?: Record<string, unknown> | null;
  properties?: PropertyRow[];
  deviceCount?: number;
  version?: number;
}

export interface SpacePhysics {
  areaM2: number;
  heightM: number;
  uValue: number;
  envelopeM2: number;
  windowM2?: number | null;
  windowOrientation?: string | null;
  solarGainFactor: number;
  initialState: { temperature: number; humidity: number; co2: number; pm2_5: number; illumination: number };
  outdoorLinked: boolean;
  outdoorCo2Ppm: number;
  perPerson: { heatW: number; co2Lph: number; moistureGph: number; noiseDb: number };
  backgroundNoiseDb: number;
  noiseStd?: Record<string, number> | null;
}

/** API-SIM-10 */
export interface SimSpace {
  spaceId: string;
  name: string;
  parentId?: string | null;
  preset: SpacePreset;
  physics: SpacePhysics;
  sandbox: boolean;
  deviceCount?: number;
  version: number;
  updatedAt?: string;
}

export type Track = "OCCUPANCY" | "OPENING" | "ACTUATOR" | "FAULT";
export type ExpectationKind = "DEVICE_STATE_REACHED" | "ALARM_COUNT" | "METRIC_RANGE_RATIO" | "CONTROL_COUNT_MAX";

export interface ScenarioEvent {
  id: string;
  track: Track;
  at: string;
  until?: string | null;
  target?: Record<string, unknown> | null;
  params?: Record<string, unknown> | null;
}

export interface Expectation {
  id: string;
  kind: ExpectationKind;
  target: Record<string, unknown>;
  condition: Record<string, unknown>;
  deadline?: string | null;
}

/** API-SIM-12 */
export interface Scenario {
  scenarioId: string;
  name: string;
  spaceIds: string[];
  simStartAt: string;
  durationSec: number;
  seed?: number | null;
  useCalendar: boolean;
  outdoor: { mode: "DIURNAL" | "WEATHER" | "CSV"; diurnal?: { max?: number; min?: number; peakHour?: number; humidity?: number } | null; weather?: unknown; csvFileId?: string | null };
  events: ScenarioEvent[];
  expectations: Expectation[];
  presetKey?: string | null;
  schemaVersion?: number;
  version: number;
  updatedAt?: string;
}

export interface ScenarioRow {
  scenarioId: string;
  name: string;
  spaceIds: string[];
  durationSec: number;
  presetKey?: string | null;
  expectationCount?: number;
  eventCount?: number;
  lastRun?: { runId: string; status: RunStatus; passed: number; total: number; finishedAt?: string | null } | null;
  updatedAt?: string;
}

/** API-SIM-16 */
export interface SimRun {
  runId: string;
  kind?: "SCENARIO" | "REPLAY" | "WHATIF";
  status: RunStatus;
  scenarioId?: string | null;
  accelerationRequested: number;
  accelerationEffective: number;
  throttled: boolean;
  simClock: string;
  startedAt?: string | null;
  elapsedSec?: number;
  progressPct: number;
  expectations?: { id: string; state: "PENDING" | "PASSED" | "FAILED"; evidence?: unknown }[];
  lastEvents?: { simAt: string; type: string; message: string }[];
  failureReason?: string | null;
}

/** API-SIM-17 */
export interface SimReport {
  runId: string;
  scenario?: { scenarioId?: string; name?: string } | string | null;
  seed: number;
  acceleration: number;
  simFrom: string;
  simTo: string;
  partial: boolean;
  passed: number;
  total: number;
  expectations: { id: string; kind: ExpectationKind; passed: boolean; evidence?: { at?: string; value?: unknown; actual?: unknown } | null }[];
  metrics: { comfortScore?: number | null; outOfTargetSec?: number | null; energyKwh?: number | null; controlCount?: number | null; alarmCount?: number | null };
  faults: { id: string; kind: string; target: string; from: string; to?: string | null }[];
  devicesCreated?: number;
}

/** API-SIM-20 */
export interface SimFault {
  faultId: string;
  kind: string;
  targetType: "DEVICE" | "GATEWAY";
  targetId: string;
  simFrom?: string | null;
  simTo?: string | null;
  status: "SCHEDULED" | "ACTIVE" | "ENDED" | "CANCELLED";
  remainingSec?: number | null;
}

/** API-SIM-09 */
export interface VirtualDeviceConfig {
  deviceId: string;
  typeId: string;
  profileId?: string | null;
  properties: PropertyRow[];
  metricSources?: Record<string, unknown> | null;
  reportIntervalSec: number;
  jitterPct: number;
  battery?: number | null;
  payloadFormat: "CHIRPSTACK_V4" | "GENERIC_JSON" | "SINGLE_VALUE";
  outputPath: "INTERNAL" | "PLATFORM_MQTT";
  response?: { reactionDelaySec: number; ackDelayMs: number; failurePct: number } | null;
  actuatorState?: Record<string, unknown> | null;
  seed?: number | null;
  reportMode: "ALWAYS" | "RUN_ONLY";
}

/** API-SIM-23 */
export interface ReplayFile {
  fileId: string;
  rows: number;
  columns: string[];
  preview: Record<string, unknown>[];
}
