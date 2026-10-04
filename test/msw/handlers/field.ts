/**
 * 가짜 현장 작업 API(design/api/DEV-api.md §9, core-api M5 컨트롤러 모양): 작업 지시 API-DEV-90~95, 자산 API-DEV-96,
 * QR API-DEV-24·26, 현장 설치 API-DEV-137, 설치 현황판 API-DEV-138. 쓰기 권한: WORKORDER_WRITE(작업), DEV_ADMIN(계획·자산), DEV_PLACE(QR·설치).
 */
import { HttpResponse } from "msw";
import { fail, list, noContent, ok, type CoreHandler, type CoreState } from "../core-fixtures";

export interface FakeWorkOrder {
  id: string;
  title: string;
  type: string;
  status: string;
  priority: string;
  targets: { deviceId: string | null; spaceId: string | null }[];
  assigneeId: string | null;
  requesterId: string;
  dueAt: string | null;
  origin: string;
  originRef: string | null;
  checklist: { id: string; text: string; done: boolean; doneBy: string | null; doneAt: string | null }[];
  result: unknown;
  completedAt: string | null;
  attachments: { id: string; workOrderId: string; kind: string; fileName: string; sizeBytes: number; url: string; uploadedBy: string; createdAt: string }[];
  comments: { id: string; authorId: string; authorName: string; body: string; createdAt: string }[];
  version: number;
  createdAt: string;
}

export interface FieldState {
  orders: FakeWorkOrder[];
  plans: { id: string; name: string; targetGroupId: string; workType: string; intervalDays: number; leadDays: number; nextDueOn: string; defaultAssigneeId: string | null; checklistTemplate: string[]; enabled: boolean; version: number }[];
  assets: Record<string, { serialNo: string | null; purchasedOn: string | null; installedOn: string | null; warrantyUntil: string | null; supplier: string | null; installer: string | null; photos: string[] }>;
  qr: Record<string, string>;
  commissions: Record<string, { status: string; spaceId: string; x: number | null; y: number | null; installedAt: string; installedBy: string; installedByName: string; clientOpId: string; photos: number }>;
  /** 같은 멱등 키 재전송은 처음 응답(TC-DSH-126 흉내) */
  idempotent: Record<string, Response>;
  transitions: { id: string; action: string; key: string | null }[];
  attachmentKeys: string[];
  floors: { spaceId: string; name: string; planned: number; installed: number; verified: number; problem: number }[];
}

export function fieldState(core: CoreState): FieldState {
  core.extra.field ??= {
    orders: [
      {
        id: "1042",
        title: "실습실 AM107 배터리 교체",
        type: "BATTERY",
        status: "ASSIGNED",
        priority: "HIGH",
        targets: [{ deviceId: "1042", spaceId: null }],
        assigneeId: "7",
        requesterId: "8",
        dueAt: "2026-10-05T03:00:00Z",
        origin: "ALARM",
        originRef: "55",
        checklist: [
          { id: "1", text: "배터리 분리", done: true, doneBy: "7", doneAt: "2026-10-03T23:00:00Z" },
          { id: "2", text: "새 배터리 장착", done: false, doneBy: null, doneAt: null },
        ],
        result: null,
        completedAt: null,
        attachments: [],
        comments: [{ id: "1", authorId: "8", authorName: "이통합", body: "AA 배터리 2개 필요", createdAt: "2026-10-03T22:00:00Z" }],
        version: 1,
        createdAt: "2026-10-03T21:00:00Z",
      },
      {
        id: "1043",
        title: "실습실 센서 교정",
        type: "CALIBRATION",
        status: "OPEN",
        priority: "NORMAL",
        targets: [{ deviceId: null, spaceId: "31" }],
        assigneeId: null,
        requesterId: "8",
        dueAt: "2026-10-03T00:00:00Z",
        origin: "MANUAL",
        originRef: null,
        checklist: [],
        result: null,
        completedAt: null,
        attachments: [],
        comments: [],
        version: 1,
        createdAt: "2026-10-01T00:00:00Z",
      },
    ],
    plans: [{ id: "5", name: "배터리 반기 점검", targetGroupId: "61", workType: "INSPECTION", intervalDays: 180, leadDays: 7, nextDueOn: "2026-12-01", defaultAssigneeId: null, checklistTemplate: ["외관 확인"], enabled: true, version: 1 }],
    assets: { "1042": { serialNo: "6136D1518000", purchasedOn: "2026-03-02", installedOn: "2026-03-10", warrantyUntil: "2026-10-20", supplier: "아이오티몰", installer: null, photos: ["901"] } },
    qr: { tokAm107x0000000000000001: "1042", tokPending00000000000000002: "1050" },
    commissions: {},
    idempotent: {},
    transitions: [],
    attachmentKeys: [],
    floors: [
      { spaceId: "3", name: "3층", planned: 10, installed: 6, verified: 5, problem: 1 },
      { spaceId: "4", name: "1층", planned: 12, installed: 12, verified: 12, problem: 0 },
    ],
  } satisfies FieldState;
  return core.extra.field as FieldState;
}

const NEXT_ACTION: Record<string, { from: string[]; to: string }> = {
  ASSIGN: { from: ["OPEN", "ASSIGNED"], to: "ASSIGNED" },
  START: { from: ["OPEN", "ASSIGNED"], to: "IN_PROGRESS" },
  COMPLETE: { from: ["IN_PROGRESS"], to: "DONE" },
  CANCEL: { from: ["OPEN", "ASSIGNED", "IN_PROGRESS"], to: "CANCELLED" },
};
const OPEN = ["OPEN", "ASSIGNED", "IN_PROGRESS"];

function view(o: FakeWorkOrder) {
  const { attachments, comments, ...rest } = o;
  return { ...rest, linkedToExisting: false, updatedAt: o.createdAt, attachments, comments, linkedOrigins: [] };
}

function summary(o: FakeWorkOrder) {
  const { attachments: _a, comments: _c, ...rest } = view(o);
  void _a;
  void _c;
  return rest;
}

function asset(state: FieldState, deviceId: string) {
  const a = state.assets[deviceId] ?? { serialNo: null, purchasedOn: null, installedOn: null, warrantyUntil: null, supplier: null, installer: null, photos: [] };
  const { photos, ...rest } = a;
  return { deviceId, ...rest, photoUrls: photos.map((p) => `/api/v1/core/devices/${deviceId}/asset-info/photos/${p}`), updatedAt: "2026-10-01T00:00:00Z" };
}

const NOW_MS = Date.parse("2026-10-04T00:00:00Z");

export const fieldHandler: CoreHandler = async (core, { request, method, path, url, body, user, can }) => {
  const s = fieldState(core);
  const b = (body ?? {}) as Record<string, unknown>;
  const key = request.headers.get("idempotency-key");

  // 작업 지시
  if (path === "/work-orders" && method === "GET") {
    const statuses = url.searchParams.getAll("status");
    const assignee = url.searchParams.get("assigneeId");
    const dueBefore = url.searchParams.get("dueBefore");
    const overdue = url.searchParams.get("overdue") === "true";
    const spaceId = url.searchParams.get("spaceId");
    const inSpace = (o: FakeWorkOrder) =>
      !spaceId || o.targets.some((t) => (t.spaceId && core.spacePath(t.spaceId).some((p) => p.id === spaceId)) || (t.deviceId && core.spacePath(core.devices.find((d) => d.id === t.deviceId)?.spaceId ?? null).some((p) => p.id === spaceId)));
    const found = s.orders.filter(
      (o) =>
        (!statuses.length || statuses.includes(o.status)) &&
        (!assignee || o.assigneeId === (assignee === "me" ? user.id : assignee)) &&
        (!dueBefore || (o.dueAt !== null && Date.parse(o.dueAt) <= Date.parse(dueBefore) && Date.parse(o.dueAt) >= NOW_MS)) &&
        (!overdue || (o.dueAt !== null && Date.parse(o.dueAt) < NOW_MS && OPEN.includes(o.status))) &&
        inSpace(o),
    );
    return list(found.map(summary), url, { stats: { avgLeadTimeHours: 6.2 } });
  }
  if (path === "/work-orders" && method === "POST") {
    if (!can("WORKORDER_WRITE")) return fail(403, "PERMISSION_DENIED");
    const order: FakeWorkOrder = {
      id: core.nextId(),
      title: String(b.title),
      type: String(b.type),
      status: b.assigneeId ? "ASSIGNED" : "OPEN",
      priority: String(b.priority ?? "NORMAL"),
      targets: ((b.targets as { deviceId?: string; spaceId?: string }[]) ?? []).map((t) => ({ deviceId: t.deviceId ?? null, spaceId: t.spaceId ?? null })),
      assigneeId: (b.assigneeId as string) ?? null,
      requesterId: user.id,
      dueAt: (b.dueAt as string) ?? null,
      origin: String(b.origin ?? "MANUAL"),
      originRef: null,
      checklist: ((b.checklist as string[]) ?? []).map((text, i) => ({ id: String(i + 1), text, done: false, doneBy: null, doneAt: null })),
      result: null,
      completedAt: null,
      attachments: [],
      comments: [],
      version: 1,
      createdAt: "2026-10-04T00:00:00Z",
    };
    s.orders.push(order);
    return ok(summary(order), 201, { Location: `/api/v1/core/work-orders/${order.id}` });
  }
  const wo = /^\/work-orders\/([^/]+)(\/.*)?$/.exec(path);
  if (wo && wo[1] !== "plans") {
    const order = s.orders.find((o) => o.id === wo[1]);
    if (!order) return fail(404, "WORKORDER_NOT_FOUND");
    const sub = wo[2] ?? "";
    if (sub === "" && method === "GET") return ok(view(order));
    if (method !== "GET" && !can("WORKORDER_WRITE")) return fail(403, "PERMISSION_DENIED");
    if (key && s.idempotent[`${method} ${path} ${key}`]) return s.idempotent[`${method} ${path} ${key}`].clone();
    if (sub === "/transition" && method === "POST") {
      const action = String(b.action);
      s.transitions.push({ id: order.id, action, key });
      const rule = NEXT_ACTION[action];
      if (!rule || !rule.from.includes(order.status)) return fail(409, "WORKORDER_STATE_CONFLICT");
      order.status = rule.to;
      if (action === "ASSIGN") order.assigneeId = String(b.assigneeId ?? user.id);
      if (action === "START" && !order.assigneeId) order.assigneeId = user.id;
      if (action === "COMPLETE") {
        order.result = b.result ?? null;
        order.completedAt = "2026-10-04T00:00:00Z";
      }
      if (typeof b.note === "string") order.comments.push({ id: core.nextId(), authorId: user.id, authorName: user.name, body: b.note, createdAt: "2026-10-04T00:00:00Z" });
      order.version += 1;
      const response = ok(summary(order));
      if (key) s.idempotent[`${method} ${path} ${key}`] = response.clone();
      return response;
    }
    if (sub === "/attachments" && method === "POST") {
      const form = await request.formData();
      const file = form.get("file") as File | null;
      if (!file) return fail(400, "INVALID_REQUEST");
      if (key) s.attachmentKeys.push(key);
      const id = core.nextId();
      const attachment = { id, workOrderId: order.id, kind: file.type.startsWith("image/") ? "PHOTO" : "FILE", fileName: file.name, sizeBytes: file.size, url: `/api/v1/core/work-orders/${order.id}/attachments/${id}/content`, uploadedBy: user.id, createdAt: "2026-10-04T00:00:00Z" };
      order.attachments.push(attachment);
      const response = ok(attachment, 201);
      if (key) s.idempotent[`${method} ${path} ${key}`] = response.clone();
      return response;
    }
    const att = /^\/attachments\/([^/]+)(\/content)?$/.exec(sub);
    if (att && method === "DELETE") {
      order.attachments = order.attachments.filter((a) => a.id !== att[1]);
      return noContent();
    }
    if (att && att[2] && method === "GET") return new HttpResponse(new Uint8Array([0xff, 0xd8, 0xff]), { headers: { "Content-Type": "image/jpeg" } });
    if (sub === "/comments" && method === "POST") {
      const comment = { id: core.nextId(), authorId: user.id, authorName: user.name, body: String(b.text), createdAt: "2026-10-04T00:00:00Z" };
      order.comments.push(comment);
      return ok(comment, 201);
    }
    const check = /^\/checklist\/([^/]+)$/.exec(sub);
    if (check && method === "PATCH") {
      const item = order.checklist.find((c) => c.id === check[1]);
      if (!item) return fail(404, "RESOURCE_NOT_FOUND");
      item.done = Boolean(b.done);
      item.doneBy = item.done ? user.id : null;
      return ok(item);
    }
    return undefined;
  }
  if (path === "/maintenance-plans" && method === "GET") return list(s.plans, url);
  if (path.startsWith("/maintenance-plans")) {
    if (!can("DEV_ADMIN")) return fail(403, "PERMISSION_DENIED");
    if (path === "/maintenance-plans" && method === "POST") {
      const plan = { ...(b as unknown as FieldState["plans"][number]), id: core.nextId(), version: 1, defaultAssigneeId: (b.defaultAssigneeId as string) ?? null };
      s.plans.push(plan);
      return ok(plan, 201);
    }
    const id = path.split("/")[2];
    const plan = s.plans.find((p) => p.id === id);
    if (!plan) return fail(404, "RESOURCE_NOT_FOUND");
    if (method === "PATCH") {
      if (b.baseVersion !== plan.version) return fail(409, "VERSION_CONFLICT");
      const { baseVersion: _v, ...changes } = b;
      void _v;
      Object.assign(plan, changes, { version: plan.version + 1 });
      return ok(plan);
    }
    if (method === "DELETE") {
      s.plans = s.plans.filter((p) => p.id !== id);
      return noContent();
    }
  }

  // 자산 정보
  const as = /^\/devices\/([^/]+)\/asset-info(\/photos(?:\/([^/]+))?)?$/.exec(path);
  if (as) {
    const deviceId = as[1];
    if (method === "GET" && !as[2]) return ok(asset(s, deviceId));
    if (method === "GET" && as[3]) return new HttpResponse(new Uint8Array([0xff, 0xd8]), { headers: { "Content-Type": "image/jpeg" } });
    if (!can("DEV_ADMIN")) return fail(403, "PERMISSION_DENIED");
    s.assets[deviceId] ??= { serialNo: null, purchasedOn: null, installedOn: null, warrantyUntil: null, supplier: null, installer: null, photos: [] };
    if (method === "PUT") {
      Object.assign(s.assets[deviceId], b);
      return ok(asset(s, deviceId));
    }
    if (method === "POST" && as[2]) {
      await request.formData();
      s.assets[deviceId].photos.push(core.nextId());
      return ok(asset(s, deviceId), 201);
    }
    if (method === "DELETE" && as[3]) {
      s.assets[deviceId].photos = s.assets[deviceId].photos.filter((p) => p !== as[3]);
      return noContent();
    }
  }

  // QR
  const qr = /^\/devices\/([^/]+)\/(qr|reissue-qr)$/.exec(path);
  if (qr) {
    const deviceId = qr[1];
    if (qr[2] === "reissue-qr") {
      if (!can("DEV_PLACE")) return fail(403, "PERMISSION_DENIED");
      for (const [token, id] of Object.entries(s.qr)) if (id === deviceId) delete s.qr[token];
      s.qr[`tokNew${deviceId}0000000000000000`] = deviceId;
    }
    let token = Object.entries(s.qr).find(([, id]) => id === deviceId)?.[0];
    if (!token) {
      token = `tok${deviceId}00000000000000000000`.slice(0, 24);
      s.qr[token] = deviceId;
    }
    return ok({ deviceId, qrToken: token, url: `https://data2flow.java21.net/d/${token}` });
  }
  if (path === "/devices/qr-labels" && method === "POST") {
    if (!can("DEV_PLACE")) return fail(403, "PERMISSION_DENIED");
    return new HttpResponse(new TextEncoder().encode("%PDF-1.7 fake"), { headers: { "Content-Type": "application/pdf", "Content-Disposition": 'attachment; filename="qr-labels.pdf"' } });
  }
  const resolve = /^\/qr\/([^/]+)$/.exec(path);
  if (resolve && method === "GET") {
    const deviceId = s.qr[resolve[1]];
    return deviceId ? ok({ deviceId }) : fail(404, "DEVICE_NOT_FOUND");
  }

  // 현장 설치
  const cm = /^\/devices\/([^/]+)\/commission$/.exec(path);
  if (cm) {
    const deviceId = cm[1];
    if (method === "POST") {
      if (!can("DEV_PLACE")) return fail(403, "PERMISSION_DENIED");
      const form = await request.formData();
      const clientOpId = String(form.get("clientOpId"));
      const installedAt = String(form.get("installedAt"));
      const existing = s.commissions[deviceId];
      if (existing && existing.clientOpId === clientOpId) return ok({ deviceId, status: existing.status, installedAt: existing.installedAt, installedBy: existing.installedBy, waitUntil: "2026-10-04T00:10:00Z" });
      if (existing && Date.parse(existing.installedAt) > Date.parse(installedAt)) {
        return HttpResponse.json(
          { header: { isSuccessful: false, resultCode: "COMMISSION_CONFLICT", resultMessage: "msg:COMMISSION_CONFLICT" }, response: { deviceId, status: existing.status, spaceId: existing.spaceId, x: existing.x, y: existing.y, installedAt: existing.installedAt, installedBy: existing.installedBy, installedByName: existing.installedByName } },
          { status: 409 },
        );
      }
      const x = form.get("x");
      const y = form.get("y");
      s.commissions[deviceId] = { status: "INSTALLED", spaceId: String(form.get("spaceId")), x: x === null ? null : Number(x), y: y === null ? null : Number(y), installedAt, installedBy: user.id, installedByName: user.name, clientOpId, photos: form.getAll("photos").length };
      const device = core.devices.find((d) => d.id === deviceId);
      if (device) {
        device.status = "ACTIVE";
        device.spaceId = String(form.get("spaceId"));
      }
      return ok({ deviceId, status: "INSTALLED", installedAt, installedBy: user.id, waitUntil: new Date(Date.parse(installedAt) + 600_000).toISOString() });
    }
    const c = s.commissions[deviceId];
    return ok(c ? { deviceId, ...c, waitUntil: null, firstSeenAt: c.status === "VERIFIED" ? "2026-10-04T00:03:00Z" : null, checklist: null, latest: c.status === "VERIFIED" ? [{ metricKey: "temperature", value: 23.1, unit: "℃" }] : null, photoUrls: [] } : { deviceId, status: "PLANNED", photoUrls: [] });
  }
  if (path === "/installation-board" && method === "GET") return ok({ siteId: url.searchParams.get("siteId"), floors: s.floors });
  if (path === "/installation-board/devices" && method === "GET") {
    const status = url.searchParams.get("status");
    const devices = [
      { deviceId: "1042", name: "AM107-067999", spaceId: "31", status: "VERIFIED", checklist: { firstData: true, position: true, photo: true, signal: true, battery: true, gateway: true, source: true }, installedAt: "2026-10-03T01:00:00Z" },
      { deviceId: "1050", name: "EM300-TH-151606", spaceId: "32", status: "PROBLEM", checklist: { firstData: false, position: true, photo: true, signal: false, battery: true, gateway: true, source: true }, installedAt: "2026-10-03T02:00:00Z" },
    ];
    return HttpResponse.json({ header: { isSuccessful: true, resultCode: "SUCCESS", resultMessage: "SUCCESS" }, responses: devices.filter((d) => !status || d.status === status), totalCount: 2 });
  }
  return undefined;
};
