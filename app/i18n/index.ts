import i18next, { type i18n } from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import ja from "./locales/ja.json";
import ko from "./locales/ko.json";
import zh from "./locales/zh.json";

/** 화면 언어 4개(ADR-037). 한국어가 원문이다. */
export const SUPPORTED_LANGUAGES = ["ko", "en", "ja", "zh"] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];
export const DEFAULT_LANGUAGE: Language = "ko";

export const resources = {
  ko: { translation: ko },
  en: { translation: en },
  ja: { translation: ja },
  zh: { translation: zh },
} as const;

/** 번역이 없으면 ja·zh는 영어, en은 한국어로 보여 준다 */
export const FALLBACK_LANGUAGES = {
  ja: ["en", "ko"],
  zh: ["en", "ko"],
  en: ["ko"],
  default: ["ko"],
};

/** 브라우저·계정 언어 값을 지원 언어로 바꾼다. zh-CN·zh-TW 등은 모두 zh */
export function normalizeLanguage(value: string | null | undefined): Language {
  const base = (value ?? "").toLowerCase().split(/[-_]/)[0];
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(base) ? (base as Language) : DEFAULT_LANGUAGE;
}

/** Accept-Language 헤더에서 첫 번째 지원 언어를 고른다 */
export function languageFromAcceptHeader(header: string | null | undefined): Language {
  for (const part of (header ?? "").split(",")) {
    const tag = part.split(";")[0].trim();
    if (!tag) continue;
    const base = tag.toLowerCase().split(/[-_]/)[0];
    if ((SUPPORTED_LANGUAGES as readonly string[]).includes(base)) return base as Language;
  }
  return DEFAULT_LANGUAGE;
}

export function createI18n(language: Language): i18n {
  const instance = i18next.createInstance();
  void instance.use(initReactI18next).init({
    resources,
    lng: language,
    fallbackLng: FALLBACK_LANGUAGES,
    interpolation: { escapeValue: false },
    initAsync: false,
  });
  return instance;
}
