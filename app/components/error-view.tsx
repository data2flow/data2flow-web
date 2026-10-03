/**
 * 오류·접근 안내(UI-IAM-13): 401·403·404·503 등 상태별 문구, [홈으로], [다시 로그인](401), 요청 ID.
 */
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { announceLogout } from "~/lib/session-broadcast";

export function ErrorView({ status, code, details, requestId }: { status: number; code?: string; details?: string; requestId?: string }) {
  const { t } = useTranslation();
  const key = [401, 403, 404, 503].includes(status) ? String(status) : "500";
  useEffect(() => {
    if (status === 401) announceLogout(code);
  }, [status, code]);
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-md rounded-lg border border-line bg-panel p-8 text-center">
        <p className="text-[26px] font-semibold text-muted">{status}</p>
        <h1 className="mt-2 text-[18px] font-bold">{t(`errorPage.${key}.title`)}</h1>
        <p className="mt-2 text-muted">{details ?? t(`errorPage.${key}.body`)}</p>
        {code && code !== "PERMISSION_DENIED" && <p className="mt-2 font-mono text-[12px] text-muted">{code}</p>}
        {requestId && <p className="mt-2 font-mono text-[12px] text-muted">{t("errorPage.requestId", { id: requestId })}</p>}
        <div className="mt-6 flex justify-center gap-2">
          <Link to="/" className="rounded-md border border-line px-3 py-1.5">
            {t("errorPage.home")}
          </Link>
          {status === 401 && (
            <Link to="/login" className="rounded-md border border-accent bg-accent px-3 py-1.5 text-white">
              {t("errorPage.login")}
            </Link>
          )}
        </div>
      </div>
    </main>
  );
}
