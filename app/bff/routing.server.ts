import { data, redirect } from "react-router";
import { PREFIXED_LANGUAGES, stripLanguagePrefix } from "~/i18n";

/** 공개 페이지의 언어 접두사 확인(ADR-037). `/ko/…`는 접두사 없는 주소로, 모르는 접두사는 404 */
export function checkLangParam(lang: string | undefined, request: Request) {
  if (!lang) return;
  if (lang === "ko") {
    const url = new URL(request.url);
    throw redirect(`${url.pathname.replace(/^\/ko(?=\/|$)/, "") || "/"}${url.search}`);
  }
  if (!(PREFIXED_LANGUAGES as readonly string[]).includes(lang)) throw data({ code: "RESOURCE_NOT_FOUND" }, { status: 404 });
}

export { stripLanguagePrefix };
