/**
 * 서버 렌더링 진입점. React Router 기본 구현에 CSP nonce(design/auth.md §9.2 "CSP(nonce 기반)")만 더했다.
 * nonce는 BFF 미들웨어가 요청마다 만들고, 같은 값을 CSP 헤더와 인라인 스크립트에 쓴다.
 */
import { PassThrough } from "node:stream";
import { createReadableStreamFromReadable } from "@react-router/node";
import { isbot } from "isbot";
import type { RenderToPipeableStreamOptions } from "react-dom/server";
import { renderToPipeableStream } from "react-dom/server";
import type { EntryContext, RouterContextProvider } from "react-router";
import { ServerRouter } from "react-router";
import { getConfig } from "./bff/config.server";
import { bffContext } from "./bff/middleware.server";
import { NonceContext } from "./lib/nonce";

export const streamTimeout = 5_000;

// 플로우 라이브 뷰 WebSocket 중계(API-FLW-40·42). 서버 진입점(server.mjs)이 빌드의 `entry.module`에서 꺼내 upgrade 사건에 연결한다
export { handleFlowSocketUpgrade } from "./bff/flow-socket.server";

// 운영에서 필수 설정(세션 키 등)이 없으면 첫 요청이 아니라 기동할 때 실패한다(auth.md §11 #8)
if (process.env.NODE_ENV === "production") getConfig();

export default function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
  loadContext: RouterContextProvider,
) {
  if (request.method.toUpperCase() === "HEAD") {
    return new Response(null, { status: responseStatusCode, headers: responseHeaders });
  }
  let nonce: string | undefined;
  try {
    nonce = loadContext.get(bffContext)?.nonce;
  } catch {
    nonce = undefined;
  }

  return new Promise((resolve, reject) => {
    let shellRendered = false;
    const userAgent = request.headers.get("user-agent");
    const readyOption: keyof RenderToPipeableStreamOptions = (userAgent && isbot(userAgent)) || routerContext.isSpaMode ? "onAllReady" : "onShellReady";
    let timeoutId: ReturnType<typeof setTimeout> | undefined = setTimeout(() => abort(), streamTimeout + 1000);

    const { pipe, abort } = renderToPipeableStream(
      <NonceContext.Provider value={nonce}>
        <ServerRouter context={routerContext} url={request.url} nonce={nonce} />
      </NonceContext.Provider>,
      {
        nonce,
        [readyOption]() {
          shellRendered = true;
          const body = new PassThrough({
            final(callback) {
              clearTimeout(timeoutId);
              timeoutId = undefined;
              callback();
            },
          });
          const stream = createReadableStreamFromReadable(body);
          responseHeaders.set("Content-Type", "text/html; charset=utf-8");
          pipe(body);
          resolve(new Response(stream, { headers: responseHeaders, status: responseStatusCode }));
        },
        onShellError(error: unknown) {
          reject(error);
        },
        onError(error: unknown) {
          responseStatusCode = 500;
          if (shellRendered) console.error(error);
        },
      },
    );
  });
}
