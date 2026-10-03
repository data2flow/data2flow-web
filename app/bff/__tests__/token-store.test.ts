import { describe, expect, it, vi } from "vitest";
import { KEY_PREFIX, MemoryTokenStore, REVOCATION_CHANNEL, RedisTokenStore, type RedisLike } from "../token-store.server";

function fakeRedis() {
  const data = new Map<string, { value: string; ttl: number }>();
  const redis: RedisLike & { data: typeof data; fail: boolean } = {
    data,
    fail: false,
    async get(key) {
      if (redis.fail) throw new Error("down");
      return data.get(key)?.value ?? null;
    },
    async set(key, value, _mode, seconds) {
      if (redis.fail) throw new Error("down");
      data.set(key, { value, ttl: seconds });
      return "OK";
    },
    async del(key) {
      if (redis.fail) throw new Error("down");
      data.delete(key);
      return 1;
    },
    async quit() {
      return "OK";
    },
  };
  return redis;
}

describe("token-store IAM-07.04 Access 캐시(BFF 서버 쪽만)", () => {
  it("메모리: 만료 30초 전부터는 없는 것으로 본다", async () => {
    let now = 0;
    const store = new MemoryTokenStore(() => now);
    await store.set("s", { token: "a", expiresAt: 60_000 });
    expect(await store.get("s")).toEqual({ token: "a", expiresAt: 60_000 });
    now = 30_001;
    expect(await store.get("s")).toBeUndefined();
    await store.set("s", { token: "b", expiresAt: 1e9 });
    await store.delete("s");
    expect(await store.get("s")).toBeUndefined();
    expect(await store.get("none")).toBeUndefined();
    await store.close();
    expect(store.size).toBe(0);
  });

  it("Redis: 키 data2flow:bff:at:{sid}, TTL은 남은 수명, 다른 인스턴스 메모리가 비어도 Redis에서 읽는다", async () => {
    const redis = fakeRedis();
    const now = () => 1_000;
    const a = new RedisTokenStore(redis, now);
    await a.set("sid-1", { token: "tok", expiresAt: 3_601_000 });
    expect(redis.data.get(`${KEY_PREFIX}sid-1`)?.ttl).toBe(3600);
    const b = new RedisTokenStore(redis, now);
    expect(await b.get("sid-1")).toEqual({ token: "tok", expiresAt: 3_601_000 });
    expect(await b.get("sid-1")).toEqual({ token: "tok", expiresAt: 3_601_000 }); // 메모리 적중
    await b.delete("sid-1");
    expect(redis.data.size).toBe(0);
    await a.set("old", { token: "x", expiresAt: 500 }); // 이미 만료: Redis에 쓰지 않음
    expect(redis.data.size).toBe(0);
  });

  it("Redis 장애(ADR-022): 오류를 삼키고 메모리만 쓴다, 깨진 값은 무시", async () => {
    const redis = fakeRedis();
    const onError = vi.fn();
    const store = new RedisTokenStore(redis, () => 0, onError);
    redis.data.set(`${KEY_PREFIX}bad`, { value: '{"token":1}', ttl: 1 });
    expect(await store.get("bad")).toBeUndefined();
    redis.data.set(`${KEY_PREFIX}expired`, { value: '{"token":"t","expiresAt":10}', ttl: 1 });
    expect(await store.get("expired")).toBeUndefined();
    redis.fail = true;
    await store.set("s", { token: "t", expiresAt: 1e9 });
    expect(await store.get("s")).toEqual({ token: "t", expiresAt: 1e9 });
    expect(await store.get("other")).toBeUndefined();
    await store.delete("s");
    expect(onError).toHaveBeenCalled();
    await store.close();
  });

  it("EVT-IAM-03 폐기 알림(SID)을 받으면 그 sid의 캐시를 지운다", async () => {
    const redis = fakeRedis();
    const store = new RedisTokenStore(redis, () => 0, vi.fn());
    await store.set("sid-9", { token: "t", expiresAt: 1e9 });
    let listener: ((channel: string, message: string) => void) | undefined;
    const subscriber = { subscribe: vi.fn(async () => 1), on: vi.fn((_e: string, l: typeof listener) => (listener = l)), quit: vi.fn() };
    await store.subscribe(subscriber as never);
    expect(subscriber.subscribe).toHaveBeenCalledWith(REVOCATION_CHANNEL);
    listener?.("other", JSON.stringify({ type: "SID", value: "sid-9" }));
    expect(await store.get("sid-9")).toBeDefined();
    await store.handleRevocation(JSON.stringify({ type: "JTI", value: "sid-9" }));
    expect(await store.get("sid-9")).toBeDefined();
    listener?.(REVOCATION_CHANNEL, JSON.stringify({ type: "SID", value: "sid-9" }));
    await store.handleRevocation("not json");
    expect(await store.get("sid-9")).toBeUndefined();
  });
});
