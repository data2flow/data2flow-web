/**
 * UI-DSH-06 키오스크(TC-DSH-062·063), UI-DSH-07 공유 링크 관리(DSH-06.03), 기능 투어(TC-DSH-086), PNG 내보내기 도우미(TC-DSH-061)
 */
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FeatureTour, readDismissedLocal, tourSteps, writeDismissedLocal } from "~/components/feature-tour";
import { createI18n } from "~/i18n";
import { downloadDataUrl, nodeToPng } from "~/lib/download";
import { renderRoute } from "../../../../test/render";
import { keepAlivePing, sharedWidgetData, sharedWidgetDataUrl } from "../api";
import { KioskView } from "../components/kiosk-view";
import { ShareLinksDialog } from "../components/share-links";
import type { Dashboard } from "../model/types";
import { chartFactory, fakeFetcher } from "./fakes";

const board = (id: string, name: string): Dashboard => ({
  id,
  name,
  visibility: "ORG",
  layout: { widgets: [{ id: "l", type: "line", title: `${name} 추이`, x: 0, y: 0, w: 12, h: 8, targets: [] }] },
  variables: [],
  timeRange: { relative: "1h" },
  resolution: "AUTO",
  refresh: "OFF",
  version: 1,
});

describe("DSH-06.02 키오스크", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("TC-DSH-062 AT-DSH-06.1: 대시보드 3개를 60초마다 순환, 이전 대시보드는 내려 차트 dispose, 진행 막대·다음 안내, 조작 단추 3초", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const boards = { "1": board("1", "실습실"), "2": board("2", "사무실"), "3": board("3", "복도") };
    const load = vi.fn(async (id: string) => ({ ok: true as const, status: 200, data: boards[id as "1"] }));
    const charts = chartFactory();
    const { fetcher } = fakeFetcher(Object.values(boards).flatMap((b) => b.layout.widgets));
    const ping = vi.fn(async () => 200);
    render(
      <I18nextProvider i18n={createI18n("ko")}>
        <KioskView boards={["1", "2", "3"]} interval={60} timezone="Asia/Seoul" loadDashboard={load} fetcher={() => fetcher} ping={ping} onExit={vi.fn()} onSessionEnded={vi.fn()} chartFactory={charts.factory} />
      </I18nextProvider>,
    );
    expect(await screen.findByRole("heading", { name: "실습실" })).toBeInTheDocument();
    await waitFor(() => expect(charts.charts).toHaveLength(1));
    expect(screen.getByRole("status")).toHaveTextContent("다음: #2 (60초)");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(await screen.findByRole("heading", { name: "사무실" })).toBeInTheDocument();
    await waitFor(() => expect(charts.charts).toHaveLength(2));
    expect(charts.charts[0].disposed).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(await screen.findByRole("heading", { name: "복도" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("다음: 실습실");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(await screen.findByRole("heading", { name: "실습실" })).toBeInTheDocument();
    // 지금 보이는 대시보드 차트만 살아 있다(메모리가 계속 늘지 않음)
    expect(charts.charts.filter((c) => !c.disposed)).toHaveLength(1);
    expect(load).toHaveBeenCalledTimes(4);

    // 조작 단추: 마우스를 움직이면 3초간
    await userEvent.hover(screen.getByTestId("kiosk"));
    act(() => {
      screen.getByTestId("kiosk").dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
    });
    const controls = await screen.findByRole("toolbar", { name: "키오스크 조작" });
    await userEvent.click(within(controls).getByRole("button", { name: "일시 정지" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(screen.getByRole("heading", { name: "실습실" })).toBeInTheDocument();
    expect(screen.queryByRole("toolbar", { name: "키오스크 조작" })).toBeNull();
    act(() => {
      screen.getByTestId("kiosk").dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
    });
    await userEvent.click(within(await screen.findByRole("toolbar", { name: "키오스크 조작" })).getByRole("button", { name: "다음 대시보드" }));
    expect(await screen.findByRole("heading", { name: "사무실" })).toBeInTheDocument();
  });

  it("TC-DSH-063: 세션 유지 요청이 401이면 전체 화면 안내 [로그인], 대시보드를 못 읽으면 경고", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const ended = vi.fn();
    const exit = vi.fn();
    const load = vi.fn(async () => ({ ok: false as const, status: 404, code: "DASHBOARD_NOT_FOUND", message: "" }));
    render(
      <I18nextProvider i18n={createI18n("ko")}>
        <KioskView boards={["9"]} interval={30} timezone="Asia/Seoul" loadDashboard={load} ping={async () => 401} onExit={exit} onSessionEnded={ended} />
      </I18nextProvider>,
    );
    expect(await screen.findByText(/대시보드를 불러오지 못했습니다/)).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4 * 60_000);
    });
    expect(await screen.findByText("세션이 끝났습니다. 다시 로그인하세요.")).toBeInTheDocument();
    expect(ended).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "로그인" }));
    expect(exit).toHaveBeenCalled();
  });

  it("세션 유지 요청은 BFF /bff/api/core/accounts/me 상태 코드만 본다", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    expect(await keepAlivePing(fetchImpl as unknown as typeof fetch)).toBe(200);
    expect((fetchImpl.mock.calls[0] as unknown[])[0]).toBe("/bff/api/core/accounts/me");
  });
});

describe("DSH-06.03 공유 링크", () => {
  it("TC-DSH-066: 만들면 주소를 한 번만 보여 주고 복사, 만료 1~90일 검사, 목록 상태·폐기", async () => {
    const now = () => Date.parse("2026-10-04T00:00:00Z");
    const api = {
      shareLinks: vi.fn(async () => ({ ok: true as const, status: 200, data: [{ id: "1", expiresAt: "2026-10-10T00:00:00Z", lastUsedAt: "2026-10-03T00:00:00Z" }, { id: "2", expiresAt: "2026-10-01T00:00:00Z" }] })),
      createShareLink: vi.fn(async () => ({ ok: true as const, status: 201, data: { id: "3", url: "https://data2flow.java21.net/share/tok_xyz", expiresAt: "2026-10-11T00:00:00Z" } })),
      revokeShareLink: vi.fn(async () => ({ ok: true as const, status: 204, data: undefined })),
    };
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    await renderRoute(<ShareLinksDialog dashboardId="501" open onClose={vi.fn()} timezone="Asia/Seoul" now={now} api={api as never} />);
    const dialog = await screen.findByRole("dialog", { name: "공유 링크" });
    expect(await within(dialog).findByText("✔ 사용 중")).toBeInTheDocument();
    expect(within(dialog).getByText("– 만료")).toBeInTheDocument();
    const days = within(dialog).getByLabelText("만료(일, 1~90)");
    await userEvent.clear(days);
    await userEvent.type(days, "91");
    await userEvent.click(within(dialog).getByRole("button", { name: "링크 만들기" }));
    expect(within(dialog).getByText("만료는 1~90일입니다")).toBeInTheDocument();
    expect(api.createShareLink).not.toHaveBeenCalled();
    await userEvent.clear(days);
    await userEvent.type(days, "7");
    await userEvent.click(within(dialog).getByRole("button", { name: "링크 만들기" }));
    expect(api.createShareLink).toHaveBeenCalledWith("501", 7);
    expect(await within(dialog).findByTestId("share-url")).toHaveTextContent("https://data2flow.java21.net/share/tok_xyz");
    await userEvent.click(within(dialog).getByRole("button", { name: "주소 복사" }));
    expect(writeText).toHaveBeenCalledWith("https://data2flow.java21.net/share/tok_xyz");
    const revokes = within(dialog).getAllByRole("button", { name: "폐기" });
    expect(revokes).toHaveLength(2);
    await userEvent.click(revokes[0]);
    expect(api.revokeShareLink).toHaveBeenCalledWith("501", "3");
    await waitFor(() => expect(within(dialog).getAllByText("– 폐기됨")).toHaveLength(1));
  });

  it("목록·만들기·폐기 실패 안내", async () => {
    const api = {
      shareLinks: vi.fn(async () => ({ ok: false as const, status: 500, code: "X", message: "" })),
      createShareLink: vi.fn(async () => ({ ok: false as const, status: 403, code: "PERMISSION_DENIED", message: "" })),
      revokeShareLink: vi.fn(async () => ({ ok: false as const, status: 500, code: "X", message: "" })),
    };
    await renderRoute(<ShareLinksDialog dashboardId="501" open onClose={vi.fn()} timezone="Asia/Seoul" api={api as never} />);
    expect(await screen.findByText("링크 목록을 불러오지 못했습니다")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "링크 만들기" }));
    expect(await screen.findByText("링크를 만들지 못했습니다")).toBeInTheDocument();
  });

  it("공유 화면 위젯 데이터는 쿠키 없이 BFF 공개 GET 경로로(요청은 쿼리 q 하나)", async () => {
    expect(sharedWidgetDataUrl("tok", "w1", { timeRange: { relative: "1h" } })).toBe(`/share/tok/widgets/w1/data?q=${encodeURIComponent('{"timeRange":{"relative":"1h"}}')}`);
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ header: { resultCode: "SUCCESS" }, response: { type: "stat", data: { value: 1 } } }), { status: 200 }));
    const r = await sharedWidgetData("tok", "w1", {}, undefined, fetchImpl as unknown as typeof fetch);
    expect(r).toMatchObject({ ok: true, data: { type: "stat" } });
    expect((fetchImpl.mock.calls[0] as unknown[])[1]).toMatchObject({ credentials: "omit" });
    const bad = await sharedWidgetData("tok", "w1", {}, undefined, (async () => new Response(JSON.stringify({ header: { resultCode: "SHARE_LINK_INVALID" } }), { status: 404 })) as unknown as typeof fetch);
    expect(bad).toMatchObject({ ok: false, code: "SHARE_LINK_INVALID" });
    const down = await sharedWidgetData("tok", "w1", {}, undefined, (async () => {
      throw new Error("net");
    }) as unknown as typeof fetch);
    expect(down).toMatchObject({ ok: false, code: "SERVICE_UNAVAILABLE" });
  });
});

describe("DSH-08.04 기능 안내 투어", () => {
  afterEach(() => {
    localStorage.clear();
  });
  const steps = [1, 2, 3, 4, 5, 6].map((n) => ({ title: `단계${n}`, body: `설명${n}` }));

  it("TC-DSH-086: 처음 방문하면 3~5단계, 키보드로 진행·이전, Esc 종료, [다시 보지 않기]는 설정과 브라우저에 저장되어 다시 안 보임", async () => {
    const onDismiss = vi.fn();
    const { unmount } = await renderRoute(<FeatureTour tourId="dash" steps={steps} dismissed={[]} onDismiss={onDismiss} />);
    const dialog = await screen.findByRole("dialog", { name: "단계1" });
    expect(within(dialog).getByText("1/5단계")).toBeInTheDocument();
    dialog.focus();
    await userEvent.keyboard("{ArrowRight}{Enter}");
    expect(screen.getByRole("dialog", { name: "단계3" })).toBeInTheDocument();
    await userEvent.keyboard("{ArrowLeft}");
    expect(screen.getByRole("dialog", { name: "단계2" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "이전" }));
    await userEvent.click(screen.getByRole("button", { name: "다음" }));
    await userEvent.click(screen.getByRole("button", { name: "다음" }));
    await userEvent.click(screen.getByRole("button", { name: "다음" }));
    await userEvent.click(screen.getByRole("button", { name: "다음" }));
    expect(screen.getByText("5/5단계")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "마침" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    unmount();

    await renderRoute(<FeatureTour tourId="dash" steps={steps} dismissed={[]} onDismiss={onDismiss} />);
    const again = await screen.findByRole("dialog", { name: "단계1" });
    again.focus();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("[다시 보지 않기] → toursDismissed 저장, 이미 닫은 투어·3단계 미만은 안 보임, 저장소 오류에도 동작", async () => {
    const onDismiss = vi.fn();
    const first = await renderRoute(<FeatureTour tourId="dash" steps={steps} dismissed={[]} onDismiss={onDismiss} />);
    await userEvent.click(await screen.findByRole("button", { name: "다시 보지 않기" }));
    expect(onDismiss).toHaveBeenCalledWith("dash");
    expect(readDismissedLocal()).toEqual(["dash"]);
    first.unmount();
    await renderRoute(<FeatureTour tourId="dash" steps={steps} dismissed={[]} onDismiss={onDismiss} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    await renderRoute(<FeatureTour tourId="other" steps={steps} dismissed={["other"]} onDismiss={onDismiss} />);
    await renderRoute(<FeatureTour tourId="short" steps={steps.slice(0, 2)} dismissed={[]} onDismiss={onDismiss} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(tourSteps(steps)).toHaveLength(5);
    const broken = { getItem: () => "{bad", setItem: () => { throw new Error("quota"); } };
    expect(readDismissedLocal(broken)).toEqual([]);
    expect(() => writeDismissedLocal("x", broken)).not.toThrow();
    expect(readDismissedLocal(null)).toEqual([]);
  });
});

describe("DSH-06.01 PNG", () => {
  it("TC-DSH-061: 영역을 복제해 차트 캔버스는 같은 픽셀 이미지로 바꾸고 화면 메뉴(.no-export)는 빼고 그린다", async () => {
    const node = document.createElement("div");
    node.innerHTML = '<h3>제목</h3><canvas style="width:10px"></canvas><div class="no-export">메뉴</div>';
    document.body.appendChild(node);
    const canvas = node.querySelector("canvas") as HTMLCanvasElement;
    canvas.toDataURL = () => "data:image/png;base64,CHART";
    let svg = "";
    const drawn: unknown[] = [];
    const out = await nodeToPng(node, "#ffffff", 2, {
      loadImage: async (src) => {
        svg = decodeURIComponent(src.replace("data:image/svg+xml;charset=utf-8,", ""));
        return {} as CanvasImageSource;
      },
      createCanvas: (w, h) =>
        ({
          width: w,
          height: h,
          getContext: () => ({ fillRect: (...a: unknown[]) => drawn.push(["fill", ...a]), scale: () => undefined, drawImage: () => drawn.push("image"), fillStyle: "" }),
          toDataURL: () => "data:image/png;base64,OUT",
        }) as unknown as HTMLCanvasElement,
    });
    expect(out).toBe("data:image/png;base64,OUT");
    expect(svg).toContain("<foreignObject");
    expect(svg).toContain('src="data:image/png;base64,CHART"');
    expect(svg).toContain("제목");
    expect(svg).not.toContain("메뉴");
    expect(drawn).toContain("image");
    node.remove();
  });

  it("PNG 내려받기는 data URL을 파일 이름과 함께 링크로 연다", () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    downloadDataUrl("data:image/png;base64,AAA", "a.png");
    expect(click).toHaveBeenCalledTimes(1);
    expect(document.querySelector('a[download="a.png"]')).toBeNull();
    click.mockRestore();
  });
});
