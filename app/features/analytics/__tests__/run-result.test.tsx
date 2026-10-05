/**
 * UI-ANA-05 실행 결과(ANA-04.02·04.04·05.01~05.07·08.02·08.05)와 AI 해설 패널(AIA-01, ANA-05.04) 인수 시험.
 */
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Route, Routes, useLocation } from "react-router";
import type { EventSourceLike } from "~/lib/event-stream";
import { renderRoute } from "../../../../test/render";
import { COMMENTARY, fakeAiApi, streamOf } from "../../ai/__tests__/fake-ai-api";
import type { AiState } from "../../ai/model/types";
import { RunResult, type RunResultProps } from "../components/run-result";
import type { RunWithResult } from "../model/types";
import { MODELS, RESULT, RUN_OK, failed, fakeAnalyticsApi, ok } from "./fixtures";

class FakeEventSource implements EventSourceLike {
  static all: FakeEventSource[] = [];
  readyState = 0;
  onopen: ((e: Event) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  listeners: Record<string, ((e: MessageEvent) => void)[]> = {};
  closed = false;
  constructor(readonly url: string) {
    FakeEventSource.all.push(this);
  }
  addEventListener(type: string, l: (e: MessageEvent) => void) {
    (this.listeners[type] ??= []).push(l);
  }
  close() {
    this.closed = true;
  }
  emit(type: string, data: unknown) {
    for (const l of this.listeners[type] ?? []) l({ data: JSON.stringify(data), lastEventId: "" } as MessageEvent);
  }
}
const last = () => FakeEventSource.all[FakeEventSource.all.length - 1];

afterEach(() => {
  FakeEventSource.all = [];
  vi.useRealTimers();
});

const factory = async () => ({ setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn() });
const ANALYSIS = { analysisId: "17", name: "실습실 온도 이상 탐지", templateKey: "anomaly-detect", templateVersion: "1.2.0", resolution: "1m" as const };

function Where() {
  const location = useLocation();
  return <output data-testid="where">{location.pathname}</output>;
}

function show(overrides: Partial<RunResultProps> = {}, aiState: AiState = "ENABLED") {
  const exporter = { text: vi.fn(), png: vi.fn(async () => {}) };
  const props: RunResultProps = {
    analysis: ANALYSIS,
    initial: RESULT,
    runs: [RUN_OK, { ...RUN_OK, runId: "120", finishedAt: "2026-09-27T00:00:12Z" }],
    howToRead: "빨간 점은 단발 이상, 주황 띠는 이상 구간입니다",
    models: MODELS,
    commentaries: [],
    aiState,
    perms: { canRun: true, canPin: true, canFeedback: true, canAi: true },
    api: fakeAnalyticsApi(),
    aiApi: fakeAiApi(),
    timezone: "Asia/Seoul",
    createSource: (url) => new FakeEventSource(url),
    checkSession: async () => true,
    chartFactory: factory,
    exporter,
    ...overrides,
  };
  const view = renderRoute(
    <Routes>
      <Route path="*" element={<><RunResult {...props} /><Where /></>} />
    </Routes>,
    { path: "/*", url: "/analytics/17/runs/128" },
  );
  return { props, exporter, view };
}

describe("ANA-05.01 UI-ANA-05 결과 화면", () => {
  it("TC-ANA-115 AT-ANA-03.1 핵심 수치 카드·차트·표·메타정보(대상·기간·버전·알고리즘·실행 시각·포인트), 시각은 사용자 시간대", async () => {
    show();
    expect(await screen.findByText("최근 14일 중 이상 12건, 가장 큰 이상은 10/02 14:10 (점수 5.2)")).toBeInTheDocument();
    const metrics = screen.getByRole("region", { name: "핵심 수치" });
    expect(within(metrics).getByText("이상 건수")).toBeInTheDocument();
    expect(within(metrics).getByText("12")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "온도 추이 + 이상 지점" })).toBeInTheDocument();
    expect(screen.getByRole("grid", { name: "날짜별 군집" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "점수" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "2026-10-02 14:20" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "메타정보" }));
    expect(screen.getByText("실습실 EM300 · temperature")).toBeInTheDocument();
    expect(screen.getByText("anomaly-detect@1.2.0")).toBeInTheDocument();
    expect(screen.getByText("STL + robust z-score")).toBeInTheDocument();
    expect(screen.getByText("40,320")).toBeInTheDocument();
    expect(screen.getByText("1.2%")).toBeInTheDocument();
    expect(screen.getByText(/v4 · 후보 · MAE 0.38/)).toBeInTheDocument();
    expect(screen.getByText("드리프트 감지")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "결과 읽는 법" }));
    expect(screen.getByText("빨간 점은 단발 이상, 주황 띠는 이상 구간입니다")).toBeInTheDocument();
  });

  it("TC-ANA-160 AT-ANA-03.3 ANA-08.02 추정치는 범위와 '추정치' 배지, TC-ANA-072·ANA-08.05 주의 문구는 접힘 없이 늘 보인다", async () => {
    show();
    expect(await screen.findByText("범위 21.8~23")).toBeInTheDocument();
    expect(screen.getByText("추정치")).toBeInTheDocument();
    expect(screen.getByText("이상은 평소와 다름이지 잘못됨이 아닙니다")).toBeVisible();
  });

  it("TC-ANA-094 AT-ANA-02.6 provenance.virtual=true면 '가상 데이터 포함' 배지, false면 없음. 템플릿 버전이 다르면 배지", async () => {
    const virtual: RunWithResult = { ...RESULT, run: { ...RUN_OK, templateVersion: "1.1.0" }, result: { ...RESULT.result, provenance: { ...RESULT.result!.provenance, virtual: true } } };
    show({ initial: virtual });
    expect(await screen.findByText("가상 데이터 포함")).toBeInTheDocument();
    expect(screen.getByText("템플릿 버전 다름")).toBeInTheDocument();
  });

  it("가상 데이터가 없으면 배지가 없다", async () => {
    show();
    await screen.findByText("이상 건수");
    expect(screen.queryByText("가상 데이터 포함")).toBeNull();
  });

  it("TC-ANA-122 AT-ANA-03.1 이상 목록 행 [맞음]/[오탐] → API-ANA-15, 근거(임계값·기여)", async () => {
    const { props } = show();
    const table = (await screen.findByText("이상 목록")).closest("section") as HTMLElement;
    await userEvent.click(within(table).getByRole("button", { name: "오탐" }));
    expect(props.api.feedback).toHaveBeenCalledWith({ runId: "128", occurredAt: "2026-10-02T05:20:00Z", seriesKey: "1042:temperature", verdict: "FALSE_POSITIVE" });
    expect(await within(table).findByText("오탐")).toBeInTheDocument();
    expect(within(table).queryByRole("button", { name: "맞음" })).toBeNull();
    expect(screen.getByText("기여 70%")).toBeInTheDocument();
  });

  it("피드백 권한이 없으면 [맞음]/[오탐]이 없다", async () => {
    show({ perms: { canRun: false, canPin: false, canFeedback: false, canAi: false } });
    await screen.findByText("이상 목록");
    expect(screen.queryByRole("button", { name: "오탐" })).toBeNull();
    expect(screen.queryByRole("button", { name: "다시 실행" })).toBeNull();
    expect(screen.queryByRole("button", { name: "대시보드에 고정" })).toBeNull();
  });

  it("TC-ANA-127 AT-ANA-09.1 [비교]: 다른 성공 실행을 고르면 API-ANA-13, 카드에 '+4.2 (▲6%)'", async () => {
    const { props } = show();
    await userEvent.selectOptions(await screen.findByLabelText("기준 실행"), "120");
    expect(props.api.compare).toHaveBeenCalledWith("17", "120", "128");
    expect(await screen.findByText("+4.2 (▲6%)")).toBeInTheDocument();
    expect(screen.getByText("실행 #120과 비교")).toBeInTheDocument();
  });

  it("TC-ANA-130~133 ANA-05.07 내보내기: CSV는 화면에서 바로(UTF-8 BOM, 수치·표·차트), PDF는 API-ANA-12 비동기 안내, PNG는 결과 영역", async () => {
    const { props, exporter } = show();
    await userEvent.click(await screen.findByRole("button", { name: "CSV" }));
    const [csv, name] = exporter.text.mock.calls[0];
    expect(name).toBe("실습실_온도_이상_탐지-128.csv");
    expect(csv.startsWith("﻿metric,label,value,unit\nanomalies,이상 건수,12,")).toBe(true);
    expect(csv).toContain("# 이상 목록\ntime,seriesKey,score\n2026-10-02T05:20:00Z,1042:temperature,5.2");
    expect(csv).toContain("# 온도 추이 + 이상 지점\nx,온도");
    await userEvent.click(screen.getByRole("button", { name: "PNG" }));
    expect(exporter.png).toHaveBeenCalledWith(expect.any(HTMLElement), "실습실_온도_이상_탐지-128.png");
    await userEvent.click(screen.getByRole("button", { name: "PDF" }));
    expect(props.api.exportRun).toHaveBeenCalledWith("17", "128", { format: "PDF" });
    expect(await screen.findByText("PDF를 만들고 있습니다. 완료되면 알림 센터로 알려 드립니다.")).toBeInTheDocument();
  });

  it("TC-ANA-128 ANA-05.06 차트 [대시보드에 고정] → 대시보드 선택 → API-DSH-08(chartId), 핵심 수치는 metricKeys", async () => {
    const { props } = show();
    const chartCard = (await screen.findByText("온도 추이 + 이상 지점")).closest("section") as HTMLElement;
    await userEvent.click(within(chartCard).getByRole("button", { name: "대시보드에 고정" }));
    const dialog = await screen.findByRole("dialog", { name: "대시보드에 고정" });
    expect(await within(dialog).findByLabelText("대시보드")).toHaveValue("5");
    await userEvent.click(within(dialog).getByRole("button", { name: "고정" }));
    expect(props.api.pin).toHaveBeenCalledWith("5", { analysisId: "17", chartId: "series" });
    expect(await within(dialog).findByText("“실습실 현황”에 고정했습니다.")).toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: "대시보드 열기" })).toHaveAttribute("href", "/dashboards/5");
    await userEvent.click(within(dialog).getAllByRole("button", { name: "닫기" })[0]);
    const metrics = screen.getByRole("region", { name: "핵심 수치" });
    await userEvent.click(within(metrics.parentElement as HTMLElement).getAllByRole("button", { name: "대시보드에 고정" })[0]);
    const again = await screen.findByRole("dialog", { name: "대시보드에 고정" });
    await within(again).findByLabelText("대시보드");
    await userEvent.click(within(again).getByRole("button", { name: "고정" }));
    expect(props.api.pin).toHaveBeenLastCalledWith("5", { analysisId: "17", metricKeys: ["anomalies", "maxScore", "meanTemp"] });
  });

  it("고정할 대시보드가 없으면 안내와 대시보드 만들기 링크", async () => {
    show({ api: fakeAnalyticsApi({ listDashboards: vi.fn(async () => ok([])) }) });
    const chartCard = (await screen.findByText("온도 추이 + 이상 지점")).closest("section") as HTMLElement;
    await userEvent.click(within(chartCard).getByRole("button", { name: "대시보드에 고정" }));
    expect(await screen.findByText("고칠 수 있는 대시보드가 없습니다.")).toBeInTheDocument();
  });

  it("[표로 보기]로 차트를 데이터 표로 바꾼다(접근성)", async () => {
    show();
    const chartCard = (await screen.findByText("온도 추이 + 이상 지점")).closest("section") as HTMLElement;
    await userEvent.click(within(chartCard).getByRole("button", { name: "표로 보기" }));
    expect(within(chartCard).getByRole("columnheader", { name: "온도" })).toBeInTheDocument();
    expect(within(chartCard).getByRole("cell", { name: "30.2" })).toBeInTheDocument();
  });

  it("[다시 실행]: 경고 미확인 400이면 확인 대화상자 → 확인 후 acknowledgeWarnings=true, 새 실행 화면으로", async () => {
    const runAnalysis = vi.fn().mockResolvedValueOnce(failed(400, "ANALYSIS_WARNING_NOT_ACKNOWLEDGED")).mockResolvedValueOnce(ok({ runId: "130", status: "QUEUED" }, 202));
    show({ api: fakeAnalyticsApi({ runAnalysis }) });
    await userEvent.click(await screen.findByRole("button", { name: "다시 실행" }));
    const dialog = await screen.findByRole("dialog", { name: "데이터 경고" });
    await userEvent.click(within(dialog).getByRole("button", { name: "그래도 실행" }));
    expect(runAnalysis).toHaveBeenLastCalledWith("17", true);
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/analytics/17/runs/130"));
  });

  it("다시 실행이 다른 이유로 실패하면 문구", async () => {
    show({ api: fakeAnalyticsApi({ runAnalysis: vi.fn(async () => failed(409, "TEMPLATE_DISABLED")) }) });
    await userEvent.click(await screen.findByRole("button", { name: "다시 실행" }));
    expect(await screen.findByText("이 조직에서 꺼진 템플릿입니다.")).toBeInTheDocument();
  });

  it("[실행] 고르기로 다른 실행 화면으로 간다", async () => {
    show();
    await userEvent.selectOptions(await screen.findByLabelText("실행"), "120");
    expect(screen.getByTestId("where").textContent).toBe("/analytics/17/runs/120");
  });
});

describe("ANA-04.02 실행 상태(진행·실패·취소·만료)", () => {
  const running: RunWithResult = { run: { ...RUN_OK, status: "RUNNING", progress: 40, stage: "COMPUTE", finishedAt: null }, result: null };

  it("TC-ANA-103 AT-ANA-03.4 실행 중이면 상태 스트림을 구독해 진행률을 갱신하고, run-done을 받으면 새로고침 없이 결과로 바뀐다", async () => {
    const getRun = vi.fn(async () => ok(RESULT));
    show({ initial: running, api: fakeAnalyticsApi({ getRun }) });
    await screen.findByText("실행 진행");
    expect(last().url).toBe("/bff/stream/analytics/runs/128");
    act(() => last().emit("run-status", { runId: "128", status: "RUNNING", progress: 70, stage: "SAVE", queuePosition: null }));
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "70");
    expect(screen.getByText("저장")).toHaveAttribute("aria-current", "step");
    act(() => last().emit("run-done", { runId: "128", status: "SUCCEEDED", progress: 100, stage: "SAVE" }));
    expect(await screen.findByText("최근 14일 중 이상 12건, 가장 큰 이상은 10/02 14:10 (점수 5.2)")).toBeInTheDocument();
    expect(getRun).toHaveBeenCalledWith("17", "128");
    expect(screen.queryByText("실행 진행")).toBeNull();
    await waitFor(() => expect(last().closed).toBe(true));
  });

  it("TC-ANA-103 연결이 끊기면 5초마다 다시 읽는다(가짜 타이머)", async () => {
    const getRun = vi.fn(async () => ok(running));
    show({ initial: running, api: fakeAnalyticsApi({ getRun }), pollMs: 5000 });
    await screen.findByText("실행 진행");
    vi.useFakeTimers();
    await act(async () => {
      last().onerror?.(new Event("error"));
    });
    expect(screen.getByText(/실시간 연결이 끊겼습니다|연결/)).toBeInTheDocument();
    await act(async () => vi.advanceTimersByTime(4999));
    expect(getRun).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(1));
    expect(getRun).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTime(5000));
    expect(getRun.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("TC-ANA-189 QUEUED면 '대기 n번째, 예상 시작', TC-ANA-112 [취소] → API-ANA-10, 이미 끝났으면(409) 안내 후 다시 읽음", async () => {
    const queued: RunWithResult = { run: { ...RUN_OK, status: "QUEUED", queuePosition: 2, estimatedStartAt: "2026-10-04T00:05:00Z", progress: 0, stage: null, finishedAt: null }, result: null };
    const getRun = vi.fn(async () => ok(RESULT));
    show({ initial: queued, api: fakeAnalyticsApi({ cancelRun: vi.fn(async () => failed(409, "ANALYSIS_RUN_STATE_CONFLICT")), getRun }) });
    expect(await screen.findByText("대기 2번째, 예상 시작 2026-10-04 09:05")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "취소" }));
    expect(await screen.findByText("이미 끝난 실행입니다.")).toBeInTheDocument();
    expect(getRun).toHaveBeenCalled();
  });

  it("ANA-04.04 [취소]가 되면 '실행을 취소했습니다.'", async () => {
    show({ initial: { run: { ...RUN_OK, status: "RUNNING", progress: 10, finishedAt: null }, result: null } });
    await userEvent.click(await screen.findByRole("button", { name: "취소" }));
    expect(await screen.findByText("실행을 취소했습니다.")).toBeInTheDocument();
  });

  it("TC-ANA-105 실패: 사용자 메시지와 해결 안내, errorDetail(I 이상)이 있을 때만 [기술 로그 보기]", async () => {
    show({ initial: { run: { ...RUN_OK, status: "FAILED", errorCode: "ANALYSIS_INSUFFICIENT_DATA", errorMessage: "데이터가 너무 적습니다", errorDetail: "Traceback: ValueError" }, result: null } });
    expect(await screen.findByText("실행에 실패했습니다.")).toBeInTheDocument();
    expect(screen.getByText(/데이터가 너무 적습니다/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "기술 로그 보기" }));
    expect(screen.getByText("Traceback: ValueError")).toBeInTheDocument();
  });

  it("시간 초과·메시지 없는 실패는 코드 문구, errorDetail이 없으면 기술 로그 버튼 없음", async () => {
    show({ initial: { run: { ...RUN_OK, status: "TIMEOUT", errorCode: "ANALYSIS_LIMIT_EXCEEDED" }, result: null } });
    expect(await screen.findByText("실행 시간이 초과되었습니다.")).toBeInTheDocument();
    expect(screen.getByText(/실행 한도를 넘었습니다/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "기술 로그 보기" })).toBeNull();
  });

  it("ANA-05.08 보관 기간이 지난 결과는 안내", async () => {
    show({ initial: { run: RUN_OK, result: null, resultExpired: true } });
    expect(await screen.findByText("결과 보관 기간이 지났습니다.")).toBeInTheDocument();
  });
});

describe("ANA-05.04 AIA-01 AI 해설 패널", () => {
  it("TC-ANA-124 [AI 해설] → API-AIA-01 스트림을 보여 주고, 끝나면 저장본·근거 목록", async () => {
    const aiApi = fakeAiApi({ listCommentaries: vi.fn(async () => ({ ok: true as const, status: 200, data: { responses: [] } })) });
    show({ aiApi });
    await userEvent.click(await screen.findByRole("button", { name: "AI 해설" }));
    expect(screen.getByRole("tab", { name: "AI 해설" })).toHaveAttribute("aria-selected", "true");
    await userEvent.click(screen.getByRole("button", { name: "AI 해설 만들기" }));
    expect(aiApi.streamCommentary).toHaveBeenCalledWith({ subjectType: "ANALYSIS_RUN", subjectId: "128", analysisId: "17", regenerate: false }, expect.any(Function));
    const latest = await screen.findByRole("region", { name: "최신 AI 해설" });
    expect(within(latest).getByText("숫자 확인됨")).toBeInTheDocument();
    expect(within(latest).getByRole("button", { name: "12건 → 표 anomalies" })).toBeInTheDocument();
  });

  it("TC-AIA-006 AT-AIA-01.1 해설 속 숫자 링크를 누르면 근거 표로 옮겨 가 강조, 차트 인용은 차트로", async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    show({ commentaries: [COMMENTARY] });
    await userEvent.click(await screen.findByRole("tab", { name: "AI 해설" }));
    await userEvent.click(screen.getByRole("button", { name: "12건" }));
    expect(document.getElementById("result-table-anomalies")).toHaveClass("ring-2");
    expect(scroll).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "차트" }));
    expect(document.getElementById("result-chart-series")).toHaveClass("ring-2");
    await userEvent.click(screen.getByRole("button", { name: "5.2" }));
    expect(document.getElementById("result-metric-maxScore")).toHaveClass("ring-2");
  });

  it("TC-AIA-008 [다시 만들기]는 regenerate=true로 스트림을 다시 보이고, 이전 판은 접어서 펼쳐 본다", async () => {
    const older = { ...COMMENTARY, commentaryId: "899", contentMd: "이전 해설 본문", supersededBy: "900" };
    const aiApi = fakeAiApi({ listCommentaries: vi.fn(async () => ({ ok: true as const, status: 200, data: { responses: [{ ...COMMENTARY, commentaryId: "901" }, COMMENTARY, older] } })) });
    show({ aiApi, commentaries: [COMMENTARY, older] });
    await userEvent.click(await screen.findByRole("tab", { name: "AI 해설" }));
    expect(screen.getByText("이전 판 1개")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "다시 만들기" }));
    expect(aiApi.streamCommentary).toHaveBeenCalledWith(expect.objectContaining({ regenerate: true }), expect.any(Function));
    expect(await screen.findByText("이전 판 2개")).toBeInTheDocument();
    await userEvent.click(screen.getByText("이전 판 2개"));
    expect(screen.getByText("이전 해설 본문")).toBeInTheDocument();
  });

  it("TC-AIA-054 AT-AIA-01.2 UNVERIFIED 해설은 경고 띠와 불일치 숫자 '15' 강조", async () => {
    const unverified = { ...COMMENTARY, status: "UNVERIFIED" as const, contentMd: "이상은 15건입니다.", mismatches: [{ value: "15", context: "이상은 15건" }] };
    show({ commentaries: [unverified] });
    await userEvent.click(await screen.findByRole("tab", { name: "AI 해설" }));
    expect(screen.getByText("미검증")).toBeInTheDocument();
    expect(screen.getByText(/일부 숫자가 결과와 맞지 않아 검증하지 못했습니다/)).toBeInTheDocument();
    const mark = document.querySelector("mark[data-mismatch]");
    expect(mark?.textContent).toBe("15");
  });

  it("AI 사용 불가: 제공자가 없으면(503 AI_PROVIDER_UNAVAILABLE) 안내하고 결과는 그대로", async () => {
    const aiApi = fakeAiApi({ streamCommentary: streamOf([], { ok: false, status: 503, code: "AI_PROVIDER_UNAVAILABLE", message: "" }) as never });
    show({ aiApi });
    await userEvent.click(await screen.findByRole("tab", { name: "AI 해설" }));
    await userEvent.click(screen.getByRole("button", { name: "AI 해설 만들기" }));
    expect(await screen.findByText("AI 사용 불가")).toBeInTheDocument();
    expect(screen.getByText(/결과의 수치와 차트는 그대로 볼 수 있습니다/)).toBeInTheDocument();
    expect(screen.getByText("이상 건수")).toBeInTheDocument();
  });

  it("한도 초과(429)는 경고 문구, 조직 AI가 꺼지면(409) 탭이 사라진다", async () => {
    const quota = fakeAiApi({ streamCommentary: streamOf([], { ok: false, status: 429, code: "AI_QUOTA_EXCEEDED", message: "" }) as never });
    const first = show({ aiApi: quota });
    await userEvent.click(await screen.findByRole("tab", { name: "AI 해설" }));
    await userEvent.click(screen.getByRole("button", { name: "AI 해설 만들기" }));
    expect(await screen.findByText("오늘 AI 사용 한도를 다 썼습니다.")).toBeInTheDocument();
    (await first.view).unmount();
    const off = fakeAiApi({ streamCommentary: streamOf([], { ok: false, status: 409, code: "AI_DISABLED", message: "" }) as never });
    show({ aiApi: off });
    await userEvent.click(await screen.findByRole("tab", { name: "AI 해설" }));
    await userEvent.click(screen.getByRole("button", { name: "AI 해설 만들기" }));
    await waitFor(() => expect(screen.queryByRole("tab", { name: "AI 해설" })).toBeNull());
  });

  it("TC-AIA-066 AT-AIA-01.4 조직 AI가 꺼져 있으면 [AI 해설] 버튼·탭이 없고 결과 화면 나머지는 정상", async () => {
    show({}, "DISABLED");
    expect(await screen.findByText("이상 건수")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "AI 해설" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "AI 해설" })).toBeNull();
    expect(screen.getByRole("tab", { name: "메타정보" })).toBeInTheDocument();
  });

  it("해설 권한이 없으면(VIEWER) 이력만 읽는다", async () => {
    show({ perms: { canRun: false, canPin: false, canFeedback: false, canAi: false } });
    await userEvent.click(await screen.findByRole("tab", { name: "AI 해설" }));
    expect(screen.getByText("아직 AI 해설이 없습니다.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "AI 해설 만들기" })).toBeNull();
  });
});
