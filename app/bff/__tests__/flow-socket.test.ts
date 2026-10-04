/**
 * 플로우 라이브 뷰 WebSocket 중계(API-FLW-40·42, design/auth.md §8·§9.2, frontend.md §3.1 stream-proxy).
 * 실제 로컬 HTTP 서버 두 개: BFF(upgrade → handleFlowSocketUpgrade)와 가짜 gateway WebSocket 서버.
 */
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import { login } from "../auth-flow.server";
import { flowSocketTarget, handleFlowSocketUpgrade, relayCloseCode } from "../flow-socket.server";
import { createRuntime, type BffRuntime } from "../runtime.server";
import { GATEWAY } from "../../../test/msw/fake-gateway";
import { cookieValue, setup } from "./helpers";

const t = setup();
const ORIGIN = "https://data2flow.java21.net";

interface Upstream {
  server: Server;
  wss: WebSocketServer;
  url: string;
  requests: IncomingMessage[];
  sockets: WebSocket[];
  /** 다음 업그레이드를 이 상태로 거절한다 */
  reject: { status: number; code: string }[];
}

let upstream: Upstream;
let bffServer: Server;
let bffUrl: string;
let runtime: BffRuntime;

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port)));
}

async function startUpstream(): Promise<Upstream> {
  const wss = new WebSocketServer({ noServer: true });
  const state = { requests: [] as IncomingMessage[], sockets: [] as WebSocket[], reject: [] as { status: number; code: string }[] };
  // 일반 HTTP(토큰 재발급 등)는 MSW 가짜 gateway로 넘긴다: 운영에서도 REST와 WebSocket은 같은 gateway다
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const headers = Object.fromEntries(Object.entries(req.headers).filter(([, v]) => typeof v === "string")) as Record<string, string>;
      void fetch(`${GATEWAY}${req.url}`, { method: req.method, headers, body: chunks.length ? Buffer.concat(chunks) : undefined }).then(async (response) => {
        res.writeHead(response.status, Object.fromEntries(response.headers));
        res.end(Buffer.from(await response.arrayBuffer()));
      });
    });
  });
  server.on("upgrade", (req, socket, head) => {
    state.requests.push(req);
    const rejection = state.reject.shift();
    if (rejection) {
      const body = JSON.stringify({ header: { isSuccessful: false, resultCode: rejection.code } });
      socket.end(`HTTP/1.1 ${rejection.status} X\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\n\r\n${body}`);
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      state.sockets.push(ws);
      ws.on("message", (data) => {
        const msg = JSON.parse(String(data)) as { type: string };
        if (msg.type === "ping") ws.send(JSON.stringify({ type: "pong" }));
      });
    });
  });
  const port = await listen(server);
  return { server, wss, url: `http://127.0.0.1:${port}`, ...state };
}

beforeAll(async () => {
  t.server.listen();
  bffServer = createServer((_req, res) => res.writeHead(404).end());
  bffServer.on("upgrade", (req, socket, head) => {
    void handleFlowSocketUpgrade(req, socket, head, { runtime, connectTimeoutMs: 2000 }).then((handled) => {
      if (!handled) socket.destroy();
    });
  });
  bffUrl = `ws://127.0.0.1:${await listen(bffServer)}`;
});
afterAll(async () => {
  t.server.close();
  await new Promise((r) => bffServer.close(r));
});
beforeEach(async () => {
  const base = t.reset();
  upstream = await startUpstream();
  runtime = createRuntime({ config: { ...base.config, gatewayUrl: upstream.url }, store: base.store, now: base.now, rotations: base.rotations });
});
afterEach(async () => {
  for (const s of upstream.sockets) s.terminate();
  await new Promise((r) => upstream.server.close(r));
});

async function cookieFor() {
  const session = t.session();
  await login(session, "kim.op", "Correct-Horse-9");
  return cookieValue(session.commit());
}

type Opened = { ws: WebSocket; status?: number; body?: string; setCookie?: string[] };

function open(path: string, headers: Record<string, string>): Promise<Opened> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`${bffUrl}${path}`, { headers });
    ws.once("upgrade", (res) => (ws as WebSocket & { _setCookie?: string[] })._setCookie = res.headers["set-cookie"]);
    ws.once("open", () => resolve({ ws, setCookie: (ws as WebSocket & { _setCookie?: string[] })._setCookie }));
    ws.once("unexpected-response", (_req, res) => {
      let body = "";
      res.on("data", (c: Buffer) => (body += c.toString()));
      res.on("end", () => resolve({ ws, status: res.statusCode, body }));
    });
    ws.once("error", () => resolve({ ws, status: 0 }));
  });
}

const nextMessage = (ws: WebSocket) => new Promise<string>((resolve) => ws.once("message", (d) => resolve(String(d))));
const closed = (ws: WebSocket) => new Promise<{ code: number; reason: string }>((resolve) => ws.once("close", (code, reason) => resolve({ code, reason: String(reason) })));
const until = async (check: () => boolean) => {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setImmediate(r));
};

describe("API-FLW-40 FLW-03.01 라이브 뷰 WebSocket 중계 경로", () => {
  it("허용 경로만: /bff/stream/flows/{id}, /presence(API-FLW-42). 이상한 ID·하위 경로는 거부", () => {
    expect(flowSocketTarget("/bff/stream/flows/f-7f3a")).toEqual({ flowId: "f-7f3a", presence: false, path: "/api/v1/core/stream/flows/f-7f3a" });
    expect(flowSocketTarget("/bff/stream/flows/f-7f3a/presence")?.path).toBe("/api/v1/core/stream/flows/f-7f3a/presence");
    expect(flowSocketTarget("/bff/stream/flows/../x")).toBeUndefined();
    expect(flowSocketTarget("/bff/stream/flows/f-1/other")).toBeUndefined();
    expect(flowSocketTarget("/bff/stream/live")).toBeUndefined();
    expect(relayCloseCode(4401)).toBe(4401);
    expect(relayCloseCode(1006)).toBe(1011);
    expect(relayCloseCode(1005)).toBe(1011);
    expect(relayCloseCode(1000)).toBe(1000);
  });

  it("맡지 않는 경로는 false(서버 진입점이 닫는다)", async () => {
    const opened = await open("/bff/stream/live", { Origin: ORIGIN });
    expect(opened.status).toBe(0);
  });
});

describe("FLW-03.01 TC-FLW-065 세션 쿠키로 BFF에, BFF는 Bearer로 gateway에", () => {
  it("연결되면 gateway에 Authorization Bearer를 붙이고, 메시지를 양쪽으로 그대로 넘긴다(토큰은 브라우저에 없음)", async () => {
    const cookie = await cookieFor();
    const opened = await open("/bff/stream/flows/f-7f3a", { Origin: ORIGIN, Cookie: `data2flow_session=${cookie}` });
    expect(opened.status).toBeUndefined();
    await until(() => upstream.sockets.length === 1);
    const req = upstream.requests[0];
    expect(req.url).toBe("/api/v1/core/stream/flows/f-7f3a");
    expect(req.headers.authorization).toMatch(/^Bearer eyJ/);
    expect(req.headers["x-request-id"]).toBeTruthy();
    expect(req.headers.cookie).toBeUndefined();
    // 브라우저 → gateway
    const reply = nextMessage(opened.ws);
    opened.ws.send(JSON.stringify({ type: "ping" }));
    expect(JSON.parse(await reply)).toEqual({ type: "pong" });
    // gateway → 브라우저
    const stats = nextMessage(opened.ws);
    upstream.sockets[0].send(JSON.stringify({ type: "node.stats", t: "2026-10-04T00:00:01Z", version: 13, nodes: [] }));
    expect(await stats).toContain("node.stats");
    expect(await stats).not.toMatch(/eyJ/);
    opened.ws.close(1000);
  });

  it("gateway가 4401(세션 폐기)로 닫으면 브라우저도 4401로 닫힌다. 브라우저가 닫으면 gateway 연결도 정리된다", async () => {
    const cookie = await cookieFor();
    const first = await open("/bff/stream/flows/f-7f3a", { Origin: ORIGIN, Cookie: `data2flow_session=${cookie}` });
    await until(() => upstream.sockets.length === 1);
    const done = closed(first.ws);
    upstream.sockets[0].close(4401, "AUTH_SESSION_REVOKED");
    expect(await done).toEqual({ code: 4401, reason: "AUTH_SESSION_REVOKED" });

    const second = await open("/bff/stream/flows/f-7f3a/presence", { Origin: ORIGIN, Cookie: `data2flow_session=${cookie}` });
    await until(() => upstream.sockets.length === 2);
    expect(upstream.requests[1].url).toBe("/api/v1/core/stream/flows/f-7f3a/presence");
    const upstreamClosed = closed(upstream.sockets[1]);
    second.ws.close(1000);
    expect((await upstreamClosed).code).toBe(1000);
  });

  it("Origin이 웹 주소가 아니면 403(WebSocket의 CSRF 방어), 쿠키가 없으면 401", async () => {
    const cookie = await cookieFor();
    const evil = await open("/bff/stream/flows/f-7f3a", { Origin: "https://evil.example", Cookie: `data2flow_session=${cookie}` });
    expect(evil.status).toBe(403);
    expect(evil.body).toContain("AUTH_CSRF_INVALID");
    const anonymous = await open("/bff/stream/flows/f-7f3a", { Origin: ORIGIN });
    expect(anonymous.status).toBe(401);
    expect(upstream.requests).toHaveLength(0);
  });

  it("gateway가 401 AUTH_TOKEN_EXPIRED로 거절하면 한 번 재발급해 다시 연결하고, 바뀐 쿠키를 101 응답에 싣는다", async () => {
    const cookie = await cookieFor();
    upstream.reject.push({ status: 401, code: "AUTH_TOKEN_EXPIRED" });
    const opened = await open("/bff/stream/flows/f-7f3a", { Origin: ORIGIN, Cookie: `data2flow_session=${cookie}` });
    expect(opened.status).toBeUndefined();
    expect(upstream.requests).toHaveLength(2);
    expect(opened.setCookie?.some((c) => c.startsWith("data2flow_session="))).toBe(true);
    opened.ws.close();
  });

  it("gateway가 403·404로 거절하면 같은 상태로, 연결 실패는 502로 거절한다", async () => {
    const cookie = await cookieFor();
    upstream.reject.push({ status: 403, code: "PERMISSION_DENIED" });
    const forbidden = await open("/bff/stream/flows/f-7f3a", { Origin: ORIGIN, Cookie: `data2flow_session=${cookie}` });
    expect(forbidden.status).toBe(403);
    expect(forbidden.body).toContain("PERMISSION_DENIED");
    upstream.reject.push({ status: 404, code: "RESOURCE_NOT_FOUND" });
    expect((await open("/bff/stream/flows/f-x", { Origin: ORIGIN, Cookie: `data2flow_session=${cookie}` })).status).toBe(404);
    upstream.reject.push({ status: 500, code: "INTERNAL" });
    expect((await open("/bff/stream/flows/f-x", { Origin: ORIGIN, Cookie: `data2flow_session=${cookie}` })).status).toBe(502);
    await new Promise((r) => upstream.server.close(r));
    upstream.server.closeAllConnections();
    expect((await open("/bff/stream/flows/f-x", { Origin: ORIGIN, Cookie: `data2flow_session=${cookie}` })).status).toBe(502);
    upstream.server = createServer();
    await listen(upstream.server);
  });
});
