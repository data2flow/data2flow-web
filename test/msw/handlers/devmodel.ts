/**
 * 가짜 core M5 기기·모델 데이터 관리 API(design/api/DEV-api.md, core 컨트롤러 모양):
 * 검색식 실행 API-DEV-133(`GET /devices?q=` → counts{total,tookMs}, 400 DEVICE_QUERY_INVALID + response{column,message}),
 * 저장된 검색 API-DEV-134, 모델 내보내기·가져오기 API-DEV-44·45, 표준 형식 내보내기 API-DEV-135, NGSI-LD 주기 전송 API-DEV-136,
 * 출력 연결 목록(API-DSC-30), 게이트웨이 API-DEV-60~62, 조직 단위 API-DEV-57.
 */
import { HttpResponse } from "msw";
import { looksLikeExpression, parseDeviceQuery, type QueryNode } from "../../../app/features/devmodel/model/query";
import { envelope, fail, list, noContent, ok, type CoreHandler, type CoreState, type FakeDevice } from "../core-fixtures";

export interface DevModelState {
  saved: { id: string; name: string; query: string; shared: boolean; ownerId: string; ownerName: string; updatedAt: string }[];
  orgTemperatureUnit: "C" | "F";
  unitsVersion: number;
  jobs: Record<string, { id: string; format: string; status: string; polls: number; report: Record<string, unknown> }>;
  /** 작업이 끝나기 전에 조회해야 하는 횟수(진행 표시 시험) */
  jobPollsBeforeDone: number;
  pushes: { id: string; outputConnectionId: string; scope: { spaceIds: string[]; deviceIds: string[] }; intervalSec: number; enabled: boolean; lastSentAt: null; lastError: null }[];
  gateways: { id: string; gatewayEui: string; name: string; source: { id: string; name: string }; space: { id: string; name: string } | null; status: string; lastSeenAt: string; offlineAfterSec: number; deviceCount24h: number; uplinks24h: number; updatedAt: string }[];
  imports: { dryRun: boolean; format: string | null; createMissingMetrics: string | null; fileName: string }[];
  seq: number;
}

export function devModelState(core: CoreState): DevModelState {
  core.extra.devmodel ??= {
    saved: [{ id: "501", name: "배터리 부족", query: "battery < 20", shared: true, ownerId: "1", ownerName: "홍길동", updatedAt: "2026-10-03T00:00:00Z" }],
    orgTemperatureUnit: "C",
    unitsVersion: 1,
    jobs: {},
    jobPollsBeforeDone: 0,
    pushes: [],
    gateways: [
      { id: "71", gatewayEui: "24e124fffef79304", name: "UG65-F79304", source: { id: "7", name: "ChirpStack s3" }, space: { id: "3", name: "3층" }, status: "ONLINE", lastSeenAt: "2026-10-03T23:59:55Z", offlineAfterSec: 300, deviceCount24h: 9, uplinks24h: 1296, updatedAt: "2026-10-01T00:00:00Z" },
      { id: "72", gatewayEui: "24e124fffef5dccc", name: "UG65-F5DCCC", source: { id: "7", name: "ChirpStack s3" }, space: null, status: "OFFLINE", lastSeenAt: "2026-10-03T22:00:00Z", offlineAfterSec: 300, deviceCount24h: 7, uplinks24h: 640, updatedAt: "2026-10-01T00:00:00Z" },
    ],
    imports: [],
    seq: 900,
  } satisfies DevModelState;
  return core.extra.devmodel as DevModelState;
}

/** 검색식 평가(시험용으로 필요한 필드만): model·space·status·tag·name·battery·rssi·connectivity·virtual */
function matches(core: CoreState, d: FakeDevice, node: QueryNode): boolean {
  if (node.node === "and") return node.items.every((n) => matches(core, d, n));
  if (node.node === "or") return node.items.some((n) => matches(core, d, n));
  if (node.node === "not") return !matches(core, d, node.item);
  const values = node.values.map((v) => v.toLowerCase());
  const text = (actual: string[]) => {
    const lower = actual.map((a) => a.toLowerCase());
    if (node.op === "~") return lower.some((a) => values.some((v) => a.includes(v)));
    const hit = lower.some((a) => values.includes(a));
    return node.op === "!=" ? !hit : hit;
  };
  const num = (actual: number | null | undefined) => {
    if (actual === null || actual === undefined) return false;
    const v = Number(node.values[0]);
    return { "=": actual === v, "!=": actual !== v, "<": actual < v, "<=": actual <= v, ">": actual > v, ">=": actual >= v }[node.op] ?? false;
  };
  switch (node.field) {
    case "model": {
      const m = core.model(d.modelId);
      return text(m ? [m.code, m.name] : []);
    }
    case "space":
      return text(core.spacePath(d.spaceId).map((s) => s.name));
    case "status":
      return text([d.status]);
    case "connectivity":
      return text([d.connectivity]);
    case "tag":
      return text(d.tags);
    case "name":
      return text([d.name]);
    case "battery":
      return num(d.battery);
    case "rssi":
      return num(d.rssi);
    case "virtual":
      return text([String(d.virtual)]);
    default:
      return false;
  }
}

const now = () => "2026-10-04T00:00:00Z";

export const devModelHandler: CoreHandler = async (core, { method, path, url, body, can, user, request }) => {
  const s = devModelState(core);
  const b = (body ?? {}) as Record<string, unknown>;

  // API-DEV-133 검색식(키워드 검색은 기존 기기 핸들러로 넘긴다)
  if (path === "/devices" && method === "GET" && looksLikeExpression(url.searchParams.get("q"))) {
    const q = url.searchParams.get("q") as string;
    const parsed = parseDeviceQuery(q);
    if (!parsed.ok) {
      return HttpResponse.json({ ...envelope({ column: parsed.column, message: "값이 필요합니다" }, "DEVICE_QUERY_INVALID"), errors: [{ field: "q", code: "SYNTAX", message: "값이 필요합니다" }] }, { status: 400 });
    }
    if (q.includes("slow")) return fail(400, "DEVICE_QUERY_TIMEOUT");
    const items = core.devices.filter((d) => matches(core, d, parsed.ast)).map((d) => core.deviceSummary(d));
    return list(items, url, { counts: { total: items.length, tookMs: 84 } });
  }

  // API-DEV-134 저장된 검색(조회 DEV_READ, 저장 DEV_PLACE)
  if (path === "/saved-searches") {
    if (method === "GET") return list(s.saved.filter((x) => x.shared || x.ownerId === user.id), url);
    if (method === "POST") {
      if (!can("DEV_PLACE")) return fail(403, "PERMISSION_DENIED");
      const parsed = parseDeviceQuery(String(b.query ?? ""));
      if (!parsed.ok) return fail(400, "DEVICE_QUERY_INVALID");
      const item = { id: String(++s.seq), name: String(b.name), query: String(b.query), shared: Boolean(b.shared), ownerId: user.id, ownerName: user.name, updatedAt: now() };
      s.saved.push(item);
      return ok(item, 201, { Location: `/api/v1/core/saved-searches/${item.id}` });
    }
  }
  const savedMatch = /^\/saved-searches\/(\d+)$/.exec(path);
  if (savedMatch) {
    const item = s.saved.find((x) => x.id === savedMatch[1]);
    if (!item) return fail(404, "RESOURCE_NOT_FOUND");
    if (method === "GET") return ok(item);
    if (item.ownerId !== user.id && !can("DEV_ADMIN")) return fail(403, "PERMISSION_DENIED");
    if (method === "PUT") {
      Object.assign(item, { name: String(b.name), query: String(b.query), shared: Boolean(b.shared), updatedAt: now() });
      return ok(item);
    }
    if (method === "DELETE") {
      s.saved = s.saved.filter((x) => x !== item);
      return noContent();
    }
  }

  // API-DEV-44 모델 내보내기
  const exportMatch = /^\/device-models\/([^/]+)\/export$/.exec(path);
  if (exportMatch && method === "GET") {
    const model = core.model(exportMatch[1]);
    if (!model) return fail(404, "RESOURCE_NOT_FOUND");
    const format = url.searchParams.get("format") ?? "data2flow";
    if (format === "dtdl") return ok({ "@id": `dtmi:data2flow:${model.code.replace(/[^A-Za-z0-9]/g, "_")};1`, "@type": "Interface", "@context": "dtmi:dtdl:context;3", contents: model.metrics.map((m) => ({ "@type": "Telemetry", name: m.key })) });
    return ok({ format: "data2flow", version: 1, model: { code: model.code, name: model.name, vendor: model.vendor }, metrics: model.metrics });
  }
  // API-DEV-45 모델 가져오기(multipart)
  if (path === "/device-models/import" && method === "POST") {
    if (!can("DEV_ADMIN")) return fail(403, "PERMISSION_DENIED");
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return fail(400, "INVALID_REQUEST");
    const doc = JSON.parse(await file.text()) as { model?: { code?: string; name?: string }; "@id"?: string; displayName?: string };
    const dryRun = form.get("dryRun") === "true";
    s.imports.push({ dryRun, format: form.get("format") as string | null, createMissingMetrics: form.get("createMissingMetrics") as string | null, fileName: file.name });
    const dtdl = Boolean(doc["@id"]);
    const code = dtdl ? "DTDL-THERMO" : (doc.model?.code ?? "IMPORTED");
    if (core.models.some((m) => m.code === code)) return fail(409, "MODEL_CODE_DUPLICATE");
    const result = {
      dryRun,
      format: dtdl ? "dtdl" : "data2flow",
      model: dryRun ? null : { id: String(++s.seq), code, name: doc.displayName ?? doc.model?.name ?? code },
      createdMetrics: ["vibration"],
      unmapped: dtdl ? [{ path: "contents[2]", type: "Command", reason: "명령은 기능(Capability)으로 직접 연결하세요" }] : [],
      scripts: [],
    };
    if (!dryRun) core.models.push({ id: result.model?.id as string, code, vendor: "Imported", name: result.model?.name as string, protocol: "MQTT", kind: "SENSOR", defaultIntervalSec: 600, builtin: false, status: "ACTIVE", metrics: [{ key: "vibration", required: true }], capabilities: [], version: 1 } as never);
    return ok(result, dryRun ? 200 : 201);
  }

  // API-DEV-135 표준 형식 내보내기
  if (path === "/devices/export-standard" && method === "POST") {
    if (!can("DEV_ADMIN")) return fail(403, "PERMISSION_DENIED");
    const scope = (b.scope ?? {}) as { deviceIds?: string[]; spaceIds?: string[] };
    if (!["DTDL", "NGSI_LD", "BRICK_TTL", "BRICK_JSONLD"].includes(String(b.format))) return fail(400, "INVALID_REQUEST");
    const ids = scope.deviceIds ?? [];
    if (!ids.length && !(scope.spaceIds ?? []).length) return fail(400, "EXPORT_INVALID_REQUEST");
    const id = String(++s.seq);
    const skipped = ids.filter((d) => d !== "1042").map((deviceId) => ({ deviceId, type: "Device", reason: "태그 없는 점" }));
    s.jobs[id] = { id, format: String(b.format), status: s.jobPollsBeforeDone > 0 ? "RUNNING" : "DONE", polls: 0, report: { exported: Math.max(1, ids.length - skipped.length), skipped } };
    return ok({ jobId: id, status: s.jobs[id].status }, 202);
  }
  const jobMatch = /^\/export-jobs\/(\d+)(\/file)?$/.exec(path);
  if (jobMatch && method === "GET") {
    const job = s.jobs[jobMatch[1]];
    if (!job) return fail(404, "RESOURCE_NOT_FOUND");
    if (jobMatch[2]) return new HttpResponse('{"@context":"https://uri.etsi.org/ngsi-ld/v1/ngsi-ld-core-context.jsonld"}', { headers: { "Content-Type": "application/ld+json", "Content-Disposition": `attachment; filename="data2flow-${job.format.toLowerCase()}-${job.id}.jsonld"` } });
    job.polls += 1;
    if (job.status === "RUNNING" && job.polls > s.jobPollsBeforeDone) job.status = "DONE";
    return ok({ id: job.id, format: job.format, status: job.status, downloadUrl: job.status === "DONE" ? `/api/v1/core/export-jobs/${job.id}/file` : null, report: job.status === "DONE" ? job.report : null, createdAt: now(), updatedAt: now() });
  }
  // API-DEV-136 NGSI-LD 주기 전송
  if (path === "/ngsi-pushes") {
    if (!can("DEV_ADMIN")) return fail(403, "PERMISSION_DENIED");
    if (method === "GET") return HttpResponse.json({ ...envelope(), responses: s.pushes, totalCount: s.pushes.length });
    if (method === "POST") {
      const push = { id: String(++s.seq), outputConnectionId: String(b.outputConnectionId), scope: b.scope as { spaceIds: string[]; deviceIds: string[] }, intervalSec: Number(b.intervalSec), enabled: true, lastSentAt: null, lastError: null };
      s.pushes.push(push);
      return ok(push, 201);
    }
  }
  const pushMatch = /^\/ngsi-pushes\/(\d+)$/.exec(path);
  if (pushMatch && method === "DELETE") {
    s.pushes = s.pushes.filter((p) => p.id !== pushMatch[1]);
    return noContent();
  }

  // API-DEV-60~62 게이트웨이
  if (path === "/gateways" && method === "GET") {
    const status = url.searchParams.get("status");
    return list(s.gateways.filter((g) => !status || g.status === status), url);
  }
  const gwMatch = /^\/gateways\/(\d+)(\/stats)?$/.exec(path);
  if (gwMatch) {
    const gw = s.gateways.find((g) => g.id === gwMatch[1]);
    if (!gw) return fail(404, "RESOURCE_NOT_FOUND");
    if (gwMatch[2] && method === "GET") {
      return ok({
        gatewayId: gw.id,
        from: url.searchParams.get("from"),
        to: url.searchParams.get("to"),
        deviceCount: 2,
        uplinksByHour: [
          { t: "2026-10-03T22:00:00Z", count: 54 },
          { t: "2026-10-03T23:00:00Z", count: 61 },
        ],
        devices: [
          { deviceId: "1042", name: "AM107-067999", avgRssi: -33.04, avgSnr: 9.46, uplinks: 1440, share: 0.62 },
          { deviceId: "1050", name: "EM300-TH-151606", avgRssi: -97.5, avgSnr: -4.2, uplinks: 144, share: 0.18 },
        ],
        rssiHistogram: [
          { fromDbm: -100, toDbm: -90, count: 1 },
          { fromDbm: -40, toDbm: -30, count: 1 },
        ],
      });
    }
    if (method === "GET") return ok(gw);
    if (method === "PATCH") {
      if (!can("DEV_ADMIN")) return fail(403, "PERMISSION_DENIED");
      if (b.name !== undefined) gw.name = String(b.name);
      if (b.offlineAfterSec !== undefined) gw.offlineAfterSec = Number(b.offlineAfterSec);
      if (b.spaceId !== undefined) gw.space = b.spaceId ? { id: String(b.spaceId), name: core.spacePath(String(b.spaceId)).at(-1)?.name ?? "" } : null;
      return ok(gw);
    }
  }

  // API-DEV-57 조직 기본 단위
  if (path === "/settings/units") {
    if (method === "GET") return ok({ temperatureUnit: s.orgTemperatureUnit, version: s.unitsVersion });
    if (method === "PUT") {
      if (!can("OPS_MANAGE")) return fail(403, "PERMISSION_DENIED");
      if (b.baseVersion !== s.unitsVersion) return fail(409, "VERSION_CONFLICT");
      s.orgTemperatureUnit = b.temperatureUnit === "F" ? "F" : "C";
      s.unitsVersion += 1;
      return ok({ temperatureUnit: s.orgTemperatureUnit, version: s.unitsVersion });
    }
  }
  return undefined;
};
