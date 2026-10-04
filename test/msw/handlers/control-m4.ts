/**
 * M4 제어 가짜 API(design/api/ACT-api.md·DEV-api.md): 비상 정지(API-ACT-20·21), 장면(API-ACT-10~12), 예약(API-ACT-15), 인터락(API-ACT-16),
 * 드라이버 쓰기·연결 확인·지표(API-ACT-30~32), 사용자 정의 기능 쓰기(API-ACT-25), 일괄 제어(API-ACT-05), 가동·효과(API-ACT-35),
 * 기기 변경 이력(API-DEV-27), 일괄 작업(API-DEV-70~74). 상태는 core.extra.controlM4. control.ts가 먼저 이 핸들러를 부른다.
 * 규칙·알람(RUL)과 유지보수(OPS-05) 응답은 그 도메인 핸들러 몫이라 여기 두지 않는다(테스트는 server.use로 덮어쓴다).
 * 모양은 core-api M4 실제 구현을 따른다: 장면·예약 목록은 전체 모양, 저장된 대상 ID(장면 항목 target, 예약 target·spaceHours)는 JSON 숫자,
 * 예약 단건 GET 없음, 인터락 목록에 blocks7d 없음·차단 기록에 기기 이름 없음, 가동 현황 from·to는 날짜, 변경 이력 action은 감사 이름.
 * `/drivers/test`(저장 전 연결 확인)는 문서(API-ACT-31)에만 있고 core에 아직 없다 — 화면 계약을 지키려고 남겨 둔다.
 * 일괄 작업(`/device-jobs`, API-DEV-70~74)도 core M4에 아직 없다.
 */
import { fail, list, noContent, ok, type CoreHandler, type CoreState } from "../core-fixtures";

const AT = "2026-10-04T00:00:00Z";

export interface ControlM4State {
  seq: number;
  stops: {
    emergencyStopId: string;
    scope: { type: string; spaceId?: string; includeChildren?: boolean };
    reason: string;
    startedBy: { userId: string; name: string };
    startedAt: string;
    releasedBy: { userId: string; name: string } | null;
    releasedAt: string | null;
    releaseNote: string | null;
    active: boolean;
  }[];
  scenes: {
    sceneId: string;
    name: string;
    description: string | null;
    spaceId: string | null;
    items: { target: Record<string, unknown>; capability: string; desired: Record<string, unknown> }[];
    version: number;
    updatedAt: string;
  }[];
  runs: Map<string, { status: string; results: { deviceId: string; commandId?: string; status: string; reason?: string }[]; polls: number }>;
  schedules: Record<string, unknown>[];
  interlocks: Record<string, unknown>[];
  drivers: Map<string, Record<string, unknown>>;
  capabilities: Record<string, unknown>[];
  bulkJobs: Map<string, { total: number; polls: number }>;
  jobs: Record<string, unknown>[];
  jobItems: Map<string, Record<string, unknown>[]>;
  history: Map<string, { id: string; at: string; actor: { type: string; id: string; name: string }; action: string; result: string; changes: Record<string, [unknown, unknown]> }[]>;
  /** 요청 본문 기록(테스트 확인용) */
  bodies: { path: string; body: unknown }[];
}

export function controlM4State(core: CoreState): ControlM4State {
  if (core.extra.controlM4) return core.extra.controlM4 as ControlM4State;
  const state: ControlM4State = {
    seq: 100,
    stops: [],
    scenes: [
      {
        sceneId: "501",
        name: "수업 모드",
        description: "강의 시작 전",
        spaceId: "31",
        items: [
          { target: { spaceId: 31, relation: "controls", capability: "Thermostat", includeChildren: false }, capability: "Thermostat", desired: { mode: "cool", targetTemperature: 24 } },
          { target: { deviceId: 2001 }, capability: "Switch", desired: { on: true } },
        ],
        version: 3,
        updatedAt: "2026-10-02T00:00:00Z",
      },
    ],
    runs: new Map(),
    schedules: [
      {
        controlScheduleId: "601",
        name: "아침 준비",
        kind: "RECURRING",
        target: { sceneId: 501 },
        cron: "50 8 * * 1,2,3,4,5",
        at: null,
        spaceHours: null,
        validFrom: null,
        validTo: null,
        skipHolidays: true,
        timezone: "Asia/Seoul",
        enabled: true,
        nextRunAt: "2026-10-05T23:50:00Z",
        lastRun: { at: "2026-10-02T23:50:00Z", status: "SUCCEEDED", commandIds: [] },
        version: 2,
        updatedAt: AT,
      },
    ],
    interlocks: [
      {
        interlockId: "701",
        name: "창문 열림 시 냉난방 금지",
        spaceId: "31",
        spaceName: "실습실 301",
        includeChildren: true,
        condition: { kind: "state", relation: "measures", capability: "Contact", attribute: "open", op: "==", value: true },
        forbid: { capability: "Thermostat", command: "set", argsMatch: { mode: { in: ["cool", "heat"] } } },
        message: "창문이 열려 있어 냉난방을 막았습니다",
        enabled: true,
        version: 1,
        updatedAt: AT,
      },
    ],
    drivers: new Map<string, Record<string, unknown>>([
      [
        "303",
        {
          driverId: "303",
          name: "LG ThinQ 본관",
          type: "LG_THINQ",
          status: "CIRCUIT_OPEN",
          deviceCount: 1,
          config: { region: "KR", clientId: "d2f-client" },
          hasSecret: true,
          pollingSec: 60,
          ackTimeoutSec: 30,
          applyTimeoutSec: 60,
          retry: { maxAttempts: 3 },
          circuit: { failureRate: 50 },
          capabilities: ["Switch", "Thermostat"],
          version: 4,
          createdAt: AT,
          updatedAt: AT,
        },
      ],
    ]),
    capabilities: [],
    bulkJobs: new Map(),
    jobs: [
      {
        id: "42",
        type: "SET_SPACE",
        status: "PARTIALLY_FAILED",
        total: 50,
        succeeded: 48,
        failed: 2,
        progressPercent: 100,
        retryOfJobId: null,
        target: { deviceIds: [] },
        params: { spaceId: "31" },
        createdBy: { userId: "8", name: "이통합" },
        createdAt: "2026-10-03T01:00:00Z",
        startedAt: "2026-10-03T01:00:01Z",
        finishedAt: "2026-10-03T01:01:00Z",
      },
    ],
    jobItems: new Map<string, Record<string, unknown>[]>([
      [
        "42",
        [
          { id: "1", deviceId: "1042", deviceName: "AM107-067999", status: "SUCCEEDED", errorCode: null, errorMessage: null, finishedAt: "2026-10-03T01:00:30Z" },
          { id: "2", deviceId: "151777", deviceName: "EM300-TH-151777", status: "FAILED", errorCode: "DEVICE_NOT_FOUND", errorMessage: "권한 밖 공간", finishedAt: "2026-10-03T01:00:31Z" },
          { id: "3", deviceId: "151778", deviceName: "EM300-TH-151778", status: "FAILED", errorCode: "DEVICE_NOT_FOUND", errorMessage: "권한 밖 공간", finishedAt: "2026-10-03T01:00:32Z" },
        ],
      ],
    ]),
    history: new Map<string, ControlM4State["history"] extends Map<string, infer V> ? V : never>([
      [
        "1042",
        [
          { id: "9102", at: "2026-10-03T02:00:00Z", actor: { type: "USER", id: "8", name: "이통합" }, action: "DEVICE_UPDATED", result: "SUCCESS", changes: { name: ["AM107", "실습실 AM107"] } },
          { id: "9101", at: "2026-10-01T00:00:00Z", actor: { type: "USER", id: "7", name: "김운영" }, action: "DEVICE_APPROVED", result: "SUCCESS", changes: { status: ["PENDING", "ACTIVE"], spaceId: [null, "31"] } },
        ],
      ],
    ]),
    bodies: [],
  };
  core.extra.controlM4 = state;
  return state;
}

const PATHS = /^\/(emergency-stops|scenes|scene-runs|control-schedules|interlocks|drivers|capabilities|commands\/bulk|command-bulk-jobs|device-jobs)(\/|$)|^\/devices\/[^/]+\/(runtime|history)$/;

export const controlM4Handler: CoreHandler = (core, { method, path, url, body, can, user }) => {
  if (!PATHS.test(path)) return undefined;
  const state = controlM4State(core);
  const b = (body ?? {}) as Record<string, unknown>;
  if (method !== "GET") state.bodies.push({ path, body });
  const next = () => String((state.seq += 1));
  const me = { userId: user.id, name: user.name };

  // ── 비상 정지 ──
  if (path === "/emergency-stops" && method === "GET") {
    const active = url.searchParams.get("active");
    return list(
      state.stops.filter((s) => active !== "true" || s.active),
      url,
    );
  }
  if (path === "/emergency-stops" && method === "POST") {
    if (!can("EMERGENCY_STOP")) return fail(403, "PERMISSION_DENIED");
    const scope = b.scope as { type: string; spaceId?: string };
    const reason = String(b.reason ?? "");
    if (reason.length < 1 || reason.length > 200) return fail(400, "INVALID_REQUEST", { errors: [{ field: "reason", code: "SIZE", message: "1~200" }] });
    if (state.stops.some((s) => s.active && s.scope.type === scope?.type && s.scope.spaceId === scope?.spaceId)) return fail(409, "EMERGENCY_STOP_ACTIVE");
    const stop = { emergencyStopId: next(), scope, reason, startedBy: me, startedAt: AT, releasedBy: null, releasedAt: null, releaseNote: null, active: true };
    state.stops.push(stop);
    return ok(stop, 201, { Location: `/api/v1/core/emergency-stops/${stop.emergencyStopId}` });
  }
  const release = /^\/emergency-stops\/([^/]+)\/release$/.exec(path);
  if (release && method === "POST") {
    if (!can("EMERGENCY_RELEASE")) return fail(403, "PERMISSION_DENIED");
    const stop = state.stops.find((s) => s.emergencyStopId === release[1]);
    if (!stop) return fail(404, "RESOURCE_NOT_FOUND");
    Object.assign(stop, { active: false, releasedBy: me, releasedAt: AT, releaseNote: (b.note as string) ?? null });
    return ok(stop);
  }

  // ── 장면 ──
  const sceneView = (s: ControlM4State["scenes"][number]) => ({ ...s, itemCount: s.items.length });
  /** core SceneService.values: 대상 ID는 숫자로 저장, 관계 대상은 relation=controls·capability·includeChildren을 채운다 */
  const storeItems = (items: ControlM4State["scenes"][number]["items"]) =>
    items.map((i) => {
      const t = i.target as Record<string, unknown>;
      const target =
        t.deviceId != null
          ? { deviceId: Number(t.deviceId) }
          : { spaceId: Number(t.spaceId), relation: "controls", capability: (t.capability as string) ?? i.capability, includeChildren: t.includeChildren !== false };
      return { target, capability: i.capability, desired: i.desired };
    });
  if (path === "/scenes" && method === "GET")
    return list(
      state.scenes.map((s) => sceneView(s)),
      url,
    );
  if (path === "/scenes" && method === "POST") {
    if (!can("SCENE_MANAGE")) return fail(403, "PERMISSION_DENIED");
    const items = (b.items as ControlM4State["scenes"][number]["items"]) ?? [];
    if (items.length > 100) return fail(400, "SCENE_ITEM_LIMIT_EXCEEDED");
    const scene = { sceneId: next(), name: String(b.name), description: (b.description as string) ?? null, spaceId: (b.spaceId as string) ?? null, items: storeItems(items), version: 1, updatedAt: AT };
    state.scenes.push(scene);
    return ok(sceneView(scene), 201, { Location: `/api/v1/core/scenes/${scene.sceneId}` });
  }
  const scene = /^\/scenes\/([^/]+)(\/(preview|run))?$/.exec(path);
  if (scene) {
    const found = state.scenes.find((s) => s.sceneId === scene[1]);
    if (!found) return fail(404, "SCENE_NOT_FOUND");
    if (!scene[3] && method === "GET") return ok(sceneView(found));
    if (!scene[3] && method === "PUT") {
      if (!can("SCENE_MANAGE")) return fail(403, "PERMISSION_DENIED");
      if (b.baseVersion !== found.version) return fail(409, "VERSION_CONFLICT");
      Object.assign(found, { name: b.name, description: b.description ?? null, items: storeItems((b.items as ControlM4State["scenes"][number]["items"]) ?? []), version: found.version + 1 });
      return ok(sceneView(found));
    }
    if (!scene[3] && method === "DELETE") {
      if (!can("SCENE_MANAGE")) return fail(403, "PERMISSION_DENIED");
      state.scenes = state.scenes.filter((s) => s !== found);
      return noContent();
    }
    if (scene[3] === "preview" && method === "POST") {
      return ok({
        items: [
          {
            deviceId: "2001",
            name: "AC-1 실습실 에어컨",
            capability: "Thermostat",
            current: { mode: "off" },
            target: { mode: "cool", targetTemperature: 24 },
            willChange: true,
            predictedBlock: { reason: "INTERLOCK", message: "창문이 열려 있어 냉난방을 막았습니다" },
            offline: false,
          },
          { deviceId: "2002", name: "환기 3F-02", capability: "Ventilation", current: { mode: "off" }, target: { mode: "on", level: 2 }, willChange: true, predictedBlock: null, offline: true },
          { deviceId: "2003", name: "실습실 조명", capability: "Dimmer", current: { level: 100 }, target: { level: 100 }, willChange: false, predictedBlock: null, offline: false },
        ],
      });
    }
    if (scene[3] === "run" && method === "POST") {
      if (!can("SCENE_RUN")) return fail(403, "PERMISSION_DENIED");
      const id = `sr-${next()}`;
      state.runs.set(id, { status: "RUNNING", results: [{ deviceId: "2001", status: "SENT" }], polls: 0 });
      return ok({ sceneRunId: id }, 202);
    }
  }
  const run = /^\/scene-runs\/([^/]+)$/.exec(path);
  if (run && method === "GET") {
    const found = state.runs.get(run[1]);
    if (!found) return fail(404, "RESOURCE_NOT_FOUND");
    found.polls += 1;
    if (found.polls > 1) {
      found.status = "PARTIAL";
      found.results = [
        { deviceId: "2001", commandId: "c-9", status: "BLOCKED", reason: "INTERLOCK" },
        { deviceId: "2002", commandId: "c-10", status: "QUEUED" },
        { deviceId: "2003", status: "SKIPPED", reason: "NO_CHANGE" },
      ];
    }
    return ok({ sceneRunId: run[1], sceneId: "501", status: found.status, results: found.results });
  }

  // ── 예약 ──
  /** core ScheduleService.values: 대상·운영 시간 ID는 숫자로 저장 */
  const storeSchedule = (body: Record<string, unknown>) => {
    const t = (body.target ?? {}) as Record<string, unknown>;
    const target = t.sceneId != null ? { sceneId: Number(t.sceneId) } : { deviceId: Number(t.deviceId), capability: t.capability, command: t.command, args: t.args ?? {} };
    const sh = body.spaceHours as Record<string, unknown> | undefined;
    return {
      name: body.name,
      target,
      kind: body.kind,
      at: body.at ?? null,
      cron: body.cron ?? null,
      spaceHours: sh ? { spaceId: Number(sh.spaceId), edge: sh.edge ?? "START", offsetMinutes: sh.offsetMinutes ?? 0 } : null,
      validFrom: body.validFrom ?? null,
      validTo: body.validTo ?? null,
      skipHolidays: Boolean(body.skipHolidays),
      timezone: body.timezone ?? "Asia/Seoul",
    };
  };
  if (path === "/control-schedules" && method === "GET") return list(state.schedules, url);
  if (path === "/control-schedules" && method === "POST") {
    if (!can("SCHEDULE_MANAGE")) return fail(403, "PERMISSION_DENIED");
    if (b.kind === "RECURRING" && !/^\S+ \S+ \S+ \S+ \S+$/.test(String(b.cron ?? ""))) return fail(400, "SCHEDULE_INVALID");
    const created = { controlScheduleId: next(), ...storeSchedule(b), enabled: true, nextRunAt: "2026-10-05T23:50:00Z", lastRun: null, version: 1, updatedAt: AT };
    state.schedules.push(created);
    return ok(created, 201);
  }
  const schedule = /^\/control-schedules\/([^/]+)(\/(enable|disable))?$/.exec(path);
  if (schedule) {
    const found = state.schedules.find((s) => s.controlScheduleId === schedule[1]);
    if (!found) return fail(404, "RESOURCE_NOT_FOUND");
    if (!can("SCHEDULE_MANAGE")) return fail(403, "PERMISSION_DENIED");
    // core에는 단건 GET이 없다(PUT·DELETE만 있어 405)
    if (!schedule[3] && method === "GET") return fail(405, "METHOD_NOT_ALLOWED");
    if (!schedule[3] && method === "PUT") {
      if (b.baseVersion != null && b.baseVersion !== found.version) return fail(409, "VERSION_CONFLICT");
      Object.assign(found, storeSchedule(b), { version: Number(found.version) + 1 });
      return ok(found);
    }
    if (!schedule[3] && method === "DELETE") {
      state.schedules = state.schedules.filter((s) => s !== found);
      return noContent();
    }
    if (schedule[3] && method === "POST") {
      found.enabled = schedule[3] === "enable";
      found.nextRunAt = found.enabled ? "2026-10-05T23:50:00Z" : null;
      return ok(found);
    }
  }

  // ── 인터락 ──
  if (path.startsWith("/interlocks") && !can("INTERLOCK_MANAGE")) return fail(403, "PERMISSION_DENIED");
  /** core SafetyService.interlockValues: metric 조건은 deviceId 또는 spaceAgg=true(boolean)만 받는다 */
  const interlockInvalid = () => {
    const c = (b.condition ?? {}) as Record<string, unknown>;
    if (!(b.forbid as { capability?: string })?.capability) return fail(400, "INTERLOCK_INVALID", { errors: [{ field: "forbid.capability", code: "INVALID", message: "" }] });
    if (c.kind === "metric" && c.deviceId == null && c.spaceAgg !== true) return fail(400, "INTERLOCK_INVALID", { errors: [{ field: "condition.metric", code: "INVALID", message: "" }] });
    return undefined;
  };
  if (path === "/interlocks" && method === "GET") return list(state.interlocks, url);
  if (path === "/interlocks" && method === "POST") {
    const invalid = interlockInvalid();
    if (invalid) return invalid;
    const created = { ...b, interlockId: next(), version: 1, updatedAt: AT };
    state.interlocks.push(created);
    return ok(created, 201);
  }
  const interlock = /^\/interlocks\/([^/]+)(\/blocks)?$/.exec(path);
  if (interlock) {
    const found = state.interlocks.find((s) => s.interlockId === interlock[1]);
    if (!found) return fail(404, "RESOURCE_NOT_FOUND");
    // action 중계 그대로: ApiResponse {responses:[…]}(최근 7일, 200건), 기기 이름 없음
    if (interlock[2])
      return ok({
        responses: [
          {
            at: "2026-10-03T01:10:00Z",
            commandId: "c0000000-0000-4000-8000-000000000002",
            deviceId: "2001",
            capability: "Thermostat",
            command: "set",
            args: { mode: "cool" },
            source: { type: "USER", userId: "7" },
            message: found.message,
          },
        ],
      });
    if (method === "GET") return ok(found);
    if (method === "PUT") {
      const invalid = interlockInvalid();
      if (invalid) return invalid;
      if (b.baseVersion != null && b.baseVersion !== found.version) return fail(409, "VERSION_CONFLICT");
      const { baseVersion: _base, ...rest } = b;
      Object.assign(found, rest, { version: Number(found.version) + 1 });
      return ok(found);
    }
    if (method === "DELETE") {
      state.interlocks = state.interlocks.filter((s) => s !== found);
      return noContent();
    }
  }

  // ── 드라이버(쓰기·연결 확인·지표, 목록은 control.ts) ──
  if (path.startsWith("/drivers")) {
    if (!can("DRIVER_MANAGE")) return fail(403, "PERMISSION_DENIED");
    if (path === "/drivers/test" && method === "POST") {
      const config = (b.config ?? {}) as Record<string, unknown>;
      return String(config.chirpstackUrl ?? "").includes("unreachable") ? fail(502, "DRIVER_HEALTHCHECK_FAILED", {}, {}) : ok({ ok: true, latencyMs: 84, capabilities: ["Switch", "Thermostat"] });
    }
    if (path === "/drivers" && method === "POST") {
      const { secret, ...rest } = b;
      const created = { ...rest, driverId: next(), status: "UNTESTED", deviceCount: 0, hasSecret: Boolean(secret), capabilities: [], version: 1, createdAt: AT, updatedAt: AT };
      state.drivers.set(created.driverId, created);
      return ok(created, 201);
    }
    const driver = /^\/drivers\/([^/]+)(\/(healthcheck|metrics))?$/.exec(path);
    if (driver) {
      const stored = state.drivers.get(driver[1]);
      if (driver[3] === "metrics" && method === "GET") {
        if (driver[1] === "303")
          return ok({
            status: "CIRCUIT_OPEN",
            circuit: { state: "OPEN", openedAt: "2026-10-03T23:58:00Z" },
            requests: 50,
            errors: 31,
            errorRate: 0.62,
            avgMs: null,
            p95Ms: null,
            recentErrors: [{ at: "2026-10-03T23:58:00Z", commandId: "c-x", message: "token expired" }],
          });
        return ok({ status: "OK", circuit: { state: "CLOSED", openedAt: null }, requests: 100, errors: 0, errorRate: 0, avgMs: 12, p95Ms: 20, recentErrors: [] });
      }
      if (driver[3] === "healthcheck" && method === "POST") return driver[1] === "303" ? fail(502, "DRIVER_HEALTHCHECK_FAILED") : ok({ ok: true, latencyMs: 12, capabilities: ["Switch"] });
      if (stored && method === "GET") return ok(stored);
      if (method === "PUT") {
        const { secret, ...rest } = b;
        const base = stored ?? { driverId: driver[1], status: "OK", deviceCount: 0, hasSecret: false, version: 1, createdAt: AT };
        const updated = { ...base, ...rest, hasSecret: Boolean(secret) || Boolean(base.hasSecret), version: Number(base.version ?? 1) + 1, updatedAt: AT };
        state.drivers.set(driver[1], updated);
        return ok(updated);
      }
      if (method === "DELETE") {
        if (driver[1] === "301") return fail(409, "DRIVER_IN_USE");
        state.drivers.delete(driver[1]);
        return noContent();
      }
    }
    return undefined;
  }

  // ── 사용자 정의 기능(조회는 flows.ts가 먼저 답한다) ──
  if (path === "/capabilities" && method === "POST") {
    if (!can("CAPABILITY_MANAGE")) return fail(403, "PERMISSION_DENIED");
    const name = String(b.name ?? "");
    if (["Switch", "Thermostat", "FanSpeed", "Ventilation", "Dimmer", "Lock", "Contact"].includes(name)) return fail(409, "CAPABILITY_NAME_RESERVED");
    const created = { ...b, version: 1, standard: false, updatedAt: AT };
    state.capabilities.push(created);
    return ok(created, 201);
  }
  const capability = /^\/capabilities\/([^/]+)$/.exec(path);
  if (capability && method === "PUT") {
    if (!can("CAPABILITY_MANAGE")) return fail(403, "PERMISSION_DENIED");
    const name = decodeURIComponent(capability[1]);
    if (!name.startsWith("custom.")) return fail(409, "CAPABILITY_NAME_RESERVED");
    return ok({ ...b, name, version: 2, standard: false, updatedAt: AT });
  }
  if (path.startsWith("/capabilities")) return undefined;

  // ── 일괄 제어 ──
  if (path === "/commands/bulk" && method === "POST") {
    if (!can("DEVICE_CONTROL")) return fail(403, "PERMISSION_DENIED");
    const ids = ((b.target as { deviceIds?: string[] })?.deviceIds ?? []).map(String);
    if (ids.length > 500) return fail(400, "COMMAND_BULK_LIMIT_EXCEEDED");
    if (b.preview)
      return ok({
        devices: ids.map((id) => ({
          deviceId: id,
          name: core.devices.find((d) => d.id === id)?.name ?? id,
          current: { on: false },
          target: b.args,
          willChange: true,
          warnings: id === "2001" ? ["OFFLINE"] : [],
        })),
      });
    const id = `bj-${next()}`;
    state.bulkJobs.set(id, { total: ids.length, polls: 0 });
    return ok({ bulkJobId: id, total: ids.length }, 202);
  }
  const bulk = /^\/command-bulk-jobs\/([^/]+)$/.exec(path);
  if (bulk && method === "GET") {
    const job = state.bulkJobs.get(bulk[1]);
    if (!job) return fail(404, "RESOURCE_NOT_FOUND");
    job.polls += 1;
    return ok({ bulkJobId: bulk[1], status: "RUNNING", total: job.total, succeeded: job.total - 1, failed: 0, queued: 1, skipped: 0, items: [{ deviceId: "2001", commandId: "c0000000-0000-4000-8000-000000000003", status: "QUEUED", reason: "OFFLINE" }] });
  }

  // ── 가동·효과(API-ACT-35) ──
  const runtime = /^\/devices\/([^/]+)\/runtime$/.exec(path);
  if (runtime && method === "GET") {
    // action은 from·to를 LocalDate로 받는다(시각을 보내면 400)
    const date = /^\d{4}-\d{2}-\d{2}$/;
    for (const key of ["from", "to"]) {
      const v = url.searchParams.get(key);
      if (v !== null && !date.test(v)) return fail(400, "INVALID_REQUEST", { errors: [{ field: key, code: "TYPE_MISMATCH", message: "" }] });
    }
    return ok({
      items: [
        { date: "2026-10-02", onSeconds: 21600, cycles: 4, energyWh: 7200, energySource: "RATED", noEffectEvents: 0 },
        { date: "2026-10-03", onSeconds: 10800, cycles: 2, energyWh: 3600, energySource: "RATED", noEffectEvents: 1 },
      ],
      noEffectEvents: [
        {
          at: "2026-10-03T03:15:00Z",
          commandId: "c0000000-0000-4000-8000-000000000001",
          metric: "temperature",
          expected: { direction: "down", withinMinutes: 15 },
          observed: { start: 27.4, end: 27.5, delta: 0.1 },
        },
      ],
    });
  }

  // ── 변경 이력(API-DEV-27) ──
  const history = /^\/devices\/([^/]+)\/history$/.exec(path);
  if (history && method === "GET") return list(state.history.get(history[1]) ?? [], url);

  // ── 일괄 작업(API-DEV-70~74) ──
  if (path === "/device-jobs" && method === "GET")
    return list(
      state.jobs.map(({ id, type, status, total, succeeded, failed, createdBy, createdAt, finishedAt }) => ({ id, type, status, total, succeeded, failed, createdBy, createdAt, finishedAt })),
      url,
    );
  if (path === "/device-jobs" && method === "POST") {
    if (!can("DEV_ADMIN") || (b.type === "SEND_COMMAND" && !can("DEVICE_CONTROL"))) return fail(403, "PERMISSION_DENIED");
    const ids = ((b.target as { deviceIds?: string[] })?.deviceIds ?? []).map(String);
    if (ids.length > 5000) return fail(400, "INVALID_REQUEST");
    if (state.jobs.filter((j) => j.status === "RUNNING" || j.status === "QUEUED").length >= 3) return fail(429, "JOB_LIMIT_EXCEEDED");
    if (b.dryRun)
      return ok({
        targetCount: ids.length || 12,
        sample: (ids.length ? ids : ["1042"]).slice(0, 10).map((id) => ({ deviceId: id, name: core.devices.find((d) => d.id === id)?.name ?? id })),
        deniedCount: 0,
      });
    const job = {
      id: next(),
      type: b.type,
      status: "QUEUED",
      total: ids.length || 12,
      succeeded: 0,
      failed: 0,
      progressPercent: 0,
      retryOfJobId: null,
      target: b.target,
      params: b.params,
      createdBy: me,
      createdAt: AT,
      startedAt: null,
      finishedAt: null,
    };
    state.jobs.unshift(job);
    state.jobItems.set(job.id, []);
    return ok(job, 201);
  }
  const job = /^\/device-jobs\/([^/]+)(\/(items|retry-failed|cancel))?$/.exec(path);
  if (job) {
    const found = state.jobs.find((j) => j.id === job[1]);
    if (!found) return fail(404, "JOB_NOT_FOUND");
    if (!job[3] && method === "GET") return ok(found);
    if (job[3] === "items" && method === "GET") {
      const status = url.searchParams.get("status");
      return list(
        (state.jobItems.get(found.id as string) ?? []).filter((i) => !status || i.status === status),
        url,
      );
    }
    if (!can("DEV_ADMIN")) return fail(403, "PERMISSION_DENIED");
    if (job[3] === "retry-failed" && method === "POST") {
      const failedItems = (state.jobItems.get(found.id as string) ?? []).filter((i) => i.status === "FAILED");
      const retried = {
        ...found,
        id: next(),
        status: "QUEUED",
        total: failedItems.length,
        succeeded: 0,
        failed: 0,
        progressPercent: 0,
        retryOfJobId: found.id,
        createdBy: me,
        createdAt: AT,
        finishedAt: null,
      };
      state.jobs.unshift(retried);
      state.jobItems.set(
        retried.id,
        failedItems.map((i) => ({ ...i, status: "PENDING", errorCode: null, errorMessage: null })),
      );
      return ok(retried, 201);
    }
    if (job[3] === "cancel" && method === "POST") {
      if (found.status !== "RUNNING" && found.status !== "QUEUED") return fail(409, "JOB_STATE_CONFLICT");
      found.status = "CANCELLED";
      return ok(found);
    }
  }
  return undefined;
};
