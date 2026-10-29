/**
 * M7 에너지 가짜 core API(design/api/ENE-api.md): 단가 API-ENE-01, 배출계수 API-ENE-02, 원천 API-ENE-04, 고지서 API-ENE-05.
 * 권한은 core와 같게 검사한다(조회 ENE_READ, 변경 ENE_ADMIN). 시스템 배출계수는 읽기 전용, 같은 범위·시작일 단가는 겹침,
 * 같은 기기·항목 계량은 충돌, 같은 달 고지서는 overwrite가 있어야 덮어쓴다. 상태는 core.extra["ene"].
 * 실습실(31)에 스마트 플러그(2001, energy·power)가 측정으로, AM107(1042)이 추정으로 연결되어 있다. 본관(2) 2026-09 고지서는 측정 합계 2,950kWh와 7.8% 다르다.
 * 지표 API-ENE-10·하위 단위 API-ENE-11은 analytics 롤업 결과 모양의 고정 값: 본관(2) 6,020kWh(기준선 없음, 직전 기간 대비 −4.1%), 하위 3층(3) 6,020kWh 중 추정 12%.
 */
import { fail, list, noContent, ok, type CoreHandler, type CoreState } from "../core-fixtures";

type Json = Record<string, unknown>;

export interface EneState {
  tariffs: Json[];
  factors: Json[];
  sources: Json[];
  bills: Json[];
  seq: number;
  /** 마지막 API-ENE-10 질의(기간·비교·범위 확인용) */
  lastMetrics?: Record<string, string>;
}

const PLUG = { id: "2001", name: "스마트 플러그-01" };

export function eneState(core: CoreState): EneState {
  core.extra.ene ??= {
    tariffs: [
      { tariffId: "301", scopeSpace: null, validFrom: "2026-01-01", mode: "FLAT", flatRateKrwPerKwh: 150, touSchedule: null, baseChargeKrwPerMonth: null, version: 0, updatedAt: "2026-10-01T00:00:00Z" },
      {
        tariffId: "302", scopeSpace: null, validFrom: "2026-10-01", mode: "TOU", flatRateKrwPerKwh: null, baseChargeKrwPerMonth: 6160, version: 0, updatedAt: "2026-10-01T00:00:00Z",
        touSchedule: { seasons: [{ name: "ALL", months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], bands: [
          { dayType: "WEEKDAY", from: "00:00", to: "09:00", rate: 98, label: "경부하" },
          { dayType: "WEEKDAY", from: "09:00", to: "24:00", rate: 152, label: "중간부하" },
          { dayType: "WEEKEND_HOLIDAY", from: "00:00", to: "24:00", rate: 98, label: "경부하" },
        ] }] },
      },
    ],
    factors: [{ emissionFactorId: "1", validFrom: "2020-01-01", factorTco2PerMwh: 0.4567, sourceTitle: "국가 온실가스 배출·흡수계수 — 전력 배출계수", sourceYear: 2023, system: true }],
    sources: [
      { sourceId: "401", space: { id: "31", name: "실습실" }, kind: "METERED", device: PLUG, metricKey: "energy", cumulative: true, coversDescendants: false, ratedPowerW: null, standbyPowerW: null, enabled: true, lastValueAt: "2026-10-03T23:59:00Z", status: "OK", version: 0 },
      { sourceId: "402", space: { id: "31", name: "실습실" }, kind: "ESTIMATED", device: { id: "1042", name: "AM107-067999" }, metricKey: null, cumulative: null, coversDescendants: false, ratedPowerW: 1200, standbyPowerW: 5, enabled: true, lastValueAt: null, status: "OK", version: 0 },
    ],
    bills: [{ billId: "501", spaceId: "2", month: "2026-09", kwh: 3200, amountKrw: 480000, attachmentObjectKey: null, meteredKwh: 2950, diffRatio: 0.0781 }],
    seq: 900,
  } satisfies EneState;
  return core.extra.ene as EneState;
}

/** 같은 범위 다음 행 시작 전날 */
function withValidTo(rows: Json[], scopeOf: (r: Json) => unknown): Json[] {
  return rows.map((r) => {
    const next = rows.filter((o) => scopeOf(o) === scopeOf(r) && String(o.validFrom) > String(r.validFrom)).map((o) => String(o.validFrom)).sort()[0];
    if (!next) return { ...r, validTo: null };
    const d = new Date(`${next}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    return { ...r, validTo: d.toISOString().slice(0, 10) };
  });
}

export const energyHandler: CoreHandler = (core, { method, path, url, body, can }) => {
  if (!path.startsWith("/energy/")) return undefined;
  if (!can("ENE_READ")) return fail(403, "PERMISSION_DENIED");
  if (method !== "GET" && !can("ENE_ADMIN")) return fail(403, "PERMISSION_DENIED");
  const s = eneState(core);
  const b = (body ?? {}) as Json;
  const id = () => String(++s.seq);

  if (path === "/energy/tariffs" && method === "GET") return ok(withValidTo(s.tariffs, (r) => (r.scopeSpace as Json | null)?.id ?? null));
  if (path === "/energy/tariffs" && method === "POST") {
    const scopeId = (b.scopeSpaceId as string | null) ?? null;
    if (s.tariffs.some((t) => ((t.scopeSpace as Json | null)?.id ?? null) === scopeId && t.validFrom === b.validFrom)) return fail(409, "ENE_RATE_PERIOD_OVERLAP");
    const scope = scopeId ? core.spaces.find((sp) => sp.id === scopeId) : null;
    const row = { tariffId: id(), scopeSpace: scope ? { id: scope.id, name: scope.name } : null, validFrom: b.validFrom, mode: b.mode, flatRateKrwPerKwh: b.flatRateKrwPerKwh ?? null, touSchedule: b.touSchedule ?? null, baseChargeKrwPerMonth: b.baseChargeKrwPerMonth ?? null, version: 0, updatedAt: "2026-10-04T00:00:00Z" };
    s.tariffs.push(row);
    return ok(row, 201);
  }
  let m = path.match(/^\/energy\/tariffs\/([^/]+)$/);
  if (m && method === "DELETE") {
    const before = s.tariffs.length;
    s.tariffs = s.tariffs.filter((t) => t.tariffId !== m![1]);
    return before === s.tariffs.length ? fail(404, "ENE_TARIFF_NOT_FOUND") : noContent();
  }

  if (path === "/energy/emission-factors" && method === "GET") return ok(withValidTo([...s.factors].sort((x, y) => String(x.validFrom).localeCompare(String(y.validFrom))), () => "all"));
  if (path === "/energy/emission-factors" && method === "POST") {
    if (s.factors.some((f) => !f.system && f.validFrom === b.validFrom)) return fail(409, "ENE_RATE_PERIOD_OVERLAP");
    const row = { emissionFactorId: id(), validFrom: b.validFrom, factorTco2PerMwh: b.factorTco2PerMwh, sourceTitle: b.sourceTitle, sourceYear: b.sourceYear, system: false };
    s.factors.push(row);
    return ok(row, 201);
  }
  m = path.match(/^\/energy\/emission-factors\/([^/]+)$/);
  if (m && (method === "DELETE" || method === "PUT")) {
    const row = s.factors.find((f) => f.emissionFactorId === m![1]);
    if (!row) return fail(404, "ENE_EMISSION_FACTOR_NOT_FOUND");
    if (row.system) return fail(409, "ENE_EMISSION_FACTOR_SYSTEM_READONLY");
    s.factors = s.factors.filter((f) => f !== row);
    return noContent();
  }

  if (path === "/energy/sources" && method === "GET") {
    const spaceId = url.searchParams.get("spaceId");
    return ok(s.sources.filter((x) => !spaceId || (x.space as Json).id === spaceId));
  }
  if (path === "/energy/sources/candidates" && method === "GET") {
    const spaceId = url.searchParams.get("spaceId") ?? "";
    if (!core.spaces.some((sp) => sp.id === spaceId)) return fail(404, "SPACE_NOT_FOUND");
    const inside = core.spacePath("31").some((sp) => sp.id === spaceId);
    const linked = s.sources.filter((x) => x.kind === "METERED" && (x.device as Json).id === PLUG.id).map((x) => String(x.metricKey));
    return ok(inside ? [{ device: PLUG, space: { id: "31", name: "실습실" }, metricKeys: ["energy", "power"], linkedMetricKeys: linked.sort() }] : []);
  }
  if (path === "/energy/sources" && method === "POST") {
    if (b.kind === "METERED" && s.sources.some((x) => x.kind === "METERED" && (x.device as Json).id === b.deviceId && x.metricKey === b.metricKey)) return fail(409, "ENE_SOURCE_CONFLICT");
    if (b.kind === "ESTIMATED" && s.sources.some((x) => x.kind === "ESTIMATED" && (x.device as Json).id === b.deviceId)) return fail(409, "ENE_SOURCE_CONFLICT");
    const space = core.spaces.find((sp) => sp.id === b.spaceId);
    if (!space) return fail(404, "SPACE_NOT_FOUND");
    const device = b.deviceId === PLUG.id ? PLUG : core.devices.find((d) => d.id === b.deviceId);
    if (!device) return fail(404, "DEVICE_NOT_FOUND");
    const metered = b.kind === "METERED";
    const row = { sourceId: id(), space: { id: space.id, name: space.name }, kind: b.kind, device: { id: device.id, name: device.name }, metricKey: metered ? b.metricKey : null, cumulative: metered ? b.metricKey === "energy" : null, coversDescendants: !!b.coversDescendants, ratedPowerW: b.ratedPowerW ?? null, standbyPowerW: b.standbyPowerW ?? null, enabled: true, lastValueAt: null, status: metered ? "NO_DATA" : "OK", version: 0 };
    s.sources.push(row);
    return ok(row, 201);
  }
  m = path.match(/^\/energy\/sources\/([^/]+)$/);
  if (m && method === "DELETE") {
    const before = s.sources.length;
    s.sources = s.sources.filter((x) => x.sourceId !== m![1]);
    return before === s.sources.length ? fail(404, "ENE_SOURCE_NOT_FOUND") : noContent();
  }

  if (path === "/energy/bills" && method === "GET") {
    const spaceId = url.searchParams.get("spaceId");
    const year = url.searchParams.get("year") ?? "2026";
    const rows = s.bills.filter((x) => (!spaceId || x.spaceId === spaceId) && String(x.month).startsWith(`${year}-`));
    return list(rows, url);
  }
  m = path.match(/^\/energy\/bills\/([^/]+)\/(\d{4}-\d{2})$/);
  if (m && method === "PUT") {
    const existing = s.bills.find((x) => x.spaceId === m![1] && x.month === m![2]);
    if (existing && !b.overwrite) return fail(409, "ENE_BILL_DUPLICATE");
    const row = { billId: existing?.billId ?? id(), spaceId: m[1], month: m[2], kwh: b.kwh, amountKrw: b.amountKrw ?? null, attachmentObjectKey: null, meteredKwh: null, diffRatio: null };
    s.bills = [...s.bills.filter((x) => x !== existing), row];
    return ok(row);
  }
  if (m && method === "DELETE") {
    const before = s.bills.length;
    s.bills = s.bills.filter((x) => !(x.spaceId === m![1] && x.month === m![2]));
    return before === s.bills.length ? fail(404, "ENE_BILL_NOT_FOUND") : noContent();
  }
  if (path === "/energy/metrics" && method === "GET") {
    const q = Object.fromEntries(url.searchParams);
    s.lastMetrics = q;
    const scope = q.scopeSpaceId ?? null;
    if (scope && !core.spaces.some((sp) => sp.id === scope)) return fail(404, "SPACE_NOT_FOUND");
    const space = scope ? core.spaces.find((sp) => sp.id === scope)! : null;
    const compare = q.compare === "BASELINE" ? { kind: "BASELINE", kwh: null, diffRatio: null, reason: "NO_BASELINE" } : { kind: q.compare, kwh: 6277, diffRatio: -0.041 };
    return ok({
      scope: { spaceId: scope, name: space?.name ?? null, kind: space?.type ?? null, areaM2: scope === "2" ? 500 : null },
      totals: { kwh: 6020, krw: 924800, tco2: 2.75, euiKwhPerM2: scope === "2" ? 12.04 : null, euiReason: scope === "2" ? null : "NO_AREA", kwhPerOccupiedHour: null, occupiedHoursSource: null, estimatedRatio: 0.12, otherCommonKwh: 0 },
      compare,
      series: [
        { t: "2026-10-01", kwh: 3100, krw: 470000, tco2: 1.41, estimatedKwh: 400 },
        { t: "2026-10-02", kwh: 2920, krw: 454800, tco2: 1.34, estimatedKwh: 322.4 },
      ],
    });
  }
  if (path === "/energy/breakdown" && method === "GET") {
    const scope = url.searchParams.get("scopeSpaceId");
    if (scope && !core.spaces.some((sp) => sp.id === scope)) return fail(404, "SPACE_NOT_FOUND");
    const items = scope === "2" ? [{ id: "3", name: "3층", kind: "FLOOR", kwh: 6020, krw: 924800, tco2: 2.75, euiKwhPerM2: 13.4, estimatedRatio: 0.12, estimated: true, share: 1, diffRatio: -0.041, hasData: true }] : [];
    return ok({ items, other: { kwh: scope === "2" ? 0 : 0 }, page: 1, size: 50, totalCount: items.length });
  }
  return undefined;
};
