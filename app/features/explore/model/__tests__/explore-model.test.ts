/**
 * 데이터 탐색기 모델(UI-TSD-01): 조건 인코딩, 기간 검증(TSD-03.01), 조회 경로(API-TSD-02·04), 응답 → 차트 계열, 주석(TSD-01.04), 시간대(TSD-01.05).
 */
import { describe, expect, it } from "vitest";
import { annotationTargets, buildTelemetryRequest, liveTopics, mergeAnnotations, shouldGoLive, toChartSeries } from "../query";
import { MAX_SERIES, addSeries, decodeState, defaultState, encodeState, exploreHref, removeSeries, seriesKey, stateFromShortcut, updateSeries, type SeriesSpec } from "../state";
import { checkRange, localToUtc, resolveRange, utcToLocal } from "../time";

const NOW = Date.parse("2026-10-04T00:00:00Z");
const dev = (metric: string, id = "1042"): SeriesSpec => ({ kind: "device", id, metric, label: `${id} ${metric}` });

describe("조회 조건 주소 인코딩(UI-TSD-01 [링크 복사])", () => {
  it("인코딩한 것을 그대로 되돌린다, 직접 기간은 from·to를 함께", () => {
    const state = { ...defaultState(), series: [dev("co2"), { kind: "space" as const, id: "31", metric: "temperature", label: "실습실", agg: "max", unit: "℃", hidden: true }], range: "custom", from: "2026-10-03T00:00:00Z", to: "2026-10-03T06:00:00Z", resolution: "1h" as const, quality: "all" as const, includeVirtual: true };
    expect(decodeState(encodeState(state))).toEqual(state);
    expect(decodeState(encodeState({ ...defaultState(), from: "x" }))).toEqual(defaultState());
    expect(exploreHref(defaultState())).toMatch(/^\/explore\?q=/);
  });

  it("잘못된 값은 기본값으로, 계열은 50개까지", () => {
    expect(decodeState(null)).toEqual(defaultState());
    expect(decodeState("{bad")).toEqual(defaultState());
    expect(decodeState("1")).toEqual(defaultState());
    const odd = decodeState(JSON.stringify({ series: [{ kind: "x", id: 1, metric: "a" }, { kind: "device", id: 7, metric: "a", agg: "nope" }], range: "custom", resolution: "2h", annotations: ["USER", "BOGUS"] }));
    expect(odd.series).toEqual([{ kind: "device", id: "7", metric: "a", label: "7 a" }]);
    expect(odd.range).toBe("24h");
    expect(odd.resolution).toBe("auto");
    expect(odd.annotations).toEqual(["USER"]);
    const many = decodeState(JSON.stringify({ series: Array.from({ length: 60 }, (_, i) => dev(`m${i}`)) }));
    expect(many.series).toHaveLength(MAX_SERIES);
  });

  it("짧은 주소(?deviceId=&metrics=)", () => {
    expect(stateFromShortcut(new URLSearchParams("deviceId=1042&metrics=co2,temperature&label=AM107"))?.series.map((s) => s.label)).toEqual(["AM107 co2", "AM107 temperature"]);
    expect(stateFromShortcut(new URLSearchParams("deviceId=1042"))).toBeUndefined();
  });

  it("계열 추가(중복 무시, 50개 한도), 수정, 제거, 키", () => {
    let state = defaultState();
    state = addSeries(state, dev("co2")).state;
    expect(addSeries(state, dev("co2")).state.series).toHaveLength(1);
    const full = { ...state, series: Array.from({ length: 50 }, (_, i) => dev(`m${i}`)) };
    expect(addSeries(full, dev("x")).error).toBe("TOO_MANY_SERIES");
    expect(updateSeries(state, 0, { hidden: true }).series[0].hidden).toBe(true);
    expect(removeSeries(state, 0).series).toEqual([]);
    expect(seriesKey(dev("co2"))).toBe("d1042.co2");
    expect(seriesKey({ kind: "space", id: "31", metric: "co2", label: "" })).toBe("s31.co2");
  });
});

describe("기간과 검증(UI-TSD-01 입력 검증, TSD-01.05)", () => {
  it("기간 키는 지금으로 끝나고(실시간 가능), 직접 기간은 그대로", () => {
    expect(resolveRange(defaultState(), NOW)).toEqual({ from: "2026-10-03T00:00:00Z", to: "2026-10-04T00:00:00Z", live: true });
    expect(resolveRange({ ...defaultState(), range: "custom", from: "a", to: "b" }, NOW)).toEqual({ from: "a", to: "b", live: false });
  });

  it("시작 < 종료, 종료 ≤ 지금 + 1일, 원본은 31일까지", () => {
    const custom = (from: string, to: string) => ({ ...defaultState(), range: "custom", from, to });
    expect(checkRange(custom("2026-10-03T10:00:00Z", "2026-10-03T09:00:00Z"), NOW)).toBe("START_AFTER_END");
    expect(checkRange(custom("2026-10-03T10:00:00Z", "2026-10-06T00:00:00Z"), NOW)).toBe("END_TOO_LATE");
    expect(checkRange(custom("x", "y"), NOW)).toBe("INVALID");
    expect(checkRange({ ...defaultState(), range: "90d", resolution: "raw" }, NOW)).toBe("RAW_TOO_LONG");
    expect(checkRange({ ...defaultState(), range: "30d", resolution: "raw" }, NOW)).toBeUndefined();
  });

  it("TC-TSD-027 사용자 시간대 입력 ↔ UTC(Asia/Seoul 10:00 = 01:00Z)", () => {
    expect(localToUtc("2026-10-03T10:00", "Asia/Seoul")).toBe("2026-10-03T01:00:00Z");
    expect(localToUtc("2026-10-03T10:00", "UTC")).toBe("2026-10-03T10:00:00Z");
    expect(localToUtc("bad", "UTC")).toBeUndefined();
    expect(utcToLocal("2026-10-03T01:00:00Z", "Asia/Seoul")).toBe("2026-10-03T10:00");
    expect(utcToLocal(undefined, "UTC")).toBe("");
    expect(utcToLocal("x", "UTC")).toBe("");
  });
});

describe("조회 경로(단일 기기 API-TSD-02, 그 외 API-TSD-04)와 응답 변환", () => {
  const range = { from: "2026-10-03T00:00:00Z", to: "2026-10-04T00:00:00Z" };

  it("숨긴 계열은 빼고 조회, 아무것도 없으면 조회하지 않는다", () => {
    expect(buildTelemetryRequest(defaultState(), range, "UTC").kind).toBe("none");
    const one = buildTelemetryRequest({ ...defaultState(), series: [dev("co2"), dev("temperature"), { ...dev("humidity"), hidden: true }] }, range, "Asia/Seoul");
    expect(one.kind).toBe("series");
    expect(one.kind === "series" && one.path).toContain("metrics=co2%2Ctemperature");
    const multi = buildTelemetryRequest({ ...defaultState(), series: [dev("co2"), dev("co2", "1050")], quality: "all", includeVirtual: true }, range, "UTC");
    expect(multi).toMatchObject({ kind: "query", body: { series: [{ deviceId: "1042" }, { deviceId: "1050" }], quality: "all", virtual: true } });
    expect(buildTelemetryRequest({ ...defaultState(), series: [{ kind: "space", id: "31", metric: "co2", label: "x", agg: "avg" }] }, range, "UTC").kind).toBe("query");
  });

  it("AT-TSD-01.3 원본 단위면 품질 표시용 raw 계열, 응답에 없는 계열은 오류 표시", () => {
    const request = buildTelemetryRequest({ ...defaultState(), series: [dev("temperature"), dev("co2")] }, range, "UTC");
    const series = toChartSeries(request, { resolutionUsed: "raw", series: [{ metric: "temperature", unit: "℃", points: [["2026-10-03T00:00:00Z", 61, 1]], gaps: [{ from: "a", to: "b" }] }] });
    expect(series[0]).toMatchObject({ key: "d1042.temperature", raw: true, unit: "℃", error: false, gaps: [{ from: "a", to: "b" }] });
    expect(series[1]).toMatchObject({ key: "d1042.co2", error: true, points: [] });
    const multi = buildTelemetryRequest({ ...defaultState(), series: [dev("co2"), { kind: "space", id: "31", metric: "co2", label: "s" }] }, range, "UTC");
    const byIndex = toChartSeries(multi, { resolutionUsed: "1h", series: [{ points: [["t", 1, 3]] }, { spaceId: 31, metric: "co2", virtual: true, points: [] }] });
    expect(byIndex.map((s) => [s.error, s.raw, s.virtual])).toEqual([
      [false, false, false],
      [false, false, true],
    ]);
    expect(toChartSeries(multi, undefined).every((s) => s.error)).toBe(true);
  });

  it("주석 대상은 기기·공간마다 한 번(최대 10), 합칠 때 같은 ID는 한 번·종류 필터·시각 순", () => {
    const state = { ...defaultState(), series: [dev("co2"), dev("temperature"), { kind: "space" as const, id: "31", metric: "co2", label: "" }] };
    expect(annotationTargets(state)).toEqual([
      { param: "deviceId", id: "1042" },
      { param: "spaceId", id: "31" },
    ]);
    const merged = mergeAnnotations(
      [
        [{ id: "a2", timeFrom: "2026-10-03T22:00:00Z", type: "USER", title: "b" }],
        [
          { id: "a2", timeFrom: "2026-10-03T22:00:00Z", type: "USER", title: "b" },
          { id: "a1", timeFrom: "2026-10-03T21:00:00Z", type: "OFFLINE", title: "a" },
          { id: "a3", timeFrom: "2026-10-03T20:00:00Z", type: "ALARM", title: "c" },
        ],
      ],
      ["USER", "OFFLINE"],
    );
    expect(merged.map((a) => a.id)).toEqual(["a1", "a2"]);
  });

  it("실시간: 기기 계열 토픽, 끝이 지금이고 원본·1분일 때만", () => {
    expect(liveTopics({ ...defaultState(), series: [dev("co2"), { ...dev("t"), hidden: true }, { kind: "space", id: "31", metric: "co2", label: "" }] })).toEqual(["telemetry:1042.co2"]);
    expect(shouldGoLive(true, "raw")).toBe(true);
    expect(shouldGoLive(true, "1m")).toBe(true);
    expect(shouldGoLive(true, "1h")).toBe(false);
    expect(shouldGoLive(false, "raw")).toBe(false);
  });
});
