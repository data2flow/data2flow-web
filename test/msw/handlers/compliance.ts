/**
 * M7 환경 기준 가짜 core API(design/api/CMP-api.md): 프로필 API-CMP-01~06a, 적용 API-CMP-07, 측정 가능성 API-CMP-08,
 * 종합 점수 API-CMP-10, 준수 현황 API-CMP-13·14, 리포트 API-CMP-16~20a.
 * 권한은 core와 같게 검사한다(조회 CMP_READ, 쓰기 CMP_ADMIN, 리포트 생성·발행 CMP_REPORT). 시스템 프로필은 READ_ONLY, 잠긴 버전 PUT도 READ_ONLY.
 * 상태는 core.extra["cmp"].
 */
import { NOW, fail, list, noContent, ok, type CoreHandler, type CoreState } from "../core-fixtures";

type Json = Record<string, unknown>;

export interface CmpState {
  profiles: Json[];
  versions: Record<string, Json[]>;
  applications: Json[];
  reports: Json[];
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
    reports: [
      {
        reportId: "801", type: "KR_SELF_CHECK", title: "2026-09 자가 점검(실습실)", spaceIds: ["31"], facilityType: "GENERAL", periodFrom: "2026-09-01", periodTo: "2026-09-30", options: { includeRawCsv: false, includeActions: true, branding: false }, createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-02T00:00:00Z",
        revisions: [revision("801", 1, "PUBLISHED", { publishedBy: { userId: "7", name: "김운영" }, publishedAt: "2026-10-01T01:00:00Z" }), revision("801", 2, "DRAFT", { sha256: "b".repeat(64), dataRange: { ...RANGE, missingRatio: 12.5, lateRowsSincePrevious: 30 } })],
      },
      { reportId: "802", type: "KR_SELF_CHECK", title: "2026-10 자가 점검", spaceIds: ["31"], facilityType: "GENERAL", periodFrom: "2026-10-01", periodTo: "2026-10-03", options: {}, createdAt: "2026-10-04T00:00:00Z", updatedAt: "2026-10-04T00:00:00Z", revisions: [revision("802", 1, "GENERATING", { progress: 60, sha256: null, dataRange: null })] },
    ],
    seq: 600,
  } satisfies CmpState;
  return core.extra.cmp as CmpState;
}

const RANGE = { from: "2026-08-31T15:00:00Z", to: "2026-09-30T15:00:00Z", rows: 43200, missingRatio: 1.2, excludedVirtualDevices: 1, lateRowsSincePrevious: 0 };

function revision(reportId: string, revisionNo: number, status: string, extra: Json = {}): Json {
  return { reportId, revisionNo, status, progress: status === "GENERATING" ? 10 : 100, sha256: "9f2a".padEnd(61, "0") + "c41", sizeBytes: 120_000, dataRange: RANGE, profileVersions: ["70"], generatedBy: { userId: "7", name: "김운영" }, publishedBy: null, publishedAt: null, failureReason: null, createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:05:00Z", ...extra };
}

const reportView = (r: Json, all: boolean): Json => {
  const { revisions, ...rest } = r as Json & { revisions: Json[] };
  const sorted = [...revisions].sort((a, b) => Number(b.revisionNo) - Number(a.revisionNo));
  return { ...rest, latest: sorted[0] ?? null, revisions: all ? sorted : null };
};

/** 리포트 API-CMP-16~20a. 32번(사무실)에는 프로필이 적용되어 있지 않다 */
function reportsHandler(s: CmpState, { method, path, url, body, can }: Parameters<CoreHandler>[1]): Response | undefined {
  const b = (body ?? {}) as Json;
  if (path === "/compliance/reports" && method === "GET") {
    const type = url.searchParams.get("type");
    const status = url.searchParams.get("status");
    const rows = s.reports.map((r) => reportView(r, false)).filter((r) => (!type || r.type === type) && (!status || (r.latest as Json | null)?.status === status));
    return list(rows, url);
  }
  if (path === "/compliance/reports" && method === "POST") {
    if (!can("CMP_REPORT")) return fail(403, "PERMISSION_DENIED");
    const spaceIds = (b.spaceIds as string[] | undefined) ?? [];
    if (spaceIds.includes("32")) return fail(409, "CMP_PROFILE_NOT_APPLIED");
    const key = (r: Json) => [r.type, [...(r.spaceIds as string[])].sort().join(","), r.periodFrom, r.periodTo, r.facilityType ?? "GENERAL"].join("|");
    const wanted = { type: b.type, spaceIds, periodFrom: b.periodFrom, periodTo: b.periodTo, facilityType: b.facilityType ?? "GENERAL" };
    let report = s.reports.find((r) => key(r) === key(wanted));
    if (!report) {
      report = { reportId: String(++s.seq), ...wanted, title: b.title ?? `실내공기질 자가 점검 리포트 ${b.periodFrom} ~ ${b.periodTo}`, options: b.options ?? {}, createdAt: NOW, updatedAt: NOW, revisions: [] };
      s.reports.push(report);
    }
    const revisions = report.revisions as Json[];
    const next = revision(report.reportId as string, revisions.length + 1, "GENERATING", { sha256: null, dataRange: null });
    revisions.push(next);
    return ok({ reportId: report.reportId, revisionId: String(++s.seq), revisionNo: next.revisionNo, status: "GENERATING" }, 202);
  }
  if (path === "/compliance/reports/verify-hash" && method === "POST") return ok({ matched: false });
  const m = /^\/compliance\/reports\/(\d+)(?:\/revisions\/(\d+)(?:\/(publish|files|content)(?:\/(pdf|csv|preview))?)?)?$/.exec(path);
  if (!m) return undefined;
  const report = s.reports.find((r) => r.reportId === m[1]);
  if (!report) return fail(404, "CMP_REPORT_NOT_FOUND");
  if (!m[2]) return method === "GET" ? ok(reportView(report, true)) : undefined;
  const revisions = report.revisions as Json[];
  const rev = revisions.find((r) => r.revisionNo === Number(m[2]));
  if (!rev) return fail(404, "CMP_REPORT_NOT_FOUND");
  if (!m[3] && method === "GET") return ok(rev);
  if (!m[3] && method === "DELETE") {
    if (!can("CMP_REPORT")) return fail(403, "PERMISSION_DENIED");
    if (rev.status !== "DRAFT" && rev.status !== "FAILED") return fail(409, "CMP_REPORT_STATE_CONFLICT");
    report.revisions = revisions.filter((r) => r !== rev);
    if ((report.revisions as Json[]).length === 0) s.reports = s.reports.filter((r) => r !== report);
    return noContent();
  }
  if (m[3] === "publish" && method === "POST") {
    if (!can("CMP_REPORT")) return fail(403, "PERMISSION_DENIED");
    if (rev.status !== "DRAFT") return fail(409, "CMP_REPORT_STATE_CONFLICT");
    Object.assign(rev, { status: "PUBLISHED", sha256: "c".repeat(64), publishedBy: { userId: "7", name: "김운영" }, publishedAt: NOW });
    return ok(rev);
  }
  if (m[3] === "files" && method === "GET") {
    if (m[4] === "csv") return can("CMP_REPORT") ? fail(404, "CMP_REPORT_NOT_FOUND") : fail(403, "PERMISSION_DENIED");
    if (rev.status !== "DRAFT" && rev.status !== "PUBLISHED") return fail(404, "CMP_REPORT_NOT_FOUND");
    return ok({ url: `/api/v1/core/compliance/reports/${m[1]}/revisions/${m[2]}/content/${m[4]}?expires=1791000600&signature=abc`, sha256: rev.sha256, sizeBytes: rev.sizeBytes, expiresAt: "2026-10-04T00:10:00Z" });
  }
  if (m[3] === "content" && method === "GET") {
    return new Response("%PDF-1.7\n%fake\n", { status: 200, headers: { "Content-Type": "application/pdf" } });
  }
  return undefined;
}

const current = (s: CmpState, p: Json) => s.versions[p.profileId as string].find((v) => v.versionNo === p.currentVersionNo)!;
const detail = (s: CmpState, p: Json) => ({ ...p, currentVersion: current(s, p), applications: s.applications.filter((a) => a.profileId === p.profileId) });

export const complianceHandler: CoreHandler = (core, { method, path, url, body, can, user }) => {
  if (!path.startsWith("/compliance/")) return undefined;
  if (!can("CMP_READ")) return fail(403, "PERMISSION_DENIED");
  if (path.startsWith("/compliance/reports")) return reportsHandler(cmpState(core), { method, path, url, body, can, user } as Parameters<CoreHandler>[1]);
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

  // 종합 점수 API-CMP-10, 준수 현황 API-CMP-13·14(CMP 2차)
  const score = /^\/compliance\/spaces\/(\d+)\/score$/.exec(path);
  if (score && method === "GET") {
    if (score[1] !== "31") return fail(404, "SPACE_NOT_FOUND");
    const inputs = url.searchParams.get("include") === "inputs" ? { inputs: SCORE_INPUTS } : {};
    return ok({ ...SCORE, ...inputs });
  }
  if (path === "/compliance/status" && method === "GET") {
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    if (from && to && (Date.parse(to) - Date.parse(from)) / 86_400_000 + 1 > 400) return fail(400, "CMP_REPORT_PERIOD_INVALID");
    const profileId = url.searchParams.get("profileId");
    const rows = STATUS_ROWS.filter((r) => !profileId || r.profile.id === profileId);
    return ok({ summary: { avgRatio: rows.length ? 88.5 : null, exceededHours: rows.length ? 27 : 0, streakingSpaces: rows.length ? 1 : 0, qualityWarnings: rows.length ? 1 : 0 }, rows });
  }
  const spaceStatus = /^\/compliance\/status\/spaces\/(\d+)$/.exec(path);
  if (spaceStatus && method === "GET") {
    if (spaceStatus[1] !== "31" && spaceStatus[1] !== "32") return fail(404, "SPACE_NOT_FOUND");
    return ok(SPACE_STATUS);
  }
  return undefined;
};

const SCORE = {
  spaceId: "31",
  time: "2026-10-04T00:00:00Z",
  score: 72,
  grade: "MODERATE",
  indices: { co2: 3, pm2_5: 5, temperature: 4, humidity: null },
  topPenaltyMetric: "co2",
  topPenaltyValue: 1180,
  basis: "PROFILE",
  excludedMetrics: ["humidity"],
  partial: true,
  profileVersions: ["101:v2"],
  formulaVersion: "IEQ-1",
};

const SCORE_INPUTS = [
  { metricKey: "co2", avg5m: 1180, unit: "ppm", weight: 1, boundary: { lower: null, upper: 1000 } },
  { metricKey: "pm2_5", avg5m: 8.2, unit: "μg/m³", weight: 1, boundary: { lower: null, upper: 35 } },
  { metricKey: "temperature", avg5m: 23.1, unit: "℃", weight: 0.7, boundary: { lower: 20, upper: 26 } },
];

const STATUS_ROWS = [
  {
    space: { id: "31", name: "실습실", path: "광주캠퍼스 › 본관 › 3층 › 실습실" },
    profile: { id: "101", name: "우리 학교 기준", versionNo: 2 },
    ratio: 92.4,
    exceededByMetric: [
      { metricKey: "co2", hours: 18 },
      { metricKey: "pm2_5", hours: 0 },
    ],
    missingRatio: 2.1,
    qualityWarning: false,
    streak: { currentDays: 47, requiredDays: 90 },
    score: 72,
  },
  {
    space: { id: "32", name: "사무실", path: "광주캠퍼스 › 본관 › 3층 › 사무실" },
    profile: { id: "101", name: "우리 학교 기준", versionNo: 2 },
    ratio: 84.6,
    exceededByMetric: [{ metricKey: "co2", hours: 9 }],
    missingRatio: 12.5,
    qualityWarning: true,
    streak: { currentDays: 0, requiredDays: 90, brokenOn: "2026-10-02", brokenMetric: "co2" },
    score: 55,
  },
];

const SPACE_STATUS = {
  daily: [
    { day: "2026-10-02", ratio: 80, metMinutes: 1100, exceededMinutes: 275, missingMinutes: 65, qualityWarning: false, byMetric: [] },
    { day: "2026-10-03", ratio: 100, metMinutes: 1440, exceededMinutes: 0, missingMinutes: 0, qualityWarning: false, byMetric: [] },
  ],
  excursions: [{ id: "9001", metricKey: "co2", startedAt: "2026-10-02T01:00:00Z", endedAt: "2026-10-02T05:35:00Z", peakValue: 1420, alarmId: "77", hasAction: false }],
};
