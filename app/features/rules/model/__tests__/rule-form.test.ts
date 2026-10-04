/**
 * 규칙 폼 모델(UI-RUL-02, RUL-01.09·01.10, BR-RUL-21) — 템플릿 적용, 본문 만들기, 검사, 현재 대상 수 추정, 서버 오류 → 필드.
 */
import { describe, expect, it } from "vitest";
import type { SpaceNode } from "~/lib/spaces";
import { applyTemplate, emptyForm, estimateTargets, formFromRule, hasProblems, serverFieldProblems, sortRules, timePayload, toPayload, validateForm } from "../rule-form";
import type { RuleRow, RuleTemplate, ScopeDevice } from "../types";

const spaces: SpaceNode[] = [{ id: "2", name: "본관", type: "BUILDING", children: [{ id: "3", name: "3층", type: "FLOOR", children: [{ id: "31", name: "실습실", type: "ROOM" }, { id: "32", name: "사무실", type: "ROOM" }] }] }] as SpaceNode[];
const devices: ScopeDevice[] = [
  { id: "1042", name: "AM107", spaceId: "31", modelCode: "AM107", tags: ["pilot"], metrics: ["co2", "temperature"] },
  { id: "1043", name: "EM300", spaceId: "31", modelCode: "EM300-TH", tags: [], metrics: ["temperature"] },
  { id: "1044", name: "AM107-2", spaceId: "32", modelCode: "AM107", tags: ["pilot"], metrics: ["co2"] },
];
const template: RuleTemplate = { key: "high-co2", name: "고CO2", defaults: { condition: { kind: "threshold", metric: "co2", op: ">", value: 1000, for: "PT5M", clear: 900 }, severity: "MAJOR", titleTemplate: "고CO2 · {{space.path}}" } };

describe("RUL-01.10 템플릿·RUL-01.09 범위", () => {
  it("템플릿을 고르면 조건·심각도·제목을 채우고 이름이 비면 템플릿 이름", () => {
    const form = applyTemplate(emptyForm(), template);
    expect(form).toMatchObject({ templateKey: "high-co2", name: "고CO2", severity: "MAJOR", titleTemplate: "고CO2 · {{space.path}}" });
    expect(applyTemplate({ ...form, name: "내 규칙" }, template).name).toBe("내 규칙");
    expect(applyTemplate(form, undefined).templateKey).toBe("");
  });

  it("현재 대상 수: 공간(하위 포함)·기기·모델·태그, 조건 측정 항목을 내는 기기만", () => {
    const form = applyTemplate(emptyForm(), template);
    expect(estimateTargets({ ...form, scopeType: "SPACE", scopeIds: ["2"], includeChildren: true }, devices, spaces)).toBe(2);
    expect(estimateTargets({ ...form, scopeType: "SPACE", scopeIds: ["2"], includeChildren: false }, devices, spaces)).toBe(0);
    expect(estimateTargets({ ...form, scopeType: "MODEL", scopeIds: ["AM107"] }, devices, spaces)).toBe(2);
    expect(estimateTargets({ ...form, scopeType: "TAG", scopeIds: ["pilot"] }, devices, spaces)).toBe(2);
    expect(estimateTargets({ ...form, scopeType: "DEVICE", scopeIds: ["1043", "9999"] }, devices, spaces)).toBe(1);
    expect(estimateTargets({ ...form, scopeType: "DEVICE", scopeIds: ["9999"] }, devices, spaces)).toBe(1);
    expect(estimateTargets({ ...form, scopeIds: [] }, devices, spaces)).toBe(0);
  });
});

describe("UI-RUL-02 저장 본문과 검사", () => {
  it("본문: 공간이 아니면 includeChildren=false, 시간 조건은 켰을 때만, 수정은 baseVersion", () => {
    const form = { ...applyTemplate(emptyForm(), template), scopeType: "DEVICE" as const, scopeIds: ["1042"], policyId: "p-1" };
    const body = toPayload(form, 3);
    expect(body).toMatchObject({ name: "고CO2", templateKey: "high-co2", scope: { type: "DEVICE", ids: ["1042"], includeChildren: false }, condition: { kind: "threshold", metric: "co2", value: 1000, clear: 900 }, timeCondition: null, policyId: "p-1", baseVersion: 3 });
    expect(timePayload({ ...form, timeEnabled: true, time: { days: [5, 1], from: "09:00", to: "18:00", spaceSchedule: "OUTSIDE" } })).toEqual({ days: [1, 5], from: "09:00", to: "18:00", spaceSchedule: "OUTSIDE" });
    expect(toPayload(emptyForm()).templateKey).toBeUndefined();
  });

  it("이름·범위·제목·대상 5,000대·시간 형식", () => {
    const empty = validateForm(emptyForm(), [], 0);
    expect(empty.fields).toMatchObject({ name: { key: "rules.v.nameRequired" }, scope: { key: "rules.v.scopeRequired" }, titleTemplate: { key: "rules.v.titleRequired" } });
    expect(hasProblems(empty)).toBe(true);
    const long = validateForm({ ...emptyForm(), name: "x".repeat(101), titleTemplate: "y".repeat(201), scopeIds: ["2"] }, [], 5001);
    expect(long.fields).toMatchObject({ name: { key: "rules.v.nameLength" }, titleTemplate: { key: "rules.v.titleLength" }, scope: { key: "rules.v.targetLimit", params: { n: 5000 } } });
    const time = validateForm({ ...emptyForm(), timeEnabled: true, time: { days: [], from: "9:00", to: "", spaceSchedule: null } }, [], 1);
    expect(time.fields.time?.key).toBe("rules.v.timeFormat");
    const noDays = validateForm({ ...emptyForm(), timeEnabled: true, time: { days: [], from: "", to: "", spaceSchedule: null } }, [], 1);
    expect(noDays.fields.time?.key).toBe("rules.v.daysRequired");
    const ok = validateForm({ ...applyTemplate(emptyForm(), template), scopeIds: ["2"] }, [{ key: "co2", validMin: 0, validMax: 10000 }], 9);
    expect(hasProblems(ok)).toBe(false);
  });

  it("받은 규칙·복제 → 폼(이름 뒤 접미사), 서버 검증 오류 → 필드", () => {
    const form = formFromRule({ name: "본관 고CO2", scope: { type: "SPACE", ids: ["2"], includeChildren: true }, condition: template.defaults.condition, timeCondition: { days: [1], from: "09:00", to: "18:00" }, severity: "MINOR", titleTemplate: "t", autoClear: false, policyId: "7" }, { copySuffix: " (2)" });
    expect(form).toMatchObject({ name: "본관 고CO2 (2)", scopeIds: ["2"], timeEnabled: true, severity: "MINOR", autoClear: false, policyId: "7" });
    expect(formFromRule({}).name).toBe("");
    expect(serverFieldProblems([{ field: "scope.ids", code: "INVALID_REQUEST" }, { field: "condition.items[0].value", code: "RULE_CONDITION_INVALID", message: "bad" }, { field: "timeCondition.from", code: "INVALID_REQUEST" }, { field: "name", code: "RULE_NAME_DUPLICATED" }])).toEqual({
      scope: { key: "errors.INVALID_REQUEST", params: { message: "" } },
      condition: { key: "errors.RULE_CONDITION_INVALID", params: { message: "bad" } },
      time: { key: "errors.INVALID_REQUEST", params: { message: "" } },
      name: { key: "errors.RULE_NAME_DUPLICATED", params: { message: "" } },
    });
    expect(serverFieldProblems(undefined)).toEqual({});
  });

  it("TC-RUL-106 목록 정렬: ERROR 먼저, 그다음 수정 시각 내림차순", () => {
    const row = (ruleId: string, status: RuleRow["status"], updatedAt: string) => ({ ruleId, name: ruleId, status, scope: { type: "SPACE" as const, ids: [], includeChildren: true }, severity: "MAJOR" as const, updatedAt });
    expect(sortRules([row("a", "ACTIVE", "2026-10-03T00:00:00Z"), row("b", "ERROR", "2026-09-01T00:00:00Z"), row("c", "INACTIVE", "2026-10-04T00:00:00Z")]).map((r) => r.ruleId)).toEqual(["b", "c", "a"]);
  });
});
