/**
 * UI-DSH-06 TV/키오스크 모드(`/kiosk?boards={id,…}&interval={sec}`, DSH-06.02). 앱 틀(메뉴) 없이 전체 화면.
 * 로그인 필요(VIEWER 이상, DASHBOARD_READ). 입력 검증: boards 1~10개, interval 30~600초.
 * 세션은 화면의 주기 요청과 BFF의 서버 쪽 토큰 갱신으로 유지하고, 세션이 끝나면 전체 화면 안내를 띄운다.
 */
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useRouteLoaderData } from "react-router";
import { bff } from "~/bff/middleware.server";
import { guardUser } from "~/bff/user.server";
import { KioskView } from "~/features/dashboards/components/kiosk-view";
import { MAX_BOARDS, MAX_INTERVAL, MIN_INTERVAL, parseKioskParams } from "~/features/dashboards/model/kiosk";
import type { RootData } from "~/root";
import type { Route } from "./+types/kiosk";

export const middleware: Route.MiddlewareFunction[] = [
  async ({ request, context }, next) => {
    await guardUser(bff(context), request);
    return next();
  },
];

export function meta() {
  return [{ title: "data2flow kiosk" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  return parseKioskParams(new URL(request.url).searchParams);
}

export default function Kiosk({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const root = useRouteLoaderData("root") as RootData | undefined;
  const { boards, interval, errors } = loaderData;
  const onExit = useCallback(() => navigate(boards[0] ? `/dashboards/${encodeURIComponent(boards[0])}` : "/dashboards"), [navigate, boards]);
  const onEnded = useCallback(() => undefined, []);
  if (errors.length) {
    return (
      <main className="mx-auto max-w-lg p-6">
        <div role="alert" className="rounded-md border border-bad/30 bg-bad-soft px-3 py-2 text-[13px] text-bad">
          {errors.includes("BOARDS") && <p>{t("dashboards.kiosk.boardsInvalid", { max: MAX_BOARDS })}</p>}
          {errors.includes("INTERVAL") && <p>{t("dashboards.kiosk.intervalInvalid", { min: MIN_INTERVAL, max: MAX_INTERVAL })}</p>}
        </div>
        <a href="/dashboards" className="mt-3 inline-block text-[13px] text-accent underline">
          {t("dashboards.title")}
        </a>
      </main>
    );
  }
  return <KioskView boards={boards} interval={interval} timezone={root?.timezone ?? "Asia/Seoul"} onExit={onExit} onSessionEnded={onEnded} />;
}
