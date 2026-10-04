/**
 * UI-DEV-17 QR 현장 조회 진입(`/d/{qrToken}`, DEV-09.04, API-DEV-26). 로그인이 필요하다: 세션이 없으면 로그인 화면을 거쳐(`next`) 돌아온다(AT-DEV-21.1).
 * 토큰을 기기 ID로 바꿔 모바일 기기 상세(`/m/devices/{id}`)로 302. 재발급된 이전 라벨·권한 밖 기기는 친절한 404(AT-DEV-21.2).
 */
import { useTranslation } from "react-i18next";
import { data, redirect } from "react-router";
import { callApi } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { guardUser } from "~/bff/user.server";
import { ErrorView } from "~/components/error-view";
import type { Route } from "./+types/qr-link";

export const middleware: Route.MiddlewareFunction[] = [
  async ({ request, context }, next) => {
    await guardUser(bff(context), request);
    return next();
  },
];

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const ctx = bff(context);
  const result = await callApi<{ deviceId: string }>(ctx, request, `/api/v1/core/qr/${encodeURIComponent(params.token)}`);
  if (result.ok) throw redirect(`/m/devices/${encodeURIComponent(String(result.data.deviceId))}`);
  return data({ status: result.status === 404 ? 404 : result.status, code: result.code }, { status: result.status === 404 ? 404 : result.status });
}

export default function QrLink({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  return <ErrorView status={loaderData.status} code={loaderData.code} details={loaderData.status === 404 ? t("field.qr.notFound") : undefined} />;
}
