/**
 * 공유 링크 위젯 데이터 BFF 공개 경로(`GET /share/{token}/widgets/{widget-id}/data?q=`, DSH-06.03, API-DSH-15).
 * 세션·쿠키를 쓰지 않고 gateway 공개 경로 `POST /api/v1/core/public/share/{token}/widgets/{widget-id}/data`로만 넘긴다.
 * GET이라 CSRF 대상이 아니고(상태를 바꾸지 않음), 토큰·위젯 id는 형식을 먼저 보고, 본문은 범위·집계·변수만 골라 보낸다.
 * 토큰 경로 레이트 리밋(IP당 분당 60)은 gateway가 한다(TC-DSH-068).
 */
import { callApi } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { sharedRequestBody } from "~/features/dashboards/server";
import type { Route } from "./+types/share-widget-data";

const HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex" };

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: HEADERS });
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const ctx = bff(context);
  const token = params.token ?? "";
  const widgetId = params.widgetId ?? "";
  if (!/^[A-Za-z0-9_-]{16,100}$/.test(token) || !/^[A-Za-z0-9_-]{1,40}$/.test(widgetId)) {
    return json(404, { header: { isSuccessful: false, resultCode: "SHARE_LINK_INVALID", resultMessage: "" } });
  }
  const body = sharedRequestBody(new URL(request.url).searchParams.get("q"));
  const r = await callApi<unknown>(ctx, request, `/api/v1/core/public/share/${encodeURIComponent(token)}/widgets/${encodeURIComponent(widgetId)}/data`, { method: "POST", body, anonymous: true, noGuards: true });
  if (r.ok) return json(200, { header: { isSuccessful: true, resultCode: "SUCCESS", resultMessage: "" }, response: r.data });
  return json(r.status || 502, { header: { isSuccessful: false, resultCode: r.code, resultMessage: r.message } });
}
