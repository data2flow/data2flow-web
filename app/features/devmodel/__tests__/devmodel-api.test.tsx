/**
 * 기기·모델 데이터 관리 브라우저 API(BFF `/bff/api/core/**`) 경로·메서드·본문: API-DEV-134·44·45·135·136, 출력 연결 목록.
 * multipart 업로드는 CSRF 헤더를 붙이고 Content-Type은 브라우저가 정한다(DEV-03.04).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { browserDownload, devModelApi } from "../api";

const calls: { url: string; init: RequestInit }[] = [];
let reply: () => Response = () => new Response(JSON.stringify({ header: { resultCode: "SUCCESS" }, response: { id: "1" } }), { status: 200 });

beforeEach(() => {
  calls.length = 0;
  document.head.innerHTML = '<meta name="csrf-token" content="csrf-1">';
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return reply();
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  reply = () => new Response(JSON.stringify({ header: { resultCode: "SUCCESS" }, response: { id: "1" } }), { status: 200 });
});

const last = () => calls.at(-1) as { url: string; init: RequestInit };

describe("DEV-13.03·03.04·13.04 devModelApi", () => {
  it("TC-DEV-314: 저장된 검색 목록·생성(멱등 키)·수정(PUT)·삭제", async () => {
    await devModelApi.savedSearches();
    expect(last().url).toBe("/bff/api/core/saved-searches?size=100");
    await devModelApi.saveSearch({ name: "a", query: "battery < 1", shared: true });
    expect(last().url).toBe("/bff/api/core/saved-searches");
    expect(last().init.method).toBe("POST");
    expect(new Headers(last().init.headers).get("Idempotency-Key")).toBeTruthy();
    await devModelApi.saveSearch({ name: "a", query: "battery < 1", shared: true }, "5");
    expect(last()).toMatchObject({ url: "/bff/api/core/saved-searches/5", init: { method: "PUT" } });
    await devModelApi.deleteSearch("5");
    expect(last().init.method).toBe("DELETE");
  });

  it("TC-DEV-109: 모델 내보내기 형식, 가져오기 multipart(file·format·createMissingMetrics·dryRun) + CSRF", async () => {
    await devModelApi.exportModel("11", "dtdl");
    expect(last().url).toBe("/bff/api/core/device-models/11/export?format=dtdl");
    const file = new File(["{}"], "m.json");
    const result = await devModelApi.importModel({ file, format: "dtdl", createMissingMetrics: false, dryRun: true });
    expect(result).toEqual({ ok: true, status: 200, data: { id: "1" } });
    const body = last().init.body as FormData;
    expect(body.get("file")).toBeInstanceOf(File);
    expect([body.get("format"), body.get("createMissingMetrics"), body.get("dryRun")]).toEqual(["dtdl", "false", "true"]);
    expect(new Headers(last().init.headers).get("X-CSRF-TOKEN")).toBe("csrf-1");
    await devModelApi.importModel({ file, format: "", createMissingMetrics: true, dryRun: false });
    expect((last().init.body as FormData).has("format")).toBe(false);

    reply = () => new Response(JSON.stringify({ header: { resultCode: "MODEL_CODE_DUPLICATE", resultMessage: "중복" }, errors: [] }), { status: 409 });
    expect(await devModelApi.importModel({ file, createMissingMetrics: true, dryRun: false })).toEqual({ ok: false, status: 409, code: "MODEL_CODE_DUPLICATE", message: "중복", errors: [] });
    reply = () => new Response("not json", { status: 500 });
    expect(await devModelApi.importModel({ file, createMissingMetrics: true, dryRun: false })).toMatchObject({ ok: false, status: 500, code: "UNKNOWN" });
    reply = () => {
      throw new TypeError("network");
    };
    expect(await devModelApi.importModel({ file, createMissingMetrics: true, dryRun: false })).toMatchObject({ ok: false, status: 0, code: "SERVICE_UNAVAILABLE" });
  });

  it("TC-DEV-319: 표준 내보내기·작업·NGSI-LD 주기 전송·출력 연결", async () => {
    await devModelApi.exportStandard({ format: "DTDL", scope: { spaceIds: ["3"], deviceIds: [] }, includeValues: false });
    expect(last()).toMatchObject({ url: "/bff/api/core/devices/export-standard", init: { method: "POST" } });
    expect(JSON.parse(last().init.body as string)).toEqual({ format: "DTDL", scope: { spaceIds: ["3"], deviceIds: [] }, includeValues: false });
    await devModelApi.exportJob("9");
    expect(last().url).toBe("/bff/api/core/export-jobs/9");
    await devModelApi.ngsiPushes();
    expect(last().url).toBe("/bff/api/core/ngsi-pushes");
    await devModelApi.createNgsiPush({ outputConnectionId: "81", scope: { spaceIds: [], deviceIds: ["1"] }, intervalSec: 300 });
    expect(last().init.method).toBe("POST");
    await devModelApi.deleteNgsiPush("4");
    expect(last()).toMatchObject({ url: "/bff/api/core/ngsi-pushes/4", init: { method: "DELETE" } });
    await devModelApi.outputConnections();
    expect(last().url).toBe("/bff/api/core/output-connections?size=100");
  });

  it("TC-DEV-112: 내려받기는 Blob 주소를 만든 a 링크를 눌렀다가 지운다", () => {
    vi.useFakeTimers();
    const create = vi.fn(() => "blob:x");
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    browserDownload("m.json", "{}", "application/json");
    expect(click).toHaveBeenCalled();
    expect(document.querySelector("a[download]")).toBeNull();
    vi.runAllTimers();
    expect(revoke).toHaveBeenCalledWith("blob:x");
    vi.useRealTimers();
  });
});
