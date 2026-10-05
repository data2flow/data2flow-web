/**
 * 로그인 뒤 화면 틀(목업 H.shell, DSH-07.02): 56px 흰 상단 바(로고, 아이콘 메뉴 — 현재 메뉴 파란 밑줄, 사용자),
 * 208px 왼쪽 막대(현재 메뉴의 하위 화면, 현재 항목은 옅은 파랑), 본문(좌우 24px·위아래 18px).
 * 메뉴는 권한으로 거르고(보조 수단, IAM-04.05), 임시 비밀번호 상태에서는 메뉴를 보이지 않는다(AT-IAM-01.1).
 * 관리 메뉴는 상단에서 "관리" 하나로 접고 왼쪽 막대에서 항목을 고른다.
 * `headerActions`(⏻ 자동화 비상 정지 등, UI-ACT-07)는 사용자 앞에, `bands`(비상 정지·유지보수 띠)는 헤더 바로 아래 전체 폭으로 둔다(00-navigation.md §1.3).
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Form, Link, useLocation } from "react-router";
import type { Me } from "~/lib/api-types";
import { isMenuActive, type MenuKey } from "~/lib/permissions";
import { inAdmin, railFor, topMenu } from "~/lib/rail";
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

/** 메뉴 아이콘(목업 lib.js MENU, 24px 격자 선 아이콘). 목업에 없는 제어·대시보드는 같은 선 굵기로 그렸다 */
const ICONS: Partial<Record<MenuKey | "admin", string>> = {
  home: "M5 12l-2 0l9-9l9 9l-2 0M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7M9 21v-6h6v6",
  spaces: "M3 21h18M5 21V7l8-4v18M19 21V11l-6-4M9 9v.01M9 12v.01M9 15v.01",
  devices: "M5 4h14a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM8 20h8M12 16v4",
  explore: "M3 12h4l3 8l4-16l3 8h4",
  ingest: "M4 6a8 3 0 1 0 16 0a8 3 0 1 0-16 0M4 6v6a8 3 0 0 0 16 0V6M4 12v6a8 3 0 0 0 16 0v-6",
  alarms: "M10 5a2 2 0 1 1 4 0a7 7 0 0 1 4 6v3a4 4 0 0 0 2 3H4a4 4 0 0 0 2-3v-3a7 7 0 0 1 4-6M9 17v1a3 3 0 0 0 6 0v-1",
  automation: "M4 6a2 2 0 1 0 4 0a2 2 0 1 0-4 0M16 18a2 2 0 1 0 4 0a2 2 0 1 0-4 0M8 6h5a3 3 0 0 1 3 3v7",
  control: "M6 4v4M6 12v8M12 4v10M12 18v2M18 4v1M18 9v11M4 8h4v4H4zM10 14h4v4h-4zM16 5h4v4h-4z",
  sim: "M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5",
  dashboards: "M4 4h6v8H4zM14 4h6v5h-6zM4 16h6v4H4zM14 13h6v7h-6z",
  admin:
    "M10.3 4.3a1.7 1.7 0 0 1 3.4 0a1.7 1.7 0 0 0 2.6 1.1a1.7 1.7 0 0 1 2.3 2.3a1.7 1.7 0 0 0 1.1 2.6a1.7 1.7 0 0 1 0 3.4a1.7 1.7 0 0 0-1.1 2.6a1.7 1.7 0 0 1-2.3 2.3a1.7 1.7 0 0 0-2.6 1.1a1.7 1.7 0 0 1-3.4 0a1.7 1.7 0 0 0-2.6-1.1a1.7 1.7 0 0 1-2.3-2.3a1.7 1.7 0 0 0-1.1-2.6a1.7 1.7 0 0 1 0-3.4a1.7 1.7 0 0 0 1.1-2.6a1.7 1.7 0 0 1 2.3-2.3a1.7 1.7 0 0 0 2.6-1.1M9 12a3 3 0 1 0 6 0a3 3 0 0 0-6 0",
};

function MenuIcon({ name }: { name: MenuKey | "admin" }) {
  const d = ICONS[name];
  if (!d) return null;
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="flex-none opacity-75 group-aria-[current=page]:opacity-100">
      <path d={d} />
    </svg>
  );
}

/** 테마 아이콘: 시스템(반달 원)·라이트(해)·다크(달) */
const THEME_ICON: Record<Theme, string> = {
  SYSTEM: "M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18zM12 3v18",
  LIGHT: "M12 8a4 4 0 1 0 0 8a4 4 0 0 0 0-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
  DARK: "M12 3a6 6 0 0 0 9 9a9 9 0 1 1-9-9z",
};

function Glyph({ d }: { d: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

const iconButton = "flex h-8 w-8 items-center justify-center rounded-md text-muted hover:bg-panel2 hover:text-text";

const topLink = (active: boolean) =>
  cx(
    "group flex items-center gap-1.5 whitespace-nowrap border-b-2 px-[9px] text-[13px]",
    active ? "border-accent font-medium text-accent" : "border-transparent text-muted hover:text-text",
  );

/** 상단 메뉴 한 칸 */
interface TopEntry {
  key: MenuKey | "admin";
  path: string;
  label: string;
  active: boolean;
}

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * 넓이에 맞춰 한 줄에 들어가는 메뉴 수를 잰다. 글자를 줄바꿈하지 않고(nowrap), 남는 항목은 [더보기]로 넘긴다.
 * 서버 렌더링과 잴 수 없는 환경(넓이 0)에서는 모두 보인다
 */
function useFit(count: number) {
  const nav = useRef<HTMLDivElement>(null);
  const measure = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(count);
  const recompute = useCallback(() => {
    const box = nav.current;
    const ruler = measure.current;
    if (!box || !ruler) return;
    const widths = [...ruler.children].map((c) => (c as HTMLElement).offsetWidth);
    const more = widths.pop() ?? 0;
    const available = box.clientWidth;
    const total = widths.reduce((a, b) => a + b + 2, 0);
    if (total <= available) return setFit(count);
    let used = more;
    let n = 0;
    while (n < widths.length && used + widths[n] + 2 <= available) used += widths[n++] + 2;
    setFit(Math.max(1, n));
  }, [count]);
  useIsomorphicLayoutEffect(() => {
    recompute();
    if (typeof ResizeObserver === "undefined" || !nav.current) return;
    const observer = new ResizeObserver(recompute);
    observer.observe(nav.current);
    return () => observer.disconnect();
  }, [recompute]);
  return { nav, measure, fit };
}

function MoreMenu({ entries }: { entries: TopEntry[] }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDetailsElement>(null);
  const { pathname } = useLocation();
  useEffect(() => {
    if (ref.current) ref.current.open = false;
  }, [pathname]);
  const active = entries.some((e) => e.active);
  return (
    <details ref={ref} className="relative flex">
      <summary aria-current={active ? "page" : undefined} className={cx(topLink(active), "cursor-pointer list-none [&::-webkit-details-marker]:hidden")}>
        <Glyph d="M5 12h.01M12 12h.01M19 12h.01" />
        {t("nav.more")}
      </summary>
      <div className="absolute top-full right-0 z-30 mt-1 flex min-w-48 flex-col rounded-lg border border-line bg-panel p-1.5 shadow-[0_8px_24px_-8px_rgba(0,0,0,0.25)]">
        {entries.map((e) => (
          <Link key={e.key} to={e.path} aria-current={e.active ? "page" : undefined} className={cx("flex h-8 items-center gap-2 whitespace-nowrap rounded-md px-2 text-[13px]", e.active ? "bg-accent-soft font-semibold text-accent" : "text-muted hover:bg-panel2 hover:text-text")}>
            <MenuIcon name={e.key} />
            {e.label}
          </Link>
        ))}
      </div>
    </details>
  );
}

/** 좁은 화면(1024px 미만): 햄버거 단추로 여는 왼쪽 서랍 메뉴(00-navigation.md §1.3 반응형) */
function MenuDrawer({ entries }: { entries: TopEntry[] }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => setOpen(false), [pathname]);
  return (
    <div className="flex items-center lg:hidden">
      <button type="button" className={iconButton} aria-expanded={open} aria-controls="d2f-menu-drawer" onClick={() => setOpen(true)}>
        <Glyph d="M4 6h16M4 12h16M4 18h16" />
        <span className="sr-only">{t("nav.openMenu")}</span>
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex bg-[rgba(29,39,59,0.32)] dark:bg-black/55" role="presentation" onClick={() => setOpen(false)} onKeyDown={(e) => e.key === "Escape" && setOpen(false)}>
          <nav id="d2f-menu-drawer" aria-label={t("nav.label")} className="flex w-64 flex-col gap-px overflow-y-auto border-r border-line bg-panel p-3.5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between px-2">
              <Logo />
              <button type="button" className={iconButton} onClick={() => setOpen(false)} autoFocus>
                <Glyph d="M6 6l12 12M18 6L6 18" />
                <span className="sr-only">{t("common.close")}</span>
              </button>
            </div>
            {entries.map((e) => (
              <Link key={e.key} to={e.path} aria-current={e.active ? "page" : undefined} className={cx("flex h-9 items-center gap-2 whitespace-nowrap rounded-md px-2 text-[13px]", e.active ? "bg-accent-soft font-semibold text-accent" : "text-muted hover:bg-panel2 hover:text-text")}>
                <MenuIcon name={e.key} />
                {e.label}
              </Link>
            ))}
          </nav>
        </div>
      )}
    </div>
  );
}

export function AppShell({ me, children, theme = "SYSTEM", headerActions, bands, brand }: { me: Me | null; children: ReactNode; theme?: Theme; headerActions?: ReactNode; bands?: ReactNode; brand?: HeaderBrand | null }) {
  const { t } = useTranslation();
  const locked = !me || Boolean(me.mustChangePassword);
  const { main, admin } = topMenu(me?.permissions, locked);
  const { pathname, search } = useLocation();
  const adminActive = inAdmin(admin, pathname);
  const rail = railFor(pathname, me?.permissions, locked);
  const name = me ? me.name || me.loginId : "";
  const role = me?.role ? t(`roles.${me.role}`, { defaultValue: me.role }) : "";
  const entries: TopEntry[] = [
    ...main.map((item) => ({ key: item.key, path: item.path, label: t(`nav.${item.key}`), active: isMenuActive(item, pathname) })),
    ...(admin.length > 0 ? [{ key: "admin" as const, path: admin[0].path, label: t("nav.admin"), active: adminActive }] : []),
  ];
  const { nav, measure, fit } = useFit(entries.length);
  const shown = entries.slice(0, fit);
  const rest = entries.slice(fit);
  return (
    <div className="flex min-h-screen flex-col" style={brand?.primaryColor ? ({ "--d2f-accent": brand.primaryColor } as CSSProperties) : undefined}>
      <header className="relative z-20 flex h-14 flex-none items-stretch gap-[22px] border-b border-line bg-panel px-6">
        {entries.length > 0 && <MenuDrawer entries={entries} />}
        <div className="flex items-center">
          {brand?.logoLightUrl || brand?.logoDarkUrl ? (
            <Link to="/" aria-label={brand.appName || "data2flow"} className="flex items-center">
              <img src={(theme === "DARK" ? brand.logoDarkUrl : brand.logoLightUrl) ?? brand.logoLightUrl ?? brand.logoDarkUrl ?? ""} alt="" className="h-7 max-w-40 object-contain" />
            </Link>
          ) : (
            <Logo />
          )}
        </div>
        <div ref={nav} className="relative flex min-w-0 flex-1 items-stretch">
          <nav aria-label={t("nav.label")} className="hidden items-stretch gap-0.5 lg:flex">
            {shown.map((e) => (
              <Link key={e.key} to={e.path} aria-current={e.active ? "page" : undefined} className={topLink(e.active)}>
                <MenuIcon name={e.key} />
                {e.label}
              </Link>
            ))}
            {rest.length > 0 && <MoreMenu entries={rest} />}
          </nav>
          {/* 넓이 재기용(보이지 않음): 메뉴 칸들과 [더보기] */}
          <div ref={measure} aria-hidden className="pointer-events-none invisible absolute top-0 left-0 flex h-0 w-max overflow-hidden [&>*]:flex-none">
            {entries.map((e) => (
              <span key={e.key} className={topLink(e.active)}>
                <MenuIcon name={e.key} />
                {e.label}
              </span>
            ))}
            <span className={topLink(false)}>
              <Glyph d="M5 12h.01M12 12h.01M19 12h.01" />
              {t("nav.more")}
            </span>
          </div>
        </div>
        <div className="flex flex-none items-center gap-2 text-[12.5px]">
          {!locked && headerActions}
          <Form method="post" action="/theme">
            <CsrfField />
            <input type="hidden" name="theme" value={nextTheme(theme)} />
            <input type="hidden" name="next" value={`${pathname}${search}`} />
            <button type="submit" className={iconButton} title={t("theme.switchTo", { theme: t(`theme.${nextTheme(theme)}`) })}>
              <Glyph d={THEME_ICON[theme]} />
              <span className="sr-only">{t(`theme.${theme}`)}</span>
            </button>
          </Form>
          {me && (
            <div className="flex items-center gap-2.5 leading-tight whitespace-nowrap">
              <span aria-hidden className="flex h-8 w-8 items-center justify-center rounded-md bg-accent-soft text-[12px] font-semibold text-accent">
                {name.slice(0, 1).toUpperCase()}
              </span>
              <span className="flex flex-col">
                <Link to="/me" className="text-text hover:text-accent">
                  {name}
                </Link>
                {role && <span className="text-[11px] text-muted">{role}</span>}
              </span>
            </div>
          )}
          <Form method="post" action="/logout">
            <CsrfField />
            <button type="submit" className={iconButton} title={t("nav.logout")}>
              <Glyph d="M14 8V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2v-2M9 12h12l-3-3M18 15l3-3" />
              <span className="sr-only">{t("nav.logout")}</span>
            </button>
          </Form>
        </div>
      </header>
      {!locked && bands}
      <div className="flex flex-1 flex-col lg:flex-row">
        {rail && (
          <nav
            aria-label={t(rail.title)}
            className="flex flex-none gap-px overflow-x-auto border-b border-line bg-panel px-3.5 py-2 text-[13px] lg:w-52 lg:flex-col lg:overflow-visible lg:border-r lg:border-b-0 lg:py-4"
          >
            <div className="mb-2 hidden border-b border-line2 px-2 pt-0.5 pb-3 lg:block">
              <span className="cap">{t("nav.section")}</span>
              <b className="my-0.5 block text-[14px] font-semibold">{t(rail.title)}</b>
            </div>
            {rail.items.map((item) => {
              const active = item.path === rail.current;
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  aria-current={active ? "page" : undefined}
                  className={cx("flex h-8 flex-none items-center gap-2 whitespace-nowrap rounded-md px-2", active ? "bg-accent-soft font-semibold text-accent" : "text-muted hover:bg-panel2 hover:text-text")}
                >
                  {t(item.label)}
                </Link>
              );
            })}
          </nav>
        )}
        <main className="min-w-0 flex-1 px-4 py-[18px] sm:px-6">{children}</main>
      </div>
    </div>
  );
}
