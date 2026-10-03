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

type Tree = Record<string, unknown>;

/** 기능별 문구 파일(`features/{기능}/{언어}.json`)을 공통 파일에 깊게 합친다. `errors`처럼 같은 키는 안쪽까지 합친다 */
export function deepMerge(base: Tree, extra: Tree): Tree {
  const out: Tree = { ...base };
  for (const [key, value] of Object.entries(extra)) {
    const current = out[key];
    out[key] =
      value && typeof value === "object" && current && typeof current === "object" ? deepMerge(current as Tree, value as Tree) : value;
  }
  return out;
}

const featureFiles = import.meta.glob<{ default: Tree }>("./features/*/*.json", { eager: true });

function withFeatures(language: string, base: Tree): Tree {
  return Object.entries(featureFiles)
    .filter(([path]) => path.endsWith(`/${language}.json`))
    .sort(([a], [b]) => a.localeCompare(b))
    .reduce((acc, [, mod]) => deepMerge(acc, mod.default), base);
}

export const resources = {
  ko: { translation: withFeatures("ko", ko) },
  en: { translation: withFeatures("en", en) },
  ja: { translation: withFeatures("ja", ja) },
  zh: { translation: withFeatures("zh", zh) },
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

/** 로그인 전 공개 페이지의 언어 접두사(ADR-037). 한국어는 접두사가 없다 */
export const PREFIXED_LANGUAGES = ["en", "ja", "zh"] as const;

export function languageFromPath(pathname: string): Language | undefined {
  const first = pathname.split("/")[1];
  return (PREFIXED_LANGUAGES as readonly string[]).includes(first) ? (first as Language) : undefined;
}

/** 공개 페이지 주소에 언어 접두사를 붙인다. `/login` + en → `/en/login` */
export function localizedPath(path: string, lang: Language): string {
  const clean = path.startsWith("/") ? path : `/${path}`;
  if (lang === DEFAULT_LANGUAGE) return clean;
  return clean === "/" ? `/${lang}` : `/${lang}${clean}`;
}

/** 접두사를 떼어 낸 경로. `/en/login` → `/login` */
export function stripLanguagePrefix(pathname: string): string {
  const lang = languageFromPath(pathname);
  if (!lang) return pathname;
  const rest = pathname.slice(lang.length + 1);
  return rest || "/";
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
