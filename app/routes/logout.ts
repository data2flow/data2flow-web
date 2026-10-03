/**
 * 로그아웃(UI-IAM-04 사용자 메뉴, API-IAM-03). POST + CSRF만 받는다. 쿠키·캐시를 지우고 로그인 화면으로 보낸다.
 */
import { redirect } from "react-router";
import { logout } from "~/bff/auth-flow.server";
import { bff } from "~/bff/middleware.server";
import type { Route } from "./+types/logout";

export async function action({ context }: Route.ActionArgs) {
  await logout(bff(context).session);
  return redirect("/login?reason=logout");
}

export function loader() {
  return redirect("/");
}
