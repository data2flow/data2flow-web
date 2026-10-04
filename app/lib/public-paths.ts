import { stripLanguagePrefix } from "~/i18n";

/** 로그인 없이 여는 공개 페이지(ADR-037: 언어 접두사 `/en` `/ja` `/zh`) */
// 공유 링크(UI-DSH-07)와 브랜딩 자산은 로그인 없이 연다(DSH-06.03, DSH-13.01)
const PUBLIC_PREFIXES = ["/login", "/password-reset", "/invitations", "/signup", "/privacy", "/error", "/share", "/branding"];

export function isPublicPath(pathname: string): boolean {
  const path = stripLanguagePrefix(pathname);
  return PUBLIC_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/** 언어별 주소(hreflang·canonical)를 두는 공개 페이지. 공유 링크는 토큰 주소라 넣지 않는다 */
export function isLocalizedPublicPath(pathname: string): boolean {
  const path = stripLanguagePrefix(pathname);
  return isPublicPath(pathname) && !path.startsWith("/share") && !path.startsWith("/branding");
}
