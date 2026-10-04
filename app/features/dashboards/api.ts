/**
 * 브라우저 → BFF(`/bff/api/core/**`) 대시보드 호출(API-DSH-06·07·09·10·12). 공유 링크 화면(로그인 없음)은
 * 세션 없이 BFF 공개 경로 `GET /share/{token}/widgets/{widget-id}/data`를 쓴다(sharedWidgetData).
 */
import { bffFetch, bffJson, clientIdempotencyKey, type BffJsonResult } from "~/lib/bff-client";
import type { ConflictInfo } from "./model/transfer";
import type { Dashboard, ShareLink, ShareLinkCreated, TimeRange, WidgetData, WidgetDataRequest } from "./model/types";

const base = "/bff/api/core";
const enc = encodeURIComponent;

export type SaveResult = { ok: true; dashboard: Dashboard } | { ok: false; status: number; code: string; message: string; conflict?: ConflictInfo; errors?: { field: string; code: string; message: string }[] };

export const dashboardsApi = {
  widgetData: (dashboardId: string, widgetId: string, req: WidgetDataRequest, signal?: AbortSignal) =>
    bffJson<WidgetData>(`${base}/dashboards/${enc(dashboardId)}/widgets/${enc(widgetId)}/data`, { method: "POST", body: req, signal }),
  preview: (body: { widget: unknown; variableDefinitions: unknown; timeRange?: TimeRange; resolution?: string; variables?: Record<string, string> }, signal?: AbortSignal) =>
    bffJson<WidgetData>(`${base}/widgets/preview`, { method: "POST", body, signal }),
  create: (body: Record<string, unknown>) => bffJson<{ id: string; version: number }>(`${base}/dashboards`, { method: "POST", body, idempotencyKey: clientIdempotencyKey() }),
  duplicate: (id: string) => bffJson<{ id: string; name: string; version: number }>(`${base}/dashboards/${enc(id)}/duplicate`, { method: "POST", idempotencyKey: clientIdempotencyKey() }),
  remove: (id: string) => bffJson<void>(`${base}/dashboards/${enc(id)}`, { method: "DELETE" }),
  exportJson: (id: string) => bffJson<Record<string, unknown>>(`${base}/dashboards/${enc(id)}/export`),
  importJson: (body: Record<string, unknown>) =>
    bffJson<{ id: string; name: string; version: number; unmapped: { ref: string; reason: string }[] }>(`${base}/dashboards/import`, { method: "POST", body, idempotencyKey: clientIdempotencyKey() }),
  setDefault: (dashboardId: string | null) => bffJson<{ defaultDashboardId: string | null }>(`${base}/accounts/me/default-dashboard`, { method: "PUT", body: { dashboardId } }),
  shareLinks: (id: string) => bffJson<ShareLink[]>(`${base}/dashboards/${enc(id)}/share-links`),
  createShareLink: (id: string, expiresInDays: number) =>
    bffJson<ShareLinkCreated>(`${base}/dashboards/${enc(id)}/share-links`, { method: "POST", body: { expiresInDays }, idempotencyKey: clientIdempotencyKey() }),
  revokeShareLink: (id: string, linkId: string) => bffJson<void>(`${base}/dashboards/${enc(id)}/share-links/${enc(linkId)}`, { method: "DELETE" }),
  /** 저장(PUT). 409면 응답의 최신 판을 함께 돌려준다(BR-DSH-07) */
  async save(id: string, body: Record<string, unknown>): Promise<SaveResult> {
    let response: Response;
    try {
      response = await bffFetch(`${base}/dashboards/${enc(id)}`, { method: "PUT", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body) });
    } catch {
      return { ok: false, status: 0, code: "SERVICE_UNAVAILABLE", message: "" };
    }
    const json = (await response.json().catch(() => null)) as { header?: { resultCode?: string; resultMessage?: string }; response?: unknown; errors?: { field: string; code: string; message: string }[] } | null;
    if (response.ok) return { ok: true, dashboard: json?.response as Dashboard };
    const code = json?.header?.resultCode ?? "UNKNOWN";
    const conflict = response.status === 409 && json?.response && typeof json.response === "object" ? (json.response as ConflictInfo) : undefined;
    return { ok: false, status: response.status, code, message: json?.header?.resultMessage ?? "", conflict, errors: json?.errors };
  },
  /** 화면 설정 일부 저장(API-DSH-12, 온 키만). 버전을 먼저 읽는다 */
  async savePreferences(patch: Record<string, unknown>): Promise<BffJsonResult<{ version: number }>> {
    const current = await bffJson<{ version?: number }>(`${base}/accounts/me/preferences`);
    if (!current.ok) return current as BffJsonResult<{ version: number }>;
    return bffJson<{ version: number }>(`${base}/accounts/me/preferences`, { method: "PUT", body: { ...patch, baseVersion: current.data?.version ?? 0 } });
  },
};

/** 공유 링크 위젯 데이터 주소(쿠키·CSRF 없이 GET). 요청 내용은 쿼리 `q`(JSON) 하나로 */
export function sharedWidgetDataUrl(token: string, widgetId: string, req: WidgetDataRequest): string {
  return `/share/${enc(token)}/widgets/${enc(widgetId)}/data?q=${enc(JSON.stringify(req))}`;
}

export async function sharedWidgetData(token: string, widgetId: string, req: WidgetDataRequest, signal?: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<BffJsonResult<WidgetData>> {
  try {
    const response = await fetchImpl(sharedWidgetDataUrl(token, widgetId, req), { headers: { Accept: "application/json" }, credentials: "omit", signal });
    const json = (await response.json().catch(() => null)) as { header?: { resultCode?: string; resultMessage?: string }; response?: unknown } | null;
    if (response.ok) return { ok: true, status: response.status, data: json?.response as WidgetData };
    return { ok: false, status: response.status, code: json?.header?.resultCode ?? "UNKNOWN", message: json?.header?.resultMessage ?? "" };
  } catch {
    return { ok: false, status: 0, code: "SERVICE_UNAVAILABLE", message: "" };
  }
}

/** 키오스크 세션 유지 요청(DSH-06.02). 상태 코드만 본다 */
export async function keepAlivePing(fetchImpl?: typeof fetch): Promise<number> {
  const response = await bffFetch(`${base}/accounts/me`, { method: "GET", headers: { Accept: "application/json" } }, { fetchImpl });
  return response.status;
}
