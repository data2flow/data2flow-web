/**
 * data2flow-web 운영 서버(SSR + BFF). `react-router-serve`와 같은 방식으로 빌드를 내보내고(정적 파일·압축·요청 기록),
 * 그 위에 플로우 라이브 뷰·편집 참여 WebSocket 중계(`/bff/stream/flows/**`, API-FLW-40·42)를 위한 HTTP upgrade를 더한다.
 * 환경 변수: PORT(기본 8080), HOST(선택). `react-router-serve ./build/server/index.js`로도 뜨지만 그때는 WebSocket이 없다.
 */
/* global process, console, setTimeout */
import path from "node:path";
import url from "node:url";
import { createRequestHandler } from "@react-router/express";
import compression from "compression";
import express from "express";

const buildPath = path.resolve(process.argv[2] ?? "build/server/index.js");
const build = await import(url.pathToFileURL(buildPath).href);
const clientDir = path.resolve(path.dirname(buildPath), "..", "client");
const port = Number(process.env.PORT ?? 8080);

const app = express();
app.disable("x-powered-by");
app.use(compression());
app.use("/assets", express.static(path.join(clientDir, "assets"), { immutable: true, maxAge: "1y" }));
app.use(express.static(clientDir));
app.use(express.static("public", { maxAge: "1h" }));
app.all("/{*splat}", createRequestHandler({ build, mode: process.env.NODE_ENV ?? "production" }));

const onListen = () => console.log(`[data2flow-web] http://${process.env.HOST ?? "0.0.0.0"}:${port}`);
const server = process.env.HOST ? app.listen(port, process.env.HOST, onListen) : app.listen(port, onListen);

const upgrade = build.entry?.module?.handleFlowSocketUpgrade;
server.on("upgrade", (req, socket, head) => {
  if (typeof upgrade !== "function") {
    socket.destroy();
    return;
  }
  upgrade(req, socket, head).then(
    (handled) => {
      if (!handled) {
        socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
        socket.destroy();
      }
    },
    (error) => {
      console.error("[data2flow-web] websocket upgrade failed", error);
      socket.destroy();
    },
  );
});

// 무중단 배포: SIGTERM이면 새 연결을 받지 않고 진행 중인 요청을 마친 뒤 끝낸다(열린 WebSocket은 10초 뒤 정리)
process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 10_000).unref();
});
