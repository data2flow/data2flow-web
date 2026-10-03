/**
 * SSE 중계(stream-proxy.test, frontend.md §3.1): IAM-07.06, DSH-05.01.
 */
import { http, HttpResponse } from "msw";
import { RouterContextProvider } from "react-router";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { login } from "../auth-flow.server";
import { bff, bffMiddleware } from "../middleware.server";
import { proxyStream, streamTarget } from "../stream-proxy.server";
import { cookieValue, setup } from "./helpers";

const t = setup();
beforeAll(() => t.server.listen({ onUnhandledFrame: "error" }));
afterAll(() => t.server.close());
beforeEach(() => t.reset());

const ORIGIN = "https://data2flow.java21.net";

async function cookieFor(loginId = "kim.op", password = "Correct-Horse-9") {
  const session = t.session();
  await login(session, loginId, password);
  return cookieValue(session.commit());
}

async function open(path: string, cookie?: string, init: { signal?: AbortSignal; headers?: Record<string, string> } = {}) {
  const request = new Request(`${ORIGIN}${path}`, { headers: { ...(cookie ? { Cookie: `data2flow_session=${cookie}` } : {}), ...init.headers }, signal: init.signal });
  const context = new RouterContextProvider();
  const response = (await bffMiddleware({ request, context, params: {}, unstable_pattern: "" } as never, async () => proxyStream(request, bff(context), path.replace(/^\/bff\/stream\//, "").split("?")[0]))) as Response;
  return response;
}

async function readUntil(reader: ReadableStreamDefaultReader<Uint8Array>, needle: string) {
  const decoder = new TextDecoder();
  let text = "";
  while (!text.includes(needle)) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value);
  }
  return text;
}

describe("IAM-07.06 TC-IAM-198 실시간 연결은 세션 쿠키로 BFF에, BFF는 토큰으로 내부에", () => {
  it("AT-IAM-22.1 세션 쿠키만으로 연결하면 BFF가 Bearer를 붙여 core SSE에 연결하고 이벤트를 그대로 흘린다(토큰은 브라우저로 가지 않음)", async () => {
    const cookie = await cookieFor();
    const response = await open("/bff/stream/live?topics=telemetry:1042.co2", cookie);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/event-stream");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const upstream = t.state.gateway.received.find((r) => r.path.startsWith("/api/v1/core/stream/live"));
    expect(upstream?.path).toBe("/api/v1/core/stream/live?topics=telemetry:1042.co2");
    expect(upstream?.headers.authorization).toMatch(/^Bearer eyJ/);
    expect(upstream?.headers.accept).toBe("text/event-stream");
    const reader = response.body!.getReader();
    t.state.gateway.emit("point", { deviceId: "1042", metricKey: "co2", t: "2026-10-04T00:00:05Z", v: 530, quality: 0, virtual: false }, "e-1");
    const text = await readUntil(reader, "530");
    expect(text).toContain("event: point");
    expect(text).toContain("id: e-1");
    expect(text).not.toMatch(/eyJ[A-Za-z0-9_-]+\./);
    await reader.cancel();
  });

  it("AT-IAM-22.2 세션이 없거나 폐기되었으면 401(결과 코드), 세션 쿠키 삭제", async () => {
    expect((await open("/bff/stream/live?topics=home")).status).toBe(401);
    const cookie = await cookieFor();
    t.state.gateway.revokeUser("7");
    t.state.gateway.expireAccessTokens();
    const response = await open("/bff/stream/live?topics=home", cookie);
    expect(response.status).toBe(401);
    expect((await response.json()).header.resultCode).toBe("AUTH_SESSION_REVOKED");
    expect(response.headers.get("Set-Cookie")).toMatch(/data2flow_session=;.*Max-Age=0/i);
  });

  it("TC-DSH-052 Access가 만료되었으면 재발급 후 연결하고 Last-Event-ID를 넘긴다", async () => {
    const cookie = await cookieFor();
    t.state.gateway.expireAccessTokens();
    const before = t.state.gateway.refreshCalls;
    const response = await open("/bff/stream/live?topics=notifications", cookie, { headers: { "Last-Event-ID": "n-41" } });
    expect(response.status).toBe(200);
    expect(t.state.gateway.refreshCalls).toBe(before + 1);
    const upstream = t.state.gateway.received.filter((r) => r.path.startsWith("/api/v1/core/stream/live")).at(-1);
    expect(upstream?.headers["last-event-id"]).toBe("n-41");
    await response.body!.cancel();
  });

  it("TC-DSH-052 브라우저가 연결을 끊으면 업스트림 연결도 정리한다(누수 없음)", async () => {
    const cookie = await cookieFor();
    const signals: AbortSignal[] = [];
    const original = t.state.runtime.fetch;
    t.state.runtime.fetch = (input, init) => {
      if (String(input).includes("/stream/") && init?.signal) signals.push(init.signal);
      return original(input, init);
    };
    const controller = new AbortController();
    const response = await open("/bff/stream/ingest?channels=stats", cookie, { signal: controller.signal });
    const reader = response.body!.getReader();
    await reader.read();
    expect(signals).toHaveLength(1);
    expect(signals[0].aborted).toBe(false);
    controller.abort();
    expect(signals[0].aborted).toBe(true);
    await reader.cancel();
  });

  it("gateway가 연결을 닫으면 BFF 응답도 끝난다(브라우저가 다시 연결)", async () => {
    const cookie = await cookieFor();
    const response = await open("/bff/stream/sources/7/live?topicFilter=application", cookie);
    expect(t.state.gateway.received.some((r) => r.path === "/api/v1/core/sources/7/live?topicFilter=application")).toBe(true);
    const reader = response.body!.getReader();
    await reader.read();
    t.state.gateway.closeStreams();
    const { done } = await reader.read();
    expect(done).toBe(true);
  });

  it("허용 목록 밖 경로는 404, SSE가 아닌 응답·gateway 장애는 오류 코드로", async () => {
    const cookie = await cookieFor();
    expect((await open("/bff/stream/admin/secrets", cookie)).status).toBe(404);
    t.server.use(http.get("http://gateway.test/api/v1/core/stream/live", () => HttpResponse.json({ header: { isSuccessful: false, resultCode: "PERMISSION_DENIED", resultMessage: "" } }, { status: 403 })));
    const denied = await open("/bff/stream/live?topics=ingest", cookie);
    expect(denied.status).toBe(403);
    expect((await denied.json()).header.resultCode).toBe("PERMISSION_DENIED");
    t.server.use(http.get("http://gateway.test/api/v1/core/stream/live", () => HttpResponse.json({ header: { isSuccessful: true, resultCode: "SUCCESS", resultMessage: "" } })));
    expect((await open("/bff/stream/live?topics=home", cookie)).status).toBe(502);
    t.server.use(http.get("http://gateway.test/api/v1/core/stream/live", () => HttpResponse.error()));
    expect((await open("/bff/stream/live?topics=home", cookie)).status).toBe(503);
  });
});

describe("streamTarget 허용 목록", () => {
  it("live·ingest·ops/components·sources/{id}/live만, 경로 조작은 거부", () => {
    expect(streamTarget("live", "?topics=a")).toBe("/api/v1/core/stream/live?topics=a");
    expect(streamTarget("ingest", "")).toBe("/api/v1/core/stream/ingest");
    expect(streamTarget("ops/components", "")).toBe("/api/v1/core/stream/ops/components");
    expect(streamTarget("sources/7/live", "")).toBe("/api/v1/core/sources/7/live");
    expect(streamTarget("sources/abc/live", "")).toBeUndefined();
    expect(streamTarget("../auth/login", "")).toBeUndefined();
    expect(streamTarget("live/../x", "")).toBeUndefined();
  });
});
