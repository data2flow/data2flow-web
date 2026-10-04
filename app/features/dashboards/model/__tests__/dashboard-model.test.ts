/**
 * 대시보드 화면 모델 단위 시험: 격자 배치(DSH-04.01, BR-DSH-18 — core TC-DSH-029와 같은 규칙), 위젯 스키마 검사, 변수(TC-DSH-042),
 * 시간 범위·확대(DSH-11.01), 표·CSV(DSH-06.01·11.03), 키오스크(DSH-06.02), 저장 본문·가져오기·공유 링크(DSH-04.07·06.03)
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { aggregate, barOption, exportFileName, gaugeOption, heatmapOption, isForbidden, stateFromResult, thresholdTone, toChartSeries, toCsv, trendOf, widgetTable, type TableLabels } from "../data";
import { initialRotation, kioskUrl, parseKioskParams, progressOf, skip, startKeepAlive, tick, togglePause } from "../kiosk";
import { COLUMNS, MAX_WIDGETS, addWidget, duplicateWidget, findFreeSlot, gridRows, inGrid, keyboardDelta, moveWidget, nextWidgetId, overlaps, pixelsToCells, readingOrder, removeWidget, resizeWidget, updateWidget, validateLayout } from "../layout";
import { customRange, isRelative, rangeValid, refreshIntervalMs, relativeMs, resolveRange, sameRange, zoomFromEvent, zoomToRange } from "../time";
import { draftOf, hasErrors, parseImport, saveBody, shareDaysValid, shareLinkStatus, validateDraft } from "../transfer";
import type { Dashboard, Widget, WidgetTypeInfo } from "../types";
import { changedVariables, dependsOn, refOf, resolveValues, substituteTarget, validateVariables, valuesFromSearch, variableRef, variablesUsedBy } from "../variables";
import { CHART_TYPES, idFieldOf, liveTopicsOf, newWidget, optionValid, validateOptions, validateWidget } from "../widgets";

const w = (id: string, x: number, y: number, ww = 4, h = 4, extra: Partial<Widget> = {}): Widget => ({ id, type: "stat", x, y, w: ww, h, ...extra });

const TYPES: WidgetTypeInfo[] = [
  { type: "stat", label: "현재값", optionsSchema: { properties: { unit: { type: "string" }, decimals: { type: "integer", minimum: 0, maximum: 4 }, trend: { type: "boolean" }, thresholds: { type: "array" } } }, targetRule: { min: 1, max: 1, kinds: ["DEVICE_METRIC", "SPACE_AGGREGATE"] } },
  { type: "line", label: "선", optionsSchema: { properties: { legend: { type: "string", enum: ["bottom", "right"] }, yMin: { type: "number" }, sort: { type: "object" } } }, targetRule: { min: 1, max: 20, kinds: ["DEVICE_METRIC"] } },
  { type: "gauge", label: "게이지", optionsSchema: { properties: { min: { type: "number" }, max: { type: "number" } } }, targetRule: { min: 1, max: 1, kinds: ["SPACE_AGGREGATE"] } },
  { type: "alarm-list", label: "알람", optionsSchema: { properties: {} }, targetRule: { min: 0, max: 20, kinds: ["SPACE", "DEVICE"] } },
  { type: "markdown", label: "메모", optionsSchema: { properties: { content: { type: "string", maxLength: 10 } } }, targetRule: { min: 0, max: 0, kinds: [] } },
];

describe("DSH-04.01 BR-DSH-18 격자 배치", () => {
  it("TC-DSH-029: 겹침·격자 밖(x+w>24)·41개째·중복 id는 오류, 정상 배치 통과", () => {
    expect(validateLayout([w("a", 0, 0), w("b", 4, 0)])).toEqual([]);
    expect(validateLayout([w("a", 0, 0), w("b", 2, 2)])).toEqual([{ index: 1, code: "OVERLAP" }]);
    expect(validateLayout([w("a", 22, 0, 4)])).toEqual([{ index: 0, code: "OUT_OF_GRID" }]);
    expect(validateLayout([w("a", 0, 0, 2, 49)])).toEqual([{ index: 0, code: "OUT_OF_GRID" }]);
    expect(validateLayout([w("a", 0, 0), w("a", 8, 0)])).toEqual([{ index: 1, code: "DUPLICATE_ID" }]);
    expect(validateLayout([w("a b", 0, 0)])).toEqual([{ index: 0, code: "INVALID_ID" }]);
    const many = Array.from({ length: 41 }, (_, i) => w(`w${i}`, (i % 6) * 4, Math.floor(i / 6) * 4));
    expect(validateLayout(many)).toEqual([{ index: 40, code: "TOO_MANY_WIDGETS" }]);
    expect(inGrid({ x: 0.5, y: 0, w: 1, h: 1 })).toBe(false);
    expect(overlaps({ x: 0, y: 0, w: 4, h: 4 }, { x: 4, y: 0, w: 4, h: 4 })).toBe(false);
  });

  it("TC-DSH-031: 끌어 옮기기·크기 조정은 격자 안으로 맞추고 겹치면 받아들이지 않는다, 복제는 빈 자리에", () => {
    const base = [w("a", 0, 0), w("b", 4, 0)];
    expect(moveWidget(base, "a", 30, 2)).toEqual([w("a", 20, 2), w("b", 4, 0)]);
    expect(moveWidget(base, "a", 2, 0)).toBeNull();
    expect(moveWidget(base, "a", 0, 0)).toBeNull();
    expect(moveWidget(base, "zz", 0, 9)).toBeNull();
    expect(resizeWidget(base, "b", 30, 2)?.find((x) => x.id === "b")).toMatchObject({ w: 20, h: 2 });
    expect(resizeWidget(base, "a", 6, 4)).toBeNull();
    expect(resizeWidget(base, "a", 4, 4)).toBeNull();
    expect(resizeWidget(base, "zz", 4, 4)).toBeNull();
    const dup = duplicateWidget(base, "a")!;
    expect(dup).toHaveLength(3);
    expect(dup[2]).toMatchObject({ id: "w3", type: "stat", x: 8, y: 0 });
    expect(duplicateWidget(base, "zz")).toBeNull();
    expect(removeWidget(base, "a")).toEqual([w("b", 4, 0)]);
    expect(updateWidget(base, "a", { title: "CO2" })[0].title).toBe("CO2");
  });

  it("빈 자리 찾기·다음 id·41개째 추가 거부·읽는 순서·픽셀→칸·키보드", () => {
    expect(findFreeSlot([w("a", 0, 0, 24, 2)], 6, 2)).toEqual({ x: 0, y: 2 });
    expect(findFreeSlot([], 30, 2)).toEqual({ x: 0, y: 0 });
    expect(nextWidgetId([w("w2", 0, 0)])).toBe("w3");
    expect(nextWidgetId([w("w1", 0, 0), w("w2", 4, 0)])).toBe("w3");
    const full = Array.from({ length: MAX_WIDGETS }, (_, i) => w(`w${i}`, (i % 6) * 4, Math.floor(i / 6) * 4));
    expect(addWidget(full, { type: "stat", w: 4, h: 4 })).toBeNull();
    expect(addWidget([], { type: "stat", w: 99, h: 99 })?.[0]).toMatchObject({ w: COLUMNS, h: 48, x: 0, y: 0 });
    expect(readingOrder([w("b", 4, 2), w("a", 8, 0), w("c", 0, 2)]).map((x) => x.id)).toEqual(["a", "c", "b"]);
    expect(pixelsToCells(100, 95, 40)).toEqual({ dx: 3, dy: 2 });
    expect(pixelsToCells(10, 0, 0)).toEqual({ dx: 10, dy: 0 });
    expect(keyboardDelta("ArrowRight", false)).toEqual({ dx: 1, dy: 0, dw: 0, dh: 0 });
    expect(keyboardDelta("ArrowDown", true)).toEqual({ dx: 0, dy: 0, dw: 0, dh: 1 });
    expect(keyboardDelta("a", false)).toBeNull();
    expect(gridRows([w("a", 0, 3, 4, 5)])).toBe(8);
  });
});

describe("DSH-04.01 위젯 스키마 검사(API-DSH-13)", () => {
  const vars = new Set(["space"]);
  it("종류·대상 수·대상 종류·ID 또는 변수 참조·측정 항목·집계·옵션 형식", () => {
    expect(validateWidget({ ...w("a", 0, 0), type: "nope" }, TYPES, vars)).toEqual([{ field: "type", code: "TYPE_UNSUPPORTED" }]);
    expect(validateWidget(w("a", 0, 0, 4, 4, { targets: [] }), TYPES, vars)).toEqual([{ field: "targets", code: "TARGET_COUNT", min: 1, max: 1 }]);
    expect(validateWidget(w("a", 0, 0, 4, 4, { targets: [{ kind: "DEVICE", deviceId: "1" }] }), TYPES, vars)[0].code).toBe("TARGET_KIND");
    expect(validateWidget(w("a", 0, 0, 4, 4, { targets: [{ kind: "SPACE_AGGREGATE", spaceId: "${space}", metricKey: "co2" }] }), TYPES, vars)).toEqual([]);
    expect(validateWidget(w("a", 0, 0, 4, 4, { targets: [{ kind: "SPACE_AGGREGATE", spaceId: "${other}", metricKey: "" }] }), TYPES, vars).map((e) => e.code)).toEqual(["TARGET_REF", "METRIC_REQUIRED"]);
    expect(validateWidget(w("a", 0, 0, 4, 4, { targets: [{ kind: "DEVICE_METRIC", deviceId: "1042", metricKey: "co2", agg: "median" }] }), TYPES, vars)[0].code).toBe("AGG_INVALID");
    expect(validateWidget(w("a", 0, 0, 4, 4, { targets: [{ kind: "DEVICE_METRIC", deviceId: "1042", metricKey: "co2" }], options: { decimals: 9, unit: 3, trend: "y" } }), TYPES, vars).map((e) => e.field)).toEqual(["options.unit", "options.decimals", "options.trend"]);
    expect(validateWidget({ ...w("m", 0, 0), type: "alarm-list", targets: [] }, TYPES, vars)).toEqual([]);
    const gauge = TYPES[2];
    expect(validateOptions({ min: 10, max: 5 }, gauge)).toEqual([{ field: "options.max", code: "OPTION_ORDER" }]);
    expect(validateOptions(undefined, gauge)).toEqual([]);
    expect(optionValid("x", { type: "string", enum: ["bottom"] })).toBe(false);
    expect(optionValid({}, { type: "object" })).toBe(true);
    expect(optionValid([], { type: "array" })).toBe(true);
    expect(optionValid(1.5, { type: "number" })).toBe(true);
    expect(optionValid("x", { type: "mystery" })).toBe(true);
    expect(optionValid("01234567890", TYPES[4].optionsSchema.properties!.content)).toBe(false);
  });

  it("새 위젯은 종류별 기본 크기, 대상은 첫 변수로 미리 채움, 실시간 토픽은 값이 정해진 기기 측정 항목만", () => {
    expect(newWidget(TYPES[0], "현재값", { space: "${space}", metric: "${metric}" })).toMatchObject({ type: "stat", w: 4, h: 4, targets: [{ kind: "DEVICE_METRIC", deviceId: "", metricKey: "${metric}" }] });
    expect(newWidget(TYPES[2], "게이지", { space: "${space}" }).targets).toEqual([{ kind: "SPACE_AGGREGATE", spaceId: "${space}", metricKey: "" }]);
    expect(newWidget(TYPES[4], "메모").targets).toEqual([]);
    expect(newWidget({ ...TYPES[0], type: "custom" }, "x")).toMatchObject({ w: 6, h: 6 });
    expect(idFieldOf("DEVICE")).toBe("deviceId");
    expect(idFieldOf("SPACE")).toBe("spaceId");
    expect(CHART_TYPES.has("line")).toBe(true);
    const widget = w("a", 0, 0, 4, 4, { targets: [{ kind: "DEVICE_METRIC", deviceId: "${dev}", metricKey: "co2" }, { kind: "DEVICE_METRIC", deviceId: "1042", metricKey: "${m}" }, { kind: "SPACE_AGGREGATE", spaceId: "31", metricKey: "co2" }, { kind: "DEVICE_METRIC", deviceId: "${none}", metricKey: "co2" }] });
    expect(liveTopicsOf(widget, { dev: "1050", m: "temperature" })).toEqual(["telemetry:1050.co2", "telemetry:1042.temperature"]);
  });
});

describe("DSH-04.05 대시보드 변수", () => {
  it("TC-DSH-042 AT-DSH-04.3: ${space}·${device}·${metric} 치환, 미설정 시 기본값, 한 번만 치환(순환 없음)", () => {
    const vars = [
      { name: "space", type: "SPACE", default: "31" },
      { name: "device", type: "DEVICE", default: null },
      { name: "metric", type: "METRIC", default: "${space}" },
    ];
    const values = resolveValues(vars, { device: "1042" });
    expect(values).toEqual({ space: "31", device: "1042", metric: "${space}" });
    expect(substituteTarget({ kind: "DEVICE_METRIC", deviceId: "${device}", metricKey: "${metric}" }, values)).toEqual({ kind: "DEVICE_METRIC", deviceId: "1042", spaceId: undefined, metricKey: "${space}" });
    expect(substituteTarget({ kind: "SPACE", spaceId: "${unknown}" }, values).spaceId).toBe("${unknown}");
    expect(variableRef("${space}")).toBe("space");
    expect(variableRef("31")).toBeNull();
    expect(refOf("space")).toBe("${space}");
  });

  it("TC-DSH-043: 바뀐 변수를 쓰는 위젯만 다시 요청 대상, 이름 규칙·중복·10개 상한, 주소 var-*", () => {
    const uses = w("a", 0, 0, 4, 4, { targets: [{ kind: "SPACE", spaceId: "${space}" }] });
    const plain = w("b", 4, 0, 4, 4, { targets: [{ kind: "DEVICE_METRIC", deviceId: "1042", metricKey: "co2" }] });
    expect([...variablesUsedBy(uses)]).toEqual(["space"]);
    expect(changedVariables({ space: "31" }, { space: "32" })).toEqual(["space"]);
    expect(dependsOn(uses, ["space"])).toBe(true);
    expect(dependsOn(plain, ["space"])).toBe(false);
    expect(validateVariables([{ name: "space", type: "SPACE" }])).toEqual([]);
    expect(validateVariables([{ name: "Space", type: "SPACE" }, { name: "x", type: "NOPE" }, { name: "x", type: "SPACE" }])).toEqual([
      { index: 0, field: "name", code: "INVALID" },
      { index: 1, field: "type", code: "INVALID" },
      { index: 2, field: "name", code: "DUPLICATE" },
    ]);
    expect(validateVariables(Array.from({ length: 11 }, (_, i) => ({ name: `v${i}`, type: "SPACE" })))[0]).toEqual({ index: 10, field: "count", code: "TOO_MANY" });
    expect(valuesFromSearch(new URLSearchParams("var-space=32&x=1&var-device="))).toEqual({ space: "32" });
  });
});

describe("DSH-11.01 시간 범위·확대 동기화", () => {
  const now = Date.parse("2026-10-04T00:00:00Z");
  it("최근 N·기간 지정·1분~400일·확대 이벤트·새로고침 주기", () => {
    expect(relativeMs("24h")).toBe(86_400_000);
    expect(relativeMs("2w")).toBe(14 * 86_400_000);
    expect(relativeMs("bad")).toBeNull();
    expect(resolveRange({ relative: "1h" }, now)).toEqual({ from: now - 3_600_000, to: now });
    expect(resolveRange({ relative: "x" }, now)).toBeNull();
    expect(resolveRange({ from: "2026-10-01T00:00:00Z" }, now)).toEqual({ from: Date.parse("2026-10-01T00:00:00Z"), to: now });
    expect(resolveRange({ from: "nope" }, now)).toBeNull();
    expect(rangeValid({ relative: "30d" }, now)).toBe(true);
    expect(rangeValid({ relative: "2y" }, now)).toBe(false);
    expect(rangeValid({ relative: "zz" }, now)).toBe(false);
    expect(isRelative({ from: "a" })).toBe(false);
    expect(customRange("2026-10-01T00:00", "2026-10-02T00:00")).toMatchObject({ from: expect.stringMatching(/Z$/) });
    expect(customRange("2026-10-02T00:00", "2026-10-01T00:00")).toBeNull();
    expect(sameRange({ relative: "1h" }, { relative: "1h" })).toBe(true);
    expect(refreshIntervalMs("30s")).toBe(30_000);
    expect(refreshIntervalMs("LIVE")).toBeNull();
    expect(zoomFromEvent({ batch: [{ startValue: 10, endValue: 20 }] })).toEqual({ from: 10, to: 20 });
    expect(zoomFromEvent({ startValue: 5, endValue: 6 })).toEqual({ from: 5, to: 6 });
    expect(zoomFromEvent({ batch: [{ startValue: 20, endValue: 10 }] })).toBeNull();
    expect(zoomFromEvent(null)).toBeNull();
    expect(zoomToRange({ from: 0, to: 60_000 })).toEqual({ from: "1970-01-01T00:00:00.000Z", to: "1970-01-01T00:01:00.000Z" });
  });
});

const LABELS = Object.fromEntries(["time", "value", "unit", "name", "connection", "battery", "rssi", "alarms", "severity", "title", "state", "device", "x", "y", "min", "max", "content"].map((k) => [k, k])) as unknown as TableLabels;

describe("DSH-06.01 DSH-11.03 위젯 데이터 표·CSV", () => {
  it("TC-DSH-097: 위젯 종류별 표(시계열은 시각별 행, 시각은 사용자 시간대), 권한 밖·없음은 빈 표", () => {
    const series = { type: "line", data: { series: [{ key: "a", label: "CO2", unit: "ppm", points: [["2026-10-03T23:00:00Z", 1000, 0], ["2026-10-04T00:00:00Z", 1100, 0]] }, { key: "b", label: "온도", points: [["2026-10-04T00:00:00Z", 24, 0]] }] } };
    const t = widgetTable({ type: "line" }, series as never, LABELS, "Asia/Seoul");
    expect(t.columns).toEqual(["time", "CO2 (ppm)", "온도"]);
    expect(t.rows[1]).toEqual([expect.stringContaining("09:00"), 1100, 24]);
    expect(t.rows[0][2]).toBeNull();
    expect(widgetTable({ type: "stat" }, { type: "stat", data: { value: 5, unit: "℃", at: null } }, LABELS, "UTC").rows).toEqual([[null, 5, "℃"]]);
    expect(widgetTable({ type: "gauge" }, { type: "gauge", data: { value: 48, unit: "%", min: 0, max: 100 } }, LABELS, "UTC").rows).toEqual([[48, "%", 0, 100]]);
    expect(widgetTable({ type: "heatmap" }, { type: "heatmap", data: { xLabels: ["0시"], yLabels: ["월"], values: [[3]] } }, LABELS, "UTC")).toEqual({ columns: ["", "0시"], rows: [["월", 3]] });
    expect(widgetTable({ type: "table" }, { type: "table", data: { columns: ["a"], rows: [[1]] } }, LABELS, "UTC").rows).toEqual([[1]]);
    expect(widgetTable({ type: "status-list" }, { type: "status-list", data: { items: [{ deviceId: "1", name: "센서", connection: "ONLINE", battery: 80, rssi: -90, alarms: 0 }] } }, LABELS, "UTC").rows).toEqual([["센서", "ONLINE", 80, -90, 0]]);
    expect(widgetTable({ type: "alarm-list" }, { type: "alarm-list", data: { items: [{ alarmId: "1", severity: "MAJOR", title: "고CO2", state: "ACTIVE", at: "2026-10-04T00:00:00Z" }] } }, LABELS, "UTC").rows[0].slice(1)).toEqual(["MAJOR", "고CO2", "ACTIVE"]);
    expect(widgetTable({ type: "floorplan" }, { type: "floorplan", data: { markers: [{ deviceId: "9", x: 0.5, y: 0.2, value: 1, unit: "℃", state: "OK" }] } }, LABELS, "UTC").rows).toEqual([["9", 1, "℃", "OK", 0.5, 0.2]]);
    expect(widgetTable({ type: "markdown" }, { type: "markdown", data: null }, LABELS, "UTC")).toEqual({ columns: [], rows: [] });
    expect(widgetTable({ type: "stat" }, { type: "stat", data: { forbidden: true } }, LABELS, "UTC")).toEqual({ columns: [], rows: [] });
    expect(widgetTable({ type: "custom" }, { type: "custom", data: {} }, LABELS, "UTC")).toEqual({ columns: [], rows: [] });
  });

  it("TC-DSH-061: CSV는 UTF-8 BOM·따옴표·수식 주입 방지, 파일 이름은 쓸 수 없는 글자 제거", () => {
    const csv = toCsv({ columns: ["시각", "값"], rows: [["a,b", 1], ['say "hi"', null], ["=1+1", 2]] });
    expect(csv.startsWith("﻿시각,값\r\n")).toBe(true);
    expect(csv).toContain('"a,b",1');
    expect(csv).toContain('"say ""hi""",');
    expect(csv).toContain('"=1+1",2');
    expect(exportFileName('실습실/운영 "A"', "csv", Date.parse("2026-10-04T01:02:00Z"))).toBe("실습실_운영_A__202610040102.csv");
    expect(exportFileName("", "png", 0)).toBe("dashboard_197001010000.png");
  });

  it("차트 계열·추세·임계 색·막대·게이지·히트맵 option(색약 팔레트), 권한 밖 판정", () => {
    expect(toChartSeries({ series: [{ key: "a", label: "A", points: [["t", null, null]] }] })[0]).toMatchObject({ key: "a", raw: true, unit: null, virtual: false });
    expect(toChartSeries(null)).toEqual([]);
    expect(trendOf({ value: 2, previous: 1 })).toBe("up");
    expect(trendOf({ value: 1, previous: 2 })).toBe("down");
    expect(trendOf({ value: 1, previous: 1 })).toBe("flat");
    expect(trendOf({ value: 1 })).toBeNull();
    expect(thresholdTone(1200, [{ value: 0, tone: "good" }, { value: 1000, tone: "warn" }, { value: 2000, tone: "bad" }])).toBe("warn");
    expect(thresholdTone(null, [])).toBeNull();
    expect(thresholdTone(5, "x")).toBeNull();
    const payload = { series: [{ key: "a", label: "A", points: [["t", 1, 0], ["t2", 3, 0]] as [string, number, number][] }, { key: "b", label: "B", points: [["t", 5, 0]] as [string, number, number][] }] };
    const bar = barOption(payload, { sort: "desc", orientation: "horizontal", agg: "avg" }, false) as { yAxis: { data: string[] }; series: { data: { value: number; itemStyle: { color: string } }[] }[] };
    expect(bar.yAxis.data).toEqual(["B", "A"]);
    expect(bar.series[0].data.map((d) => d.value)).toEqual([5, 2]);
    expect(bar.series[0].data[0].itemStyle.color).toBe("#0072B2");
    expect((barOption(payload, { sort: "asc" }, true) as { xAxis: { data: string[] } }).xAxis.data).toEqual(["A", "B"]);
    expect(aggregate([1, null, 3], "min")).toBe(1);
    expect(aggregate([1, 3], "max")).toBe(3);
    expect(aggregate([1, 3], "sum")).toBe(4);
    expect(aggregate([], "avg")).toBeNull();
    expect(gaugeOption({ value: 4, unit: "%", min: null }, false)).toMatchObject({ series: [{ min: 0, max: 100 }] });
    expect(gaugeOption(null, true)).toMatchObject({ series: [{ data: [{ value: null }] }] });
    expect(heatmapOption({ xLabels: ["a"], yLabels: ["b"], values: [[2, null]] }, false)).toMatchObject({ visualMap: { min: 2, max: 2 } });
    expect(heatmapOption(null, true)).toMatchObject({ visualMap: { min: 0, max: 1 } });
    expect(isForbidden({ forbidden: true })).toBe(true);
    expect(stateFromResult({ ok: true, status: 200, data: { type: "x", data: { forbidden: true } } })).toEqual({ status: "forbidden" });
    expect(stateFromResult({ ok: false, status: 403, code: "PERMISSION_DENIED" })).toEqual({ status: "forbidden" });
    expect(stateFromResult({ ok: false, status: 500, code: "X" })).toEqual({ status: "error", code: "X" });
  });
});

describe("DSH-06.02 키오스크", () => {
  afterEach(() => {
    vi.useRealTimers();
  });
  it("TC-DSH-062: boards 1~10·interval 30~600 검사, 1초씩 진행해 순환, 일시 정지·건너뛰기·진행 막대", () => {
    expect(parseKioskParams(new URLSearchParams("boards=1,2,2,x&interval=60"))).toEqual({ boards: ["1", "2"], interval: 60, errors: [] });
    expect(parseKioskParams(new URLSearchParams("boards=&interval=10")).errors).toEqual(["BOARDS", "INTERVAL"]);
    expect(parseKioskParams(new URLSearchParams("boards=1")).interval).toBe(60);
    expect(parseKioskParams(new URLSearchParams(`boards=${Array.from({ length: 11 }, (_, i) => i + 1).join(",")}`)).errors).toEqual(["BOARDS"]);
    expect(kioskUrl(["1", "2"], 30)).toBe("/kiosk?boards=1,2&interval=30");
    let s = initialRotation(2);
    s = tick(s, 3, 2);
    expect(s).toEqual({ index: 0, remaining: 1, paused: false });
    expect(progressOf(s, 2)).toBe(0.5);
    s = tick(s, 3, 2);
    expect(s).toEqual({ index: 1, remaining: 2, paused: false });
    s = togglePause(s);
    expect(tick(s, 3, 2)).toBe(s);
    expect(skip(s, 3, 2).index).toBe(2);
    expect(skip(s, 0, 2).index).toBe(0);
    expect(tick({ index: 0, remaining: 1, paused: false }, 1, 5)).toEqual({ index: 0, remaining: 5, paused: false });
  });

  it("TC-DSH-063 AT-DSH-06.2: 세션 유지 요청을 4분마다 보내고 401이면 멈춘 뒤 알린다(가짜 타이머)", async () => {
    vi.useFakeTimers();
    const statuses = [200, 200, 401];
    const ping = vi.fn(async () => statuses.shift() ?? 200);
    const ended = vi.fn();
    startKeepAlive(ping, ended);
    await vi.advanceTimersByTimeAsync(4 * 60_000);
    expect(ping).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(8 * 60_000);
    expect(ping).toHaveBeenCalledTimes(3);
    expect(ended).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(20 * 60_000);
    expect(ping).toHaveBeenCalledTimes(3);
    const failing = vi.fn(async () => {
      throw new Error("net");
    });
    const stop = startKeepAlive(failing, ended, 1000);
    await vi.advanceTimersByTimeAsync(1000);
    stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(failing).toHaveBeenCalledTimes(1);
  });
});

describe("DSH-04.07 DSH-06.03 저장 본문·가져오기·공유 링크", () => {
  const dashboard: Dashboard = { id: "1", name: " 실습실 ", visibility: "ORG", layout: { widgets: [w("a", 0, 0, 4, 4, { targets: [{ kind: "SPACE_AGGREGATE", spaceId: "${space}", metricKey: "co2" }] })] }, variables: [{ name: "space", type: "SPACE" }], timeRange: { relative: "24h" }, resolution: "AUTO", refresh: "LIVE", version: 3 };
  it("저장 전 검사와 PUT 본문(baseVersion), 이름 없음·배치·변수·위젯 오류", () => {
    const draft = draftOf(dashboard);
    expect(hasErrors(validateDraft(draft, TYPES))).toBe(false);
    expect(saveBody(draft, 3)).toMatchObject({ name: "실습실", description: null, visibility: "ORG", baseVersion: 3, layout: { widgets: [{ id: "a" }] } });
    const bad = validateDraft({ ...draft, name: " ", variables: [{ name: "Bad", type: "SPACE" }], layout: { widgets: [w("a", 22, 0, 4, 4)] } }, TYPES);
    expect(bad.name).toBe("REQUIRED");
    expect(bad.layout[0].code).toBe("OUT_OF_GRID");
    expect(bad.variables).toHaveLength(1);
    expect(bad.widgets[0].errors[0].code).toBe("TARGET_COUNT");
    expect(validateDraft(draft, []).widgets).toEqual([]);
    expect(draftOf({ ...dashboard, layout: undefined as never, variables: undefined as never, timeRange: undefined as never, resolution: undefined as never, refresh: undefined as never })).toMatchObject({ timeRange: { relative: "24h" }, resolution: "AUTO", refresh: "LIVE" });
  });

  it("JSON 가져오기: 1MB 상한·JSON 아님·대시보드 내보내기 아님, 공유 링크 만료 1~90일과 상태", () => {
    expect(parseImport("{}", 2 * 1024 * 1024)).toEqual({ ok: false, reason: "TOO_LARGE" });
    expect(parseImport("nope")).toEqual({ ok: false, reason: "NOT_JSON" });
    expect(parseImport('{"dashboard":{}}')).toEqual({ ok: false, reason: "NOT_DASHBOARD" });
    expect(parseImport('{"formatVersion":1,"dashboard":{"name":"A","layout":{"widgets":[]}}}')).toMatchObject({ ok: true, body: { formatVersion: 1 } });
    expect([0, 1, 90, 91, 1.5].map(shareDaysValid)).toEqual([false, true, true, false, false]);
    const now = Date.parse("2026-10-04T00:00:00Z");
    expect(shareLinkStatus({ expiresAt: "2026-10-05T00:00:00Z" }, now)).toBe("ACTIVE");
    expect(shareLinkStatus({ expiresAt: "2026-10-03T00:00:00Z" }, now)).toBe("EXPIRED");
    expect(shareLinkStatus({ expiresAt: "2026-10-05T00:00:00Z", revokedAt: "x" }, now)).toBe("REVOKED");
  });
});
