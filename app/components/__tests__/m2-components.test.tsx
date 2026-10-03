/**
 * M2 공용 부품: 공통 시계열 차트(UI-TSD-07, TC-TSD-022·058·084·092), 코드 편집기 대역(SCR-03.01),
 * 실시간 연결 띠(00-navigation §1.3), 공간 선택(UI-DEV-05·07, UI-IAM-08), 빈 화면 안내(DSH-08.02), 용어 툴팁(DSH-08.03).
 */
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { meOf, renderRoute } from "../../../test/render";
import { TimeseriesChart, type ChartHandle } from "../charts/timeseries-chart";
import { CodeEditor, type EditorApi } from "../code-editor";
import { LiveBanner, LiveDot, useLiveStream } from "../live";
import { ScopeField, SpaceScopePicker, SpaceSelect } from "../space-picker";
import { CountBadge, Dialog, EmptyState, Pager, StatusDot, Term } from "../ui";
import type { EventSourceLike } from "~/lib/event-stream";

const tree = [{ id: "1", type: "SITE", name: "광주캠퍼스", children: [{ id: "2", type: "BUILDING", name: "본관", children: [{ id: "31", type: "ROOM", name: "실습실" }] }] }];

function fakeChart() {
  const handle: ChartHandle & { options: Record<string, unknown>[] } = { options: [], setOption: vi.fn((o) => handle.options.push(o)), resize: vi.fn(), dispose: vi.fn() };
  return { handle, factory: vi.fn(async () => handle) };
}

describe("UI-TSD-07 공통 차트 컴포넌트", () => {
  const series = [{ key: "a", label: "AM107 co2", unit: "ppm", raw: true, points: [["2026-10-03T00:00:00Z", 517, 0], ["2026-10-03T00:01:00Z", 520, 1]] as [string, number, number][] }];

  it("TC-TSD-058 데이터가 있으면 ECharts 옵션을 넣고, 표로 보기는 시각(표시 시간대)×값 표", async () => {
    const { handle, factory } = fakeChart();
    await renderRoute(<TimeseriesChart series={series} timezone="Asia/Seoul" factory={factory} />);
    await waitFor(() => expect(handle.setOption).toHaveBeenCalled());
    const option = handle.options.at(-1) as { series: { id: string }[] };
    expect(option.series.map((s) => s.id)).toEqual(["a", "a:q1"]);
    await userEvent.click(screen.getByRole("button", { name: "표로 보기" }));
    expect(screen.getByText("2026-10-03 09:00:00")).toBeInTheDocument();
    expect(screen.getByText("520")).toBeInTheDocument();
    window.dispatchEvent(new Event("resize"));
    expect(handle.resize).toHaveBeenCalled();
  });

  it("TC-TSD-022 상태: 데이터 없음, 로딩(이전 차트 흐림 유지), 일부 계열 오류(경고)", async () => {
    const { factory } = fakeChart();
    const { unmount } = await renderRoute(<TimeseriesChart series={[{ key: "x", label: "x", points: [] }]} timezone="UTC" factory={factory} />);
    expect(await screen.findByText("이 기간에 데이터가 없습니다")).toBeInTheDocument();
    unmount();
    await renderRoute(<TimeseriesChart series={[...series, { key: "b", label: "EM300 온도", points: [], error: true }]} timezone="UTC" factory={factory} loading />);
    expect(await screen.findByText("불러오는 중…")).toBeInTheDocument();
    expect(screen.getByTestId("timeseries-chart")).toHaveClass("opacity-40");
    expect(screen.getByText("일부 계열을 불러오지 못했습니다: EM300 온도")).toBeInTheDocument();
  });

  it("차트 라이브러리를 불러오지 못해도 화면은 남는다(표로 보기 가능)", async () => {
    await renderRoute(<TimeseriesChart series={series} timezone="UTC" factory={() => Promise.reject(new Error("no canvas"))} />);
    expect(await screen.findByRole("button", { name: "표로 보기" })).toBeInTheDocument();
  });
});

describe("SCR-03.01 코드 편집기(Monaco 대역)", () => {
  it("편집기를 못 불러오면 textarea로 같은 값을 편집한다", async () => {
    function Host() {
      const [code, setCode] = useState("function decode(msg, ctx) {}");
      return (
        <>
          <CodeEditor label="코드" value={code} onChange={setCode} factory={async () => null} />
          <output>{code.length}</output>
        </>
      );
    }
    await renderRoute(<Host />);
    const box = await screen.findByLabelText("코드");
    await userEvent.clear(box);
    await userEvent.type(box, "x");
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("편집기가 열리면 값·문제(줄·열)를 넘기고 apiRef로 줄 이동", async () => {
    const api: EditorApi = { setValue: vi.fn(), getValue: vi.fn(() => ""), setProblems: vi.fn(), reveal: vi.fn(), dispose: vi.fn() };
    const ref = { current: null as EditorApi | null };
    const problems = [{ line: 3, col: 9, severity: "ERROR" as const, message: "금지된 API: require" }];
    const { unmount } = await renderRoute(<CodeEditor label="코드" value="a" onChange={() => {}} problems={problems} factory={async () => api} apiRef={ref} />);
    await waitFor(() => expect(api.setProblems).toHaveBeenCalledWith(problems));
    expect(ref.current).toBe(api);
    expect(screen.queryByRole("textbox")).toBeNull();
    unmount();
    expect(api.dispose).toHaveBeenCalled();
  });
});

class FakeEventSource implements EventSourceLike {
  static last: FakeEventSource | undefined;
  readyState = 0;
  onopen: ((e: Event) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  listeners: Record<string, ((e: MessageEvent) => void)[]> = {};
  constructor(readonly url: string) {
    FakeEventSource.last = this;
  }
  addEventListener(type: string, l: (e: MessageEvent) => void) {
    (this.listeners[type] ??= []).push(l);
  }
  close() {}
}

describe("실시간 연결 훅과 끊김 띠", () => {
  it("이벤트를 받고, 끊기면 '다시 연결 중' 띠를 보인다", async () => {
    const create = (url: string) => new FakeEventSource(url);
    const check = async () => true;
    function Host() {
      const [last, setLast] = useState("-");
      const status = useLiveStream("/bff/stream/live?topics=home", ["home-summary"], (e) => setLast(JSON.stringify(e.data)), { createSource: create, checkSession: check });
      return (
        <>
          <LiveBanner status={status} />
          <LiveDot status={status} />
          <p data-testid="last">{last}</p>
        </>
      );
    }
    await renderRoute(<Host />);
    await waitFor(() => expect(FakeEventSource.last?.url).toBe("/bff/stream/live?topics=home"));
    act(() => FakeEventSource.last!.onopen?.(new Event("open")));
    expect(screen.getByText("실시간")).toBeInTheDocument();
    act(() => FakeEventSource.last!.listeners["home-summary"][0]({ data: '{"offlineDevices":2}', lastEventId: "" } as MessageEvent));
    expect(screen.getByTestId("last")).toHaveTextContent('{"offlineDevices":2}');
    act(() => FakeEventSource.last!.onerror?.(new Event("error")));
    expect(await screen.findByText("실시간 연결이 끊겼습니다. 다시 연결 중…")).toBeInTheDocument();
  });

  it("주소가 없으면 연결하지 않는다", async () => {
    FakeEventSource.last = undefined;
    function Host() {
      const status = useLiveStream(null, ["x"], () => {}, { createSource: (u) => new FakeEventSource(u) });
      return <LiveDot status={status} />;
    }
    await renderRoute(<Host />);
    expect(await screen.findByText("꺼짐")).toBeInTheDocument();
    expect(FakeEventSource.last).toBeUndefined();
  });
});

describe("공간 선택(UI-DEV-05 승인, UI-IAM-08 공간 범위)", () => {
  it("트리 순서로 들여 쓴 선택지", async () => {
    await renderRoute(<SpaceSelect spaces={tree} label="공간" name="spaceId" defaultValue="31" />);
    const select = (await screen.findByLabelText("공간")) as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent?.trim())).toEqual(["공간 선택", "광주캠퍼스", "본관", "실습실"]);
    expect(select.value).toBe("31");
  });

  it("여러 공간을 고르면 숨은 필드로 보내고, 고르지 않으면 전체 안내", async () => {
    await renderRoute(<SpaceScopePicker spaces={tree} name="spaceScope" label="공간 범위" defaultValue={["2"]} />);
    expect(await screen.findByText("1개 공간(하위 포함)")).toBeInTheDocument();
    expect(document.querySelectorAll('input[type="hidden"][name="spaceScope"]')).toHaveLength(1);
    await userEvent.click(screen.getByLabelText("광주캠퍼스 › 본관"));
    expect(screen.getByText("선택하지 않으면 전체 공간입니다.")).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText("광주캠퍼스 › 본관 › 실습실"));
    expect(document.querySelector('input[name="spaceScope"]')).toHaveValue("31");
  });

  it("ScopeField: 트리를 못 불러오면 공간 ID 입력(쉼표)으로 대신한다", async () => {
    const { unmount } = await renderRoute(<ScopeField spaces={null} label="공간 범위" hint="쉼표로 구분" defaultValue={["3", "31"]} />);
    expect(await screen.findByLabelText("공간 범위")).toHaveValue("3, 31");
    expect(screen.getByText("쉼표로 구분")).toBeInTheDocument();
    unmount();
    await renderRoute(<ScopeField spaces={tree} label="공간 범위" hint="쉼표로 구분" />);
    expect(await screen.findByLabelText("광주캠퍼스 › 본관")).toBeInTheDocument();
    expect(screen.queryByText("쉼표로 구분")).toBeNull();
  });

  it("공간이 없으면 안내", async () => {
    await renderRoute(<SpaceScopePicker spaces={[]} name="s" label="범위" />);
    expect(await screen.findByText("아직 공간이 없습니다.")).toBeInTheDocument();
  });
});

describe("DSH-08.02 빈 화면 안내·DSH-08.03 용어 툴팁·공용 부품", () => {
  it("이유 문장과 다음 행동 버튼", async () => {
    await renderRoute(<EmptyState title="아직 소스가 없습니다" body="소스를 연결하세요" action={<a href="/sources/new">소스 연결</a>} />);
    expect(await screen.findByText("아직 소스가 없습니다")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "소스 연결" })).toHaveAttribute("href", "/sources/new");
  });

  it("TC-DSH-085 용어 툴팁은 용어집 문구(현재 언어), 없는 용어는 그대로", async () => {
    const { unmount } = await renderRoute(
      <p>
        <Term term="quality">품질</Term> <Term term="nothing">없음</Term>
      </p>,
      { lang: "en" },
    );
    expect((await screen.findByText("품질")).closest("abbr")).toHaveAttribute("title", expect.stringContaining("Quality code: 0 normal"));
    expect(screen.getByText("없음").closest("abbr")).toBeNull();
    unmount();
  });

  it("대화상자: 열림·닫기·Esc, 상태 점, 쪽 이동, 숫자 배지", async () => {
    const close = vi.fn();
    await renderRoute(
      <>
        <Dialog title="공간 추가" open onClose={close} footer={<button type="button">저장</button>}>
          본문
        </Dialog>
        <Dialog title="닫힘" open={false} onClose={close}>
          안 보임
        </Dialog>
        <StatusDot tone="good" label="온라인" />
        <Pager page={2} totalPages={3} />
        <CountBadge n={4} />
        <CountBadge n={null} />
      </>,
      { session: meOf("ADMIN"), url: "/?q=a" },
    );
    expect(await screen.findByRole("dialog", { name: "공간 추가" })).toBeInTheDocument();
    expect(screen.queryByText("안 보임")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "닫기" }));
    await userEvent.keyboard("{Escape}");
    expect(close).toHaveBeenCalledTimes(2);
    expect(screen.getByText("온라인")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "다음" })).toHaveAttribute("href", "/?q=a&page=3");
    expect(screen.getByText("2 / 3")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
  });
});
