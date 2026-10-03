import { setupServer } from "msw/node";
import { FakeGateway, GATEWAY } from "../../../test/msw/fake-gateway";
import { loadConfig } from "../config.server";
import { createRuntime, setRuntime, type BffRuntime } from "../runtime.server";
import { BffSession, type RequestMeta } from "../session.server";

export const meta: RequestMeta = { requestId: "req-00000001", lang: "ko", clientIp: "59.28.174.54", userAgent: "UA" };
export const START = Date.parse("2026-10-04T00:00:00Z");

export function setup() {
  const server = setupServer();
  const state = { now: START, gateway: undefined as unknown as FakeGateway, runtime: undefined as unknown as BffRuntime };
  const clock = () => state.now;
  return {
    server,
    state,
    reset(env: Record<string, string> = {}) {
      state.now = START;
      state.gateway = new FakeGateway(clock);
      server.resetHandlers(...state.gateway.handlers());
      const config = loadConfig({ DATA2FLOW_GATEWAY_URL: GATEWAY, DATA2FLOW_SESSION_KEYS: `k1:${Buffer.alloc(32, 9).toString("base64")}`, ...env });
      state.runtime = createRuntime({ config, now: clock });
      setRuntime(state.runtime);
      return state.runtime;
    },
    session(cookie?: string) {
      const request = new Request("https://data2flow.java21.net/", { headers: cookie ? { Cookie: `data2flow_session=${cookie}` } : {} });
      return BffSession.fromRequest(request, state.runtime, meta);
    },
  };
}

/** commit 결과 Set-Cookie에서 쿠키 값만 */
export function cookieValue(setCookie: string | undefined) {
  return setCookie?.split(";")[0].split("=").slice(1).join("=") ?? "";
}
