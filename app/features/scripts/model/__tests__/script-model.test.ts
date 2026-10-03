/**
 * 스크립트 화면 모델(SCR-03.01·03.02·04.05, UI-SCR-01·02).
 */
import { describe, expect, it, vi } from "vitest";
import { latestVersionNo } from "../../api";
import {
  CODE_LIMIT_BYTES,
  bindingSummary,
  byteSize,
  canDeploy,
  checkCreateInput,
  checkMemo,
  collapseLogs,
  countBySeverity,
  createDebouncer,
  diffRows,
  display,
  isHighErrorRate,
  jsonErrorOffset,
  lineColOf,
  parseJsonInput,
  requiredFunctionProblem,
  type Problem,
} from "../script-model";

describe("SCR-04.05 TC-SCR-040 정적 검사 결과와 배포 가능 여부", () => {
  const error: Problem = { line: 3, col: 9, severity: "ERROR", message: "금지된 API: require" };
  const warning: Problem = { line: 1, col: 1, severity: "WARNING", message: "debugger" };
  it("오류가 있으면 배포 불가, 경고만 있으면 가능, DRAFT가 없으면 불가", () => {
    expect(canDeploy([error, warning], true)).toBe(false);
    expect(canDeploy([warning], true)).toBe(true);
    expect(canDeploy([], false)).toBe(false);
    expect(countBySeverity([error, warning, warning])).toEqual({ errors: 1, warnings: 2 });
  });

  it("필수 함수: DECODE는 decode, TRANSFORM은 transform", () => {
    expect(requiredFunctionProblem("TRANSFORM", "function transform(msg, ctx) { return msg; }")).toBeNull();
    expect(requiredFunctionProblem("TRANSFORM", "const transform = (msg) => msg")).toBeNull();
    expect(requiredFunctionProblem("TRANSFORM", "function decode(msg) {}")).toMatchObject({ severity: "ERROR", message: "transform", line: 1, col: 1 });
    expect(requiredFunctionProblem("DECODE", "function decode (msg, ctx) {}")).toBeNull();
  });
});

describe("SCR-03.02 TC-SCR-046 테스트 실행 입력·결과", () => {
  it("직접 입력 JSON: 문법 오류는 줄·열, 256KB 초과·빈 값 거부", () => {
    expect(parseJsonInput('{"a": 1}')).toEqual({ ok: true, value: { a: 1 } });
    const bad = parseJsonInput('{\n  "a": 1,\n  "b": x\n}');
    expect(bad).toMatchObject({ ok: false, reason: "syntax", line: 3 });
    expect(parseJsonInput("  ")).toEqual({ ok: false, reason: "empty" });
    expect(parseJsonInput('"aaaa"', 3)).toEqual({ ok: false, reason: "tooLarge" });
    expect(parseJsonInput("{")).toMatchObject({ ok: false, reason: "syntax" });
    expect(lineColOf("ab\ncd", 4)).toEqual({ line: 2, col: 2 });
    expect(bad).toEqual({ ok: false, reason: "syntax", line: 3, col: 8 });
    expect(jsonErrorOffset("[1, 2,]")).toBe(6);
    expect(jsonErrorOffset("[true, false, null, \"a\\\"b\", -1.5e3, {}]")).toBe(39);
    expect(jsonErrorOffset("\"open")).toBe(5);
    expect(jsonErrorOffset("{\"a\" 1}")).toBe(5);
    expect(jsonErrorOffset("{\"a\":1 x")).toBe(7);
    expect(jsonErrorOffset("[1 2]")).toBe(3);
    expect(jsonErrorOffset("1 2")).toBe(2);
    expect(jsonErrorOffset("tru")).toBe(0);
    expect(jsonErrorOffset("-")).toBe(0);
    expect(jsonErrorOffset("\"a\nb\"")).toBe(2);
  });

  it("같은 로그는 묶어 x n, 차이는 추가·삭제·변경 행", () => {
    expect(collapseLogs([{ message: "a" }, { message: "a" }, { message: "a" }, { message: "b" }, { message: "a" }])).toEqual([
      { message: "a", count: 3, at: undefined },
      { message: "b", count: 1, at: undefined },
      { message: "a", count: 1, at: undefined },
    ]);
    expect(collapseLogs(undefined)).toEqual([]);
    expect(diffRows({ added: [{ key: "dew_point", value: 9.4 }, "x"], removed: [{ metricKey: "co2", value: 1 }], changed: [{ key: "temperature", from: 22.3, to: 22.8 }] })).toEqual([
      { kind: "added", key: "dew_point", to: 9.4 },
      { kind: "added", key: "x", to: "x" },
      { kind: "removed", key: "co2", from: 1 },
      { kind: "changed", key: "temperature", from: 22.3, to: 22.8 },
    ]);
    expect(diffRows(undefined)).toEqual([]);
    expect(diffRows({ added: [{ a: 1 }] })[0].key).toBe('{"a":1}');
    expect(display(undefined)).toBe("–");
    expect(display("s")).toBe("s");
    expect(display({ a: 1 })).toBe('{"a":1}');
  });
});

describe("UI-SCR-01·02 입력 검증과 표시", () => {
  it("새 스크립트: 이름 2~80, 종류, DECODE는 소스 하나만, TRANSFORM은 소스 금지", () => {
    expect(checkCreateInput({ name: "a", kind: "X", bindings: [] })).toEqual({ name: "name", kind: "kind" });
    expect(checkCreateInput({ name: "디코더", kind: "DECODE", bindings: [{ targetType: "SOURCE" }, { targetType: "SOURCE" }] })).toEqual({ bindings: "decodeOneSource" });
    expect(checkCreateInput({ name: "디코더", kind: "DECODE", bindings: [{ targetType: "MODEL" }] })).toEqual({ bindings: "decodeOneSource" });
    expect(checkCreateInput({ name: "보정", kind: "TRANSFORM", bindings: [{ targetType: "SOURCE" }] })).toEqual({ bindings: "transformTargets" });
    expect(checkCreateInput({ name: "보정", kind: "TRANSFORM", bindings: [{ targetType: "MODEL" }] })).toEqual({});
  });

  it("배포 메모 2~200자, 코드 크기, 오류율 10% 이상, 연결 요약, 마지막 버전 번호", () => {
    expect(checkMemo(" a ")).toBe(false);
    expect(checkMemo("보정")).toBe(true);
    expect(checkMemo("x".repeat(201))).toBe(false);
    expect(byteSize("가")).toBe(3);
    expect(CODE_LIMIT_BYTES).toBe(65536);
    expect(isHighErrorRate(0.121)).toBe(true);
    expect(isHighErrorRate(0.05)).toBe(false);
    expect(isHighErrorRate(undefined)).toBe(false);
    expect(bindingSummary({ sources: 0, models: 3, devices: 1 })).toEqual([{ type: "models", n: 3 }, { type: "devices", n: 1 }]);
    expect(bindingSummary(null)).toEqual([]);
    expect(latestVersionNo({ versions: [{ versionId: "1", versionNo: 4, status: "ACTIVE" }], draft: { versionId: "2", versionNo: 5, code: "", staticCheck: { ok: true, problems: [] } }, activeVersion: null })).toBe(5);
    expect(latestVersionNo({ activeVersion: null, draft: null })).toBe(0);
  });
});

describe("SCR-04.05 입력 중 정적 검사 500ms 디바운스", () => {
  it("마지막 입력 뒤 500ms에 한 번만, 취소하면 실행하지 않음", () => {
    vi.useFakeTimers();
    const run = vi.fn();
    const debouncer = createDebouncer<string>(run);
    debouncer.schedule("a");
    vi.advanceTimersByTime(300);
    debouncer.schedule("ab");
    expect(debouncer.pending).toBe(true);
    vi.advanceTimersByTime(499);
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledExactlyOnceWith("ab");
    debouncer.schedule("abc");
    debouncer.cancel();
    vi.advanceTimersByTime(1000);
    expect(run).toHaveBeenCalledTimes(1);
    expect(debouncer.pending).toBe(false);
    debouncer.cancel();
    vi.useRealTimers();
  });
});
