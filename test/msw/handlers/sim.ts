/**
 * 가상 환경 가짜 API(design/api/SIM-api.md API-SIM-01~27, 부록 A). 상태는 core.extra["sim"].
 * 가상 기기는 core.devices에 virtual=true로 넣어 기기 상세(API-DEV-23)·목록(API-DEV-11 `virtual=true`)과 함께 보이게 한다.
 * 권한: 조회 SIM_READ, 실행·장애·재생 SIM_RUN, 관리 SIM_MANAGE, 샌드박스 SIM_ADMIN(아니면 403 PERMISSION_DENIED).
 * core M3 계약을 따른다: 프로필·가상 공간·프리셋 목록은 페이징 없는 `{responses, totalCount}`(ItemsResponse), 프리셋과 overview presets에
 * `scenarioId`(준비 전 null), SIM 오류 상세는 `errors[{field, code, message}]`. 재생(API-SIM-22·23)은 core가 M3에서 열지 않아
 * 기본은 404(`replayEnabled`를 켜면 M4 모양으로 답한다).
 */
import { HttpResponse } from "msw";
import { envelope, fail, list, noContent, ok, type CoreHandler, type CoreState, type FakeDevice } from "../core-fixtures";

interface Def {
  key: string;
  name: string;
  type: "number" | "enum" | "boolean";
  unit?: string;
  min?: number;
  max?: number;
  enumValues?: string[];
  default: unknown;
  description?: string;
}
interface SimType {
  id: string;
  key: string;
  name: string;
  category: "SENSOR" | "ACTUATOR";
  builtin: boolean;
  metrics?: { key: string; defaultSource: string }[];
  capabilities?: string[];
  propertyDefs: Def[];
  linkedModelCode?: string | null;
  summary: string[];
}
interface Profile {
  id: string;
  name: string;
  typeId: string;
  overrides: Record<string, unknown>;
  version: number;
}
interface DeviceCfg {
  deviceId: string;
  typeId: string;
  profileId: string | null;
  overrides: Record<string, unknown>;
  reportIntervalSec: number;
  jitterPct: number;
  payloadFormat: string;
  outputPath: string;
  response: Record<string, number> | null;
  actuatorState: Record<string, unknown> | null;
  seed: number | null;
  reportMode: string;
}
interface Space {
  spaceId: string;
  name: string;
  parentId: string | null;
  preset: string;
  physics: Record<string, unknown>;
  sandbox: boolean;
  version: number;
}
interface Scenario {
  scenarioId: string;
  name: string;
  spaceIds: string[];
  simStartAt: string;
  durationSec: number;
  seed: number | null;
  useCalendar: boolean;
  outdoor: Record<string, unknown>;
  events: Record<string, unknown>[];
  expectations: Record<string, unknown>[];
  presetKey: string | null;
  version: number;
  updatedAt: string;
}
interface Run {
  runId: string;
  kind: string;
  status: string;
  scenarioId: string | null;
  accelerationRequested: number;
  accelerationEffective: number;
  throttled: boolean;
  simClock: string;
  startedAt: string;
  elapsedSec: number;
  progressPct: number;
  seed: number;
  expectations: { id: string; state: string }[];
  lastEvents: { simAt: string; type: string; message: string }[];
}
interface Fault {
  faultId: string;
  runId: string | null;
  kind: string;
  targetType: string;
  targetId: string;
  simFrom: string;
  simTo: string;
  status: string;
  remainingSec: number;
}

export interface SimState {
  types: SimType[];
  kits: { key: string; name: string; items: { typeKey: string; count: number }[]; suggestedFlowTemplates: string[] }[];
  profiles: Profile[];
  devices: DeviceCfg[];
  spaces: Space[];
  scenarios: Scenario[];
  runs: Run[];
  faults: Fault[];
  presets: { key: string; name: string; description: string; estimatedMinutes: number; state: string; scenarioId: string | null }[];
  /** 재생 API(M4). core M3는 열지 않으므로 기본 false → 404 */
  replayEnabled: boolean;
  devicesLimit: number;
  idempotency: Map<string, unknown>;
  files: Map<string, { columns: string[]; rows: number }>;
}

const PHYSICS = {
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
  noiseStd: { temperature: 0.1 },
};

function initial(): SimState {
  const th: SimType = {
    id: "11",
    key: "th-sensor",
    name: "온습도 센서",
    category: "SENSOR",
    builtin: true,
    metrics: [
      { key: "temperature", defaultSource: "PHYSICS" },
      { key: "humidity", defaultSource: "PHYSICS" },
    ],
    propertyDefs: [
      { key: "errorPct", name: "측정 오차", type: "number", unit: "%", min: 0, max: 50, default: 3, description: "가우시안 잡음 표준편차" },
      { key: "intervalSec", name: "보고 주기", type: "number", unit: "초", min: 5, max: 86400, default: 60 },
    ],
    linkedModelCode: "EM300-TH",
    summary: ["오차 ±0.3℃", "60초", "배터리 100%"],
  };
  const ac: SimType = {
    id: "21",
    key: "aircon",
    name: "에어컨",
    category: "ACTUATOR",
    builtin: true,
    capabilities: ["Switch", "Thermostat"],
    propertyDefs: [
      { key: "coolingCapacityKw", name: "냉방 능력", type: "number", unit: "kW", min: 0.5, max: 20, default: 3.5, description: "정격 냉방 출력" },
      { key: "powerKw", name: "소비 전력", type: "number", unit: "kW", min: 0.1, max: 10, default: 1.2 },
      { key: "defaultMode", name: "기본 모드", type: "enum", enumValues: ["cool", "heat", "dry", "fan", "auto"], default: "cool" },
      { key: "inverter", name: "인버터", type: "boolean", default: true },
    ],
    linkedModelCode: null,
    summary: ["냉방 3.5kW", "소비 1.2kW", "반응 120초"],
  };
  return {
    types: [th, ac],
    kits: [{ key: "classroom-standard", name: "표준 강의실 키트", items: [{ typeKey: "th-sensor", count: 2 }, { typeKey: "aircon", count: 1 }], suggestedFlowTemplates: ["hot-then-cool"] }],
    profiles: [{ id: "301", name: "강의실 표준 에어컨", typeId: "21", overrides: { coolingCapacityKw: 5 }, version: 1 }],
    devices: [
      { deviceId: "2001", typeId: "11", profileId: null, overrides: {}, reportIntervalSec: 60, jitterPct: 10, payloadFormat: "CHIRPSTACK_V4", outputPath: "INTERNAL", response: null, actuatorState: null, seed: null, reportMode: "ALWAYS" },
      { deviceId: "2002", typeId: "21", profileId: "301", overrides: { powerKw: 1.0 }, reportIntervalSec: 60, jitterPct: 10, payloadFormat: "GENERIC_JSON", outputPath: "INTERNAL", response: { reactionDelaySec: 120, ackDelayMs: 500, failurePct: 0 }, actuatorState: { power: "OFF", mode: "cool", targetTemperature: 26, version: 3 }, seed: null, reportMode: "ALWAYS" },
    ],
    spaces: [{ spaceId: "41", name: "데모 강의실", parentId: null, preset: "CLASSROOM", physics: structuredClone(PHYSICS), sandbox: false, version: 2 }],
    scenarios: [
      {
        scenarioId: "601",
        name: "폭염 오후",
        spaceIds: ["41"],
        simStartAt: "2026-08-12T04:00:00Z",
        durationSec: 4 * 3600,
        seed: 4711,
        useCalendar: false,
        outdoor: { mode: "DIURNAL", diurnal: { max: 35, min: 27, peakHour: 15 } },
        events: [{ id: "ev-1", track: "OCCUPANCY", at: "2026-08-12T04:00:00Z", until: "2026-08-12T07:00:00Z", target: { spaceId: "41" }, params: { count: 30 } }],
        expectations: [{ id: "ex-1", kind: "DEVICE_STATE_REACHED", target: { deviceId: "2002" }, condition: { power: "ON" }, deadline: "2026-08-12T05:00:00Z" }],
        presetKey: "heatwave-afternoon",
        version: 3,
        updatedAt: "2026-10-03T01:00:00Z",
      },
    ],
    runs: [],
    faults: [],
    presets: [
      { key: "classroom-crowded", name: "여름 강의실 과밀", description: "CO2→환기 자동화", estimatedMinutes: 16, state: "NOT_PREPARED", scenarioId: null },
      { key: "heatwave-afternoon", name: "폭염 오후", description: "온도→냉방", estimatedMinutes: 8, state: "PREPARED", scenarioId: "601" },
      { key: "sensor-failure", name: "센서 고장", description: "멈춤→알람", estimatedMinutes: 6, state: "NOT_PREPARED", scenarioId: null },
      { key: "gateway-outage", name: "게이트웨이 장애", description: "오프라인→복구", estimatedMinutes: 6, state: "NOT_PREPARED", scenarioId: null },
      { key: "night-unmanned", name: "야간 무인", description: "문→알림", estimatedMinutes: 10, state: "NOT_PREPARED", scenarioId: null },
    ],
    replayEnabled: false,
    devicesLimit: 500,
    idempotency: new Map(),
    files: new Map(),
  };
}

/** 페이징 없는 작은 목록(core ItemsResponse, api-rules §3.3) */
function items(rows: unknown[]) {
  return HttpResponse.json({ ...envelope(undefined), responses: rows, totalCount: rows.length });
}

/** SIM 범위 오류(api-rules §5 errors 상세) */
function outOfRangeFail(field: string) {
  return fail(400, "SIM_PROPERTY_OUT_OF_RANGE", { errors: [{ field, code: "SIM_PROPERTY_OUT_OF_RANGE", message: "허용 범위를 벗어났습니다" }] });
}

function virtualDevice(id: string, name: string, kind: string, spaceId: string): FakeDevice {
  return { id, name, externalId: `5a1d${Number(id).toString(16).padStart(12, "0")}`, kind, status: "ACTIVE", connectivity: "ONLINE", modelId: null, spaceId, sourceId: "7", tags: [], virtual: true, lastSeenAt: null, latest: [], version: 1 } satisfies FakeDevice;
}

export function simState(core: CoreState): SimState {
  if (!core.extra.sim) {
    core.extra.sim = initial();
    core.devices.push(virtualDevice("2001", "TH-1", "SENSOR", "41"), virtualDevice("2002", "AC-1", "ACTUATOR", "41"));
  }
  return core.extra.sim as SimState;
}

function rows(state: SimState, type: SimType, profile: Profile | undefined, device?: DeviceCfg) {
  return type.propertyDefs.map((def) => {
    if (device && def.key in device.overrides) return { key: def.key, value: device.overrides[def.key], origin: "DEVICE", def };
    if (profile && def.key in profile.overrides) return { key: def.key, value: profile.overrides[def.key], origin: "PROFILE", def };
    return { key: def.key, value: def.default, origin: "CATALOG", def };
  });
}

/** 범위 밖 특성 키(없으면 undefined) */
function outOfRange(type: SimType, overrides: Record<string, unknown>): string | undefined {
  return Object.entries(overrides).find(([k, v]) => {
    const def = type.propertyDefs.find((d) => d.key === k);
    return v !== null && def?.type === "number" && (typeof v !== "number" || (def.min !== undefined && v < def.min) || (def.max !== undefined && v > def.max));
  })?.[0];
}

function deviceConfig(core: CoreState, state: SimState, cfg: DeviceCfg) {
  const type = state.types.find((t) => t.id === cfg.typeId) as SimType;
  const profile = state.profiles.find((p) => p.id === cfg.profileId);
  const dev = core.devices.find((d) => d.id === cfg.deviceId);
  return { ...cfg, battery: type.category === "SENSOR" ? 98 : null, metricSources: null, properties: rows(state, type, profile, cfg), spaceId: dev?.spaceId };
}

function report(run: Run) {
  return {
    runId: run.runId,
    scenario: { scenarioId: run.scenarioId, name: "폭염 오후" },
    seed: run.seed,
    acceleration: run.accelerationEffective,
    simFrom: "2026-08-12T04:00:00Z",
    simTo: "2026-08-12T08:00:00Z",
    partial: run.status === "STOPPED",
    passed: 1,
    total: 1,
    expectations: [{ id: "ex-1", kind: "DEVICE_STATE_REACHED", passed: true, evidence: { at: "2026-08-12T04:12:00Z", value: "ON" } }],
    metrics: { comfortScore: 82, outOfTargetSec: 2400, energyKwh: 8.1, controlCount: 1, alarmCount: 0 },
    faults: [],
    devicesCreated: 0,
  };
}

const NEXT: Record<string, Record<string, string>> = {
  pause: { RUNNING: "PAUSED" },
  resume: { PAUSED: "RUNNING" },
  stop: { RUNNING: "STOPPED", PAUSED: "STOPPED" },
  reset: { RUNNING: "CREATED", PAUSED: "CREATED", STOPPED: "CREATED", COMPLETED: "CREATED", FAILED: "CREATED", CREATED: "CREATED" },
};

export const simHandler: CoreHandler = async (core, req) => {
  const { method, path, url, can } = req;
  const body = (req.body ?? {}) as Record<string, unknown>;
  if (path === "/devices" && method === "GET" && url.searchParams.get("virtual") === "true") {
    simState(core);
    const spaceId = url.searchParams.get("spaceId");
    return list(core.devices.filter((d) => d.virtual && (!spaceId || d.spaceId === spaceId)).map((d) => core.deviceSummary(d)), url);
  }
  if (!path.startsWith("/sim/")) return undefined;
  const state = simState(core);
  const denied = () => fail(403, "PERMISSION_DENIED");
  const need = (p: string) => !can(p);
  if (method === "GET" && need("SIM_READ")) return denied();
  const idem = req.request.headers.get("idempotency-key");

  if (path === "/sim/overview") {
    const devices = state.devices.length;
    const running = state.runs.filter((r) => r.status === "RUNNING" || r.status === "PAUSED");
    return ok({
      usage: { devices, devicesLimit: state.devicesLimit, runningRuns: running.length, runsLimit: 5, virtualThroughputPct: 4 },
      presets: state.presets,
      runs: running.map((r) => ({ runId: r.runId, scenarioName: state.scenarios.find((s) => s.scenarioId === r.scenarioId)?.name ?? "", spaces: ["데모 강의실"], accelerationEffective: r.accelerationEffective, progressPct: r.progressPct, simClock: r.simClock })),
      spaces: state.spaces.map((s) => ({ spaceId: s.spaceId, name: s.name, sensors: state.devices.filter((d) => core.devices.find((x) => x.id === d.deviceId)?.spaceId === s.spaceId && state.types.find((t) => t.id === d.typeId)?.category === "SENSOR").length, actuators: state.devices.filter((d) => core.devices.find((x) => x.id === d.deviceId)?.spaceId === s.spaceId && state.types.find((t) => t.id === d.typeId)?.category === "ACTUATOR").length, current: { temperature: 27.1, co2: 1240 }, running: running.length > 0 })),
      recentResults: state.runs.filter((r) => r.status === "COMPLETED").map((r) => ({ runId: r.runId, passed: 1, total: 1, finishedAt: "2026-10-03T10:40:00Z" })),
    });
  }
  if (path === "/sim/catalog") {
    const category = url.searchParams.get("category");
    return ok({ types: state.types.filter((t) => !category || t.category === category), kits: state.kits });
  }

  // 프로필(API-SIM-08)
  if (path === "/sim/profiles") {
    if (method === "GET") return items(state.profiles.map((p) => ({ ...p, typeName: state.types.find((t) => t.id === p.typeId)?.name, deviceCount: state.devices.filter((d) => d.profileId === p.id).length })));
    if (need("SIM_MANAGE")) return denied();
    const name = String(body.name ?? "");
    if (state.profiles.some((p) => p.name === name)) return fail(409, "SIM_PROFILE_NAME_DUPLICATED");
    const profile: Profile = { id: core.nextId(), name, typeId: String(body.typeId), overrides: (body.overrides as Record<string, unknown>) ?? {}, version: 1 };
    state.profiles.push(profile);
    return ok(profile, 201);
  }
  const profileMatch = /^\/sim\/profiles\/([^/]+)$/.exec(path);
  if (profileMatch) {
    const profile = state.profiles.find((p) => p.id === profileMatch[1]);
    if (!profile) return fail(404, "SIM_NOT_FOUND");
    const type = state.types.find((t) => t.id === profile.typeId) as SimType;
    if (method === "GET") return ok({ ...profile, properties: rows(state, type, profile), deviceCount: state.devices.filter((d) => d.profileId === profile.id).length });
    if (need("SIM_MANAGE")) return denied();
    if (method === "DELETE") {
      if (state.devices.some((d) => d.profileId === profile.id)) return fail(409, "SIM_PROFILE_IN_USE");
      state.profiles.splice(state.profiles.indexOf(profile), 1);
      return noContent();
    }
    if (body.baseVersion !== undefined && body.baseVersion !== profile.version) return fail(409, "VERSION_CONFLICT");
    const overrides = (body.overrides as Record<string, unknown>) ?? {};
    if (outOfRange(type, overrides)) return outOfRangeFail(`overrides.${outOfRange(type, overrides)}`);
    Object.assign(profile, { name: body.name ?? profile.name, overrides, version: profile.version + 1 });
    return ok({ ...profile, properties: rows(state, type, profile) });
  }

  // 가상 기기(API-SIM-05·07·09)
  if (path === "/sim/devices" && method === "POST") {
    if (need("SIM_MANAGE")) return denied();
    if (idem && state.idempotency.has(idem)) return ok(state.idempotency.get(idem), 201);
    const count = Number(body.count);
    if (state.devices.length + count > state.devicesLimit) return fail(409, "SIM_DEVICE_QUOTA_EXCEEDED");
    const type = state.types.find((t) => t.id === String(body.typeId));
    if (!type) return fail(404, "SIM_NOT_FOUND");
    const created = Array.from({ length: count }, (_, i) => {
      const id = core.nextId();
      const name = `${String(body.namePrefix ?? type.name)}-${i + 1}`;
      core.devices.push(virtualDevice(id, name, type.category, String(body.spaceId)));
      state.devices.push({ deviceId: id, typeId: type.id, profileId: (body.profileId as string) ?? null, overrides: {}, reportIntervalSec: 60, jitterPct: 10, payloadFormat: "CHIRPSTACK_V4", outputPath: "INTERNAL", response: type.category === "ACTUATOR" ? { reactionDelaySec: 120, ackDelayMs: 500, failurePct: 0 } : null, actuatorState: null, seed: null, reportMode: String(body.reportMode ?? "ALWAYS") });
      return { deviceId: id, name };
    });
    const response = { devices: created };
    if (idem) state.idempotency.set(idem, response);
    return ok(response, 201);
  }
  const deviceMatch = /^\/sim\/devices\/([^/]+)$/.exec(path);
  if (deviceMatch) {
    const cfg = state.devices.find((d) => d.deviceId === deviceMatch[1]);
    if (!cfg) return fail(404, "SIM_NOT_FOUND");
    if (method === "GET") return ok(deviceConfig(core, state, cfg));
    if (need("SIM_MANAGE")) return denied();
    if (method === "DELETE") {
      state.devices.splice(state.devices.indexOf(cfg), 1);
      return noContent();
    }
    const type = state.types.find((t) => t.id === cfg.typeId) as SimType;
    if (body.overrides) {
      const overrides = body.overrides as Record<string, unknown>;
      if (outOfRange(type, overrides)) return outOfRangeFail(`overrides.${outOfRange(type, overrides)}`);
      for (const [k, v] of Object.entries(overrides)) {
        if (v === null) delete cfg.overrides[k];
        else cfg.overrides[k] = v;
      }
    }
    for (const key of ["reportIntervalSec", "jitterPct", "payloadFormat", "seed", "reportMode", "response", "profileId"] as const) {
      if (body[key] !== undefined) (cfg as unknown as Record<string, unknown>)[key] = body[key];
    }
    return ok(deviceConfig(core, state, cfg));
  }

  // 키트(API-SIM-06)
  const kitMatch = /^\/sim\/kits\/([^/]+)\/place$/.exec(path);
  if (kitMatch && method === "POST") {
    if (need("SIM_MANAGE")) return denied();
    const kit = state.kits.find((k) => k.key === kitMatch[1]);
    if (!kit) return fail(404, "SIM_NOT_FOUND");
    let spaceId = body.spaceId as string | undefined;
    if (!spaceId) {
      const newSpace = body.newSpace as { name: string; preset: string };
      spaceId = core.nextId();
      state.spaces.push({ spaceId, name: newSpace.name, parentId: null, preset: newSpace.preset, physics: structuredClone(PHYSICS), sandbox: false, version: 1 });
    }
    const devices = kit.items.flatMap((item) => {
      const type = state.types.find((t) => t.key === item.typeKey) as SimType;
      return Array.from({ length: item.count }, (_, i) => {
        const id = core.nextId();
        const name = `${type.key === "aircon" ? "AC" : "TH"}-${i + 1}`;
        core.devices.push(virtualDevice(id, name, type.category, spaceId as string));
        state.devices.push({ deviceId: id, typeId: type.id, profileId: null, overrides: {}, reportIntervalSec: 60, jitterPct: 10, payloadFormat: "CHIRPSTACK_V4", outputPath: "INTERNAL", response: null, actuatorState: null, seed: null, reportMode: "ALWAYS" });
        return { deviceId: id, name, typeKey: type.key, relation: type.category === "SENSOR" ? "MEASURES" : "CONTROLS" };
      });
    });
    return ok({ spaceId, devices, suggestedFlows: kit.suggestedFlowTemplates.map((key) => ({ templateKey: key, name: "고온이면 냉방", bindings: { spaceId } })) }, 201);
  }

  // 가상 공간(API-SIM-10·24)
  if (path === "/sim/spaces" && method === "GET") {
    return items(state.spaces.map((s) => ({ ...s, type: "ROOM", virtual: true, deviceCount: core.devices.filter((d) => d.virtual && d.spaceId === s.spaceId).length, volumeM3: 198, current: { temperature: 27.1, humidity: 55, co2: 1240, pm2_5: 12, illumination: 300, noise: 40, occupancy: 0 } })));
  }
  if (path === "/sim/spaces" && method === "POST") {
    if (need("SIM_MANAGE")) return denied();
    const space: Space = { spaceId: core.nextId(), name: String(body.name), parentId: (body.parentId as string) ?? null, preset: String(body.preset), physics: body.physics as Record<string, unknown>, sandbox: false, version: 1 };
    state.spaces.push(space);
    return ok({ ...space, deviceCount: 0 }, 201);
  }
  const sandboxMatch = /^\/sim\/spaces\/([^/]+)\/sandbox$/.exec(path);
  if (sandboxMatch && method === "PUT") {
    if (need("SIM_ADMIN")) return denied();
    const space = state.spaces.find((s) => s.spaceId === sandboxMatch[1]);
    if (!space) return fail(404, "SIM_NOT_FOUND");
    space.sandbox = Boolean(body.sandbox);
    return ok({ spaceId: space.spaceId, sandbox: space.sandbox });
  }
  const spaceMatch = /^\/sim\/spaces\/([^/]+)$/.exec(path);
  if (spaceMatch) {
    const space = state.spaces.find((s) => s.spaceId === spaceMatch[1]);
    if (!space) return fail(404, "SIM_NOT_FOUND");
    if (method === "GET") return ok({ ...space, deviceCount: core.devices.filter((d) => d.virtual && d.spaceId === space.spaceId).length });
    if (need("SIM_MANAGE")) return denied();
    if (method === "DELETE") {
      if (state.runs.some((r) => r.status === "RUNNING")) return fail(409, "SIM_SPACE_BUSY");
      state.spaces.splice(state.spaces.indexOf(space), 1);
      return noContent();
    }
    if (body.baseVersion !== space.version) return fail(409, "VERSION_CONFLICT");
    const areaM2 = (body.physics as { areaM2?: number } | undefined)?.areaM2 ?? 0;
    if (areaM2 < 1 || areaM2 > 5000) return outOfRangeFail("physics.areaM2");
    Object.assign(space, { name: body.name, preset: body.preset, physics: body.physics, parentId: body.parentId ?? null, version: space.version + 1 });
    return ok({ ...space, deviceCount: 0 });
  }
  if (path === "/sim/preview" && method === "POST") {
    const hours = Number(body.hours ?? 24);
    const base = Date.parse("2026-08-12T00:00:00Z");
    const series = (start: number, step: number) => Array.from({ length: hours }, (_, i) => ({ t: new Date(base + i * 3_600_000).toISOString(), v: start + i * step }));
    return ok({ series: { temperature: series(24, 0.2), co2: series(450, Number((body.condition as { occupancy?: number })?.occupancy ?? 0) > 0 ? 40 : 0) } });
  }

  // 시나리오(API-SIM-12·13·26)
  if (path === "/sim/scenarios") {
    if (method === "GET") return list(state.scenarios.map((s) => ({ scenarioId: s.scenarioId, name: s.name, spaceIds: s.spaceIds, durationSec: s.durationSec, presetKey: s.presetKey, expectationCount: s.expectations.length, lastRun: state.runs.filter((r) => r.scenarioId === s.scenarioId).map((r) => ({ runId: r.runId, status: r.status, passed: 1, total: 1, finishedAt: null })).at(-1) ?? null, updatedAt: s.updatedAt })), url);
    if (need("SIM_MANAGE")) return denied();
    const events = (body.events as { at: string }[]) ?? [];
    const end = Date.parse(String(body.simStartAt)) + Number(body.durationSec) * 1000;
    const bad = events.findIndex((e) => Date.parse(e.at) > end);
    if (bad >= 0) return HttpResponse.json({ ...envelope(undefined, "SIM_SCENARIO_INVALID"), errors: [{ field: `events[${bad}].at`, code: "OUT_OF_RANGE", message: "범위 밖" }] }, { status: 400 });
    const scenario: Scenario = { scenarioId: core.nextId(), name: String(body.name), spaceIds: body.spaceIds as string[], simStartAt: String(body.simStartAt), durationSec: Number(body.durationSec), seed: (body.seed as number) ?? null, useCalendar: Boolean(body.useCalendar), outdoor: body.outdoor as Record<string, unknown>, events: events as Record<string, unknown>[], expectations: (body.expectations as Record<string, unknown>[]) ?? [], presetKey: null, version: 1, updatedAt: "2026-10-04T00:00:00Z" };
    state.scenarios.push(scenario);
    return ok(scenario, 201);
  }
  const cloneMatch = /^\/sim\/scenarios\/([^/]+)\/clone$/.exec(path);
  if (cloneMatch && method === "POST") {
    if (need("SIM_MANAGE")) return denied();
    const source = state.scenarios.find((s) => s.scenarioId === cloneMatch[1]);
    if (!source) return fail(404, "SIM_NOT_FOUND");
    const copy = { ...structuredClone(source), scenarioId: core.nextId(), name: String(body.name), presetKey: null, version: 1 };
    state.scenarios.push(copy);
    return ok({ id: copy.scenarioId }, 201);
  }
  const exportMatch = /^\/sim\/scenarios\/([^/]+)\/export$/.exec(path);
  if (exportMatch) {
    const s = state.scenarios.find((x) => x.scenarioId === exportMatch[1]);
    return s ? HttpResponse.json({ schemaVersion: 1, scenario: s, seed: s.seed }, { headers: { "Content-Disposition": `attachment; filename="scenario-${s.scenarioId}.json"` } }) : fail(404, "SIM_NOT_FOUND");
  }
  const scenarioMatch = /^\/sim\/scenarios\/([^/]+)$/.exec(path);
  if (scenarioMatch) {
    const s = state.scenarios.find((x) => x.scenarioId === scenarioMatch[1]);
    if (!s) return fail(404, "SIM_NOT_FOUND");
    if (method === "GET") return ok(s);
    if (need("SIM_MANAGE")) return denied();
    if (method === "DELETE") {
      if (state.runs.some((r) => r.scenarioId === s.scenarioId && (r.status === "RUNNING" || r.status === "PAUSED"))) return fail(409, "SIM_RUN_STATE_CONFLICT");
      state.scenarios.splice(state.scenarios.indexOf(s), 1);
      return noContent();
    }
    if (body.baseVersion !== s.version) return fail(409, "VERSION_CONFLICT");
    Object.assign(s, { ...body, version: s.version + 1 });
    return ok(s);
  }

  // 프리셋(API-SIM-18)
  if (path === "/sim/presets" && method === "GET") return items(state.presets.map((p) => ({ ...p, spaceName: p.name, spacePreset: "CLASSROOM", devices: [], flowTemplates: [] })));
  const presetMatch = /^\/sim\/presets\/([^/]+)\/prepare$/.exec(path);
  if (presetMatch && method === "POST") {
    if (need("SIM_MANAGE")) return denied();
    const preset = state.presets.find((p) => p.key === presetMatch[1]);
    if (!preset) return fail(404, "SIM_NOT_FOUND");
    const reused = preset.state !== "NOT_PREPARED";
    let scenario = state.scenarios.find((s) => s.presetKey === preset.key);
    if (!scenario) {
      scenario = { ...structuredClone(state.scenarios[0]), scenarioId: core.nextId(), name: preset.name, presetKey: preset.key, version: 1 };
      state.scenarios.push(scenario);
    }
    preset.state = "PREPARED";
    preset.scenarioId = scenario.scenarioId;
    return ok({ scenarioId: scenario.scenarioId, spaceIds: ["41"], deviceIds: ["2001", "2002"], flowIds: [], ruleIds: [], reused });
  }

  // 실행(API-SIM-14~17)
  if (path === "/sim/runs" && method === "POST") {
    if (need("SIM_RUN")) return denied();
    if (idem && state.idempotency.has(idem)) return ok(state.idempotency.get(idem), 201);
    const acceleration = Number(body.acceleration ?? 1);
    if (state.runs.filter((r) => r.status === "RUNNING").length >= 5) return fail(409, "SIM_CONCURRENT_RUN_LIMIT");
    const run: Run = { runId: core.nextId(), kind: "SCENARIO", status: "RUNNING", scenarioId: String(body.scenarioId), accelerationRequested: acceleration, accelerationEffective: acceleration, throttled: false, simClock: "2026-08-12T04:00:00Z", startedAt: "2026-10-04T00:00:00Z", elapsedSec: 0, progressPct: 0, seed: Number(body.seed ?? 4711), expectations: [{ id: "ex-1", state: "PENDING" }], lastEvents: [] };
    state.runs.push(run);
    const response = { runId: run.runId, status: run.status, seed: run.seed, accelerationEffective: acceleration };
    if (idem) state.idempotency.set(idem, response);
    return ok(response, 201);
  }
  const reportMatch = /^\/sim\/runs\/([^/]+)\/report$/.exec(path);
  if (reportMatch) {
    const run = state.runs.find((r) => r.runId === reportMatch[1]);
    return run ? ok(report(run)) : fail(404, "SIM_NOT_FOUND");
  }
  const controlMatch = /^\/sim\/runs\/([^/]+)\/(pause|resume|stop|reset)$/.exec(path);
  if (controlMatch && method === "POST") {
    if (need("SIM_RUN")) return denied();
    const run = state.runs.find((r) => r.runId === controlMatch[1]);
    if (!run) return fail(404, "SIM_NOT_FOUND");
    const next = NEXT[controlMatch[2]][run.status];
    if (!next) return fail(409, "SIM_RUN_STATE_CONFLICT");
    run.status = next;
    return ok({ runId: run.runId, status: run.status, simClock: run.simClock, progressPct: run.progressPct, accelerationEffective: run.accelerationEffective });
  }
  const runMatch = /^\/sim\/runs\/([^/]+)$/.exec(path);
  if (runMatch) {
    const run = state.runs.find((r) => r.runId === runMatch[1]);
    if (!run) return fail(404, "SIM_NOT_FOUND");
    if (method === "GET") return ok(run);
    if (need("SIM_RUN")) return denied();
    const acceleration = Number(body.acceleration);
    if (!Number.isInteger(acceleration) || acceleration < 1 || acceleration > 60) return fail(400, "INVALID_REQUEST");
    Object.assign(run, { accelerationRequested: acceleration, accelerationEffective: Math.min(acceleration, 24), throttled: acceleration > 24 });
    return ok({ runId: run.runId, accelerationRequested: run.accelerationRequested, accelerationEffective: run.accelerationEffective, throttled: run.throttled });
  }

  // 장애(API-SIM-20·21)
  if (path === "/sim/faults") {
    if (method === "GET") {
      const runId = url.searchParams.get("runId");
      return list(state.faults.filter((f) => !runId || f.runId === runId), url);
    }
    if (need("SIM_RUN")) return denied();
    const targetIds = (body.targetIds as string[]) ?? [];
    if (body.targetType === "DEVICE" && targetIds.some((id) => !core.devices.find((d) => d.id === id)?.virtual)) return fail(400, "SIM_TARGET_NOT_VIRTUAL");
    const faultIds = targetIds.map((targetId) => {
      const fault: Fault = { faultId: core.nextId(), runId: (body.runId as string) ?? null, kind: String(body.kind), targetType: String(body.targetType), targetId, simFrom: "2026-08-12T04:10:00Z", simTo: "2026-08-12T04:40:00Z", status: Number(body.startInSec) > 0 ? "SCHEDULED" : "ACTIVE", remainingSec: Number(body.durationSec) };
      state.faults.push(fault);
      return fault.faultId;
    });
    return ok({ faultIds }, 201);
  }
  const faultMatch = /^\/sim\/faults\/([^/]+)\/cancel$/.exec(path);
  if (faultMatch && method === "POST") {
    if (need("SIM_RUN")) return denied();
    const fault = state.faults.find((f) => f.faultId === faultMatch[1]);
    if (!fault) return fail(404, "SIM_NOT_FOUND");
    fault.status = "CANCELLED";
    return ok({ faultId: fault.faultId, kind: fault.kind, status: fault.status, simFrom: fault.simFrom, simTo: fault.simTo });
  }

  // 재생(API-SIM-22·23): core M3는 열지 않는다
  if ((path === "/sim/replay-files" || path === "/sim/replays") && !state.replayEnabled) return fail(404, "RESOURCE_NOT_FOUND");
  if (path === "/sim/replay-files" && method === "POST") {
    if (need("SIM_RUN")) return denied();
    const form = await req.request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return fail(400, "SIM_IMPORT_INVALID");
    const text = await file.text();
    const lines = text.trim().split(/\r?\n/);
    const columns = lines[0].split(",");
    const bad = lines.slice(1).findIndex((l) => l.split(",").length !== columns.length);
    if (bad >= 0) return HttpResponse.json({ ...envelope(undefined, "SIM_IMPORT_INVALID"), errors: [{ field: `row[${bad + 2}]`, code: "COLUMN_MISSING", message: "열 누락" }] }, { status: 400 });
    const fileId = core.nextId();
    state.files.set(fileId, { columns, rows: lines.length - 1 });
    const preview = lines.slice(1, 21).map((l) => Object.fromEntries(l.split(",").map((v, i) => [columns[i], v])));
    return ok({ fileId, rows: lines.length - 1, columns, preview }, 201);
  }
  if (path === "/sim/replays" && method === "POST") {
    if (need("SIM_RUN")) return denied();
    const source = body.source as { fileId: string; columnMapping: { metrics: Record<string, string> } };
    const file = state.files.get(source?.fileId);
    if (!file) return fail(400, "SIM_IMPORT_INVALID");
    const total = file.rows * Object.keys(source.columnMapping.metrics).length;
    if (url.searchParams.get("dryRun") === "true") return ok({ total, byDevice: {} });
    const runId = core.nextId();
    state.runs.push({ runId, kind: "REPLAY", status: "RUNNING", scenarioId: null, accelerationRequested: Number(body.acceleration), accelerationEffective: Number(body.acceleration), throttled: false, simClock: "2026-10-04T00:00:00Z", startedAt: "2026-10-04T00:00:00Z", elapsedSec: 0, progressPct: 0, seed: 1, expectations: [], lastEvents: [] });
    return ok({ runId, total, clones: [] }, 201);
  }
  return fail(404, "SIM_NOT_FOUND");
};
