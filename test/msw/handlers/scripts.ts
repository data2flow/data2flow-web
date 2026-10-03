/**
 * 정제 스크립트 가짜 API(design/api/SCR-api.md API-SCR-01~08, 15). 상태는 core.scripts와 core.extra["scripts.versions"].
 */
import { HttpResponse } from "msw";
import { fail, list, noContent, ok, type CoreHandler, type CoreState, type FakeScript } from "../core-fixtures";

interface FakeVersion {
  versionId: string;
  versionNo: number;
  status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  code: string;
  staticCheck: { ok: boolean; problems: { line: number; col: number; severity: "ERROR" | "WARNING"; code: string; message: string }[] };
  deployMemo?: string | null;
  deployedBy?: string | null;
  deployedAt?: string | null;
  savedBy: string;
  savedAt: string;
  forced?: boolean;
}

const FORBIDDEN = ["require", "fetch", "eval", "Function", "setTimeout", "setInterval", "XMLHttpRequest", "WebSocket", "load"];

/** 정적 검사 흉내(API-SCR-07): 금지 API 줄·열, 필수 함수, debugger는 경고 */
export function fakeCheck(kind: string, code: string) {
  const problems: FakeVersion["staticCheck"]["problems"] = [];
  code.split("\n").forEach((line, index) => {
    for (const name of FORBIDDEN) {
      const match = new RegExp(`\\b${name}\\s*\\(`).exec(line);
      if (match) problems.push({ line: index + 1, col: match.index + 1, severity: "ERROR", code: "SCRIPT_FORBIDDEN_API", message: `금지된 API: ${name}` });
    }
    const debug = /\bdebugger\b/.exec(line);
    if (debug) problems.push({ line: index + 1, col: debug.index + 1, severity: "WARNING", code: "SCRIPT_DEBUGGER", message: "debugger 문은 무시됩니다" });
  });
  const fn = kind === "DECODE" ? "decode" : "transform";
  if (!new RegExp(`function\\s+${fn}\\s*\\(`).test(code)) problems.push({ line: 1, col: 1, severity: "ERROR", code: "SCRIPT_FUNCTION_MISSING", message: `${fn}(msg, ctx) 함수가 필요합니다` });
  return { ok: !problems.some((p) => p.severity === "ERROR"), problems };
}

const TRANSFORM_CODE = `/** @param {CanonicalMessage} msg @param {ScriptContext} ctx */\nfunction transform(msg, ctx) {\n  const t = msg.metrics.find((m) => m.key === "temperature");\n  if (t) t.value += ctx.config.tempOffset;\n  return msg;\n}\n`;
const DECODE_CODE = `/** @param {RawMessage} msg @param {ScriptContext} ctx */\nfunction decode(msg, ctx) {\n  return { externalId: msg.topic.split("/")[1], measuredAt: msg.receivedAt, metrics: [] };\n}\n`;

const TEMPLATES = [
  { key: "calibration-offset", kind: "TRANSFORM", name: "보정 오프셋", description: "측정값에 설정한 값을 더합니다", code: TRANSFORM_CODE, configDefaults: { tempOffset: 0 } },
  { key: "dew-point", kind: "TRANSFORM", name: "이슬점", description: "온도·습도로 dew_point를 만듭니다", code: TRANSFORM_CODE, configDefaults: {} },
  { key: "milesight-decoder", kind: "DECODE", name: "Milesight 디코더", description: "Milesight 바이트 페이로드 해석", code: DECODE_CODE, configDefaults: {} },
];

const seeded = new WeakSet<CoreState>();

function versionsOf(core: CoreState): Map<string, FakeVersion[]> {
  const key = "scripts.versions";
  if (!core.extra[key]) core.extra[key] = new Map<string, FakeVersion[]>();
  return core.extra[key] as Map<string, FakeVersion[]>;
}

function seed(core: CoreState) {
  if (seeded.has(core)) return;
  seeded.add(core);
  if (core.scripts.length > 0) return;
  const versions = versionsOf(core);
  const v4: FakeVersion = { versionId: "804", versionNo: 4, status: "ACTIVE", code: TRANSFORM_CODE, staticCheck: { ok: true, problems: [] }, deployMemo: "오프셋 설정값으로 분리", deployedBy: "이통합", deployedAt: "2026-10-02T08:40:00Z", savedBy: "이통합", savedAt: "2026-10-02T08:30:00Z" };
  const v5: FakeVersion = { versionId: "805", versionNo: 5, status: "DRAFT", code: TRANSFORM_CODE.replace("return msg;", "return msg; // v5"), staticCheck: { ok: true, problems: [] }, savedBy: "이통합", savedAt: "2026-10-03T01:02:00Z" };
  core.scripts.push({
    id: "501",
    name: "온도 보정 오프셋",
    kind: "TRANSFORM",
    status: "ENABLED",
    description: "EM300-TH 온도 보정",
    activeVersion: { versionId: v4.versionId, versionNo: 4, code: v4.code, deployedAt: v4.deployedAt!, deployMemo: v4.deployMemo! },
    draft: { versionId: v5.versionId, versionNo: 5, code: v5.code, staticCheck: v5.staticCheck },
    bindings: [{ targetType: "MODEL", targetId: "11", name: "EM300-TH", failurePolicy: "FAIL_OPEN" }],
    version: 7,
  });
  versions.set("501", [v5, v4]);
}

function summary(core: CoreState, s: FakeScript) {
  const count = (type: string) => s.bindings.filter((b) => b.targetType === type).length;
  return {
    id: s.id,
    name: s.name,
    kind: s.kind,
    status: s.status,
    activeVersion: s.activeVersion ? s.activeVersion.versionNo : null,
    hasDraft: Boolean(s.draft),
    bindingsSummary: { sources: count("SOURCE"), models: count("MODEL"), devices: count("DEVICE"), first: s.bindings[0]?.name ?? null },
    stats24h: { processed: s.activeVersion ? 17280 : 0, errorRate: s.kind === "DECODE" ? 0.121 : 0, p95Ms: 0.3 },
    lastDeployedBy: s.activeVersion ? "이통합" : null,
    lastDeployedAt: s.activeVersion?.deployedAt ?? null,
    checkFailed: s.draft ? !s.draft.staticCheck.ok : false,
  };
}

function detail(core: CoreState, s: FakeScript) {
  const versions = versionsOf(core).get(s.id) ?? [];
  return {
    ...summary(core, s),
    description: s.description ?? null,
    activeVersionId: s.activeVersion?.versionId ?? null,
    draftVersionId: s.draft?.versionId ?? null,
    activeVersion: s.activeVersion,
    draft: s.draft,
    versions: versions.map((v) => ({ versionId: v.versionId, versionNo: v.versionNo, status: v.status, savedBy: v.savedBy, savedAt: v.savedAt, deployMemo: v.deployMemo ?? null, deployedBy: v.deployedBy ?? null, deployedAt: v.deployedAt ?? null, staticCheck: v.staticCheck, forced: Boolean(v.forced) })),
    bindings: s.bindings,
    usage: { bindings: s.bindings.map((b) => ({ ...b, deviceCount: 3, processed24h: 17280 })), flowNodes: [] },
    config: { tempOffset: -0.5 },
    version: s.version,
  };
}

export const scriptsHandler: CoreHandler = (core, { method, path, url, body, can, user }) => {
  if (!path.startsWith("/scripts")) return undefined;
  seed(core);
  if (!can("SCRIPT_READ")) return fail(403, "PERMISSION_DENIED");
  const write = () => (can("SCRIPT_WRITE") ? undefined : fail(403, "PERMISSION_DENIED"));
  const b = (body ?? {}) as Record<string, unknown>;

  if (path === "/scripts" && method === "GET") {
    const kind = url.searchParams.get("kind");
    const status = url.searchParams.get("status");
    const keyword = url.searchParams.get("keyword")?.toLowerCase();
    const checkFailed = url.searchParams.get("checkFailed") === "true";
    const items = core.scripts.filter((s) => (!kind || s.kind === kind) && (!status || s.status === status) && (!keyword || s.name.toLowerCase().includes(keyword)) && (!checkFailed || (s.draft && !s.draft.staticCheck.ok)));
    return list(items.map((s) => summary(core, s)), url);
  }
  if (path === "/scripts/templates" && method === "GET") {
    const kind = url.searchParams.get("kind");
    return list(TEMPLATES.filter((tpl) => !kind || tpl.kind === kind), url);
  }
  if (path === "/scripts" && method === "POST") {
    const denied = write();
    if (denied) return denied;
    const name = String(b.name ?? "").trim();
    if (name.length < 2 || name.length > 80) return fail(400, "INVALID_REQUEST", { errors: [{ field: "name", code: "SIZE", message: "2~80" }] });
    if (core.scripts.some((s) => s.name === name)) return fail(409, "SCRIPT_NAME_DUPLICATED");
    if (core.scripts.length >= 300) return fail(409, "SCRIPT_QUOTA_EXCEEDED");
    const kind = b.kind === "DECODE" ? "DECODE" : "TRANSFORM";
    const template = TEMPLATES.find((tpl) => tpl.key === b.templateKey);
    const code = template?.code ?? (kind === "DECODE" ? DECODE_CODE : TRANSFORM_CODE);
    const id = core.nextId();
    const versionId = core.nextId();
    const bindings = ((b.bindings as { targetType: string; targetId: string; failurePolicy?: string }[] | undefined) ?? []).map((x) => ({ targetType: x.targetType, targetId: String(x.targetId), name: String(x.targetId), failurePolicy: x.failurePolicy ?? "FAIL_OPEN" }));
    const staticCheck = fakeCheck(kind, code);
    core.scripts.push({ id, name, kind, status: "ENABLED", description: (b.description as string) ?? null, activeVersion: null, draft: { versionId, versionNo: 1, code, staticCheck }, bindings, version: 1 });
    versionsOf(core).set(id, [{ versionId, versionNo: 1, status: "DRAFT", code, staticCheck, savedBy: user.name, savedAt: "2026-10-04T00:00:00Z" }]);
    return ok({ id, name, kind, status: "ENABLED", draftVersionId: versionId, version: 1 }, 201, { Location: `/api/v1/core/scripts/${id}` });
  }
  if (path === "/scripts/check" && method === "POST") {
    const denied = write();
    if (denied) return denied;
    return ok(fakeCheck(String(b.kind), String(b.code ?? "")));
  }
  if (path === "/scripts/test-run" && method === "POST") {
    const denied = write();
    if (denied) return denied;
    const code = String(b.code ?? "");
    if (/while\s*\(\s*true\s*\)/.test(code)) {
      return ok({ ok: false, output: null, diff: { added: [], removed: [], changed: [] }, logs: [], durationMs: 50, outputBytes: 0, error: { code: "SCRIPT_TIMEOUT", message: "실행 시간 50ms를 넘었습니다", line: 2, col: 3 } });
    }
    const input = (b.input ?? { metrics: [{ key: "temperature", value: 22.3 }] }) as { metrics?: { key: string; value: number }[] };
    const metrics = (input.metrics ?? []).map((m) => ({ ...m }));
    const temperature = metrics.find((m) => m.key === "temperature");
    const changed = temperature ? [{ key: "temperature", from: temperature.value, to: Math.round((temperature.value + 0.5) * 10) / 10 }] : [];
    if (temperature) temperature.value = changed[0].to as number;
    const output = { ...input, metrics: [...metrics, { key: "dew_point", value: 9.4 }] };
    return ok({
      ok: true,
      output,
      diff: { added: [{ key: "dew_point", value: 9.4 }], removed: [], changed },
      logs: [{ at: "2026-10-04T00:00:00Z", message: "offset applied" }, { at: "2026-10-04T00:00:00Z", message: "offset applied" }, { at: "2026-10-04T00:00:00Z", message: "offset applied" }, { at: "2026-10-04T00:00:00Z", message: "done" }],
      durationMs: 0.4,
      outputBytes: JSON.stringify(output).length,
      error: null,
    });
  }

  const match = /^\/scripts\/(\d+)(\/.*)?$/.exec(path);
  if (!match) return undefined;
  const script = core.scripts.find((s) => s.id === match[1]);
  if (!script) return fail(404, "RESOURCE_NOT_FOUND");
  const rest = match[2] ?? "";
  const versions = versionsOf(core).get(script.id) ?? [];

  if (rest === "" && method === "GET") return ok(detail(core, script));
  if (rest === "" && method === "PATCH") {
    const denied = write();
    if (denied) return denied;
    if (b.baseVersion !== script.version) return fail(409, "SCRIPT_VERSION_CONFLICT");
    if (typeof b.name === "string") script.name = b.name;
    script.version += 1;
    return ok(detail(core, script));
  }
  if (rest === "" && method === "DELETE") {
    const denied = write();
    if (denied) return denied;
    if (script.activeVersion) return fail(409, "SCRIPT_IN_USE");
    core.scripts.splice(core.scripts.indexOf(script), 1);
    return noContent();
  }
  if (rest === "/draft" && method === "PUT") {
    const denied = write();
    if (denied) return denied;
    const code = String(b.code ?? "");
    if (code.length > 64 * 1024) return fail(400, "SCRIPT_CODE_TOO_LARGE");
    const latest = Math.max(0, ...versions.map((v) => v.versionNo));
    if (Number(b.baseVersionNo) !== latest) return fail(409, "SCRIPT_VERSION_CONFLICT");
    const staticCheck = fakeCheck(script.kind, code);
    let draft = versions.find((v) => v.status === "DRAFT");
    if (draft) Object.assign(draft, { code, staticCheck, savedBy: user.name });
    else {
      draft = { versionId: core.nextId(), versionNo: latest + 1, status: "DRAFT", code, staticCheck, savedBy: user.name, savedAt: "2026-10-04T00:00:00Z" };
      versions.unshift(draft);
    }
    script.draft = { versionId: draft.versionId, versionNo: draft.versionNo, code, staticCheck };
    return ok({ versionId: draft.versionId, versionNo: draft.versionNo, staticCheck });
  }
  if (rest === "/deploy" && method === "POST") {
    const denied = write();
    if (denied) return denied;
    if (b.force && !can("SCRIPT_FORCE_DEPLOY")) return fail(403, "PERMISSION_DENIED");
    const memo = String(b.memo ?? "").trim();
    if (memo.length < 2 || memo.length > 200) return fail(400, "INVALID_REQUEST", { errors: [{ field: "memo", code: "SIZE", message: "2~200" }] });
    if (String(b.baseActiveVersionId ?? "") !== String(script.activeVersion?.versionId ?? "")) return fail(409, "SCRIPT_VERSION_CONFLICT");
    const target = versions.find((v) => v.versionId === String(b.versionId));
    if (!target) return fail(404, "RESOURCE_NOT_FOUND");
    if (!target.staticCheck.ok && !b.force) return fail(400, "SCRIPT_STATIC_CHECK_FAILED");
    for (const v of versions) if (v.status === "ACTIVE") v.status = "ARCHIVED";
    Object.assign(target, { status: "ACTIVE", deployMemo: memo, deployedBy: user.name, deployedAt: "2026-10-04T00:00:00Z", forced: Boolean(b.force) });
    script.activeVersion = { versionId: target.versionId, versionNo: target.versionNo, code: target.code, deployedAt: "2026-10-04T00:00:00Z", deployMemo: memo };
    if (script.draft?.versionId === target.versionId) script.draft = null;
    return ok({ activeVersionId: target.versionId, applied: { reported: 2, total: 2, instances: [{ name: "pipeline-0", appliedAt: "2026-10-04T00:00:02Z" }, { name: "pipeline-1", appliedAt: "2026-10-04T00:00:03Z" }] }, testResult: { passed: 0, failed: 0 } });
  }
  const versionMatch = /^\/versions\/(\d+)$/.exec(rest);
  if (versionMatch && method === "GET") {
    const v = versions.find((x) => x.versionId === versionMatch[1]);
    if (!v) return fail(404, "RESOURCE_NOT_FOUND");
    return ok({ versionNo: v.versionNo, status: v.status, code: v.code, staticCheck: v.staticCheck, deployMemo: v.deployMemo ?? null, deployedBy: v.deployedBy ?? null, deployedAt: v.deployedAt ?? null, forced: Boolean(v.forced) });
  }
  return HttpResponse.json({ header: { isSuccessful: false, resultCode: "RESOURCE_NOT_FOUND", resultMessage: "" } }, { status: 404 });
};
