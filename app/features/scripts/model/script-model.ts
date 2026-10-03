/**
 * 정제 스크립트 화면 모델(UI-SCR-01·02, SCR-03.01·03.02·04.05). 화면 부품은 이 함수의 결과를 그리기만 한다.
 */
export type ScriptKind = "DECODE" | "TRANSFORM";

export interface Problem {
  line: number;
  col: number;
  severity: "ERROR" | "WARNING";
  code?: string;
  message: string;
}

export interface StaticCheck {
  ok: boolean;
  problems: Problem[];
}

export interface TestRunResult {
  ok: boolean;
  output?: unknown;
  diff?: { added?: unknown[]; removed?: unknown[]; changed?: { key: string; from: unknown; to: unknown }[] };
  logs?: { at?: string; message: string }[];
  durationMs?: number;
  outputBytes?: number;
  error?: { code: string; message: string; line?: number; col?: number; stack?: string } | null;
}

/** 코드 크기 한도(SCR-04.03, 64KB) */
export const CODE_LIMIT_BYTES = 64 * 1024;
/** 직접 입력 JSON 한도(UI-SCR-02, 256KB) */
export const INPUT_LIMIT_BYTES = 256 * 1024;
/** 조직당 스크립트 한도(SCR-04.03) */
export const SCRIPT_QUOTA = 300;
/** 편집 중 정적 검사 대기(API-SCR-07, 500ms 디바운스) */
export const CHECK_DEBOUNCE_MS = 500;

export function byteSize(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** 필수 함수(`decode` 또는 `transform`)가 있는지. 없으면 1:1 위치의 오류 하나 */
export function requiredFunctionProblem(kind: ScriptKind, code: string): Problem | null {
  const name = kind === "DECODE" ? "decode" : "transform";
  const pattern = new RegExp(`(function\\s+${name}\\s*\\()|((const|let|var)\\s+${name}\\s*=)`);
  if (pattern.test(code)) return null;
  return { line: 1, col: 1, severity: "ERROR", code: "SCRIPT_FUNCTION_MISSING", message: name };
}

/** 오류가 하나라도 있으면 배포할 수 없다. 경고만 있으면 배포할 수 있다(TC-SCR-040) */
export function canDeploy(problems: readonly Problem[], hasDraft: boolean): boolean {
  return hasDraft && !problems.some((p) => p.severity === "ERROR");
}

export function countBySeverity(problems: readonly Problem[]) {
  return { errors: problems.filter((p) => p.severity === "ERROR").length, warnings: problems.filter((p) => p.severity === "WARNING").length };
}

export type JsonParse = { ok: true; value: unknown } | { ok: false; reason: "syntax"; line: number; col: number } | { ok: false; reason: "tooLarge" } | { ok: false; reason: "empty" };

/** 오프셋을 1부터 세는 줄·열로 */
export function lineColOf(text: string, offset: number): { line: number; col: number } {
  const before = text.slice(0, Math.max(0, Math.min(offset, text.length)));
  const lines = before.split("\n");
  return { line: lines.length, col: lines[lines.length - 1].length + 1 };
}

/** 직접 입력 JSON 검사: 문법 오류는 줄·열, 256KB 초과는 거부 */
export function parseJsonInput(text: string, limit = INPUT_LIMIT_BYTES): JsonParse {
  if (!text.trim()) return { ok: false, reason: "empty" };
  if (byteSize(text) > limit) return { ok: false, reason: "tooLarge" };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    // 엔진마다 오류 문구의 위치 표기가 달라서 직접 첫 오류 위치를 찾는다
    return { ok: false, reason: "syntax", ...lineColOf(text, jsonErrorOffset(text)) };
  }
}

/** JSON 문법상 처음 어긋난 위치(0부터). 문법이 맞으면 text.length */
export function jsonErrorOffset(text: string): number {
  let i = 0;
  const ws = () => {
    while (i < text.length && " \t\n\r".includes(text[i])) i++;
  };
  const fail = (): never => {
    throw i;
  };
  const literal = (word: string) => {
    if (text.startsWith(word, i)) i += word.length;
    else fail();
  };
  const string = () => {
    i++;
    while (i < text.length && text[i] !== '"') {
      if (text[i] === "\\") i++;
      else if (text[i] === "\n") fail();
      i++;
    }
    if (i >= text.length) fail();
    i++;
  };
  const number = () => {
    const match = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(i));
    if (!match) fail();
    i += match![0].length;
  };
  const value = (): void => {
    ws();
    const c = text[i];
    if (c === "{") {
      i++;
      ws();
      if (text[i] === "}") return void i++;
      for (;;) {
        ws();
        if (text[i] !== '"') fail();
        string();
        ws();
        if (text[i] !== ":") fail();
        i++;
        value();
        ws();
        if (text[i] === ",") i++;
        else if (text[i] === "}") return void i++;
        else fail();
      }
    }
    if (c === "[") {
      i++;
      ws();
      if (text[i] === "]") return void i++;
      for (;;) {
        value();
        ws();
        if (text[i] === ",") i++;
        else if (text[i] === "]") return void i++;
        else fail();
      }
    }
    if (c === '"') return string();
    if (c === "t") return literal("true");
    if (c === "f") return literal("false");
    if (c === "n") return literal("null");
    if (c === "-" || (c >= "0" && c <= "9")) return number();
    fail();
  };
  try {
    value();
    ws();
    if (i < text.length) fail();
    return text.length;
  } catch (offset) {
    return typeof offset === "number" ? offset : text.length;
  }
}

/** 같은 로그 줄이 연달아 나오면 하나로 묶고 횟수를 붙인다("x 3", TC-SCR-046) */
export function collapseLogs(logs: readonly { at?: string; message: string }[] | undefined): { message: string; count: number; at?: string }[] {
  const out: { message: string; count: number; at?: string }[] = [];
  for (const log of logs ?? []) {
    const last = out[out.length - 1];
    if (last && last.message === log.message) last.count += 1;
    else out.push({ message: log.message, count: 1, at: log.at });
  }
  return out;
}

export type DiffKind = "added" | "removed" | "changed";

export interface DiffRow {
  kind: DiffKind;
  key: string;
  from?: unknown;
  to?: unknown;
}

function keyOf(item: unknown): string {
  if (item && typeof item === "object") {
    const o = item as Record<string, unknown>;
    return String(o.key ?? o.metricKey ?? o.name ?? JSON.stringify(item));
  }
  return String(item);
}

function valueOf(item: unknown): unknown {
  if (item && typeof item === "object" && "value" in (item as Record<string, unknown>)) return (item as Record<string, unknown>).value;
  return item;
}

/** 테스트 실행 차이(API-SCR-08 `diff`)를 화면 행으로: 추가·삭제·변경 */
export function diffRows(diff: TestRunResult["diff"] | undefined): DiffRow[] {
  if (!diff) return [];
  return [
    ...(diff.added ?? []).map((item) => ({ kind: "added" as const, key: keyOf(item), to: valueOf(item) })),
    ...(diff.removed ?? []).map((item) => ({ kind: "removed" as const, key: keyOf(item), from: valueOf(item) })),
    ...(diff.changed ?? []).map((c) => ({ kind: "changed" as const, key: c.key, from: c.from, to: c.to })),
  ];
}

export function display(value: unknown): string {
  if (value === undefined) return "–";
  return typeof value === "string" ? value : JSON.stringify(value);
}

/** 새 스크립트 입력 검증(UI-SCR-01): 이름 2~80, 종류 필수, DECODE는 소스 하나만 */
export function checkCreateInput(input: { name: string; kind: string; bindings: { targetType: string }[] }): Record<string, string> {
  const errors: Record<string, string> = {};
  const name = input.name.trim();
  if (name.length < 2 || name.length > 80) errors.name = "name";
  if (input.kind !== "DECODE" && input.kind !== "TRANSFORM") errors.kind = "kind";
  if (input.kind === "DECODE" && (input.bindings.length > 1 || input.bindings.some((b) => b.targetType !== "SOURCE"))) errors.bindings = "decodeOneSource";
  if (input.kind === "TRANSFORM" && input.bindings.some((b) => b.targetType === "SOURCE")) errors.bindings = "transformTargets";
  return errors;
}

/** 배포 메모 2~200자 */
export function checkMemo(memo: string): boolean {
  const length = memo.trim().length;
  return length >= 2 && length <= 200;
}

/**
 * 디바운스(편집 중 정적 검사). 마지막 호출 뒤 ms가 지나면 한 번만 실행한다. 타이머는 바꿔 끼울 수 있다(테스트).
 */
export function createDebouncer<T>(run: (value: T) => void, ms = CHECK_DEBOUNCE_MS, timers: { set: (fn: () => void, ms: number) => unknown; clear: (h: unknown) => void } = { set: (fn, d) => setTimeout(fn, d), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) }) {
  let handle: unknown = null;
  return {
    schedule(value: T) {
      if (handle !== null) timers.clear(handle);
      handle = timers.set(() => {
        handle = null;
        run(value);
      }, ms);
    },
    cancel() {
      if (handle !== null) timers.clear(handle);
      handle = null;
    },
    get pending() {
      return handle !== null;
    },
  };
}

/** 목록의 연결 대상 요약("모델 EM300-TH 외 2") 재료 */
export function bindingSummary(summary: { sources?: number; models?: number; devices?: number } | null | undefined): { type: "sources" | "models" | "devices"; n: number }[] {
  if (!summary) return [];
  return (["sources", "models", "devices"] as const).filter((k) => (summary[k] ?? 0) > 0).map((k) => ({ type: k, n: summary[k] ?? 0 }));
}

/** 오류율 10% 이상은 빨강(UI-SCR-01) */
export function isHighErrorRate(rate: number | null | undefined): boolean {
  return (rate ?? 0) >= 0.1;
}
