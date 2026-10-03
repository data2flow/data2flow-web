/**
 * 여러 화면이 함께 쓰는 기본 조회(다른 도메인 핸들러가 먼저 처리하지 않을 때만): 공간 트리(API-DEV-01),
 * 기기 모델 목록(API-DEV-46), 측정 항목(API-DEV-50), 기기 목록·상세(API-DEV-11·23), 소스 목록(API-DSC-01).
 */
import { list, ok, type CoreHandler } from "../core-fixtures";

export const baseHandler: CoreHandler = (core, { method, path, url }) => {
  if (method !== "GET") return undefined;
  if (path === "/spaces") return ok(core.spaceTree(url.searchParams.get("rootId")));
  if (path === "/device-models") {
    return list(
      core.models.filter((m) => url.searchParams.get("includeDeprecated") === "true" || m.status === "ACTIVE").map((m) => ({ id: m.id, code: m.code, vendor: m.vendor, name: m.name, protocol: m.protocol, kind: m.kind, builtin: m.builtin, status: m.status, deviceCount: core.devices.filter((d) => d.modelId === m.id).length, metricCount: m.metrics.length, updatedAt: "2026-10-01T00:00:00Z" })),
      url,
    );
  }
  if (path === "/metrics") {
    const status = url.searchParams.get("status");
    return list(core.metrics.filter((m) => !status || m.status === status), url);
  }
  if (path === "/devices") {
    const status = url.searchParams.getAll("status");
    const q = url.searchParams.get("q")?.toLowerCase();
    const items = core.devices.filter((d) => (status.length ? status.includes(d.status) : true) && (!q || d.name.toLowerCase().includes(q) || d.externalId.includes(q)));
    return list(items.map((d) => core.deviceSummary(d)), url);
  }
  const device = /^\/devices\/([^/]+)$/.exec(path);
  if (device) {
    const d = core.devices.find((x) => x.id === device[1]);
    return d ? ok(core.deviceDetail(d)) : undefined;
  }
  if (path === "/sources") {
    return list(
      core.sources.map((s) => ({ id: s.id, code: s.code, name: s.name, type: s.type, lifecycle: s.lifecycle, state: s.state, stateDetail: { connectedInstances: s.runtime.filter((r) => r.state === "CONNECTED").length, totalInstances: s.runtime.length }, lastReceivedAt: s.lastReceivedAt, ratePerMin: s.ratePerMin, decodeErrorRate1h: s.decodeErrorRate1h, deviceCount: core.devices.filter((d) => d.sourceId === s.id).length, version: s.version })),
      url,
    );
  }
  return undefined;
};
