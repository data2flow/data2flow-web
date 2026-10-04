/** 알림 화면 loader·action 공용: 목록 응답 모양 흡수, 보조 목록 실패 대체값(채널 유형 ADR-033, 회원 목록 관리자 전용) */
import { beforeEach, describe, expect, it, vi } from "vitest";

const callApi = vi.fn();
const callList = vi.fn();
vi.mock("~/bff/api.server", () => ({ callApi: (...args: unknown[]) => callApi(...args), callList: (...args: unknown[]) => callList(...args) }));

const { FALLBACK_CHANNEL_TYPES, done, failed, invalid, loadChannelTypes, loadRows, loadSpaces, loadUsers, str } = await import("../server");

const ctx = {} as never;
const request = new Request("https://data2flow.java21.net/");
const list = (responses: unknown[], extra: Record<string, unknown> = {}) => ({ ok: true, status: 200, list: { header: {}, responses, ...extra } });

beforeEach(() => {
  callApi.mockReset();
  callList.mockReset();
});

describe("notify server helpers", () => {
  it("loadRows: responses 목록, response 배열, 커서, 실패", async () => {
    callList.mockResolvedValueOnce(list([{ a: 1 }], { nextCursor: "c2" }));
    expect(await loadRows(ctx, request, "/x")).toEqual({ ok: true, rows: [{ a: 1 }], nextCursor: "c2", status: 200 });
    callList.mockResolvedValueOnce(list([], { response: [{ b: 2 }] }));
    expect((await loadRows(ctx, request, "/x")).rows).toEqual([{ b: 2 }]);
    callList.mockResolvedValueOnce(list([], { response: { responses: [{ c: 3 }], nextCursor: "n" } }));
    expect(await loadRows(ctx, request, "/x")).toMatchObject({ rows: [{ c: 3 }], nextCursor: "n" });
    callList.mockResolvedValueOnce({ ok: false, status: 403, code: "PERMISSION_DENIED", message: "" });
    expect(await loadRows(ctx, request, "/x")).toEqual({ ok: false, rows: [], status: 403, code: "PERMISSION_DENIED" });
    expect(callList).toHaveBeenCalledWith(ctx, request, "/x", { noGuards: true });
  });

  it("채널 유형: 받으면 그대로(available은 참일 때만) + 준비 중 유형, 이름이 없으면(action SPI) 기본 이름, 없으면 텔레그램만 가능한 기본값", async () => {
    callList.mockResolvedValueOnce(list([{ key: "TELEGRAM", displayName: "Telegram", available: true }, { key: "SMS", displayName: "SMS" }]));
    expect((await loadChannelTypes(ctx, request)).map((t) => `${t.key}:${t.available}`)).toEqual(["TELEGRAM:true", "SMS:false", "EMAIL:false", "SLACK:false", "KAKAO_ALIMTALK:false", "WEBHOOK:false"]);
    callList.mockResolvedValueOnce(list([{ key: "TELEGRAM", available: true, configSchema: { properties: {} } }]));
    const fromAction = await loadChannelTypes(ctx, request);
    expect(fromAction[0]).toMatchObject({ key: "TELEGRAM", displayName: "Telegram", available: true });
    expect(fromAction.filter((t) => !t.available)).toHaveLength(5);
    callList.mockResolvedValueOnce({ ok: false, status: 404, code: "RESOURCE_NOT_FOUND", message: "" });
    expect(await loadChannelTypes(ctx, request)).toBe(FALLBACK_CHANNEL_TYPES);
    expect(FALLBACK_CHANNEL_TYPES.filter((t) => t.available).map((t) => t.key)).toEqual(["TELEGRAM"]);
  });

  it("회원 목록(관리자만)과 공간 트리는 실패해도 빈 값", async () => {
    callList.mockResolvedValueOnce(list([{ id: 1, name: "" , loginId: "admin01" }, { id: 7, name: "김운영" }, { id: 9, name: "" }]));
    expect(await loadUsers(ctx, request)).toEqual({ available: true, users: [{ id: "1", name: "admin01" }, { id: "7", name: "김운영" }, { id: "9", name: "9" }] });
    callList.mockResolvedValueOnce({ ok: false, status: 403, code: "PERMISSION_DENIED", message: "" });
    expect(await loadUsers(ctx, request)).toEqual({ users: [], available: false });
    callApi.mockResolvedValueOnce({ ok: true, status: 200, data: [{ id: "1", name: "캠퍼스" }] });
    expect(await loadSpaces(ctx, request)).toHaveLength(1);
    callApi.mockResolvedValueOnce({ ok: true, status: 200, data: undefined });
    expect(await loadSpaces(ctx, request)).toEqual([]);
    callApi.mockResolvedValueOnce({ ok: false, status: 503, code: "SERVICE_UNAVAILABLE", message: "" });
    expect(await loadSpaces(ctx, request)).toEqual([]);
  });

  it("action 결과 모양", () => {
    expect(done("save", "k", { a: 1 })).toEqual({ intent: "save", done: "k", payload: { a: 1 } });
    const f = failed("save", { status: 409, code: "VERSION_CONFLICT", message: "m" }, { name: "x" });
    expect(f.init?.status).toBe(409);
    expect(f.data).toMatchObject({ intent: "save", error: { code: "VERSION_CONFLICT", message: "m" }, fieldErrors: { name: "x" } });
    expect(failed("x", { status: 0, code: "SERVICE_UNAVAILABLE", message: "" }).init?.status).toBe(500);
    expect(invalid("save", { name: "nameRequired" }).init?.status).toBe(400);
    const form = new FormData();
    form.set("a", "1");
    expect(str(form, "a")).toBe("1");
    expect(str(form, "b")).toBe("");
  });
});
