/**
 * 현장 작업 화면의 브라우저 API(`/bff/api/core/**`): 작업 지시·정기 점검(API-DEV-90~95), 자산 정보(API-DEV-96),
 * QR(API-DEV-24·26), 현장 설치(API-DEV-137), 설치 현황판(API-DEV-138). 화면 부품은 이 묶음을 주입받아 테스트에서 바꾼다.
 */
import { bffFetch, bffJson, clientIdempotencyKey, type BffJsonResult } from "~/lib/bff-client";
import type { BoardDevice, BoardFloor, CommissionResult, CommissionStatusView, QrInfo } from "./model/commissioning";
import type { QueuedOp, SendOutcome } from "./model/offline-queue";
import type { AssetInfo, Attachment, ChecklistItem, Comment, MaintenancePlan, WorkOrder, WorkOrderDetail } from "./model/work-orders";

const CORE = "/bff/api/core";
const enc = encodeURIComponent;

export type FormResult<T> = { ok: true; status: number; data: T } | { ok: false; status: number; code: string; message: string; response?: unknown };

/** multipart 업로드(Content-Type은 브라우저가 경계값과 함께 정한다). 실패 응답의 response(409 서버 기록 등)도 돌려준다 */
export async function bffForm<T>(path: string, form: FormData, idempotencyKey?: string): Promise<FormResult<T>> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  let response: Response;
  try {
    response = await bffFetch(path, { method: "POST", headers, body: form });
  } catch {
    return { ok: false, status: 0, code: "SERVICE_UNAVAILABLE", message: "" };
  }
  const body = (await response.json().catch(() => null)) as { header?: { resultCode?: string; resultMessage?: string }; response?: unknown } | null;
  if (response.ok) return { ok: true, status: response.status, data: body?.response as T };
  return { ok: false, status: response.status, code: body?.header?.resultCode ?? "UNKNOWN", message: body?.header?.resultMessage ?? "", response: body?.response };
}

/** 내려받기(PDF 등) — 파일 이름은 Content-Disposition에서 */
export async function bffDownload(path: string, init: { method?: string; body?: unknown } = {}): Promise<{ ok: true; blob: Blob; fileName: string } | { ok: false; status: number; code: string }> {
  let response: Response;
  try {
    response = await bffFetch(path, {
      method: init.method ?? "GET",
      headers: init.body === undefined ? {} : { "Content-Type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    return { ok: false, status: 0, code: "SERVICE_UNAVAILABLE" };
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { header?: { resultCode?: string } } | null;
    return { ok: false, status: response.status, code: body?.header?.resultCode ?? "UNKNOWN" };
  }
  const disposition = response.headers.get("content-disposition") ?? "";
  const fileName = /filename="?([^";]+)"?/.exec(disposition)?.[1] ?? "download";
  return { ok: true, blob: await response.blob(), fileName };
}

/** 현장 화면이 쓰는 기기 상세 일부(API-DEV-23) */
export interface FieldDevice {
  id: string;
  name: string;
  externalId?: string;
  status: string;
  model?: { id: string; code?: string; name?: string } | null;
  space?: { id: string; name?: string; path?: string[] } | null;
  state?: { connectivity?: string; lastSeenAt?: string | null; battery?: number | null; rssi?: number | null } | null;
  latest?: { metricKey: string; displayName?: string; unit?: string | null; value: number | string | boolean | null; measuredAt?: string }[];
}

export interface WorkOrderList {
  responses: WorkOrder[];
  totalPages?: number;
  totalCount?: number;
  stats?: { avgLeadTimeHours?: number | null };
}

export interface FieldApi {
  workOrder(id: string): Promise<BffJsonResult<WorkOrderDetail>>;
  workOrders(query: URLSearchParams): Promise<BffJsonResult<WorkOrderList>>;
  createWorkOrder(body: unknown, key?: string): Promise<BffJsonResult<WorkOrder>>;
  transition(id: string, body: { action: string; assigneeId?: string; result?: unknown; note?: string }, key?: string): Promise<BffJsonResult<WorkOrder>>;
  attach(id: string, file: Blob, name: string, key?: string): Promise<FormResult<Attachment>>;
  detach(id: string, attachmentId: string): Promise<BffJsonResult<void>>;
  comment(id: string, text: string): Promise<BffJsonResult<Comment>>;
  check(id: string, itemId: string, done: boolean): Promise<BffJsonResult<ChecklistItem>>;
  plans(): Promise<BffJsonResult<{ responses: MaintenancePlan[] }>>;
  createPlan(body: unknown): Promise<BffJsonResult<MaintenancePlan>>;
  updatePlan(id: string, body: unknown): Promise<BffJsonResult<MaintenancePlan>>;
  deletePlan(id: string): Promise<BffJsonResult<void>>;
  asset(deviceId: string): Promise<BffJsonResult<AssetInfo>>;
  saveAsset(deviceId: string, body: unknown): Promise<BffJsonResult<AssetInfo>>;
  addAssetPhoto(deviceId: string, file: Blob, name: string): Promise<FormResult<AssetInfo>>;
  deleteAssetPhoto(deviceId: string, photoId: string): Promise<BffJsonResult<void>>;
  qr(deviceId: string): Promise<BffJsonResult<QrInfo>>;
  reissueQr(deviceId: string): Promise<BffJsonResult<QrInfo>>;
  qrLabels(deviceIds: string[], layout: string): ReturnType<typeof bffDownload>;
  resolveQr(token: string): Promise<BffJsonResult<{ deviceId: string }>>;
  commission(deviceId: string, form: FormData): Promise<FormResult<CommissionResult>>;
  commissionStatus(deviceId: string): Promise<BffJsonResult<CommissionStatusView>>;
  device(deviceId: string): Promise<BffJsonResult<FieldDevice>>;
  floorplan(spaceId: string): Promise<BffJsonResult<{ imageUrl?: string | null; markers?: { deviceId: string; x: number; y: number }[] }>>;
  board(siteId?: string | null): Promise<BffJsonResult<{ siteId?: string | null; floors: BoardFloor[] }>>;
  boardDevices(spaceId: string, status?: string | null): Promise<BffJsonResult<{ responses: BoardDevice[] }>>;
}

export const fieldApi: FieldApi = {
  workOrder: (id) => bffJson(`${CORE}/work-orders/${enc(id)}`),
  workOrders: (query) => bffJson(`${CORE}/work-orders?${query.toString()}`),
  createWorkOrder: (body, key) => bffJson(`${CORE}/work-orders`, { method: "POST", body, idempotencyKey: key ?? clientIdempotencyKey() }),
  transition: (id, body, key) => bffJson(`${CORE}/work-orders/${enc(id)}/transition`, { method: "POST", body, idempotencyKey: key ?? clientIdempotencyKey() }),
  attach: (id, file, name, key) => {
    const form = new FormData();
    form.set("file", file, name);
    return bffForm(`${CORE}/work-orders/${enc(id)}/attachments`, form, key ?? clientIdempotencyKey());
  },
  detach: (id, attachmentId) => bffJson(`${CORE}/work-orders/${enc(id)}/attachments/${enc(attachmentId)}`, { method: "DELETE" }),
  comment: (id, text) => bffJson(`${CORE}/work-orders/${enc(id)}/comments`, { method: "POST", body: { text } }),
  check: (id, itemId, done) => bffJson(`${CORE}/work-orders/${enc(id)}/checklist/${enc(itemId)}`, { method: "PATCH", body: { done } }),
  plans: () => bffJson(`${CORE}/maintenance-plans?size=100`),
  createPlan: (body) => bffJson(`${CORE}/maintenance-plans`, { method: "POST", body }),
  updatePlan: (id, body) => bffJson(`${CORE}/maintenance-plans/${enc(id)}`, { method: "PATCH", body }),
  deletePlan: (id) => bffJson(`${CORE}/maintenance-plans/${enc(id)}`, { method: "DELETE" }),
  asset: (deviceId) => bffJson(`${CORE}/devices/${enc(deviceId)}/asset-info`),
  saveAsset: (deviceId, body) => bffJson(`${CORE}/devices/${enc(deviceId)}/asset-info`, { method: "PUT", body }),
  addAssetPhoto: (deviceId, file, name) => {
    const form = new FormData();
    form.set("file", file, name);
    return bffForm(`${CORE}/devices/${enc(deviceId)}/asset-info/photos`, form);
  },
  deleteAssetPhoto: (deviceId, photoId) => bffJson(`${CORE}/devices/${enc(deviceId)}/asset-info/photos/${enc(photoId)}`, { method: "DELETE" }),
  qr: (deviceId) => bffJson(`${CORE}/devices/${enc(deviceId)}/qr`),
  reissueQr: (deviceId) => bffJson(`${CORE}/devices/${enc(deviceId)}/reissue-qr`, { method: "POST", body: {} }),
  qrLabels: (deviceIds, layout) => bffDownload(`${CORE}/devices/qr-labels`, { method: "POST", body: { deviceIds, layout } }),
  resolveQr: (token) => bffJson(`${CORE}/qr/${enc(token)}`),
  commission: (deviceId, form) => bffForm(`${CORE}/devices/${enc(deviceId)}/commission`, form),
  commissionStatus: (deviceId) => bffJson(`${CORE}/devices/${enc(deviceId)}/commission`),
  device: (deviceId) => bffJson(`${CORE}/devices/${enc(deviceId)}`),
  floorplan: (spaceId) => bffJson(`${CORE}/spaces/${enc(spaceId)}/floorplan`),
  board: (siteId) => bffJson(`${CORE}/installation-board${siteId ? `?siteId=${enc(siteId)}` : ""}`),
  boardDevices: (spaceId, status) => bffJson(`${CORE}/installation-board/devices?spaceId=${enc(spaceId)}${status ? `&status=${enc(status)}` : ""}`),
};

const asOutcome = (result: { ok: boolean; status: number; code?: string; response?: unknown; data?: unknown }): SendOutcome =>
  result.ok ? { ok: true, status: result.status, response: result.data } : { ok: false, status: result.status, code: result.code, response: result.response };

/** 대기열 작업을 실제 요청으로 보낸다. 작업마다 저장해 둔 멱등 키를 다시 쓴다(BR-DSH-22, BR-DEV-37) */
export function queueSender(api: FieldApi) {
  return async (op: QueuedOp): Promise<SendOutcome> => {
    const t = op.target;
    switch (op.kind) {
      case "commission": {
        const form = new FormData();
        form.set("clientOpId", op.key);
        form.set("spaceId", String(t.spaceId));
        if (t.x !== null && t.x !== undefined && t.y !== null && t.y !== undefined) {
          form.set("x", String(t.x));
          form.set("y", String(t.y));
        }
        form.set("installedAt", String(t.installedAt));
        for (const f of op.files ?? []) form.append("photos", f.blob, f.name);
        return asOutcome(await api.commission(String(t.deviceId), form));
      }
      case "checklist":
        return asOutcome(await api.check(String(t.workOrderId), String(t.itemId), Boolean(t.done)));
      case "attachment": {
        const file = op.files?.[0];
        if (!file) return { ok: false, status: 400, code: "INVALID_REQUEST" };
        return asOutcome(await api.attach(String(t.workOrderId), file.blob, file.name, op.key));
      }
      case "transition": {
        const body: { action: string; note?: string; result?: unknown } = { action: String(t.action) };
        if (typeof t.note === "string" && t.note) body.note = t.note;
        if (typeof t.result === "string" && t.result) body.result = JSON.parse(t.result);
        return asOutcome(await api.transition(String(t.workOrderId), body, op.key));
      }
    }
  };
}
