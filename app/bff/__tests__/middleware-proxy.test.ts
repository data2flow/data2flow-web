/**
 * BFF 미들웨어·중계·loader 도우미 단위 테스트(csrf.test·proxy.test·security-headers.test, frontend.md §3.1).
 */
import { http, HttpResponse } from "msw";
import { RouterContextProvider } from "react-router";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { callApi, callList, field, listOrThrow, loginUrl, newIdempotencyKey, orThrow, requirePermission } from "../api.server";
import { login } from "../auth-flow.server";
import { applySecurityHeaders, bff, bffContext, bffMiddleware, errorResponse, verifyCsrf } from "../middleware.server";
import { isStreamingUpload, limitStream, proxyRequest } from "../proxy.server";
import { clientIpFrom, requestMetaFrom } from "../request-meta.server";
import { checkLangParam } from "../routing.server";
import { getRuntime, setRuntime } from "../runtime.server";
import { getMe, guardUser } from "../user.server";
import { GATEWAY } from "../../../test/msw/fake-gateway";
import { cookieValue, meta, setup } from "./helpers";

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

async function run(request: Request, inner: (ctx: ReturnType<typeof bff>) => Promise<Response> | Response = () => new Response("ok", { headers: { "Content-Type": "text/html" } })) {
  const context = new RouterContextProvider();
  const response = await bffMiddleware({ request, context, params: {}, unstable_pattern: "" } as never, async () => inner(bff(context)));
  return { response: response as Response, context };
}

describe("middleware BR-IAM-22 CSRF + Origin", () => {
  it("GET은 통과하고 로그인 전 세션(CSRF 토큰)을 필요할 때만 만든다", async () => {
    const { response } = await run(new Request(`${ORIGIN}/login`));
    expect(response.status).toBe(200);
    expect(response.headers.get("Set-Cookie")).toBeNull();
    const { response: withCsrf } = await run(new Request(`${ORIGIN}/login`), (ctx) => {
      ctx.session.csrfToken();
      return new Response("ok");
    });
    expect(withCsrf.headers.get("Set-Cookie")).toMatch(/^data2flow_session=v1\.k1\./);
  });

  it("POST: 토큰 없음·Origin 다름·Origin 없음은 403 AUTH_CSRF_INVALID, 헤더 또는 폼 _csrf가 맞으면 통과", async () => {
    const cookie = await cookieFor();
    const session = t.session(cookie);
    const csrf = session.csrfToken();
    const headers = (extra: Record<string, string>) => ({ Cookie: `data2flow_session=${cookie}`, ...extra });
    const cases: [Record<string, string>, BodyInit | undefined, number][] = [
      [{ Origin: ORIGIN }, undefined, 403],
      [{ Origin: "https://evil.example", "X-CSRF-TOKEN": csrf }, undefined, 403],
      [{ "X-CSRF-TOKEN": csrf }, undefined, 403],
      [{ Origin: ORIGIN, "X-CSRF-TOKEN": "wrong" }, undefined, 403],
      [{ Origin: ORIGIN, "X-CSRF-TOKEN": csrf }, undefined, 200],
      [{ Origin: ORIGIN, "Content-Type": "application/x-www-form-urlencoded" }, new URLSearchParams({ _csrf: csrf }), 200],
      [{ Origin: ORIGIN, "Content-Type": "multipart/form-data; boundary=x" }, "broken", 403],
    ];
    for (const [extra, body, status] of cases) {
      const { response } = await run(new Request(`${ORIGIN}/me/profile`, { method: "POST", headers: headers(extra), body }));
      expect(response.status, JSON.stringify(extra)).toBe(status);
      if (status === 403) expect((await response.json()).header.resultCode).toBe("AUTH_CSRF_INVALID");
    }
    expect(await verifyCsrf(new Request(ORIGIN, { method: "POST", headers: { Origin: ORIGIN } }), t.session(), t.state.runtime.config)).toBe(false);
  });

  it("유휴 만료 세션은 쿠키를 지우고 auth에 로그아웃을 알린다", async () => {
    const cookie = await cookieFor();
    t.state.now += 31 * 60_000;
    const { response, context } = await run(new Request(`${ORIGIN}/`, { headers: { Cookie: `data2flow_session=${cookie}` } }));
    expect(bff(context).session.expired).toBe("IDLE");
    expect(response.headers.get("Set-Cookie")).toMatch(/Max-Age=0/);
    expect(t.state.gateway.received.at(-1)?.path).toBe("/api/v1/auth/logout");
  });

  it("보안 헤더: HSTS·nosniff·DENY, HTML에만 CSP·no-store, 바꿀 수 없는 헤더도 처리", () => {
    const config = { ...t.state.runtime.config, contentSecurityPolicy: true };
    const html = applySecurityHeaders(new Response("x", { headers: { "Content-Type": "text/html" } }), config, "n0nce");
    expect(html.headers.get("Content-Security-Policy")).toContain("'nonce-n0nce'");
    expect(html.headers.get("Strict-Transport-Security")).toBeTruthy();
    const json = applySecurityHeaders(Response.json({}), { ...config, cookieSecure: false }, "n");
    expect(json.headers.get("Content-Security-Policy")).toBeNull();
    expect(json.headers.get("Strict-Transport-Security")).toBeNull();
    const immutable = applySecurityHeaders(Response.redirect(`${ORIGIN}/x`, 302), config, "n");
    expect(immutable.headers.get("X-Frame-Options")).toBe("DENY");
    expect(immutable.status).toBe(302);
  });

  it("/healthz 는 세션을 건드리지 않는다, 컨텍스트 없는 bff()는 오류", async () => {
    const context = new RouterContextProvider();
    const response = await bffMiddleware({ request: new Request(`${ORIGIN}/healthz`), context, params: {} } as never, async () => new Response("ok"));
    expect((response as Response).headers.get("X-Frame-Options")).toBeNull();
    expect(() => bff(context)).toThrow(/middleware/);
    expect(context.get(bffContext)).toBeNull();
  });

  it("오류 응답은 Accept-Language 문구와 X-REQUEST-ID", async () => {
    const response = errorResponse(429, "AUTH_RATE_LIMITED", "en", "rid", { "Retry-After": "9" });
    expect(response.headers.get("X-REQUEST-ID")).toBe("rid");
    expect((await response.json()).header.resultMessage).toBe("Too many requests. Try again in 9 seconds.");
  });
});

describe("proxy /bff/api/{svc}/**", () => {
  it("허용 목록·경로 조작·만료 세션·본문 크기", async () => {
    const ctx = { session: t.session(), runtime: t.state.runtime, meta, nonce: "" };
    expect((await proxyRequest(new Request(`${ORIGIN}/bff/api/auth/x`), ctx, "auth", "x")).status).toBe(404);
    expect((await proxyRequest(new Request(`${ORIGIN}/bff/api/core/../x`), ctx, "core", "../x")).status).toBe(404);
    const big = new Request(`${ORIGIN}/bff/api/core/x`, { method: "POST", body: new Uint8Array(10 * 1024 * 1024 + 1) });
    expect((await proxyRequest(big, ctx, "core", "x")).status).toBe(413);
    const cookie = await cookieFor();
    t.state.now += 13 * 3_600_000;
    const expired = { ...ctx, session: t.session(cookie) };
    const response = await proxyRequest(new Request(`${ORIGIN}/bff/api/core/devices`), expired, "core", "devices");
    expect(response.status).toBe(401);
    expect((await response.json()).header.resultCode).toBe("AUTH_SESSION_EXPIRED");
  });

  it("auth 장애는 그 상태·Retry-After로 돌려준다", async () => {
    const cookie = await cookieFor();
    const session = t.session(cookie);
    await t.state.runtime.store.delete(session.sid as string);
    t.server.use(http.post("http://gateway.test/api/v1/auth/refresh-token", () => HttpResponse.json({ header: { isSuccessful: false, resultCode: "AUTH_RATE_LIMITED", resultMessage: "x" } }, { status: 429, headers: { "Retry-After": "5" } })));
    const response = await proxyRequest(new Request(`${ORIGIN}/bff/api/core/devices`), { session, runtime: t.state.runtime, meta, nonce: "" }, "core", "devices");
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("5");
  });
});

describe("loader·action 도우미", () => {
  it("loginUrl은 .data를 떼고 next·reason을 붙인다", () => {
    expect(loginUrl(new Request(`${ORIGIN}/me/profile.data?x=1`), "expired")).toBe("/login?next=%2Fme%2Fprofile%3Fx%3D1&reason=expired");
    expect(loginUrl(new Request(`${ORIGIN}/`))).toBe("/login");
  });

  it("callApi: 세션 없음 → 로그인 리디렉트, 204·실패·장애·가드 처리", async () => {
    const request = new Request(`${ORIGIN}/me`);
    const anonymous = { session: t.session(), runtime: t.state.runtime, meta, nonce: "" };
    const thrown = await callApi(anonymous, request, "/api/v1/core/accounts/me").catch((e) => e);
    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).headers.get("Location")).toBe("/login?next=%2Fme");

    const ctx = { session: t.session(await cookieFor()), runtime: t.state.runtime, meta, nonce: "" };
    const ok = await callApi<{ id: string }>(ctx, request, "/api/v1/core/accounts/me");
    expect(ok).toMatchObject({ ok: true, data: { id: "7" } });
    expect(orThrow(ok)).toMatchObject({ id: "7" });
    expect(await callApi(ctx, request, "/api/v1/core/accounts/me/password", { method: "PUT", body: { currentPassword: "Correct-Horse-9", newPassword: "N-e-w-Pass-123", keepCurrentSession: true } })).toMatchObject({ ok: true, status: 204 });
    const denied = await callApi(ctx, request, "/api/v1/core/users/1");
    expect(denied).toMatchObject({ ok: false, status: 403, code: "PERMISSION_DENIED" });
    expect(() => orThrow(denied)).toThrow();
    const list = await callList(ctx, request, "/api/v1/core/devices");
    expect(listOrThrow(list).responses.length).toBeGreaterThan(0);
    const listDenied = await callList(ctx, request, "/api/v1/core/users");
    expect(() => listOrThrow(listDenied)).toThrow();
    t.server.use(http.get("http://gateway.test/api/v1/core/devices", () => HttpResponse.error()));
    expect(await callApi(ctx, request, "/api/v1/core/devices")).toMatchObject({ ok: false, status: 503 });
    expect(await callList(ctx, request, "/api/v1/core/devices")).toMatchObject({ ok: false, status: 503 });
    t.server.use(http.get("http://gateway.test/api/v1/core/flows", () => HttpResponse.json({ header: { isSuccessful: false, resultCode: "MFA_SETUP_REQUIRED", resultMessage: "" } }, { status: 403 })));
    const guard = await callApi(ctx, request, "/api/v1/core/flows").catch((e) => e);
    expect((guard as Response).headers.get("Location")).toBe("/me/security?required=mfa");
    expect(await callApi(ctx, request, "/api/v1/core/flows", { noGuards: true })).toMatchObject({ code: "MFA_SETUP_REQUIRED" });
    t.state.gateway.revokeUser("7");
    const revoked = await callApi(ctx, request, "/api/v1/core/accounts/me").catch((e) => e);
    expect((revoked as Response).headers.get("Location")).toBe("/login?next=%2Fme&reason=revoked");
  });

  it("guardUser: 권한 없는 관리 경로 403, 비밀번호 변경 필요 시 보안 탭으로", async () => {
    const operator = { session: t.session(await cookieFor()), runtime: t.state.runtime, meta, nonce: "" };
    const forbidden = await guardUser(operator, new Request(`${ORIGIN}/admin/members`)).catch((e) => e);
    expect(forbidden).toMatchObject({ init: { status: 403 } });
    expect(await guardUser(operator, new Request(`${ORIGIN}/me/profile`))).toMatchObject({ id: "7" });
    const boot = { session: t.session(await cookieFor("boot.admin", "Initial-Pass-1")), runtime: t.state.runtime, meta, nonce: "" };
    const redirect = (await guardUser(boot, new Request(`${ORIGIN}/`)).catch((e) => e)) as Response;
    expect(redirect.headers.get("Location")).toBe("/me/security?required=password");
    const mfa = { session: t.session(await cookieFor("mfa.admin", "MfaAdmin-Pass1")), runtime: t.state.runtime, meta, nonce: "" };
    const toMfa = (await guardUser(mfa, new Request(`${ORIGIN}/`)).catch((e) => e)) as Response;
    expect(toMfa.headers.get("Location")).toBe("/me/security?required=mfa");
    expect(await guardUser(mfa, new Request(`${ORIGIN}/me/security`))).toBeNull();
    const anon = { session: t.session(), runtime: t.state.runtime, meta, nonce: "" };
    expect(((await guardUser(anon, new Request(`${ORIGIN}/`)).catch((e) => e)) as Response).status).toBe(302);
    t.server.use(http.get("http://gateway.test/api/v1/core/accounts/me", () => HttpResponse.json({ header: { isSuccessful: false, resultCode: "AUTH_PASSWORD_CHANGE_REQUIRED", resultMessage: "" } }, { status: 403 })));
    const fresh = { session: t.session(await cookieFor()), runtime: t.state.runtime, meta, nonce: "" };
    expect(((await guardUser(fresh, new Request(`${ORIGIN}/`)).catch((e) => e)) as Response).headers.get("Location")).toBe("/me/security?required=password");
    expect(await guardUser(fresh, new Request(`${ORIGIN}/me/security`))).toBeNull();
    t.server.use(http.get("http://gateway.test/api/v1/core/accounts/me", () => HttpResponse.json({ header: { isSuccessful: false, resultCode: "INTERNAL_ERROR", resultMessage: "" } }, { status: 500 })));
    const broken = { session: t.session(await cookieFor()), runtime: t.state.runtime, meta, nonce: "" };
    expect(await guardUser(broken, new Request(`${ORIGIN}/`)).catch((e) => e)).toMatchObject({ init: { status: 500 } });
    expect(await getMe(broken, new Request(`${ORIGIN}/`))).toMatchObject({ ok: false });
  });

  it("requirePermission·field·newIdempotencyKey·checkLangParam", () => {
    expect(() => requirePermission(["DEV_READ"], "IAM_MANAGE")).toThrow();
    expect(() => requirePermission(["IAM_MANAGE"], "IAM_MANAGE")).not.toThrow();
    const form = new FormData();
    form.set("a", "1");
    form.set("f", new Blob(["x"]));
    expect(field(form, "a")).toBe("1");
    expect(field(form, "f")).toBe("");
    expect(newIdempotencyKey()).toMatch(/^[0-9a-f-]{36}$/);
    expect(() => checkLangParam(undefined, new Request(ORIGIN))).not.toThrow();
    expect(() => checkLangParam("en", new Request(ORIGIN))).not.toThrow();
    expect((() => { try { checkLangParam("ko", new Request(`${ORIGIN}/ko/login?a=1`)); } catch (e) { return (e as Response).headers.get("Location"); } })()).toBe("/login?a=1");
    expect(() => checkLangParam("fr", new Request(ORIGIN))).toThrow();
  });
});

describe("request-meta auth.md §5 사용자 IP·상관 ID·언어", () => {
  it("X-Forwarded-For 끝의 신뢰 홉(nginx)을 건너뛴 주소가 사용자 IP", () => {
    expect(clientIpFrom("59.28.174.54, 10.0.0.1", 1)).toBe("59.28.174.54");
    expect(clientIpFrom("1.1.1.1, 59.28.174.54, 10.0.0.1", 1)).toBe("59.28.174.54");
    expect(clientIpFrom("10.0.0.1", 1)).toBe("10.0.0.1");
    expect(clientIpFrom("evil<script>", 0)).toBeUndefined();
    expect(clientIpFrom(null, 1)).toBeUndefined();
  });

  it("X-REQUEST-ID는 형식이 맞을 때만 이어받고, 언어는 주소 접두사 → Accept-Language", () => {
    const kept = requestMetaFrom(new Request(`${ORIGIN}/ja/login`, { headers: { "X-REQUEST-ID": "abcdefgh-1", "Accept-Language": "en" } }), 1);
    expect(kept).toMatchObject({ requestId: "abcdefgh-1", lang: "ja" });
    const fresh = requestMetaFrom(new Request(`${ORIGIN}/`, { headers: { "X-REQUEST-ID": "bad id", "Accept-Language": "zh-TW" } }), 1);
    expect(fresh.requestId).not.toBe("bad id");
    expect(fresh.lang).toBe("zh");
  });
});

describe("runtime", () => {
  it("setRuntime으로 바꾼 실행 환경을 getRuntime이 돌려준다", async () => {
    expect(await getRuntime()).toBe(t.state.runtime);
    setRuntime(undefined);
    const created = await getRuntime();
    expect(created.config.gatewayUrl).toBeTruthy();
    setRuntime(t.state.runtime);
  });
});

describe("TSD-04.01 TSD-04.02 큰 파일 중계(내려받기·가져오기 업로드)", () => {
  it("TC-TSD-108 제한 시간은 응답 머리까지만 — 머리가 온 뒤 느린 본문(1년치 CSV)은 끝까지 흘려보낸다", async () => {
    t.reset({ DATA2FLOW_GATEWAY_TIMEOUT_MS: "1000" });
    t.server.use(
      http.get(`${GATEWAY}/api/v1/core/exports/7/file`, () => {
        const encoder = new TextEncoder();
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode("time,device_id\n"));
            setTimeout(() => {
              controller.enqueue(encoder.encode("2025-10-04T00:00:00+09:00,1042\n"));
              controller.close();
            }, 1300);
          },
        });
        return new HttpResponse(stream, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="export-7.csv"' } });
      }),
    );
    const ctx = { session: t.session(), runtime: t.state.runtime, meta, nonce: "" };
    const response = await proxyRequest(new Request(`${ORIGIN}/bff/api/core/exports/7/file?expires=1&signature=ab`), ctx, "core", "exports/7/file");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain("export-7.csv");
    expect(await response.text()).toBe("time,device_id\n2025-10-04T00:00:00+09:00,1042\n");
  });

  it("응답 머리가 제한 시간 안에 오지 않으면 503", async () => {
    t.reset({ DATA2FLOW_GATEWAY_TIMEOUT_MS: "1000" });
    t.server.use(http.get(`${GATEWAY}/api/v1/core/exports`, () => new Promise<Response>((resolve) => setTimeout(() => resolve(HttpResponse.json({})), 1500))));
    const ctx = { session: t.session(), runtime: t.state.runtime, meta, nonce: "" };
    const response = await proxyRequest(new Request(`${ORIGIN}/bff/api/core/exports`), ctx, "core", "exports");
    expect(response.status).toBe(503);
  });

  it("TC-TSD-113 가져오기 CSV multipart는 10MB를 넘어도 버퍼 없이 흘려보낸다(2GB 한도)", async () => {
    let received = 0;
    t.server.use(
      http.post(`${GATEWAY}/api/v1/core/imports`, async ({ request }) => {
        received = (await request.arrayBuffer()).byteLength;
        return HttpResponse.json({ header: { isSuccessful: true, resultCode: "SUCCESS", resultMessage: "SUCCESS" }, response: { id: "9" } }, { status: 202 });
      }),
    );
    const ctx = { session: t.session(), runtime: t.state.runtime, meta, nonce: "" };
    const size = 10 * 1024 * 1024 + 10;
    const request = new Request(`${ORIGIN}/bff/api/core/imports`, { method: "POST", headers: { "Content-Type": "multipart/form-data; boundary=b" }, body: new Uint8Array(size) });
    const response = await proxyRequest(request, ctx, "core", "imports");
    expect(response.status).toBe(202);
    expect(received).toBe(size);
    expect(isStreamingUpload("core", "imports", "POST", "multipart/form-data; boundary=b")).toBe(true);
    expect(isStreamingUpload("core", "imports", "POST", "application/json")).toBe(false);
    expect(isStreamingUpload("core", "exports", "POST", "multipart/form-data")).toBe(false);
  });

  it("limitStream은 한도를 넘으면 스트림을 오류로 끊는다", async () => {
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(4));
        controller.enqueue(new Uint8Array(4));
        controller.close();
      },
    });
    await expect(new Response(limitStream(source, 5)).arrayBuffer()).rejects.toThrow();
    const ok = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(3));
        controller.close();
      },
    });
    expect((await new Response(limitStream(ok, 5)).arrayBuffer()).byteLength).toBe(3);
  });
});
