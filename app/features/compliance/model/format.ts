/** 기준값 표기: 이하·이상(경계 포함)은 ≤·≥, 미만·초과(경계 미포함)는 <·> (TC-CMP-010 연산자까지 구분) */
export function limitText(lower: number | null | undefined, upper: number | null | undefined, inclusive: boolean): string {
  const has = (v: number | null | undefined): v is number => v !== null && v !== undefined;
  if (has(lower) && has(upper)) return inclusive ? `${lower} ~ ${upper}` : `${lower} < · < ${upper}`;
  if (has(upper)) return `${inclusive ? "≤" : "<"} ${upper}`;
  if (has(lower)) return `${inclusive ? "≥" : ">"} ${lower}`;
  return "";
}
