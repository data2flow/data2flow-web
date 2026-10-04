/**
 * 가짜 WebSocket(frontend.md §3.4 "라이브 뷰는 가짜 WebSocket으로"): 열기·메시지·닫기를 테스트가 직접 일으킨다.
 */
import type { SocketFactory, SocketLike } from "../live/flow-socket";

export class FakeSocket implements SocketLike {
  readyState = 0;
  sent: unknown[] = [];
  closedWith?: number;
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number; reason?: string }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;

  constructor(readonly url: string) {}

  send(data: string) {
    this.sent.push(JSON.parse(data));
  }

  close(code = 1000) {
    this.closedWith = code;
    this.readyState = 3;
  }

  open() {
    this.readyState = 1;
    this.onopen?.({});
  }

  emit(message: unknown) {
    this.onmessage?.({ data: typeof message === "string" ? message : JSON.stringify(message) });
  }

  serverClose(code: number, reason = "") {
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }
}

export function fakeSockets() {
  const sockets: FakeSocket[] = [];
  const create: SocketFactory = (url) => {
    const socket = new FakeSocket(url);
    sockets.push(socket);
    return socket;
  };
  return { sockets, create, last: () => sockets[sockets.length - 1], byPath: (part: string) => sockets.filter((s) => s.url.includes(part)) };
}
