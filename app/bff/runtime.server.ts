/**
 * BFF 실행 환경: 설정, Access 캐시, gateway 호출 함수, 시계. 테스트에서는 setRuntime으로 바꿔 끼운다.
 */
import { getConfig, type BffConfig } from "./config.server";
import { MemoryTokenStore, createRedisTokenStore, type TokenStore } from "./token-store.server";

/**
 * Refresh 회전 기록(이전 Refresh → 새 Refresh). 여러 탭이 같은 쿠키로 동시에 요청하면,
 * 늦게 도착한 요청이 이전 Refresh가 든 쿠키를 다시 쓰지 않도록 최신 값으로 바꿔 준다(AT-IAM-03.2).
 */
export class RotationLog {
  private readonly entries = new Map<string, { next: string; exp: number }>();

  constructor(
    private readonly now: () => number,
    private readonly ttlMs = 10 * 60_000,
  ) {}

  record(previous: string, next: string) {
    if (previous === next) return;
    this.entries.set(previous, { next, exp: this.now() + this.ttlMs });
    if (this.entries.size > 20_000) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
  }

  /** 기록이 있으면 가장 최신 Refresh를, 없으면 그대로 돌려준다 */
  latest(refreshToken: string): string {
    let current = refreshToken;
    for (let i = 0; i < 10; i++) {
      const entry = this.entries.get(current);
      if (!entry) break;
      if (entry.exp <= this.now()) {
        this.entries.delete(current);
        break;
      }
      current = entry.next;
    }
    return current;
  }
}

export interface RefreshedTokens {
  accessToken: string;
  expiresAt: number;
  refreshToken: string;
}

export interface BffRuntime {
  config: BffConfig;
  store: TokenStore;
  fetch: typeof fetch;
  now: () => number;
  rotations: RotationLog;
  /** 같은 Refresh로 동시에 들어온 재발급은 한 번만 보낸다(single-flight) */
  inflight: Map<string, Promise<RefreshedTokens>>;
}

let runtime: BffRuntime | undefined;
let initializing: Promise<BffRuntime> | undefined;

export function createRuntime(overrides: Partial<BffRuntime> = {}): BffRuntime {
  const now = overrides.now ?? Date.now;
  return {
    config: overrides.config ?? getConfig(),
    store: overrides.store ?? new MemoryTokenStore(now),
    // 호출할 때마다 전역 fetch를 찾는다(테스트의 MSW 가로채기와 호환)
    fetch: overrides.fetch ?? ((input, init) => globalThis.fetch(input, init)),
    now,
    rotations: overrides.rotations ?? new RotationLog(now),
    inflight: overrides.inflight ?? new Map(),
  };
}

/* v8 ignore start -- 운영 기동 경로(Redis 선택). 테스트는 setRuntime을 쓴다 */
async function initialize(): Promise<BffRuntime> {
  const config = getConfig();
  let store: TokenStore | undefined;
  if (config.redisUrl) {
    try {
      store = await createRedisTokenStore(config.redisUrl);
    } catch (error) {
      console.warn("[bff] redis unavailable, using memory token cache", (error as Error).message);
    }
  }
  return createRuntime({ config, store });
}
/* v8 ignore stop */

export async function getRuntime(): Promise<BffRuntime> {
  if (runtime) return runtime;
  initializing ??= initialize().then((created) => {
    runtime ??= created;
    return runtime;
  });
  return initializing;
}

export function setRuntime(next: BffRuntime | undefined) {
  runtime = next;
  initializing = undefined;
}
