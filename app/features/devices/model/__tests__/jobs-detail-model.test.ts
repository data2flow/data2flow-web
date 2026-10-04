/**
 * UI-DEV-12 일괄 작업 모델(BR-DEV-20)과 UI-DEV-06 상세 M4 모델(규칙 경유·알람 거름·명령 띠·온보딩 바로가기, DEV-02.07·09.01).
 */
import { describe, expect, it } from "vitest";
import type { Command } from "~/features/control/model/control";
import { actorName, alarmsForDevice, changeLines, commandBands, onboardingLink, rulesForDevice, severityTone } from "../detail";
import { creatorName, emptyJobForm, isRunning, jobParams, jobPercent, jobProblems, jobTone, parseDeviceIds, splitTags } from "../jobs";

describe("BR-DEV-20 일괄 작업 모델", () => {
  it("대상 1~5,000대, 유형별 필수 값과 params", () => {
    const form = emptyJobForm();
    expect(jobProblems(form, 0)).toEqual(["targetEmpty", "spaceId"]);
    expect(jobProblems({ ...form, spaceId: "31" }, 5001)).toEqual(["targetLimit"]);
    expect(jobProblems({ ...form, type: "SET_MODEL" }, 1)).toEqual(["modelId"]);
    expect(jobProblems({ ...form, type: "ADD_TAGS", tags: " , " }, 1)).toEqual(["tags"]);
    expect(jobProblems({ ...form, type: "SET_ATTRIBUTES", attributes: "{}" }, 1)).toEqual(["attributes"]);
    expect(jobProblems({ ...form, type: "SEND_COMMAND", capability: "", args: "[]" }, 1)).toEqual(["command", "args"]);
    expect(jobProblems({ ...form, type: "SET_STATUS" }, 1)).toEqual([]);
    expect(jobParams({ ...form, type: "SET_MODEL", modelId: "11" })).toEqual({ modelId: "11" });
    expect(jobParams({ ...form, type: "SET_STATUS", status: "ACTIVE" })).toEqual({ status: "ACTIVE" });
    expect(jobParams({ ...form, type: "REMOVE_TAGS", tags: "a, b" })).toEqual({ tags: ["a", "b"] });
    expect(jobParams({ ...form, type: "SET_ATTRIBUTES", attrScope: "SHARED", attributes: '{"maxTemp":28}' })).toEqual({ scope: "SHARED", attributes: { maxTemp: 28 } });
    expect(jobParams({ ...form, type: "SEND_COMMAND", capability: " Switch ", command: "set", args: '{"on":true}' })).toEqual({ capability: "Switch", command: "set", args: { on: true } });
    expect(jobParams({ ...form, type: "SET_ATTRIBUTES", attributes: "x" })).toEqual({ scope: "SERVER", attributes: {} });
    expect(splitTags("a,,b ")).toEqual(["a", "b"]);
  });

  it("진행률·상태 색·시작자·deviceIds 쿼리", () => {
    expect(jobPercent({ total: 50, succeeded: 48, failed: 2, progressPercent: null })).toBe(100);
    expect(jobPercent({ total: 0, succeeded: 0, failed: 0 })).toBe(0);
    expect(jobPercent({ total: 4, succeeded: 1, failed: 0, progressPercent: 150 })).toBe(100);
    expect(["COMPLETED", "PARTIALLY_FAILED", "FAILED", "RUNNING", "CANCELLED"].map(jobTone)).toEqual(["success", "warning", "danger", "info", "neutral"]);
    expect(isRunning("QUEUED")).toBe(true);
    expect(creatorName(null)).toBe("–");
    expect(creatorName("8")).toBe("8");
    expect(creatorName({ userId: "8" })).toBe("8");
    expect(parseDeviceIds(" 1042, 2001,1042,")).toEqual(["1042", "2001"]);
    expect(parseDeviceIds(null)).toEqual([]);
  });
});

const SPACES = [{ id: "1", name: "캠퍼스", type: "SITE", children: [{ id: "3", name: "3층", type: "FLOOR", children: [{ id: "31", name: "실습실", type: "ROOM", children: [] }] }] }] as never;
const DEVICE = { id: "1042", space: { id: "31" }, model: { id: "12" }, tags: ["Pilot"] };

describe("DEV-02.07 규칙·알람 모델", () => {
  it("직접·공간(하위 포함)·모델·태그 경유, 하위 포함이 아니면 그 공간만", () => {
    const rule = (ruleId: string, type: string, ids: string[], includeChildren?: boolean) => ({ ruleId, name: ruleId, status: "ACTIVE", severity: "MAJOR", scope: { type, ids, includeChildren } });
    const result = rulesForDevice(
      [
        rule("d", "DEVICE", ["1042"]),
        rule("s", "SPACE", ["3"]),
        rule("s2", "SPACE", ["3"], false),
        rule("m", "MODEL", ["12"]),
        rule("t", "TAG", ["pilot"]),
        rule("x", "DEVICE", ["1"]),
        rule("y", "GROUP", ["g"]),
      ],
      DEVICE,
      SPACES,
    );
    expect(result.map((r) => `${r.rule.ruleId}:${r.via}`)).toEqual(["d:DEVICE", "s:SPACE", "m:MODEL", "t:TAG"]);
    expect(rulesForDevice([rule("s", "SPACE", ["31"])], { ...DEVICE, model: null, tags: undefined }, SPACES)).toHaveLength(1);
    expect(rulesForDevice([rule("s", "SPACE", ["31"])], { id: "1", space: null }, SPACES)).toHaveLength(0);
  });

  it("이 기기의 열린 알람만, 심각도 색, 이력 문구", () => {
    const alarms = [
      { id: "1", severity: "MAJOR", status: "ACTIVE", title: "a", raisedAt: "", device: { id: "1042" } },
      { id: "2", severity: "MAJOR", status: "CLEARED", title: "b", raisedAt: "", device: { id: "1042" } },
      { id: "3", severity: "MAJOR", status: "ACTIVE", title: "c", raisedAt: "", device: null },
    ];
    expect(alarmsForDevice(alarms, "1042").map((a) => a.id)).toEqual(["1"]);
    expect(["CRITICAL", "MINOR", "INFO", "X"].map(severityTone)).toEqual(["danger", "warning", "info", "neutral"]);
    expect(actorName(null)).toBe("–");
    expect(actorName({ type: "SYSTEM" })).toBe("SYSTEM");
    expect(changeLines({ name: ["a", "b"], extra: [undefined, { x: 1 }] })).toEqual(["name: a → b", 'extra: – → {"x":1}']);
    expect(changeLines(null)).toEqual([]);
  });

  it("명령 띠: 같은 기능의 다음 적용까지, 끄는 명령(on=false·mode=off·level=0)은 띠를 만들지 않고, 마지막은 조회 끝까지", () => {
    const cmd = (id: string, capability: string, args: Record<string, unknown>, at: string, status = "APPLIED"): Command => ({
      id,
      status,
      deviceId: "2001",
      capability,
      command: "set",
      args,
      timeline: [{ status: "REQUESTED", at }],
    });
    const bands = commandBands(
      [
        cmd("b", "Switch", { on: true }, "2026-10-03T02:00:00Z"),
        cmd("a", "Thermostat", { mode: "cool" }, "2026-10-03T01:00:00Z"),
        cmd("c", "Switch", { on: false }, "2026-10-03T04:00:00Z"),
        cmd("d", "Dimmer", { level: 0 }, "2026-10-03T05:00:00Z"),
        cmd("e", "Thermostat", { mode: "heat" }, "2026-10-03T06:00:00Z", "FAILED"),
        { id: "f", status: "APPLIED", deviceId: "1", capability: "X", command: "set" },
      ],
      "2026-10-04T00:00:00Z",
    );
    expect(bands).toEqual([
      { id: "cmd-a", timeFrom: "2026-10-03T01:00:00Z", timeTo: "2026-10-04T00:00:00Z", type: "COMMAND", title: "Thermostat.set(cool)" },
      { id: "cmd-b", timeFrom: "2026-10-03T02:00:00Z", timeTo: "2026-10-03T04:00:00Z", type: "COMMAND", title: "Switch.set(true)" },
    ]);
  });

  it("DEV-09.01 온보딩 바로가기는 권한이 있을 때만", () => {
    const d = { id: "1042", source: { id: "7" }, space: { id: "31" } };
    expect(onboardingLink("model", d, ["DEV_PLACE"])).toBe("?edit=1");
    expect(onboardingLink("space", d, [])).toBeUndefined();
    expect(onboardingLink("firstData", d, ["SRC_READ"])).toBe("/sources/7");
    expect(onboardingLink("decodeOk", { ...d, source: null }, ["SRC_READ"])).toBeUndefined();
    expect(onboardingLink("rulesApplied", d, ["RULE_WRITE"])).toBe("/rules/new?deviceId=1042&spaceId=31");
    expect(onboardingLink("rulesApplied", { ...d, space: null }, ["RULE_WRITE"])).toBe("/rules/new?deviceId=1042");
    expect(onboardingLink("rulesApplied", d)).toBeUndefined();
    expect(onboardingLink("other", d, ["DEV_PLACE"])).toBeUndefined();
  });
});
