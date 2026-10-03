/**
 * `/bff/api/{svc}/**` 중계(design/auth.md §9.2, IAM-07.04). 세션 쿠키 + CSRF(상태 변경)로 들어온 요청에
 * BFF가 Access 토큰을 붙여 내부 gateway로 넘긴다.
 */
import { bff } from "~/bff/middleware.server";
import { proxyRequest } from "~/bff/proxy.server";
import type { Route } from "./+types/bff-api";

export async function loader({ request, context, params }: Route.LoaderArgs) {
  return proxyRequest(request, bff(context), params.svc, params["*"] ?? "");
}

export async function action({ request, context, params }: Route.ActionArgs) {
  return proxyRequest(request, bff(context), params.svc, params["*"] ?? "");
}
