/**
 * 시뮬레이션 모델(UI-RUL-03, BR-RUL-23) — 기간(30일), 데이터 부족, 비교 행, 히트맵·일별 막대 옵션.
 */
import { describe, expect, it } from "vitest";
import { compareRows, dailyBarOption, heatmapOption, lowCoverage, simulationRange, sortedDevices, validRange } from "../simulation";
import type { SimulationResult } from "../types";

const result: SimulationResult = {
  alarms: 14,
  notifications: 14,
  avgDurationSec: 540,
  byDevice: [
    { deviceId: "1", name: "A", count: 5, longestSec: 100 },
    { deviceId: "2", name: "B", count: 6, longestSec: 50 },
    { deviceId: "3", name: "C", count: 5, longestSec: 300 },
  ],
  heatmap: [{ dow: 1, hour: 9, count: 3 }, { dow: 7, hour: 23, count: 1 }, { dow: 8, hour: 1, count: 9 }],
  coverage: { dataRatio: 0.05 },
};

describe("RUL-01.11 시뮬레이션 모델", () => {
  it("기간: 최근 N일, 30일 넘으면 거부", () => {
    const now = Date.parse("2026-10-04T00:00:00Z");
    expect(simulationRange(7, now)).toEqual({ from: "2026-09-27T00:00:00.000Z", to: "2026-10-04T00:00:00.000Z" });
    expect(validRange("2026-09-04T00:00:00Z", "2026-10-04T00:00:00Z")).toBe(true);
    expect(validRange("2026-09-03T00:00:00Z", "2026-10-04T00:00:00Z")).toBe(false);
    expect(validRange("x", "2026-10-04T00:00:00Z")).toBe(false);
  });

  it("데이터 10% 미만 안내, 이전 결과 비교, 기기별 정렬", () => {
    expect(lowCoverage(result)).toBe(true);
    expect(lowCoverage({ ...result, coverage: { dataRatio: 0.5 } })).toBe(false);
    expect(lowCoverage(null)).toBe(false);
    expect(compareRows(result, { ...result, alarms: 5, avgDurationSec: null })).toEqual([
      { key: "alarms", current: 14, previous: 5 },
      { key: "notifications", current: 14, previous: 14 },
      { key: "avgDurationSec", current: 540, previous: null },
    ]);
    expect(compareRows(result)[0].previous).toBeNull();
    expect(sortedDevices(result).map((d) => d.deviceId)).toEqual(["2", "3", "1"]);
  });

  it("히트맵: 요일(월=1) × 시 셀, 범위 밖 셀은 버리고 최댓값으로 색 범위", () => {
    const option = heatmapOption(result, ["월", "화", "수", "목", "금", "토", "일"]) as { series: { data: number[][] }[]; visualMap: { max: number }; yAxis: { data: string[] } };
    expect(option.series[0].data).toEqual([[9, 0, 3], [23, 6, 1]]);
    expect(option.visualMap.max).toBe(3);
    expect(option.yAxis.data[0]).toBe("월");
    expect((heatmapOption({ ...result, heatmap: [] }, [], true) as { visualMap: { max: number } }).visualMap.max).toBe(1);
  });

  it("일별 막대(알람 통계)", () => {
    const option = dailyBarOption([{ date: "2026-10-02", raised: 12 }], "발생") as { xAxis: { data: string[] }; series: { data: number[]; name: string }[] };
    expect(option.xAxis.data).toEqual(["10-02"]);
    expect(option.series[0]).toMatchObject({ data: [12], name: "발생" });
  });
});
