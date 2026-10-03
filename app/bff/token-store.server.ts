/**
 * Access 토큰 캐시(design/auth.md §9.1). 키는 로그인 계보 sid이고, 브라우저로는 절대 보내지 않는다.
 * - 기본: BFF 메모리
 * - DATA2FLOW_REDIS_URL이 있으면 메모리 + Redis(`data2flow:bff:at:{sid}`, TTL = 남은 수명).
 *   Redis는 사라져도 되는 캐시라서(ADR-022) 오류가 나면 메모리만 쓰고, 없으면 Refresh로 다시 받는다.
 * - 폐기 알림 EVT-IAM-03(Redis Pub/Sub `data2flow:auth.revocations`)을 받으면 그 sid의 캐시를 지운다.
 */

export interface AccessToken {
  token: string;
  /** 만료 시각(ms) */
  expiresAt: number;
}

export interface TokenStore {
  get(sid: string): Promise<AccessToken | undefined>;
  set(sid: string, token: AccessToken): Promise<void>;
  delete(sid: string): Promise<void>;
  close(): Promise<void>;
}

/** 만료 직전 토큰은 쓰지 않는다(gateway까지 가는 동안 만료되지 않게) */
export const EXPIRY_SKEW_MS = 30_000;
const MAX_ENTRIES = 20_000;

export class MemoryTokenStore implements TokenStore {
  private readonly entries = new Map<string, AccessToken>();

  constructor(private readonly now: () => number = Date.now) {}

  async get(sid: string) {
    const entry = this.entries.get(sid);
    if (!entry) return undefined;
    if (entry.expiresAt - EXPIRY_SKEW_MS <= this.now()) {
      this.entries.delete(sid);
      return undefined;
    }
    return entry;
  }

  async set(sid: string, token: AccessToken) {
    this.entries.delete(sid);
    this.entries.set(sid, token);
    if (this.entries.size > MAX_ENTRIES) {
      // 가장 오래 넣은 것부터 버린다(다시 필요하면 Refresh로 받는다)
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
  }

  async delete(sid: string) {
    this.entries.delete(sid);
  }

  async close() {
    this.entries.clear();
  }

  get size() {
    return this.entries.size;
  }
}

/** 쓰는 명령만 추린 Redis 클라이언트 모양(ioredis와 호환). 테스트에서는 가짜를 넣는다 */
export interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: "EX", seconds: number): Promise<unknown>;
  del(key: string): Promise<unknown>;
  quit(): Promise<unknown>;
}

export interface RedisSubscriberLike {
  subscribe(channel: string): Promise<unknown>;
  on(event: "message", listener: (channel: string, message: string) => void): unknown;
  quit(): Promise<unknown>;
}

export const KEY_PREFIX = "data2flow:bff:at:";
export const REVOCATION_CHANNEL = "data2flow:auth.revocations";

export class RedisTokenStore implements TokenStore {
  private readonly memory: MemoryTokenStore;

  constructor(
    private readonly redis: RedisLike,
    private readonly now: () => number = Date.now,
    private readonly onError: (error: unknown) => void = () => {},
  ) {
    this.memory = new MemoryTokenStore(now);
  }

  async get(sid: string) {
    const local = await this.memory.get(sid);
    if (local) return local;
    try {
      const raw = await this.redis.get(KEY_PREFIX + sid);
      if (!raw) return undefined;
      const parsed = JSON.parse(raw) as AccessToken;
      if (typeof parsed.token !== "string" || typeof parsed.expiresAt !== "number") return undefined;
      if (parsed.expiresAt - EXPIRY_SKEW_MS <= this.now()) return undefined;
      await this.memory.set(sid, parsed);
      return parsed;
    } catch (error) {
      this.onError(error);
      return undefined;
    }
  }

  async set(sid: string, token: AccessToken) {
    await this.memory.set(sid, token);
    const ttl = Math.floor((token.expiresAt - this.now()) / 1000);
    if (ttl <= 0) return;
    try {
      await this.redis.set(KEY_PREFIX + sid, JSON.stringify(token), "EX", ttl);
    } catch (error) {
      this.onError(error);
    }
  }

  async delete(sid: string) {
    await this.memory.delete(sid);
    try {
      await this.redis.del(KEY_PREFIX + sid);
    } catch (error) {
      this.onError(error);
    }
  }

  /** EVT-IAM-03 `{type: SID|JTI|TOKEN_ID, value}` 중 SID만 BFF 캐시와 관계있다 */
  async handleRevocation(message: string) {
    try {
      const event = JSON.parse(message) as { type?: string; value?: unknown };
      if (event.type === "SID" && typeof event.value === "string") await this.delete(event.value);
    } catch (error) {
      this.onError(error);
    }
  }

  async subscribe(subscriber: RedisSubscriberLike) {
    subscriber.on("message", (channel, message) => {
      if (channel === REVOCATION_CHANNEL) void this.handleRevocation(message);
    });
    await subscriber.subscribe(REVOCATION_CHANNEL);
  }

  async close() {
    await this.memory.close();
    await this.redis.quit().catch(() => {});
  }
}

/* v8 ignore start -- 실제 Redis 연결은 운영 구성에서만 쓴다(동작은 RedisTokenStore 테스트로 확인) */
export async function createRedisTokenStore(url: string): Promise<TokenStore> {
  const { Redis } = await import("ioredis");
  const options = { lazyConnect: false, maxRetriesPerRequest: 1, enableOfflineQueue: false };
  const client = new Redis(url, options);
  const subscriber = new Redis(url, options);
  const log = (error: unknown) => console.warn("[bff] redis token cache error", (error as Error)?.message);
  client.on("error", log);
  subscriber.on("error", log);
  const store = new RedisTokenStore(client as unknown as RedisLike, Date.now, log);
  await store.subscribe(subscriber as unknown as RedisSubscriberLike).catch(log);
  return store;
}
/* v8 ignore stop */
