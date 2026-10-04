/**
 * UI-TSD-01 데이터 탐색기 화면 부품(TC-TSD-021·056·082·090, DSH-05.02, TSD-01.04).
 */
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { meOf, renderRoute } from "../../../../../test/render";
import type { ChartHandle } from "~/components/charts/timeseries-chart";
import type { EventSourceLike } from "~/lib/event-stream";
import { defaultState, MAX_SERIES, type ExploreState, type SeriesSpec } from "../../model/state";
import type { ExploreData } from "../../model/types";
import { AddSeriesDialog, type FetchJson } from "../add-series-dialog";
import { ExploreView } from "../explore-view";

const dev = (metric: string): SeriesSpec => ({ kind: "device", id: "1042", metric, label: `AM107-067999 ${metric}` });
const tree = [{ id: "1", type: "SITE", name: "광주캠퍼스", children: [{ id: "31", type: "ROOM", name: "실습실" }] }];

function makeData(patch: Partial<ExploreData> = {}): ExploreData {
  const state: ExploreState = { ...defaultState(), series: [dev("temperature")] };
  return {
    state,
    range: { from: "2026-10-03T23:00:00Z", to: "2026-10-04T00:00:00Z", live: true },
    result: { resolutionUsed: "raw", reason: "AUTO", truncated: false },
    series: [{ key: "d1042.temperature", label: "AM107-067999 temperature", unit: "℃", raw: true, points: [["2026-10-03T23:01:00Z", 22, 0], ["2026-10-03T23:05:00Z", 61, 1]], gaps: [] }],
    annotations: [
      { id: "a2", timeFrom: "2026-10-03T22:00:00Z", timeTo: "2026-10-03T23:00:00Z", spaceId: "31", type: "USER", title: "창문 공사", createdBy: "7" },
      { id: "a1", timeFrom: "2026-10-03T21:00:00Z", deviceId: "1042", type: "OFFLINE", title: "오프라인" },
    ],
    spaces: tree,
    canAnnotate: true,
    timezone: "Asia/Seoul",
    meId: "7",
    ...patch,
  };
}

function chart() {
  const options: Record<string, unknown>[] = [];
  const handle: ChartHandle = { setOption: (o) => options.push(o), resize: () => {}, dispose: () => {} };
  return { options, factory: async () => handle };
}

class FakeES implements EventSourceLike {
  static last?: FakeES;
  readyState = 0;
  onopen: ((e: Event) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  listeners: Record<string, ((e: MessageEvent) => void)[]> = {};
  constructor(readonly url: string) {
    FakeES.last = this;
  }
  addEventListener(type: string, l: (e: MessageEvent) => void) {
    (this.listeners[type] ??= []).push(l);
  }
  close() {}
}
const stubChart = chart().factory;
const live = { createSource: (url: string) => new FakeES(url), checkSession: async () => true };

describe("UI-TSD-01 데이터 탐색기", () => {
  it("TC-TSD-021 시계열이 없으면 안내와 [시계열 추가]", async () => {
    const data = makeData({ state: defaultState(), series: [], annotations: [], result: undefined });
    await renderRoute(<ExploreView data={data} onNavigate={() => {}} live={live} chartFactory={stubChart} />, { session: meOf("VIEWER") });
    expect(await screen.findByText("왼쪽에서 기기나 공간을 추가하세요")).toBeInTheDocument();
  });

  it("AT-TSD-01.3·DSH-05.02 원본 품질 1 점은 다른 모양(범위 초과)으로, 실시간 point를 이어 그린다", async () => {
    const { options, factory } = chart();
    await renderRoute(<ExploreView data={makeData()} onNavigate={() => {}} chartFactory={factory} live={live} />, { session: meOf("OPERATOR") });
    await waitFor(() => expect(options.length).toBeGreaterThan(0));
    const ids = (options.at(-1)!.series as { id: string; symbol?: string }[]).map((s) => s.id);
    expect(ids).toEqual(["d1042.temperature", "d1042.temperature:q1"]);
    expect(screen.getByText("자동 단위: 원본로 표시합니다(점 수를 알맞게 맞춤).")).toBeInTheDocument();
    await waitFor(() => expect(FakeES.last?.url).toBe(`/bff/stream/live?topics=${encodeURIComponent("telemetry:1042.temperature")}`));
    act(() => FakeES.last!.onopen?.(new Event("open")));
    act(() => FakeES.last!.listeners.point[0]({ data: JSON.stringify({ deviceId: "1042", metricKey: "temperature", t: "2026-10-03T23:59:00Z", v: 23, quality: 0 }), lastEventId: "" } as MessageEvent));
    act(() => FakeES.last!.listeners.point[0]({ data: "{}", lastEventId: "" } as MessageEvent));
    await waitFor(() => expect(((options.at(-1)!.series as { data: unknown[] }[])[0].data).length).toBe(3));
    expect(screen.getByText("실시간")).toBeInTheDocument();
  });

  it("주석: 공간 범위 표시, 본인 사용자 주석만 [삭제], 종류 토글, [주석 추가] 양식", async () => {
    const navigate = vi.fn();
    await renderRoute(<ExploreView data={makeData()} onNavigate={navigate} live={live} chartFactory={stubChart} />, { session: meOf("OPERATOR") });
    expect(await screen.findByText("창문 공사")).toBeInTheDocument();
    expect(screen.getByText("(공간 범위)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "주석 창문 공사 삭제" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "주석 오프라인 삭제" })).toBeNull();
    await userEvent.click(screen.getByRole("checkbox", { name: "알람" }));
    expect(navigate.mock.calls[0][0].annotations).not.toContain("ALARM");
    await userEvent.click(screen.getByRole("button", { name: "주석 추가" }));
    expect(screen.getByLabelText("제목")).toBeInTheDocument();
    expect(screen.getByLabelText("시작")).toHaveValue("2026-10-04T08:00");
    await userEvent.click(screen.getByRole("button", { name: "취소" }));
  });

  it("VIEWER(주석 권한 없음)는 [주석 추가]가 없고, 작업 오류·저장 결과를 보인다", async () => {
    const { unmount } = await renderRoute(<ExploreView data={makeData({ canAnnotate: false })} onNavigate={() => {}} actionResult={{ intent: "annotate", error: { code: "ANNOTATION_FORBIDDEN" } }} live={live} chartFactory={stubChart} />, { session: meOf("VIEWER") });
    expect(await screen.findByText("주석을 추가하거나 지울 권한이 없습니다.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "주석 추가" })).toBeNull();
    unmount();
    await renderRoute(<ExploreView data={makeData()} onNavigate={() => {}} actionResult={{ intent: "annotate", fieldError: "title" }} live={live} chartFactory={stubChart} />, { session: meOf("OPERATOR") });
    expect(await screen.findByText("제목을 1~200자로 입력하세요")).toBeInTheDocument();
  });

  it("검증 문제·조회 실패·잘린 결과 안내, 원본 31일 초과는 [1시간 집계로 보기]", async () => {
    const navigate = vi.fn();
    const data = makeData({ problem: "RAW_TOO_LONG", failure: { code: "TSD_RANGE_TOO_LARGE" }, result: { resolutionUsed: "1h", reason: "CAPPED", truncated: true } });
    await renderRoute(<ExploreView data={data} onNavigate={navigate} live={live} chartFactory={stubChart} />, { session: meOf("VIEWER") });
    expect(await screen.findByText("원본은 31일까지 조회할 수 있습니다")).toBeInTheDocument();
    expect(screen.getByText("조회 기간이 너무 깁니다. 기간을 줄이거나 집계 단위를 바꿔 주세요.")).toBeInTheDocument();
    expect(screen.getByText(/요청한 단위는 점이 너무 많아 1시간 단위로 표시합니다. 점이 너무 많아 일부만 표시합니다./)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "1시간 집계로 보기" }));
    expect(navigate).toHaveBeenCalledWith(expect.objectContaining({ resolution: "1h" }));
  });

  it("TC-TSD-082·090 도구: 기간·단위·채우기·품질·가상 포함·직접 기간(사용자 시간대 → UTC), 시간대 표시", async () => {
    const navigate = vi.fn();
    const data = makeData({ state: { ...defaultState(), series: [dev("co2")], range: "custom", from: "2026-10-03T01:00:00Z", to: "2026-10-03T03:00:00Z" } });
    await renderRoute(<ExploreView data={data} onNavigate={navigate} live={live} chartFactory={stubChart} />, { session: meOf("VIEWER") });
    expect(await screen.findByText("Asia/Seoul")).toBeInTheDocument();
    const toolbar = screen.getByLabelText("시작").closest("div")!.parentElement!;
    await userEvent.selectOptions(within(toolbar).getByLabelText("집계 단위"), "1h");
    await userEvent.selectOptions(within(toolbar).getByLabelText("채우기"), "linear");
    await userEvent.selectOptions(within(toolbar).getByLabelText("품질"), "all");
    await userEvent.click(within(toolbar).getByLabelText("가상 데이터 포함"));
    expect(navigate.mock.calls.map((c) => [c[0].resolution, c[0].fill, c[0].quality, c[0].includeVirtual])).toEqual([
      ["1h", "none", "normal", false],
      ["auto", "linear", "normal", false],
      ["auto", "none", "all", false],
      ["auto", "none", "normal", true],
    ]);
    expect(screen.getByLabelText("시작")).toHaveValue("2026-10-03T10:00");
    await userEvent.clear(screen.getByLabelText("종료"));
    await userEvent.type(screen.getByLabelText("종료"), "2026-10-03T13:00");
    await userEvent.click(screen.getByRole("button", { name: "적용" }));
    expect(navigate.mock.calls.at(-1)![0]).toMatchObject({ range: "custom", from: "2026-10-03T01:00:00Z", to: "2026-10-03T04:00:00Z" });
    await userEvent.selectOptions(within(toolbar).getByLabelText("기간"), "7d");
    expect(navigate.mock.calls.at(-1)![0]).toMatchObject({ range: "7d", from: undefined });
    await userEvent.selectOptions(within(toolbar).getByLabelText("기간"), "custom");
    expect(navigate.mock.calls.at(-1)![0].range).toBe("custom");
  });

  it("시계열 목록: 숨기기·보이기, 공간 집계 함수, 제거, [링크 복사]", async () => {
    const navigate = vi.fn();
    const writeText = vi.fn(async () => {});
    Object.assign(navigator, { clipboard: { writeText } });
    const data = makeData({ state: { ...defaultState(), series: [dev("co2"), { kind: "space", id: "31", metric: "co2", label: "실습실 CO2", agg: "avg", hidden: true }] } });
    await renderRoute(<ExploreView data={data} onNavigate={navigate} live={live} chartFactory={stubChart} />, { session: meOf("VIEWER") });
    await userEvent.click(await screen.findByRole("button", { name: "숨기기" }));
    expect(navigate.mock.calls[0][0].series[0].hidden).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: "보이기" }));
    expect(navigate.mock.calls[1][0].series[1].hidden).toBe(false);
    await userEvent.selectOptions(screen.getByLabelText("실습실 CO2 집계 함수"), "max");
    expect(navigate.mock.calls[2][0].series[1].agg).toBe("max");
    await userEvent.click(screen.getByRole("button", { name: "실습실 CO2 제거" }));
    expect(navigate.mock.calls[3][0].series).toHaveLength(1);
    await userEvent.click(screen.getByRole("button", { name: "링크 복사" }));
    expect(writeText).toHaveBeenCalled();
    expect(await screen.findByRole("button", { name: "복사했습니다." })).toBeInTheDocument();
  });

  it("시계열 추가: 기기 검색 → 그 기기가 가진 측정 항목만 → 추가, 50개를 넘으면 안내", async () => {
    const navigate = vi.fn();
    const fetchJson = vi.fn(async (path: string) => {
      if (path.startsWith("/bff/api/core/devices?")) return { ok: true as const, status: 200, data: { responses: [{ id: "1042", name: "AM107-067999", externalId: "24e1" }] } };
      return { ok: true as const, status: 200, data: { id: "1042", name: "AM107-067999", latest: [{ metricKey: "co2", displayName: "CO2", unit: "ppm" }, { metricKey: "humidity" }] } };
    }) as unknown as FetchJson;
    const first = await renderRoute(<ExploreView data={makeData()} onNavigate={navigate} fetchJson={fetchJson} live={live} chartFactory={stubChart} />, { session: meOf("VIEWER") });
    await userEvent.click(await screen.findByRole("button", { name: "+ 시계열 추가" }));
    const dialog = screen.getByRole("dialog", { name: "시계열 추가" });
    await userEvent.type(within(dialog).getByLabelText("기기 이름·외부 ID"), "AM107{Enter}");
    await userEvent.click(await within(dialog).findByRole("button", { name: /AM107-067999/ }));
    const metric = (await within(dialog).findByLabelText("측정 항목")) as HTMLSelectElement;
    expect([...metric.options].map((o) => o.value)).toEqual(["co2", "humidity"]);
    await userEvent.click(within(dialog).getByRole("button", { name: "추가" }));
    expect(navigate.mock.calls[0][0].series.at(-1)).toEqual({ kind: "device", id: "1042", metric: "co2", label: "AM107-067999 CO2", unit: "ppm" });

    first.unmount();
    const full = makeData({ state: { ...defaultState(), series: Array.from({ length: MAX_SERIES }, (_, i) => dev(`m${i}`)) } });
    navigate.mockClear();
    const { unmount } = await renderRoute(<ExploreView data={full} onNavigate={navigate} fetchJson={fetchJson} live={live} chartFactory={stubChart} />, { session: meOf("VIEWER") });
    // TSD-03.03(M5): 50개면 [+ 시계열 추가]가 비활성화되고 안내가 보인다
    expect(await screen.findByRole("button", { name: "+ 시계열 추가" })).toBeDisabled();
    expect(screen.getByText("한 번에 50개까지 비교할 수 있습니다")).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
    unmount();
  });
});

describe("시계열 추가 대화상자(공간)", () => {
  it("공간을 고르면 검증된 측정 항목에서 고르고 평균 집계로 추가, 조회 실패·결과 없음 안내", async () => {
    const add = vi.fn();
    const fetchJson = vi.fn(async (path: string) => {
      if (path.startsWith("/bff/api/core/metrics")) return { ok: true as const, status: 200, data: { responses: [{ key: "temperature", displayName: "온도", unit: "℃" }] } };
      if (path.includes("q=zzz")) return { ok: true as const, status: 200, data: { responses: [] } };
      return { ok: false as const, status: 503, code: "SERVICE_UNAVAILABLE", message: "" };
    }) as unknown as FetchJson;
    await renderRoute(<AddSeriesDialog open spaces={tree} onClose={() => {}} onAdd={add} fetchJson={fetchJson} />);
    await userEvent.type(await screen.findByLabelText("기기 이름·외부 ID"), "zzz{Enter}");
    expect(await screen.findByText("조건에 맞는 기기가 없습니다.")).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText("기기 이름·외부 ID"));
    await userEvent.type(screen.getByLabelText("기기 이름·외부 ID"), "x{Enter}");
    expect(await screen.findByText("요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: "공간" }));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "공간" }), "31");
    await screen.findByRole("option", { name: "온도 (temperature)" });
    await userEvent.click(screen.getByRole("button", { name: "추가" }));
    expect(add).toHaveBeenCalledWith({ kind: "space", id: "31", metric: "temperature", label: "실습실 온도", unit: "℃", agg: "avg" });
  });
});
