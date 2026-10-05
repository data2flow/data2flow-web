/**
 * 모바일 셸(UI-DSH-14, DSH-13.04): `/m/*` 화면 틀. 데스크톱 상단 메뉴 대신 하단 탭(알람·공간·작업·내 알림·QR)과 오프라인 띠.
 * 로그인·권한 가드는 데스크톱 화면과 같다(user.server.ts guardUser).
 */
import { useEffect } from "react";
import { Outlet, useNavigate } from "react-router";
import { bff } from "~/bff/middleware.server";
import { guardUser } from "~/bff/user.server";
import { MobileShell } from "~/features/field/components/mobile";
import { onLogout } from "~/lib/session-broadcast";
import { LIGHT_TOKENS } from "~/lib/tokens";
import type { Route } from "./+types/m-layout";

export const middleware: Route.MiddlewareFunction[] = [
  async ({ request, context }, next) => {
    await guardUser(bff(context), request);
    return next();
  },
];

export function meta() {
  return [{ title: "data2flow" }, { name: "theme-color", content: LIGHT_TOKENS.accent }];
}

export default function MobileLayout() {
  const navigate = useNavigate();
  useEffect(
    () =>
      onLogout((message) => {
        navigate(`/login?reason=${encodeURIComponent(message.reason === "logout" ? "logout" : "revoked")}`, { replace: true });
      }),
    [navigate],
  );
  return (
    <MobileShell>
      <Outlet />
    </MobileShell>
  );
}
