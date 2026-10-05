/**
 * UI-ANA-03 분석 만들기 마법사(ANA-01.05·03.01~03.04·04.01·08.01) 인수 시험.
 */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Route, Routes, useLocation } from "react-router";
import { renderRoute } from "../../../../test/render";
import { Wizard } from "../components/wizard";
import { loadDraft } from "../model/wizard";
import { ANOMALY, CHECK_FAIL, CHECK_OK, CHECK_WARN, failed, fakeAnalyticsApi, ok } from "./fixtures";
import type { TemplateDetail } from "../model/types";

const NOW = Date.parse("2026-10-04T00:00:00Z");
const now = () => NOW;
/** 마법사가 결과·분석 화면으로 옮겨 가도 라우터 스텁이 받도록 모든 경로를 연다 */
const AT = { path: "/*", url: "/analytics/new?template=anomaly-detect" };

function Where() {
  const location = useLocation();
  return <output data-testid="where">{location.pathname + location.search}</output>;
}

function Harness(props: React.ComponentProps<typeof Wizard>) {
  return (
    <Routes>
      <Route path="*" element={<><Wizard {...props} /><Where /></>} />
    </Routes>
  );
}

beforeEach(() => {
  sessionStorage.clear();
});

async function toBindings(user = userEvent.setup()) {
  await user.click(await screen.findByRole("button", { name: "다음" }));
  return user;
}

async function connectTarget(user: ReturnType<typeof userEvent.setup>) {
  const panel = screen.getByText("target").closest("section") as HTMLElement;
  await user.click(within(panel).getByRole("button", { name: "+ 데이터" }));
  const dialog = await screen.findByRole("dialog");
  await user.click(await within(dialog).findByRole("button", { name: /실습실 EM300 · temperature/ }));
}

describe("ANA-03.01 UI-ANA-03 마법사 단계", () => {
  it("TC-ANA-025 AT-ANA-02.7 ② 역할 후보는 API-ANA-19(역할·종류)로 읽고, 세 가지 연결 탭을 바꿔 가며 고른다", async () => {
    const api = fakeAnalyticsApi();
    await renderRoute(<Harness template={ANOMALY} api={api} now={now} />, AT);
    const user = await toBindings();
    expect(screen.getByText("target")).toBeInTheDocument();
    await connectTarget(user);
    expect(api.candidates).toHaveBeenCalledWith("anomaly-detect", "target", { kind: "DEVICE_METRIC", keyword: undefined });
    expect(screen.getByRole("list", { name: "target에 연결한 데이터" })).toBeInTheDocument();
    expect(screen.getByLabelText("범례 이름")).toHaveValue("실습실 EM300 · temperature");
    // 공간 집계 탭: 집계 방법과 함께 연결
    const cov = screen.getByText("covariates").closest("section") as HTMLElement;
    await user.click(within(cov).getByRole("button", { name: "+ 데이터" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("tab", { name: "공간 집계" }));
    await waitFor(() => expect(api.candidates).toHaveBeenLastCalledWith("anomaly-detect", "covariates", { kind: "SPACE_AGGREGATE", keyword: undefined }));
    await user.selectOptions(within(dialog).getByLabelText("공간 집계 방법"), "max");
    await user.click(await within(dialog).findByRole("button", { name: /실습실 EM300/ }));
    expect(within(screen.getByRole("list", { name: "covariates에 연결한 데이터" })).getByText("최대")).toBeInTheDocument();
    await user.click(within(screen.getByRole("list", { name: "covariates에 연결한 데이터" })).getByRole("button", { name: "실습실 EM300 · temperature 빼기" }));
    expect(screen.queryByRole("list", { name: "covariates에 연결한 데이터" })).toBeNull();
  });

  it("TC-ANA-079 AT-ANA-02.5 단계를 오가도 연결·기간·파라미터가 남고, 새로고침해도 sessionStorage 초안으로 복구된다", async () => {
    const api = fakeAnalyticsApi();
    const view = await renderRoute(<Harness template={ANOMALY} api={api} now={now} />, AT);
    const user = await toBindings();
    // 역할 조건을 채우기 전에는 [다음]에서 막힌다
    await user.click(screen.getByRole("button", { name: "다음" }));
    expect(screen.getByText("target에 1~50개를 연결하세요")).toBeInTheDocument();
    await connectTarget(user);
    await user.click(screen.getByRole("button", { name: "다음" }));
    const days = screen.getByLabelText("일 수");
    await user.clear(days);
    await user.type(days, "30");
    await user.click(screen.getByRole("button", { name: "1. 템플릿" }));
    await user.click(screen.getByRole("button", { name: "다음" }));
    expect(screen.getByLabelText("범례 이름")).toHaveValue("실습실 EM300 · temperature");
    await user.click(screen.getByRole("button", { name: "다음" }));
    expect(screen.getByLabelText("일 수")).toHaveValue(30);
    expect(loadDraft("anomaly-detect")?.step).toBe("period");
    view.unmount();
    await renderRoute(<Harness template={ANOMALY} api={api} now={now} />, AT);
    expect(await screen.findByLabelText("일 수")).toHaveValue(30);
  });

  it("TC-ANA-080 ③ 최근 N일과 고정 기간: 범위 밖 N, 시작 ≥ 끝, 미래 끝은 막는다. 집계 단위 5가지", async () => {
    await renderRoute(<Harness template={{ ...ANOMALY, roles: [] }} api={fakeAnalyticsApi()} now={now} />, AT);
    const user = await toBindings();
    await user.click(screen.getByRole("button", { name: "다음" }));
    const days = screen.getByLabelText("일 수");
    await user.clear(days);
    await user.type(days, "400");
    expect(screen.getByText("1~365일 사이로 입력하세요")).toBeInTheDocument();
    await user.click(screen.getByLabelText("고정 기간"));
    await user.type(screen.getByLabelText("시작"), "2026-10-03T10:00");
    await user.type(screen.getByLabelText("끝"), "2026-10-02T10:00");
    expect(screen.getByText("끝 시각은 시작보다 뒤여야 합니다")).toBeInTheDocument();
    await user.clear(screen.getByLabelText("끝"));
    await user.type(screen.getByLabelText("끝"), "2026-12-01T10:00");
    expect(screen.getByText("끝 시각은 지금보다 앞이어야 합니다")).toBeInTheDocument();
    expect([...(screen.getByLabelText("집계 단위") as HTMLSelectElement).options].map((o) => o.textContent)).toEqual(["자동", "원본", "1분", "1시간", "1일"]);
    await user.click(screen.getByRole("button", { name: "다음" }));
    expect(screen.getByLabelText("끝")).toBeInTheDocument();
  });

  it("TC-ANA-084 AT-ANA-02.4 ④ 파라미터 폼은 JSON Schema로(정수→입력+슬라이더, enum→선택, boolean→스위치), 기본값 채움, 범위 밖이면 오류와 [다음] 비활성", async () => {
    await renderRoute(<Harness template={{ ...ANOMALY, roles: [] }} api={fakeAnalyticsApi()} now={now} />, AT);
    const user = await toBindings();
    await user.click(screen.getByRole("button", { name: "다음" }));
    await user.click(screen.getByRole("button", { name: "다음" }));
    const sensitivity = screen.getByLabelText("민감도");
    expect(sensitivity).toHaveValue(3);
    expect(screen.getByText("높을수록 많이 탐지하고 오탐도 늘어납니다")).toBeInTheDocument();
    expect(screen.getByLabelText("민감도 슬라이더")).toHaveAttribute("max", "5");
    expect(screen.getByLabelText("방식")).toHaveValue("zscore");
    expect(screen.getByLabelText("계절성 제거")).toBeChecked();
    await user.clear(sensitivity);
    await user.type(sensitivity, "9");
    expect(screen.getByText("1~5 사이 값을 입력하세요")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "다음" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "기본값으로" }));
    expect(screen.getByLabelText("민감도")).toHaveValue(3);
    expect(screen.getByRole("button", { name: "다음" })).toBeEnabled();
  });

  it("파라미터가 없는 템플릿은 안내만", async () => {
    await renderRoute(<Harness template={{ ...ANOMALY, roles: [], paramsSchema: undefined }} api={fakeAnalyticsApi()} now={now} />, AT);
    const user = await toBindings();
    await user.click(screen.getByRole("button", { name: "다음" }));
    await user.click(screen.getByRole("button", { name: "다음" }));
    expect(screen.getByText("이 템플릿은 파라미터가 없습니다.")).toBeInTheDocument();
  });
});

async function toConfirm(template: TemplateDetail, api = fakeAnalyticsApi()) {
  await renderRoute(<Harness template={template} api={api} now={now} />, AT);
  const user = await toBindings();
  if ((template.roles ?? []).length) await connectTarget(user);
  await user.click(screen.getByRole("button", { name: "다음" }));
  await user.click(screen.getByRole("button", { name: "다음" }));
  await user.click(screen.getByRole("button", { name: "다음" }));
  return user;
}

describe("ANA-03.03 ⑤ 충분성 확인·실행", () => {
  it("TC-ANA-089 AT-ANA-02.2 FAIL이면 [저장 후 실행] 비활성과 사유, 저장만은 된다", async () => {
    const api = fakeAnalyticsApi({ check: vi.fn(async () => ok(CHECK_FAIL)) });
    await toConfirm(ANOMALY, api);
    expect(await screen.findByText("부족")).toBeInTheDocument();
    expect(screen.getByText("포인트가 한도를 넘습니다")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "저장 후 실행" })).toBeDisabled();
    expect(api.check).toHaveBeenCalledWith("anomaly-detect", expect.objectContaining({ bindings: [{ role: "target", sources: [expect.objectContaining({ deviceId: "1042", metricKey: "temperature" })] }], period: { type: "RELATIVE", days: 14 }, resolution: "AUTO", qualityFilter: "NORMAL_ONLY", includeVirtual: false, params: { sensitivity: 3, method: "zscore", seasonal: true } }));
  });

  it("TC-ANA-089 AT-ANA-02.3 WARN이면 '경고를 확인했습니다' 체크 뒤에만 실행, 이름은 필수", async () => {
    const api = fakeAnalyticsApi({ check: vi.fn(async () => ok(CHECK_WARN)) });
    const user = await toConfirm(ANOMALY, api);
    expect(await screen.findByText("EM300-151547의 10/01~10/02 데이터가 없습니다")).toBeInTheDocument();
    expect(screen.getByText(/누락률 15%/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "저장 후 실행" })).toBeDisabled();
    await user.click(screen.getByLabelText("경고를 확인했습니다"));
    expect(screen.getByRole("button", { name: "저장 후 실행" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "저장 후 실행" }));
    expect(screen.getByText("이름을 입력하세요(100자 이내)")).toBeInTheDocument();
    expect(api.createAnalysis).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText("분석 이름"), "실습실 온도 이상 탐지");
    await user.click(screen.getByRole("button", { name: "저장 후 실행" }));
    await waitFor(() => expect(api.runAnalysis).toHaveBeenCalledWith("17", true));
    expect(screen.getByTestId("where").textContent).toBe("/analytics/17/runs/129");
    expect(loadDraft("anomaly-detect")).toBeNull();
  });

  it("TC-ANA-186 AT-ANA-15.1 한도 초과 → [1h로 바꾸기]로 집계 단위를 바꿔 다시 확인하면 실행이 열린다", async () => {
    const check = vi.fn().mockResolvedValueOnce(ok(CHECK_FAIL)).mockResolvedValueOnce(ok(CHECK_OK));
    const api = fakeAnalyticsApi({ check });
    const user = await toConfirm(ANOMALY, api);
    await user.click(await screen.findByRole("button", { name: "1h로 바꾸기" }));
    await waitFor(() => expect(check).toHaveBeenCalledTimes(2));
    expect(check.mock.calls[1][1]).toMatchObject({ resolution: "1h" });
    await user.type(screen.getByLabelText("분석 이름"), "x");
    expect(await screen.findByText("충분")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "저장 후 실행" })).toBeEnabled();
  });

  it("TC-ANA-091 정상 데이터만이 기본, 끄면 INCLUDE_ALL로 다시 확인. 가상 데이터는 기본 끔", async () => {
    const api = fakeAnalyticsApi();
    await renderRoute(<Harness template={{ ...ANOMALY, roles: [] }} api={api} now={now} />, AT);
    const user = await toBindings();
    await user.click(screen.getByRole("button", { name: "다음" }));
    expect(screen.getByLabelText("정상 데이터만")).toBeChecked();
    expect(screen.getByLabelText("가상 데이터 포함")).not.toBeChecked();
    await user.click(screen.getByLabelText("정상 데이터만"));
    await user.click(screen.getByRole("button", { name: "다음" }));
    await user.click(screen.getByRole("button", { name: "다음" }));
    await waitFor(() => expect(api.check).toHaveBeenCalledWith("anomaly-detect", expect.objectContaining({ qualityFilter: "INCLUDE_ALL" })));
  });

  it("ANA-04.01 일정 실행: 매주 프리셋과 cron(최소 1시간) 검증, [저장만]은 일정과 함께 저장하고 분석 화면으로", async () => {
    const api = fakeAnalyticsApi();
    const user = await toConfirm(ANOMALY, api);
    await screen.findByText("충분");
    await user.type(screen.getByLabelText("분석 이름"), "주간 이상 탐지");
    await user.click(screen.getByLabelText("일정"));
    await user.selectOptions(screen.getByRole("combobox", { name: "일정" }), "CRON");
    await user.type(screen.getByLabelText("cron(5필드)"), "*/30 * * * *");
    await user.click(screen.getByRole("button", { name: "저장만" }));
    expect(screen.getByText("일정 형식이 올바르지 않습니다")).toBeInTheDocument();
    await user.selectOptions(screen.getByRole("combobox", { name: "일정" }), "WEEKLY");
    await user.selectOptions(screen.getByLabelText("요일"), "1");
    await user.click(screen.getByRole("button", { name: "저장만" }));
    await waitFor(() => expect(api.createAnalysis).toHaveBeenCalledWith(expect.objectContaining({ name: "주간 이상 탐지", templateKey: "anomaly-detect", schedule: { preset: "WEEKLY", at: "06:00", weekday: 1 } })));
    expect(api.runAnalysis).not.toHaveBeenCalled();
    expect(screen.getByTestId("where").textContent).toBe("/analytics/17?saved=1");
  });

  it("저장은 됐지만 실행이 409이면 오류와 저장된 분석 링크", async () => {
    const api = fakeAnalyticsApi({ runAnalysis: vi.fn(async () => failed(409, "ANALYSIS_LIMIT_EXCEEDED")) });
    const user = await toConfirm(ANOMALY, api);
    await screen.findByText("충분");
    await user.type(screen.getByLabelText("분석 이름"), "x");
    await user.click(screen.getByRole("button", { name: "저장 후 실행" }));
    expect(await screen.findByText(/실행 한도를 넘었습니다/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "저장된 분석 열기" })).toHaveAttribute("href", "/analytics/17");
  });

  it("저장이 400이면 오류를 보이고 머문다, 충분성 확인 실패는 [다시 확인]", async () => {
    const api = fakeAnalyticsApi({ check: vi.fn(async () => failed(503, "ANALYTICS_UNAVAILABLE")), createAnalysis: vi.fn(async () => failed(400, "ANALYSIS_PARAMS_INVALID")) });
    const user = await toConfirm(ANOMALY, api);
    expect(await screen.findByText(/분석 서비스에 잠시 연결할 수 없습니다/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "다시 확인" })).toBeInTheDocument();
    await user.type(screen.getByLabelText("분석 이름"), "x");
    await user.click(screen.getByRole("button", { name: "저장만" }));
    expect(await screen.findByText("파라미터 값이 올바르지 않습니다.")).toBeInTheDocument();
  });
});
