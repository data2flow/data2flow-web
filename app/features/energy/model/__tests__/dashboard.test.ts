import { describe, expect, it } from "vitest";
import { diffText, diffTone, granularityOf, periodRange, trendOption } from "../dashboard";

describe("UI-ENE-03 에너지 대시보드 계산", () => {
  it("기간: 이번 달·지난달(연 넘김)·올해, 잘못된 사용자 지정은 이번 달", () => {
    expect(periodRange("thisMonth", "2026-10-04")).toEqual({ period: "thisMonth", from: "2026-10-01", to: "2026-10-04" });
    expect(periodRange("lastMonth", "2026-01-15")).toEqual({ period: "lastMonth", from: "2025-12-01", to: "2025-12-31" });
    expect(periodRange("thisYear", "2026-10-04")).toEqual({ period: "thisYear", from: "2026-01-01", to: "2026-10-04" });
    expect(periodRange("custom", "2026-10-04", { from: "2026-09-01", to: "2026-09-30" })).toEqual({ period: "custom", from: "2026-09-01", to: "2026-09-30" });
    expect(periodRange("custom", "2026-10-04", { from: "2026-09-30", to: "2026-09-01" }).period).toBe("thisMonth");
    expect(periodRange("custom", "2026-10-04", { from: "x", to: "2026-09-01" }).period).toBe("thisMonth");
  });

  it("93일까지 일 칸, 넘으면 월 칸", () => {
    expect(granularityOf("2026-07-01", "2026-10-01")).toBe("DAY");
    expect(granularityOf("2026-01-01", "2026-10-04")).toBe("MONTH");
  });

  it("증감 표시와 색(줄면 좋음)", () => {
    expect(diffText(-0.041)).toBe("−4.1%");
    expect(diffText(0.065)).toBe("+6.5%");
    expect(diffText(0)).toBe("0.0%");
    expect(diffText(null)).toBeNull();
    expect(diffTone(-0.1)).toBe("success");
    expect(diffTone(0.1)).toBe("danger");
    expect(diffTone(undefined)).toBe("neutral");
  });

  it("추이: 측정분과 추정분(빗금)을 쌓고, 기준선이 있으면 선을 더한다", () => {
    const labels = { measured: "측정", estimated: "추정", baseline: "기준선", unit: "kWh" };
    const plain = trendOption([{ t: "2026-10-01", kwh: 100, estimatedKwh: 30 }], labels, false) as { series: { name: string; data: unknown[] }[] };
    expect(plain.series.map((s) => s.name)).toEqual(["측정", "추정"]);
    expect(plain.series[0].data).toEqual([70]);
    expect(plain.series[1].data).toEqual([30]);
    const withBase = trendOption([{ t: "2026-10-01", kwh: 100, baselineKwh: 120 }], labels, true) as { series: { name: string; data: unknown[] }[] };
    expect(withBase.series.map((s) => s.name)).toEqual(["측정", "추정", "기준선"]);
    expect(withBase.series[2].data).toEqual([120]);
  });
});
