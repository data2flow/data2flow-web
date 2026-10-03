import { describe, expect, it } from "vitest";
import { FALLBACK_LANGUAGES, createI18n, languageFromAcceptHeader, normalizeLanguage, resources } from "./index";

function flatten(obj: Record<string, unknown>, prefix = ""): Record<string, string> {
  return Object.entries(obj).reduce<Record<string, string>>((acc, [k, v]) => {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object") Object.assign(acc, flatten(v as Record<string, unknown>, key));
    else acc[key] = String(v);
    return acc;
  }, {});
}

const vars = (s: string) => [...s.matchAll(/{{\s*(\w+)\s*}}/g)].map((m) => m[1]).sort();

describe("TC-DSH-075 ko·en·ja·zh 리소스 키 일치(DSH-07.03, NFR-08.01)", () => {
  const ko = flatten(resources.ko.translation);
  for (const lang of ["en", "ja", "zh"] as const) {
    it(`${lang} 키 집합과 보간 변수가 한국어와 같다`, () => {
      const other = flatten(resources[lang].translation);
      expect(Object.keys(other).sort()).toEqual(Object.keys(ko).sort());
      for (const key of Object.keys(ko)) {
        expect(vars(other[key]), `${lang} ${key}`).toEqual(vars(ko[key]));
        expect(other[key].trim(), `${lang} ${key}`).not.toBe("");
      }
    });
  }
});

describe("언어 결정(ADR-037)", () => {
  it("zh-* 는 zh, 지원하지 않는 언어는 ko", () => {
    expect(normalizeLanguage("zh-TW")).toBe("zh");
    expect(normalizeLanguage("ja_JP")).toBe("ja");
    expect(normalizeLanguage("fr")).toBe("ko");
    expect(normalizeLanguage(undefined)).toBe("ko");
  });

  it("Accept-Language에서 첫 번째 지원 언어를 고른다", () => {
    expect(languageFromAcceptHeader("fr-FR,fr;q=0.9,ja;q=0.8")).toBe("ja");
    expect(languageFromAcceptHeader("en-US,en;q=0.9")).toBe("en");
    expect(languageFromAcceptHeader("")).toBe("ko");
  });

  it("번역이 없으면 ja·zh → en → ko 로 폴백", () => {
    expect(FALLBACK_LANGUAGES.ja).toEqual(["en", "ko"]);
    const i18n = createI18n("ja");
    expect(i18n.t("app.preparing")).toBe("サービスを準備しています。");
    expect(i18n.t("missing.key", { defaultValue: "x" })).toBe("x");
  });
});
