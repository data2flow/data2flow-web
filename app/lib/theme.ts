/**
 * 화면 테마(DSH-07.02): SYSTEM(시스템 설정 따르기)·LIGHT·DARK. 고른 값은 쿠키(`data2flow_theme`)에 두어
 * 서버 렌더링 첫 화면부터 맞는 색으로 그리고, 계정 화면 설정(API-DSH-12 `theme`)에도 저장한다.
 */
export const THEMES = ["SYSTEM", "LIGHT", "DARK"] as const;
export type Theme = (typeof THEMES)[number];
export const THEME_COOKIE = "data2flow_theme";

export function normalizeTheme(value: string | null | undefined): Theme {
  const upper = (value ?? "").toUpperCase();
  return (THEMES as readonly string[]).includes(upper) ? (upper as Theme) : "SYSTEM";
}

export function themeFromCookie(header: string | null | undefined): Theme {
  const match = new RegExp(`(?:^|;\\s*)${THEME_COOKIE}=([^;]+)`).exec(header ?? "");
  return normalizeTheme(match?.[1]);
}

/** html[data-theme] 값. SYSTEM이면 넣지 않는다(미디어 쿼리가 정함) */
export function themeAttribute(theme: Theme): "light" | "dark" | undefined {
  return theme === "SYSTEM" ? undefined : theme === "DARK" ? "dark" : "light";
}

/** 다음 테마(사용자 메뉴의 빠른 전환): 시스템 → 라이트 → 다크 → 시스템 */
export function nextTheme(theme: Theme): Theme {
  return THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
}

/** 지금 어두운 테마로 보이는지(차트·편집기 테마 고르기) */
export function isDarkNow(doc: Document | undefined = typeof document === "undefined" ? undefined : document): boolean {
  const attr = doc?.documentElement.dataset.theme;
  if (attr === "dark") return true;
  if (attr === "light") return false;
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}
