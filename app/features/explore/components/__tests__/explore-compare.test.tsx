/**
 * TSD-03.03 여러 측정 항목·기기 비교(UI-TSD-01·07, TC-TSD-069·074)와 탐색기 [내보내기](UI-TSD-02, TSD-04.01).
 */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderRoute } from "../../../../../test/render";
import type { ChartHandle } from "~/components/charts/timeseries-chart";
import { fakeDataApi } from "~/features/data/__tests__/fake-data-api";
import { defaultState, MAX_SERIES, type ExploreState, type SeriesSpec } from "../../model/state";
import type { ExploreData } from "../../model/types";
import { ExploreView } from "../explore-view";
import { SeriesPanel } from "../series-panel";

const spec = (id: string, metric: string, label: string): SeriesSpec => ({ kind: "device", id, metric, label });
const point = (v: number) => ["2026-10-03T23:01:00Z", v, 0] as [string, number, number];

function makeData(patch: Partial<ExploreData> = {}): ExploreData {
  const state: ExploreState = { ...defaultState(), series: [spec("1042", "temperature", "실습실 온도"), spec("1042", "co2", "AM107 co2"), spec("1043", "LAeq", "WS302 소음")] };
  return {
    state,
    range: { from: "2026-10-03T23:00:00Z", to: "2026-10-04T00:00:00Z", live: false },
    result: { resolutionUsed: "1m", reason: "AUTO" },
    series: [
      { key: "d1042.temperature", label: "실습실 온도", unit: "℃", points: [point(22), ["2026-10-03T23:30:00Z", 26, 0]] },
      { key: "d1042.co2", label: "AM107 co2", unit: "ppm", points: [point(520)] },
      { key: "d1043.LAeq", label: "WS302 소음", unit: "dB", points: [point(31)] },
    ],
    annotations: [],
    spaces: [],
    canAnnotate: false,
    canExport: true,
    timezone: "Asia/Seoul",
    ...patch,
  };
}

function chart() {
  const options: Record<string, unknown>[] = [];
  const handle: ChartHandle = { setOption: (o) => options.push(o), resize: () => {}, dispose: () => {} };
  return { options, factory: async () => handle };
}

describe("TSD-03.03 비교 보기", () => {
  it("TC-TSD-069 단위가 3개(℃·ppm·dB)면 정규화 보기를 권하고, 누르면 주소 상태(normalize)를 바꾼다", async () => {
    const onNavigate = vi.fn();
    const c = chart();
    await renderRoute(<ExploreView data={makeData()} onNavigate={onNavigate} chartFactory={c.factory} dataApi={fakeDataApi()} />);
    expect(await screen.findByText(/단위가 3개 이상이라 축 2개로 모두 그릴 수 없습니다/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "정규화 보기" }));
    expect(onNavigate).toHaveBeenCalledWith(expect.objectContaining({ normalize: true }));
  });

  it("정규화 보기가 켜지면 차트는 0~100%(축 하나), [원래 값 보기]로 끈다", async () => {
    const onNavigate = vi.fn();
    const c = chart();
    const data = makeData();
    await renderRoute(<ExploreView data={{ ...data, state: { ...data.state, normalize: true } }} onNavigate={onNavigate} chartFactory={c.factory} dataApi={fakeDataApi()} />);
    expect(await screen.findByText(/정규화 보기: 계열마다/)).toBeInTheDocument();
    await waitFor(() => expect(c.options.length).toBeGreaterThan(0));
    const option = c.options.at(-1) as { yAxis: { name: string }[]; series: { name: string; data: [number, number | null][] }[] };
    expect(option.yAxis.map((a) => a.name)).toEqual(["%"]);
    expect(option.series[0].name).toBe("실습실 온도 [℃] (%)");
    expect(option.series[0].data.map((d) => d[1])).toEqual([0, 100]);
    await userEvent.click(screen.getByRole("button", { name: "원래 값 보기" }));
    expect(onNavigate).toHaveBeenCalledWith(expect.objectContaining({ normalize: false }));
  });

  it("AT-TSD-03.1 단위가 2개면 제안 없이 축 2개(℃, ppm)", async () => {
    const c = chart();
    const data = makeData();
    await renderRoute(<ExploreView data={{ ...data, state: { ...data.state, series: data.state.series.slice(0, 2), normalize: true }, series: data.series.slice(0, 2) }} onNavigate={() => {}} chartFactory={c.factory} dataApi={fakeDataApi()} />);
    await waitFor(() => expect(c.options.length).toBeGreaterThan(0));
    expect(screen.queryByRole("button", { name: "정규화 보기" })).toBeNull();
    expect((c.options.at(-1) as { yAxis: { name: string }[] }).yAxis.map((a) => a.name)).toEqual(["℃", "ppm"]);
  });

  it("TC-TSD-074 시계열이 50개면 [+ 시계열 추가]를 막고 안내한다", async () => {
    const state = { ...defaultState(), series: Array.from({ length: MAX_SERIES }, (_, i) => spec(String(i), "temperature", `기기 ${i}`)) };
    await renderRoute(<SeriesPanel state={state} onChange={() => {}} onAdd={() => {}} />);
    expect(await screen.findByRole("button", { name: "+ 시계열 추가" })).toBeDisabled();
    expect(screen.getByText("한 번에 50개까지 비교할 수 있습니다")).toBeInTheDocument();
  });
});

describe("TSD-04.01 탐색기 [내보내기]", () => {
  it("TC-TSD-074 [내보내기]는 TS_EXPORT일 때만, 대화상자는 보이는 계열의 API-TSD-04 조건으로 연다", async () => {
    const api = fakeDataApi({ listExports: vi.fn(async () => ({ ok: true as const, status: 200, data: { responses: [] } })) });
    const data = makeData();
    await renderRoute(<ExploreView data={{ ...data, state: { ...data.state, series: [...data.state.series.slice(0, 2), { ...data.state.series[2], hidden: true }] } }} onNavigate={() => {}} chartFactory={chart().factory} dataApi={api} />);
    expect(await screen.findByRole("link", { name: "내보내기 작업" })).toHaveAttribute("href", "/exports");
    await userEvent.click(screen.getByRole("button", { name: "내보내기" }));
    const dialog = await screen.findByRole("dialog", { name: "내보내기" });
    expect(within(dialog).getByText(/시계열 2개/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "내보내기" }));
    expect(api.createExport).toHaveBeenCalledWith(expect.objectContaining({ query: expect.objectContaining({ series: [{ deviceId: "1042", metric: "temperature", label: "실습실 온도" }, { deviceId: "1042", metric: "co2", label: "AM107 co2" }], from: "2026-10-03T23:00:00Z" }) }));
    await userEvent.click(within(dialog).getByRole("button", { name: "닫기" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("VIEWER(TS_EXPORT 없음)에게는 버튼이 없다", async () => {
    await renderRoute(<ExploreView data={makeData({ canExport: false })} onNavigate={() => {}} chartFactory={chart().factory} />);
    await screen.findByText("데이터 탐색");
    expect(screen.queryByRole("button", { name: "내보내기" })).toBeNull();
    expect(screen.queryByRole("link", { name: "내보내기 작업" })).toBeNull();
  });
});
