/**
 * 가짜 기기 그룹 API(design/api/DEV-api.md §3, API-DEV-30~35). 쓰기는 DEV_ADMIN만, 그룹당 1,000대(BR-DEV-12).
 */
import { fail, list, noContent, ok, type CoreHandler, type CoreState, type FakeGroup } from "../core-fixtures";

/** 테스트가 바꾸는 값: 사용처(삭제 거부)·미리 보기 개수 */
export interface GroupExtra {
  usage: Record<string, { rules: number; flows: number; dashboards: number }>;
  previewCount?: number;
}

export function groupExtra(core: CoreState): GroupExtra {
  core.extra.groups ??= { usage: { "61": { rules: 1, flows: 0, dashboards: 1 } } } satisfies GroupExtra;
  return core.extra.groups as GroupExtra;
}

function matches(core: CoreState, criteria: Record<string, unknown>) {
  const c = criteria as { modelIds?: string[]; spaceIds?: string[]; tags?: { match: string; values: string[] }; statuses?: string[] };
  return core.devices.filter(
    (d) =>
      (!c.modelIds?.length || c.modelIds.includes(String(d.modelId))) &&
      (!c.spaceIds?.length || c.spaceIds.some((s) => core.spacePath(d.spaceId).some((p) => p.id === s))) &&
      (!c.statuses?.length || c.statuses.includes(d.status)) &&
      (!c.tags?.values?.length || (c.tags.match === "all" ? c.tags.values.every((t) => d.tags.includes(t)) : c.tags.values.some((t) => d.tags.includes(t)))),
  );
}

function view(core: CoreState, g: FakeGroup) {
  const members = g.type === "DYNAMIC" ? matches(core, g.criteria ?? {}).map((d) => d.id) : g.memberIds;
  return { id: g.id, name: g.name, type: g.type, description: g.description ?? null, criteria: g.criteria ?? null, memberCount: members.length, usage: groupExtra(core).usage[g.id] ?? { rules: 0, flows: 0, dashboards: 0 }, version: g.version, updatedAt: "2026-10-01T00:00:00Z" };
}

export const groupsHandler: CoreHandler = (core, { method, path, url, body, can }) => {
  if (!path.startsWith("/device-groups")) return undefined;
  const b = (body ?? {}) as Record<string, unknown>;
  const x = groupExtra(core);
  if (path === "/device-groups/preview" && method === "POST") {
    const found = matches(core, (b.criteria as Record<string, unknown>) ?? {});
    const count = x.previewCount ?? found.length;
    if (count > 1000) return fail(400, "GROUP_SIZE_EXCEEDED", { response: { count } });
    return ok({ count, sample: found.slice(0, 20).map((d) => ({ id: d.id, name: d.name })) });
  }
  if (method !== "GET" && !can("DEV_ADMIN")) return fail(403, "PERMISSION_DENIED");
  if (path === "/device-groups" && method === "GET") {
    const q = url.searchParams.get("q")?.toLowerCase();
    const type = url.searchParams.get("type");
    return list(core.groups.filter((g) => (!q || g.name.toLowerCase().includes(q)) && (!type || g.type === type)).map((g) => view(core, g)), url);
  }
  if (path === "/device-groups" && method === "POST") {
    const name = String(b.name ?? "").trim();
    if (core.groups.some((g) => g.name === name)) return fail(409, "GROUP_NAME_DUPLICATE");
    const type = b.type === "DYNAMIC" ? "DYNAMIC" : "STATIC";
    const criteria = (b.criteria as Record<string, unknown>) ?? null;
    if (type === "DYNAMIC" && matches(core, criteria ?? {}).length > 1000) return fail(400, "GROUP_SIZE_EXCEEDED");
    const ids = ((b.deviceIds as string[]) ?? []).map(String);
    if (ids.length > 1000) return fail(400, "GROUP_SIZE_EXCEEDED");
    const group: FakeGroup = { id: core.nextId(), name, type, description: (b.description as string) ?? null, criteria, memberIds: ids, version: 1 };
    core.groups.push(group);
    return ok(view(core, group), 201, { Location: `/api/v1/core/device-groups/${group.id}` });
  }
  const m = /^\/device-groups\/([^/]+)(?:\/(members)(?:\/(add|remove))?)?$/.exec(path);
  if (!m) return undefined;
  const group = core.groups.find((g) => g.id === m[1]);
  if (!group) return fail(404, "RESOURCE_NOT_FOUND");
  if (!m[2]) {
    if (method === "GET") return ok(view(core, group));
    if (method === "PATCH") {
      if (b.name && core.groups.some((g) => g !== group && g.name === b.name)) return fail(409, "GROUP_NAME_DUPLICATE");
      if ("name" in b) group.name = String(b.name);
      if ("description" in b) group.description = (b.description as string) ?? null;
      if ("criteria" in b) group.criteria = b.criteria as Record<string, unknown>;
      group.version += 1;
      return ok(view(core, group));
    }
    if (method === "DELETE") {
      const usage = x.usage[group.id];
      if (usage && usage.rules + usage.flows + usage.dashboards > 0) return fail(409, "GROUP_IN_USE", { response: { references: [{ type: "RULE", id: "501", name: "실습실 고CO2" }] } });
      core.groups.splice(core.groups.indexOf(group), 1);
      return noContent();
    }
  }
  if (m[2] === "members" && !m[3] && method === "GET") {
    const ids = group.type === "DYNAMIC" ? matches(core, group.criteria ?? {}).map((d) => d.id) : group.memberIds;
    return list(core.devices.filter((d) => ids.includes(d.id)).map((d) => core.deviceSummary(d)), url);
  }
  if (m[3] && method === "POST") {
    if (group.type === "DYNAMIC") return fail(400, "INVALID_REQUEST");
    const ids = ((b.deviceIds as string[]) ?? []).map(String);
    if (m[3] === "add") {
      const next = [...new Set([...group.memberIds, ...ids])];
      if (next.length > 1000) return fail(400, "GROUP_SIZE_EXCEEDED");
      const added = next.length - group.memberIds.length;
      group.memberIds = next;
      return ok({ groupId: group.id, memberCount: next.length, added });
    }
    const before = group.memberIds.length;
    group.memberIds = group.memberIds.filter((id) => !ids.includes(id));
    return ok({ groupId: group.id, memberCount: group.memberIds.length, removed: before - group.memberIds.length });
  }
  return undefined;
};
