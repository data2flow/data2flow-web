/**
 * SCR-01.06 수식 항목 화면 쪽 문법 검사(TC-SCR-015와 같은 표본, 정본 검사는 pipeline TC-SCR-015) — UI-SCR-07
 */
import { describe, expect, it } from "vitest";
import { checkFormula, checkResultKey, insertAt, suggestions, windowSeconds, wordAt } from "../formula";

const KEYS = ["temperature", "humidity", "co2"];

describe("SCR-01.06 TC-SCR-015 TC-SCR-019 수식 문법(화면)", () => {
  it("AT-SCR-06.3 올바른 수식: 함수·사칙·창·비교·거듭제곱, 읽는 키 목록", () => {
    expect(checkFormula("thi(temperature, humidity)", KEYS)).toEqual({ ok: true, keys: ["temperature", "humidity"] });
    expect(checkFormula("temperature * 1.8 + 32", KEYS)).toEqual({ ok: true, keys: ["temperature"] });
    expect(checkFormula("rolling_mean(co2, 10m)", KEYS)).toEqual({ ok: true, keys: ["co2"] });
    expect(checkFormula("round(-(temperature ^ 2) % 3, 1) >= 2", KEYS).ok).toBe(true);
    expect(checkFormula("delta(co2) + max(1, 2, 3) + .5e1", KEYS).ok).toBe(true);
    expect(checkFormula("anything * 2").ok).toBe(true);
  });

  it("오타 키 'temprature' → 알 수 없는 측정 항목(1:1), 모르는 함수, 괄호 불일치, 창 0m, 인자 수", () => {
    expect(checkFormula("temprature * 2", KEYS)).toEqual({ ok: false, code: "unknownKey", line: 1, col: 1, params: { name: "temprature" } });
    expect(checkFormula("foo(temperature)", KEYS)).toMatchObject({ ok: false, code: "unknownFunction", col: 1, params: { name: "foo" } });
    expect(checkFormula("(temperature + 1", KEYS)).toMatchObject({ ok: false, code: "unclosed" });
    expect(checkFormula("temperature + 1)", KEYS)).toMatchObject({ ok: false, code: "unexpected", col: 16 });
    expect(checkFormula("rolling_mean(co2, 0m)", KEYS)).toMatchObject({ ok: false, code: "window", params: { token: "0m" } });
    expect(checkFormula("rolling_mean(co2, 25h)", KEYS)).toMatchObject({ ok: false, code: "window" });
    expect(checkFormula("rolling_mean(1, 10m)", KEYS)).toMatchObject({ ok: false, code: "keyArg" });
    expect(checkFormula("thi(temperature)", KEYS)).toMatchObject({ ok: false, code: "arity", params: { name: "thi", min: 2, max: 2 } });
    expect(checkFormula("temperature $ 2", KEYS)).toMatchObject({ ok: false, code: "unexpected", col: 13, params: { token: "$" } });
    expect(checkFormula("temperature +\n  humidty", KEYS)).toMatchObject({ ok: false, code: "unknownKey", line: 2, col: 3 });
    expect(checkFormula("   ")).toMatchObject({ ok: false, code: "empty" });
    expect(checkFormula("1+".repeat(260))).toMatchObject({ ok: false, code: "tooLong" });
    expect(checkFormula("temperature +", KEYS)).toMatchObject({ ok: false, code: "unclosed" });
  });

  it("창 1m~24h, 결과 키 형식·중복", () => {
    expect(windowSeconds("1m")).toBe(60);
    expect(windowSeconds("24h")).toBe(86400);
    expect(windowSeconds("30s")).toBeNull();
    expect(windowSeconds("x")).toBeNull();
    expect(checkResultKey("thi", KEYS)).toBeNull();
    expect(checkResultKey("temperature", KEYS)).toBe("conflict");
    expect(checkResultKey("1abc", KEYS)).toBe("pattern");
    expect(checkResultKey("a", KEYS)).toBe("pattern");
  });

  it("자동완성: 입력 중인 낱말, 측정 키·함수 후보, 커서 위치에 넣기", () => {
    expect(wordAt("thi(temp", 8)).toEqual({ word: "temp", start: 4 });
    expect(wordAt("1 + ", 4)).toEqual({ word: "", start: 4 });
    expect(suggestions("temp", KEYS)).toEqual([{ label: "temperature", insert: "temperature", kind: "key" }]);
    expect(suggestions("roll", KEYS).map((s) => s.insert)).toContain("rolling_mean(");
    expect(suggestions("", KEYS)).toEqual([]);
    expect(insertAt("a + ", 4, "co2")).toEqual({ text: "a + co2", cursor: 7 });
    expect(insertAt("ab", 99, "c")).toEqual({ text: "abc", cursor: 3 });
  });
});
