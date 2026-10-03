/**
 * 공간 관리 입력 규칙(UI-DEV-02·03): DEV-01.04 목표 환경, DEV-11.01 운영 시간표, DEV-11.02 수동 지정, DEV-01.03 평면도, DSH-02 실시간 카드.
 */
import { describe, expect, it } from "vitest";
import { applyDeviceUpdate } from "../model/live-devices";
import { checkFloorplanFile, checkOverrideUntil, checkSlots, checkTargets, parseJsonArray, ratioFromClick, sortSlots, browserImageUrl } from "../model/space-forms";

describe("DEV-01.04 TC-DEV-025 목표 환경 검증", () => {
  it("최소 ≤ 최대, 하나 이상, 숫자, 항목 필수·중복 금지", () => {
    const { items, errors } = checkTargets([
      { metricKey: "temperature", min: "20", max: "26" },
      { metricKey: "co2", min: "", max: "1000" },
      { metricKey: "humidity", min: "70", max: "30" },
      { metricKey: "", min: "1", max: "" },
      { metricKey: "co2", min: "1", max: "" },
      { metricKey: "pm25", min: "", max: "" },
      { metricKey: "noise", min: "abc", max: "" },
    ]);
    expect(items).toEqual([{ metricKey: "temperature", min: 20, max: 26 }, { metricKey: "co2", max: 1000 }]);
    expect(errors).toEqual({ 2: "minGreaterThanMax", 3: "metricRequired", 4: "duplicate", 5: "valueRequired", 6: "notNumber" });
  });
});

describe("DEV-11.01 TC-DEV-285 운영 시간표 검증", () => {
  it("시작 < 종료, 같은 요일 겹침 금지(다른 요일은 허용), 형식", () => {
    expect(checkSlots([{ dayOfWeek: 1, start: "09:00", end: "12:00" }, { dayOfWeek: 1, start: "12:00", end: "18:00" }, { dayOfWeek: 2, start: "09:00", end: "24:00" }])).toEqual({});
    expect(checkSlots([{ dayOfWeek: 1, start: "09:00", end: "12:00" }, { dayOfWeek: 1, start: "11:00", end: "13:00" }])).toEqual({ 0: "overlap", 1: "overlap" });
    expect(checkSlots([{ dayOfWeek: 1, start: "12:00", end: "09:00" }, { dayOfWeek: 8, start: "09:00", end: "10:00" }, { dayOfWeek: 3, start: "9시", end: "10:00" }])).toEqual({ 0: "startAfterEnd", 1: "dayInvalid", 2: "timeInvalid" });
    expect(sortSlots([{ dayOfWeek: 2, start: "09:00", end: "10:00" }, { dayOfWeek: 1, start: "13:00", end: "14:00" }, { dayOfWeek: 1, start: "08:00", end: "09:00" }]).map((s) => `${s.dayOfWeek}${s.start}`)).toEqual(["108:00", "113:00", "209:00"]);
  });

  it("수동 지정 종료는 지금 이후 7일 이내", () => {
    const now = Date.parse("2026-10-04T00:00:00Z");
    expect(checkOverrideUntil(null, now)).toBeUndefined();
    expect(checkOverrideUntil("2026-10-05T00:00:00Z", now)).toBeUndefined();
    expect(checkOverrideUntil("2026-10-12T00:00:00Z", now)).toBe("untilRange");
    expect(checkOverrideUntil("2026-10-03T00:00:00Z", now)).toBe("untilRange");
    expect(checkOverrideUntil("x", now)).toBe("untilInvalid");
  });
});

describe("DEV-01.03 TC-DEV-019 평면도", () => {
  it("PNG/JPG/SVG, 10MB 이하, 400×300 이상", () => {
    expect(checkFloorplanFile({ type: "image/png", size: 1024 })).toBe(true);
    expect(checkFloorplanFile({ type: "image/svg+xml", size: 1024, width: 800, height: 600 })).toBe(true);
    expect(checkFloorplanFile({ type: "image/gif", size: 1024 })).toBe(false);
    expect(checkFloorplanFile({ type: "image/jpeg", size: 11 * 1024 * 1024 })).toBe(false);
    expect(checkFloorplanFile({ type: "image/jpeg", size: 0 })).toBe(false);
    expect(checkFloorplanFile({ type: "image/png", size: 10, width: 399, height: 300 })).toBe(false);
  });

  it("놓은 위치를 비율 좌표로(범위 밖은 끝으로)", () => {
    const rect = { left: 100, top: 50, width: 400, height: 200 };
    expect(ratioFromClick(200, 150, rect)).toEqual({ x: 0.25, y: 0.5 });
    expect(ratioFromClick(0, 999, rect)).toEqual({ x: 0, y: 1 });
    expect(ratioFromClick(1, 1, { left: 0, top: 0, width: 0, height: 0 })).toEqual({ x: 0, y: 0 });
  });

  it("JSON 폼 값", () => {
    expect(parseJsonArray("[1,2]")).toEqual([1, 2]);
    expect(parseJsonArray("{}")).toEqual([]);
    expect(parseJsonArray("x")).toEqual([]);
  });
});

describe("UI-DSH-02 실시간 기기 카드 갱신(device-update)", () => {
  it("해당 기기의 측정값·연결·마지막 수신을 바꾸고 모르는 기기는 무시", () => {
    const devices = [{ id: "1042", name: "AM107", connection: "ONLINE", lastSeenAt: "2026-10-03T23:59:48Z", metrics: [{ key: "co2", value: 517, unit: "ppm" }] }];
    const next = applyDeviceUpdate(devices, { deviceId: 1042, metrics: [{ key: "co2", value: 530, at: "2026-10-04T00:00:05Z" }, { key: "tvoc", value: 39, at: "2026-10-03T00:00:00Z" }], connection: "OFFLINE" });
    expect(next[0].metrics).toEqual([{ key: "co2", value: 530, unit: "ppm", at: "2026-10-04T00:00:05Z" }, { key: "tvoc", value: 39, at: "2026-10-03T00:00:00Z" }]);
    expect(next[0].connection).toBe("OFFLINE");
    expect(next[0].lastSeenAt).toBe("2026-10-04T00:00:05Z");
    expect(applyDeviceUpdate(devices, { deviceId: "9" })).toBe(devices);
    expect(applyDeviceUpdate([{ id: "1", name: "x" }], { deviceId: "1", state: "INACTIVE" })[0]).toMatchObject({ status: "INACTIVE", metrics: [], lastSeenAt: null });
  });
});

describe("DEV-01.03 평면도 이미지 주소(API-DEV-142)", () => {
  it("core API 경로는 BFF 중계 경로로, 다른 주소·빈 값은 그대로", () => {
    expect(browserImageUrl("/api/v1/core/spaces/31/floorplan/image?v=3")).toBe("/bff/api/core/spaces/31/floorplan/image?v=3");
    expect(browserImageUrl("http://data2flow-api-gateway/api/v1/core/spaces/31/floorplan/image")).toBe("/bff/api/core/spaces/31/floorplan/image");
    expect(browserImageUrl("data:image/png;base64,AAA")).toBe("data:image/png;base64,AAA");
    expect(browserImageUrl(null)).toBeNull();
  });
});
