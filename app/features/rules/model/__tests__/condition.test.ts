/**
 * 조건 빌더 모델(UI-RUL-02, domain-model §2.1, BR-RUL-04·05·21) — TC-RUL-019의 모델 쪽: 10개·2단계 한도, 해제 기준 방향, 지속·반복 범위, 요약.
 */
import { describe, expect, it } from "vitest";
import {
  addToGroup,
  canAddCondition,
  canAddGroup,
  changeOp,
  checkClear,
  depthOf,
  firstThreshold,
  fromEditor,
  leafCount,
  metricsOf,
  newLeaf,
  newThreshold,
  removeNode,
  summarize,
  supportsClear,
  toEditor,
  updateNode,
  validateCondition,
  type EditorGroup,
  type EditorLeaf,
} from "../condition";
import type { MetricInfo, ThresholdCondition } from "../types";

const metrics: MetricInfo[] = [
  { key: "co2", unit: "ppm", valueType: "NUMBER", validMin: 0, validMax: 10000 },
  { key: "occupancy", valueType: "BOOLEAN" },
  { key: "mode", valueType: "ENUM" },
  { key: "temperature", unit: "℃", valueType: "NUMBER", validMin: -20, validMax: 60 },
];
const words = { s: "초", m: "분", h: "시간", and: "AND", or: "OR", noData: "무수신", rate: "변화율", clear: "해제", repeat: "반복", anomaly: "이상 점수" };

const co2: ThresholdCondition = { kind: "threshold", metric: "co2", op: ">", value: 1000, for: "PT5M", clear: 900, repeat: 1 };

function leaf(root: EditorGroup, i = 0) {
  return root.items[i] as EditorLeaf & ThresholdCondition;
}

describe("RUL-01.06 편집 트리 ↔ 저장 본문", () => {
  it("단일 조건은 AND 그룹으로 감싸 편집하고 저장할 때 조건 하나만 보낸다(uid는 빠진다)", () => {
    const root = toEditor(co2);
    expect(root.kind).toBe("group");
    expect(root.items).toHaveLength(1);
    expect(fromEditor(root)).toEqual(co2);
  });

  it("복합 조건(co2>1000 AND occupancy=1)은 그룹 그대로, 빈 값은 보내지 않는다", () => {
    const condition = { kind: "group" as const, op: "AND" as const, items: [co2, { kind: "threshold" as const, metric: "occupancy", op: "==" as const, value: true, clear: null }] };
    const root = toEditor(condition);
    expect(leafCount(root)).toBe(2);
    expect(fromEditor(root)).toEqual({ kind: "group", op: "AND", items: [co2, { kind: "threshold", metric: "occupancy", op: "==", value: true }] });
    expect(metricsOf(root)).toEqual(["co2", "occupancy"]);
    expect(toEditor(null).items).toHaveLength(1);
  });

  it("TC-RUL-019 조건 10개를 넘거나 3단계로 중첩하면 추가할 수 없다", () => {
    let root = toEditor(co2);
    for (let i = 0; i < 9; i += 1) root = addToGroup(root, root.uid, newThreshold("co2"));
    expect(leafCount(root)).toBe(10);
    expect(canAddCondition(root)).toBe(false);
    expect(addToGroup(root, root.uid, newThreshold())).toBe(root);
    let small = toEditor(co2);
    const inner: EditorGroup = { kind: "group", uid: "inner", op: "OR", items: [newThreshold("co2")] };
    small = addToGroup(small, small.uid, inner);
    expect(depthOf(small, "inner")).toBe(2);
    expect(canAddGroup(small, small.uid)).toBe(true);
    expect(canAddGroup(small, "inner")).toBe(false);
    expect(addToGroup(small, "inner", { kind: "group", uid: "x", op: "AND", items: [] })).toBe(small);
    expect(depthOf(small, "nope")).toBeNull();
    const problems = validateCondition({ ...small, items: [...small.items, { kind: "group", uid: "g2", op: "AND", items: [{ kind: "group", uid: "g3", op: "AND", items: [newThreshold("co2")] }] }] }, metrics);
    expect(problems["g3.depth"]).toEqual({ key: "rules.v.depthLimit", params: { n: 2 } });
    const many: EditorGroup = { ...root, items: [...root.items, newThreshold("co2")] };
    expect(validateCondition(many, metrics)[`${root.uid}.count`]?.key).toBe("rules.v.countLimit");
  });

  it("조건 삭제: 비어 버린 안쪽 그룹은 지우고, 최상위가 비면 빈 조건 하나", () => {
    let root = toEditor(co2);
    const inner: EditorGroup = { kind: "group", uid: "inner", op: "OR", items: [newThreshold("co2")] };
    root = addToGroup(root, root.uid, inner);
    root = removeNode(root, inner.items[0].uid);
    expect(root.items).toHaveLength(1);
    root = removeNode(root, root.items[0].uid);
    expect(root.items).toHaveLength(1);
    expect(leaf(root).metric).toBe("");
    expect(removeNode(root, root.uid)).toBe(root);
    root = updateNode(root, root.uid, { op: "OR" });
    expect(root.op).toBe("OR");
  });

  it("새 조건 종류의 기본값", () => {
    expect(newLeaf("rateOfChange", "temperature")).toMatchObject({ kind: "rateOfChange", window: "PT10M", direction: "UP" });
    expect(newLeaf("noData")).toMatchObject({ kind: "noData", window: "PT30M" });
    expect(newLeaf("anomaly")).toMatchObject({ kind: "anomaly", minScore: 3 });
    expect(newLeaf("threshold")).toMatchObject({ kind: "threshold", op: ">" });
  });
});

describe("RUL-01.01·01.03·01.12 검사(BR-RUL-04·05)", () => {
  it("값 유효 범위: \"co2의 유효 범위는 0~10000입니다\"", () => {
    const root = toEditor({ ...co2, value: 12000, clear: null });
    expect(validateCondition(root, metrics)[`${root.items[0].uid}.value`]).toEqual({ key: "rules.v.valueRange", params: { metric: "co2", min: 0, max: 10000 } });
  });

  it("해제 기준은 발생 기준보다 같은 방향 안쪽: > 이면 작아야, < 이면 커야", () => {
    expect(checkClear(">", 1000, 900)).toBeUndefined();
    expect(checkClear(">=", 1000, 1000)).toEqual({ key: "rules.v.clearBelow", params: { value: 1000 } });
    expect(checkClear("<", 18, 19)).toBeUndefined();
    expect(checkClear("<=", 18, 17)).toEqual({ key: "rules.v.clearAbove", params: { value: 18 } });
    expect(checkClear("==", 1, 1)).toBeUndefined();
    const root = toEditor({ ...co2, clear: 1100 });
    expect(validateCondition(root, metrics)[`${root.items[0].uid}.clear`]?.key).toBe("rules.v.clearBelow");
  });

  it("지속 0초~24시간, 반복 1~100, 값·측정 항목 필수, 범위 연산자", () => {
    const root = toEditor({ kind: "group", op: "AND", items: [{ ...co2, for: "PT25H" }, { ...co2, repeat: 0 }, { kind: "threshold", metric: "", op: ">", value: null }, { kind: "threshold", metric: "co2", op: "outside", range: [500, 400] }, { kind: "threshold", metric: "co2", op: "inside", range: null }, { kind: "threshold", metric: "co2", op: "inside", range: [0, 20000] }] });
    const p = validateCondition(root, metrics);
    const id = (i: number) => root.items[i].uid;
    expect(p[`${id(0)}.for`]?.key).toBe("rules.v.forRange");
    expect(p[`${id(1)}.repeat`]?.key).toBe("rules.v.repeatRange");
    expect(p[`${id(2)}.metric`]?.key).toBe("rules.v.metricRequired");
    expect(p[`${id(2)}.value`]?.key).toBe("rules.v.valueRequired");
    expect(p[`${id(3)}.range`]?.key).toBe("rules.v.rangeOrder");
    expect(p[`${id(4)}.range`]?.key).toBe("rules.v.valueRequired");
    expect(p[`${id(5)}.range`]?.key).toBe("rules.v.valueRange");
    expect(validateCondition(toEditor({ ...co2, for: "PT0S" }), metrics)).toEqual({});
  });

  it("불리언·열거형 값, 변화율·무수신 기간", () => {
    const root = toEditor({ kind: "group", op: "OR", items: [{ kind: "threshold", metric: "occupancy", op: "==", value: null }, { kind: "threshold", metric: "mode", op: "==", value: "" }, { kind: "rateOfChange", metric: "temperature", window: "bad", delta: 0, direction: "UP" }, { kind: "noData", window: "PT10S" }, { kind: "anomaly", minScore: 3 }] });
    const p = validateCondition(root, metrics);
    const id = (i: number) => root.items[i].uid;
    expect(p[`${id(0)}.value`]?.key).toBe("rules.v.valueRequired");
    expect(p[`${id(1)}.value`]?.key).toBe("rules.v.valueRequired");
    expect(p[`${id(2)}.window`]?.key).toBe("rules.v.windowRange");
    expect(p[`${id(2)}.delta`]?.key).toBe("rules.v.deltaPositive");
    expect(p[`${id(3)}.window`]?.key).toBe("rules.v.windowRange");
    expect(Object.keys(p).some((k) => k.startsWith(id(4)))).toBe(false);
  });

  it("연산자를 바꾸면 맞지 않는 값·해제 기준을 비운다", () => {
    expect(changeOp(co2, "outside")).toEqual({ op: "outside", range: null, value: null, clear: null });
    expect(changeOp({ ...co2, op: "outside", range: [1, 2] }, ">=")).toEqual({ op: ">=", range: null, value: 1000, clear: 900 });
    expect(supportsClear("!=")).toBe(false);
  });
});

describe("조건 요약(UI-RUL-01 \"co2 > 1000ppm 5분\")", () => {
  it("임계값·지속·해제·반복, 복합(괄호), 변화율·무수신·이상 점수", () => {
    expect(summarize(co2, metrics, words)).toBe("co2 > 1000ppm 5분 해제 900ppm");
    expect(summarize({ ...co2, for: "PT1H", clear: null, repeat: 3 }, metrics, words)).toBe("co2 > 1000ppm 1시간 반복 3");
    expect(summarize({ kind: "group", op: "AND", items: [co2, { kind: "group", op: "OR", items: [{ kind: "noData", metric: "co2", window: "PT30M" }, { kind: "rateOfChange", metric: "temperature", window: "PT10M", delta: 3, direction: "UP" }] }] }, metrics, words)).toBe(
      "co2 > 1000ppm 5분 해제 900ppm AND (co2 무수신 30분 OR temperature 변화율 +3℃ / 10분)",
    );
    expect(summarize({ kind: "threshold", metric: "co2", op: "outside", range: [400, 1000], for: "PT45S" }, metrics, words)).toBe("co2 outside [400, 1000] 45초");
    expect(summarize({ kind: "rateOfChange", metric: "x", window: "PT10M", delta: 2, direction: "DOWN" }, metrics, words)).toBe("x 변화율 -2 / 10분");
    expect(summarize({ kind: "rateOfChange", metric: "x", window: "PT10M", delta: 2, direction: "ANY" }, metrics, words)).toContain("±2");
    expect(summarize({ kind: "anomaly", minScore: 3 }, metrics, words)).toBe("이상 점수 ≥ 3");
    expect(summarize(null, metrics, words)).toBe("");
  });

  it("첫 임계값(시뮬레이션 비교 열의 기준 값)", () => {
    expect(firstThreshold({ kind: "group", op: "AND", items: [{ kind: "noData", window: "PT1M" }, { kind: "group", op: "OR", items: [co2] }] })?.value).toBe(1000);
    expect(firstThreshold({ kind: "noData", window: "PT1M" })).toBeUndefined();
    expect(firstThreshold(null)).toBeUndefined();
  });
});
