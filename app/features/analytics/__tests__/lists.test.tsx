/**
 * UI-ANA-04 분석 목록(ANA-04.01·04.02), UI-ANA-06 모델 관리(ANA-07.01~07.04), DSH-04.04 분석 결과 위젯 인수 시험.
 */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Route, Routes, useLocation } from "react-router";
import { renderRoute } from "../../../../test/render";
import { AnalysisWidget } from "../../dashboards/components/analysis-widget";
import { WidgetBody } from "../../dashboards/components/widget-body";
import { AnalysesList, AnalysisEmpty } from "../components/analyses-list";
import { AnalyticsAreaTabs } from "../components/area-tabs";
import { ModelsPanel } from "../components/models-panel";
import type { AnalysisSummary } from "../model/types";
import { MODELS, RESULT, failed, fakeAnalyticsApi, ok } from "./fixtures";
import { meOf } from "../../../../test/render";

afterEach(() => vi.restoreAllMocks());

function Where() {
  const location = useLocation();
  return <output data-testid="where">{location.pathname}</output>;
}
const routed = (element: React.ReactElement) =>
  renderRoute(
    <Routes>
      <Route path="*" element={<>{element}<Where /></>} />
    </Routes>,
    { path: "/*", url: "/analytics" },
  );

const ITEMS: AnalysisSummary[] = [
  { id: "17", analysisId: "17", name: "실습실 쾌적도", templateKey: "comfort-index", templateVersion: "1.0.0", targetSummary: "실습실 외 1", lastRun: { id: "128", runId: "128", status: "SUCCEEDED", finishedAt: "2026-10-03T21:00:00Z" }, nextScheduledAt: "2026-10-04T21:00:00Z", scheduleState: "ACTIVE", realtime: true, owner: { id: "10", userId: "10", name: "박분석" } },
  { id: "18", name: "배터리 예측", templateKey: "battery-life", lastRun: { id: "90", status: "FAILED" }, scheduleState: "STOPPED_BY_FAILURE", owner: { id: "1", name: "홍길동" } },
];

describe("ANA-04 UI-ANA-04 분석 목록", () => {
  it("이름·템플릿(버전)·대상·마지막 실행 상태와 시각·다음 일정·실시간·소유자, 연속 실패면 '일정 중지됨'", async () => {
    await routed(<AnalysesList initial={ITEMS} canRun isAdmin={false} meId="10" api={fakeAnalyticsApi()} timezone="Asia/Seoul" />);
    const row = (await screen.findByRole("link", { name: "실습실 쾌적도" })).closest("tr") as HTMLElement;
    expect(within(row).getByText("comfort-index 1.0.0")).toBeInTheDocument();
    expect(within(row).getByText("실시간")).toBeInTheDocument();
    expect(within(row).getByText("성공 2026-10-04 06:00")).toBeInTheDocument();
    expect(within(row).getByText("2026-10-05 06:00")).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "삭제" })).toBeInTheDocument();
    const other = screen.getByRole("link", { name: "배터리 예측" }).closest("tr") as HTMLElement;
    expect(within(other).getByText("일정 중지됨(연속 실패)")).toBeInTheDocument();
    expect(within(other).queryByRole("button", { name: "삭제" })).toBeNull();
  });

  it("[다시 실행] → 새 실행 결과 화면, 실패하면 문구", async () => {
    const runAnalysis = vi.fn().mockResolvedValueOnce(ok({ runId: "130" }, 202)).mockResolvedValueOnce(failed(409, "TEMPLATE_DISABLED"));
    await routed(<AnalysesList initial={ITEMS} canRun isAdmin meId="1" api={fakeAnalyticsApi({ runAnalysis })} timezone="Asia/Seoul" />);
    await userEvent.click((await screen.findAllByRole("button", { name: "다시 실행" }))[0]);
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/analytics/17/runs/130"));
  });

  it("다시 실행이 실패하면 문구를 보인다", async () => {
    await routed(<AnalysesList initial={ITEMS} canRun isAdmin meId="1" api={fakeAnalyticsApi({ runAnalysis: vi.fn(async () => failed(409, "TEMPLATE_DISABLED")) })} timezone="Asia/Seoul" />);
    await userEvent.click((await screen.findAllByRole("button", { name: "다시 실행" }))[1]);
    expect(await screen.findByText("이 조직에서 꺼진 템플릿입니다.")).toBeInTheDocument();
  });

  it("경고 미확인이면 확인 창 뒤 acknowledgeWarnings=true로 다시", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const runAnalysis = vi.fn().mockResolvedValueOnce(failed(400, "ANALYSIS_WARNING_NOT_ACKNOWLEDGED")).mockResolvedValueOnce(ok({ runId: "131" }, 202));
    await routed(<AnalysesList initial={ITEMS} canRun isAdmin meId="1" api={fakeAnalyticsApi({ runAnalysis })} timezone="Asia/Seoul" />);
    await userEvent.click((await screen.findAllByRole("button", { name: "다시 실행" }))[0]);
    await waitFor(() => expect(runAnalysis).toHaveBeenLastCalledWith("17", true));
  });

  it("API-ANA-22 [삭제]: 확인 대화상자 뒤 목록에서 빠진다, 다 지우면 빈 목록 안내", async () => {
    const api = fakeAnalyticsApi();
    await routed(<AnalysesList initial={[ITEMS[0]]} canRun isAdmin meId="1" api={api} timezone="Asia/Seoul" />);
    await userEvent.click(await screen.findByRole("button", { name: "삭제" }));
    const dialog = screen.getByRole("dialog", { name: "분석 삭제" });
    expect(within(dialog).getByText(/“실습실 쾌적도”을\(를\) 삭제합니다/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "삭제" }));
    expect(api.deleteAnalysis).toHaveBeenCalledWith("17");
    expect(await screen.findByText("아직 분석이 없습니다")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "템플릿 갤러리로" })).toHaveAttribute("href", "/analytics/templates");
  });

  it("삭제가 실패하면 문구", async () => {
    await routed(<AnalysesList initial={[ITEMS[0]]} canRun isAdmin meId="1" api={fakeAnalyticsApi({ deleteAnalysis: vi.fn(async () => failed(404, "ANALYSIS_NOT_FOUND")) })} timezone="Asia/Seoul" />);
    await userEvent.click(await screen.findByRole("button", { name: "삭제" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "삭제" }));
    expect(await screen.findByText("분석을 찾을 수 없습니다.")).toBeInTheDocument();
  });

  it("실행이 없는 분석: 저장 안내와 [지금 실행] → 결과 화면, 실패 문구", async () => {
    const runAnalysis = vi.fn().mockResolvedValueOnce(failed(409, "ANALYSIS_INSUFFICIENT_DATA")).mockResolvedValueOnce(ok({ runId: "132" }, 202));
    await routed(<AnalysisEmpty analysis={{ analysisId: "17", name: "x", templateKey: "a", schedule: { preset: "DAILY", at: "06:00" } }} canRun saved api={fakeAnalyticsApi({ runAnalysis })} />);
    expect(await screen.findByText("분석을 저장했습니다.")).toBeInTheDocument();
    expect(screen.getByText("일정에 따라 실행되면 결과가 여기에 보입니다.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "지금 실행" }));
    expect(await screen.findByText("데이터가 부족해 실행할 수 없습니다.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "지금 실행" }));
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/analytics/17/runs/132"));
  });

  it("분석 영역 탭: VIEWER는 갤러리·목록만, ANALYST는 모델·MCP 연결까지", async () => {
    const first = await renderRoute(<AnalyticsAreaTabs current="analyses" />, { session: meOf("VIEWER") });
    expect(await screen.findByRole("link", { name: "분석 목록" })).toHaveAttribute("aria-current", "page");
    expect(screen.queryByRole("link", { name: "모델" })).toBeNull();
    first.unmount();
    await renderRoute(<AnalyticsAreaTabs current="models" />, { session: meOf("ANALYST") });
    expect(await screen.findByRole("link", { name: "MCP 연결" })).toHaveAttribute("href", "/ai/mcp");
  });
});

describe("ANA-07 UI-ANA-06 모델 관리", () => {
  it("TC-ANA-148 AT-ANA-06.1 버전·상태·학습 기간·MAE, 라벨 없는 정밀도는 '–', TC-ANA-154 드리프트 배지와 [재학습]", async () => {
    const api = fakeAnalyticsApi();
    await renderRoute(<ModelsPanel initial={MODELS} canManage api={api} timezone="Asia/Seoul" />);
    expect(await screen.findByText("드리프트 감지")).toBeInTheDocument();
    const active = screen.getByRole("cell", { name: "v3" }).closest("tr") as HTMLElement;
    expect(within(active).getByText("사용 중")).toBeInTheDocument();
    expect(within(active).getByRole("cell", { name: "0.41" })).toBeInTheDocument();
    expect(within(active).getAllByRole("cell", { name: "–" }).length).toBeGreaterThanOrEqual(1);
    await userEvent.click(screen.getByRole("button", { name: "재학습" }));
    expect(api.trainModel).toHaveBeenCalledWith("17");
    expect(await screen.findByText("재학습을 시작했습니다(v5).")).toBeInTheDocument();
  });

  it("ANA-07.03 후보 [적용]: 지금보다 나쁘면(409) 확인 뒤 force=true", async () => {
    const activateModel = vi.fn().mockResolvedValueOnce(failed(409, "MODEL_WORSE_THAN_ACTIVE")).mockResolvedValueOnce(ok({ modelId: "302", status: "ACTIVE" }));
    await renderRoute(<ModelsPanel initial={MODELS} canManage api={fakeAnalyticsApi({ activateModel })} timezone="Asia/Seoul" />);
    await userEvent.click(await screen.findByRole("button", { name: "적용" }));
    const dialog = await screen.findByRole("dialog", { name: "성능이 낮은 후보" });
    await userEvent.click(within(dialog).getByRole("button", { name: "그래도 적용" }));
    expect(activateModel).toHaveBeenLastCalledWith("302", true);
    expect(await screen.findByText("v4을 적용했습니다.")).toBeInTheDocument();
  });

  it("관리 권한이 없으면 버튼이 없고, 모델이 없으면 안내, 재학습 실패 문구", async () => {
    const first = await renderRoute(<ModelsPanel initial={MODELS} canManage={false} api={fakeAnalyticsApi()} timezone="Asia/Seoul" />);
    await screen.findByText("드리프트 감지");
    expect(screen.queryByRole("button", { name: "재학습" })).toBeNull();
    first.unmount();
    const second = await renderRoute(<ModelsPanel initial={[]} canManage api={fakeAnalyticsApi()} timezone="Asia/Seoul" />);
    expect(await screen.findByText("학습한 모델이 없습니다")).toBeInTheDocument();
    second.unmount();
    await renderRoute(<ModelsPanel initial={MODELS} canManage api={fakeAnalyticsApi({ trainModel: vi.fn(async () => failed(403, "PERMISSION_DENIED")), activateModel: vi.fn(async () => failed(404, "ML_MODEL_NOT_FOUND")) })} timezone="Asia/Seoul" />);
    await userEvent.click(await screen.findByRole("button", { name: "재학습" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "적용" }));
    expect(await screen.findByText("모델을 찾을 수 없습니다.")).toBeInTheDocument();
  });
});

describe("DSH-04.04 분석 결과 위젯", () => {
  const factory = async () => ({ setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn() });
  it("TC-DSH-041 AT-DSH-05.3 ChartSpec 차트와 핵심 수치, 아래에 결과 시각·결과 링크, 주의 문구는 '참고용' 배지와 함께", async () => {
    const data = { analysisId: "17", deleted: false, runId: "128", finishedAt: "2026-10-04T00:00:12Z", chart: RESULT.result!.charts![0], metrics: RESULT.result!.summary!.metrics!.slice(0, 2), caveats: ["상관은 인과가 아닙니다"] };
    await renderRoute(<WidgetBody widget={{ id: "analysis-17", type: "analysis", x: 0, y: 0, w: 12, h: 8, targets: [], options: { analysisId: "17" } } as never} data={{ type: "analysis", data }} timezone="Asia/Seoul" height={300} tableOpen={false} table={{ columns: [], rows: [] } as never} chartFactory={factory} />);
    expect(await screen.findByRole("img", { name: "온도 추이 + 이상 지점" })).toBeInTheDocument();
    expect(screen.getByText("이상 건수")).toBeInTheDocument();
    expect(screen.getByText("참고용")).toBeInTheDocument();
    expect(screen.getByText("상관은 인과가 아닙니다")).toBeInTheDocument();
    expect(screen.getByText("결과 시각 2026-10-04 09:00")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "결과 보기" })).toHaveAttribute("href", "/analytics/17/runs/128");
  });

  it("API-ANA-22 지운 분석은 '삭제된 분석', 성공 결과가 없으면 안내", async () => {
    const first = await renderRoute(<AnalysisWidget data={{ analysisId: "17", deleted: true, runId: null }} timezone="Asia/Seoul" height={200} />);
    expect(await screen.findByText("삭제된 분석")).toBeInTheDocument();
    first.unmount();
    await renderRoute(<AnalysisWidget data={{ analysisId: "17", runId: null }} timezone="Asia/Seoul" height={200} />);
    expect(await screen.findByText("아직 성공한 분석 결과가 없습니다.")).toBeInTheDocument();
  });
});
