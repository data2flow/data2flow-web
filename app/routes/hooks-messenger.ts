/**
 * API-RUL-31 메신저 콜백 `POST /hooks/messenger/{channel}` (design/auth.md §9.3). 세션·CSRF 밖의 서버 간 호출이다.
 * 검증·재전송 방지·내부 중계는 app/bff/messenger-hook.server.ts가 한다.
 */
import { getReplayGuard, handleMessengerHook } from "~/bff/messenger-hook.server";
import { requestMetaFrom } from "~/bff/request-meta.server";
import { getRuntime } from "~/bff/runtime.server";
import type { Route } from "./+types/hooks-messenger";

async function handle(request: Request, channel: string) {
  const runtime = await getRuntime();
  const meta = requestMetaFrom(request, runtime.config.trustedProxyHops);
  return handleMessengerHook(request, channel, { config: runtime.config, fetch: runtime.fetch, guard: await getReplayGuard(runtime.config), requestId: meta.requestId });
}

export function action({ request, params }: Route.ActionArgs) {
  return handle(request, params.channel);
}

export function loader({ request, params }: Route.LoaderArgs) {
  return handle(request, params.channel);
}
