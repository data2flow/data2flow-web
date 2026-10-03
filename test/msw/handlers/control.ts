/**
 * 제어(ACT) 가짜 API(design/api/ACT-api.md API-ACT-01~04·06·30·31). 상태는 core.extra.control.
 * 가상 실습실 에어컨(기기 2001, Switch·Thermostat)과 플로우·사용자 출처 명령 이력을 담는다. 제어는 DEVICE_CONTROL, 드라이버는 DRIVER_MANAGE.
 */
import { HttpResponse } from "msw";
import { fail, list, noContent, ok, type CoreHandler, type CoreState } from "../core-fixtures";
import { envelope } from "../fake-gateway";
import { setModelPackage } from "./models";

export interface FakeCommand {
  id: string;
  status: string;
  statusReason: string | null;
  deviceId: string;
  deviceName: string;
  capability: string;
  command: string;
  args: Record<string, unknown>;
  priority: string;
  source: Record<string, unknown>;
  validUntil: string;
  timeline: { status: string; at: string; reason?: string | null }[];
  message: string | null;
  idempotencyKey: string;
}

export interface ControlState {
  info: Map<string, Record<string, unknown>>;
  commands: FakeCommand[];
  keys: Map<string, string>;
  drivers: { driverId: string; name: string; type: string; status: string; deviceCount: number; capabilities: string[]; updatedAt: string }[];
  seq: number;
}

export const AIRCON_ID = "2001";

const THERMOSTAT = {
  name: "Thermostat",
  version: 1,
  attributes: [
    { name: "mode", type: "enum", enum: ["off", "cool", "heat", "dry", "fan", "auto"] },
    { name: "targetTemperature", type: "number", unit: "℃", min: 5, max: 35, step: 0.5 },
    { name: "currentTemperature", type: "number", unit: "℃", readOnly: true },
  ],
  commands: [{ name: "set", sets: ["mode", "targetTemperature"] }],
  effectiveConstraints: { mode: { enum: ["off", "cool", "heat", "auto"] }, targetTemperature: { min: 18, max: 28 } },
};
const SWITCH = { name: "Switch", version: 1, attributes: [{ name: "on", type: "boolean" }], commands: [{ name: "set", sets: ["on"] }], effectiveConstraints: {} };

export function controlState(core: CoreState): ControlState {
  if (core.extra.control) return core.extra.control as ControlState;
  const state: ControlState = { info: new Map(), commands: [], keys: new Map(), drivers: [], seq: 0 };
  core.extra.control = state;
  if (!core.devices.some((d) => d.id === AIRCON_ID)) {
    core.devices.push({
      id: AIRCON_ID,
      name: "AC-1 실습실 에어컨",
      externalId: "5a1d000000002001",
      kind: "ACTUATOR",
      status: "ACTIVE",
      connectivity: "ONLINE",
      modelId: null,
      spaceId: "31",
      sourceId: "7",
      tags: [],
      virtual: true,
      lastSeenAt: "2026-10-03T23:59:00Z",
      latest: [],
      version: 1,
    });
  }
  state.info.set(AIRCON_ID, {
    controllable: true,
    driver: { id: "301", name: "가상 드라이버", type: "VIRTUAL", status: "OK" },
    capabilities: [SWITCH, THERMOSTAT],
    shadow: {
      desired: { Switch: { on: true }, Thermostat: { mode: "cool", targetTemperature: 26 } },
      desiredVersion: 4,
      reported: { Switch: { on: true }, Thermostat: { mode: "cool", targetTemperature: 26, currentTemperature: 27.4 } },
      reportedAt: "2026-10-03T23:59:00Z",
      delta: {},
      connectivity: "ONLINE",
    },
    manualOverride: null,
    protection: null,
    pending: [],
    emergencyStop: null,
  });
  state.drivers.push(
    { driverId: "301", name: "가상 드라이버", type: "VIRTUAL", status: "OK", deviceCount: 1, capabilities: ["Switch", "Thermostat", "FanSpeed", "Ventilation", "Dimmer", "Lock"], updatedAt: "2026-10-01T00:00:00Z" },
    { driverId: "302", name: "MQTT 기본", type: "MQTT", status: "UNTESTED", deviceCount: 0, capabilities: ["Switch"], updatedAt: "2026-10-01T00:00:00Z" },
  );
  const at = (s: string) => `2026-10-03T${s}Z`;
  state.commands.push(
    {
      id: "c0000000-0000-4000-8000-000000000002",
      status: "BLOCKED",
      statusReason: "INTERLOCK",
      deviceId: AIRCON_ID,
      deviceName: "AC-1 실습실 에어컨",
      capability: "Thermostat",
      command: "set",
      args: { mode: "cool" },
      priority: "MANUAL",
      source: { type: "USER", userId: "7", userName: "김운영" },
      validUntil: at("01:20:00"),
      timeline: [{ status: "REQUESTED", at: at("01:10:00") }, { status: "BLOCKED", at: at("01:10:00.300"), reason: "INTERLOCK" }],
      message: "창문이 열려 있어 냉방을 막았습니다",
      idempotencyKey: "k-blocked",
    },
    {
      id: "c0000000-0000-4000-8000-000000000001",
      status: "APPLIED",
      statusReason: null,
      deviceId: AIRCON_ID,
      deviceName: "AC-1 실습실 에어컨",
      capability: "Thermostat",
      command: "set",
      args: { mode: "cool", targetTemperature: 24 },
      priority: "AUTO",
      source: { type: "FLOW", flowId: "f-7f3a", flowName: "고온이면 냉방", flowVersion: 13, nodeId: "n-act-1" },
      validUntil: at("01:22:03"),
      timeline: [{ status: "REQUESTED", at: at("01:12:03") }, { status: "SENT", at: at("01:12:03.400") }, { status: "ACKED", at: at("01:12:04.200") }, { status: "APPLIED", at: at("01:12:05.100") }],
      message: null,
      idempotencyKey: "b3c1sha256",
    },
  );
  return state;
}

const CONTROL_PATH = /^\/(devices\/[^/]+\/(control|shadow|commands|manual-override)|commands(\/|$)|drivers(\/|$)|device-models\/[^/]+\/driver$)/;

/** 커서 목록(cursor는 시작 위치) */
function cursorList<T>(items: T[], url: URL) {
  const size = Math.min(100, Math.max(1, Number(url.searchParams.get("size")) || 20));
  const start = Number(url.searchParams.get("cursor")) || 0;
  const page = items.slice(start, start + size);
  const next = start + size < items.length ? String(start + size) : null;
  return HttpResponse.json({ ...envelope(), size, responses: page, nextCursor: next });
}

export const controlHandler: CoreHandler = (core, { method, path, url, body, can, request }) => {
  // 기기 상세(가상 에어컨) 조회가 먼저 오면 기기를 만들어 둔다
  if (path === `/devices/${AIRCON_ID}`) controlState(core);
  if (!CONTROL_PATH.test(path)) return undefined;
  const state = controlState(core);
  const filtered = (items: FakeCommand[]) =>
    items.filter((c) => ["status", "capability"].every((k) => !url.searchParams.get(k) || (c as unknown as Record<string, unknown>)[k] === url.searchParams.get(k)) && (!url.searchParams.get("sourceType") || c.source.type === url.searchParams.get("sourceType")));

  const device = /^\/devices\/([^/]+)\/(control|shadow|commands|manual-override)$/.exec(path);
  if (device) {
    const [, id, kind] = device;
    const d = core.devices.find((x) => x.id === id);
    if (!d) return fail(404, "DEVICE_NOT_FOUND");
    const info = state.info.get(id) ?? { controllable: false, driver: null, capabilities: [], shadow: null, pending: [] };
    if (kind === "control" && method === "GET") return ok(info);
    if (kind === "shadow" && method === "GET") return ok({ ...(info.shadow as object), desiredSource: { type: "USER" }, reportedVersion: 9 });
    if (kind === "manual-override" && method === "DELETE") {
      if (!can("DEVICE_CONTROL")) return fail(403, "PERMISSION_DENIED");
      info.manualOverride = null;
      return noContent();
    }
    if (kind === "commands" && method === "GET") return cursorList(filtered(state.commands.filter((c) => c.deviceId === id)), url);
    if (kind === "commands" && method === "POST") {
      if (!can("DEVICE_CONTROL")) return fail(403, "PERMISSION_DENIED");
      const key = request.headers.get("Idempotency-Key");
      if (!key) return fail(400, "INVALID_REQUEST");
      const repeated = state.keys.get(key);
      if (repeated) return ok(state.commands.find((c) => c.id === repeated), 202);
      if (!info.controllable) return fail(409, "DEVICE_NOT_CONTROLLABLE");
      const req = body as { capability: string; command: string; args: Record<string, unknown> };
      const capability = (info.capabilities as { name: string }[]).find((c) => c.name === req.capability);
      state.seq += 1;
      const now = "2026-10-04T00:00:00Z";
      const command: FakeCommand = {
        id: `c1000000-0000-4000-8000-${String(state.seq).padStart(12, "0")}`,
        status: "REQUESTED",
        statusReason: null,
        deviceId: id,
        deviceName: d.name,
        capability: req.capability,
        command: req.command,
        args: req.args ?? {},
        priority: "MANUAL",
        source: { type: "USER", userId: "7", userName: "김운영" },
        validUntil: "2026-10-04T00:10:00Z",
        timeline: [{ status: "REQUESTED", at: now }],
        message: null,
        idempotencyKey: key,
      };
      state.keys.set(key, command.id);
      const target = req.args?.targetTemperature;
      const reject = (status: number, code: string) => {
        command.status = "REJECTED";
        command.statusReason = code;
        command.timeline.push({ status: "REJECTED", at: now, reason: code });
        state.commands.unshift(command);
        return fail(status, code, { response: { commandId: command.id } });
      };
      if (!capability) return reject(400, "CAPABILITY_NOT_SUPPORTED");
      // 조직 절대 한계 18~28℃(API-ACT-17 예시)
      if (typeof target === "number" && (target < 18 || target > 28)) return reject(400, "COMMAND_ABSOLUTE_LIMIT");
      state.commands.unshift(command);
      const shadow = info.shadow as { desired: Record<string, Record<string, unknown>> };
      shadow.desired[req.capability] = { ...(shadow.desired[req.capability] ?? {}), ...req.args };
      return ok(command, 202);
    }
    return fail(405, "INVALID_REQUEST");
  }

  if (path === "/commands" && method === "GET") {
    const spaceId = url.searchParams.get("spaceId");
    const items = filtered(state.commands).filter((c) => !spaceId || core.devices.find((d) => d.id === c.deviceId)?.spaceId === spaceId);
    return cursorList(items, url);
  }
  const one = /^\/commands\/([^/]+)(\/cancel)?$/.exec(path);
  if (one) {
    const command = state.commands.find((c) => c.id === one[1]);
    if (!command) return fail(404, "COMMAND_NOT_FOUND");
    if (!one[2] && method === "GET") return ok(command);
    if (one[2] && method === "POST") {
      if (!can("DEVICE_CONTROL")) return fail(403, "PERMISSION_DENIED");
      if (!["QUEUED", "DELAYED", "QUEUED_FOR_DOWNLINK"].includes(command.status)) return fail(409, "COMMAND_NOT_CANCELLABLE");
      command.status = "CANCELLED";
      command.timeline.push({ status: "CANCELLED", at: "2026-10-04T00:00:01Z" });
      return ok(command);
    }
  }

  if (path === "/drivers" && method === "GET") {
    if (!can("DRIVER_MANAGE")) return fail(403, "PERMISSION_DENIED");
    const items = state.drivers.map(({ capabilities: _c, ...rest }) => (void _c, rest));
    return list(items, url);
  }
  const driver = /^\/drivers\/([^/]+)$/.exec(path);
  if (driver && method === "GET") {
    if (!can("DRIVER_MANAGE")) return fail(403, "PERMISSION_DENIED");
    const found = state.drivers.find((x) => x.driverId === driver[1]);
    return found ? ok({ ...found, config: {}, hasSecret: false, version: 1, createdAt: found.updatedAt }) : fail(404, "DRIVER_NOT_FOUND");
  }
  const modelDriver = /^\/device-models\/([^/]+)\/driver$/.exec(path);
  if (modelDriver && method === "PUT") {
    if (!can("DRIVER_MANAGE")) return fail(403, "PERMISSION_DENIED");
    const model = core.models.find((m) => m.id === modelDriver[1]);
    if (!model) return fail(404, "MODEL_NOT_FOUND");
    const { driverId } = body as { driverId: string | null };
    if (driverId) {
      const found = state.drivers.find((x) => x.driverId === driverId);
      if (!found) return fail(404, "DRIVER_NOT_FOUND");
      const missing = model.capabilities.map((c) => c.capability).filter((c) => !found.capabilities.includes(c));
      if (missing.length) return fail(400, "DRIVER_CAPABILITY_MISMATCH", { errors: missing.map((c) => ({ field: "driverId", code: "DRIVER_CAPABILITY_MISMATCH", message: c })) });
    }
    setModelPackage(core, model.id, { driverId: driverId ?? null });
    return noContent();
  }
  return undefined;
};
