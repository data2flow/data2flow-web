/**
 * 대시보드 loader 도우미(NFR-01.09 첫 화면 위젯 병렬 조회·제한 시간, 변수 선택지, 공유 링크 공개 호출)와 브라우저 API 도우미(API-DSH-07·09·10·12)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { headerBrand } from "~/components/app-shell";
import type { BffRequestContext } from "~/bff/middleware.server";

const callApi = vi.fn();
const callList = vi.fn();
vi.mock("~/bff/api.server", () => ({ callApi: (...a: unknown[]) => callApi(...a), callList: (...a: unknown[]) => callList(...a) }));

const { FIRST_PAINT_WIDGETS, brandingAssetPath, firstPaintData, loadShared, sharedRequestBody, variableOptions } = await import("../server");
const { dashboardsApi } = await import("../api");

const ctx = {} as BffRequestContext;
const request = new Request("https://data2flow.java21.net/dashboards/1");
const dashboard = {
  id: "1",
  name: "A",
  visibility: "ORG",
  layout: {
    widgets: [
      { id: "late", type: "stat", x: 0, y: 9, w: 4, h: 4 },
      { id: "first", type: "stat", x: 4, y: 0, w: 4, h: 4 },
      { id: "memo", type: "markdown", x: 0, y: 0, w: 4, h: 4 },
      { id: "bad", type: "stat", x: 8, y: 0, w: 4, h: 4 },
    ],
  },
  variables: [{ name: "space", type: "SPACE", default: "31" }],
  timeRange: { relative: "24h" },
  resolution: "AUTO",
  refresh: "LIVE",
  version: 1,
};

describe("NFR-01.09 첫 화면 위젯 데이터", () => {
  beforeEach(() => {
    callApi.mockReset();
    callList.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("TC-NFR-009: 읽는 순서로 앞쪽 위젯만(메모 제외) 병렬 조회, 실패는 그 위젯 오류, 제한 시간을 넘긴 위젯은 빼고 그린다", async () => {
    vi.useFakeTimers();
    callApi.mockImplementation((_c: unknown, _r: unknown, path: string, opts: { body: unknown }) => {
      if (path.endsWith("/late/data")) return new Promise(() => undefined);
      if (path.endsWith("/bad/data")) return Promise.resolve({ ok: false, status: 503, code: "SERVICE_UNAVAILABLE", message: "" });
      return Promise.resolve({ ok: true, status: 200, data: { type: "stat", data: { value: 1, body: opts.body } } });
    });
    const pending = firstPaintData(ctx, request, dashboard as never, { space: "32" });
    await vi.advanceTimersByTimeAsync(2_100);
    const states = await pending;
    expect(Object.keys(states).sort()).toEqual(["bad", "first"]);
    expect(states.first).toMatchObject({ status: "ok", data: { data: { body: { timeRange: { relative: "24h" }, resolution: "AUTO", variables: { space: "32" } } } } });
    expect(states.bad).toEqual({ status: "error", code: "SERVICE_UNAVAILABLE" });
    expect(callApi.mock.calls.map((c) => c[2])).toEqual(["/api/v1/core/dashboards/1/widgets/first/data", "/api/v1/core/dashboards/1/widgets/bad/data", "/api/v1/core/dashboards/1/widgets/late/data"]);
    expect(FIRST_PAINT_WIDGETS).toBe(12);
  });

  it("거부된 요청은 그 위젯을 빼고, limit만큼만", async () => {
    callApi.mockRejectedValueOnce(new Error("x"));
    const states = await firstPaintData(ctx, request, dashboard as never, {}, 1);
    expect(states).toEqual({});
    expect(callApi).toHaveBeenCalledTimes(1);
  });
});

describe("DSH-04.05 변수 선택지", () => {
  beforeEach(() => {
    callApi.mockReset();
    callList.mockReset();
  });
  it("종류가 있을 때만 공간 트리·기기·검증된 측정 항목을 읽어 선택지로", async () => {
    callApi.mockResolvedValue({ ok: true, status: 200, data: [{ id: 1, name: "캠퍼스", type: "SITE", children: [{ id: 31, name: "실습실", type: "ROOM" }] }] });
    callList.mockImplementation((_c: unknown, _r: unknown, path: string) =>
      Promise.resolve(path.includes("/devices") ? { ok: true, list: { responses: [{ id: 1042, name: "CO2 센서" }] } } : { ok: true, list: { responses: [{ key: "co2", displayName: "CO2" }, { key: "lux" }] } }),
    );
    const out = await variableOptions(ctx, request, [
      { name: "space", type: "SPACE" },
      { name: "dev", type: "DEVICE" },
      { name: "m", type: "METRIC" },
      { name: "x", type: "OTHER" },
    ]);
    expect(out).toEqual({
      space: [
        { value: "1", label: "캠퍼스" },
        { value: "31", label: "캠퍼스 › 실습실" },
      ],
      dev: [{ value: "1042", label: "CO2 센서" }],
      m: [
        { value: "co2", label: "CO2 (co2)" },
        { value: "lux", label: "lux" },
      ],
      x: [],
    });
    expect(callList.mock.calls.map((c) => c[2])).toEqual(["/api/v1/core/devices?status=ACTIVE&size=100", "/api/v1/core/metrics?status=VERIFIED&size=100"]);
    callApi.mockReset();
    callList.mockReset();
    expect(await variableOptions(ctx, request, [])).toEqual({});
    expect(callApi).not.toHaveBeenCalled();
    callApi.mockResolvedValue({ ok: false, status: 500, code: "X" });
    callList.mockResolvedValue({ ok: false, status: 500, code: "X" });
    expect(await variableOptions(ctx, request, [{ name: "s", type: "SPACE" }, { name: "d", type: "DEVICE" }, { name: "m", type: "METRIC" }])).toEqual({ s: [], d: [], m: [] });
  });
});

describe("DSH-06.03 공유 링크(공개)", () => {
  beforeEach(() => callApi.mockReset());
  it("토큰 형식이 틀리면 gateway를 부르지 않고 404, 맞으면 로그인 없이(anonymous) 공개 경로", async () => {
    expect(await loadShared(ctx, request, "short")).toEqual({ ok: false, code: "SHARE_LINK_INVALID", status: 404 });
    expect(callApi).not.toHaveBeenCalled();
    callApi.mockResolvedValueOnce({ ok: true, status: 200, data: { dashboard: { name: "A" }, expiresAt: "x" } });
    expect(await loadShared(ctx, request, "tok_AbCdEfGhIjKlMnOp")).toMatchObject({ ok: true, shared: { dashboard: { name: "A" } } });
    expect(callApi.mock.calls[0][2]).toBe("/api/v1/core/public/share/tok_AbCdEfGhIjKlMnOp");
    expect(callApi.mock.calls[0][3]).toEqual({ anonymous: true, noGuards: true });
    callApi.mockResolvedValueOnce({ ok: false, status: 404, code: "SHARE_LINK_INVALID" });
    expect(await loadShared(ctx, request, "tok_AbCdEfGhIjKlMnOp")).toEqual({ ok: false, code: "SHARE_LINK_INVALID", status: 404 });
  });

  it("TC-DSH-068: 공개 위젯 요청 본문은 범위·집계·변수(형식 맞는 10개)만 골라 보낸다", () => {
    expect(sharedRequestBody(JSON.stringify({ timeRange: { relative: "24h-very-long" }, resolution: "AUTO", variables: { space: "31", "bad key": "1", long: "x".repeat(65), n: 3 }, evil: true }))).toEqual({
      timeRange: { relative: "24h-very" },
      resolution: "AUTO",
      variables: { space: "31" },
    });
    expect(sharedRequestBody(JSON.stringify({ timeRange: { from: "2026-10-01T00:00:00Z", to: 5 } }))).toEqual({ timeRange: { from: "2026-10-01T00:00:00Z", to: null } });
    expect(sharedRequestBody("{bad")).toEqual({});
    expect(sharedRequestBody(null)).toEqual({});
    expect(brandingAssetPath("12")).toBe("/api/v1/core/public/branding/assets/12");
    expect(brandingAssetPath("../x")).toBeNull();
  });
});

describe("DSH-13.01 헤더 브랜딩", () => {
  it("AT-DSH-14.1: 공개 자산 주소는 BFF 경로로, 색은 HEX만", () => {
    expect(headerBrand({ logoLightUrl: "/api/v1/core/public/branding/assets/5", logoDarkUrl: "https://evil/x.png", primaryColor: "#0055AA", appName: "학교" })).toEqual({ logoLightUrl: "/branding/assets/5", logoDarkUrl: null, primaryColor: "#0055AA", appName: "학교" });
    expect(headerBrand({ primaryColor: "red" })).toEqual({ logoLightUrl: null, logoDarkUrl: null, primaryColor: null, appName: null });
  });
});

describe("API-DSH-07·09·10·12 브라우저 호출", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  const reply = (status: number, body: unknown) => Promise.resolve(new Response(body === undefined ? null : JSON.stringify(body), { status }));

  it("저장: 성공은 대시보드, 409는 최신 판, 네트워크 오류는 SERVICE_UNAVAILABLE", async () => {
    fetchMock.mockReturnValueOnce(reply(200, { header: { resultCode: "SUCCESS" }, response: { id: "1", version: 4 } }));
    expect(await dashboardsApi.save("1", { baseVersion: 3 })).toEqual({ ok: true, dashboard: { id: "1", version: 4 } });
    expect(fetchMock.mock.calls[0][0]).toBe("/bff/api/core/dashboards/1");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "PUT" });
    fetchMock.mockReturnValueOnce(reply(409, { header: { resultCode: "DASHBOARD_VERSION_CONFLICT", resultMessage: "충돌" }, response: { version: 5, updatedByName: "이통합" } }));
    expect(await dashboardsApi.save("1", {})).toEqual({ ok: false, status: 409, code: "DASHBOARD_VERSION_CONFLICT", message: "충돌", conflict: { version: 5, updatedByName: "이통합" }, errors: undefined });
    fetchMock.mockReturnValueOnce(reply(400, null));
    expect(await dashboardsApi.save("1", {})).toMatchObject({ ok: false, status: 400, code: "UNKNOWN", conflict: undefined });
    fetchMock.mockRejectedValueOnce(new Error("net"));
    expect(await dashboardsApi.save("1", {})).toMatchObject({ ok: false, code: "SERVICE_UNAVAILABLE" });
  });

  it("위젯 데이터·미리 보기·만들기·복제·삭제·내보내기·가져오기·기본 지정·공유 링크·화면 설정 경로", async () => {
    fetchMock.mockImplementation(() => reply(200, { header: { resultCode: "SUCCESS" }, response: { version: 2 } }));
    await dashboardsApi.widgetData("1", "w 1", { resolution: "AUTO" });
    await dashboardsApi.preview({ widget: {}, variableDefinitions: [] });
    await dashboardsApi.create({ name: "A" });
    await dashboardsApi.duplicate("1");
    await dashboardsApi.remove("1");
    await dashboardsApi.exportJson("1");
    await dashboardsApi.importJson({ dashboard: {} });
    await dashboardsApi.setDefault("1");
    await dashboardsApi.shareLinks("1");
    await dashboardsApi.createShareLink("1", 7);
    await dashboardsApi.revokeShareLink("1", "9");
    await dashboardsApi.savePreferences({ toursDismissed: ["dash"] });
    expect(fetchMock.mock.calls.map((c) => `${(c[1] as RequestInit).method} ${c[0]}`)).toEqual([
      "POST /bff/api/core/dashboards/1/widgets/w%201/data",
      "POST /bff/api/core/widgets/preview",
      "POST /bff/api/core/dashboards",
      "POST /bff/api/core/dashboards/1/duplicate",
      "DELETE /bff/api/core/dashboards/1",
      "GET /bff/api/core/dashboards/1/export",
      "POST /bff/api/core/dashboards/import",
      "PUT /bff/api/core/accounts/me/default-dashboard",
      "GET /bff/api/core/dashboards/1/share-links",
      "POST /bff/api/core/dashboards/1/share-links",
      "DELETE /bff/api/core/dashboards/1/share-links/9",
      "GET /bff/api/core/accounts/me/preferences",
      "PUT /bff/api/core/accounts/me/preferences",
    ]);
    expect(JSON.parse(String((fetchMock.mock.calls.at(-1)![1] as RequestInit).body))).toEqual({ toursDismissed: ["dash"], baseVersion: 2 });
    expect(new Headers((fetchMock.mock.calls[2][1] as RequestInit).headers).get("Idempotency-Key")).toBeTruthy();
    fetchMock.mockImplementationOnce(() => reply(500, { header: { resultCode: "X" } }));
    expect(await dashboardsApi.savePreferences({})).toMatchObject({ ok: false, code: "X" });
  });
});
