/**
 * 로그인 사용자 정보(API-IAM-04)와 화면 가드. 요청 하나에서 한 번만 부른다(root loader와 app-layout 미들웨어가 함께 씀).
 */
import { data, redirect } from "react-router";
import type { Me } from "~/lib/api-types";
import { hasAny, requiredPermissionsFor } from "~/lib/permissions";
import { callApi, loginUrl, type ApiResult } from "./api.server";
import type { BffRequestContext } from "./middleware.server";

const cache = new WeakMap<BffRequestContext, Promise<ApiResult<Me>>>();

export function getMe(ctx: BffRequestContext, request: Request): Promise<ApiResult<Me>> {
  let pending = cache.get(ctx);
  if (!pending) {
    pending = callApi<Me>(ctx, request, "/api/v1/core/accounts/me", { noGuards: true }).then((result) => {
      if (result.ok && result.data) {
        const me = { ...result.data, permissions: result.data.permissions ?? [] };
        ctx.session.setMustChangePassword(Boolean(me.mustChangePassword));
        ctx.session.setIdentity(me.id, undefined);
        return { ...result, data: me };
      }
      return result;
    });
    cache.set(ctx, pending);
  }
  return pending;
}

const SECURITY_PATH = "/me/security";

/**
 * 로그인 뒤 화면 가드(design/auth.md §9.2 "라우트 가드"):
 * 세션 없음 → /login?next= · 임시 비밀번호(IAM-01.02)·2단계 인증 설정 필요(BR-IAM-25) → 내 정보 > 보안만 ·
 * 메뉴 권한 없음 → 403 화면(UI-IAM-13)
 */
export async function guardUser(ctx: BffRequestContext, request: Request): Promise<Me | null> {
  if (!ctx.session.authenticated) throw redirect(loginUrl(request, ctx.session.expired ? "expired" : undefined));
  const pathname = new URL(request.url).pathname.replace(/\.data$/, "");
  const result = await getMe(ctx, request);
  if (!result.ok) {
    if (result.code === "MFA_SETUP_REQUIRED") {
      if (pathname !== SECURITY_PATH) throw redirect(`${SECURITY_PATH}?required=mfa`);
      return null;
    }
    if (result.code === "AUTH_PASSWORD_CHANGE_REQUIRED") {
      if (pathname !== SECURITY_PATH) throw redirect(`${SECURITY_PATH}?required=password`);
      return null;
    }
    throw data({ code: result.code }, { status: result.status });
  }
  const me = result.data;
  if (me.mustChangePassword && pathname !== SECURITY_PATH) throw redirect(`${SECURITY_PATH}?required=password`);
  const required = requiredPermissionsFor(pathname);
  if (!hasAny(me.permissions, required)) throw data({ code: "PERMISSION_DENIED", required }, { status: 403 });
  return me;
}
