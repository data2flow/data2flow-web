/**
 * DSH-05.04 차트에 알람 발생·해제와 제어 이벤트 주석 겹쳐 표시(TC-DSH-060): 알람은 빨간 세로선, 제어는 아이콘 마커, 툴팁에 내용과 시각.
 */
import { describe, expect, it } from "vitest";
import { annotationKind, buildChartOption, fromWidgetAnnotations } from "../chart-model";

const labels = { outOfRange: "범위 초과", suspect: "의심", virtual: "가상", noData: "데이터 없음", gap: "공백" };
const series = [{ key: "d17.temperature", label: "온도", unit: "℃", points: [["2026-10-03T01:00:00Z", 27, 0], ["2026-10-03T02:00:00Z", 25, 0]] as [string, number, number][] }];

describe("[DSH-05.04] 알람·제어 주석", () => {
  it("TC-DSH-060 위젯 주석(API-DSH-09 annotations[])을 차트 주석으로, 잘못된 시각은 버린다", () => {
    expect(fromWidgetAnnotations([{ t: "2026-10-03T01:10:00Z", type: "ALARM", label: "고온", link: "/alarms/9" }, { t: "x", type: "CONTROL", label: "버림" }])).toEqual([{ id: "w0", timeFrom: "2026-10-03T01:10:00Z", type: "ALARM", title: "고온", link: "/alarms/9" }]);
    expect(fromWidgetAnnotations(undefined)).toEqual([]);
    expect(annotationKind("ALARM_CLEARED")).toBe("alarm");
    expect(annotationKind("CONTROL")).toBe("control");
    expect(annotationKind("USER")).toBe("note");
  });

  it("TC-DSH-060 알람은 빨간 실선 세로선, 제어는 핀 마커가 달린 파란 선, 툴팁은 표시 시간대 시각", () => {
    const option = buildChartOption(series, {
      timezone: "Asia/Seoul",
      labels,
      annotations: [
        { timeFrom: "2026-10-03T01:10:00Z", type: "ALARM_RAISED", title: "실습실 고온" },
        { timeFrom: "2026-10-03T01:40:00Z", type: "ALARM_CLEARED", title: "실습실 고온" },
        { timeFrom: "2026-10-03T01:15:00Z", type: "CONTROL", title: "냉방 24℃" },
        { timeFrom: "2026-10-03T01:20:00Z", type: "USER", title: "필터 교체" },
        { timeFrom: "bad", type: "CONTROL", title: "버림" },
        { timeFrom: "2026-10-03T01:30:00Z", timeTo: "2026-10-03T01:35:00Z", type: "OFFLINE", title: "끊김" },
      ],
    });
    const first = (option.series as { markLine: { data: Record<string, unknown>[] }; markArea: { data: unknown[] } }[])[0];
    const [raised, cleared, control, note] = first.markLine.data;
    expect(first.markLine.data).toHaveLength(4);
    expect(raised).toMatchObject({ xAxis: Date.parse("2026-10-03T01:10:00Z"), label: { formatter: "▲ 실습실 고온" }, lineStyle: { type: "solid", color: "#d63939" }, tooltip: { formatter: "▲ 실습실 고온 · 10-03 10:10" } });
    expect(cleared).toMatchObject({ label: { formatter: "✔ 실습실 고온" } });
    expect(control).toMatchObject({ symbol: ["none", "pin"], label: { formatter: "⚙ 냉방 24℃" }, lineStyle: { type: "dashed", color: "#206bc4" }, tooltip: { formatter: "⚙ 냉방 24℃ · 10-03 10:15" } });
    expect(note).toMatchObject({ label: { formatter: "필터 교체" } });
    expect(first.markArea.data).toHaveLength(1);
  });
});
