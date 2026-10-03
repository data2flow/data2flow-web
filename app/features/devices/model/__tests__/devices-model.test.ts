/**
 * 기기 화면 모델 단위 테스트(DEV-02.01·02.03·02.04·02.10·13.01, DSH-07.05).
 */
import { describe, expect, it } from "vitest";
import {
  applyDeviceUpdate,
  checkApproval,
  checkDeviceInput,
  checkTags,
  connectivityTone,
  csvTemplateHref,
  deviceQuery,
  hasFilters,
  isFavorite,
  kindMismatch,
  metricChoices,
  parseTags,
  statusTone,
  suggestSpace,
  summarizeResults,
  toCreateBody,
  toggleFavorite,
  type DeviceInput,
} from "../devices";
import { errorsByField, fieldNameOf, semanticFromForm } from "../semantic";

const valid: DeviceInput = { sourceId: "7", externalId: "24E124136D151777", name: "EM300", kind: "SENSOR", modelId: "11", spaceId: "31", expectedIntervalSec: "600", offlineMultiplier: "3", tags: "pilot, Pilot, east" };

describe("TC-DEV-036 목록 필터(UI-DEV-04)", () => {
  it("URL 쿼리를 API-DEV-11 쿼리로(빈 값 제외, 페이지·크기), 필터 유무", () => {
    const params = new URLSearchParams("q=+am107+&status=ACTIVE&status=INACTIVE&spaceId=&tag=pilot&other=x");
    expect(deviceQuery(params, 2).toString()).toBe("q=am107&status=ACTIVE&status=INACTIVE&tag=pilot&page=2&size=50");
    expect(hasFilters(params)).toBe(true);
    expect(hasFilters(new URLSearchParams("sort=name,asc&includeDescendants=true&page=2"))).toBe(false);
  });
});

describe("DEV-02.10 태그(BR-DEV-11)", () => {
  it("대소문자 무시 중복 제거, 원래 표기 유지, 20개·40자 제한", () => {
    expect(parseTags("pilot, Pilot,\neast,, ")).toEqual(["pilot", "east"]);
    expect(checkTags(Array.from({ length: 21 }, (_, i) => `t${i}`))).toBe("tagLimit");
    expect(checkTags(["x".repeat(41)])).toBe("tagLength");
    expect(checkTags(["ok"])).toBeUndefined();
  });
});

describe("TC-DEV-038 기기 추가 검증(UI-DEV-07)", () => {
  it("정상 입력은 오류 없음, 외부 ID 소문자 정규화와 숫자 변환", () => {
    expect(checkDeviceInput(valid)).toEqual({});
    expect(toCreateBody(valid)).toEqual({ sourceId: "7", externalId: "24e124136d151777", name: "EM300", kind: "SENSOR", modelId: "11", spaceId: "31", expectedIntervalSec: 600, offlineMultiplier: 3, tags: ["pilot", "east"] });
    expect(toCreateBody({ ...valid, expectedIntervalSec: "", offlineMultiplier: "" }).expectedIntervalSec).toBeUndefined();
  });

  it("필수·범위 오류", () => {
    const errors = checkDeviceInput({ sourceId: "", externalId: "x".repeat(129), name: "", kind: "ROBOT", modelId: "", spaceId: "", expectedIntervalSec: "9", offlineMultiplier: "11", tags: Array.from({ length: 21 }, (_, i) => `t${i}`).join(",") });
    expect(errors).toEqual({ sourceId: "sourceRequired", externalId: "externalIdInvalid", name: "nameInvalid", kind: "kindRequired", modelId: "modelRequired", spaceId: "spaceRequired", expectedIntervalSec: "intervalRange", offlineMultiplier: "multiplierRange", tags: "tagLimit" });
    expect(checkDeviceInput({ ...valid, expectedIntervalSec: "10.5" }).expectedIntervalSec).toBe("intervalRange");
  });

  it("모델 종류와 기기 종류가 다르면 경고(BR-DEV-05)", () => {
    expect(kindMismatch("ACTUATOR", { kind: "SENSOR" })).toBe(true);
    expect(kindMismatch("SENSOR", { kind: "SENSOR" })).toBe(false);
    expect(kindMismatch("SENSOR", undefined)).toBe(false);
  });
});

describe("TC-DEV-047 승인(UI-DEV-05)", () => {
  it("모델·공간 필수, 1~200대", () => {
    expect(checkApproval({ count: 0, modelId: "", spaceId: "" })).toEqual({ selection: "selectRequired", modelId: "modelRequired", spaceId: "spaceRequired" });
    expect(checkApproval({ count: 201, modelId: "11", spaceId: "31" })).toEqual({ selection: "selectLimit" });
    expect(checkApproval({ count: 2, modelId: "11", spaceId: "31" })).toEqual({});
  });

  it("AT-DEV-03.3 원본 location 태그와 이름이 같은 공간을 추천(가장 깊은 것), 없으면 없음", () => {
    const spaces = [
      { id: "1", type: "SITE", name: "광주캠퍼스", children: [{ id: "2", type: "BUILDING", name: "실습실", children: [{ id: "31", type: "ROOM", name: "실습실" }] }] },
      { id: "9", type: "SITE", name: "숨김", accessible: false, children: [] },
    ];
    expect(suggestSpace(spaces, { tags: { location: " 실습실 ", point: "중앙" } })).toBe("31");
    expect(suggestSpace(spaces, { tags: { room: "숨김" } })).toBeUndefined();
    expect(suggestSpace(spaces, { tags: {} })).toBeUndefined();
    expect(suggestSpace(spaces, null)).toBeUndefined();
  });

  it("결과 요약: 성공·실패 수와 실패 사유", () => {
    expect(summarizeResults([{ deviceId: "1", ok: true }, { deviceId: "2", ok: false, errorCode: "DEVICE_STATE_CONFLICT" }, { deviceId: "3", ok: false }])).toEqual({ succeeded: 1, failed: 2, failedById: { "2": "DEVICE_STATE_CONFLICT", "3": "UNKNOWN" } });
  });
});

describe("기기 상태 표시·실시간 갱신", () => {
  it("연결·상태 색", () => {
    expect([connectivityTone("ONLINE"), connectivityTone("OFFLINE"), connectivityTone(undefined)]).toEqual(["good", "muted", "warn"]);
    expect([statusTone("ACTIVE"), statusTone("PENDING"), statusTone("INACTIVE")]).toEqual(["success", "info", "neutral"]);
  });

  it("device-update: 같은 기기만 반영, 값 갱신·새 항목 추가, 연결·마지막 수신 시각 갱신", () => {
    const device = { id: "1042", latest: [{ metricKey: "co2", unit: "ppm", value: 517, quality: 0 }], state: { connectivity: "ONLINE", lastSeenAt: "2026-10-03T23:59:48Z" } };
    expect(applyDeviceUpdate(device, { deviceId: "9", metrics: [] })).toBeUndefined();
    const next = applyDeviceUpdate(device, { deviceId: "1042", metrics: [{ key: "co2", value: 530, at: "2026-10-04T00:00:05Z" }, { key: "tvoc", value: 39, unit: "ppb", quality: 3, at: "2026-10-04T00:00:04Z" }], connection: "ONLINE", state: { battery: 91 } });
    expect(next?.latest).toEqual([
      { metricKey: "co2", unit: "ppm", value: 530, quality: 0, measuredAt: "2026-10-04T00:00:05Z" },
      { metricKey: "tvoc", unit: "ppb", value: 39, quality: 3, measuredAt: "2026-10-04T00:00:04Z" },
    ]);
    expect(next?.state).toEqual({ connectivity: "ONLINE", lastSeenAt: "2026-10-04T00:00:05Z", battery: 91 });
    expect(applyDeviceUpdate({ id: "1", latest: undefined, state: undefined }, { deviceId: "1", connection: "OFFLINE" })).toEqual({ latest: [], state: { connectivity: "OFFLINE" } });
  });

  it("데이터 탭 측정 항목 후보, CSV 템플릿", () => {
    expect(metricChoices([{ metricKey: "co2", value: 1 }], ["temperature", "co2"])).toEqual(["co2", "temperature"]);
    expect(metricChoices(undefined)).toEqual([]);
    expect(decodeURIComponent(csvTemplateHref())).toContain("sourceId,externalId,name,kind,modelCode,spaceId");
  });

  it("DSH-07.05 즐겨찾기 토글", () => {
    const added = toggleFavorite([{ type: "SPACE", id: "31" }], "DEVICE", "1042");
    expect(added).toEqual([{ type: "SPACE", id: "31" }, { type: "DEVICE", id: "1042" }]);
    expect(isFavorite(added, "DEVICE", "1042")).toBe(true);
    expect(toggleFavorite(added, "DEVICE", "1042")).toEqual([{ type: "SPACE", id: "31" }]);
    expect(toggleFavorite(undefined, "DEVICE", "1")).toEqual([{ type: "DEVICE", id: "1" }]);
    expect(isFavorite(undefined, "DEVICE", "1")).toBe(false);
  });
});

describe("TC-DEV-307 시맨틱 폼(UI-DEV-18)", () => {
  it("폼 값 → API 본문, API 필드 오류 → 폼 필드", () => {
    const form = new FormData();
    form.set("eq.0.equipClass", " Zone_Air_Sensor ");
    form.set("eq.0.name", "실습실 센서");
    form.set("eq.0.pt.0.metricKey", "temperature");
    form.set("eq.0.pt.0.pointType", "Measurement");
    form.set("eq.0.pt.0.quantity", "");
    form.set("eq.0.pt.0.tags", "zone, air");
    form.set("eq.0.pt.1.metricKey", "co2");
    expect(semanticFromForm(form)).toEqual({
      equipment: [
        {
          equipClass: "Zone_Air_Sensor",
          name: "실습실 센서",
          points: [
            { metricKey: "temperature", pointType: "Measurement", quantity: null, tags: ["zone", "air"] },
            { metricKey: "co2", pointType: "", quantity: null, tags: [] },
          ],
        },
      ],
    });
    expect(fieldNameOf("equipment[0].points[1].quantity")).toBe("eq.0.pt.1.quantity");
    expect(fieldNameOf("equipment[2].name")).toBe("eq.2.name");
    expect(errorsByField([{ field: "equipment[0].name", code: "X", message: "" }, { field: "equipment[0].points[0].tags", code: "Y", message: "잘못" }])).toEqual({ "eq.0.name": "X", "eq.0.pt.0.tags": "잘못" });
    expect(errorsByField(undefined)).toEqual({});
  });
});
