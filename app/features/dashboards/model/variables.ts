/**
 * 대시보드 변수(DSH-04.05, TC-DSH-042·043). 공간·기기·측정 항목 선택기를 두고 위젯 대상이 `${이름}`으로 참조한다.
 * - 이름: 영문 소문자로 시작하는 소문자·숫자 1~20자, 대시보드 안 고유(UI-DSH-04 입력 검증; core 규칙의 부분집합), 최대 10개
 * - 값: 선택 값 → 정의의 기본값 순서. 치환은 한 번만 한다(값 안의 `${…}`는 다시 풀지 않으므로 순환 참조가 없다)
 * - 선택지: 사용자가 볼 수 있는 공간·기기만 서버가 준다(권한 밖 공간은 목록에 없음)
 */
import type { DashboardVariable, Widget, WidgetTarget } from "./types";

export const MAX_VARIABLES = 10;
export const VARIABLE_TYPES = ["SPACE", "DEVICE", "METRIC"] as const;
const NAME = /^[a-z][a-z0-9]{0,19}$/;
const REF = /^\$\{([A-Za-z][A-Za-z0-9_]{0,30})\}$/;

export interface VariableError {
  index: number;
  field: "name" | "type" | "count";
  code: "INVALID" | "DUPLICATE" | "TOO_MANY";
}

export function validateVariables(variables: readonly DashboardVariable[]): VariableError[] {
  const errors: VariableError[] = [];
  if (variables.length > MAX_VARIABLES) errors.push({ index: MAX_VARIABLES, field: "count", code: "TOO_MANY" });
  const names = new Set<string>();
  variables.forEach((v, index) => {
    if (!NAME.test(v.name)) errors.push({ index, field: "name", code: "INVALID" });
    else if (names.has(v.name)) errors.push({ index, field: "name", code: "DUPLICATE" });
    names.add(v.name);
    if (!(VARIABLE_TYPES as readonly string[]).includes(v.type)) errors.push({ index, field: "type", code: "INVALID" });
  });
  return errors;
}

/** `${space}` → "space". 참조가 아니면 null */
export function variableRef(value: string | null | undefined): string | null {
  return REF.exec(value ?? "")?.[1] ?? null;
}

export const refOf = (name: string) => `\${${name}}`;

/** 화면에서 쓰는 값: 선택 → 기본값. 값이 없는 변수는 빠진다 */
export function resolveValues(variables: readonly DashboardVariable[], selected: Readonly<Record<string, string | null | undefined>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const v of variables) {
    const value = selected[v.name] ?? v.default ?? null;
    if (value !== null && value !== undefined && value !== "") out[v.name] = String(value);
  }
  return out;
}

function substituteOne(value: string | null | undefined, values: Record<string, string>): string | null | undefined {
  const name = variableRef(value);
  if (!name) return value;
  return values[name] ?? value;
}

/** 대상의 참조를 값으로 바꾼다(미리 보기·표시용. 저장은 참조 그대로) */
export function substituteTarget(target: WidgetTarget, values: Record<string, string>): WidgetTarget {
  return {
    ...target,
    deviceId: substituteOne(target.deviceId, values),
    spaceId: substituteOne(target.spaceId, values),
    metricKey: substituteOne(target.metricKey, values),
  };
}

/** 위젯이 참조하는 변수 이름 */
export function variablesUsedBy(widget: Widget): Set<string> {
  const used = new Set<string>();
  for (const t of widget.targets ?? []) {
    for (const raw of [t.deviceId, t.spaceId, t.metricKey]) {
      const name = variableRef(raw);
      if (name) used.add(name);
    }
  }
  return used;
}

/** 이 위젯이 바뀐 변수 중 하나라도 쓰는지(쓰지 않으면 다시 요청하지 않는다, TC-DSH-043) */
export function dependsOn(widget: Widget, changed: Iterable<string>): boolean {
  const used = variablesUsedBy(widget);
  for (const name of changed) if (used.has(name)) return true;
  return false;
}

/** 값이 달라진 변수 이름 */
export function changedVariables(before: Record<string, string>, after: Record<string, string>): string[] {
  const names = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...names].filter((n) => before[n] !== after[n]);
}

/** 주소 쿼리 `var-space=31` ↔ 값 */
export function valuesFromSearch(search: URLSearchParams): Record<string, string> {
  const out: Record<string, string> = {};
  search.forEach((value, key) => {
    if (key.startsWith("var-") && value) out[key.slice(4)] = value;
  });
  return out;
}

export interface VariableOption {
  value: string;
  label: string;
}
