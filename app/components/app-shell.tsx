/**
 * 상단 흰 내비게이션 바: 로고, 메뉴(현재 메뉴 파란 밑줄), 사용자 메뉴(내 정보, 로그아웃).
 * 메뉴는 권한으로 거르고(보조 수단, IAM-04.05), 임시 비밀번호 상태에서는 메뉴를 보이지 않는다(AT-IAM-01.1).
 */
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Form, Link, NavLink, useLocation } from "react-router";
import type { Me } from "~/lib/api-types";
import { isMenuActive, visibleMenu } from "~/lib/permissions";
import { nextTheme, type Theme } from "~/lib/theme";
import { Logo } from "./logo";
import { CsrfField, cx } from "./ui";

export function AppShell({ me, children, theme = "SYSTEM" }: { me: Me | null; children: ReactNode; theme?: Theme }) {
  const { t } = useTranslation();
  const locked = !me || Boolean(me.mustChangePassword);
  const menu = visibleMenu(me?.permissions, locked);
  const { pathname, search } = useLocation();
  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-panel">
        <div className="mx-auto flex max-w-7xl items-center gap-6 px-4">
          <Logo />
          <nav aria-label={t("nav.label")} className="flex flex-1 gap-1 overflow-x-auto">
            {menu.map((item) => (
              <Link
                key={item.key}
                to={item.path}
                aria-current={isMenuActive(item, pathname) ? "page" : undefined}
                className={cx(
                  "border-b-2 px-2.5 py-3.5 text-[13px]",
                  isMenuActive(item, pathname) ? "border-accent font-semibold text-accent" : "border-transparent text-muted hover:text-text",
                )}
              >
                {t(`nav.${item.key}`)}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-3 text-[13px]">
            {me && (
              <NavLink to="/me" className="text-text hover:text-accent">
                {me.name || me.loginId}
              </NavLink>
            )}
            <Form method="post" action="/theme">
              <CsrfField />
              <input type="hidden" name="theme" value={nextTheme(theme)} />
              <input type="hidden" name="next" value={`${pathname}${search}`} />
              <button type="submit" className="text-muted hover:text-text" title={t("theme.switchTo", { theme: t(`theme.${nextTheme(theme)}`) })}>
                {t(`theme.${theme}`)}
              </button>
            </Form>
            <Form method="post" action="/logout">
              <CsrfField />
              <button type="submit" className="text-muted hover:text-text">
                {t("nav.logout")}
              </button>
            </Form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </div>
  );
}
