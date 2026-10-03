/**
 * 로그인 뒤 화면 틀(상단 내비게이션 + 권한별 메뉴, IAM-04.05). 가드는 미들웨어에서 먼저 한다(user.server.ts).
 */
import { useEffect } from "react";
import { Outlet, useNavigate, useRouteLoaderData } from "react-router";
import { bff } from "~/bff/middleware.server";
import { guardUser } from "~/bff/user.server";
import { AppShell } from "~/components/app-shell";
import { onLogout } from "~/lib/session-broadcast";
import type { RootData } from "~/root";
import type { Route } from "./+types/app-layout";

export const middleware: Route.MiddlewareFunction[] = [
  async ({ request, context }, next) => {
    await guardUser(bff(context), request);
    return next();
  },
];

export default function AppLayout() {
  const root = useRouteLoaderData("root") as RootData | undefined;
  const navigate = useNavigate();
  useEffect(
    () =>
      // 다른 탭에서 로그아웃·세션 종료가 일어나면 이 탭도 로그인 화면으로(UI-IAM-13)
      onLogout((message) => {
        navigate(`/login?reason=${encodeURIComponent(message.reason === "logout" ? "logout" : "revoked")}`, { replace: true });
      }),
    [navigate],
  );
  return (
    <AppShell me={root?.me ?? null}>
      <Outlet />
    </AppShell>
  );
}
