/**
 * ANA-01.03 UI-ANA-07 분석 템플릿 설정(끌 때 확인, 보관 기간 30~1095일)과 ANA-10.01 UI-ANA-09 데이터셋(분석에서 만들기, 최신 버전으로 올리기, 쓰는 중 지우기 거절).
 */
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderRoute } from "../../../../test/render";
import type { AnalyticsAdminApi, Dataset } from "../admin-api";
import { DatasetDetail, DatasetList } from "../components/datasets";
import { TemplateSettings } from "../components/template-settings";

const ok = <T,>(data: T) => Promise.resolve({ ok: true as const, status: 200, data });
const err = (code: string, status = 400) => Promise.resolve({ ok: false as const, status, code, message: "" });

function fakeApi(over: Partial<AnalyticsAdminApi> = {}): AnalyticsAdminApi {
  return {
    setTemplateEnabled: vi.fn((key: string, enabled: boolean) => ok({ key, name: key, version: "1", enabled, analysisCount: 0, scheduleCount: 0, realtimeCount: 0, pausedAnalysisIds: enabled ? [] : ["17", "18"] })),
    saveSettings: vi.fn((days: number) => ok({ resultRetentionDays: days })),
    createDataset: vi.fn((body) => ok({ ...body, datasetId: "77", version: 1 } as Dataset)),
    renameDataset: vi.fn((d: Dataset, name: string) => ok({ ...d, name, version: d.version + 1 })),
    deleteDataset: vi.fn(() => err("DATASET_IN_USE", 409)) as AnalyticsAdminApi["deleteDataset"],
    upgradeAnalysis: vi.fn((datasetId: string, analysisId: string) => ok({ analysisId, datasetId, datasetVersion: 3 })),
    ...over,
  };
}

const TEMPLATES = [
  { key: "anomaly-detect", name: "이상 탐지", version: "1.2.0", enabled: true, analysisCount: 3, scheduleCount: 2, realtimeCount: 1 },
  { key: "comfort-index", name: "쾌적도 분석", version: "1.0.0", enabled: true, analysisCount: 0, scheduleCount: 0, realtimeCount: 0 },
];

describe("UI-ANA-07 TemplateSettings", () => {
  it("일정·실시간이 있는 템플릿을 끌 때는 중지 건수를 확인받고, 없으면 바로 끈다", async () => {
    const user = userEvent.setup();
    const api = fakeApi();
    await renderRoute(<TemplateSettings initial={TEMPLATES} retentionDays={365} api={api} />);
    await user.click(await screen.findByRole("switch", { name: "이상 탐지 템플릿 활성" }));
    expect(screen.getByText("일정 2건, 실시간 1건이 중지됩니다. 다시 켜도 자동으로 재개되지 않습니다.")).toBeInTheDocument();
    expect(api.setTemplateEnabled).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "끄기" }));
    expect(await screen.findByText("이상 탐지 템플릿을 껐습니다. 분석 2건의 일정·실시간을 멈췄습니다.")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "이상 탐지 템플릿 활성" })).not.toBeChecked();

    await user.click(screen.getByRole("switch", { name: "쾌적도 분석 템플릿 활성" }));
    await waitFor(() => expect(api.setTemplateEnabled).toHaveBeenLastCalledWith("comfort-index", false));
  });

  it("결과 보관 기간은 30~1095일만 저장한다", async () => {
    const user = userEvent.setup();
    const api = fakeApi();
    await renderRoute(<TemplateSettings initial={TEMPLATES} retentionDays={365} api={api} />);
    const field = await screen.findByLabelText("결과 보관 기간(일)");
    await user.clear(field);
    await user.type(field, "20");
    await user.click(screen.getByRole("button", { name: "저장" }));
    expect(await screen.findByText("30~1095 사이 정수를 넣으세요.")).toBeInTheDocument();
    expect(api.saveSettings).not.toHaveBeenCalled();
    await user.clear(field);
    await user.type(field, "730");
    await user.click(screen.getByRole("button", { name: "저장" }));
    expect(await screen.findByText("결과 보관 기간을 저장했습니다.")).toBeInTheDocument();
    expect(api.saveSettings).toHaveBeenCalledWith(730);
  });
});

const DATASET: Dataset = {
  datasetId: "61",
  name: "실습실 온도",
  bindings: [{ role: "target", sources: [{ kind: "DEVICE_METRIC", deviceId: "1042", metricKey: "temperature", label: "AM107 · 온도" }] }],
  period: { type: "RELATIVE", days: 14 },
  qualityFilter: "NORMAL_ONLY",
  includeVirtual: false,
  version: 3,
};

describe("UI-ANA-09 DatasetList·DatasetDetail", () => {
  it("새 데이터셋은 고른 분석의 바인딩·기간·품질 필터를 그대로 저장한다", async () => {
    const user = userEvent.setup();
    const api = fakeApi();
    const loadAnalysis = vi.fn(() => ok({ analysisId: "17", name: "실습실 온도 이상 탐지", templateKey: "anomaly-detect", bindings: DATASET.bindings, period: { type: "RELATIVE" as const, days: 14 }, qualityFilter: "INCLUDE_ALL" as const, includeVirtual: true }));
    await renderRoute(<DatasetList initial={[]} analyses={[{ id: "17", name: "실습실 온도 이상 탐지" }]} canEdit timezone="Asia/Seoul" lang="ko" api={api} loadAnalysis={loadAnalysis} />);
    expect(await screen.findByText("데이터셋이 없습니다")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "+ 데이터셋" }));
    await user.click(screen.getByRole("button", { name: "저장" }));
    expect(await screen.findByText("이름은 1~100자로 쓰세요.")).toBeInTheDocument();
    await user.type(screen.getByLabelText("이름"), "실습실 묶음");
    await user.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(api.createDataset).toHaveBeenCalledWith({ name: "실습실 묶음", bindings: DATASET.bindings, period: { type: "RELATIVE", days: 14 }, qualityFilter: "INCLUDE_ALL", includeVirtual: true }));
    expect(loadAnalysis).toHaveBeenCalledWith("17");
  });

  it("예전 버전을 쓰는 분석은 [최신 버전으로 올리기], 쓰는 중이면 지우기를 막는다", async () => {
    const user = userEvent.setup();
    const api = fakeApi();
    await renderRoute(
      <DatasetDetail dataset={DATASET} versions={[{ version: 3, bindingCount: 1, updatedAt: "2026-10-04T00:00:00Z" }]} usage={[{ analysisId: "17", name: "실습실 온도 이상 탐지", datasetVersion: 2 }]} canEdit timezone="Asia/Seoul" lang="ko" api={api} />,
    );
    expect(await screen.findByText("AM107 · 온도")).toBeInTheDocument();
    expect(screen.getByText("최근 14일")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "삭제" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "실습실 온도 이상 탐지 분석을 최신 버전으로 올리기" }));
    expect(await screen.findByText("실습실 온도 이상 탐지 분석이 이제 v3을 씁니다.")).toBeInTheDocument();
    expect(screen.queryByText("새 버전 있음")).not.toBeInTheDocument();
    expect(api.upgradeAnalysis).toHaveBeenCalledWith("61", "17");
  });

  it("이름을 바꾸면 버전이 오르고 이력에 더한다(BR-ANA-21)", async () => {
    const user = userEvent.setup();
    const api = fakeApi();
    await renderRoute(<DatasetDetail dataset={DATASET} versions={[{ version: 3, bindingCount: 1 }]} usage={[]} canEdit timezone="Asia/Seoul" lang="ko" api={api} />);
    const name = await screen.findByLabelText("이름");
    await user.clear(name);
    await user.type(name, "실습실 온도 v2");
    await user.click(screen.getByRole("button", { name: "이름 바꾸기" }));
    expect(await screen.findByText("저장했습니다. 이제 v4입니다.")).toBeInTheDocument();
    expect(screen.getByText("v4", { selector: "td" })).toBeInTheDocument();
  });
});
