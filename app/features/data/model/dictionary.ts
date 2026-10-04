/**
 * 데이터 사전(UI-TSD-08 "데이터 사전" 탭, TSD-07.04, API-TSD-59). 판 번호는 측정 항목·별칭·공간 구조가 바뀔 때 오른다(BR-TSD-27).
 */
export interface DataDictionary {
  version: number;
  generatedAt: string;
  tables: { name: string; description?: string | null; columns: { name: string; type?: string | null; unit?: string | null; description?: string | null }[] }[];
  metrics: { key: string; displayName?: string | null; unit?: string | null; valueType?: string | null; aggDefault?: string | null; validMin?: number | null; validMax?: number | null; aliases?: string[] | null }[];
  qualityCodes?: { code: number; meaning?: string | null; includedInAggregates?: boolean }[];
  aggregations?: { key: string; description?: string | null }[];
  spaces?: { id: string; parentId?: string | null; type: string; name: string; code?: string | null; path?: string | null }[];
}

/** 기계가 읽는 JSON 파일 이름 */
export function dictionaryFileName(dictionary: Pick<DataDictionary, "version">, ext: "json" | "html") {
  return `data-dictionary-v${dictionary.version}.${ext}`;
}

/** 공간 계층의 깊이(부모를 따라 올라간 수, 들여쓰기용). 고리가 있어도 멈춘다 */
export function spaceDepths(spaces: { id: string; parentId?: string | null }[]): Map<string, number> {
  const parent = new Map(spaces.map((s) => [s.id, s.parentId ?? null]));
  const out = new Map<string, number>();
  for (const s of spaces) {
    let depth = 0;
    let current = parent.get(s.id);
    const seen = new Set([s.id]);
    while (current && parent.has(current) && !seen.has(current)) {
      seen.add(current);
      depth += 1;
      current = parent.get(current);
    }
    out.set(s.id, depth);
  }
  return out;
}
