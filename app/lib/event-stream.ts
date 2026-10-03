/**
 * 실시간 연결(SSE) 클라이언트(API-DSH-20 규칙, IAM-07.06, DSH-05.01).
 * - 브라우저는 `/bff/stream/**`에 세션 쿠키로만 연결한다. 토큰은 다루지 않는다
 * - 끊기면 지수 백오프(1→2→4…최대 30초)로 다시 연결하고, 다시 연결할 때 브라우저가 `Last-Event-ID`를 보낸다
 * - 끊긴 뒤에는 세션이 살아 있는지 한 번 확인한다. 세션이 끝났으면(401) bffFetch가 모든 탭에 로그아웃을 알린다
 * - 서버가 `session-revoked`를 보내면 다시 연결하지 않고 로그아웃을 알린다
 */
import { bffFetch } from "./bff-client";
import { announceLogout } from "./session-broadcast";

export type StreamStatus = "connecting" | "open" | "retrying" | "closed";

export interface StreamEvent<T = unknown> {
  type: string;
  data: T;
  id?: string;
}

export interface EventSourceLike {
  readonly readyState: number;
  onopen: ((event: Event) => void) | null;
  onerror: ((event: Event) => void) | null;
  addEventListener(type: string, listener: (event: MessageEvent) => void): void;
  close(): void;
}

export interface LiveConnectionOptions {
  url: string;
  /** 받을 event 이름(`message`는 이름 없는 이벤트) */
  events: string[];
  onEvent: (event: StreamEvent) => void;
  onStatus?: (status: StreamStatus) => void;
  createSource?: (url: string) => EventSourceLike;
  /** 끊긴 뒤 세션 확인. 기본은 내 정보 조회(401이면 bffFetch가 로그아웃을 알린다) */
  checkSession?: () => Promise<boolean>;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

/** 다시 연결 대기 시간: 1초부터 두 배씩, 최대 30초(API-DSH-20) */
export function backoffDelay(attempt: number): number {
  return Math.min(30_000, 1000 * 2 ** Math.max(0, attempt));
}

/** 토픽 목록을 실시간 구독 주소로(연결당 최대 200개, API-DSH-20) */
export function liveUrl(topics: string[]): string | null {
  const unique = [...new Set(topics.filter(Boolean))].slice(0, 200);
  if (unique.length === 0) return null;
  return `/bff/stream/live?topics=${encodeURIComponent(unique.join(","))}`;
}

function parse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

async function defaultCheckSession(): Promise<boolean> {
  try {
    const response = await bffFetch("/bff/api/core/accounts/me");
    return response.status !== 401;
  } catch {
    return true;
  }
}

export class LiveConnection {
  private source: EventSourceLike | null = null;
  private attempt = 0;
  private timer: unknown = null;
  private stopped = false;
  status: StreamStatus = "connecting";

  constructor(private readonly options: LiveConnectionOptions) {}

  private setStatus(status: StreamStatus) {
    this.status = status;
    this.options.onStatus?.(status);
  }

  start() {
    this.stopped = false;
    this.open();
  }

  private open() {
    if (this.stopped) return;
    const create = this.options.createSource ?? ((url: string) => new EventSource(url) as unknown as EventSourceLike);
    this.setStatus(this.attempt === 0 ? "connecting" : "retrying");
    const source = create(this.options.url);
    this.source = source;
    source.onopen = () => {
      this.attempt = 0;
      this.setStatus("open");
    };
    source.onerror = () => {
      if (this.source !== source) return;
      source.close();
      this.source = null;
      void this.retry();
    };
    for (const type of this.options.events) {
      source.addEventListener(type, (event) => {
        this.options.onEvent({ type, data: parse(String(event.data)), id: event.lastEventId || undefined });
      });
    }
    source.addEventListener("session-revoked", () => {
      this.stop();
      announceLogout("revoked");
    });
  }

  private async retry() {
    if (this.stopped) return;
    this.setStatus("retrying");
    const alive = await (this.options.checkSession ?? defaultCheckSession)();
    if (!alive) {
      this.stop();
      return;
    }
    const delay = backoffDelay(this.attempt);
    this.attempt += 1;
    const set = this.options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.timer = set(() => this.open(), delay);
  }

  stop() {
    this.stopped = true;
    if (this.timer !== null) (this.options.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>)))(this.timer);
    this.timer = null;
    this.source?.close();
    this.source = null;
    this.setStatus("closed");
  }
}

/**
 * 화면에 보여 줄 메시지 버퍼: 최대 개수를 넘으면 오래된 것부터 버리고(TC-DSH-026),
 * 일시정지 중에는 화면 목록을 고정한 채 대기 건수만 센다. 재개하면 대기분을 앞에 붙인다.
 */
export class MessageBuffer<T> {
  private shown: T[] = [];
  private pending: T[] = [];
  paused = false;

  constructor(private readonly max = 500) {}

  push(item: T) {
    if (this.paused) {
      this.pending.unshift(item);
      if (this.pending.length > this.max) this.pending.length = this.max;
      return;
    }
    this.shown.unshift(item);
    if (this.shown.length > this.max) this.shown.length = this.max;
  }

  pause() {
    this.paused = true;
  }

  resume() {
    this.paused = false;
    this.shown = [...this.pending, ...this.shown].slice(0, this.max);
    this.pending = [];
  }

  clear() {
    this.shown = [];
    this.pending = [];
  }

  get items(): readonly T[] {
    return this.shown;
  }

  get waiting(): number {
    return this.pending.length;
  }
}

/**
 * 초당 표시 상한(API-DSC-10 기본 10건/초). 상한을 넘은 메시지는 버리고 그 수를 "n건 생략"으로 보여 준다(TC-DSC-100).
 */
export class RateLimiter {
  private windowStart = 0;
  private count = 0;
  dropped = 0;

  constructor(
    private readonly perSecond: number,
    private readonly now: () => number = Date.now,
  ) {}

  allow(): boolean {
    const t = this.now();
    if (t - this.windowStart >= 1000) {
      this.windowStart = t;
      this.count = 0;
    }
    if (this.count < this.perSecond) {
      this.count += 1;
      return true;
    }
    this.dropped += 1;
    return false;
  }
}
