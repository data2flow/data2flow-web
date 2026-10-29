/**
 * M7 환경 기준 가짜 core API(design/api/CMP-api.md): 프로필 API-CMP-01~06a, 적용 API-CMP-07, 측정 가능성 API-CMP-08.
 * 권한은 core와 같게 검사한다(조회 CMP_READ, 쓰기 CMP_ADMIN). 시스템 프로필은 READ_ONLY, 잠긴 버전 PUT도 READ_ONLY.
 * 상태는 core.extra["cmp"].
 */
import { fail, list, noContent, ok, type CoreHandler, type CoreState } from "../core-fixtures";

type Json = Record<string, unknown>;

export interface CmpState {
  profiles: Json[];
  versions: Record<string, Json[]>;
  applications: Json[];
  seq: number;
}

const metric = (metricKey: string, facilityType: string | null, upper: number, unit: string, requirement = "LIMIT") => ({ metricKey, facilityType, evalWindow: "HOUR_1", lower: null, upper, inclusive: true, unit, requirement, note: null, bands: [] });

function version(versionNo: number, extra: Json = {}): Json {
  return { versionNo, sourceTitle: "실내공기질관리법 시행규칙 별표 2", sourceUrl: "https://www.law.go.kr", effectiveDate: "2025-01-01", description: null, streak: null, facilityTypeRequired: false, facilityTypes: [], changeNote: null, locked: false, metrics: [], coverage: [], createdBy: null, createdAt: "2026-10-01T00:00:00Z", ...extra };
}

export function cmpState(core: CoreState): CmpState {
  core.extra.cmp ??= {
    profiles: [
      { profileId: "1", kind: "SYSTEM", code: "KR_IAQ_PUBLIC_FACILITY", name: "실내공기질관리법 다중이용시설", archived: false, currentVersionNo: 1, version: 0, updatedAt: "2026-10-01T00:00:00Z" },
      { profileId: "101", kind: "ORGANIZATION", code: null, name: "우리 학교 기준", archived: false, currentVersionNo: 2, version: 3, updatedAt: "2026-10-02T00:00:00Z" },
    ],
    versions: {
      "1": [version(1, { facilityTypeRequired: true, facilityTypes: ["GENERAL", "SENSITIVE"], locked: true, metrics: [metric("co2", "GENERAL", 1000, "ppm"), metric("co2", "SENSITIVE", 1000, "ppm"), metric("tvoc", "GENERAL", 500, "μg/m³", "RECOMMENDED")] })],
      "101": [
        version(1, { locked: true, changeNote: null, metrics: [metric("co2", null, 1200, "ppm")], createdBy: { userId: "8", name: "이통합" } }),
        version(2, { changeNote: "CO2 기준 강화", metrics: [metric("co2", null, 1000, "ppm")], createdBy: { userId: "8", name: "이통합" } }),
      ],
    },
    applications: [{ applicationId: "501", profileId: "101", profileName: "우리 학교 기준", pinnedVersionNo: null, versionNo: 2, targetType: "SPACE", targetSpaceId: "31", targetName: "실습실", targetUsage: null, includeDescendants: true, facilityType: null, appliedBy: { userId: "8", name: "이통합" }, appliedAt: "2026-10-02T00:00:00Z", measurability: { measurable: 1, partial: 0, unmeasurable: 0 } }],
    seq: 600,
  } satisfies CmpState;
  return core.extra.cmp as CmpState;
}

const current = (s: CmpState, p: Json) => s.versions[p.profileId as string].find((v) => v.versionNo === p.currentVersionNo)!;
const detail = (s: CmpState, p: Json) => ({ ...p, currentVersion: current(s, p), applications: s.applications.filter((a) => a.profileId === p.profileId) });

export const complianceHandler: CoreHandler = (core, { method, path, url, body, can, user }) => {
  if (!path.startsWith("/compliance/")) return undefined;
  if (!can("CMP_READ")) return fail(403, "PERMISSION_DENIED");
  if (method !== "GET" && !can("CMP_ADMIN")) return fail(403, "PERMISSION_DENIED");
  const s = cmpState(core);
  const b = (body ?? {}) as Json;
  const now = "2026-10-04T00:00:00Z";

  if (path === "/compliance/profiles" && method === "GET") {
    const keyword = url.searchParams.get("keyword");
    const kind = url.searchParams.get("kind");
    const rows = s.profiles
      .filter((p) => (!kind || p.kind === kind) && (!keyword || String(p.name).includes(keyword)))
      .map((p) => ({ ...p, sourceTitle: current(s, p).sourceTitle, effectiveDate: current(s, p).effectiveDate, applicationCount: s.applications.filter((a) => a.profileId === p.profileId).length }));
    return list(rows, url);
  }
  if (path === "/compliance/profiles" && method === "POST") {
    const name = String(b.name ?? "").trim();
    if (s.profiles.some((p) => p.name === name)) return fail(409, "CMP_PROFILE_NAME_DUPLICATE");
    const id = String(++s.seq);
    const p = { profileId: id, kind: "ORGANIZATION", code: null, name, archived: false, currentVersionNo: 1, version: 0, updatedAt: now };
    s.profiles.push(p);
    s.versions[id] = [{ ...version(1), ...(b.version as Json), versionNo: 1, locked: false, createdBy: { userId: user.id, name: user.name }, createdAt: now }];
    return ok(detail(s, p), 201);
  }
  const m = /^\/compliance\/profiles\/(\d+)(?:\/(versions|clone|archive|unarchive))?(?:\/(\d+))?$/.exec(path);
  if (m) {
    const p = s.profiles.find((x) => x.profileId === m[1]);
    if (!p) return fail(404, "CMP_PROFILE_NOT_FOUND");
    const versions = s.versions[m[1]];
    if (!m[2] && method === "GET") return ok(detail(s, p));
    if (m[2] === "versions" && method === "GET" && !m[3]) {
      return ok([...versions].reverse().map((v) => ({ versionNo: v.versionNo, changeNote: v.changeNote, createdBy: v.createdBy, createdAt: v.createdAt, locked: v.locked, usage: { applications: s.applications.filter((a) => a.profileId === p.profileId && a.versionNo === v.versionNo).length, reports: 0 } })));
    }
    if (m[2] === "versions" && method === "GET") {
      const v = versions.find((x) => x.versionNo === Number(m[3]));
      return v ? ok(v) : fail(404, "CMP_PROFILE_NOT_FOUND");
    }
    if (m[2] === "clone" && method === "POST") {
      const id = String(++s.seq);
      const copy = { profileId: id, kind: "ORGANIZATION", code: null, name: String(b.name), archived: false, currentVersionNo: 1, version: 0, updatedAt: now };
      s.profiles.push(copy);
      s.versions[id] = [{ ...current(s, p), versionNo: 1, locked: false, changeNote: null }];
      return ok(detail(s, copy), 201);
    }
    if (p.kind === "SYSTEM") return fail(409, "CMP_PROFILE_READ_ONLY");
    if (m[2] === "archive" || m[2] === "unarchive") {
      p.archived = m[2] === "archive";
      return ok(detail(s, p));
    }
    if (b.baseVersion !== undefined && b.baseVersion !== p.version) return fail(409, "CMP_PROFILE_VERSION_CONFLICT");
    const { baseVersion: _base, ...spec } = b;
    void _base;
    if (m[2] === "versions" && method === "POST") {
      const no = Number(p.currentVersionNo) + 1;
      versions.push({ ...version(no), ...spec, versionNo: no, createdBy: { userId: user.id, name: user.name }, createdAt: now });
      Object.assign(p, { currentVersionNo: no, version: Number(p.version) + 1, updatedAt: now });
      return ok(versions[versions.length - 1], 201);
    }
    if (m[2] === "versions" && method === "PUT") {
      const v = versions.find((x) => x.versionNo === Number(m[3]));
      if (!v) return fail(404, "CMP_PROFILE_NOT_FOUND");
      if (v.locked) return fail(409, "CMP_PROFILE_READ_ONLY");
      Object.assign(v, spec);
      Object.assign(p, { version: Number(p.version) + 1, updatedAt: now });
      return ok(v);
    }
  }
  if (path === "/compliance/applications" && method === "GET") {
    return list(s.applications.filter((a) => !url.searchParams.get("profileId") || a.profileId === url.searchParams.get("profileId")), url);
  }
  if (path === "/compliance/applications" && method === "POST") {
    const p = s.profiles.find((x) => x.profileId === b.profileId);
    if (!p) return fail(404, "CMP_PROFILE_NOT_FOUND");
    if (p.archived) return fail(409, "CMP_PROFILE_ARCHIVED");
    if (current(s, p).facilityTypeRequired && !b.facilityType) return fail(400, "CMP_FACILITY_TYPE_REQUIRED");
    if (s.applications.some((a) => a.profileId === b.profileId && a.targetSpaceId === b.targetSpaceId && a.targetUsage === b.targetUsage)) return fail(409, "CMP_APPLICATION_DUPLICATE");
    const space = core.spaces.find((x) => x.id === b.targetSpaceId);
    const a = { ...b, applicationId: String(++s.seq), profileName: p.name, versionNo: b.pinnedVersionNo ?? p.currentVersionNo, targetName: space?.name ?? null, appliedBy: { userId: user.id, name: user.name }, appliedAt: now, measurability: { measurable: 0, partial: 1, unmeasurable: 0 } };
    s.applications.push(a);
    current(s, p).locked = true;
    return ok(a, 201);
  }
  const app = /^\/compliance\/applications\/(\d+)(\/measurability)?$/.exec(path);
  if (app) {
    const a = s.applications.find((x) => x.applicationId === app[1]);
    if (!a) return fail(404, "CMP_APPLICATION_NOT_FOUND");
    if (app[2]) return ok([{ metricKey: "co2", status: "PARTIAL", reason: null, spacesWithout: [{ id: "32", name: "사무실" }], devices: [] }]);
    if (method === "DELETE") {
      s.applications = s.applications.filter((x) => x !== a);
      return noContent();
    }
  }
  return undefined;
};
