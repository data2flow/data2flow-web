/**
 * SSR 통합 테스트 도구: 실제 React Router 앱(라우트·미들웨어·BFF)을 Vite로 불러와 요청을 보내고,
 * gateway는 MSW 가짜(FakeGateway)로 바꾼다. 브라우저 대역(TestBrowser)은 쿠키 저장소와 Origin·CSRF를 흉내 낸다.
 */
import { setupServer } from "msw/node";
import { createRequestHandler } from "react-router";
import { createServer, type ViteDevServer } from "vite";
import { FakeGateway, GATEWAY } from "./msw/fake-gateway";

export const ORIGIN = "https://data2flow.java21.net";
export const START = Date.parse("2026-10-04T00:00:00Z");

interface RuntimeModule {
  createRuntime: (overrides: Record<string, unknown>) => unknown;
  setRuntime: (runtime: unknown) => void;
}
interface ConfigModule {
  loadConfig: (env: Record<string, string | undefined>) => Record<string, unknown>;
}

export class Clock {
  current = START;
  now = () => this.current;
  advance(ms: number) {
    this.current += ms;
  }
}

export interface AppContext {
  vite: ViteDevServer;
  handler: (request: Request) => Promise<Response>;
  gateway: FakeGateway;
  clock: Clock;
  server: ReturnType<typeof setupServer>;
  reset: (env?: Record<string, string>) => void;
  close: () => Promise<void>;
}

const KEY = Buffer.alloc(32, 7).toString("base64");

export async function startApp(): Promise<AppContext> {
  const vite = await createServer({ configFile: "vite.config.ts", server: { middlewareMode: true, hmr: false }, appType: "custom", logLevel: "error" });
  const build = await vite.ssrLoadModule("virtual:react-router/server-build");
  const runtimeModule = (await vite.ssrLoadModule("/app/bff/runtime.server.ts")) as unknown as RuntimeModule;
  const configModule = (await vite.ssrLoadModule("/app/bff/config.server.ts")) as unknown as ConfigModule;
  const handler = createRequestHandler(build as never, "production");
  const clock = new Clock();
  const server = setupServer();
  const ctx = { vite, handler, clock, server } as AppContext;
  server.listen({ onUnhandledFrame: "error" });

  ctx.reset = (env = {}) => {
    clock.current = START;
    ctx.gateway = new FakeGateway(clock.now);
    server.resetHandlers(...ctx.gateway.handlers());
    const config = configModule.loadConfig({
      NODE_ENV: "production",
      DATA2FLOW_GATEWAY_URL: GATEWAY,
      DATA2FLOW_PUBLIC_ORIGIN: ORIGIN,
      DATA2FLOW_SESSION_KEYS: `k1:${KEY}`,
      ...env,
    });
    runtimeModule.setRuntime(runtimeModule.createRuntime({ config, now: clock.now }));
  };
  ctx.close = async () => {
    server.close();
    await vite.close();
  };
  ctx.reset();
  return ctx;
}

export interface Exchange {
  request: Request;
  response: Response;
  body: string;
  setCookies: string[];
}

/** 쿠키 저장소가 있는 브라우저 대역. 응답은 모두 기록해 토큰 노출 검사에 쓴다 */
export class TestBrowser {
  cookies = new Map<string, string>();
  readonly exchanges: Exchange[] = [];
  csrf = "";

  constructor(
    private readonly app: AppContext,
    readonly userAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130 Safari/537.36",
  ) {}

  /** 같은 쿠키를 가진 다른 탭 */
  tab(): TestBrowser {
    const other = new TestBrowser(this.app, this.userAgent);
    other.cookies = this.cookies;
    other.csrf = this.csrf;
    return other;
  }

  cookieHeader() {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  async request(path: string, init: RequestInit & { origin?: string | null } = {}): Promise<Exchange> {
    const headers = new Headers(init.headers);
    headers.set("User-Agent", this.userAgent);
    headers.set("Accept-Language", headers.get("Accept-Language") ?? "ko-KR,ko;q=0.9");
    const cookie = this.cookieHeader();
    if (cookie) headers.set("Cookie", cookie);
    const method = (init.method ?? "GET").toUpperCase();
    if (method !== "GET" && init.origin !== null) headers.set("Origin", init.origin ?? ORIGIN);
    const request = new Request(`${ORIGIN}${path}`, { ...init, headers, redirect: "manual" });
    const response = await this.app.handler(request);
    const body = await response.clone().text();
    const setCookies = response.headers.getSetCookie();
    for (const raw of setCookies) {
      const [pair, ...attrs] = raw.split(";");
      const index = pair.indexOf("=");
      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      const expired = attrs.some((a) => /max-age=0\b/i.test(a.trim()));
      if (expired || !value) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    const meta = /<meta name="csrf-token" content="([^"]+)"/.exec(body);
    if (meta) this.csrf = meta[1];
    const exchange = { request, response, body, setCookies };
    this.exchanges.push(exchange);
    return exchange;
  }

  get(path: string, headers: Record<string, string> = {}) {
    return this.request(path, { headers });
  }

  /** 폼 제출(JS 없이 문서 POST). `_csrf`는 마지막으로 받은 페이지의 토큰 */
  post(path: string, fields: Record<string, string | string[]>, options: { csrf?: string | null; origin?: string | null } = {}) {
    const form = new URLSearchParams();
    const csrf = options.csrf === undefined ? this.csrf : options.csrf;
    if (csrf !== null) form.set("_csrf", csrf);
    for (const [key, value] of Object.entries(fields)) {
      for (const v of Array.isArray(value) ? value : [value]) form.append(key, v);
    }
    return this.request(path, { method: "POST", body: form, headers: { "Content-Type": "application/x-www-form-urlencoded" }, origin: options.origin });
  }

  async login(loginId: string, password: string, next?: string) {
    await this.get("/login");
    return this.post("/login", { intent: "credentials", loginId, password, next: next ?? "/" });
  }
}

/** JWT 모양 문자열 */
export const JWT_PATTERN = /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/;
