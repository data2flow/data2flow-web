/**
 * UI-DSC-04 외부 맥락 카드: TC-DSC-138(권한별 버튼·오류 표시), TC-DSC-144(측정소 거리순·API 키·위치 필요), TC-DSC-156(iCal 검증·매핑 편집), TC-DSC-162(호출량 막대).
 */
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderRoute } from "../../../../test/render";
import { ContextCards, UsageBars } from "../components/context-cards";
import type { SiteContext } from "../model/context";

const site: SiteContext = {
  siteId: "1",
  siteName: "광주캠퍼스",
  latitude: 35.15,
  longitude: 126.85,
  locationRequired: false,
  kmaNx: 58,
  kmaNy: 74,
  sources: [
    { type: "KMA_WEATHER", sourceId: "71", enabled: true, apiKeyConfigured: true, config: { nx: 58, ny: 74, items: ["T1H", "REH"], dailyQuota: 1000 }, provider: { key: "kma", available: true, simulated: false }, lastSync: { at: "2026-10-04T02:00:00Z", status: "SUCCESS", added: 0, updated: 0, removed: 0 }, usageToday: { calls: 312, failures: 0, quota: 1000, warning: false, exhausted: false }, version: 2 },
    { type: "AIRKOREA", sourceId: "72", enabled: false, apiKeyConfigured: false, config: { stationName: "운암동" }, provider: { key: "airkorea", available: true, simulated: true } },
    { type: "ICAL", sourceId: "73", enabled: true, apiKeyConfigured: false, config: { url: "https://school.ac.kr/a.ics", typeMapping: { 시험: "EXAM" }, refreshHours: 6 }, lastSync: { at: "2026-10-04T02:00:00Z", status: "SUCCESS", added: 2, updated: 0, removed: 1 }, usageToday: { calls: 800, failures: 1, quota: 1000, warning: true, exhausted: false } },
  ],
};
const stations = [
  { stationName: "농성동", distanceKm: 2.4 },
  { stationName: "치평동", distanceKm: 1.2 },
];

describe("UI-DSC-04 외부 맥락 카드", () => {
  it("TC-DSC-144: 측정소는 가까운 순 \"치평동 1.2km\", 켤 때 API 키를 비우면 저장이 막힌다", async () => {
    await renderRoute(<ContextCards site={site} stations={stations} canAdmin timezone="Asia/Seoul" lang="ko" />);
    const station = (await screen.findByLabelText("측정소")) as HTMLSelectElement;
    expect([...station.options].map((o) => o.textContent)).toEqual(["가장 가까운 측정소(자동)", "운암동", "치평동 1.2km", "농성동 2.4km"]);
    const air = station.closest("form")!;
    const save = within(air).getByRole("button", { name: "저장" });
    expect(save).toBeEnabled();
    await userEvent.click(within(air).getByLabelText("켜기"));
    expect(within(air).getByText("켤 때는 API 키가 필요합니다")).toBeInTheDocument();
    expect(save).toBeDisabled();
    await userEvent.type(within(air).getByLabelText("API 키"), "air-key");
    expect(save).toBeEnabled();
    expect(screen.getByText("시뮬레이터 값")).toBeInTheDocument();
  });

  it("기상청 카드: 저장된 키 안내, 격자 자동 표시와 범위 검사, 오늘 호출, 지금 갱신", async () => {
    await renderRoute(<ContextCards site={site} stations={[]} canAdmin timezone="Asia/Seoul" lang="ko" result={{ intent: "refresh", type: "KMA_WEATHER", ok: true, refresh: { status: "SUCCESS", added: 3, updated: 0, removed: 0 } }} />);
    expect(await screen.findByText("자동(사이트 좌표)")).toBeInTheDocument();
    expect(screen.getAllByText("저장된 키가 있습니다. 바꿀 때만 입력하세요.")).toHaveLength(1);
    expect(screen.getByText(/오늘 호출 312\/1000/)).toBeInTheDocument();
    expect(screen.getByText("갱신: ✓ 성공 +3 −0")).toBeInTheDocument();
    const nx = screen.getByLabelText("nx");
    await userEvent.clear(nx);
    await userEvent.type(nx, "200");
    expect(screen.getByText("격자 범위를 벗어났습니다(nx 1~149, ny 1~253)")).toBeInTheDocument();
    expect(screen.queryByText("자동(사이트 좌표)")).toBeNull();
    expect(screen.getAllByRole("button", { name: "지금 갱신" })).toHaveLength(2);
  });

  it("TC-DSC-156: iCal 주소 검증, .ics 2MB 파일 검사, 카테고리 → 유형 매핑 편집, 마지막 동기화 +2 −1, 80% 경고", async () => {
    await renderRoute(<ContextCards site={site} stations={[]} canAdmin timezone="Asia/Seoul" lang="ko" />);
    const url = await screen.findByLabelText("iCal 주소(https:// 또는 webcal://)");
    const form = url.closest("form")!;
    expect(within(form.parentElement!).getByText(/\+2 −1/)).toBeInTheDocument();
    expect(screen.getByText(/80% 도달/)).toBeInTheDocument();
    await userEvent.clear(url);
    await userEvent.type(url, "http://school/a.ics");
    expect(within(form).getByText("https:// 또는 webcal:// 주소만 쓸 수 있습니다")).toBeInTheDocument();
    await userEvent.clear(url);
    const file = within(form).getByLabelText(/\.ics 파일/);
    await userEvent.upload(file, new File(["x"], "a.txt"), { applyAccept: false });
    expect(within(form).getByText(".ics 파일만 올릴 수 있습니다")).toBeInTheDocument();
    expect(within(form).getByRole("button", { name: "저장" })).toBeDisabled();
    await userEvent.upload(file, new File(["BEGIN:VCALENDAR"], "a.ics"));
    expect(within(form).getByRole("button", { name: "저장" })).toBeEnabled();
    const hidden = () => JSON.parse((form.querySelector('input[name="typeMapping"]') as HTMLInputElement).value);
    expect(hidden()).toEqual([{ category: "시험", type: "EXAM" }]);
    await userEvent.click(within(form).getByRole("button", { name: "+ 매핑" }));
    const categories = within(form).getAllByLabelText("카테고리");
    await userEvent.type(categories[1], "방학");
    await userEvent.selectOptions(within(form).getAllByLabelText("일정 유형")[1], "VACATION");
    expect(hidden()).toEqual([{ category: "시험", type: "EXAM" }, { category: "방학", type: "VACATION" }]);
    await userEvent.click(within(form).getByRole("button", { name: "시험 매핑 삭제" }));
    expect(hidden()).toEqual([{ category: "방학", type: "VACATION" }]);
  });

  it("TC-DSC-138: OPERATOR는 조회만(저장·지금 갱신 없음), 좌표 없으면 \"위치 필요\"와 공간 화면 링크, 서버 오류 표시", async () => {
    const { unmount } = await renderRoute(<ContextCards site={{ ...site, locationRequired: true, latitude: null, longitude: null }} stations={[]} canAdmin={false} timezone="Asia/Seoul" lang="ko" />);
    expect(await screen.findByText(/위치 필요/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "공간 화면에서 좌표 입력" })).toHaveAttribute("href", "/spaces/1?tab=props");
    expect(screen.queryByRole("button", { name: "저장" })).toBeNull();
    expect(screen.queryByRole("button", { name: "지금 갱신" })).toBeNull();
    expect(screen.getByText("격자 nx 58 ny 74")).toBeInTheDocument();
    expect(screen.getByText("측정소 운암동")).toBeInTheDocument();
    expect(screen.getByText("https://school.ac.kr/a.ics")).toBeInTheDocument();
    unmount();
    await renderRoute(<ContextCards site={site} stations={[]} canAdmin timezone="Asia/Seoul" lang="ko" result={{ intent: "save", type: "HOLIDAY", error: { code: "SOURCE_CONFIG_INVALID" }, fieldErrors: {} }} />);
    expect(await screen.findByText("소스 설정이 올바르지 않습니다.")).toBeInTheDocument();
  });
});

describe("TC-DSC-162 호출량 막대", () => {
  it("일일 막대(경고·중지 색), 오늘 호출·비율·문구, 비용", async () => {
    const days = [
      { day: "2026-10-02", calls: 100, failures: 0, quota: 1000, warning: false, exhausted: false, cost: 200 },
      { day: "2026-10-03", calls: 850, failures: 0, quota: 1000, warning: true, exhausted: false, cost: 1700 },
      { day: "2026-10-04", calls: 1000, failures: 4, quota: 1000, warning: true, exhausted: true, cost: 2000 },
    ];
    await renderRoute(<UsageBars title="기상청 날씨" days={days} today="2026-10-04" lang="ko" />);
    const chart = await screen.findByRole("img", { name: "최근 3일 일일 호출 막대" });
    expect([...chart.querySelectorAll("[data-level]")].map((e) => e.getAttribute("data-level"))).toEqual(["ok", "warn", "exhausted"]);
    expect(screen.getByText(/오늘 호출 1000\/1000 · 실패 4 · 100% · 한도 도달 — 다음 날까지 호출 중지/)).toBeInTheDocument();
    expect(screen.getByText("비용: 오늘 2,000 · 이번 달 3,900")).toBeInTheDocument();
  });

  it("기록이 없으면 안내, 오늘이 없으면 마지막 날", async () => {
    const { unmount } = await renderRoute(<UsageBars title="x" days={[]} today="2026-10-04" lang="ko" />);
    expect(await screen.findByText("호출 기록이 없습니다")).toBeInTheDocument();
    unmount();
    await renderRoute(<UsageBars title="x" days={[{ day: "2026-10-01", calls: 820, failures: 0, quota: 1000, warning: false, exhausted: false }, { day: "2026-10-02", calls: 7, failures: 0, quota: null, warning: false, exhausted: false }]} today="2026-10-04" lang="ko" />);
    expect(await screen.findByText("오늘 호출 7")).toBeInTheDocument();
  });
});
