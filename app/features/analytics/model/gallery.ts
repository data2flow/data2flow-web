/**
 * 템플릿 갤러리 화면 모델(UI-ANA-01, ANA-01.01·01.04·01.07). 서버가 준 목록을 카테고리·범용/도메인으로 거르고,
 * 실행 가능성 평가 결과(API-ANA-04)는 숨기지 않고 "데이터 없음" 카드를 끝으로 보낸다(TC-ANA-020).
 */
import type { Template, TemplateCategory, TemplateKind } from "./types";

export interface GalleryFilter {
  category: TemplateCategory | "ALL";
  kinds: TemplateKind[];
}

export function filterTemplates(items: Template[], filter: GalleryFilter): Template[] {
  return items.filter((t) => (filter.category === "ALL" || t.category === filter.category) && (filter.kinds.length === 0 || filter.kinds.includes(t.kind)));
}

/** 실행 가능성으로 정렬: runnable=false는 끝으로(원래 순서 유지) */
export function sortByRunnable(items: Template[]): Template[] {
  return [...items].map((t, i) => ({ t, i })).sort((a, b) => Number(a.t.runnable === false) - Number(b.t.runnable === false) || a.i - b.i).map(({ t }) => t);
}

/** 실행 가능성 평가 결과를 목록에 합친다(키 기준) */
export function mergeRunnable(items: Template[], runnable: Template[] | null): Template[] {
  if (!runnable) return items;
  const byKey = new Map(runnable.map((r) => [r.key, r]));
  return items.map((t) => {
    const r = byKey.get(t.key);
    return r ? { ...t, runnable: r.runnable, missingRoles: r.missingRoles } : { ...t, runnable: false, missingRoles: [] };
  });
}

/** 검색어의 낱말이 들어간 부분을 나눈다(`<mark>` 강조, TC-ANA-033). 대소문자 무시 */
export function highlightParts(text: string, query: string): { text: string; hit: boolean }[] {
  const words = query
    .toLowerCase()
    .split(/[\s,.?!·]+/)
    .filter((w) => w.length > 0)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!text || words.length === 0) return [{ text, hit: false }];
  const pattern = new RegExp(`(${words.join("|")})`, "gi");
  return text
    .split(pattern)
    .filter((part) => part !== "")
    .map((part) => ({ text: part, hit: words.some((w) => new RegExp(`^${w}$`, "i").test(part)) }));
}

/** 카드의 "필요 데이터" 요약: 필수 역할(의미 조건)과 최소 기간 */
export function requirementSummary(t: Template): { roles: string[]; minDays: number | null } {
  const roles = (t.roles ?? []).filter((r) => r.required || (r.min ?? 0) > 0).map((r) => r.semantic || r.name);
  return { roles, minDays: t.requirements?.minPeriodDays ?? null };
}
