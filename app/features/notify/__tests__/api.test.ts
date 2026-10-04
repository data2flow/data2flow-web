/** 알림 화면 브라우저 API 경로(API-RUL-30 메신저 연결, API-RUL-22 미리 보기) */
import { afterEach, describe, expect, it, vi } from "vitest";
import { notifyApi } from "../api";

afterEach(() => vi.unstubAllGlobals());

describe("notifyApi", () => {
  it("BFF 경로와 메서드·본문", async () => {
    const calls: { url: string; method: string; body?: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, method: String(init.method), body: init.body as string | undefined });
        return init.method === "DELETE" ? new Response(null, { status: 204 }) : Response.json({ header: { isSuccessful: true, resultCode: "SUCCESS" }, response: { ok: true } });
      }),
    );
    await notifyApi.startLink("TELEGRAM");
    await notifyApi.unlink("TELEGRAM");
    await notifyApi.links();
    await notifyApi.previewTemplate("71", "501");
    expect(calls).toEqual([
      { url: "/bff/api/core/accounts/me/messenger-links/start", method: "POST", body: '{"channel":"TELEGRAM"}' },
      { url: "/bff/api/core/accounts/me/messenger-links/TELEGRAM", method: "DELETE", body: undefined },
      { url: "/bff/api/core/accounts/me/messenger-links", method: "GET", body: undefined },
      { url: "/bff/api/core/notification-templates/71/preview", method: "POST", body: '{"alarmId":"501"}' },
    ]);
  });
});
