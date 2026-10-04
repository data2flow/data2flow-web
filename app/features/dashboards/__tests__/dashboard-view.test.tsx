/**
 * UI-DSH-04 대시보드 보기 부품: 변수(TC-DSH-043), 확대 동기화(TC-DSH-095), 위젯 메뉴(표로 보기 TC-DSH-097, CSV TC-DSH-061),
 * 위젯 오류·권한 밖(TC-DSH-047·049), 실시간 묶음 재조회(NFR-01.09), 상태 아이콘(DSH-11.04)
 */
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderRoute } from "../../../../test/render";
import { DashboardView } from "../components/dashboard-view";
import type { Widget, WidgetState } from "../model/types";
import { FakeES, chartFactory, fakeFetcher, liveOptions, payloadFor } from "./fakes";

const spaceVar = [{ name: "space", type: "SPACE", label: "공간", default: "31" }];
const options = { space: [{ value: "31", label: "실습실" }, { value: "32", label: "사무실" }] };

function view(widgets: Widget[], extra: Partial<Parameters<typeof DashboardView>[0]> = {}) {
  const { fetcher, calls } = fakeFetcher(widgets);
  const charts = chartFactory();
  const result = renderRoute(
    <DashboardView name="실습실 운영" widgets={widgets} variables={spaceVar} timeRange={{ relative: "24h" }} resolution="AUTO" refresh="OFF" fetcher={fetcher} timezone="Asia/Seoul" variableOptions={options} chartFactory={charts.factory} streamOptions={liveOptions} {...extra} />,
  );
  return { fetcher, calls, charts, result };
}

const spaceWidget = (id: string, x: number): Widget => ({ id, type: "stat", title: `현재값 ${id}`, x, y: 0, w: 4, h: 4, targets: [{ kind: "SPACE_AGGREGATE", spaceId: "${space}", metricKey: "co2" }] });

describe("DSH-04.05 변수", () => {
  it("TC-DSH-043 AT-DSH-04.3: 공간 변수를 바꾸면 변수를 쓰는 위젯 5개만 다시 요청(5회), 안 쓰는 위젯은 요청 없음", async () => {
    const widgets = [0, 4, 8, 12, 16].map((x, i) => spaceWidget(`s${i}`, x));
    widgets.push({ id: "fixed", type: "stat", title: "고정", x: 20, y: 0, w: 4, h: 4, targets: [{ kind: "DEVICE_METRIC", deviceId: "1042", metricKey: "co2" }] });
    const onValues = vi.fn();
    const { calls } = view(widgets, { onValuesChange: onValues });
    await waitFor(() => expect(calls).toHaveLength(6));
    expect(calls[0].req).toMatchObject({ variables: { space: "31" }, timeRange: { relative: "24h" }, resolution: "AUTO" });
    await userEvent.selectOptions(screen.getByLabelText("공간"), "32");
    await waitFor(() => expect(calls).toHaveLength(11));
    expect(calls.slice(6).map((c) => c.id).sort()).toEqual(["s0", "s1", "s2", "s3", "s4"]);
    expect(calls.slice(6).every((c) => c.req.variables?.space === "32")).toBe(true);
    expect(onValues).toHaveBeenCalledWith({ space: "32" });
    expect(await screen.findAllByText(/640/)).toHaveLength(5);

    // 시간 범위·집계가 바뀌면 모두 다시
    await userEvent.selectOptions(screen.getByLabelText("시간 범위"), "7d");
    await waitFor(() => expect(calls).toHaveLength(17));
    expect(calls.at(-1)?.req.timeRange).toEqual({ relative: "7d" });
    await userEvent.selectOptions(screen.getByLabelText("집계"), "1h");
    await waitFor(() => expect(calls).toHaveLength(23));
  });

  it("서버에서 받은 위젯(SSR)은 다시 요청하지 않고, 기간 지정 범위를 적용한다", async () => {
    const widgets = [spaceWidget("a", 0), spaceWidget("b", 4)];
    const initial: Record<string, WidgetState> = { a: { status: "ok", data: payloadFor({ type: "stat" }, {}) } };
    const { calls } = view(widgets, { initialStates: initial });
    await waitFor(() => expect(calls.map((c) => c.id)).toEqual(["b"]));
    await userEvent.selectOptions(screen.getByLabelText("시간 범위"), "custom");
    const [from, to] = [screen.getByLabelText("시작"), screen.getByLabelText("끝")];
    await userEvent.type(from, "2026-10-01T00:00");
    await userEvent.type(to, "2026-10-02T00:00");
    await userEvent.click(screen.getByRole("button", { name: "적용" }));
    await waitFor(() => expect(calls).toHaveLength(3));
    expect(calls.at(-1)?.req.timeRange).toMatchObject({ from: expect.stringMatching(/Z$/), to: expect.stringMatching(/Z$/) });
  });
});

describe("DSH-11.01 확대 동기화", () => {
  it("TC-DSH-095 AT-DSH-04.7: 차트 3개 중 하나에서 구간을 고르면 나머지 두 차트 x축 min·max가 같은 구간, [초기화]로 복귀", async () => {
    const lines: Widget[] = [0, 8, 16].map((x, i) => ({ id: `l${i}`, type: "line", title: `추이 ${i}`, x, y: 0, w: 8, h: 8, targets: [{ kind: "DEVICE_METRIC", deviceId: "1042", metricKey: "co2" }] }));
    const { charts } = view(lines);
    await waitFor(() => expect(charts.charts).toHaveLength(3));
    await waitFor(() => expect(charts.charts.every((c) => c.options.length > 0)).toBe(true));
    // 드래그 확대 켜짐(dataZoomSelect)
    expect(charts.charts[0].actions).toContainEqual({ type: "takeGlobalCursor", key: "dataZoomSelect", dataZoomSelectActive: true });
    act(() => charts.charts[0].handlers.datazoom({ batch: [{ startValue: 1000, endValue: 5000 }] }));
    await waitFor(() => {
      for (const c of charts.charts) expect(c.options.at(-1)).toMatchObject({ xAxis: { min: 1000, max: 5000 } });
    });
    await userEvent.click(screen.getByRole("button", { name: "초기화" }));
    await waitFor(() => {
      for (const c of charts.charts) expect((c.options.at(-1)?.xAxis as Record<string, unknown>).min).toBeUndefined();
    });
  });
});

describe("DSH-11.03 DSH-06.01 위젯 메뉴", () => {
  beforeEach(() => {
    Object.assign(URL, { createObjectURL: vi.fn(() => "blob:x"), revokeObjectURL: vi.fn() });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("TC-DSH-097: 모든 차트 위젯에 [데이터 표로 보기] — 캡션·열 머리글(scope)·요약(aria-describedby)·값 복사", async () => {
    const widgets: Widget[] = [
      { id: "g", type: "gauge", title: "습도", x: 0, y: 0, w: 4, h: 5, targets: [] },
      { id: "l", type: "line", title: "추이", x: 4, y: 0, w: 8, h: 8, targets: [] },
    ];
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    view(widgets);
    for (const title of ["습도", "추이"]) {
      const section = await screen.findByRole("region", { name: title });
      await userEvent.click(within(section).getByRole("button", { name: `${title} 메뉴` }));
      await userEvent.click(within(section).getByRole("menuitem", { name: "데이터 표로 보기" }));
      const table = await within(section).findByRole("table");
      expect(table.querySelector("caption")?.textContent).toMatch(title === "습도" ? "습도 데이터 표" : /표/);
      expect(table.querySelectorAll('th[scope="col"]').length).toBeGreaterThan(1);
    }
    const gauge = screen.getByRole("region", { name: "습도" });
    expect(within(gauge).getByText("습도: 데이터 1행")).toHaveClass("sr-only");
    await userEvent.click(within(gauge).getByRole("button", { name: "값 복사" }));
    expect(writeText).toHaveBeenCalledWith("값\t단위\t최소\t최대\n48\t%\t0\t100");
    expect(within(gauge).getByRole("button", { name: "복사했습니다" })).toBeInTheDocument();
  });

  it("TC-DSH-061: [CSV]는 UTF-8 BOM 파일을 내려받고, 전체 화면을 열고 닫는다. 공유 화면(noExport)에는 PNG·CSV가 없다", async () => {
    const widgets: Widget[] = [{ id: "t", type: "table", title: "표 위젯", x: 0, y: 0, w: 8, h: 6, targets: [] }];
    const blobs: Blob[] = [];
    vi.spyOn(URL, "createObjectURL").mockImplementation((b) => {
      blobs.push(b as Blob);
      return "blob:x";
    });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const { result } = view(widgets);
    const section = await screen.findByRole("region", { name: "표 위젯" });
    await screen.findByText("1150");
    await userEvent.click(within(section).getByRole("button", { name: "표 위젯 메뉴" }));
    await userEvent.click(within(section).getByRole("menuitem", { name: "CSV" }));
    expect(click).toHaveBeenCalled();
    const bytes = new Uint8Array(await blobs[0].arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = await blobs[0].text();
    expect(text).toContain("대상,값\r\nCO2,1150");
    await userEvent.click(within(section).getByRole("button", { name: "표 위젯 메뉴" }));
    await userEvent.click(within(section).getByRole("menuitem", { name: "전체 화면" }));
    expect(section.className).toContain("fixed");
    await userEvent.click(within(section).getByRole("button", { name: "표 위젯 메뉴" }));
    await userEvent.click(within(section).getByRole("menuitem", { name: "전체 화면 닫기" }));
    expect(section.className).not.toContain("fixed");
    (await result).unmount();

    view(widgets, { noExport: true });
    const shared = await screen.findByRole("region", { name: "표 위젯" });
    await userEvent.click(within(shared).getByRole("button", { name: "표 위젯 메뉴" }));
    expect(within(shared).queryByRole("menuitem", { name: "CSV" })).toBeNull();
    expect(within(shared).queryByRole("menuitem", { name: "PNG" })).toBeNull();
  });
});

describe("DSH-04.01 위젯 상태", () => {
  it("TC-DSH-047 TC-DSH-049: 한 위젯 오류·권한 밖은 그 위젯 안에만 표시, [다시 시도], 나머지는 정상", async () => {
    const widgets: Widget[] = [spaceWidget("ok", 0), spaceWidget("err", 4), spaceWidget("deny", 8)];
    let fail = true;
    const { fetcher } = fakeFetcher(widgets, (id) => {
      if (id === "err" && fail) return { ok: false, status: 503, code: "SERVICE_UNAVAILABLE", message: "" };
      if (id === "deny") return { ok: true, status: 200, data: { type: "stat", data: { forbidden: true } } };
      return undefined;
    });
    renderRoute(<DashboardView name="x" widgets={widgets} variables={spaceVar} timeRange={{ relative: "1h" }} resolution="AUTO" refresh="OFF" fetcher={fetcher} timezone="Asia/Seoul" />);
    expect(await screen.findByText(/불러오지 못했습니다\(SERVICE_UNAVAILABLE\)/)).toBeInTheDocument();
    expect(screen.getByText(/접근 권한 없음/)).toBeInTheDocument();
    expect(screen.getAllByTestId("stat-value")).toHaveLength(1);
    fail = false;
    await userEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    await waitFor(() => expect(screen.getAllByTestId("stat-value")).toHaveLength(2));
  });

  it("DSH-11.04 BR-DSH-15: 상태 목록·알람 목록·평면도는 색과 함께 아이콘·글자, 메모는 HTML을 해석하지 않는다", async () => {
    const widgets: Widget[] = [
      { id: "s", type: "status-list", title: "기기 상태", x: 0, y: 0, w: 8, h: 6, targets: [] },
      { id: "a", type: "alarm-list", title: "알람", x: 8, y: 0, w: 8, h: 6, targets: [] },
      { id: "f", type: "floorplan", title: "평면", x: 16, y: 0, w: 8, h: 8, targets: [] },
      { id: "m", type: "markdown", title: "메모", x: 0, y: 6, w: 6, h: 4, options: { content: "<b>굵게</b>" } },
      { id: "h", type: "heatmap", title: "히트", x: 6, y: 8, w: 6, h: 4, targets: [] },
      { id: "b", type: "bar", title: "막대", x: 12, y: 8, w: 6, h: 4, targets: [] },
    ];
    const { calls } = view(widgets);
    expect(await screen.findByText("▲ 오프라인")).toBeInTheDocument();
    expect(screen.getByText("▲ 2")).toBeInTheDocument();
    expect(screen.getByText("▲ 심각")).toBeInTheDocument();
    expect(screen.getByText("<b>굵게</b>")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "평면도" })).toHaveAttribute("src", "/bff/api/core/spaces/31/floorplan");
    await waitFor(() => expect(screen.getAllByTestId("echart-view")).toHaveLength(2));
    expect(calls.map((c) => c.id)).not.toContain("m");
  });
});

describe("NFR-01.09 실시간", () => {
  afterEach(() => {
    vi.useRealTimers();
    FakeES.all = [];
  });
  it("LIVE면 기기 측정 항목 토픽을 구독하고 point가 오면 그 위젯만 1초 묶음으로 다시 조회, 30초 주기 새로고침", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const widgets: Widget[] = [
      { id: "d", type: "stat", title: "기기", x: 0, y: 0, w: 4, h: 4, targets: [{ kind: "DEVICE_METRIC", deviceId: "1042", metricKey: "co2" }] },
      spaceWidget("s", 4),
    ];
    const { calls } = view(widgets, { refresh: "LIVE" });
    await waitFor(() => expect(calls).toHaveLength(2));
    await waitFor(() => expect(FakeES.all.length).toBeGreaterThan(0));
    const es = FakeES.all.at(-1)!;
    expect(decodeURIComponent(es.url)).toContain("telemetry:1042.co2");
    act(() => {
      es.emit("point", { deviceId: "1042", metricKey: "co2", t: "2026-10-04T00:00:01Z", v: 1200 });
      es.emit("point", { deviceId: "1042", metricKey: "co2", t: "2026-10-04T00:00:02Z", v: 1210 });
      es.emit("point", { deviceId: "9", metricKey: "co2" });
      es.emit("point", null);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1100);
    });
    await waitFor(() => expect(calls).toHaveLength(3));
    expect(calls[2].id).toBe("d");

    await userEvent.selectOptions(screen.getByLabelText("새로고침"), "30s");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    await waitFor(() => expect(calls).toHaveLength(5));
  });

  it("공유 화면(live=false)은 실시간 대신 30초 주기, 실시간 선택지가 없다", async () => {
    const widgets = [spaceWidget("s", 0)];
    view(widgets, { refresh: "LIVE", live: false });
    const select = (await screen.findByLabelText("새로고침")) as HTMLSelectElement;
    expect(select.value).toBe("30s");
    expect([...select.options].map((o) => o.value)).not.toContain("LIVE");
    expect(FakeES.all).toHaveLength(0);
  });
});
