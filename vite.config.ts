import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { defineConfig, type Plugin } from "vite";

/**
 * 개발 서버(`pnpm dev`)에서도 플로우 라이브 뷰·편집 참여 WebSocket(`/bff/stream/flows/**`, API-FLW-40·42)을 중계한다.
 * 운영은 server.mjs가 같은 처리기(app/bff/flow-socket.server.ts)를 쓴다. Vite HMR 연결은 건드리지 않는다.
 */
function flowSocketDev(): Plugin {
  return {
    name: "data2flow-flow-socket-dev",
    apply: "serve",
    configureServer(server) {
      server.httpServer?.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
        if (!req.url?.startsWith("/bff/stream/flows/")) return;
        void server
          .ssrLoadModule("/app/bff/flow-socket.server.ts")
          .then((mod) => (mod as { handleFlowSocketUpgrade: (r: IncomingMessage, s: Duplex, h: Buffer) => Promise<boolean> }).handleFlowSocketUpgrade(req, socket, head))
          .catch(() => socket.destroy());
      });
    },
  };
}

export default defineConfig({
  plugins: [tailwindcss(), reactRouter(), flowSocketDev()],
  resolve: {
    tsconfigPaths: true,
  },
});
