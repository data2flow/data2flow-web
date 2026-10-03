/**
 * `/bff/stream/**` 실시간 연결 중계(design/auth.md §9.2 "실시간", IAM-07.06). 브라우저 `EventSource`가 세션 쿠키로 연결한다.
 */
import { bff } from "~/bff/middleware.server";
import { proxyStream } from "~/bff/stream-proxy.server";
import type { Route } from "./+types/bff-stream";

export async function loader({ request, context, params }: Route.LoaderArgs) {
  return proxyStream(request, bff(context), params["*"] ?? "");
}
