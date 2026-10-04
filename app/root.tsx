import { useMemo } from "react";
import { I18nextProvider, useTranslation } from "react-i18next";
import { Links, Meta, Outlet, Scripts, ScrollRestoration, isRouteErrorResponse, useLoaderData, useLocation, useRouteLoaderData } from "react-router";
import type { Route } from "./+types/root";
import "./app.css";
import { bff, bffMiddleware } from "./bff/middleware.server";
import { getMe } from "./bff/user.server";
import { ErrorView } from "./components/error-view";
import { SUPPORTED_LANGUAGES, createI18n, languageFromPath, localizedPath, normalizeLanguage, stripLanguagePrefix, type Language } from "./i18n";
import type { Me } from "./lib/api-types";
import { resolveTimezone } from "./lib/format";
import { themeAttribute, themeFromCookie, type Theme } from "./lib/theme";
import { useNonce } from "./lib/nonce";
import { isLocalizedPublicPath, isPublicPath } from "./lib/public-paths";

/** 세션·CSRF·보안 헤더(IAM-07.04) */
export const middleware: Route.MiddlewareFunction[] = [bffMiddleware];

export interface RootData {
  lang: Language;
  csrfToken: string;
  authenticated: boolean;
  me: Me | null;
  /** /accounts/me 실패 코드(예: MFA_SETUP_REQUIRED) */
  meError?: string;
  timezone: string;
  publicOrigin: string;
  /** 화면 테마(DSH-07.02). 쿠키 값, 없으면 시스템 설정 */
  theme: Theme;
}

/** 언어: 공개 페이지 주소 접두사 → 계정 설정 → 브라우저 언어 → 한국어(ADR-037) */
export async function loader({ request, context }: Route.LoaderArgs): Promise<RootData> {
  const ctx = bff(context);
  const url = new URL(request.url);
  let me: Me | null = null;
  let meError: string | undefined;
  if (ctx.session.authenticated) {
    try {
      const result = await getMe(ctx, request);
      if (result.ok) me = result.data;
      else meError = result.code;
    } catch (error) {
      // 세션이 끝났다: 공개 페이지는 그대로 보여 주고, 나머지는 로그인 화면으로
      if (!(error instanceof Response) || !isPublicPath(url.pathname)) throw error;
    }
  }
  const prefixed = languageFromPath(url.pathname);
  const lang = prefixed ?? (me?.locale ? normalizeLanguage(me.locale) : (ctx.meta.lang as Language));
  return {
    lang,
    csrfToken: ctx.session.csrfToken(),
    authenticated: ctx.session.authenticated,
    me,
    meError,
    timezone: resolveTimezone(me?.timezone),
    publicOrigin: ctx.runtime.config.publicOrigin,
    theme: themeFromCookie(request.headers.get("Cookie")),
  };
}

export const links: Route.LinksFunction = () => [{ rel: "icon", href: "/favicon.ico" }];

/** 공개 페이지는 언어별 주소의 hreflang·canonical을 넣는다(ADR-037) */
function AlternateLinks({ origin, lang }: { origin: string; lang: Language }) {
  const location = useLocation();
  if (!isLocalizedPublicPath(location.pathname)) return null;
  const base = stripLanguagePrefix(location.pathname);
  return (
    <>
      <link rel="canonical" href={`${origin}${localizedPath(base, lang)}`} />
      {SUPPORTED_LANGUAGES.map((code) => (
        <link key={code} rel="alternate" hrefLang={code === "zh" ? "zh-Hans" : code} href={`${origin}${localizedPath(base, code)}`} />
      ))}
      <link rel="alternate" hrefLang="x-default" href={`${origin}${base}`} />
    </>
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  const data = useRouteLoaderData("root") as RootData | undefined;
  const lang = data?.lang ?? "ko";
  const nonce = useNonce();
  const i18n = useMemo(() => createI18n(lang), [lang]);
  return (
    <html lang={lang === "zh" ? "zh-Hans" : lang} data-theme={themeAttribute(data?.theme ?? "SYSTEM")}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        {data?.csrfToken && <meta name="csrf-token" content={data.csrfToken} />}
        <Meta />
        <Links />
        {data && <AlternateLinks origin={data.publicOrigin} lang={lang} />}
      </head>
      <body className="min-h-screen bg-bg text-text antialiased">
        <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
        <ScrollRestoration nonce={nonce} />
        <Scripts nonce={nonce} />
      </body>
    </html>
  );
}

export default function App() {
  useLoaderData<typeof loader>();
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const { t } = useTranslation();
  if (isRouteErrorResponse(error)) {
    const code = (error.data as { code?: string } | undefined)?.code;
    return <ErrorView status={error.status} code={code} />;
  }
  const details = import.meta.env.DEV && error instanceof Error ? error.message : undefined;
  return <ErrorView status={500} code="INTERNAL_ERROR" details={details ?? t("errors.INTERNAL_ERROR")} />;
}
