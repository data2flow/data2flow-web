/**
 * Sink 연결·스냅샷·승격 파이프라인·확장 노드·Git 동기화 가짜 API(design/api/FLW-api.md API-FLW-19·50·51·60~73).
 * 상태는 core.extra["flowops"]. 테스트는 `flowopsState(core)`로 상황(의존 객체 누락, 검사 실패, Git 충돌 등)을 바꾼다.
 * 시험 환경(TEST) 플로우 목록·내보내기 참조(API-FLW-01 `environment=TEST`, API-FLW-15)도 여기서 흉내 낸다.
 */
import { fail, list, noContent, ok, type CoreHandler, type CoreState } from "../core-fixtures";

interface FakeSink {
  sinkConnectionId: string;
  name: string;
  type: "POSTGRESQL" | "MYSQL" | "INFLUXDB";
  config: Record<string, unknown>;
  secret: Record<string, string>;
  status: "OK" | "ERROR" | "UNTESTED";
  lastError: string | null;
  usedFlowCount: number;
  version: number;
  updatedAt: string;
}
interface FakeSnapshot {
  snapshotId: string;
  name: string;
  memo: string | null;
  flows: { flowId: string; flowName: string; version: number; hasControlNode?: boolean }[];
  scripts: { scriptId: string; version: number }[];
  createdBy: { userId: string; name: string };
  createdAt: string;
}
interface FakePromotion {
  promotionId: string;
  pipelineId: string;
  snapshotId: string;
  snapshotName: string;
  fromStage: string;
  toStage: string;
  status: "PENDING" | "CHECK_FAILED" | "APPROVED" | "REJECTED" | "APPLIED";
  checks: { name: string; passed: boolean; detail: string | null }[];
  targetMappings: { from: string; to: string }[];
  requestedBy: { userId: string; name: string };
  requestedAt: string;
  decidedBy: { userId: string; name: string } | null;
  decidedAt: string | null;
}
interface FakePackage {
  packageId: string;
  name: string;
  status: "ACTIVE" | "DISABLED";
  versions: { version: string; runtime: "JS_SANDBOX" | "SERVER_PLUGIN"; license: string; signer: string; status: "INSTALLED" | "DISABLED"; installedAt: string }[];
  usedFlowCount: number;
}

export interface FlowopsState {
  seq: number;
  sinks: FakeSink[];
  deadLetters: Record<string, { deadLetterId: string; flowId: string; nodeId: string; target: string; record: Record<string, unknown>; error: string; attempts: number; failedAt: string; expiresAt: string }[]>;
  snapshots: FakeSnapshot[];
  /** 복원할 때 스냅샷이 참조하는 스크립트 버전이 지워짐(SNAPSHOT_DEPENDENCY_MISSING, TC-FLW-236) */
  missingDependency: Set<string>;
  pipelines: { pipelineId: string; name: string; stages: unknown[]; version: number; updatedAt: string }[];
  promotions: FakePromotion[];
  /** 다음 승격 요청의 재생 제어 횟수(검사 상한과 비교, TC-FLW-242) */
  replayCommands: number;
  testFlows: { flowId: string; name: string; environment: "TEST"; activeVersion: number; draftVersion: number | null; hasControlNode: boolean; references: { kind: string; id: string; name: string }[] }[];
  /** 시나리오 조건 실패(FLOW_PROMOTION_BLOCKED reason=SCENARIO_FAILED, TC-FLW-204) */
  failingScenarios: Set<string>;
  packages: FakePackage[];
  git: { repoUrl: string; branch: string; path: string; auth: { type: string; credentialRef: string }; targets: string[]; version: number; updatedBy: { userId: string; name: string }; updatedAt: string } | null;
  /** Git 쪽 변경과 충돌(TC-FLW-254) */
  gitConflicts: string[];
  gitApplied: number;
}

const AT = "2026-10-03T05:10:00Z";

export function flowopsState(core: CoreState): FlowopsState {
  const key = "flowops";
  if (!core.extra[key]) {
    const kim = { userId: "7", name: "김운영" };
    core.extra[key] = {
      seq: 500,
      sinks: [
        { sinkConnectionId: "sc-1", name: "연구실 MySQL", type: "MYSQL", config: { host: "mysql.lab.local", port: 3306, database: "lab", tls: true }, secret: { username: "lab", password: "p" }, status: "OK", lastError: null, usedFlowCount: 1, version: 3, updatedAt: AT },
        { sinkConnectionId: "sc-2", name: "시계열 InfluxDB", type: "INFLUXDB", config: { host: "influx.lab.local", port: 8086, bucket: "env", org: "school", tls: true }, secret: { token: "t" }, status: "ERROR", lastError: "401 unauthorized", usedFlowCount: 0, version: 1, updatedAt: AT },
      ],
      deadLetters: {
        "sc-1": [
          { deadLetterId: "dl-1", flowId: "f-7f3a", nodeId: "n-snk-1", target: "room_temp", record: { space_id: 31, temperature: 28.1 }, error: "Duplicate entry", attempts: 3, failedAt: AT, expiresAt: "2026-10-10T05:10:00Z" },
          { deadLetterId: "dl-2", flowId: "f-7f3a", nodeId: "n-snk-1", target: "room_temp", record: { space_id: 31, temperature: 27.4 }, error: "Lock wait timeout", attempts: 3, failedAt: AT, expiresAt: "2026-10-10T05:10:00Z" },
        ],
      },
      snapshots: [
        { snapshotId: "s1", name: "학기 시작 전", memo: "운영 시작 기준", flows: [{ flowId: "f-7f3a", flowName: "고온이면 냉방", version: 12, hasControlNode: true }, { flowId: "f-co2", flowName: "CO2 환기 자동화", version: 7 }], scripts: [{ scriptId: "s-12", version: 3 }], createdBy: kim, createdAt: "2026-10-03T05:10:00Z" },
        { snapshotId: "s2", name: "냉방 튜닝 후", memo: null, flows: [{ flowId: "f-7f3a", flowName: "고온이면 냉방", version: 14, hasControlNode: true }, { flowId: "f-co2", flowName: "CO2 환기 자동화", version: 7 }], scripts: [{ scriptId: "s-12", version: 4 }], createdBy: { userId: "9", name: "박개발" }, createdAt: "2026-10-05T00:20:00Z" },
      ],
      missingDependency: new Set(),
      pipelines: [
        {
          pipelineId: "default",
          name: "기본",
          stages: [
            { key: "test", env: "TEST", approvers: { userIds: [], roles: [] }, checks: { testRunRequired: false, replayDays: 0, maxCommands: 0, maxNotifications: 0 } },
            { key: "verify", env: "VERIFY", approvers: { userIds: [], roles: ["ADMIN"] }, checks: { testRunRequired: true, replayDays: 1, maxCommands: 100, maxNotifications: 20 } },
            { key: "prod", env: "PROD", approvers: { userIds: [], roles: ["ADMIN"] }, checks: { testRunRequired: true, replayDays: 1, maxCommands: 50, maxNotifications: 20 } },
          ],
          version: 2,
          updatedAt: AT,
        },
      ],
      promotions: [],
      replayCommands: 12,
      testFlows: [
        {
          flowId: "f-test",
          name: "고온이면 냉방(시험)",
          environment: "TEST",
          activeVersion: 5,
          draftVersion: null,
          hasControlNode: true,
          references: [
            { kind: "SPACE", id: "v-31", name: "실습실" },
            { kind: "RELATION", id: "controls/Thermostat", name: "controls/Thermostat" },
            { kind: "DEVICE", id: "v-ac-1", name: "가상 에어컨" },
          ],
        },
      ],
      failingScenarios: new Set(),
      packages: [{ packageId: "p-1", name: "acme.modbus-write", status: "ACTIVE", versions: [{ version: "1.0.0", runtime: "JS_SANDBOX", license: "Apache-2.0", signer: "ACME", status: "INSTALLED", installedAt: AT }], usedFlowCount: 2 }],
      git: null,
      gitConflicts: [],
      gitApplied: 0,
    } satisfies FlowopsState;
  }
  return core.extra[key] as FlowopsState;
}

const denied = () => fail(403, "PERMISSION_DENIED");
const sinkView = (s: FakeSink) => ({ sinkConnectionId: s.sinkConnectionId, name: s.name, type: s.type, config: s.config, status: s.status, lastError: s.lastError, version: s.version, createdAt: AT, updatedAt: s.updatedAt });

/** 연결 테스트 흉내: 호스트 이름으로 결과를 고른다 — `*timeout*` → 502, `*auth*` → 200 ok:false AUTH, `*dns*` → DNS */
function fakeTest(config: Record<string, unknown>) {
  const host = String(config.host ?? "");
  if (host.includes("timeout")) return fail(502, "SINK_CONNECTION_TEST_FAILED", {}, {});
  if (host.includes("auth")) return ok({ ok: false, latencyMs: 40, error: { kind: "AUTH", message: "password authentication failed" } });
  if (host.includes("dns")) return ok({ ok: false, latencyMs: 0, error: { kind: "DNS", message: "unknown host" } });
  return ok({ ok: true, latencyMs: 18 });
}

const SNAPSHOT_NODES: Record<string, { added: string[]; removed: string[]; changed: { nodeId: string; field: string; from: unknown; to: unknown }[] }> = {
  "s1->s2": { added: ["n-dbg-1"], removed: [], changed: [{ nodeId: "n-thr00001", field: "config.value", from: 27, to: 28 }, { nodeId: "n-thr00001", field: "config.for", from: "PT5M", to: "PT10M" }] },
};

export const flowopsHandler: CoreHandler = async (core, req) => {
  const { method, path, url, body, can, user } = req;
  const state = flowopsState(core);
  const b = (body ?? {}) as Record<string, unknown>;
  const now = new Date(Date.parse("2026-10-04T00:00:00Z")).toISOString();

  // ── Sink 연결(API-FLW-50·51) ─────────────────────────────
  if (path === "/sink-connections" || path.startsWith("/sink-connections/")) {
    if (method === "GET" && !can("FLOW_READ")) return denied();
    if (method !== "GET" && !can("SINK_CONNECTION_MANAGE")) return denied();
    if (path === "/sink-connections") {
      if (method === "GET") return list(state.sinks.map((s) => ({ sinkConnectionId: s.sinkConnectionId, name: s.name, type: s.type, status: s.status, lastError: s.lastError, usedFlowCount: s.usedFlowCount, updatedAt: s.updatedAt })), url);
      if (method === "POST") {
        if (state.sinks.some((s) => s.name === b.name)) return fail(409, "SINK_CONNECTION_NAME_DUPLICATED");
        const sink: FakeSink = { sinkConnectionId: `sc-${++state.seq}`, name: String(b.name), type: b.type as FakeSink["type"], config: b.config as Record<string, unknown>, secret: (b.secret ?? {}) as Record<string, string>, status: "UNTESTED", lastError: null, usedFlowCount: 0, version: 1, updatedAt: now };
        state.sinks.push(sink);
        return ok(sinkView(sink), 201, { Location: `/api/v1/core/sink-connections/${sink.sinkConnectionId}` });
      }
    }
    if (path === "/sink-connections/test" && method === "POST") return fakeTest((b.config ?? {}) as Record<string, unknown>);
    const m = /^\/sink-connections\/([^/]+)(\/.*)?$/.exec(path)!;
    const sink = state.sinks.find((s) => s.sinkConnectionId === decodeURIComponent(m[1]));
    if (!sink) return fail(404, "RESOURCE_NOT_FOUND");
    const sub = m[2] ?? "";
    if (sub === "") {
      if (method === "GET") return ok(sinkView(sink));
      if (method === "PATCH") {
        if (b.baseVersion !== sink.version) return fail(409, "VERSION_CONFLICT");
        if (typeof b.name === "string") sink.name = b.name;
        if (b.config) sink.config = b.config as Record<string, unknown>;
        if (b.secret) sink.secret = b.secret as Record<string, string>;
        sink.version += 1;
        return ok(sinkView(sink));
      }
      if (method === "DELETE") {
        if (sink.usedFlowCount > 0) return fail(409, "SINK_CONNECTION_IN_USE");
        state.sinks = state.sinks.filter((s) => s !== sink);
        return noContent();
      }
    }
    if (sub === "/test" && method === "POST") return fakeTest(sink.config);
    if (sub === "/schema" && method === "GET") {
      const target = url.searchParams.get("target");
      return ok(target === "room_temp" ? { exists: true, columns: [{ name: "space_id", type: "bigint" }, { name: "temperature", type: "double" }, { name: "measured_at", type: "timestamp" }] } : { exists: false, columns: [] });
    }
    if (sub === "/dead-letters" && method === "GET") return list(state.deadLetters[sink.sinkConnectionId] ?? [], url);
    if (sub === "/dead-letters/resend" && method === "POST") {
      const all = state.deadLetters[sink.sinkConnectionId] ?? [];
      const ids = b.all ? all.map((d) => d.deadLetterId) : ((b.ids ?? []) as string[]);
      state.deadLetters[sink.sinkConnectionId] = all.filter((d) => !ids.includes(d.deadLetterId));
      return ok({ requested: ids.length, resent: ids.length, failed: 0 });
    }
    return undefined;
  }

  // ── 스냅샷(API-FLW-60~63) ─────────────────────────────
  if (path === "/flow-snapshots" || path.startsWith("/flow-snapshots/")) {
    if (method === "GET" && !can("FLOW_READ")) return denied();
    if (method !== "GET" && !can("FLOW_WRITE")) return denied();
    if (path === "/flow-snapshots" && method === "GET") return list(state.snapshots.map((s) => ({ snapshotId: s.snapshotId, name: s.name, memo: s.memo, flowCount: s.flows.length, createdBy: s.createdBy, createdAt: s.createdAt })).reverse(), url);
    if (path === "/flow-snapshots" && method === "POST") {
      if (state.snapshots.some((s) => s.name === b.name)) return fail(409, "SNAPSHOT_NAME_DUPLICATED");
      const flowIds = (b.flowIds ?? []) as string[];
      const snapshot: FakeSnapshot = { snapshotId: `s${++state.seq}`, name: String(b.name), memo: (b.memo as string) ?? null, flows: flowIds.map((id) => ({ flowId: id, flowName: id, version: 13 })), scripts: [{ scriptId: "s-12", version: 3 }], createdBy: { userId: user.id, name: user.name }, createdAt: now };
      state.snapshots.push(snapshot);
      return ok({ snapshotId: snapshot.snapshotId, items: snapshot.flows.map((f) => ({ flowId: f.flowId, version: f.version })), scripts: snapshot.scripts, subflows: [], variables: {}, sinkConnections: [{ id: "sc-1", name: "연구실 MySQL" }] }, 201, { Location: `/api/v1/core/flow-snapshots/${snapshot.snapshotId}` });
    }
    if (path === "/flow-snapshots/compare" && method === "GET") {
      const a = url.searchParams.get("a");
      const c = url.searchParams.get("b");
      const sa = state.snapshots.find((s) => s.snapshotId === a);
      const sb = state.snapshots.find((s) => s.snapshotId === c);
      if (!sa || !sb) return fail(404, "RESOURCE_NOT_FOUND");
      const nodes = SNAPSHOT_NODES[`${a}->${c}`] ?? { added: [], removed: [], changed: [] };
      return ok({
        flows: [{ flowId: "f-7f3a", flowName: "고온이면 냉방", ...nodes }],
        scripts: sa.scripts.map((s) => ({ scriptId: s.scriptId, from: s.version, to: sb.scripts.find((x) => x.scriptId === s.scriptId)?.version ?? null })),
        subflows: [],
      });
    }
    const m = /^\/flow-snapshots\/([^/]+)(\/restore)?$/.exec(path);
    const snapshot = m && state.snapshots.find((s) => s.snapshotId === decodeURIComponent(m[1]));
    if (!snapshot) return fail(404, "RESOURCE_NOT_FOUND");
    if (!m![2] && method === "GET") return ok({ snapshotId: snapshot.snapshotId, name: snapshot.name, memo: snapshot.memo, flows: snapshot.flows.map(({ flowId, flowName, version }) => ({ flowId, flowName, version })), scripts: snapshot.scripts, subflows: [], variables: { lastAlert: "" }, sinkConnections: [{ sinkConnectionId: "sc-1", name: "연구실 MySQL" }], createdBy: snapshot.createdBy, createdAt: snapshot.createdAt });
    if (m![2] && method === "POST") {
      if (state.missingDependency.has(snapshot.snapshotId)) return fail(409, "SNAPSHOT_DEPENDENCY_MISSING");
      const affected = snapshot.flows.map((f) => ({ flowId: f.flowId, flowName: f.flowName, fromVersion: 14, toVersion: f.version }));
      const control = snapshot.flows.some((f) => f.hasControlNode);
      if (!b.dryRun && control && !can("FLOW_DEPLOY_CONTROL")) return ok({ approvalId: `ap-${++state.seq}` }, 202);
      return ok({ affectedFlows: affected, resetNodeStates: [{ flowId: "f-7f3a", nodeId: "n-dbg-1" }], appliedVersions: b.dryRun ? {} : Object.fromEntries(snapshot.flows.map((f) => [f.flowId, 15])) });
    }
    return undefined;
  }

  // ── 승격 파이프라인(API-FLW-64~66) ─────────────────────────────
  if (path === "/flow-pipelines" && method === "GET") return can("FLOW_READ") ? list(state.pipelines, url) : denied();
  const pipelineMatch = /^\/flow-pipelines\/([^/]+)$/.exec(path);
  if (pipelineMatch) {
    const id = decodeURIComponent(pipelineMatch[1]);
    const pipeline = state.pipelines.find((p) => p.pipelineId === id);
    if (method === "GET") return pipeline ? ok(pipeline) : fail(404, "RESOURCE_NOT_FOUND");
    if (method === "PUT") {
      if (!can("FLOW_APPROVE")) return denied();
      if ((pipeline?.version ?? 0) !== b.baseVersion) return fail(409, "VERSION_CONFLICT");
      const next = { pipelineId: id, name: String(b.name), stages: b.stages as unknown[], version: (pipeline?.version ?? 0) + 1, updatedAt: now };
      state.pipelines = [...state.pipelines.filter((p) => p.pipelineId !== id), next];
      return ok(next);
    }
  }
  if (path === "/flow-promotions") {
    if (method === "GET") return can("FLOW_READ") ? list(state.promotions.filter((p) => !url.searchParams.get("pipelineId") || p.pipelineId === url.searchParams.get("pipelineId")), url) : denied();
    if (method === "POST") {
      if (!can("FLOW_WRITE")) return denied();
      const mappings = (b.targetMappings ?? []) as { from: string; to: string }[];
      if (mappings.length < 2) return fail(409, "FLOW_PROMOTION_BLOCKED", { errors: [{ field: "targetMappings", code: "UNMAPPED", message: "v-ac-1" }] });
      const snapshot = state.snapshots.find((s) => s.snapshotId === b.snapshotId);
      const pipeline = state.pipelines.find((p) => p.pipelineId === b.pipelineId) as { stages: { key: string; checks: { maxCommands: number } }[] } | undefined;
      const limit = pipeline?.stages.find((s) => s.key === b.toStage)?.checks.maxCommands ?? 0;
      const passed = limit === 0 || state.replayCommands <= limit;
      const promotion: FakePromotion = {
        promotionId: `pr-${++state.seq}`,
        pipelineId: String(b.pipelineId),
        snapshotId: String(b.snapshotId),
        snapshotName: snapshot?.name ?? String(b.snapshotId),
        fromStage: String(b.fromStage),
        toStage: String(b.toStage),
        status: passed ? "PENDING" : "CHECK_FAILED",
        checks: [
          { name: "testRun", passed: true, detail: null },
          { name: "replayCommands", passed, detail: `${state.replayCommands} / ${limit}` },
        ],
        targetMappings: mappings,
        requestedBy: { userId: user.id, name: user.name },
        requestedAt: now,
        decidedBy: null,
        decidedAt: null,
      };
      state.promotions.push(promotion);
      return ok({ promotionId: promotion.promotionId, status: promotion.status, checks: promotion.checks }, 201);
    }
  }
  const decide = /^\/flow-promotions\/([^/]+)\/(approve|reject)$/.exec(path);
  if (decide && method === "POST") {
    if (!can("FLOW_APPROVE")) return denied();
    const promotion = state.promotions.find((p) => p.promotionId === decodeURIComponent(decide[1]));
    if (!promotion) return fail(404, "RESOURCE_NOT_FOUND");
    if (promotion.requestedBy.userId === user.id) return fail(403, "FLOW_PROMOTION_SELF_APPROVAL");
    if (promotion.status !== "PENDING") return fail(409, "FLOW_STATE_CONFLICT");
    promotion.status = decide[2] === "approve" ? "APPLIED" : "REJECTED";
    promotion.decidedBy = { userId: user.id, name: user.name };
    promotion.decidedAt = now;
    return ok(promotion);
  }

  // ── 시험 플로우 승격(API-FLW-01 environment=TEST, API-FLW-15 내보내기, API-FLW-19) ───────
  if (path === "/flows" && method === "GET" && url.searchParams.get("environment") === "TEST") {
    return can("FLOW_READ") ? list(state.testFlows.map(({ references: _r, ...f }) => ({ ...f, kind: "FLOW", status: "ACTIVE", spaceIds: ["v-31"] })), url) : denied();
  }
  const testFlow = /^\/flows\/([^/]+)\/(export|promote)$/.exec(path);
  if (testFlow) {
    const flow = state.testFlows.find((f) => f.flowId === decodeURIComponent(testFlow[1]));
    if (!flow) return undefined;
    if (testFlow[2] === "export" && method === "GET") return can("FLOW_READ") ? Response.json({ schema: "data2flow.flow-export/v1", flow: { name: flow.name }, definition: {}, references: flow.references, subflows: [] }) : denied();
    if (testFlow[2] === "promote" && method === "POST") {
      if (!can("FLOW_WRITE")) return denied();
      const mappings = (b.mappings ?? []) as { kind: string; sourceId: string; targetId: string }[];
      const needed = flow.references.filter((r) => r.kind !== "RELATION");
      const missing = needed.filter((r) => !mappings.some((m) => m.kind === r.kind && m.sourceId === r.id && m.targetId));
      if (missing.length > 0) return fail(409, "FLOW_PROMOTION_BLOCKED", { errors: missing.map((r) => ({ field: `mappings[${r.kind}:${r.id}]`, code: "UNMAPPED", message: r.name })) });
      if (b.scenarioId && state.failingScenarios.has(String(b.scenarioId))) return fail(409, "FLOW_PROMOTION_BLOCKED", { errors: [{ field: "scenarioId", code: "SCENARIO_FAILED", message: "SCENARIO_FAILED" }] });
      return ok(flow.hasControlNode ? { approvalId: `ap-${++state.seq}`, targetFlowId: null } : { targetFlowId: `f-${++state.seq}` });
    }
    return undefined;
  }

  // ── 확장 노드 패키지(API-FLW-70~73) ─────────────────────────────
  if (path === "/node-packages" || path.startsWith("/node-packages/")) {
    if (method === "GET") return can("FLOW_READ") ? list(state.packages, url) : denied();
    if (!can("NODE_PACKAGE_MANAGE")) return denied();
    let source = "";
    if ((req.request.headers.get("content-type") ?? "").includes("multipart")) {
      const form = await req.request.formData();
      const file = form.get("file");
      source = file instanceof File ? file.name : "";
    } else source = String(b.registryUrl ?? "");
    const inspect = () => {
      if (source.includes("unsigned")) return fail(400, "NODE_PACKAGE_SIGNATURE_INVALID");
      if (source.includes("agpl")) return fail(400, "NODE_PACKAGE_LICENSE_REJECTED");
      if (source.includes("broken")) return fail(400, "NODE_PACKAGE_INVALID");
      return undefined;
    };
    if (path === "/node-packages" && method === "POST") {
      const rejected = inspect();
      if (rejected) return rejected;
      const name = /([a-z]+\.[a-z]+(?:-[a-z]+)*)/.exec(source)?.[1] ?? "acme.new-node";
      const pkg: FakePackage = { packageId: `p-${++state.seq}`, name, status: "ACTIVE", versions: [{ version: "1.0.0", runtime: "JS_SANDBOX", license: "Apache-2.0", signer: "ACME", status: "INSTALLED", installedAt: now }], usedFlowCount: 0 };
      state.packages.push(pkg);
      return ok({ packageId: pkg.packageId, name, version: "1.0.0", runtime: "JS_SANDBOX", license: "Apache-2.0", signer: "ACME", status: "INSTALLED", nodeTypes: [`${name}/write`], installedBy: { userId: user.id, name: user.name }, installedAt: now }, 201);
    }
    const m = /^\/node-packages\/([^/]+)\/(versions|disable|enable)$/.exec(path);
    const pkg = m && state.packages.find((p) => p.name === decodeURIComponent(m[1]));
    if (!pkg) return fail(404, "RESOURCE_NOT_FOUND");
    if (m![2] === "versions") {
      const rejected = inspect();
      if (rejected) return rejected;
      const version = `${pkg.versions.length + 1}.0.0`;
      pkg.versions.push({ version, runtime: "JS_SANDBOX", license: "Apache-2.0", signer: "ACME", status: "INSTALLED", installedAt: now });
      return ok({ packageId: pkg.packageId, name: pkg.name, version, runtime: "JS_SANDBOX", license: "Apache-2.0", signer: "ACME", status: "INSTALLED", nodeTypes: [`${pkg.name}/write`], installedBy: { userId: user.id, name: user.name }, installedAt: now }, 201);
    }
    pkg.status = m![2] === "disable" ? "DISABLED" : "ACTIVE";
    return ok({ packageId: pkg.packageId, name: pkg.name, status: pkg.status, usedFlowCount: pkg.usedFlowCount });
  }

  // ── Git 동기화(API-FLW-67~69) ─────────────────────────────
  if (path === "/git-sync" || path.startsWith("/git-sync/")) {
    if (!can("GIT_SYNC_MANAGE")) return denied();
    if (path === "/git-sync" && method === "GET") return state.git ? ok(state.git) : fail(404, "RESOURCE_NOT_FOUND");
    if (path === "/git-sync" && method === "PUT") {
      if ((state.git?.version ?? 0) !== b.baseVersion) return fail(409, "VERSION_CONFLICT");
      state.git = { repoUrl: String(b.repoUrl), branch: String(b.branch), path: String(b.path), auth: b.auth as { type: string; credentialRef: string }, targets: b.targets as string[], version: (state.git?.version ?? 0) + 1, updatedBy: { userId: user.id, name: user.name }, updatedAt: now };
      return ok(state.git);
    }
    if (path === "/git-sync/test" && method === "POST") {
      if (String(b.repoUrl).includes("unreachable")) return fail(502, "GIT_SYNC_REPO_UNREACHABLE");
      return ok({ ok: true, latencyMs: 120, headCommit: "a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0", error: null });
    }
    if (path === "/git-sync/export" && method === "POST") return ok({ commit: "0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c", files: ["flows/hot-then-cool.yaml", "flows/co2.yaml", "scripts/em300.js", "scripts/em300.meta.yaml"] });
    if (path === "/git-sync/import" && method === "POST") {
      const preview = {
        changes: [{ objectKey: "flows/hot-then-cool.yaml", kind: "UPDATE", summary: "n-thr-1 value 27→28" }],
        conflicts: state.gitConflicts.map((objectKey) => ({ objectKey, platformUpdatedAt: "2026-10-03T05:00:00Z", gitCommit: "9f8e7d6c5b4a" })),
        errors: [{ file: "flows/broken.yaml", line: 12, code: "FLOW_VALIDATION_FAILED" }],
      };
      if (b.dryRun) return ok(preview);
      const resolutions = (b.resolutions ?? []) as { objectKey: string }[];
      if (state.gitConflicts.some((k) => !resolutions.some((r) => r.objectKey === k))) return fail(409, "GIT_SYNC_CONFLICT");
      state.gitApplied += 1;
      return ok({ ...preview, conflicts: [] });
    }
  }
  return undefined;
};
