import { stripLanguagePrefix } from "~/i18n";

/** 로그인 없이 여는 공개 페이지(ADR-037: 언어 접두사 `/en` `/ja` `/zh`) */
const PUBLIC_PREFIXES = ["/login", "/password-reset", "/invitations", "/signup", "/privacy", "/error"];

export function isPublicPath(pathname: string): boolean {
  const path = stripLanguagePrefix(pathname);
  return PUBLIC_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}
