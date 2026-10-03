/**
 * 테마 바꾸기(DSH-07.02, 사용자 메뉴 빠른 전환). POST + CSRF만 받는다. 고른 값은 쿠키에 두어 서버 렌더링부터 적용하고,
 * 로그인 상태면 계정 화면 설정(API-DSH-12 `theme`)에도 저장한다(실패해도 쿠키는 남긴다).
 */
import { redirect } from "react-router";
import { callApi, field } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { safeNextPath } from "~/lib/next-path";
import { THEME_COOKIE, normalizeTheme } from "~/lib/theme";
import type { Route } from "./+types/theme";

export async function action({ request, context }: Route.ActionArgs) {
  const ctx = bff(context);
  const form = await request.formData();
  const theme = normalizeTheme(field(form, "theme"));
  const next = safeNextPath(field(form, "next"));
  if (ctx.session.authenticated) {
    try {
      const current = await callApi<{ version?: number }>(ctx, request, "/api/v1/core/accounts/me/preferences", { noGuards: true });
      if (current.ok) await callApi(ctx, request, "/api/v1/core/accounts/me/preferences", { method: "PUT", body: { theme, baseVersion: current.data?.version ?? 0 }, noGuards: true });
    } catch (error) {
      // 세션이 끝났으면 로그인으로, 그 밖의 저장 실패는 쿠키만으로 적용
      if (error instanceof Response) throw error;
    }
  }
  const secure = ctx.runtime.config.cookieSecure ? "; Secure" : "";
  return redirect(next, { headers: { "Set-Cookie": `${THEME_COOKIE}=${theme}; Path=/; Max-Age=31536000; SameSite=Lax${secure}` } });
}

export function loader() {
  return redirect("/");
}
