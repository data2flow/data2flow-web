/**
 * 메신저 버튼 응답 콜백 `POST /hooks/messenger/{channel}` (design/auth.md §9.3, API-RUL-31, RUL-05.02, ADR-029·033).
 * 브라우저 세션이 없는 서버 간 호출이라 세션 쿠키·CSRF 검사 대상이 아니다. 대신 BFF가 먼저:
 * 1) 허용 목록 채널(지금은 `telegram`)만 받고, 그 채널의 비밀값이 설정되어 있어야 한다(없으면 404)
 * 2) 채널 비밀값을 상수 시간으로 비교한다(텔레그램 `X-Telegram-Bot-Api-Secret-Token`). 틀리면 본문을 읽지 않고 401
 * 3) 본문 크기(1MB)와 JSON 모양을 확인한다
 * 4) 같은 이벤트 ID(텔레그램 `update_id`)는 10분 동안 한 번만 넘긴다(Redis `data2flow:hook:msg:{channel}:{id}`, 없으면 메모리)
 * 5) 원본 본문을 내부 `POST {action}/internal/action/notifications/callbacks/{channel}`로 넘긴다(`X-CALLER-SERVICE: data2flow-web`).
 *    채널 응답 제한에 맞춰 결과를 기다리지 않고 200을 먼저 돌려준다. 처리 결과는 action이 같은 메시지를 갱신해 알린다
 */
import { timingSafeEqual } from "node:crypto";
import type { BffConfig } from "./config.server";

/** 채널별 검증 규칙. 다른 메신저는 알림 채널 SPI(`verify`)를 추가할 때 여기에 더한다 */
interface ChannelRule {
  /** 비밀값을 담는 요청 헤더 */
  secretHeader: string;
  /** 재전송 방지용 이벤트 ID */
  eventId: (body: unknown) => string | undefined;
}

export const MESSENGER_CHANNELS: Record<string, ChannelRule> = {
  telegram: {
    secretHeader: "X-Telegram-Bot-Api-Secret-Token",
    eventId: (body) => {
      const id = (body as { update_id?: unknown } | null)?.update_id;
      return typeof id === "number" && Number.isSafeInteger(id) && id >= 0 ? String(id) : undefined;
    },
  },
};

export const MAX_HOOK_BODY_BYTES = 1024 * 1024;
export const REPLAY_TTL_SECONDS = 600;
export const FORWARD_TIMEOUT_MS = 5000;

/** 같은 이벤트 ID를 처음 보는지 기록한다. 처음이면 true */
export interface ReplayGuard {
  firstSeen(key: string, ttlSeconds: number): Promise<boolean>;
}

export class MemoryReplayGuard implements ReplayGuard {
  private readonly seen = new Map<string, number>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly maxEntries = 50_000,
  ) {}

  async firstSeen(key: string, ttlSeconds: number): Promise<boolean> {
    const now = this.now();
    const expiresAt = this.seen.get(key);
    if (expiresAt !== undefined && expiresAt > now) return false;
    this.seen.delete(key);
    this.seen.set(key, now + ttlSeconds * 1000);
    if (this.seen.size > this.maxEntries) {
      for (const [k, exp] of this.seen) {
        if (exp <= now || this.seen.size > this.maxEntries) this.seen.delete(k);
        else break;
      }
    }
    return true;
  }
}

/** `SET key 1 EX ttl NX`만 쓰는 Redis 모양(ioredis와 호환) */
export interface RedisSetNx {
  set(key: string, value: string, ex: "EX", seconds: number, nx: "NX"): Promise<unknown>;
}

export class RedisReplayGuard implements ReplayGuard {
  constructor(
    private readonly client: RedisSetNx,
    private readonly fallback: ReplayGuard,
    private readonly log: (message: string) => void = (m) => console.warn(m),
  ) {}

  async firstSeen(key: string, ttlSeconds: number): Promise<boolean> {
    try {
      const result = await this.client.set(key, "1", "EX", ttlSeconds, "NX");
      return result === "OK";
    } catch (error) {
      // Redis는 캐시일 뿐이다(ADR-022). 비면 메모리로 같은 검사를 한다
      this.log(`[bff] hook replay guard redis error: ${(error as Error).message}`);
      return this.fallback.firstSeen(key, ttlSeconds);
    }
  }
}

export interface HookDeps {
  config: BffConfig;
  fetch: typeof fetch;
  guard: ReplayGuard;
  requestId: string;
  /** 중계 작업을 넘겨받는다(테스트가 기다릴 수 있게). 없으면 그냥 흘려 보낸다 */
  waitUntil?: (work: Promise<unknown>) => void;
  log?: (message: string) => void;
}

function json(status: number, code: string, requestId: string) {
  const body = { header: { isSuccessful: status < 400, resultCode: code, resultMessage: code } };
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-REQUEST-ID": requestId } });
}

/** 상수 시간 비교. 길이가 달라도 같은 시간을 쓰도록 같은 길이로 맞춘 뒤 비교한다 */
export function secretMatches(expected: string, given: string | null): boolean {
  if (!given) return false;
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(given, "utf8");
  const size = Math.max(a.length, b.length, 1);
  const pa = Buffer.alloc(size);
  const pb = Buffer.alloc(size);
  a.copy(pa);
  b.copy(pb);
  return timingSafeEqual(pa, pb) && a.length === b.length;
}

/** 본문을 크기 한도 안에서 읽는다. 넘으면 undefined */
async function readLimited(request: Request, limit: number): Promise<string | undefined> {
  const declared = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(declared) && declared > limit) return undefined;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => undefined);
      return undefined;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function handleMessengerHook(request: Request, channel: string, deps: HookDeps): Promise<Response> {
  const { config, requestId } = deps;
  const log = deps.log ?? ((m: string) => console.warn(m));
  const rule = Object.hasOwn(MESSENGER_CHANNELS, channel) ? MESSENGER_CHANNELS[channel] : undefined;
  const secret = rule ? config.messengerSecrets[channel] : undefined;
  if (!rule || !secret) return json(404, "RESOURCE_NOT_FOUND", requestId);
  if (request.method.toUpperCase() !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST", "X-REQUEST-ID": requestId } });

  const given = request.headers.get(rule.secretHeader);
  if (!secretMatches(secret, given)) {
    // 본문은 읽지 않는다(auth.md §9.3)
    return json(401, "AUTH_TOKEN_INVALID", requestId);
  }

  const raw = await readLimited(request, MAX_HOOK_BODY_BYTES);
  if (raw === undefined) return json(413, "PAYLOAD_TOO_LARGE", requestId);
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json(400, "INVALID_REQUEST", requestId);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return json(400, "INVALID_REQUEST", requestId);
  const eventId = rule.eventId(body);
  if (!eventId) return json(400, "INVALID_REQUEST", requestId);

  const first = await deps.guard.firstSeen(`data2flow:hook:msg:${channel}:${eventId}`, REPLAY_TTL_SECONDS);
  if (!first) return json(200, "DUPLICATE_IGNORED", requestId);

  const work = deps
    .fetch(`${config.actionUrl}/internal/action/notifications/callbacks/${channel}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CALLER-SERVICE": "data2flow-web",
        "X-REQUEST-ID": requestId,
        // action의 채널 SPI verify가 다시 확인할 수 있게 그대로 넘긴다
        [rule.secretHeader]: given as string,
      },
      body: raw,
      signal: AbortSignal.timeout(FORWARD_TIMEOUT_MS),
    })
    .then((response) => {
      if (!response.ok) log(`[bff] messenger hook forward ${channel} failed: HTTP ${response.status} (request ${requestId})`);
    })
    .catch((error: unknown) => log(`[bff] messenger hook forward ${channel} failed: ${(error as Error).message} (request ${requestId})`));
  deps.waitUntil?.(work);
  return json(200, "SUCCESS", requestId);
}

let sharedGuard: ReplayGuard | undefined;

/* v8 ignore start -- 운영 기동 경로(Redis 선택). 테스트는 guard를 직접 넣는다 */
async function createGuard(config: BffConfig): Promise<ReplayGuard> {
  const memory = new MemoryReplayGuard();
  if (!config.redisUrl) return memory;
  try {
    const { Redis } = await import("ioredis");
    const client = new Redis(config.redisUrl, { lazyConnect: false, maxRetriesPerRequest: 1, enableOfflineQueue: false });
    client.on("error", (error: Error) => console.warn("[bff] hook replay guard redis error", error.message));
    return new RedisReplayGuard(client as unknown as RedisSetNx, memory);
  } catch (error) {
    console.warn("[bff] redis unavailable, using memory replay guard", (error as Error).message);
    return memory;
  }
}
/* v8 ignore stop */

export async function getReplayGuard(config: BffConfig): Promise<ReplayGuard> {
  sharedGuard ??= config.redisUrl ? await createGuard(config) : new MemoryReplayGuard();
  return sharedGuard;
}

/** 테스트에서 바꿔 끼운다 */
export function setReplayGuard(guard: ReplayGuard | undefined) {
  sharedGuard = guard;
}
