/**
 * 기기 검색식(DEV-13.03, UI-DEV-19, BR-DEV-35) 화면 쪽 검사. 실제 판정은 서버(core `DeviceQueryParser`)가 하고,
 * 여기서는 같은 문법으로 입력 중 오류 위치(열, 1부터)와 자동완성 후보만 만든다. 문법(대소문자 무시):
 *
 *   expr := and ('or' and)* · and := unary ('and' unary)* · unary := 'not' unary | '(' expr ')' | cmp
 *   cmp  := field op value | field 'in' (value | '(' value (',' value)* ')')
 *   op   := = | != | < | <= | > | >= | ~ · value := "문자열" | 숫자 | true | false | 기간(30m·24h·7d)
 */

export const QUERY_MAX_LENGTH = 2000;
export const QUERY_MAX_TERMS = 50;

const EQ = ["=", "!=", "in"];
const TEXT = ["=", "!=", "~", "in"];
const NUM = ["=", "!=", "<", "<=", ">", ">="];
const COMPARE = ["=", "!=", "<", "<=", ">", ">=", "~"];

/** 필드 → 허용 연산자(core와 같다) */
export const QUERY_FIELDS: Record<string, string[]> = {
  name: TEXT,
  externalId: TEXT,
  status: EQ,
  connectivity: EQ,
  kind: EQ,
  model: EQ,
  space: EQ,
  tag: EQ,
  source: EQ,
  group: EQ,
  battery: NUM,
  rssi: NUM,
  snr: NUM,
  lastSeen: ["<", "<=", ">", ">="],
  virtual: ["=", "!="],
};
const DYNAMIC_PREFIXES = ["metric.", "attr."];
const KEYWORDS = ["and", "or", "not", "in", "true", "false"];

export type QueryErrorCode =
  | "empty"
  | "tooLong"
  | "unclosedString"
  | "valueTooLong"
  | "unknownOperator"
  | "fieldExpected"
  | "unknownField"
  | "tooManyTerms"
  | "operatorExpected"
  | "operatorNotAllowed"
  | "valueExpected"
  | "rparenExpected"
  | "unexpectedToken";

export type QueryNode =
  | { node: "or"; items: QueryNode[] }
  | { node: "and"; items: QueryNode[] }
  | { node: "not"; item: QueryNode }
  | { node: "cmp"; field: string; op: string; values: string[]; kinds: ValueKind[]; column: number };

export type ValueKind = "STRING" | "NUMBER" | "BOOLEAN" | "DURATION";

export type ParseResult = { ok: true; ast: QueryNode } | { ok: false; column: number; code: QueryErrorCode; detail?: string };

type TokenType = "WORD" | "STRING" | "NUMBER" | "DURATION" | "OP" | "LPAREN" | "RPAREN" | "COMMA" | "END";
interface Token {
  type: TokenType;
  text: string;
  column: number;
}

class QueryError extends Error {
  constructor(
    readonly column: number,
    readonly code: QueryErrorCode,
    readonly detail?: string,
  ) {
    super(code);
  }
}

const NUMBER = /^-?\d{1,15}(\.\d{1,9})?$/;
const DURATION = /^\d{1,6}[smhd]$/;
const IDENT = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)?$/;

export function tokenize(s: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  const n = s.length;
  while (i < n) {
    const c = s[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    const col = i + 1;
    if (c === "(" || c === ")" || c === ",") {
      out.push({ type: c === "(" ? "LPAREN" : c === ")" ? "RPAREN" : "COMMA", text: c, column: col });
      i++;
    } else if (c === '"' || c === "'") {
      let b = "";
      let j = i + 1;
      let closed = false;
      while (j < n) {
        const ch = s[j];
        if (ch === "\\" && j + 1 < n) {
          b += s[j + 1];
          j += 2;
          continue;
        }
        if (ch === c) {
          closed = true;
          break;
        }
        b += ch;
        j++;
      }
      if (!closed) throw new QueryError(col, "unclosedString");
      if (b.length > 200) throw new QueryError(col, "valueTooLong");
      out.push({ type: "STRING", text: b, column: col });
      i = j + 1;
    } else if ("=!<>~".includes(c)) {
      const two = s.slice(i, i + 2);
      if (["!=", "<=", ">=", "=="].includes(two)) {
        out.push({ type: "OP", text: two === "==" ? "=" : two, column: col });
        i += 2;
      } else if (c === "!") {
        throw new QueryError(col, "unknownOperator");
      } else {
        out.push({ type: "OP", text: c, column: col });
        i++;
      }
    } else {
      let j = i;
      while (j < n && !/\s/.test(s[j]) && !"()=,!<>~\"'".includes(s[j])) j++;
      const w = s.slice(i, j);
      out.push({ type: NUMBER.test(w) ? "NUMBER" : DURATION.test(w) ? "DURATION" : "WORD", text: w, column: col });
      i = j;
    }
  }
  out.push({ type: "END", text: "", column: n + 1 });
  return out;
}

const isWord = (t: Token, w: string) => t.type === "WORD" && t.text.toLowerCase() === w;
const isKeyword = (w: string) => KEYWORDS.includes(w.toLowerCase());

/** 필드 이름(대소문자 무시)의 허용 연산자. 동적 필드(metric.·attr.)는 비교 연산자 전부 */
export function operatorsOf(field: string): string[] | undefined {
  const lower = field.toLowerCase();
  if (DYNAMIC_PREFIXES.some((p) => lower.startsWith(p) && lower.length > p.length)) return COMPARE;
  const key = Object.keys(QUERY_FIELDS).find((k) => k.toLowerCase() === lower);
  return key ? QUERY_FIELDS[key] : undefined;
}

class Parser {
  private pos = 0;
  private terms = 0;
  constructor(private readonly tokens: Token[]) {}

  peek() {
    return this.tokens[Math.min(this.pos, this.tokens.length - 1)];
  }
  next() {
    const t = this.peek();
    if (this.pos < this.tokens.length) this.pos++;
    return t;
  }
  or(): QueryNode {
    const items = [this.and()];
    while (isWord(this.peek(), "or")) {
      this.next();
      items.push(this.and());
    }
    return items.length === 1 ? items[0] : { node: "or", items };
  }
  and(): QueryNode {
    const items = [this.unary()];
    while (isWord(this.peek(), "and")) {
      this.next();
      items.push(this.unary());
    }
    return items.length === 1 ? items[0] : { node: "and", items };
  }
  unary(): QueryNode {
    const t = this.peek();
    if (isWord(t, "not")) {
      this.next();
      return { node: "not", item: this.unary() };
    }
    if (t.type === "LPAREN") {
      this.next();
      const inner = this.or();
      this.expect("RPAREN");
      return inner;
    }
    return this.cmp();
  }
  cmp(): QueryNode {
    const f = this.next();
    if (f.type !== "WORD" || !IDENT.test(f.text) || isKeyword(f.text)) throw new QueryError(f.column, "fieldExpected");
    const allowed = operatorsOf(f.text);
    if (!allowed) throw new QueryError(f.column, "unknownField", f.text);
    if (++this.terms > QUERY_MAX_TERMS) throw new QueryError(f.column, "tooManyTerms");
    const opTok = this.next();
    const op = opTok.type === "OP" ? opTok.text : isWord(opTok, "in") ? "in" : null;
    if (!op) throw new QueryError(opTok.column, "operatorExpected");
    if (!allowed.includes(op)) throw new QueryError(opTok.column, "operatorNotAllowed", op);
    const values: string[] = [];
    const kinds: ValueKind[] = [];
    const push = (v: Token) => {
      values.push(v.text);
      kinds.push(v.type === "NUMBER" ? "NUMBER" : v.type === "DURATION" ? "DURATION" : isWord(v, "true") || isWord(v, "false") ? "BOOLEAN" : "STRING");
    };
    if (op === "in" && this.peek().type === "LPAREN") {
      this.next();
      do push(this.value());
      while (this.peek().type === "COMMA" && this.next());
      this.expect("RPAREN");
    } else {
      push(this.value());
    }
    return { node: "cmp", field: f.text.toLowerCase().startsWith("metric.") || f.text.toLowerCase().startsWith("attr.") ? f.text : f.text.toLowerCase(), op, values, kinds, column: f.column };
  }
  value(): Token {
    const v = this.next();
    if (v.type === "STRING" || v.type === "NUMBER" || v.type === "DURATION") return v;
    if (isWord(v, "true") || isWord(v, "false")) return v;
    if (v.type === "WORD" && !isKeyword(v.text)) return v;
    throw new QueryError(v.column, "valueExpected");
  }
  expect(type: TokenType) {
    const t = this.next();
    if (t.type !== type) throw new QueryError(t.column, type === "RPAREN" ? "rparenExpected" : "unexpectedToken");
  }
}

/** 검색식을 검사한다. 오류는 열(1부터)과 코드 */
export function parseDeviceQuery(q: string): ParseResult {
  if (!q || !q.trim()) return { ok: false, column: 1, code: "empty" };
  if (q.length > QUERY_MAX_LENGTH) return { ok: false, column: QUERY_MAX_LENGTH + 1, code: "tooLong" };
  try {
    const parser = new Parser(tokenize(q));
    const ast = parser.or();
    if (parser.peek().type !== "END") throw new QueryError(parser.peek().column, "unexpectedToken");
    return { ok: true, ast };
  } catch (error) {
    if (error instanceof QueryError) return { ok: false, column: error.column, code: error.code, detail: error.detail };
    throw error;
  }
}

/** 검색식으로 보이는가(목록 `q`가 키워드인지 검색식인지, core와 같은 판정) */
export function looksLikeExpression(q: string | null | undefined): boolean {
  if (!q || !q.trim()) return false;
  const s = q.trim().toLowerCase();
  return /[=<>~()]/.test(s) || /\s(and|or|in)\s/.test(s) || s.startsWith("not ");
}

/** 오류 위치 표시용: 열 앞·그 글자·뒤로 나눈다(열이 끝을 넘으면 빈 칸 하나를 밑줄로) */
export function splitAtColumn(q: string, column: number): { before: string; at: string; after: string } {
  const index = Math.max(0, Math.min(column - 1, q.length));
  return { before: q.slice(0, index), at: q.slice(index, index + 1) || " ", after: q.slice(index + 1) };
}

/**
 * 자동완성 후보: 마지막 낱말이 필드 자리면 필드, 연산자 자리면 그 필드의 연산자, 조건 뒤면 and/or.
 * `prefix`는 지금 치는 낱말(없으면 빈 문자열), `replaceFrom`은 후보로 바꿀 시작 위치(0부터)
 */
export function suggest(q: string): { kind: "field" | "operator" | "keyword" | "none"; items: string[]; replaceFrom: number } {
  const trailingSpace = /\s$/.test(q) || q.length === 0;
  const match = /([A-Za-z_.][A-Za-z0-9_.]*)$/.exec(q);
  const prefix = trailingSpace || !match ? "" : match[1];
  const replaceFrom = q.length - prefix.length;
  let tokens: Token[];
  try {
    tokens = tokenize(q.slice(0, replaceFrom)).filter((t) => t.type !== "END");
  } catch {
    return { kind: "none", items: [], replaceFrom };
  }
  const last = tokens.at(-1);
  const prev = tokens.at(-2);
  const lower = prefix.toLowerCase();
  const startsWith = (items: string[]) => items.filter((x) => x.toLowerCase().startsWith(lower) && x.toLowerCase() !== lower);
  const fieldSlot = !last || last.type === "LPAREN" || (last.type === "WORD" && ["and", "or", "not"].includes(last.text.toLowerCase()));
  if (fieldSlot) return { kind: "field", items: startsWith([...Object.keys(QUERY_FIELDS), ...DYNAMIC_PREFIXES]), replaceFrom };
  if (last.type === "WORD" && !isKeyword(last.text) && (!prev || prev.type === "LPAREN" || (prev.type === "WORD" && ["and", "or", "not"].includes(prev.text.toLowerCase())))) {
    const ops = operatorsOf(last.text);
    return ops ? { kind: "operator", items: prefix ? startsWith(ops) : ops, replaceFrom } : { kind: "none", items: [], replaceFrom };
  }
  if (last.type === "STRING" || last.type === "NUMBER" || last.type === "DURATION" || last.type === "RPAREN" || (last.type === "WORD" && prev?.type === "OP")) {
    return { kind: "keyword", items: startsWith(["and", "or"]), replaceFrom };
  }
  return { kind: "none", items: [], replaceFrom };
}

/** 후보를 고르면 검색식에 넣는다 */
export function applySuggestion(q: string, replaceFrom: number, item: string): string {
  const spacer = item.endsWith(".") ? "" : " ";
  return `${q.slice(0, replaceFrom)}${item}${spacer}`;
}
