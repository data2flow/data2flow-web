import { I18nextProvider } from "react-i18next";
import { Links, Meta, Outlet, Scripts, ScrollRestoration, isRouteErrorResponse, useLoaderData } from "react-router";
import type { Route } from "./+types/root";
import "./app.css";
import { createI18n, languageFromAcceptHeader } from "./i18n";

/** 언어: 계정 설정 → 브라우저 언어 → 한국어(ADR-037). M0에서는 브라우저 언어만 본다 */
export function loader({ request }: Route.LoaderArgs) {
  return { lang: languageFromAcceptHeader(request.headers.get("Accept-Language")) };
}

export const links: Route.LinksFunction = () => [];

export function Layout({ children }: { children: React.ReactNode }) {
  const data = useLoaderData<typeof loader>();
  const lang = data?.lang ?? "ko";
  return (
    <html lang={lang === "zh" ? "zh-Hans" : lang}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        <I18nextProvider i18n={createI18n(lang)}>{children}</I18nextProvider>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = "Error";
  let details = "";
  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "404" : "Error";
    details = error.statusText;
  } else if (import.meta.env.DEV && error instanceof Error) {
    details = error.message;
  }
  return (
    <main className="p-8">
      <h1>{message}</h1>
      <p>{details}</p>
    </main>
  );
}
