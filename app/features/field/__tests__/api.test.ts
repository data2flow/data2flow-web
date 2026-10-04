/**
 * 현장 작업 브라우저 API 경로·메서드·헤더(core M5 컨트롤러: WorkOrderController·AssetController·CommissioningController, API-DEV-90~96·24·26·137·138).
 * multipart는 Content-Type을 브라우저에 맡기고 멱등 키를 붙인다, 409 응답의 서버 기록(response)을 돌려준다, PDF는 Blob과 파일 이름.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { bffDownload, bffForm, fieldApi } from "../api";

afterEach(() => vi.restoreAllMocks());

const envelope = (response: unknown, status = 200, code = "SUCCESS") => new Response(JSON.stringify({ header: { isSuccessful: status < 400, resultCode: code, resultMessage: code }, response }), { status, headers: { "Content-Type": "application/json" } });

describe("fieldApi 경로", () => {
  it("모든 호출이 /bff/api/core 아래 올바른 메서드로 간다", async () => {
    const calls: [string, string, Record<string, string>][] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const headers: Record<string, string> = {};
      new Headers(init?.headers).forEach((v, k) => (headers[k] = v));
      calls.push([String(input), init?.method ?? "GET", headers]);
      return envelope({ ok: 1 });
    });
    const file = new Blob(["x"], { type: "image/jpeg" });
    await fieldApi.workOrder("1");
    await fieldApi.workOrders(new URLSearchParams("view=all"));
    await fieldApi.createWorkOrder({}, "k1");
    await fieldApi.createWorkOrder({});
    await fieldApi.transition("1", { action: "START" }, "k2");
    await fieldApi.transition("1", { action: "START" });
    await fieldApi.attach("1", file, "a.jpg", "k3");
    await fieldApi.attach("1", file, "a.jpg");
    await fieldApi.detach("1", "9");
    await fieldApi.comment("1", "hi");
    await fieldApi.check("1", "2", true);
    await fieldApi.plans();
    await fieldApi.createPlan({});
    await fieldApi.updatePlan("5", {});
    await fieldApi.deletePlan("5");
    await fieldApi.asset("1042");
    await fieldApi.saveAsset("1042", {});
    await fieldApi.addAssetPhoto("1042", file, "p.jpg");
    await fieldApi.deleteAssetPhoto("1042", "901");
    await fieldApi.qr("1042");
    await fieldApi.reissueQr("1042");
    await fieldApi.resolveQr("tok/1");
    await fieldApi.commission("1050", new FormData());
    await fieldApi.commissionStatus("1050");
    await fieldApi.device("1050");
    await fieldApi.floorplan("31");
    await fieldApi.board("1");
    await fieldApi.board(null);
    await fieldApi.boardDevices("3", "PROBLEM");
    await fieldApi.boardDevices("3");
    expect(calls.map(([url, method]) => `${method} ${url}`)).toEqual([
      "GET /bff/api/core/work-orders/1",
      "GET /bff/api/core/work-orders?view=all",
      "POST /bff/api/core/work-orders",
      "POST /bff/api/core/work-orders",
      "POST /bff/api/core/work-orders/1/transition",
      "POST /bff/api/core/work-orders/1/transition",
      "POST /bff/api/core/work-orders/1/attachments",
      "POST /bff/api/core/work-orders/1/attachments",
      "DELETE /bff/api/core/work-orders/1/attachments/9",
      "POST /bff/api/core/work-orders/1/comments",
      "PATCH /bff/api/core/work-orders/1/checklist/2",
      "GET /bff/api/core/maintenance-plans?size=100",
      "POST /bff/api/core/maintenance-plans",
      "PATCH /bff/api/core/maintenance-plans/5",
      "DELETE /bff/api/core/maintenance-plans/5",
      "GET /bff/api/core/devices/1042/asset-info",
      "PUT /bff/api/core/devices/1042/asset-info",
      "POST /bff/api/core/devices/1042/asset-info/photos",
      "DELETE /bff/api/core/devices/1042/asset-info/photos/901",
      "GET /bff/api/core/devices/1042/qr",
      "POST /bff/api/core/devices/1042/reissue-qr",
      "GET /bff/api/core/qr/tok%2F1",
      "POST /bff/api/core/devices/1050/commission",
      "GET /bff/api/core/devices/1050/commission",
      "GET /bff/api/core/devices/1050",
      "GET /bff/api/core/spaces/31/floorplan",
      "GET /bff/api/core/installation-board?siteId=1",
      "GET /bff/api/core/installation-board",
      "GET /bff/api/core/installation-board/devices?spaceId=3&status=PROBLEM",
      "GET /bff/api/core/installation-board/devices?spaceId=3",
    ]);
    expect(calls[2][2]["idempotency-key"]).toBe("k1");
    expect(calls[3][2]["idempotency-key"]).toMatch(/.+/);
    expect(calls[6][2]["idempotency-key"]).toBe("k3");
    expect(calls[6][2]["content-type"]).toBeUndefined();
  });

  it("bffForm: 성공 data, 실패는 코드와 서버 기록, 연결 실패는 0", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    spy.mockResolvedValueOnce(envelope({ id: "1" }, 201));
    expect(await bffForm("/x", new FormData())).toEqual({ ok: true, status: 201, data: { id: "1" } });
    spy.mockResolvedValueOnce(envelope({ spaceId: "32" }, 409, "COMMISSION_CONFLICT"));
    expect(await bffForm("/x", new FormData())).toMatchObject({ ok: false, status: 409, code: "COMMISSION_CONFLICT", response: { spaceId: "32" } });
    spy.mockResolvedValueOnce(new Response("oops", { status: 502 }));
    expect(await bffForm("/x", new FormData())).toMatchObject({ ok: false, status: 502, code: "UNKNOWN" });
    spy.mockRejectedValueOnce(new TypeError("offline"));
    expect(await bffForm("/x", new FormData())).toMatchObject({ ok: false, status: 0, code: "SERVICE_UNAVAILABLE" });
  });

  it("bffDownload: PDF Blob과 Content-Disposition 파일 이름, 실패 코드, 연결 실패", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    spy.mockResolvedValueOnce(new Response("%PDF", { headers: { "Content-Type": "application/pdf", "Content-Disposition": 'attachment; filename="qr-labels.pdf"' } }));
    const pdf = await fieldApi.qrLabels(["1042"], "A4_3x8");
    expect(pdf.ok && pdf.fileName).toBe("qr-labels.pdf");
    expect(pdf.ok && (await pdf.blob.text())).toBe("%PDF");
    expect(JSON.parse(String(spy.mock.calls[0][1]?.body))).toEqual({ deviceIds: ["1042"], layout: "A4_3x8" });
    spy.mockResolvedValueOnce(new Response("x"));
    expect(await bffDownload("/y")).toMatchObject({ ok: true, fileName: "download" });
    spy.mockResolvedValueOnce(envelope(null, 403, "PERMISSION_DENIED"));
    expect(await bffDownload("/y", { method: "POST", body: {} })).toEqual({ ok: false, status: 403, code: "PERMISSION_DENIED" });
    spy.mockResolvedValueOnce(new Response("bad", { status: 500 }));
    expect(await bffDownload("/y")).toEqual({ ok: false, status: 500, code: "UNKNOWN" });
    spy.mockRejectedValueOnce(new TypeError("offline"));
    expect(await bffDownload("/y")).toEqual({ ok: false, status: 0, code: "SERVICE_UNAVAILABLE" });
  });
});
