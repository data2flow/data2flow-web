/**
 * 기기·모델 데이터 관리 화면 모델 단위 시험: 검색식 검사·자동완성(DEV-13.03, BR-DEV-35 — core DeviceQueryParser와 같은 열),
 * 단위 변환(DEV-04.04), 게이트웨이 분포(DEV-05.02), 표준 내보내기 작업(DEV-13.04), 서버 도우미.
 */
import { describe, expect, it } from "vitest";
import { applySuggestion, looksLikeExpression, operatorsOf, parseDeviceQuery, splitAtColumn, suggest, tokenize } from "../model/query";
import { checkGatewayInput, gatewayRange, rssiChartOption, sharePercent, signal, statusTone, uplinkChartOption } from "../model/gateways";
import { jobFinished, modelFileName, spaceName, toBffUrl } from "../model/types";
import { queryCounts, queryProblem } from "../server";
import { displayUnit, effectiveTemperatureUnit, exportUnitLabel, isCelsius, normalizeTemperatureUnit, toDisplay, toDisplayLatest, toDisplaySeries, toDisplaySeriesList } from "~/lib/units";

describe("DEV-13.03 검색식 검사(BR-DEV-35)", () => {
  it("TC-DEV-313 AT-DEV-25.2: `battery < `는 값 자리(열 11)에서 '값이 필요'", () => {
    expect(parseDeviceQuery("battery < ")).toEqual({ ok: false, column: 11, code: "valueExpected", detail: undefined });
    expect(parseDeviceQuery("battery <")).toMatchObject({ ok: false, column: 10 });
  });

  it("TC-DEV-313: 예시 검색식 → and 노드와 비교 3개(값 종류 포함)", () => {
    const result = parseDeviceQuery('model = "EM300-TH" and battery < 20 and space in "3층"');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ast).toEqual({
      node: "and",
      items: [
        { node: "cmp", field: "model", op: "=", values: ["EM300-TH"], kinds: ["STRING"], column: 1 },
        { node: "cmp", field: "battery", op: "<", values: ["20"], kinds: ["NUMBER"], column: 24 },
        { node: "cmp", field: "space", op: "in", values: ["3층"], kinds: ["STRING"], column: 41 },
      ],
    });
  });

  it("TC-DEV-313: or·not·괄호·in 목록·기간·참거짓·동적 필드·== 표기", () => {
    const r = parseDeviceQuery("not (status = ACTIVE or tag in ('a', \"b\")) and lastSeen < 24h and virtual = true and metric.co2 >= 1000 and attr.floor == 3");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ast.node).toBe("and");
    const items = (r.ast as { items: unknown[] }).items as { node: string; kinds?: string[]; field?: string; op?: string }[];
    expect(items[0].node).toBe("not");
    expect(items[1]).toMatchObject({ field: "lastseen", kinds: ["DURATION"] });
    expect(items[2]).toMatchObject({ kinds: ["BOOLEAN"] });
    expect(items[3]).toMatchObject({ field: "metric.co2", op: ">=" });
    expect(items[4]).toMatchObject({ field: "attr.floor", op: "=" });
    expect(parseDeviceQuery("name ~ lab or externalId != x")).toMatchObject({ ok: true, ast: { node: "or" } });
  });

  it("TC-DEV-314: 오류 종류와 열", () => {
    expect(parseDeviceQuery("")).toMatchObject({ code: "empty", column: 1 });
    expect(parseDeviceQuery("x".repeat(2001))).toMatchObject({ code: "tooLong", column: 2001 });
    expect(parseDeviceQuery('name = "abc')).toMatchObject({ code: "unclosedString", column: 8 });
    expect(parseDeviceQuery(`name = "${"a".repeat(201)}"`)).toMatchObject({ code: "valueTooLong" });
    expect(parseDeviceQuery("battery ! 3")).toMatchObject({ code: "unknownOperator", column: 9 });
    expect(parseDeviceQuery("= 3")).toMatchObject({ code: "fieldExpected", column: 1 });
    expect(parseDeviceQuery("colour = red")).toMatchObject({ code: "unknownField", detail: "colour" });
    expect(parseDeviceQuery("battery 3")).toMatchObject({ code: "operatorExpected", column: 9 });
    expect(parseDeviceQuery("status < 3")).toMatchObject({ code: "operatorNotAllowed", detail: "<" });
    expect(parseDeviceQuery("battery < and")).toMatchObject({ code: "valueExpected", column: 11 });
    expect(parseDeviceQuery("(battery < 3")).toMatchObject({ code: "rparenExpected" });
    expect(parseDeviceQuery("battery < 3 3")).toMatchObject({ code: "unexpectedToken", column: 13 });
    expect(parseDeviceQuery("tag in (a b)")).toMatchObject({ code: "rparenExpected" });
    const many = Array.from({ length: 51 }, () => "battery < 1").join(" and ");
    expect(parseDeviceQuery(many)).toMatchObject({ code: "tooManyTerms" });
  });

  it("TC-DEV-313: 키워드인지 검색식인지(core looksLikeExpression과 같다)와 낱말 나누기", () => {
    expect(looksLikeExpression("AM107")).toBe(false);
    expect(looksLikeExpression("")).toBe(false);
    expect(looksLikeExpression(null)).toBe(false);
    expect(looksLikeExpression("battery<3")).toBe(true);
    expect(looksLikeExpression("tag in pilot")).toBe(true);
    expect(looksLikeExpression("not x")).toBe(true);
    expect(tokenize("a<=1, 'x\\'y'").map((t) => t.type)).toEqual(["WORD", "OP", "NUMBER", "COMMA", "STRING", "END"]);
    expect(operatorsOf("Battery")).toContain("<");
    expect(operatorsOf("metric.")).toBeUndefined();
  });

  it("UI-DEV-19: 오류 위치 밑줄용 나누기", () => {
    expect(splitAtColumn("battery < ", 11)).toEqual({ before: "battery < ", at: " ", after: "" });
    expect(splitAtColumn("abc", 2)).toEqual({ before: "a", at: "b", after: "c" });
  });

  it("UI-DEV-19: 자동완성 — 필드·연산자·and/or", () => {
    expect(suggest("")).toMatchObject({ kind: "field" });
    expect(suggest("bat")).toEqual({ kind: "field", items: ["battery"], replaceFrom: 0 });
    expect(suggest("battery ")).toMatchObject({ kind: "operator", items: ["=", "!=", "<", "<=", ">", ">="] });
    expect(suggest("battery < 3 ")).toMatchObject({ kind: "keyword", items: ["and", "or"] });
    expect(suggest("battery < 3 a")).toMatchObject({ kind: "keyword", items: ["and"], replaceFrom: 12 });
    expect(suggest("battery < 3 and m")).toMatchObject({ kind: "field", items: ["model", "metric."] });
    expect(suggest("colour ")).toMatchObject({ kind: "none" });
    expect(suggest('name = "x')).toMatchObject({ kind: "none" });
    expect(suggest("battery <")).toMatchObject({ kind: "none" });
    expect(applySuggestion("battery < 3 a", 12, "and")).toBe("battery < 3 and ");
    expect(applySuggestion("", 0, "metric.")).toBe("metric.");
  });
});

describe("DEV-04.04 단위 체계 변환", () => {
  it("TC-DEV-140: 22.0℃ → 71.6℉, 온도가 아니면 그대로, 저장 단위 표기는 내보내기에 함께", () => {
    expect(toDisplay(22, "℃", "F")).toBe(71.6);
    expect(toDisplay(22.3, "°C", "F")).toBe(72.1);
    expect(toDisplay(22, "℃", "C")).toBe(22);
    expect(toDisplay(50, "%", "F")).toBe(50);
    expect(toDisplay(null, "℃", "F")).toBeNull();
    expect(displayUnit("celsius", "F")).toBe("℉");
    expect(displayUnit("ppm", "F")).toBe("ppm");
    expect(exportUnitLabel("℃", "F")).toBe("℉ (stored: ℃)");
    expect(exportUnitLabel("℃", "C")).toBe("℃");
    expect(exportUnitLabel(null, "F")).toBe("");
    expect(isCelsius(undefined)).toBe(false);
    expect(normalizeTemperatureUnit("f")).toBe("F");
    expect(normalizeTemperatureUnit(3)).toBe("C");
    expect(effectiveTemperatureUnit({ temperatureUnit: null, effectiveTemperatureUnit: "F" })).toBe("F");
    expect(effectiveTemperatureUnit({ temperatureUnit: "F" })).toBe("F");
    expect(effectiveTemperatureUnit(null)).toBe("C");
  });

  it("TC-DEV-140: 차트 계열·현재값 카드 변환(저장값 객체는 바꾸지 않는다)", () => {
    const series = { key: "temperature", label: "온도", unit: "℃", points: [["2026-10-04T00:00:00Z", 20, 0] as [string, number, number], ["2026-10-04T00:01:00Z", null, null] as [string, null, null]] };
    const shown = toDisplaySeries(series, "F");
    expect(shown.unit).toBe("℉");
    expect(shown.points.map((p) => p[1])).toEqual([68, null]);
    expect(series.points[0][1]).toBe(20);
    expect(toDisplaySeries(series, "C")).toBe(series);
    const humid = { key: "h", label: "h", unit: "%", points: [] };
    expect(toDisplaySeriesList([humid], "F")[0]).toBe(humid);
    const list = [series];
    expect(toDisplaySeriesList(list, "C")).toBe(list);
    const latest = [
      { metricKey: "temperature", unit: "℃", value: 22.3 },
      { metricKey: "co2", unit: "ppm", value: 517 },
    ];
    expect(toDisplayLatest(latest, "F")).toEqual([
      { metricKey: "temperature", unit: "℉", value: 72.1 },
      { metricKey: "co2", unit: "ppm", value: 517 },
    ]);
    expect(toDisplayLatest(latest, "C")).toBe(latest);
  });
});

describe("DEV-05.02 게이트웨이 분포", () => {
  it("TC-DEV-151: 표시 도우미·입력 검사·기간", () => {
    expect(statusTone("ONLINE")).toBe("good");
    expect(statusTone("OFFLINE")).toBe("bad");
    expect(statusTone("UNKNOWN")).toBe("muted");
    expect(sharePercent(0.625)).toBe("63%");
    expect(sharePercent(null)).toBe("–");
    expect(signal(-33.04)).toBe("-33.0");
    expect(signal(undefined)).toBe("–");
    expect(checkGatewayInput({ name: " ", offlineAfterSec: "59" })).toEqual({ name: "name", offlineAfterSec: "offline" });
    expect(checkGatewayInput({ name: "GW", offlineAfterSec: "86400" })).toEqual({});
    const now = Date.parse("2026-10-04T00:00:00Z");
    expect(gatewayRange("7d", now)).toEqual({ period: "7d", from: "2026-09-27T00:00:00.000Z", to: "2026-10-04T00:00:00.000Z" });
    expect(gatewayRange("bogus", now).period).toBe("24h");
    expect(gatewayRange("30d", now).from).toBe("2026-09-04T00:00:00.000Z");
  });

  it("TC-DEV-151: 업링크 막대·rssi 히스토그램 옵션", () => {
    const up = uplinkChartOption({ uplinksByHour: [{ t: "2026-10-03T23:00:00Z", count: 61 }] }, { uplinks: "업링크" }, (iso) => iso.slice(11, 16)) as { xAxis: { data: string[] }; series: { data: number[] }[] };
    expect(up.xAxis.data).toEqual(["23:00"]);
    expect(up.series[0].data).toEqual([61]);
    const hist = rssiChartOption({ rssiHistogram: [{ fromDbm: -100, toDbm: -90, count: 2 }] }, { devices: "기기" }) as { xAxis: { data: string[] }; series: { data: number[] }[] };
    expect(hist.xAxis.data).toEqual(["-100~-90"]);
    expect(hist.series[0].data).toEqual([2]);
  });
});

describe("DEV-13.04·03.04 내보내기 도우미, 서버 도우미", () => {
  it("TC-DEV-319: 작업 끝 판정·BFF 주소·파일 이름·공간 이름", () => {
    expect(jobFinished("DONE")).toBe(true);
    expect(jobFinished("FAILED")).toBe(true);
    expect(jobFinished("RUNNING")).toBe(false);
    expect(jobFinished(undefined)).toBe(false);
    expect(toBffUrl("/api/v1/core/export-jobs/9/file")).toBe("/bff/api/core/export-jobs/9/file");
    expect(toBffUrl("http://gw/api/v1/core/x")).toBe("/bff/api/core/x");
    expect(toBffUrl(null)).toBeNull();
    expect(modelFileName("EM300-TH", "dtdl")).toBe("EM300-TH.dtdl.json");
    expect(modelFileName("a/b c", "data2flow")).toBe("a_b_c.data2flow.json");
    expect(modelFileName("", "data2flow")).toBe("model.data2flow.json");
    expect(spaceName([{ id: "3", type: "FLOOR", name: "3층" }], "3")).toBe("3층");
    expect(spaceName([], "9")).toBe("9");
  });

  it("TC-DEV-314: 400 DEVICE_QUERY_INVALID만 입력란 오류로, 건수는 검색식일 때만", () => {
    expect(queryProblem({ ok: false, status: 400, code: "DEVICE_QUERY_INVALID", message: "x", detail: { column: 11, message: "값이 필요합니다" } })).toEqual({ code: "DEVICE_QUERY_INVALID", column: 11, message: "값이 필요합니다" });
    expect(queryProblem({ ok: false, status: 400, code: "DEVICE_QUERY_TIMEOUT", message: "x" })).toEqual({ code: "DEVICE_QUERY_TIMEOUT", column: 1, message: undefined });
    expect(queryProblem({ ok: false, status: 400, code: "INVALID_REQUEST", message: "" })).toBeNull();
    expect(queryProblem({ ok: true, status: 200, list: { header: { isSuccessful: true, resultCode: "SUCCESS", resultMessage: "" }, responses: [] } })).toBeNull();
    const header = { isSuccessful: true, resultCode: "SUCCESS", resultMessage: "" };
    expect(queryCounts({ header, responses: [], counts: { total: 12, tookMs: 84 } } as never)).toEqual({ total: 12, tookMs: 84 });
    expect(queryCounts({ header, responses: [], counts: { total: 3 } } as never)).toEqual({ total: 3, tookMs: 0 });
    expect(queryCounts({ header, responses: [] })).toBeNull();
  });
});
