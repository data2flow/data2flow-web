/**
 * M5 데이터 관리 브라우저 API 묶음(design/api/TSD-api.md §2~§4): 경로·메서드·멱등 키·CSRF·multipart 업로드, 파일 내려받기.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { browserDownload, defaultDataApi } from "../api";

type Call = { url: string; init: RequestInit };

function stubFetch(status = 200, body: unknown = { header: { isSuccessful: true, resultCode: "SUCCESS" }, response: { id: "1" } }) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    }),
  );
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.head.innerHTML = "";
});

describe("TSD-04 TSD-05 DataApi 경로", () => {
  it("API-TSD-20~23·56·30~32·41·42 경로와 메서드, 쓰기에 CSRF·멱등 키", async () => {
    document.head.innerHTML = '<meta name="csrf-token" content="csrf-1">';
    const calls = stubFetch();
    const api = defaultDataApi;
    await api.createExport({ format: "CSV" });
    await api.listExports(2);
    await api.getExport("7");
    await api.cancelExport("7");
    await api.listSchedules();
    await api.createSchedule({ name: "a" });
    await api.updateSchedule("5", { enabled: false, baseVersion: 3 });
    await api.testTarget({ targetType: "S3" });
    await api.createInfluxImport({ url: "http://x" });
    await api.getImport("9");
    await api.importErrors("9");
    await api.runImport("9");
    await api.previewRetention([{ scope: "ORG" }]);
    await api.saveRetention([{ scope: "ORG" }], "tok");
    await api.saveRetention([], null);
    expect(calls.map((c) => `${c.init.method ?? "GET"} ${c.url}`)).toEqual([
      "POST /bff/api/core/exports",
      "GET /bff/api/core/exports?page=2&size=20",
      "GET /bff/api/core/exports/7",
      "POST /bff/api/core/exports/7/cancel",
      "GET /bff/api/core/export-schedules?size=100",
      "POST /bff/api/core/export-schedules",
      "PATCH /bff/api/core/export-schedules/5",
      "POST /bff/api/core/export-schedules/test-target",
      "POST /bff/api/core/imports",
      "GET /bff/api/core/imports/9",
      "GET /bff/api/core/imports/9/errors?size=100",
      "POST /bff/api/core/imports/9/run",
      "POST /bff/api/core/retention-policies/preview",
      "PUT /bff/api/core/retention-policies",
      "PUT /bff/api/core/retention-policies",
    ]);
    const headers = new Headers(calls[0].init.headers);
    expect(headers.get("X-CSRF-TOKEN")).toBe("csrf-1");
    expect(headers.get("Idempotency-Key")).toBeTruthy();
    expect(JSON.parse(String(calls[13].init.body))).toEqual({ items: [{ scope: "ORG" }], confirmToken: "tok" });
    expect(JSON.parse(String(calls[14].init.body))).toEqual({ items: [] });
    const deleted = stubFetch(204);
    expect((await api.deleteSchedule("5")).ok).toBe(true);
    expect(deleted[0].init.method).toBe("DELETE");
  });

  it("CSV 가져오기는 multipart(file·mapping JSON·originLabel·dryRun), 실패는 코드·필드 오류", async () => {
    const calls = stubFetch(202, { header: { isSuccessful: true, resultCode: "SUCCESS" }, response: { id: "10", status: "QUEUED" } });
    const file = new File(["a,b"], "a.csv", { type: "text/csv" });
    const ok = await defaultDataApi.createCsvImport(file, { timeColumn: "time" }, "라벨", true);
    expect(ok).toEqual({ ok: true, status: 202, data: { id: "10", status: "QUEUED" } });
    const form = calls[0].init.body as FormData;
    expect(form.get("mapping")).toBe('{"timeColumn":"time"}');
    expect(form.get("originLabel")).toBe("라벨");
    expect(form.get("dryRun")).toBe("true");
    expect((form.get("file") as File).name).toBe("a.csv");

    stubFetch(400, { header: { isSuccessful: false, resultCode: "IMPORT_FILE_INVALID", resultMessage: "bad" }, errors: [{ field: "mapping.tz", code: "INVALID", message: "" }] });
    expect(await defaultDataApi.createCsvImport(file, {}, "x", true)).toEqual({ ok: false, status: 400, code: "IMPORT_FILE_INVALID", message: "bad", errors: [{ field: "mapping.tz", code: "INVALID", message: "" }] });
    stubFetch(500, "not json");
    expect(await defaultDataApi.createCsvImport(file, {}, "x", true)).toMatchObject({ ok: false, status: 500, code: "UNKNOWN" });
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("offline"))));
    expect(await defaultDataApi.createCsvImport(file, {}, "x", true)).toMatchObject({ ok: false, code: "SERVICE_UNAVAILABLE" });
  });

  it("browserDownload는 a[download]를 눌렀다가 지운다", () => {
    const clicks: HTMLAnchorElement[] = [];
    const original = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function click(this: HTMLAnchorElement) {
      clicks.push(this);
    };
    browserDownload("/bff/api/core/exports/7/file", "a.csv");
    browserDownload("/x");
    HTMLAnchorElement.prototype.click = original;
    expect(clicks[0].getAttribute("href")).toBe("/bff/api/core/exports/7/file");
    expect(clicks[0].download).toBe("a.csv");
    expect(clicks[1].hasAttribute("download")).toBe(false);
    expect(document.querySelector("a")).toBeNull();
  });
});
