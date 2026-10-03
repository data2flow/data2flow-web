/**
 * 로그인 전 공개 페이지 틀: 로고, 언어 전환(주소 접두사만 바꿈, UI-IAM-01 머리), 본문 카드.
 */
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router";
import { SUPPORTED_LANGUAGES, localizedPath, normalizeLanguage, stripLanguagePrefix } from "~/i18n";
import { Logo } from "./logo";

export const LANGUAGE_LABELS: Record<string, string> = { ko: "한국어", en: "English", ja: "日本語", zh: "简体中文" };

export function LanguageSwitcher() {
  const location = useLocation();
  const { i18n, t } = useTranslation();
  const current = normalizeLanguage(i18n.language);
  const base = stripLanguagePrefix(location.pathname);
  return (
    <nav aria-label={t("common.language")} className="flex gap-2 text-[12.5px]">
      {SUPPORTED_LANGUAGES.map((code) => (
        <Link
          key={code}
          to={`${localizedPath(base, code)}${location.search}`}
          lang={code}
          aria-current={code === current ? "true" : undefined}
          className={code === current ? "font-semibold text-accent" : "text-muted hover:text-text"}
        >
          {LANGUAGE_LABELS[code]}
        </Link>
      ))}
    </nav>
  );
}

/** 현재 언어의 공개 페이지 주소 */
export function usePublicPath() {
  const { i18n } = useTranslation();
  const lang = normalizeLanguage(i18n.language);
  const location = useLocation();
  const prefixed = location.pathname !== stripLanguagePrefix(location.pathname);
  return (path: string) => (prefixed ? localizedPath(path, lang) : path);
}

export function PublicShell({ title, children, aside }: { title: ReactNode; children: ReactNode; aside?: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between border-b border-line bg-panel px-6 py-3">
        <Logo />
        <LanguageSwitcher />
      </header>
      <main className="flex flex-1 items-start justify-center gap-10 px-4 py-10 md:items-center">
        {aside && <div className="hidden max-w-sm md:block">{aside}</div>}
        <section className="w-full max-w-md rounded-lg border border-line bg-panel p-6">
          <h1 className="mb-4 text-[20px] font-bold">{title}</h1>
          {children}
        </section>
      </main>
      <footer className="px-6 py-4 text-center text-[12px] text-muted">
        <Link to={usePublicPathFor("/privacy")} className="hover:underline">
          {t("privacy.link")}
        </Link>
      </footer>
    </div>
  );
}

function usePublicPathFor(path: string) {
  return usePublicPath()(path);
}
