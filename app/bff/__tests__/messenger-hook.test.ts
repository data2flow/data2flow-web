/**
 * 메신저 콜백 `/hooks/messenger/{channel}` (design/auth.md §9.3, API-RUL-31, RUL-05.02, BR-RUL-18).
 * 실제 텔레그램은 쓰지 않는다. 내부 action 호출은 가짜 fetch로 받는다.
 */
import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../config.server";
import { FORWARD_TIMEOUT_MS, MAX_HOOK_BODY_BYTES, MemoryReplayGuard, RedisReplayGuard, getReplayGuard, handleMessengerHook, secretMatches, setReplayGuard, type HookDeps } from "../messenger-hook.server";

const SECRET = "tg-webhook-secret-0123456789";
const ACTION = "http://data2flow-action";
const update = (id: number, data = "ACK|501|7d3f6a52-1c2b-4e8a-9a51-0c1d2e3f4a5b") => JSON.stringify({ update_id: id, callback_query: { id: "cq-1", from: { id: 7001 }, data } });

function deps(overrides: Partial<HookDeps> = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const pending: Promise<unknown>[] = [];
  const logs: string[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(null, { status: 202 });
  }) as unknown as typeof fetch;
  const d: HookDeps = {
    config: loadConfig({ DATA2FLOW_MESSENGER_TELEGRAM_SECRET: SECRET }),
    fetch: fetchImpl,
    guard: new MemoryReplayGuard(() => Date.parse("2026-10-04T00:00:00Z")),
    requestId: "req-hook-0001",
    waitUntil: (p) => pending.push(p),
    log: (m) => logs.push(m),
    ...overrides,
  };
  return { d, calls, pending, logs };
}

function post(body: string, headers: Record<string, string> = { "X-Telegram-Bot-Api-Secret-Token": SECRET }, channel = "telegram") {
  return new Request(`https://data2flow.java21.net/hooks/messenger/${channel}`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body });
}

describe("RUL-05.02 메신저 콜백 BFF 검증·중계 (auth.md §9.3)", () => {
  it("TC-RUL-093 AT-RUL-10.1 시크릿이 맞으면 원본 본문을 action 내부 API로 그대로 넘기고 200을 먼저 돌려준다", async () => {
    const { d, calls, pending } = deps();
    const body = update(1001);
    const response = await handleMessengerHook(post(body), "telegram", d);
    expect(response.status).toBe(200);
    await Promise.all(pending);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${ACTION}/internal/action/notifications/callbacks/telegram`);
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["X-CALLER-SERVICE"]).toBe("data2flow-web");
    expect(headers["X-REQUEST-ID"]).toBe("req-hook-0001");
    expect(headers["X-Telegram-Bot-Api-Secret-Token"]).toBe(SECRET);
    expect(calls[0].init.body).toBe(body);
    expect(calls[0].init.method).toBe("POST");
  });

  it("시크릿이 없거나 틀리면 401이고 본문은 읽지 않으며 중계하지 않는다", async () => {
    const { d, calls } = deps();
    const wrong = post(update(1), { "X-Telegram-Bot-Api-Secret-Token": "nope" });
    const missing = post(update(2), {});
    expect((await handleMessengerHook(wrong, "telegram", d)).status).toBe(401);
    expect(wrong.bodyUsed).toBe(false);
    expect((await handleMessengerHook(missing, "telegram", d)).status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("허용 목록 밖 채널·비밀값이 설정되지 않은 채널은 404, POST 밖은 405", async () => {
    const { d } = deps();
    expect((await handleMessengerHook(post(update(1), {}, "slack"), "slack", d)).status).toBe(404);
    expect((await handleMessengerHook(post(update(1), {}, "toString"), "toString", d)).status).toBe(404);
    const unset = deps({ config: loadConfig({}) });
    expect((await handleMessengerHook(post(update(1)), "telegram", unset.d)).status).toBe(404);
    const get = await handleMessengerHook(new Request("https://data2flow.java21.net/hooks/messenger/telegram"), "telegram", d);
    expect(get.status).toBe(405);
    expect(get.headers.get("Allow")).toBe("POST");
  });

  it("같은 update_id는 10분 동안 한 번만 넘기고(200 무시), 10분 뒤에는 다시 받는다", async () => {
    let now = Date.parse("2026-10-04T00:00:00Z");
    const { d, calls, pending } = deps({ guard: new MemoryReplayGuard(() => now) });
    expect((await handleMessengerHook(post(update(77)), "telegram", d)).status).toBe(200);
    const dup = await handleMessengerHook(post(update(77)), "telegram", d);
    expect(dup.status).toBe(200);
    expect(((await dup.json()) as { header: { resultCode: string } }).header.resultCode).toBe("DUPLICATE_IGNORED");
    now += 10 * 60_000 + 1;
    expect((await handleMessengerHook(post(update(77)), "telegram", d)).status).toBe(200);
    await Promise.all(pending);
    expect(calls).toHaveLength(2);
  });

  it("본문이 1MB를 넘으면 413, JSON이 아니거나 update_id가 없으면 400", async () => {
    const { d, calls } = deps();
    const big = `{"update_id":1,"x":"${"a".repeat(MAX_HOOK_BODY_BYTES)}"}`;
    expect((await handleMessengerHook(post(big), "telegram", d)).status).toBe(413);
    const declared = new Request("https://data2flow.java21.net/hooks/messenger/telegram", { method: "POST", headers: { "X-Telegram-Bot-Api-Secret-Token": SECRET, "Content-Length": String(MAX_HOOK_BODY_BYTES + 1) }, body: "{}" });
    expect((await handleMessengerHook(declared, "telegram", d)).status).toBe(413);
    expect((await handleMessengerHook(post("not json"), "telegram", d)).status).toBe(400);
    expect((await handleMessengerHook(post("[1]"), "telegram", d)).status).toBe(400);
    expect((await handleMessengerHook(post('{"message":{}}'), "telegram", d)).status).toBe(400);
    expect((await handleMessengerHook(post('{"update_id":-1}'), "telegram", d)).status).toBe(400);
    const empty = new Request("https://data2flow.java21.net/hooks/messenger/telegram", { method: "POST", headers: { "X-Telegram-Bot-Api-Secret-Token": SECRET } });
    expect((await handleMessengerHook(empty, "telegram", d)).status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("action이 실패하거나 응답하지 않아도 200이고 실패는 기록만 남긴다(제한 시간 5초)", async () => {
    const failing = deps({ fetch: (async () => new Response(null, { status: 503 })) as unknown as typeof fetch });
    expect((await handleMessengerHook(post(update(5)), "telegram", failing.d)).status).toBe(200);
    await Promise.all(failing.pending);
    expect(failing.logs[0]).toContain("HTTP 503");
    let signal: AbortSignal | undefined;
    const throwing = deps({
      fetch: (async (_url: unknown, init?: RequestInit) => {
        signal = init?.signal ?? undefined;
        throw new Error("connect ECONNREFUSED");
      }) as unknown as typeof fetch,
    });
    expect((await handleMessengerHook(post(update(6)), "telegram", throwing.d)).status).toBe(200);
    await Promise.all(throwing.pending);
    expect(throwing.logs[0]).toContain("ECONNREFUSED");
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(FORWARD_TIMEOUT_MS).toBe(5000);
    // waitUntil·log가 없어도 흘려 보낸다
    const quiet = deps({ waitUntil: undefined, log: undefined });
    expect((await handleMessengerHook(post(update(8)), "telegram", quiet.d)).status).toBe(200);
  });

  it("상수 시간 비교: 길이가 달라도 거부, 같으면 통과", () => {
    expect(secretMatches("abc", "abc")).toBe(true);
    expect(secretMatches("abc", "abcd")).toBe(false);
    expect(secretMatches("abc", "ab")).toBe(false);
    expect(secretMatches("abc", null)).toBe(false);
    expect(secretMatches("abc", "")).toBe(false);
  });
});

describe("재전송 방지 저장소", () => {
  it("Redis SET NX EX로 기록하고, Redis 오류면 메모리로 같은 검사를 한다", async () => {
    const set = vi.fn().mockResolvedValueOnce("OK").mockResolvedValueOnce(null).mockRejectedValueOnce(new Error("down"));
    const logs: string[] = [];
    const guard = new RedisReplayGuard({ set }, new MemoryReplayGuard(), (m) => logs.push(m));
    expect(await guard.firstSeen("data2flow:hook:msg:telegram:1", 600)).toBe(true);
    expect(set).toHaveBeenCalledWith("data2flow:hook:msg:telegram:1", "1", "EX", 600, "NX");
    expect(await guard.firstSeen("data2flow:hook:msg:telegram:1", 600)).toBe(false);
    expect(await guard.firstSeen("data2flow:hook:msg:telegram:2", 600)).toBe(true);
    expect(logs[0]).toContain("down");
  });

  it("메모리 저장소는 상한을 넘으면 오래된 기록부터 지운다", async () => {
    let now = 0;
    const guard = new MemoryReplayGuard(() => now, 2);
    await guard.firstSeen("a", 1);
    now = 2000;
    await guard.firstSeen("b", 10);
    await guard.firstSeen("c", 10);
    expect(await guard.firstSeen("b", 10)).toBe(false);
    expect(await guard.firstSeen("a", 10)).toBe(true);
  });

  it("Redis 주소가 없으면 메모리 저장소를 한 번 만들어 같이 쓴다", async () => {
    setReplayGuard(undefined);
    const config = loadConfig({});
    const first = await getReplayGuard(config);
    expect(first).toBeInstanceOf(MemoryReplayGuard);
    expect(await getReplayGuard(config)).toBe(first);
    setReplayGuard(undefined);
  });
});

describe("설정", () => {
  it("메신저 비밀값과 action 주소는 환경 변수에서 읽는다", () => {
    const config = loadConfig({ DATA2FLOW_MESSENGER_TELEGRAM_SECRET: "s", DATA2FLOW_ACTION_URL: "http://action.test/" });
    expect(config.messengerSecrets).toEqual({ telegram: "s" });
    expect(config.actionUrl).toBe("http://action.test");
    expect(loadConfig({}).messengerSecrets).toEqual({});
    expect(loadConfig({}).actionUrl).toBe(ACTION);
  });
});
