/**
 * 플로우 라이브 뷰·편집 참여 WebSocket 중계(API-FLW-40·42, design/auth.md §8·§9.2 "플로우 라이브 뷰·편집 참여자만 WebSocket").
 * 브라우저 `wss://…/bff/stream/flows/{flowId}`(또는 `/presence`) → BFF → gateway `ws://…/api/v1/core/stream/flows/{flowId}[/presence]`.
 * - 허용 Origin(웹 주소)만 받는다. WebSocket은 CSRF 토큰을 붙일 수 없으므로 Origin 검사가 CSRF 방어다
 * - 세션 쿠키를 열어 Access를 확보하고(캐시 → 재발급) gateway 연결에 `Authorization: Bearer`를 붙인다. 브라우저는 토큰을 모른다
 * - gateway가 401 AUTH_TOKEN_EXPIRED로 거절하면 한 번 재발급해 다시 연결한다. 세션이 끝났으면 HTTP 401로 거절한다
 * - 연결 뒤에는 양쪽 메시지를 그대로 넘기고, 한쪽이 닫으면 다른 쪽도 같은 코드(4401·4403 등)로 닫는다
 * 서버 진입점(server.mjs)이 HTTP upgrade 사건에서 부른다. app/entry.server.tsx가 다시 내보내 운영 빌드에 함께 묶인다.
 */
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { SessionEndedError, ensureAccessToken } from "./gateway.server";
import { isAllowedOrigin } from "./middleware.server";
import { requestMetaFrom } from "./request-meta.server";
import { getRuntime, type BffRuntime } from "./runtime.server";
import { BffSession } from "./session.server";

/** 브라우저 메시지 한 건 상한(구독·선택·잠금 요청만 오므로 작다) */
export const MAX_CLIENT_MESSAGE_BYTES = 64 * 1024;

const PATH = /^\/bff\/stream\/flows\/([A-Za-z0-9_-]{1,64})(\/presence)?$/;

/** 브라우저 경로 → gateway 경로. 허용 목록 밖이면 undefined */
export function flowSocketTarget(pathname: string): { flowId: string; presence: boolean; path: string } | undefined {
  const match = PATH.exec(pathname);
  if (!match) return undefined;
  const presence = Boolean(match[2]);
  return { flowId: match[1], presence, path: `/api/v1/core/stream/flows/${match[1]}${presence ? "/presence" : ""}` };
}

/** 보낼 수 있는 닫기 코드로 바꾼다(1005·1006·1015는 예약 코드라 보낼 수 없다) */
export function relayCloseCode(code: number): number {
  if (code === 1000 || (code >= 1001 && code <= 1003) || (code >= 1007 && code <= 1014) || (code >= 3000 && code <= 4999)) return code;
  return 1011;
}

function rejectUpgrade(socket: Duplex, status: number, code: string) {
  const reason = { 401: "Unauthorized", 403: "Forbidden", 404: "Not Found", 502: "Bad Gateway", 503: "Service Unavailable" }[status] ?? "Error";
  const body = JSON.stringify({ header: { isSuccessful: false, resultCode: code, resultMessage: code } });
  if (socket.writable) {
    socket.write(`HTTP/1.1 ${status} ${reason}\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`);
  }
  socket.destroy();
}

export interface FlowSocketDeps {
  runtime?: BffRuntime;
  /** gateway 연결 수립 제한 시간. 기본은 설정의 gatewayTimeoutMs */
  connectTimeoutMs?: number;
}

type UpstreamResult = { ok: true; socket: WebSocket } | { ok: false; status: number; code: string };

function connectUpstream(url: string, headers: Record<string, string>, timeoutMs: number): Promise<UpstreamResult> {
  return new Promise((resolve) => {
    const upstream = new WebSocket(url, { headers, handshakeTimeout: timeoutMs, maxPayload: 4 * 1024 * 1024 });
    let settled = false;
    const done = (result: UpstreamResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    upstream.once("open", () => done({ ok: true, socket: upstream }));
    let rejected = false;
    upstream.once("unexpected-response", (_req, res) => {
      rejected = true;
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        let code = res.statusCode === 401 ? "AUTH_TOKEN_INVALID" : "SERVICE_UNAVAILABLE";
        try {
          const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { header?: { resultCode?: string } };
          code = parsed.header?.resultCode ?? code;
        } catch {
          /* 본문이 JSON이 아니면 상태 코드로만 판단 */
        }
        done({ ok: false, status: res.statusCode ?? 502, code });
        upstream.terminate();
      });
      res.on("error", () => done({ ok: false, status: 502, code: "SERVICE_UNAVAILABLE" }));
    });
    // 거절 응답(unexpected-response)은 본문을 다 읽은 뒤 판단한다. 그 뒤의 소켓 오류는 무시
    upstream.on("error", () => {
      if (!rejected) done({ ok: false, status: 502, code: "SERVICE_UNAVAILABLE" });
    });
  });
}

/** 연결된 두 소켓을 잇는다 */
export function relay(client: WebSocket, upstream: WebSocket) {
  client.on("message", (data: RawData, isBinary: boolean) => {
    if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary: isBinary });
  });
  upstream.on("message", (data: RawData, isBinary: boolean) => {
    if (client.readyState === WebSocket.OPEN) client.send(data, { binary: isBinary });
  });
  const closeOther = (other: WebSocket) => (code: number, reason: Buffer) => {
    if (other.readyState === WebSocket.OPEN || other.readyState === WebSocket.CONNECTING) other.close(relayCloseCode(code), reason.subarray(0, 120));
  };
  client.on("close", closeOther(upstream));
  upstream.on("close", closeOther(client));
  client.on("error", () => upstream.terminate());
  upstream.on("error", () => client.close(1011));
}

const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_CLIENT_MESSAGE_BYTES });
/** 재발급으로 바뀐 세션 쿠키를 101 응답에 싣는다 */
const pendingCookies = new WeakMap<IncomingMessage, string>();
wss.on("headers", (headers: string[], req: IncomingMessage) => {
  const cookie = pendingCookies.get(req);
  if (cookie) headers.push(`Set-Cookie: ${cookie}`);
});

/**
 * HTTP upgrade 처리. 이 중계가 맡는 경로가 아니면 false를 돌려준다(호출한 쪽이 소켓을 닫는다).
 */
export async function handleFlowSocketUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer, deps: FlowSocketDeps = {}): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://bff.local");
  const target = flowSocketTarget(url.pathname);
  if (!target) return false;
  socket.on("error", () => socket.destroy());
  const runtime = deps.runtime ?? (await getRuntime());
  const origin = typeof req.headers.origin === "string" ? req.headers.origin : null;
  if (!isAllowedOrigin(origin, runtime.config)) {
    rejectUpgrade(socket, 403, "AUTH_CSRF_INVALID");
    return true;
  }
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (typeof value === "string") headers.set(name, value);
    else if (Array.isArray(value)) headers.set(name, value.join(", "));
  }
  const request = new Request(new URL(url.pathname + url.search, runtime.config.publicOrigin), { headers });
  const meta = requestMetaFrom(request, runtime.config.trustedProxyHops);
  const session = BffSession.fromRequest(request, runtime, meta);
  if (!session.authenticated) {
    rejectUpgrade(socket, 401, session.expired ? "AUTH_SESSION_EXPIRED" : "AUTH_TOKEN_INVALID");
    return true;
  }

  const upstreamUrl = `${runtime.config.gatewayUrl.replace(/^http/, "ws").replace(/\/+$/, "")}${target.path}${url.search}`;
  const timeout = deps.connectTimeoutMs ?? runtime.config.gatewayTimeoutMs;
  const upstreamHeaders = (token: string): Record<string, string> => {
    const out: Record<string, string> = { Authorization: `Bearer ${token}`, "X-REQUEST-ID": meta.requestId, "Accept-Language": meta.lang };
    if (meta.clientIp) out["X-Forwarded-For"] = meta.clientIp;
    if (meta.userAgent) out["User-Agent"] = meta.userAgent;
    return out;
  };

  let result: UpstreamResult;
  try {
    result = await connectUpstream(upstreamUrl, upstreamHeaders(await ensureAccessToken(session)), timeout);
    if (!result.ok && result.status === 401 && result.code === "AUTH_TOKEN_EXPIRED") {
      result = await connectUpstream(upstreamUrl, upstreamHeaders(await ensureAccessToken(session, true)), timeout);
    }
  } catch (error) {
    if (error instanceof SessionEndedError) {
      rejectUpgrade(socket, 401, error.code);
      return true;
    }
    rejectUpgrade(socket, 502, "SERVICE_UNAVAILABLE");
    return true;
  }
  if (!result.ok) {
    const status = [401, 403, 404].includes(result.status) ? result.status : 502;
    rejectUpgrade(socket, status, status === 502 ? "SERVICE_UNAVAILABLE" : result.code);
    return true;
  }
  const upstream = result.socket;
  if (socket.destroyed) {
    upstream.close(1001);
    return true;
  }
  const cookie = session.commit();
  if (cookie) pendingCookies.set(req, cookie);
  wss.handleUpgrade(req, socket, head, (client) => relay(client, upstream));
  return true;
}
