/**
 * 상단 흰 내비게이션 바: 로고, 메뉴(현재 메뉴 파란 밑줄), 사용자 메뉴(내 정보, 로그아웃).
 * 메뉴는 권한으로 거르고(보조 수단, IAM-04.05), 임시 비밀번호 상태에서는 메뉴를 보이지 않는다(AT-IAM-01.1).
 * `headerActions`(⏻ 자동화 비상 정지 등, UI-ACT-07)는 사용자 메뉴 앞에, `bands`(비상 정지·유지보수 띠)는 헤더 바로 아래 전체 폭으로 둔다(00-navigation.md §1.3).
 */
import type { CSSProperties, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Form, Link, NavLink, useLocation } from "react-router";
import type { Me } from "~/lib/api-types";
import { isMenuActive, visibleMenu } from "~/lib/permissions";
import { nextTheme, type Theme } from "~/lib/theme";
import { Logo } from "./logo";
import { CsrfField, cx } from "./ui";

/** 조직 브랜딩(DSH-13.01): 헤더 로고(밝은·어두운 배경용)와 주 색상 */
export interface HeaderBrand {
  logoLightUrl?: string | null;
  logoDarkUrl?: string | null;
  primaryColor?: string | null;
  appName?: string | null;
}

/** API-DSH-25 응답에서 헤더에 쓰는 값만. 자산 주소는 BFF 공개 경로(`/branding/assets/{id}`)로 */
export function headerBrand(b: HeaderBrand): HeaderBrand {
  const local = (url?: string | null) => (url && url.startsWith("/api/v1/core/public/branding/assets/") ? `/branding/assets/${url.split("/").pop()}` : null);
  const color = b.primaryColor && /^#[0-9a-fA-F]{6}$/.test(b.primaryColor) ? b.primaryColor : null;
  return { logoLightUrl: local(b.logoLightUrl), logoDarkUrl: local(b.logoDarkUrl), primaryColor: color, appName: b.appName ?? null };
}

export function AppShell({ me, children, theme = "SYSTEM", headerActions, bands, brand }: { me: Me | null; children: ReactNode; theme?: Theme; headerActions?: ReactNode; bands?: ReactNode; brand?: HeaderBrand | null }) {
  const { t } = useTranslation();
  const locked = !me || Boolean(me.mustChangePassword);
  const menu = visibleMenu(me?.permissions, locked);
  const { pathname, search } = useLocation();
  return (
    <div className="min-h-screen" style={brand?.primaryColor ? ({ "--d2f-accent": brand.primaryColor } as CSSProperties) : undefined}>
      <header className="border-b border-line bg-panel">
        <div className="mx-auto flex max-w-7xl items-center gap-6 px-4">
          {brand?.logoLightUrl || brand?.logoDarkUrl ? (
            <Link to="/" aria-label={brand.appName || "data2flow"} className="flex items-center">
              <img src={(theme === "DARK" ? brand.logoDarkUrl : brand.logoLightUrl) ?? brand.logoLightUrl ?? brand.logoDarkUrl ?? ""} alt="" className="h-6 max-w-40 object-contain" />
            </Link>
          ) : (
            <Logo />
          )}
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
            {!locked && headerActions}
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
      {!locked && bands}
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </div>
  );
}
