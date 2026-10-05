/**
 * UI-ANA-01 템플릿 갤러리(ANA-01.01·01.04·01.07)·UI-ANA-02 설명서(ANA-01.06) 인수 시험.
 */
import { act, fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useLocation } from "react-router";
import { meOf, renderRoute } from "../../../../test/render";
import { Gallery } from "../components/gallery";
import { TemplateGuideView } from "../components/template-guide";
import { ANOMALY, TEMPLATES, failed, fakeAnalyticsApi, ok } from "./fixtures";

afterEach(() => {
  vi.useRealTimers();
});

function Where() {
  const location = useLocation();
  return <output data-testid="where">{location.search}</output>;
}

const SPACES = [{ id: "31", name: "실습실", type: "ROOM" }];

describe("ANA-01.01 UI-ANA-01 템플릿 갤러리", () => {
  it("TC-ANA-001 AT-ANA-01.1 VIEWER: 카드마다 이름·요약·대표 질문·필요 데이터·카테고리 배지, [이 템플릿으로 분석] 없음", async () => {
    await renderRoute(<Gallery initial={TEMPLATES} canRun={false} spaces={SPACES} api={fakeAnalyticsApi()} />, { session: meOf("VIEWER") });
    const card = await screen.findByRole("article", { name: "이상 탐지" });
    expect(within(card).getByText("평소와 다른 값이나 구간을 찾습니다")).toBeInTheDocument();
    expect(within(card).getByText(/평소와 다른 값이 있었나\?/)).toBeInTheDocument();
    expect(within(card).getByText("필요 데이터: target · 최소 7일")).toBeInTheDocument();
    expect(within(card).getByText("일반")).toBeInTheDocument();
    expect(within(card).getByText("범용")).toBeInTheDocument();
    expect(screen.getAllByRole("article")).toHaveLength(4);
    expect(screen.queryByRole("link", { name: "이 템플릿으로 분석" })).toBeNull();
    expect(within(card).getByRole("link", { name: "설명서 보기" })).toHaveAttribute("href", "/analytics/templates/anomaly-detect");
  });

  it("TC-ANA-001 ANALYST: [이 템플릿으로 분석]이 마법사로 이어진다", async () => {
    await renderRoute(<Gallery initial={TEMPLATES} canRun spaces={SPACES} api={fakeAnalyticsApi()} />, { session: meOf("ANALYST") });
    const card = await screen.findByRole("article", { name: "쾌적도 분석" });
    expect(within(card).getByRole("link", { name: "이 템플릿으로 분석" })).toHaveAttribute("href", "/analytics/new?template=comfort-index");
  });

  it("TC-ANA-005 ANALYTICS_UNAVAILABLE이면 오류 상태와 [다시 시도] → 다시 1회 요청, 카테고리·범용/도메인 필터는 URL 쿼리에 남는다", async () => {
    const api = fakeAnalyticsApi();
    await renderRoute(
      <>
        <Gallery initial={[]} failed={{ code: "ANALYTICS_UNAVAILABLE" }} canRun spaces={SPACES} api={api} />
        <Where />
      </>,
    );
    expect(await screen.findByText("분석 템플릿을 불러오지 못했습니다")).toBeInTheDocument();
    expect(screen.getByText("분석 서비스에 잠시 연결할 수 없습니다. 잠시 뒤 다시 시도해 주세요.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(api.listTemplates).toHaveBeenCalledTimes(1);
    expect(await screen.findAllByRole("article")).toHaveLength(4);

    await userEvent.click(screen.getByRole("button", { name: "설비·센서 건강" }));
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.getByTestId("where").textContent).toBe("?category=ASSET_HEALTH");
    await userEvent.click(screen.getByRole("button", { name: "전체" }));
    await userEvent.click(screen.getByRole("button", { name: "도메인" }));
    expect(screen.getByTestId("where").textContent).toBe("?kind=DOMAIN");
    expect(screen.getAllByRole("article").map((a) => a.getAttribute("data-template"))).toEqual(["comfort-index", "sensor-health"]);
  });

  it("TC-ANA-033 AT-ANA-08.1 질문 검색: 400ms 뒤 한 번만 요청, 첫 카드 sensor-health, 일치 문장 <mark>, 낱말 검색이면 안내 띠", async () => {
    const api = fakeAnalyticsApi({ listTemplates: vi.fn(async () => ok({ responses: [{ ...TEMPLATES[2], score: 1, matchedQuestion: "센서 고장이 있나?", mode: "KEYWORD" as const }] })) });
    await renderRoute(<Gallery initial={TEMPLATES} canRun spaces={SPACES} api={api} />);
    const input = await screen.findByRole("searchbox", { name: "무엇이 궁금한가요?" });
    vi.useFakeTimers();
    fireEvent.change(input, { target: { value: "센서" } });
    fireEvent.change(input, { target: { value: "센서 고장" } });
    await act(async () => vi.advanceTimersByTime(399));
    expect(api.listTemplates).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(1));
    expect(api.listTemplates).toHaveBeenCalledTimes(1);
    expect(api.listTemplates).toHaveBeenCalledWith({ keyword: "센서 고장" });
    vi.useRealTimers();
    const cards = await screen.findAllByRole("article");
    expect(cards[0]).toHaveAttribute("data-template", "sensor-health");
    expect([...cards[0].querySelectorAll("mark")].map((m) => m.textContent)).toEqual(expect.arrayContaining(["센서", "고장"]));
    expect(screen.getByText("의미 검색을 쓸 수 없어 낱말 검색으로 찾았습니다.")).toBeInTheDocument();
  });

  it("검색 결과가 없으면 빈 화면과 [전체 보기]", async () => {
    const api = fakeAnalyticsApi({ listTemplates: vi.fn(async () => ok({ responses: [] })) });
    await renderRoute(<Gallery initial={TEMPLATES} canRun spaces={SPACES} api={api} debounceMs={0} />);
    fireEvent.change(await screen.findByRole("searchbox"), { target: { value: "없는 질문" } });
    expect(await screen.findByText("검색어와 맞는 템플릿이 없습니다")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "전체 보기" }));
    expect(await screen.findAllByRole("article")).toHaveLength(4);
  });

  it("TC-ANA-020 AT-ANA-08.2 [실행 가능한 템플릿만]: 공간을 고르면 API-ANA-04, 실행 못 하는 카드는 숨기지 않고 '데이터 없음' 배지와 함께 끝으로", async () => {
    const api = fakeAnalyticsApi({
      listTemplates: vi.fn(async () =>
        ok({ responses: [{ key: "comfort-index", runnable: false, missingRoles: [{ role: "co2", semantic: "co2" }] }, { key: "anomaly-detect", runnable: true }, { key: "sensor-health", runnable: true }, { key: "forecast", runnable: true }] as never }),
      ),
    });
    await renderRoute(<Gallery initial={TEMPLATES} canRun spaces={SPACES} api={api} />);
    await userEvent.click(await screen.findByLabelText("실행 가능한 템플릿만"));
    expect(screen.getByText("공간을 고르면 그 공간의 기기로 실행할 수 있는지 표시합니다.")).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("기준 공간"), "31");
    expect(api.listTemplates).toHaveBeenCalledWith({ view: "runnable", spaceId: "31" });
    await screen.findByText("데이터 없음");
    const keys = screen.getAllByRole("article").map((a) => a.getAttribute("data-template"));
    expect(keys).toEqual(["anomaly-detect", "sensor-health", "forecast", "comfort-index"]);
    expect(screen.getByText("데이터 없음").parentElement).toHaveAttribute("title", "이 공간에 없는 데이터: co2");
  });

  it("실행 가능성 조회가 실패하면 오류 문구를 보인다(목록은 그대로)", async () => {
    const api = fakeAnalyticsApi({ listTemplates: vi.fn(async () => failed(404, "RESOURCE_NOT_FOUND")) });
    await renderRoute(<Gallery initial={TEMPLATES} canRun spaces={SPACES} api={api} />);
    await userEvent.click(await screen.findByLabelText("실행 가능한 템플릿만"));
    await userEvent.selectOptions(screen.getByLabelText("기준 공간"), "31");
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getAllByRole("article")).toHaveLength(4);
  });

  it("영어 화면: 카테고리·버튼 문구가 바뀐다(ADR-037)", async () => {
    await renderRoute(<Gallery initial={TEMPLATES} canRun spaces={SPACES} api={fakeAnalyticsApi()} />, { lang: "en" });
    expect(await screen.findByRole("button", { name: "Equipment & sensor health" })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Analyze with this template" })).toHaveLength(4);
  });
});

describe("ANA-01.06 UI-ANA-02 템플릿 설명서", () => {
  it("TC-ANA-030 AT-ANA-01.1 9항목을 순서대로, 필요한 데이터·파라미터 표, 마크다운 속 스크립트는 글자로만", async () => {
    const evil = { ...ANOMALY, guide: { ...ANOMALY.guide, howToRead: '<script>window.__pwned = true</script>빨간 점은 단발 이상' } };
    await renderRoute(<TemplateGuideView template={evil} canRun />);
    const sections = (await screen.findAllByRole("heading", { level: 2 })).map((h) => h.textContent);
    expect(sections).toEqual(["1. 요약", "2. 언제 쓰나", "3. 언제 쓰면 안 되나", "4. 필요한 데이터", "5. 파라미터", "6. 결과 읽는 법", "7. 주의점", "8. 사용 예시", "9. 알고리즘·참고 문헌"]);
    expect(screen.getByText(/<script>window.__pwned = true<\/script>/)).toBeInTheDocument();
    expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined();
    expect(screen.getByRole("cell", { name: "target" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "1~5" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "이 템플릿으로 분석" })).toHaveAttribute("href", "/analytics/new?template=anomaly-detect");
    expect(screen.getByLabelText("버전")).toHaveValue("1.2.0");
  });

  it("guide.params가 없으면 파라미터 스키마로 표를 만들고, 꺼진 템플릿은 배지와 함께 [분석] 버튼이 없다", async () => {
    await renderRoute(<TemplateGuideView template={{ ...ANOMALY, enabled: false, guide: { ...ANOMALY.guide, params: [] } }} canRun />);
    expect(await screen.findByRole("cell", { name: "zscore / iqr" })).toBeInTheDocument();
    expect(screen.getByText("이 조직에서 꺼진 템플릿")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "이 템플릿으로 분석" })).toBeNull();
  });
});
