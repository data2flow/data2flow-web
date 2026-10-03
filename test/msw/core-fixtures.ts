/**
 * M2 수집 경로 가짜 core 상태(아카데미 실측 기기·공간, design/api/DEV·DSC·TSD·ING·SCR·DSH-api.md 계약 모양).
 * 도메인별 핸들러(`handlers/*.ts`)가 이 상태를 읽고 바꾼다. 테스트는 필드를 직접 바꿔 상황을 만든다.
 */
import { HttpResponse } from "msw";
import { envelope, fail, type FakeUser } from "./fake-gateway";

export interface CoreRequest {
  request: Request;
  method: string;
  path: string;
  url: URL;
  body: unknown;
  user: FakeUser;
  /** 사용자가 가진 권한 */
  can: (permission: string) => boolean;
}

export type CoreHandler = (core: CoreState, req: CoreRequest) => Response | undefined | Promise<Response | undefined>;

export const NOW = "2026-10-04T00:00:00Z";

export interface FakeSpace {
  id: string;
  parentId: string | null;
  type: string;
  name: string;
  code?: string | null;
  sortOrder: number;
  timezone?: string | null;
  usage?: string | null;
  areaM2?: number | null;
  capacity?: number | null;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  version: number;
}

export interface FakeDevice {
  id: string;
  name: string;
  externalId: string;
  kind: string;
  status: "PENDING" | "ACTIVE" | "INACTIVE";
  connectivity: "ONLINE" | "OFFLINE" | "UNKNOWN";
  modelId: string | null;
  spaceId: string | null;
  sourceId: string;
  tags: string[];
  virtual: boolean;
  lastSeenAt: string | null;
  firstSeenAt?: string;
  battery?: number | null;
  rssi?: number | null;
  latest: { metricKey: string; displayName?: string; unit?: string; value: number; measuredAt: string; quality: number }[];
  sourceMeta?: Record<string, unknown>;
  version: number;
}

export interface FakeModel {
  id: string;
  code: string;
  vendor: string;
  name: string;
  protocol: string;
  kind: string;
  defaultIntervalSec: number;
  builtin: boolean;
  status: "ACTIVE" | "DEPRECATED";
  metrics: { key: string; required: boolean }[];
  capabilities: { capability: string; constraints?: unknown }[];
  description?: string | null;
  attributeSchema?: unknown;
  version: number;
}

export interface FakeMetric {
  id: string;
  key: string;
  displayName: string;
  unit: string | null;
  valueType: "NUMBER" | "BOOLEAN" | "ENUM";
  validMin: number | null;
  validMax: number | null;
  precision: number | null;
  aggDefault: string;
  status: "VERIFIED" | "UNVERIFIED" | "IGNORED";
  builtin: boolean;
  aliases: string[];
  firstSeen?: { at: string; deviceId: string } | null;
  sample?: { deviceId: string; value: number; at: string }[];
  version: number;
}

export interface FakeSource {
  id: string;
  code: string;
  name: string;
  type: string;
  connectorKey?: string;
  lifecycle: "DRAFT" | "ACTIVE" | "PAUSED" | "ARCHIVED";
  state: string;
  connection: Record<string, unknown>;
  topics: { topic: string; qos: number }[];
  decoderKey: string;
  decoderConfig?: unknown;
  decodeScriptId?: string | null;
  unknownDevicePolicy: "AUTO_REGISTER" | "REJECT";
  defaultModelId?: string | null;
  defaultSpaceId?: string | null;
  autoregLimitPerHour: number;
  noDataAlarmAfterSec: number;
  secret: { kind: string; configured: boolean; fingerprint?: string | null; rotatedAt?: string | null };
  runtime: { instanceId: string; state: string; errorKind?: string | null; errorMessage?: string | null; clientId?: string; connectedSince?: string | null; reportedAt?: string; reconnects24h?: number }[];
  ratePerMin: number;
  decodeErrorRate1h: number;
  lastReceivedAt: string | null;
  version: number;
}

export interface FakeGroup {
  id: string;
  name: string;
  type: "STATIC" | "DYNAMIC";
  description?: string | null;
  criteria?: Record<string, unknown> | null;
  memberIds: string[];
  version: number;
}

export interface FakeScript {
  id: string;
  name: string;
  kind: "DECODE" | "TRANSFORM";
  status: "ENABLED" | "DISABLED" | "AUTO_DISABLED";
  description?: string | null;
  activeVersion: { versionId: string; versionNo: number; code: string; deployedAt: string; deployMemo: string } | null;
  draft: { versionId: string; versionNo: number; code: string; staticCheck: { ok: boolean; problems: unknown[] } } | null;
  bindings: { targetType: string; targetId: string; name?: string; failurePolicy: string }[];
  version: number;
}

export function list<T>(items: T[], url: URL, extra: Record<string, unknown> = {}) {
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const size = Math.min(100, Math.max(1, Number(url.searchParams.get("size")) || 20));
  const start = (page - 1) * size;
  return HttpResponse.json({ ...envelope(), page, size, totalPages: Math.max(1, Math.ceil(items.length / size)), responses: items.slice(start, start + size), totalCount: items.length, ...extra });
}

export function ok(response?: unknown, status = 200, headers: Record<string, string> = {}) {
  return HttpResponse.json(envelope(response), { status, headers });
}

export { fail };

/** 가짜 core 상태. 시나리오 1(소스 등록 → 승인 → 실시간 차트)에 필요한 최소 데이터 */
export class CoreState {
  seq = 9000;
  spaces: FakeSpace[] = [
    { id: "1", parentId: null, type: "SITE", name: "광주캠퍼스", code: "gwangju", sortOrder: 0, timezone: "Asia/Seoul", address: "광주광역시", latitude: 35.15, longitude: 126.85, version: 1 },
    { id: "2", parentId: "1", type: "BUILDING", name: "본관", code: "main", sortOrder: 0, version: 1 },
    { id: "3", parentId: "2", type: "FLOOR", name: "3층", code: "3f", sortOrder: 0, version: 1 },
    { id: "31", parentId: "3", type: "ROOM", name: "실습실", code: "lab", sortOrder: 0, usage: "CLASSROOM", areaM2: 66, capacity: 30, version: 2 },
    { id: "32", parentId: "3", type: "ROOM", name: "사무실", code: "office", sortOrder: 1, version: 1 },
  ];
  models: FakeModel[] = [
    { id: "11", code: "EM300-TH", vendor: "Milesight", name: "EM300-TH", protocol: "LORAWAN", kind: "SENSOR", defaultIntervalSec: 600, builtin: true, status: "ACTIVE", metrics: [{ key: "temperature", required: true }, { key: "humidity", required: true }], capabilities: [], version: 1 },
    { id: "12", code: "AM107", vendor: "Milesight", name: "AM107", protocol: "LORAWAN", kind: "SENSOR", defaultIntervalSec: 60, builtin: true, status: "ACTIVE", metrics: [{ key: "temperature", required: true }, { key: "humidity", required: true }, { key: "co2", required: true }], capabilities: [], version: 1 },
    { id: "13", code: "WS302", vendor: "Milesight", name: "WS302", protocol: "LORAWAN", kind: "SENSOR", defaultIntervalSec: 600, builtin: true, status: "ACTIVE", metrics: [{ key: "LAeq", required: true }], capabilities: [], version: 1 },
  ];
  metrics: FakeMetric[] = [
    { id: "101", key: "temperature", displayName: "온도", unit: "℃", valueType: "NUMBER", validMin: -20, validMax: 60, precision: 1, aggDefault: "AVG", status: "VERIFIED", builtin: true, aliases: [], version: 1 },
    { id: "102", key: "humidity", displayName: "습도", unit: "%", valueType: "NUMBER", validMin: 0, validMax: 100, precision: 0, aggDefault: "AVG", status: "VERIFIED", builtin: true, aliases: [], version: 1 },
    { id: "103", key: "co2", displayName: "CO2", unit: "ppm", valueType: "NUMBER", validMin: 0, validMax: 10000, precision: 0, aggDefault: "AVG", status: "VERIFIED", builtin: true, aliases: [], version: 1 },
    { id: "104", key: "illuminance", displayName: "illuminance", unit: null, valueType: "NUMBER", validMin: null, validMax: null, precision: null, aggDefault: "AVG", status: "UNVERIFIED", builtin: false, aliases: [], firstSeen: { at: "2026-10-03T00:20:00Z", deviceId: "1042" }, sample: [{ deviceId: "1042", value: 320, at: "2026-10-03T00:20:00Z" }], version: 1 },
  ];
  sources: FakeSource[] = [
    {
      id: "7",
      code: "chirpstack-s3",
      name: "ChirpStack s3",
      type: "MQTT_SUBSCRIBE",
      connectorKey: "mqtt",
      lifecycle: "ACTIVE",
      state: "CONNECTED",
      connection: { url: "wss://iot-data.java21.net:443/mqtt", clientIdBase: "data2flow-chirpstack-s3", qos: 1, keepaliveSec: 60, cleanStart: false, sessionExpirySec: 3600, auth: "HEADER", headerName: "Authorization" },
      topics: [{ topic: "application/+/device/+/event/up", qos: 1 }],
      decoderKey: "chirpstack-v4",
      unknownDevicePolicy: "AUTO_REGISTER",
      defaultModelId: null,
      defaultSpaceId: "3",
      autoregLimitPerHour: 100,
      noDataAlarmAfterSec: 600,
      secret: { kind: "HEADER", configured: true, fingerprint: "••••a1b2", rotatedAt: "2026-10-01T00:00:00Z" },
      runtime: [
        { instanceId: "ingress-0", state: "CONNECTED", clientId: "data2flow-chirpstack-s3-prod-0", connectedSince: "2026-10-03T20:48:00Z", reportedAt: NOW, reconnects24h: 0 },
        { instanceId: "ingress-1", state: "CONNECTED", clientId: "data2flow-chirpstack-s3-prod-1", connectedSince: "2026-10-03T20:48:00Z", reportedAt: NOW, reconnects24h: 1, errorKind: "TIMEOUT", errorMessage: "10:02 TIMEOUT" },
      ],
      ratePerMin: 10,
      decodeErrorRate1h: 0,
      lastReceivedAt: "2026-10-03T23:59:48Z",
      version: 3,
    },
  ];
  devices: FakeDevice[] = [
    {
      id: "1042",
      name: "AM107-067999",
      externalId: "24e124707c067999",
      kind: "SENSOR",
      status: "ACTIVE",
      connectivity: "ONLINE",
      modelId: "12",
      spaceId: "31",
      sourceId: "7",
      tags: ["pilot"],
      virtual: false,
      lastSeenAt: "2026-10-03T23:59:48Z",
      battery: 92,
      rssi: -33,
      latest: [
        { metricKey: "temperature", displayName: "온도", unit: "℃", value: 22.3, measuredAt: "2026-10-03T23:59:48Z", quality: 0 },
        { metricKey: "humidity", displayName: "습도", unit: "%", value: 44.5, measuredAt: "2026-10-03T23:59:48Z", quality: 0 },
        { metricKey: "co2", displayName: "CO2", unit: "ppm", value: 517, measuredAt: "2026-10-03T23:59:48Z", quality: 0 },
      ],
      version: 4,
    },
    {
      id: "1050",
      name: "EM300-TH-151606",
      externalId: "24e124136d151606",
      kind: "SENSOR",
      status: "PENDING",
      connectivity: "ONLINE",
      modelId: null,
      spaceId: null,
      sourceId: "7",
      tags: [],
      virtual: false,
      firstSeenAt: "2026-10-03T00:12:00Z",
      lastSeenAt: "2026-10-03T23:58:00Z",
      latest: [
        { metricKey: "temperature", unit: "℃", value: 22.3, measuredAt: "2026-10-03T23:58:00Z", quality: 0 },
        { metricKey: "humidity", unit: "%", value: 43, measuredAt: "2026-10-03T23:58:00Z", quality: 0 },
      ],
      sourceMeta: { deviceName: "EM300-TH-151606", tags: { location: "실습실", point: "중앙 좌측" } },
      version: 1,
    },
    {
      id: "1051",
      name: "WS302-012436",
      externalId: "24e124743d012436",
      kind: "SENSOR",
      status: "PENDING",
      connectivity: "ONLINE",
      modelId: null,
      spaceId: null,
      sourceId: "7",
      tags: [],
      virtual: false,
      firstSeenAt: "2026-10-03T00:13:00Z",
      lastSeenAt: "2026-10-03T23:57:00Z",
      latest: [{ metricKey: "LAeq", unit: "dB", value: 30.5, measuredAt: "2026-10-03T23:57:00Z", quality: 0 }],
      sourceMeta: { deviceName: "WS302-012436", tags: { location: "실습실", point: "강단" } },
      version: 1,
    },
  ];
  groups: FakeGroup[] = [{ id: "61", name: "3층 CO2 센서", type: "STATIC", description: null, criteria: null, memberIds: ["1042"], version: 1 }];
  scripts: FakeScript[] = [];
  /** 도메인별 핸들러가 쓰는 자유 저장소 */
  readonly extra: Record<string, unknown> = {};

  nextId() {
    this.seq += 1;
    return String(this.seq);
  }

  spaceTree(rootId?: string | null) {
    const build = (parentId: string | null, depth: number): Record<string, unknown>[] =>
      this.spaces
        .filter((s) => s.parentId === parentId)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((s) => {
          const devices = this.devices.filter((d) => d.spaceId === s.id && d.status !== "PENDING");
          return { id: s.id, parentId: s.parentId, type: s.type, name: s.name, code: s.code ?? null, depth, sortOrder: s.sortOrder, counts: { devices: devices.length, offline: devices.filter((d) => d.connectivity === "OFFLINE").length, alarms: 0 }, mode: null, children: build(s.id, depth + 1) };
        });
    if (rootId) {
      const root = this.spaces.find((s) => s.id === rootId);
      return root ? [{ ...root, depth: 1, children: build(root.id, 2) }] : [];
    }
    return build(null, 1);
  }

  spacePath(spaceId: string | null): { id: string; name: string }[] {
    const path: { id: string; name: string }[] = [];
    let current = this.spaces.find((s) => s.id === spaceId);
    while (current) {
      path.unshift({ id: current.id, name: current.name });
      const parentId: string | null = current.parentId;
      current = this.spaces.find((s) => s.id === parentId);
    }
    return path;
  }

  model(id: string | null | undefined) {
    return this.models.find((m) => m.id === id || m.code === id);
  }

  source(id: string | null | undefined) {
    return this.sources.find((s) => s.id === id);
  }

  deviceSummary(d: FakeDevice) {
    const model = this.model(d.modelId);
    const source = this.source(d.sourceId);
    const path = this.spacePath(d.spaceId);
    return {
      id: d.id,
      name: d.name,
      externalId: d.externalId,
      kind: d.kind,
      status: d.status,
      connectivity: d.connectivity,
      lastSeenAt: d.lastSeenAt,
      firstSeenAt: d.firstSeenAt ?? null,
      battery: d.battery ?? null,
      rssi: d.rssi ?? null,
      model: model ? { id: model.id, code: model.code, name: model.name } : null,
      space: d.spaceId ? { id: d.spaceId, name: path[path.length - 1]?.name ?? "", path: path.map((p) => p.name) } : null,
      source: source ? { id: source.id, name: source.name } : null,
      tags: d.tags,
      virtual: d.virtual,
      onboardingComplete: d.status === "ACTIVE",
      metrics: d.latest.map((l) => l.metricKey),
      sourceMeta: d.sourceMeta ?? null,
      version: d.version,
    };
  }

  deviceDetail(d: FakeDevice) {
    const model = this.model(d.modelId);
    const source = this.source(d.sourceId);
    const path = this.spacePath(d.spaceId);
    return {
      id: d.id,
      name: d.name,
      externalId: d.externalId,
      kind: d.kind,
      status: d.status,
      virtual: d.virtual,
      version: d.version,
      source: source ? { id: source.id, name: source.name, type: source.type } : null,
      model: model ? { id: model.id, code: model.code, name: model.name, vendor: model.vendor, capabilities: [] } : null,
      space: d.spaceId ? { id: d.spaceId, name: path[path.length - 1]?.name ?? "", path: path.map((p) => p.name) } : null,
      state: { connectivity: d.connectivity, lastSeenAt: d.lastSeenAt, lastMeasuredAt: d.lastSeenAt, battery: d.battery ?? null, rssi: d.rssi ?? null, snr: 13.5, bestGatewayEui: "24e124fffef79304", msgCount24h: 1440 },
      latest: d.latest,
      effective: { expectedIntervalSec: model?.defaultIntervalSec ?? 600, offlineMultiplier: 3, inheritedFrom: "MODEL" },
      relations: d.spaceId ? [{ spaceId: d.spaceId, relation: "MEASURES", auto: true }] : [],
      onboarding: { firstData: Boolean(d.lastSeenAt), model: Boolean(d.modelId), space: Boolean(d.spaceId), decodeOk: true, rulesApplied: false, complete: false },
      tags: d.tags,
      groups: this.groups.filter((g) => g.memberIds.includes(d.id)).map((g) => ({ id: g.id, name: g.name })),
      logicalDeviceId: null,
      replacedBy: null,
      lorawan: { devEui: d.externalId, joinEui: null, applicationId: null, deviceProfileId: null },
      sourceMeta: d.sourceMeta ?? null,
    };
  }
}

/** 공통 응답 도우미를 다시 내보낸다(핸들러 파일에서 함께 쓰도록) */
export { envelope };
export const noContent = () => new HttpResponse(null, { status: 204 });
