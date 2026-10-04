/** 현장 작업 부품 테스트 도구: 가짜 API 묶음, 가짜 EventSource, 연결 상태 바꾸기, 작업 지시 예시 */
import { act } from "@testing-library/react";
import { vi, type Mock } from "vitest";
import type { EventSourceLike } from "~/lib/event-stream";
import type { FieldApi } from "../api";
import type { WorkOrderDetail } from "../model/work-orders";

export const ok = <T,>(data: T, status = 200) => ({ ok: true as const, status, data });
export const fail = (status: number, code: string, response?: unknown) => ({ ok: false as const, status, code, message: "", response });

export class FakeES implements EventSourceLike {
  static all: FakeES[] = [];
  readyState = 0;
  onopen: ((e: Event) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  listeners: Record<string, ((e: MessageEvent) => void)[]> = {};
  constructor(readonly url: string) {
    FakeES.all.push(this);
  }
  addEventListener(type: string, l: (e: MessageEvent) => void) {
    (this.listeners[type] ??= []).push(l);
  }
  close() {}
  emit(type: string, data: unknown) {
    for (const l of this.listeners[type] ?? []) l({ data: JSON.stringify(data), lastEventId: "" } as MessageEvent);
  }
}
export const live = { createSource: (url: string) => new FakeES(url), checkSession: async () => true };

/** navigator.onLine을 바꾸고 online/offline 이벤트를 보낸다 */
export function setOnline(value: boolean) {
  Object.defineProperty(window.navigator, "onLine", { value, configurable: true });
  act(() => {
    window.dispatchEvent(new Event(value ? "online" : "offline"));
  });
}

export function order(overrides: Partial<WorkOrderDetail> = {}): WorkOrderDetail {
  return {
    id: "1042",
    title: "실습실 EM300 배터리 교체",
    type: "BATTERY",
    status: "IN_PROGRESS",
    priority: "HIGH",
    targets: [{ deviceId: "1042", spaceId: null }],
    assigneeId: "7",
    dueAt: "2026-10-05T03:00:00Z",
    origin: "ALARM",
    originRef: "55",
    checklist: [
      { id: "1", text: "배터리 분리", done: true },
      { id: "2", text: "새 배터리 장착", done: false },
    ],
    attachments: [],
    comments: [],
    version: 1,
    ...overrides,
  };
}

export type FakeFieldApi = { [K in keyof FieldApi]: FieldApi[K] & Mock<FieldApi[K]> };

export function fakeFieldApi(overrides: Partial<FieldApi> = {}): FakeFieldApi {
  const api: FieldApi = {
    workOrder: async () => ok(order()),
    workOrders: async () => ok({ responses: [] }),
    createWorkOrder: async () => ok({ ...order(), id: "2001", attachments: undefined } as never, 201),
    transition: async (id, body) => ok({ ...order({ id }), status: body.action === "COMPLETE" ? "DONE" : body.action === "START" ? "IN_PROGRESS" : body.action === "CANCEL" ? "CANCELLED" : "ASSIGNED" }),
    attach: async (id, _file, name) => ok({ id: `a-${name}`, workOrderId: id, kind: "PHOTO", fileName: name, sizeBytes: 3, url: `/api/v1/core/work-orders/${id}/attachments/a-${name}/content` }, 201),
    detach: async () => ok(undefined, 204),
    comment: async (_id, text) => ok({ id: "c1", authorId: "7", authorName: "김운영", body: text, createdAt: "2026-10-04T00:00:00Z" }, 201),
    check: async (_id, itemId, done) => ok({ id: itemId, text: "x", done }),
    plans: async () => ok({ responses: [] }),
    createPlan: async (body) => ok({ ...(body as object), id: "9", version: 1 } as never, 201),
    updatePlan: async (id, body) => ok({ ...(body as object), id, version: 2 } as never),
    deletePlan: async () => ok(undefined, 204),
    asset: async (deviceId) => ok({ deviceId, serialNo: "SN-1", purchasedOn: "2026-03-02", installedOn: "2026-03-10", warrantyUntil: "2026-10-20", supplier: "아이오티몰", installer: null, photoUrls: [`/api/v1/core/devices/${deviceId}/asset-info/photos/901`] }),
    saveAsset: async (deviceId, body) => ok({ deviceId, ...(body as object), photoUrls: [] } as never),
    addAssetPhoto: async (deviceId) => ok({ deviceId, photoUrls: [`/api/v1/core/devices/${deviceId}/asset-info/photos/901`, `/api/v1/core/devices/${deviceId}/asset-info/photos/902`] }, 201),
    deleteAssetPhoto: async () => ok(undefined, 204),
    qr: async (deviceId) => ok({ deviceId, qrToken: "tokAm107x0000000000000001", url: "https://data2flow.java21.net/d/tokAm107x0000000000000001" }),
    reissueQr: async (deviceId) => ok({ deviceId, qrToken: "tokNew000000000000000002", url: "https://data2flow.java21.net/d/tokNew000000000000000002" }),
    qrLabels: async () => ({ ok: true as const, blob: new Blob(["%PDF"]), fileName: "qr-labels.pdf" }),
    resolveQr: async (token) => (token.startsWith("tokOther") ? fail(404, "DEVICE_NOT_FOUND") : ok({ deviceId: token.startsWith("tokB") ? "1051" : "1050" })),
    commission: async () => ok({ deviceId: "1050", status: "INSTALLED", installedAt: "2026-10-04T00:00:00Z", installedBy: "7", waitUntil: "2026-10-04T00:10:00Z" }),
    commissionStatus: async (deviceId) => ok({ deviceId, status: "VERIFIED", firstSeenAt: "2026-10-04T00:03:00Z", latest: [{ metricKey: "temperature", value: 23.1, unit: "℃" }] }),
    device: async (deviceId) => ok({ id: deviceId, name: deviceId === "1051" ? "EM300-TH-151777" : "EM300-TH-151606", status: "PENDING", externalId: "24e124136d151606", model: { id: "11", name: "EM300-TH" }, space: { id: "31", name: "실습실" } }),
    floorplan: async () => ok({ imageUrl: "/api/v1/core/spaces/31/floorplan/image?v=1", markers: [] }),
    board: async () => ok({ siteId: "1", floors: [{ spaceId: "3", name: "3층", planned: 10, installed: 7, verified: 6, problem: 1 }] }),
    boardDevices: async () => ok({ responses: [] }),
    ...overrides,
  };
  for (const key of Object.keys(api) as (keyof FieldApi)[]) (api as unknown as Record<string, unknown>)[key] = vi.fn(api[key] as never);
  return api as FakeFieldApi;
}
