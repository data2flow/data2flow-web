/** 템플릿(RUL-05.01)·당직(RUL-05.03)·유지보수(OPS-05.01)·개인 설정(OPS-06.05, RUL-05.04)·채널 스키마(OPS-06.06) 모델 */
import { describe, expect, it } from "vitest";
import { TELEGRAM_FALLBACK_SCHEMA, checkCommon, fieldDefault, parseChannelForm, schemaFields, targetCount } from "../channel-schema";
import { checkMaintenance, maintenanceActions, maintenanceBody, normalizeMaintenance, statusesOf, tabOf } from "../maintenance";
import { checkOverride, checkShifts, normalizeCurrent, normalizeSchedule, parseShifts, shiftGrid } from "../oncall";
import { checkDnd, dndBody, formatCountdown, inDnd, isSeverity, safeDeepLink, secondsLeft } from "../prefs";
import { DEFAULT_VARIABLES, checkTemplate, insertVariable, normalizeTemplate, normalizeVariables, unknownVariables, variablesIn, warningNames } from "../template";

describe("RUL-05.01 알림 템플릿", () => {
  it("TC-RUL-091 AT-RUL-08.3 알 수 없는 변수 {{foo}}를 찾는다", () => {
    const body = "[{{alarm.severity}}] {{ alarm.title }} {{foo}} {{foo}} {{link}}";
    expect(variablesIn(body)).toEqual(["alarm.severity", "alarm.title", "foo", "link"]);
    expect(unknownVariables(body, DEFAULT_VARIABLES)).toEqual(["foo"]);
    expect(warningNames({ warnings: [{ code: "TEMPLATE_VARIABLE_UNKNOWN", name: "foo" }, { code: "OTHER", name: "x" }] })).toEqual(["foo"]);
    expect(warningNames(null)).toEqual([]);
  });

  it("텔레그램 4,096자, 제목 200자, 본문 필수", () => {
    expect(checkTemplate({ subject: "", body: "a".repeat(4096) }, 4096)).toBeUndefined();
    expect(checkTemplate({ subject: "", body: "a".repeat(4097) }, 4096)).toBe("bodyTooLong");
    expect(checkTemplate({ subject: "", body: "  " }, 4096)).toBe("bodyRequired");
    expect(checkTemplate({ subject: "a".repeat(201), body: "x" }, 4096)).toBe("subjectTooLong");
  });

  it("커서 위치에 변수 넣기, 응답 정규화", () => {
    expect(insertVariable("ab", 1, 1, "value")).toEqual({ text: "a{{value}}b", cursor: 10 });
    expect(insertVariable("abc", 5, 9, "x").text).toBe("abc{{x}}");
    expect(normalizeTemplate({ id: 3, templateKey: "alarm.raised", channel: "TELEGRAM", locale: "ko", subject: null, body: "b", builtin: true, version: 2 })).toMatchObject({ notificationTemplateId: "3", subject: null, builtin: true });
    expect(normalizeTemplate({})).toMatchObject({ locale: "ko", body: "", builtin: false, version: 0 });
    expect(normalizeVariables(["a", { name: "b", description: "B" }, { name: "" }])).toEqual([{ name: "a" }, { name: "b", description: "B" }]);
    expect(normalizeVariables(null).map((v) => v.name)).toEqual(DEFAULT_VARIABLES);
  });
});

describe("RUL-05.03 당직 일정", () => {
  const shifts = [
    { dayOfWeek: 1, from: "09:00", to: "18:00", userId: "7", userName: "김운영" },
    { dayOfWeek: 1, from: "18:00", to: "09:00", userId: "8" },
    { dayOfWeek: 2, from: "09:00", to: "18:00", userId: "8" },
  ];

  it("주간 달력: 시간대 행 × 요일 열", () => {
    const grid = shiftGrid(shifts);
    expect(grid.bands.map((b) => `${b.from}-${b.to}`)).toEqual(["09:00-18:00", "18:00-09:00"]);
    expect(grid.bands[0].cells[2]?.userId).toBe("8");
    expect(grid.bands[1].cells[3]).toBeUndefined();
  });

  it("근무표 검증: 요일·시각 형식·같은 시각·담당자·겹침(자정 넘김 포함)", () => {
    expect(checkShifts(shifts)).toBeUndefined();
    expect(checkShifts([{ ...shifts[0], dayOfWeek: 8 }])?.code).toBe("dayInvalid");
    expect(checkShifts([{ ...shifts[0], from: "9" }])?.code).toBe("timeFormat");
    expect(checkShifts([{ ...shifts[0], to: "09:00" }])?.code).toBe("timeSame");
    expect(checkShifts([{ ...shifts[0], userId: "" }])?.code).toBe("userRequired");
    expect(checkShifts([...shifts, { dayOfWeek: 2, from: "08:00", to: "10:00", userId: "9" }])).toEqual({ index: 3, code: "overlap" });
    expect(checkShifts([{ dayOfWeek: 7, from: "18:00", to: "00:00", userId: "1" }, { dayOfWeek: 1, from: "00:00", to: "09:00", userId: "2" }])).toBeUndefined();
  });

  it("대체 근무 검증과 근무표 JSON", () => {
    expect(checkOverride({ startsAt: "2026-10-03T09:00:00Z", endsAt: "2026-10-04T00:00:00Z", substituteUserId: "9", originalUserId: "8" })).toBeUndefined();
    expect(checkOverride({ startsAt: "2026-10-03T09:00:00Z", endsAt: "2026-10-03T09:00:00Z", substituteUserId: "9" })).toBe("rangeInvalid");
    expect(checkOverride({ startsAt: "2026-10-03T09:00:00Z", endsAt: "2026-10-04T00:00:00Z" })).toBe("substituteRequired");
    expect(checkOverride({ startsAt: "2026-10-03T09:00:00Z", endsAt: "2026-10-04T00:00:00Z", substituteUserId: "9", originalUserId: "9" })).toBe("sameUser");
    expect(parseShifts('[{"dayOfWeek":"1","from":"09:00","to":"18:00","userId":" 7 "}]')).toEqual([{ dayOfWeek: 1, from: "09:00", to: "18:00", userId: "7" }]);
    expect(parseShifts("{")).toBeUndefined();
    expect(parseShifts('{"a":1}')).toBeUndefined();
    expect(parseShifts("")).toEqual([]);
  });

  it("응답 정규화", () => {
    const s = normalizeSchedule({ name: "시설팀", timezone: "Asia/Seoul", shifts: [{ dayOfWeek: 1, from: "09:00", to: "18:00", userId: 7, name: "김" }], overrides: [{ id: 3, startsAt: "a", endsAt: "b", originalUserId: 8, substituteUserId: 9 }], version: 2 });
    expect(s.shifts[0]).toMatchObject({ userId: "7", userName: "김" });
    expect(s.overrides[0]).toMatchObject({ overrideId: "3", originalUserId: "8", substituteUserId: "9" });
    expect(normalizeSchedule(null)).toEqual({ name: "", timezone: "Asia/Seoul", shifts: [], overrides: [], version: 0 });
    expect(normalizeSchedule({ overrides: [{ overrideId: 1 }] }).overrides[0]).toMatchObject({ originalUserId: null, substituteUserId: "", startsAt: "" });
    expect(normalizeCurrent({ userId: 8, name: "이통합", until: "2026-10-04T09:00:00Z" })).toEqual({ userId: "8", name: "이통합", until: "2026-10-04T09:00:00Z" });
    expect(normalizeCurrent(null)).toEqual({ userId: null, name: null, until: null });
  });
});

describe("OPS-05.01 유지보수 일정", () => {
  const now = Date.parse("2026-10-04T00:00:00Z");
  const base = { targetType: "SPACE", targetId: "31", startsAt: null, endsAt: "2026-10-04T09:00:00Z", pauseAutomation: true, excludeFromAnalytics: true, reason: "에어컨 필터 교체" };

  it("TC-OPS-052 종료 ≤ 시작, 30일 초과, 사유 1~200자, 대상 필수", () => {
    expect(checkMaintenance(base, now)).toEqual({});
    expect(checkMaintenance({ ...base, endsAt: null }, now)).toEqual({});
    expect(checkMaintenance({ ...base, endsAt: "2026-10-03T00:00:00Z" }, now).range).toBe("endBeforeStart");
    expect(checkMaintenance({ ...base, startsAt: "2026-10-04T00:00:00Z", endsAt: "2026-11-04T00:00:01Z" }, now).range).toBe("tooLong");
    expect(checkMaintenance({ ...base, startsAt: "x" }, now).range).toBe("rangeInvalid");
    expect(checkMaintenance({ ...base, reason: " " }, now).reason).toBe("reasonRequired");
    expect(checkMaintenance({ ...base, reason: "a".repeat(201) }, now).reason).toBe("reasonTooLong");
    expect(checkMaintenance({ ...base, targetId: "" }, now).target).toBe("targetRequired");
  });

  it("OPS-05.02 자동 제어 멈춤 기본 켬, 본문·탭·동작", () => {
    expect(maintenanceBody({ ...base, reason: " 교체 " })).toEqual({ targetType: "SPACE", targetId: "31", endsAt: "2026-10-04T09:00:00Z", pauseAutomation: true, excludeFromAnalytics: true, reason: "교체" });
    expect(maintenanceBody({ ...base, startsAt: "2026-10-05T00:00:00Z" })).toHaveProperty("startsAt");
    expect(statusesOf("active")).toEqual(["ACTIVE"]);
    expect(statusesOf("scheduled")).toEqual(["SCHEDULED"]);
    expect(statusesOf("past")).toEqual(["ENDED", "CANCELED"]);
    expect(tabOf("past")).toBe("past");
    expect(tabOf("x")).toBe("active");
    expect(maintenanceActions("ACTIVE")).toEqual(["end"]);
    expect(maintenanceActions("SCHEDULED")).toEqual(["cancel"]);
    expect(maintenanceActions("ENDED")).toEqual([]);
    expect(normalizeMaintenance({ id: 1, targetType: "DEVICE", targetId: 5, status: "ACTIVE", pauseAutomation: false, createdBy: { userId: 7, name: "김" } })).toMatchObject({ id: "1", targetType: "DEVICE", targetId: "5", pauseAutomation: false, excludeFromAnalytics: true, createdBy: { userId: "7", name: "김" } });
    expect(normalizeMaintenance({})).toMatchObject({ targetType: "SPACE", status: "SCHEDULED", createdBy: null, startsAt: null, version: undefined });
  });
});

describe("OPS-06.05 사용자별 수신 설정 · RUL-05.04 방해 금지", () => {
  it("TC-OPS-070 AT-OPS-13.2 방해 금지 22~07시(자정 넘김)와 CRITICAL 예외", () => {
    const input = { enabled: true, dndFrom: "22:00", dndTo: "07:00", dndAllowCritical: true, locale: "ko" };
    expect(checkDnd(input)).toBeUndefined();
    expect(dndBody(input)).toEqual({ dndFrom: "22:00", dndTo: "07:00", dndAllowCritical: true, locale: "ko" });
    expect(dndBody({ ...input, enabled: false })).toEqual({ dndFrom: null, dndTo: null, dndAllowCritical: true, locale: "ko" });
    expect(checkDnd({ ...input, dndTo: "7:00" })).toBe("timeFormat");
    expect(checkDnd({ ...input, dndTo: "22:00" })).toBe("timeSame");
    expect(checkDnd({ ...input, locale: "fr" })).toBe("localeInvalid");
    expect(checkDnd({ ...input, enabled: false, dndTo: "" })).toBeUndefined();
    expect(inDnd("23:00", "22:00", "07:00")).toBe(true);
    expect(inDnd("12:00", "22:00", "07:00")).toBe(false);
    expect(inDnd("13:00", "12:00", "14:00")).toBe(true);
    expect(inDnd("13:00", null, "14:00")).toBe(false);
    expect(isSeverity("MAJOR")).toBe(true);
    expect(isSeverity("major")).toBe(false);
  });

  it("RUL-05.02 일회용 코드 남은 시간과 텔레그램 딥링크만 허용", () => {
    const now = Date.parse("2026-10-04T00:00:00Z");
    expect(secondsLeft("2026-10-04T00:10:00Z", now)).toBe(600);
    expect(secondsLeft("2026-10-03T00:10:00Z", now)).toBe(0);
    expect(secondsLeft(undefined, now)).toBe(0);
    expect(formatCountdown(605)).toBe("10:05");
    expect(safeDeepLink("https://t.me/data2flow_bot?start=ABC")).toBe("https://t.me/data2flow_bot?start=ABC");
    expect(safeDeepLink("https://evil.example/t.me")).toBeUndefined();
    expect(safeDeepLink("javascript:alert(1)")).toBeUndefined();
    expect(safeDeepLink("not a url")).toBeUndefined();
    expect(safeDeepLink(null)).toBeUndefined();
  });
});

describe("OPS-06.06 채널 설정 스키마 폼", () => {
  const schema = {
    type: "object",
    required: ["chatIds", "format"],
    properties: {
      chatIds: { type: "array", items: { type: "integer" }, minItems: 1, maxItems: 20, title: "chat_id" },
      format: { enum: ["MARKDOWN_V2", "HTML"] },
      label: { type: "string", maxLength: 5, pattern: "^[a-z]+$" },
      retries: { type: "integer", minimum: 0, maximum: 5 },
      ratio: { type: ["number", "null"], minimum: 0, maximum: 1 },
      silent: { type: "boolean", default: false },
      tags: { type: "array", items: { type: "string", pattern: "^[a-z]+$" } },
      nested: { type: "object" },
      botToken: { type: "string", writeOnly: true },
    },
  };

  it("TC-OPS-143 스키마로 필드를 만든다(그리지 못하는 모양은 건너뛰고 비밀값은 뒤로)", () => {
    const fields = schemaFields("TELEGRAM", schema);
    expect(fields.map((f) => `${f.name}:${f.kind}`)).toEqual(["chatIds:integerList", "format:enum", "label:string", "retries:integer", "ratio:number", "silent:boolean", "tags:stringList", "botToken:secret"]);
    expect(fields[0].required).toBe(true);
  });

  it("스키마가 없거나 비밀값이 없는 텔레그램은 봇 토큰·웹훅 시크릿·chat_id를 더한다", () => {
    const fields = schemaFields("TELEGRAM", null);
    expect(fields.map((f) => f.name)).toEqual(["chatIds", "botToken", "webhookSecret"]);
    expect(schemaFields("TELEGRAM", TELEGRAM_FALLBACK_SCHEMA).filter((f) => f.kind === "secret")).toHaveLength(2);
    expect(schemaFields("FAKE", null)).toEqual([]);
    expect(schemaFields("FAKE", { properties: { room: { type: "string", minLength: 1 } }, required: ["room"] })).toEqual([expect.objectContaining({ name: "room", kind: "string", required: true })]);
  });

  it("폼 값 → 설정·비밀값과 필드 오류(chat_id 음수 허용·최대 20개, 봇 토큰 형식)", () => {
    const fields = schemaFields("TELEGRAM", null);
    const values: Record<string, string> = { "cfg.chatIds": "-1001234567890\n42", "secret.botToken": "123456789:AAH-abcdefghijklmnopqrstuvwxyz", "secret.webhookSecret": "s3cr3t_token" };
    const ok = parseChannelForm(fields, (n) => values[n] ?? "", { editing: false, hasSecret: false });
    expect(ok.errors).toEqual({});
    expect(ok.config).toEqual({ chatIds: [-1001234567890, 42] });
    expect(ok.secret).toEqual({ botToken: "123456789:AAH-abcdefghijklmnopqrstuvwxyz", webhookSecret: "s3cr3t_token" });
    const bad = parseChannelForm(fields, (n) => ({ "cfg.chatIds": Array.from({ length: 21 }, (_, i) => String(i)).join(","), "secret.botToken": "nope" })[n] ?? "", { editing: false, hasSecret: false });
    expect(bad.errors).toEqual({ chatIds: "tooManyItems", botToken: "pattern", webhookSecret: "required" });
    // 수정할 때 비밀값을 비우면 그대로 둔다(보내지 않음)
    const editing = parseChannelForm(fields, (n) => ({ "cfg.chatIds": "1" })[n] ?? "", { editing: true, hasSecret: true });
    expect(editing.errors).toEqual({});
    expect(editing.secret).toEqual({});
    expect(parseChannelForm(fields, (n) => ({ "cfg.chatIds": "abc" })[n] ?? "", { editing: true, hasSecret: true }).errors.chatIds).toBe("notInteger");
    expect(parseChannelForm(fields, () => "", { editing: true, hasSecret: true }).errors.chatIds).toBe("required");
  });

  it("종류별 검증: 열거·정수·실수·문자열·참거짓·문자열 목록", () => {
    const fields = schemaFields("X", schema);
    const read = (values: Record<string, string>) => (n: string) => values[n] ?? "";
    const parsed = parseChannelForm(fields, read({ "cfg.chatIds": "1", "cfg.format": "HTML", "cfg.label": "abc", "cfg.retries": "3", "cfg.ratio": "0.5", "cfg.silent": "on", "cfg.tags": "a, b", "secret.botToken": "t" }), { editing: false, hasSecret: false });
    expect(parsed.errors).toEqual({});
    expect(parsed.config).toEqual({ chatIds: [1], format: "HTML", label: "abc", retries: 3, ratio: 0.5, silent: true, tags: ["a", "b"] });
    const wrong = parseChannelForm(fields, read({ "cfg.chatIds": "", "cfg.format": "TEXT", "cfg.label": "ABCDEFG", "cfg.retries": "9", "cfg.ratio": "x", "cfg.tags": "A" }), { editing: false, hasSecret: false });
    expect(wrong.errors).toEqual({ chatIds: "required", format: "notInEnum", label: "tooLong", retries: "range", ratio: "notNumber", tags: "pattern" });
    expect(parseChannelForm(fields, read({ "cfg.format": "", "cfg.label": "ABC", "cfg.retries": "1.5" }), { editing: false, hasSecret: false }).errors).toMatchObject({ format: "required", label: "pattern", retries: "notInteger" });
    const minItems = schemaFields("X", { properties: { ids: { type: "array", items: { type: "integer", minimum: 0 }, minItems: 2 }, s: { type: "string", minLength: 3 }, k: { type: "string", writeOnly: true, minLength: 4 } } });
    expect(parseChannelForm(minItems, read({ "cfg.ids": "1", "cfg.s": "ab", "secret.k": "abc" }), { editing: false, hasSecret: false }).errors).toEqual({ ids: "tooFewItems", s: "tooShort", k: "tooShort" });
    expect(parseChannelForm(minItems, read({ "cfg.ids": "1,-1" }), { editing: false, hasSecret: false }).errors.ids).toBe("range");
  });

  it("기본값 문자열, 대상 수, 공통 필드 검증", () => {
    const fields = schemaFields("TELEGRAM", null);
    expect(fieldDefault(fields[0], { chatIds: [1, 2] })).toBe("1\n2");
    expect(fieldDefault(fields[0], undefined)).toBe("");
    expect(fieldDefault({ name: "x", kind: "string", required: false }, { x: 3 })).toBe("3");
    expect(targetCount({ chatIds: [1, 2] })).toBe(2);
    expect(targetCount({})).toBe(0);
    expect(checkCommon({ name: "시설팀", rateLimitPerMin: 20, digestWindowSec: 60 })).toEqual({});
    expect(checkCommon({ name: " ", rateLimitPerMin: 0, digestWindowSec: 901 })).toEqual({ name: "nameRequired", rateLimitPerMin: "rateRange", digestWindowSec: "digestRange" });
    expect(checkCommon({ name: "a".repeat(51), rateLimitPerMin: 20, digestWindowSec: 0 }).name).toBe("nameTooLong");
  });
});
