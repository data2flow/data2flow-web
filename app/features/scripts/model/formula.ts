/**
 * 수식 항목(노코드 파생 측정, SCR-01.06, UI-SCR-07) 화면 쪽 문법 검사. 정본 검사는 pipeline(API-SCR-37)이 하고, 화면은 입력 중
 * 바로 알려 주려고 같은 문법(design/api/SCR-api.md §3.5)을 가볍게 확인한다: 사칙·나머지·거듭제곱, 비교, 괄호, 숫자, 측정 키, 함수.
 * 오류는 위치(1부터 줄·열)와 문구 키(`scripts.formulas.errors.{code}`)·변수로 돌려준다.
 */

/** 함수 이름 → 인자 수 [최소, 최대] */
export const FORMULA_FUNCTIONS: Record<string, [number, number]> = {
  thi: [2, 2],
  dew_point: [2, 2],
  dewPoint: [2, 2],
  abs_humidity: [2, 2],
  round: [1, 2],
  clamp: [3, 3],
  c2f: [1, 1],
  f2c: [1, 1],
  min: [2, 10],
  max: [2, 10],
  abs: [1, 1],
  sqrt: [1, 1],
  pow: [2, 2],
  log: [1, 1],
  exp: [1, 1],
  delta: [1, 1],
  rolling_mean: [2, 2],
  rolling_min: [2, 2],
  rolling_max: [2, 2],
  rolling_sum: [2, 2],
  rolling_count: [2, 2],
};

/** 창 인자를 받는 함수(두 번째 인자가 기간 `10m`·`1h`) */
const WINDOW_FUNCTIONS = new Set(["rolling_mean", "rolling_min", "rolling_max", "rolling_sum", "rolling_count"]);
/** 첫 인자가 측정 키여야 하는 함수 */
const KEY_FUNCTIONS = new Set([...WINDOW_FUNCTIONS, "delta"]);

export const FORMULA_MAX_LENGTH = 500;
/** 결과 키: 2~64자, 영문으로 시작(UI-SCR-07, core `^[A-Za-z][A-Za-z0-9_]{0,63}$`) */
export const RESULT_KEY = /^[A-Za-z][A-Za-z0-9_]{1,63}$/;

export interface FormulaError {
  code: "empty" | "tooLong" | "unexpected" | "unclosed" | "unknownFunction" | "unknownKey" | "arity" | "window" | "keyArg";
  line: number;
  col: number;
  /** 문구 변수(name 등) */
  params?: Record<string, string | number>;
}

export type FormulaCheck = { ok: true; keys: string[] } | ({ ok: false } & FormulaError);

type Token = { type: "num" | "ident" | "dur" | "op" | "lp" | "rp" | "comma" | "end"; text: string; offset: number };

function lineCol(text: string, offset: number) {
  const before = text.slice(0, offset).split("\n");
  return { line: before.length, col: before[before.length - 1].length + 1 };
}

function tokenize(text: string): Token[] | { offset: number } {
  const tokens: Token[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (/\s/.test(c)) {
      i += 1;
      continue;
    }
    const rest = text.slice(i);
    const dur = /^\d+(?:s|m|h)\b/.exec(rest);
    if (dur) {
      tokens.push({ type: "dur", text: dur[0], offset: i });
      i += dur[0].length;
      continue;
    }
    const num = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(rest);
    if (num) {
      tokens.push({ type: "num", text: num[0], offset: i });
      i += num[0].length;
      continue;
    }
    const ident = /^[A-Za-z_][A-Za-z0-9_]*/.exec(rest);
    if (ident) {
      tokens.push({ type: "ident", text: ident[0], offset: i });
      i += ident[0].length;
      continue;
    }
    const op = /^(?:<=|>=|==|!=|[-+*/%^<>])/.exec(rest);
    if (op) {
      tokens.push({ type: "op", text: op[0], offset: i });
      i += op[0].length;
      continue;
    }
    if (c === "(") tokens.push({ type: "lp", text: c, offset: i });
    else if (c === ")") tokens.push({ type: "rp", text: c, offset: i });
    else if (c === ",") tokens.push({ type: "comma", text: c, offset: i });
    else return { offset: i };
    i += 1;
  }
  tokens.push({ type: "end", text: "", offset: text.length });
  return tokens;
}

/** 기간 문자열(`10m`)을 초로. 1분~24시간만 허용 */
export function windowSeconds(text: string): number | null {
  const match = /^(\d+)(s|m|h)$/.exec(text);
  if (!match) return null;
  const seconds = Number(match[1]) * (match[2] === "h" ? 3600 : match[2] === "m" ? 60 : 1);
  return seconds >= 60 && seconds <= 86_400 ? seconds : null;
}

class Failure extends Error {
  constructor(readonly detail: Omit<FormulaError, "line" | "col"> & { offset: number }) {
    super(detail.code);
  }
}

/**
 * 수식 검사. `knownKeys`를 주면 모르는 측정 키를 거부한다(빈 목록이면 키 검사 생략).
 * 성공하면 수식이 읽는 측정 키 목록을 돌려준다(미리 보기 입력 선)
 */
export function checkFormula(expression: string, knownKeys: readonly string[] = []): FormulaCheck {
  const text = expression;
  if (!text.trim()) return { ok: false, code: "empty", line: 1, col: 1 };
  if (text.length > FORMULA_MAX_LENGTH) return { ok: false, code: "tooLong", line: 1, col: 1, params: { max: FORMULA_MAX_LENGTH } };
  const tokens = tokenize(text);
  if (!Array.isArray(tokens)) return { ok: false, code: "unexpected", ...lineCol(text, tokens.offset), params: { token: text[tokens.offset] } };
  const known = new Set(knownKeys);
  const keys = new Set<string>();
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];
  const expect = (type: Token["type"]) => {
    const token = next();
    if (token.type !== type) throw new Failure(token.type === "end" ? { code: "unclosed", offset: token.offset } : { code: "unexpected", offset: token.offset, params: { token: token.text } });
    return token;
  };
  const recordKey = (token: Token) => {
    if (known.size > 0 && !known.has(token.text)) throw new Failure({ code: "unknownKey", offset: token.offset, params: { name: token.text } });
    keys.add(token.text);
  };

  const comparison = (): void => {
    expr();
    while (peek().type === "op" && ["<", ">", "<=", ">=", "==", "!="].includes(peek().text)) {
      next();
      expr();
    }
  };
  const expr = (): void => {
    term();
    while (peek().type === "op" && ["+", "-"].includes(peek().text)) {
      next();
      term();
    }
  };
  const term = (): void => {
    factor();
    while (peek().type === "op" && ["*", "/", "%"].includes(peek().text)) {
      next();
      factor();
    }
  };
  const factor = (): void => {
    if (peek().type === "op" && ["+", "-"].includes(peek().text)) {
      next();
      factor();
      return;
    }
    primary();
    if (peek().type === "op" && peek().text === "^") {
      next();
      factor();
    }
  };
  const call = (name: Token) => {
    const arity = FORMULA_FUNCTIONS[name.text];
    if (!arity) throw new Failure({ code: "unknownFunction", offset: name.offset, params: { name: name.text } });
    expect("lp");
    let count = 0;
    if (peek().type !== "rp") {
      for (;;) {
        count += 1;
        const arg = peek();
        if (WINDOW_FUNCTIONS.has(name.text) && count === 2) {
          const token = next();
          if (token.type !== "dur" || windowSeconds(token.text) === null) throw new Failure({ code: "window", offset: token.offset, params: { token: token.text } });
        } else if (KEY_FUNCTIONS.has(name.text) && count === 1) {
          const token = next();
          if (token.type !== "ident") throw new Failure({ code: "keyArg", offset: arg.offset, params: { name: name.text } });
          recordKey(token);
        } else comparison();
        if (peek().type !== "comma") break;
        next();
      }
    }
    expect("rp");
    if (count < arity[0] || count > arity[1]) throw new Failure({ code: "arity", offset: name.offset, params: { name: name.text, min: arity[0], max: arity[1] } });
  };
  const primary = (): void => {
    const token = next();
    if (token.type === "num") return;
    if (token.type === "ident") {
      if (peek().type === "lp") return call(token);
      return recordKey(token);
    }
    if (token.type === "lp") {
      comparison();
      expect("rp");
      return;
    }
    if (token.type === "end") throw new Failure({ code: "unclosed", offset: token.offset });
    throw new Failure({ code: "unexpected", offset: token.offset, params: { token: token.text } });
  };

  try {
    comparison();
    const last = peek();
    if (last.type !== "end") throw new Failure({ code: "unexpected", offset: last.offset, params: { token: last.text } });
  } catch (error) {
    if (error instanceof Failure) {
      const { offset, ...rest } = error.detail;
      return { ok: false, ...rest, ...lineCol(text, offset) };
    }
    throw error;
  }
  return { ok: true, keys: [...keys] };
}

/** 결과 키 검증: 형식, 이미 있는 측정 항목·다른 수식과 중복 */
export function checkResultKey(key: string, takenKeys: readonly string[]): "pattern" | "conflict" | null {
  if (!RESULT_KEY.test(key)) return "pattern";
  return takenKeys.includes(key) ? "conflict" : null;
}

/** 커서 위치에 글자를 넣은 결과와 새 커서 */
export function insertAt(text: string, cursor: number, insert: string): { text: string; cursor: number } {
  const at = Math.max(0, Math.min(cursor, text.length));
  return { text: `${text.slice(0, at)}${insert}${text.slice(at)}`, cursor: at + insert.length };
}

/** 입력 중인 낱말(자동완성 접두사)과 그 시작 위치 */
export function wordAt(text: string, cursor: number): { word: string; start: number } {
  const before = text.slice(0, cursor);
  const match = /[A-Za-z_][A-Za-z0-9_]*$/.exec(before);
  return match ? { word: match[0], start: cursor - match[0].length } : { word: "", start: cursor };
}

/** 자동완성 후보: 측정 키와 함수(함수는 `이름(`) */
export function suggestions(prefix: string, keys: readonly string[], limit = 8): { label: string; insert: string; kind: "key" | "function" }[] {
  if (!prefix) return [];
  const lower = prefix.toLowerCase();
  const keyItems = keys.filter((k) => k.toLowerCase().startsWith(lower) && k !== prefix).map((k) => ({ label: k, insert: k, kind: "key" as const }));
  const fnItems = Object.keys(FORMULA_FUNCTIONS)
    .filter((f) => f.toLowerCase().startsWith(lower))
    .map((f) => ({ label: `${f}()`, insert: `${f}(`, kind: "function" as const }));
  return [...keyItems, ...fnItems].slice(0, limit);
}
