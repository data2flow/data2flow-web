/**
 * TC-ENE-031(AT-ENE-03.1) 대시보드 위젯 energy-kpi·energy-trend: API-ENE-10 응답을 그리고, 추정 포함 비율 배지와 건물 → 공간 드릴다운을 보여 준다.
 * 로딩·빈 결과·오류 상태도 확인한다.
 */
import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderRoute } from "../../../../test/render";
import { DashboardView } from "~/features/dashboards/components/dashboard-view";
import type { Widget, WidgetData } from "~/features/dashboards/model/types";
import { chartFactory, fakeFetcher } from "~/features/dashboards/__tests__/fakes";
import { energyTrendOption, kpiEmpty, type EnergyKpiPayload, type EnergyTrendPayload } from "../model/widgets";

const KPI: EnergyKpiPayload = {
  scope: { spaceId: "2", name: "본관", kind: "BUILDING" },
  from: "2026-10-01",
  to: "2026-10-03",
  totals: { kwh: 6020, krw: 903000, tco2: 2.75, euiKwhPerM2: 12.04, estimatedRatio: 0.12 },
  compare: { kind: "PREVIOUS_PERIOD", kwh: 6277, diffRatio: -0.041 },
  children: [
    { id: "3", name: "3층", kind: "FLOOR", kwh: 4020, share: 0.668, estimatedRatio: 0.18 },
    { id: "31", name: "실습실", kind: "ROOM", kwh: 2000, share: 0.332, estimatedRatio: 0 },
  ],
};
const TREND: EnergyTrendPayload = {
  scope: { spaceId: "2", name: "본관" },
  from: "2026-10-01",
  to: "2026-10-03",
  granularity: "DAY",
  measure: "kwh",
  series: [
    { t: "2026-10-01", kwh: 2000, estimatedKwh: 240, baselineKwh: 2100 },
    { t: "2026-10-02", kwh: 2010, estimatedKwh: 240, baselineKwh: null },
  ],
};

const kpiWidget: Widget = { id: "k", type: "energy-kpi", title: "본관 에너지", x: 0, y: 0, w: 6, h: 6, targets: [{ kind: "SPACE", spaceId: "2" }] };
const trendWidget: Widget = { id: "t", type: "energy-trend", title: "본관 추이", x: 6, y: 0, w: 12, h: 8, targets: [{ kind: "SPACE", spaceId: "2" }] };

function view(widgets: Widget[], data: Record<string, WidgetData | { error: string }>) {
  const { fetcher, calls } = fakeFetcher(widgets, (id) => {
    const d = data[id];
    if (!d) return undefined;
    return "error" in d ? { ok: false as const, status: 503, code: d.error, message: d.error } : { ok: true as const, status: 200, data: d };
  });
  const charts = chartFactory();
  renderRoute(<DashboardView name="에너지" widgets={widgets} variables={[]} timeRange={{ relative: "7d" }} resolution="AUTO" refresh="OFF" fetcher={fetcher} timezone="Asia/Seoul" chartFactory={charts.factory} />);
  return { calls, charts };
}

describe("ENE-01.05 대시보드 위젯", () => {
  it("TC-ENE-031 energy-kpi: 사용량·비교 배지·비용·탄소·EUI, 추정 포함 12% 배지, 하위 공간을 누르면 그 공간 에너지 대시보드로", async () => {
    view([kpiWidget], { k: { type: "energy-kpi", data: KPI } });
    const card = await screen.findByText("6,020kWh");
    const body = card.closest("[data-energy-kpi]") as HTMLElement;
    expect(within(body).getByText("직전 기간 −4.1%")).toBeInTheDocument();
    expect(within(body).getByText("추정 포함 12.0%")).toBeInTheDocument();
    expect(within(body).getByText("2.75tCO2eq")).toBeInTheDocument();
    expect(card.closest("a")).toHaveAttribute("href", "/energy?scope=2");
    const children = within(body).getByRole("list", { name: "하위 단위" });
    expect(within(children).getAllByRole("link").map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["3층", "/energy?scope=3"],
      ["실습실", "/energy?scope=31"],
    ]);
    expect(within(body).getByText("본관 · 2026-10-01 ~ 2026-10-03")).toBeInTheDocument();
  });

  it("TC-ENE-031 energy-trend: 측정·추정(빗금)·기준선 계열을 그린다", async () => {
    const { charts } = view([trendWidget], { t: { type: "energy-trend", data: TREND } });
    await waitFor(() => expect(charts.charts[0]?.options.length).toBeGreaterThan(0));
    const option = charts.charts[0].options.at(-1) as { xAxis: { data: string[] }; series: { name: string; data: (number | null)[] }[] };
    expect(option.xAxis.data).toEqual(["2026-10-01", "2026-10-02"]);
    expect(option.series.map((s) => s.name)).toEqual(["측정", "추정", "기준선"]);
    expect(option.series[0].data).toEqual([1760, 1770]);
    expect(screen.getByRole("img", { name: "본관 에너지 추이(2026-10-01 ~ 2026-10-03)" })).toBeInTheDocument();
  });

  it("TC-ENE-031 로딩·빈 결과·오류: 불러오는 중 표시, 사용량이 없으면 안내, 분석 서비스 오류는 위젯만 오류", async () => {
    const pending = vi.fn(() => new Promise<never>(() => undefined));
    const { unmount } = await renderRoute(<DashboardView name="에너지" widgets={[kpiWidget]} variables={[]} timeRange={{ relative: "7d" }} resolution="AUTO" refresh="OFF" fetcher={pending} timezone="Asia/Seoul" />);
    expect(await screen.findByRole("status", { name: "불러오는 중" })).toBeInTheDocument();
    unmount();

    const empty = { ...KPI, totals: { kwh: 0 }, children: [] };
    view([kpiWidget, trendWidget], { k: { type: "energy-kpi", data: empty }, t: { error: "ANALYTICS_UNAVAILABLE" } });
    expect(await screen.findByText("이 기간에 집계된 사용량이 없습니다")).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent("ANALYTICS_UNAVAILABLE");
  });

  it("모델: 빈 결과 판정과 비용 추이는 막대 하나", () => {
    expect(kpiEmpty(null)).toBe(true);
    expect(kpiEmpty({ ...KPI, totals: { kwh: 0 }, children: [] })).toBe(true);
    expect(kpiEmpty(KPI)).toBe(false);
    const option = energyTrendOption({ ...TREND, measure: "krw", series: [{ t: "2026-10", kwh: 1, krw: 150 }] }, { measured: "측정", estimated: "추정", baseline: "기준선", unit: "KRW" }, false) as { series: { type: string; data: unknown[] }[] };
    expect(option.series).toHaveLength(1);
    expect(option.series[0]).toMatchObject({ type: "bar", data: [150] });
  });
});
