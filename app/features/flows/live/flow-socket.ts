/**
 * 플로우 WebSocket 클라이언트(API-FLW-40 라이브 뷰, API-FLW-42 편집 참여). 브라우저는 세션 쿠키로 BFF `/bff/stream/flows/**`에 연결한다.
 * - 연결되면 처음 메시지(구독 `subscribe` 등)를 보내고, 주기 메시지(`ping` 30초, `heartbeat` 20초)를 보낸다
 * - 끊기면 1→2→4…최대 30초 백오프로 다시 연결한다. 서버가 4401(세션 끝)로 닫으면 다시 연결하지 않고 로그인으로,
 *   4403(권한 없음)이면 다시 연결하지 않는다
 */
import { backoffDelay } from "~/lib/event-stream";
import { announceLogout } from "~/lib/session-broadcast";
import type { LiveConnectionState } from "../model/live";

export interface SocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number; reason?: string }) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

export type SocketFactory = (url: string) => SocketLike;

export const SOCKET_OPEN = 1;
export const CLOSE_SESSION_ENDED = 4401;
export const CLOSE_FORBIDDEN = 4403;

/** 같은 출처의 ws(s) 주소 */
export function socketUrl(path: string, location: Pick<Location, "protocol" | "host"> | undefined = typeof window === "undefined" ? undefined : window.location): string {
  if (!location) return path;
  return `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}${path}`;
}

export const defaultSocketFactory: SocketFactory | undefined =
  typeof WebSocket === "undefined" ? undefined : (url) => new WebSocket(url) as unknown as SocketLike;

/** 4401이면 모든 탭에 로그아웃을 알리고 로그인 화면으로 */
export function goToLogin() {
  announceLogout("AUTH_SESSION_REVOKED");
  if (typeof window !== "undefined") window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
}

export interface FlowSocketOptions {
  url: string;
  create: SocketFactory;
  /** 연결될 때마다 보내는 메시지 */
  hello?: () => unknown[];
  /** 주기 메시지(라이브 뷰 ping 30초, 편집 참여 heartbeat 20초) */
  keepAlive?: { message: unknown; everyMs: number };
  onMessage: (raw: unknown) => void;
  onState: (state: LiveConnectionState) => void;
  onSessionEnded?: () => void;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export class FlowSocket {
  private socket: SocketLike | null = null;
  private attempt = 0;
  private retryTimer: unknown = null;
  private keepAliveTimer: unknown = null;
  private stopped = true;

  constructor(private readonly options: FlowSocketOptions) {}

  private set(fn: () => void, ms: number) {
    return (this.options.setTimer ?? ((f, m) => setTimeout(f, m)))(fn, ms);
  }

  private clear(handle: unknown) {
    if (handle !== null) (this.options.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>)))(handle);
  }

  start() {
    this.stopped = false;
    this.connect();
  }

  send(message: unknown): boolean {
    if (!this.socket || this.socket.readyState !== SOCKET_OPEN) return false;
    this.socket.send(JSON.stringify(message));
    return true;
  }

  private connect() {
    if (this.stopped) return;
    this.options.onState(this.attempt === 0 ? "connecting" : "reconnecting");
    const socket = this.options.create(this.options.url);
    this.socket = socket;
    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.attempt = 0;
      this.options.onState("open");
      for (const message of this.options.hello?.() ?? []) socket.send(JSON.stringify(message));
      this.scheduleKeepAlive();
    };
    socket.onmessage = (event) => {
      if (this.socket === socket) this.options.onMessage(event.data);
    };
    socket.onerror = () => undefined;
    socket.onclose = (event) => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.clear(this.keepAliveTimer);
      this.keepAliveTimer = null;
      if (this.stopped) return;
      if (event.code === CLOSE_SESSION_ENDED) {
        this.stopped = true;
        this.options.onState("ended");
        (this.options.onSessionEnded ?? goToLogin)();
        return;
      }
      if (event.code === CLOSE_FORBIDDEN) {
        this.stopped = true;
        this.options.onState("denied");
        return;
      }
      this.options.onState("reconnecting");
      const delay = backoffDelay(this.attempt);
      this.attempt += 1;
      this.retryTimer = this.set(() => {
        this.retryTimer = null;
        this.connect();
      }, delay);
    };
  }

  private scheduleKeepAlive() {
    const keepAlive = this.options.keepAlive;
    if (!keepAlive) return;
    this.keepAliveTimer = this.set(() => {
      this.keepAliveTimer = null;
      if (this.send(keepAlive.message)) this.scheduleKeepAlive();
    }, keepAlive.everyMs);
  }

  stop() {
    this.stopped = true;
    this.clear(this.retryTimer);
    this.clear(this.keepAliveTimer);
    this.retryTimer = null;
    this.keepAliveTimer = null;
    const socket = this.socket;
    this.socket = null;
    socket?.close(1000);
    this.options.onState("idle");
  }
}
