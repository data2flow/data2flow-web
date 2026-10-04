/**
 * 대시보드 화면 loader 도우미(서버 전용).
 * - 첫 화면(NFR-01.09): 정의와 함께 앞쪽 위젯(최대 FIRST_PAINT_WIDGETS개)의 데이터를 서버에서 병렬로 받아 HTML에 넣는다.
 *   브라우저는 나머지 위젯만 요청한다. 위젯 하나가 느려도 SSR_WIDGET_TIMEOUT_MS 뒤에는 그 위젯만 빼고 그린다
 * - 변수 선택지: 공간(API-DEV-01 트리)·기기(API-DEV-20 첫 100개)·측정 항목(검증된 항목) — 사용자가 볼 수 있는 것만 core가 준다
 * - 공유 링크(API-DSH-15): 세션 없이(anonymous) gateway 공개 경로만 부른다
 */
import { callApi, callList } from "~/bff/api.server";
import type { BffRequestContext } from "~/bff/middleware.server";
import { flattenSpaces, type SpaceNode } from "~/lib/spaces";
import { stateFromResult } from "./model/data";
import type { VariableOption } from "./model/variables";
import { resolveValues } from "./model/variables";
import type { Dashboard, DashboardVariable, SharedDashboard, WidgetData, WidgetDataRequest, WidgetState } from "./model/types";

export const FIRST_PAINT_WIDGETS = 12;
export const SSR_WIDGET_TIMEOUT_MS = 2_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

/** 앞쪽 위젯 데이터(읽는 순서: 위→아래, 왼쪽→오른쪽) */
export async function firstPaintData(ctx: BffRequestContext, request: Request, dashboard: Dashboard, values: Record<string, string>, limit = FIRST_PAINT_WIDGETS): Promise<Record<string, WidgetState>> {
  const widgets = [...(dashboard.layout?.widgets ?? [])]
    .filter((w) => w.type !== "markdown")
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .slice(0, limit);
  const body: WidgetDataRequest = { timeRange: dashboard.timeRange, resolution: dashboard.resolution, variables: resolveValues(dashboard.variables ?? [], values) };
  const results = await Promise.all(
    widgets.map((w) =>
      withTimeout(
        callApi<WidgetData>(ctx, request, `/api/v1/core/dashboards/${encodeURIComponent(dashboard.id)}/widgets/${encodeURIComponent(w.id)}/data`, { method: "POST", body, noGuards: true }),
        SSR_WIDGET_TIMEOUT_MS,
      ),
    ),
  );
  const out: Record<string, WidgetState> = {};
  widgets.forEach((w, i) => {
    const r = results[i];
    if (r) out[w.id] = stateFromResult(r.ok ? { ok: true, status: r.status, data: r.data } : { ok: false, status: r.status, code: r.code });
  });
  return out;
}

/** 변수 종류가 있을 때만 선택지를 읽는다 */
export async function variableOptions(ctx: BffRequestContext, request: Request, variables: DashboardVariable[]): Promise<Record<string, VariableOption[]>> {
  const types = new Set(variables.map((v) => v.type));
  const [spaces, devices, metrics] = await Promise.all([
    types.has("SPACE") ? callApi<SpaceNode[]>(ctx, request, "/api/v1/core/spaces", { noGuards: true }) : null,
    types.has("DEVICE") ? callList<{ id: string | number; name: string }>(ctx, request, "/api/v1/core/devices?status=ACTIVE&size=100", { noGuards: true }) : null,
    types.has("METRIC") ? callList<{ key: string; displayName?: string; unit?: string | null }>(ctx, request, "/api/v1/core/metrics?status=VERIFIED&size=100", { noGuards: true }) : null,
  ]);
  const byType: Record<string, VariableOption[]> = {
    SPACE: spaces?.ok ? flattenSpaces(spaces.data ?? []).map((s) => ({ value: s.id, label: s.path.join(" › ") })) : [],
    DEVICE: devices?.ok ? devices.list.responses.map((d) => ({ value: String(d.id), label: d.name })) : [],
    METRIC: metrics?.ok ? metrics.list.responses.map((m) => ({ value: m.key, label: m.displayName ? `${m.displayName} (${m.key})` : m.key })) : [],
  };
  return Object.fromEntries(variables.map((v) => [v.name, byType[v.type] ?? []]));
}

/** 공유 링크 정의(API-DSH-15). 없거나 만료·폐기면 null */
export async function loadShared(ctx: BffRequestContext, request: Request, token: string): Promise<{ ok: true; shared: SharedDashboard } | { ok: false; code: string; status: number }> {
  if (!/^[A-Za-z0-9_-]{16,100}$/.test(token)) return { ok: false, code: "SHARE_LINK_INVALID", status: 404 };
  const r = await callApi<SharedDashboard>(ctx, request, `/api/v1/core/public/share/${encodeURIComponent(token)}`, { anonymous: true, noGuards: true });
  return r.ok ? { ok: true, shared: r.data } : { ok: false, code: r.code, status: r.status };
}

/** 공유 링크 위젯 데이터 중계(BFF 공개 경로 → gateway 공개 경로). 요청 본문은 쿼리 q(JSON)에서 꺼낸 범위·집계·변수만 */
export function sharedRequestBody(q: string | null): WidgetDataRequest {
  try {
    const parsed = JSON.parse(q ?? "{}") as Record<string, unknown>;
    const out: WidgetDataRequest = {};
    if (parsed.timeRange && typeof parsed.timeRange === "object") {
      const tr = parsed.timeRange as Record<string, unknown>;
      if (typeof tr.relative === "string") out.timeRange = { relative: tr.relative.slice(0, 8) };
      else if (typeof tr.from === "string") out.timeRange = { from: tr.from.slice(0, 40), to: typeof tr.to === "string" ? tr.to.slice(0, 40) : null };
    }
    if (typeof parsed.resolution === "string") out.resolution = parsed.resolution.slice(0, 8);
    if (parsed.variables && typeof parsed.variables === "object") {
      out.variables = Object.fromEntries(
        Object.entries(parsed.variables as Record<string, unknown>)
          .filter(([k, v]) => /^[A-Za-z][A-Za-z0-9_]{0,30}$/.test(k) && typeof v === "string" && v.length <= 64)
          .slice(0, 10) as [string, string][],
      );
    }
    return out;
  } catch {
    return {};
  }
}

/** 브랜딩 자산 공개 주소(API-DSH-25 `/api/v1/core/public/branding/assets/{id}`)를 BFF 경로로 */
export function brandingAssetPath(assetId: string): string | null {
  return /^\d{1,18}$/.test(assetId) ? `/api/v1/core/public/branding/assets/${assetId}` : null;
}
