/** UI-RUL-06 알림 정책 폼 모델(RUL-03.02·03.03·03.06, BR-RUL-12·13·15·16) */
import { describe, expect, it } from "vitest";
import { checkPolicy, decodeRecipient, emptyPolicy, encodeRecipient, normalizePolicy, normalizePolicyRow, parsePolicyForm, policyBody, serverPolicyErrors, uniqueRecipients } from "../policy";
import { idOf, rowsOf } from "../types";

function form(entries: [string, string][]) {
  const f = new FormData();
  for (const [k, v] of entries) f.append(k, v);
  return f;
}

const valid: [string, string][] = [
  ["name", "시설팀 기본"],
  ["minSeverity", "MAJOR"],
  ["spaceId", "2"],
  ["includeChildren", "on"],
  ["ruleIds", "r-1"],
  ["ruleIds", "r-1"],
  ["timeMode", "WINDOW"],
  ["days", "5"],
  ["days", "1"],
  ["days", "9"],
  ["from", "09:00"],
  ["to", "18:00"],
  ["recipient", "ROLE:OPERATOR"],
  ["recipient", "ON_CALL:"],
  ["recipient", "ROLE:OPERATOR"],
  ["recipient", "BOGUS:1"],
  ["channel", "WEB"],
  ["channel", "TELEGRAM"],
  ["template_TELEGRAM", "tpl-9"],
  ["renotifyMinutes", "30"],
  ["aggregateWindowSec", "120"],
  ["notifyOnClear", "on"],
  ["steps", JSON.stringify([{ waitMinutes: 10, recipients: ["USER:7", { type: "ROLE", id: "ADMIN" }] }])],
];

describe("RUL-03.02 알림 정책 폼", () => {
  it("TC-RUL-071 폼 → 본문: 심각도·공간(하위 포함)·시간대·수신자(당직자 포함, 중복 제거)·채널별 템플릿·묶기·에스컬레이션", () => {
    const { input, stepsInvalid } = parsePolicyForm(form(valid));
    expect(stepsInvalid).toBe(false);
    expect(checkPolicy(input)).toEqual({});
    const body = policyBody(input, 3);
    expect(body).toEqual({
      name: "시설팀 기본",
      minSeverity: "MAJOR",
      spaceId: "2",
      includeChildren: true,
      ruleIds: ["r-1"],
      timeWindow: { days: [1, 5], from: "09:00", to: "18:00" },
      recipients: [
        { type: "ROLE", id: "OPERATOR" },
        { type: "ON_CALL", id: null },
      ],
      channels: ["WEB", "TELEGRAM"],
      templates: { TELEGRAM: "tpl-9" },
      renotifyMinutes: 30,
      aggregateWindowSec: 120,
      notifyOnClear: true,
      steps: [
        {
          stepNo: 1,
          waitMinutes: 10,
          recipients: [
            { type: "USER", id: "7" },
            { type: "ROLE", id: "ADMIN" },
          ],
        },
      ],
      baseVersion: 3,
    });
    expect(policyBody({ ...input, spaceId: null, includeChildren: false })).not.toHaveProperty("baseVersion");
    expect(policyBody({ ...input, spaceId: null, includeChildren: false }).includeChildren).toBe(true);
  });

  it("필수·범위 검증: 이름 1~100자, 수신자 1명 이상, 채널, 재알림 10분~24시간, 묶기 끔 또는 1~10분, 시간대", () => {
    const { input } = parsePolicyForm(form([["timeMode", "WINDOW"]]));
    expect(checkPolicy(input)).toMatchObject({ name: "nameRequired", minSeverity: "severityRequired", recipients: "recipientsRequired", channels: "channelsRequired", timeWindow: "daysRequired" });
    const base = parsePolicyForm(form(valid)).input;
    expect(checkPolicy({ ...base, name: "가".repeat(101) }).name).toBe("nameTooLong");
    expect(checkPolicy({ ...base, renotifyMinutes: 5 }).renotifyMinutes).toBe("renotifyRange");
    expect(checkPolicy({ ...base, renotifyMinutes: 1441 }).renotifyMinutes).toBe("renotifyRange");
    expect(checkPolicy({ ...base, aggregateWindowSec: 30 }).aggregateWindowSec).toBe("aggregateRange");
    expect(checkPolicy({ ...base, aggregateWindowSec: 0 }).aggregateWindowSec).toBeUndefined();
    expect(checkPolicy({ ...base, timeWindow: { days: [1], from: "9:00", to: "18:00" } }).timeWindow).toBe("timeFormat");
    expect(checkPolicy({ ...base, timeWindow: { days: [1], from: "09:00", to: "09:00" } }).timeWindow).toBe("timeSame");
  });

  it("TC-RUL-077 에스컬레이션은 최대 3단계, 대기 1~1440분, 단계마다 수신자", () => {
    const base = parsePolicyForm(form(valid)).input;
    const step = { stepNo: 1, waitMinutes: 10, recipients: [{ type: "ON_CALL" as const }] };
    expect(checkPolicy({ ...base, steps: [step, step, step] }).steps).toBeUndefined();
    expect(checkPolicy({ ...base, steps: [step, step, step, step] }).steps).toBe("stepsTooMany");
    expect(checkPolicy({ ...base, steps: [{ ...step, waitMinutes: 0 }] }).steps).toBe("stepWaitRange");
    expect(checkPolicy({ ...base, steps: [{ ...step, recipients: [] }] }).steps).toBe("stepRecipientsRequired");
    const broken = parsePolicyForm(form([...valid.filter(([k]) => k !== "steps"), ["steps", "{nope"]]));
    expect(broken.stepsInvalid).toBe(true);
    expect(checkPolicy(broken.input, broken.stepsInvalid).steps).toBe("stepsInvalid");
    expect(parsePolicyForm(form([["steps", '{"a":1}']])).stepsInvalid).toBe(true);
    expect(parsePolicyForm(form([["steps", ""]])).input.steps).toEqual([]);
  });

  it("수신자 인코딩: 사용자·역할은 ID 필수, 당직자는 ID 없음, core가 받지 않는 CHANNEL_DEFAULT는 버린다", () => {
    expect(decodeRecipient("USER:7")).toEqual({ type: "USER", id: "7" });
    expect(decodeRecipient("USER:")).toBeUndefined();
    expect(decodeRecipient("ON_CALL")).toEqual({ type: "ON_CALL" });
    expect(decodeRecipient("CHANNEL_DEFAULT:x")).toBeUndefined();
    expect(decodeRecipient("WEBHOOK:1")).toBeUndefined();
    expect(encodeRecipient({ type: "ON_CALL" })).toBe("ON_CALL:");
    expect(uniqueRecipients([{ type: "ON_CALL" }, { type: "ON_CALL", id: null }])).toHaveLength(1);
  });

  it("TC-RUL-071 서버 CHANNEL_NOT_CONFIGURED(409)와 검증 오류를 필드 오류로", () => {
    expect(serverPolicyErrors({ code: "CHANNEL_NOT_CONFIGURED" })).toEqual({ channels: "channelNotConfigured" });
    expect(serverPolicyErrors({ code: "INVALID_REQUEST", errors: [{ field: "steps[0].waitMinutes", code: "RANGE" }, { field: "channels[1]", code: "CHANNEL_NOT_CONFIGURED" }, { field: "other", code: "X" }] })).toEqual({ steps: "serverInvalid", channels: "channelNotConfigured" });
  });

  it("서버 응답을 화면 모델로(ID 문자열, 단계 순서, 빠진 값 기본값)", () => {
    const policy = normalizePolicy({ notificationPolicyId: 5, name: "A", minSeverity: "CRITICAL", spaceId: 31, includeChildren: false, ruleIds: [1], timeWindow: { days: [1], from: "09:00", to: "18:00" }, recipients: [{ type: "USER", id: 7, name: "김운영" }, { type: "X" }], channels: ["TELEGRAM"], templates: { TELEGRAM: "t" }, renotifyMinutes: 60, aggregateWindowSec: 60, notifyOnClear: false, steps: [{ stepNo: 2, waitMinutes: 20, recipients: [] }, { stepNo: 1, waitMinutes: 10, recipients: [{ type: "ON_CALL" }] }], version: 4 });
    expect(policy).toMatchObject({ notificationPolicyId: "5", spaceId: "31", includeChildren: false, ruleIds: ["1"], recipients: [{ type: "USER", id: "7", name: "김운영" }], notifyOnClear: false, version: 4 });
    expect(policy.steps.map((s) => s.stepNo)).toEqual([1, 2]);
    const empty = normalizePolicy({ id: "9", minSeverity: "NOPE" });
    expect(empty).toMatchObject({ notificationPolicyId: "9", minSeverity: "MAJOR", spaceId: null, timeWindow: null, recipients: [], channels: [], renotifyMinutes: 30, steps: [] });
    expect(emptyPolicy().channels).toEqual(["WEB"]);
    expect(normalizePolicyRow({ notificationPolicyId: 1, name: "A", spaceId: 2, channels: ["WEB"], recipientCount: 2, stepCount: 1 })).toMatchObject({ notificationPolicyId: "1", spaceId: "2", recipientCount: 2 });
    expect(normalizePolicyRow({ id: 1 })).toMatchObject({ notificationPolicyId: "1", name: "", spaceId: null, channels: [], recipientCount: 0, minSeverity: "MAJOR" });
  });

  it("공용 도우미: idOf·rowsOf", () => {
    expect(idOf({ id: 3 })).toBe("3");
    expect(idOf({ fooId: "a", id: "b" }, "fooId")).toBe("a");
    expect(idOf({})).toBe("");
    expect(rowsOf([1])).toEqual([1]);
    expect(rowsOf({ responses: [2] })).toEqual([2]);
    expect(rowsOf(null)).toEqual([]);
  });
});
