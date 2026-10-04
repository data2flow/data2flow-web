/**
 * 기기·모델 데이터 관리 화면 부품: UI-DEV-19 검색식 입력(DEV-13.03), UI-DEV-20 표준 형식 내보내기(DEV-13.04, 2초 폴링),
 * UI-DEV-08 모델 가져오기·내보내기(DEV-03.04), UI-DEV-10 게이트웨이 차트(DEV-05.02), 표시 단위(DEV-04.04).
 */
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { renderRoute as baseRender } from "../../../../test/render";
import { LatestValueCards } from "~/features/devices/components";
import { TemperatureUnitProvider } from "~/lib/units";
import type { DevModelApi } from "../api";
import { DeviceQueryBar } from "../components/device-query-bar";
import { GatewayCharts } from "../components/gateway-charts";
import { IMPORT_MAX_BYTES, ModelExportButtons, ModelImportDialog } from "../components/model-exchange";
import { JOB_POLL_MS, StandardExportDialog } from "../components/standard-export-dialog";
import { UnitSettingsCard } from "../components/unit-settings";

/** 라우터 로더가 끝나 부품이 그려질 때까지 기다린다 */
async function renderRoute(element: ReactElement) {
  const result = await baseRender(<div data-testid="ready">{element}</div>);
  await screen.findByTestId("ready");
  return result;
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => vi.useRealTimers());

const ok = <T,>(data: T, status = 200) => ({ ok: true as const, status, data });
const fail = (status: number, code: string) => ({ ok: false as const, status, code, message: "" });

function fakeApi(overrides: Partial<DevModelApi> = {}): DevModelApi {
  return {
    savedSearches: vi.fn(async () => ok({ responses: [] })),
    saveSearch: vi.fn(async (body: { name: string; query: string; shared: boolean }) => ok({ id: "601", ownerId: "7", ...body })),
    deleteSearch: vi.fn(async () => ok(undefined, 204)),
    exportModel: vi.fn(async () => ok({ "@context": "dtmi:dtdl:context;3" })),
    importModel: vi.fn(async (input: { dryRun: boolean }) =>
      input.dryRun
        ? ok({ dryRun: true, format: "dtdl", model: null, createdMetrics: ["vibration"], unmapped: [{ path: "contents[2]", type: "Command", reason: "명령" }], scripts: [{ name: "decoder", kind: "DECODE" }] })
        : ok({ dryRun: false, format: "dtdl", model: { id: "99", code: "DTDL-THERMO", name: "T" }, createdMetrics: [], unmapped: [], scripts: [] }, 201),
    ),
    exportStandard: vi.fn(async () => ok({ jobId: "77", status: "RUNNING" }, 202)),
    exportJob: vi.fn(async () => ok({ id: "77", format: "NGSI_LD", status: "RUNNING" })),
    ngsiPushes: vi.fn(async () => ok({ responses: [] })),
    createNgsiPush: vi.fn(async (body: { outputConnectionId: string; intervalSec: number }) => ok({ id: "5", ...body, scope: { spaceIds: [], deviceIds: [] }, enabled: true })),
    deleteNgsiPush: vi.fn(async () => ok(undefined, 204)),
    outputConnections: vi.fn(async () => ok({ responses: [{ id: "81", name: "FIWARE Orion" }] })),
    ...overrides,
  } as DevModelApi;
}

describe("DEV-13.03 UI-DEV-19 검색식 입력", () => {
  it("TC-DEV-317 AT-DEV-25.2: 입력 중 문법 오류를 열과 함께 밑줄로 보이고 [검색]을 막는다, 고치면 검색", async () => {
    const onSearch = vi.fn();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await renderRoute(<DeviceQueryBar initial="" saved={[]} canSave api={fakeApi()} onSearch={onSearch} />);
    const input = screen.getByRole("textbox", { name: "기기 검색식" });
    await user.type(input, "battery < ");
    expect(screen.getByRole("alert")).toHaveTextContent("11열: 값이 필요합니다");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("button", { name: "검색" })).toBeDisabled();
    await user.type(input, "20");
    expect(screen.queryByRole("alert")).toBeNull();
    await user.click(screen.getByRole("button", { name: "검색" }));
    expect(onSearch).toHaveBeenCalledWith("battery < 20");
  });

  it("TC-DEV-317: 서버 오류(열 11)는 같은 검색식일 때 그대로 보이고, 결과 수·소요 시간 표시", async () => {
    await renderRoute(<DeviceQueryBar initial="name ~ slow" problem={{ code: "DEVICE_QUERY_TIMEOUT", column: 1 }} saved={[]} canSave={false} api={fakeApi()} onSearch={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent("1열: 검색이 5초 안에 끝나지 않았습니다");
    expect(screen.queryByRole("button", { name: "검색 저장" })).toBeNull();
  });

  it("UI-DEV-19: 자동완성 후보를 누르면 검색식에 들어간다, 결과 수 표시", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await renderRoute(<DeviceQueryBar initial="" counts={{ total: 12, tookMs: 84 }} saved={[]} canSave={false} api={fakeApi()} onSearch={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent("12대 · 84ms");
    const input = screen.getByRole("textbox", { name: "기기 검색식" });
    await user.type(input, "bat");
    await user.click(screen.getByRole("button", { name: "battery" }));
    expect(input).toHaveValue("battery ");
    await user.click(screen.getByRole("button", { name: "<=" }));
    expect(input).toHaveValue("battery <= ");
    fireEvent.blur(input);
    await act(async () => vi.advanceTimersByTime(200));
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("TC-DEV-314 AT-DEV-25.3: 저장된 검색 고르기 → 그 검색식으로 검색, [검색 저장](이름·공유) → POST, 본인 것 삭제", async () => {
    const onSearch = vi.fn();
    const api = fakeApi();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const saved = [{ id: "501", name: "배터리 부족", query: "battery < 20", shared: true, ownerId: "7" }];
    await renderRoute(<DeviceQueryBar initial="battery < 20" saved={saved} savedId="501" canSave meId="7" api={api} onSearch={onSearch} />);
    await user.selectOptions(screen.getByLabelText("저장된 검색"), "501");
    expect(onSearch).toHaveBeenCalledWith("battery < 20", "501");

    await user.click(screen.getByRole("button", { name: "검색 저장" }));
    const dialog = screen.getByRole("dialog");
    const name = screen.getByLabelText("이름");
    await user.clear(name);
    await user.click(screen.getByRole("button", { name: "저장" }));
    expect(dialog).toHaveTextContent("이름은 1~100자로");
    await user.type(name, "배터리 20 미만");
    await user.click(screen.getByLabelText("조직 사용자와 공유"));
    await user.click(screen.getByRole("button", { name: "저장" }));
    expect(api.saveSearch).toHaveBeenCalledWith({ name: "배터리 20 미만", query: "battery < 20", shared: false }, "501");
    expect(await screen.findByText(/저장했습니다/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "저장된 검색 삭제" }));
    expect(api.deleteSearch).toHaveBeenCalledWith("501");
  });

  it("TC-DEV-314: 저장 실패·삭제 실패는 오류 문구로", async () => {
    const api = fakeApi({ saveSearch: vi.fn(async () => fail(400, "DEVICE_QUERY_INVALID")), deleteSearch: vi.fn(async () => fail(403, "PERMISSION_DENIED")) });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await renderRoute(<DeviceQueryBar initial="tag = a" saved={[{ id: "9", name: "a", query: "tag = b", shared: false, ownerId: "7" }]} savedId="9" canSave meId="7" api={api} onSearch={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "검색 저장" }));
    await user.type(screen.getByLabelText("이름"), "새 이름");
    await user.click(screen.getByRole("button", { name: "저장" }));
    expect(await screen.findByText("검색식이 올바르지 않습니다.")).toBeInTheDocument();
    expect(api.saveSearch).toHaveBeenCalledWith({ name: "새 이름", query: "tag = a", shared: false }, undefined);
    await user.click(screen.getByRole("button", { name: "닫기" }));
    await user.click(screen.getByRole("button", { name: "저장된 검색 삭제" }));
    expect(await screen.findByText("이 작업을 할 권한이 없습니다.")).toBeInTheDocument();
  });
});

describe("DEV-13.04 UI-DEV-20 표준 형식 내보내기", () => {
  it("TC-DEV-322: 작업이 끝날 때까지 2초마다 조회 → 보고서(제외 목록)·파일 받기, NGSI-LD 주기 전송 설정", async () => {
    let polls = 0;
    const api = fakeApi({
      exportJob: vi.fn(async () => {
        polls += 1;
        return polls < 3
          ? ok({ id: "77", format: "NGSI_LD", status: "RUNNING" })
          : ok({ id: "77", format: "NGSI_LD", status: "DONE", downloadUrl: "/api/v1/core/export-jobs/77/file", report: { exported: 1, skipped: [{ deviceId: "1050", type: "Device", reason: "태그 없는 점" }] } });
      }),
    });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await renderRoute(<StandardExportDialog open onClose={vi.fn()} scope={{ spaceIds: [], deviceIds: ["1042", "1050"] }} scopeLabel="선택한 기기 2대" api={api} />);
    expect(screen.getByText("선택한 기기 2대")).toBeInTheDocument();
    await user.click(screen.getByLabelText("NGSI-LD"));
    await user.click(screen.getByLabelText("주기 전송(출력 연결)"));
    expect(screen.getByRole("button", { name: "내보내기" })).toBeDisabled();
    await user.selectOptions(await screen.findByLabelText("출력 연결"), "81");
    await user.selectOptions(screen.getByLabelText("주기"), "900");
    await user.click(screen.getByRole("button", { name: "내보내기" }));
    expect(api.exportStandard).toHaveBeenCalledWith({ format: "NGSI_LD", scope: { spaceIds: [], deviceIds: ["1042", "1050"] }, includeValues: true });
    expect(screen.getByText("내보내는 중…")).toBeInTheDocument();
    expect(await screen.findByText(/15분마다/)).toBeInTheDocument();
    expect(api.createNgsiPush).toHaveBeenCalledWith({ outputConnectionId: "81", scope: { spaceIds: [], deviceIds: ["1042", "1050"] }, intervalSec: 900 });
    await act(async () => vi.advanceTimersByTime(JOB_POLL_MS));
    expect(polls).toBe(2);
    await act(async () => vi.advanceTimersByTime(JOB_POLL_MS));
    expect(await screen.findByText("내보내기 완료: 1건, 제외 1건")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "파일 받기" })).toHaveAttribute("href", "/bff/api/core/export-jobs/77/file");
    expect(screen.getByText("태그 없는 점")).toBeInTheDocument();
  });

  it("TC-DEV-319: EXPORT_INVALID_REQUEST·FAILED 작업·빈 범위·출력 연결 없음", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const api = fakeApi({ exportStandard: vi.fn(async () => fail(400, "EXPORT_INVALID_REQUEST")), outputConnections: vi.fn(async () => ok({ responses: [] })) });
    const view = await renderRoute(<StandardExportDialog open onClose={vi.fn()} scope={{ spaceIds: ["3"], deviceIds: [] }} scopeLabel="3층" api={api} />);
    await user.click(screen.getByRole("button", { name: "내보내기" }));
    expect(await screen.findByText("내보낼 수 있는 항목이 없습니다.")).toBeInTheDocument();
    await user.click(screen.getByLabelText("NGSI-LD"));
    await user.click(screen.getByLabelText("주기 전송(출력 연결)"));
    expect(await screen.findByText(/출력 연결이 없습니다/)).toBeInTheDocument();
    view.unmount();

    const failedApi = fakeApi({ exportStandard: vi.fn(async () => ok({ jobId: "78", status: "FAILED" }, 202)), exportJob: vi.fn(async () => ok({ id: "78", format: "DTDL", status: "FAILED", report: { exported: 0, skipped: [] } })) });
    const second = await renderRoute(<StandardExportDialog open onClose={vi.fn()} scope={{ spaceIds: ["3"], deviceIds: [] }} scopeLabel="3층" api={failedApi} />);
    await user.click(screen.getByRole("button", { name: "내보내기" }));
    expect(await screen.findByText(/내보낼 수 있는 항목이 없어 실패/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "파일 받기" })).toBeNull();
    second.unmount();

    await renderRoute(<StandardExportDialog open onClose={vi.fn()} scope={{ spaceIds: [], deviceIds: [] }} scopeLabel="-" api={fakeApi()} />);
    expect(screen.getByText("내보낼 기기나 공간을 먼저 고르세요.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "내보내기" })).toBeDisabled();
  });

  it("TC-DEV-319: 작업 조회가 실패하면 폴링을 멈추고 오류", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const exportJob = vi.fn().mockResolvedValueOnce(fail(503, "SERVICE_UNAVAILABLE")).mockResolvedValueOnce(fail(404, "RESOURCE_NOT_FOUND"));
    await renderRoute(<StandardExportDialog open onClose={vi.fn()} scope={{ spaceIds: [], deviceIds: ["1"] }} scopeLabel="1" api={fakeApi({ exportJob })} />);
    await user.click(screen.getByRole("button", { name: "내보내기" }));
    await act(async () => vi.advanceTimersByTime(JOB_POLL_MS));
    await waitFor(() => expect(exportJob).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/찾을 수 없|없습니다/)).toBeInTheDocument();
    await act(async () => vi.advanceTimersByTime(JOB_POLL_MS * 3));
    expect(exportJob).toHaveBeenCalledTimes(2);
  });
});

describe("DEV-03.04 UI-DEV-08 모델 가져오기·내보내기", () => {
  it("TC-DEV-112: [내보내기(DTDL)] → JSON 파일 저장, 실패는 문구", async () => {
    const download = vi.fn();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const api = fakeApi();
    await renderRoute(<ModelExportButtons modelId="11" code="EM300-TH" api={api} download={download} />);
    await user.click(screen.getByRole("button", { name: "내보내기(DTDL)" }));
    expect(api.exportModel).toHaveBeenCalledWith("11", "dtdl");
    expect(download).toHaveBeenCalledWith("EM300-TH.dtdl.json", expect.stringContaining("dtmi:dtdl:context;3"), "application/json");
    await user.click(screen.getByRole("button", { name: "내보내기(data2flow)" }));
    expect(api.exportModel).toHaveBeenLastCalledWith("11", "data2flow");

    const failing = fakeApi({ exportModel: vi.fn(async () => fail(404, "RESOURCE_NOT_FOUND")) });
    await renderRoute(<ModelExportButtons modelId="11" code="EM300-TH" api={failing} download={download} />);
    await user.click(screen.getAllByRole("button", { name: "내보내기(DTDL)" }).at(-1) as HTMLElement);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("TC-DEV-112 TC-DEV-109: 파일 → [미리 보기](만들 측정 항목·매핑 못한 DTDL 요소) → [가져오기] → 새 모델로", async () => {
    const onImported = vi.fn();
    const api = fakeApi();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await renderRoute(<ModelImportDialog open onClose={vi.fn()} api={api} onImported={onImported} />);
    expect(screen.getByRole("button", { name: "가져오기" })).toBeDisabled();
    const file = new File(['{"@id":"dtmi:x;1"}'], "thermo.json", { type: "application/json" });
    await user.upload(screen.getByLabelText("파일(JSON, 1MB까지)"), file);
    await user.selectOptions(screen.getByLabelText("형식"), "dtdl");
    await user.click(screen.getByLabelText("없는 측정 항목은 미검증으로 만들기"));
    await user.click(screen.getByRole("button", { name: "미리 보기" }));
    expect(api.importModel).toHaveBeenCalledWith({ file, format: "dtdl", createMissingMetrics: false, dryRun: true });
    expect(await screen.findByText(/새로 만들 측정 항목 1개/)).toBeInTheDocument();
    expect(screen.getByText("contents[2]")).toBeInTheDocument();
    expect(screen.getByText(/decoder \(DECODE\)/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "가져오기" }));
    expect(onImported).toHaveBeenCalledWith("DTDL-THERMO");
  });

  it("TC-DEV-109: 1MB 초과·코드 중복(409)·매핑 모두 성공", async () => {
    const api = fakeApi({
      importModel: vi.fn().mockResolvedValueOnce(ok({ dryRun: true, format: "data2flow", model: null, createdMetrics: [], unmapped: [], scripts: [] })).mockResolvedValueOnce(fail(409, "MODEL_CODE_DUPLICATE")),
    });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await renderRoute(<ModelImportDialog open onClose={vi.fn()} api={api} onImported={vi.fn()} />);
    const input = screen.getByLabelText("파일(JSON, 1MB까지)");
    const big = new File(["x"], "big.json");
    Object.defineProperty(big, "size", { value: IMPORT_MAX_BYTES + 1 });
    await user.upload(input, big);
    await user.click(screen.getByRole("button", { name: "미리 보기" }));
    expect(await screen.findByText("파일이 1MB를 넘습니다.")).toBeInTheDocument();
    await user.upload(input, new File(["{}"], "m.json"));
    await user.click(screen.getByRole("button", { name: "미리 보기" }));
    expect(await screen.findByText("모든 요소를 매핑했습니다.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "가져오기" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});

describe("DEV-05.02 UI-DEV-10 게이트웨이 차트", () => {
  it("TC-DEV-155: 업링크 막대·rssi 분포를 그리고 [데이터 표로 보기]로 같은 값을 표로", async () => {
    const setOption = vi.fn();
    const factory = vi.fn(async () => ({ setOption, resize: vi.fn(), dispose: vi.fn() }));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await renderRoute(
      <GatewayCharts
        stats={{ gatewayId: "71", from: "", to: "", deviceCount: 2, uplinksByHour: [{ t: "2026-10-03T23:00:00Z", count: 61 }], devices: [], rssiHistogram: [{ fromDbm: -100, toDbm: -90, count: 1 }] }}
        timezone="Asia/Seoul"
        lang="ko"
        factory={factory}
      />,
    );
    await waitFor(() => expect(setOption).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("img", { name: "RSSI 분포" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /표로 보기/ }));
    expect(screen.getByText("-100~-90")).toBeInTheDocument();
    expect(screen.getByText("61")).toBeInTheDocument();
  });
});

describe("DEV-04.04 표시 단위", () => {
  it("TC-DEV-145: ℉ 설정이면 현재값 카드가 ℉로, ADMIN 아니면 단위 폼 없음", async () => {
    await renderRoute(
      <TemperatureUnitProvider unit="F">
        <LatestValueCards latest={[{ metricKey: "temperature", unit: "℃", value: 22, measuredAt: null, quality: 0 }]} lang="ko" />
        <UnitSettingsCard settings={{ temperatureUnit: "F", version: 2 }} canEdit={false} />
      </TemperatureUnitProvider>,
    );
    expect(screen.getByText("71.6℉")).toBeInTheDocument();
    expect(screen.getByText(/조직 기본 온도 단위: 화씨/)).toBeInTheDocument();
    expect(screen.getByText(/22℃ → 71.6℉/)).toBeInTheDocument();
  });

  it("TC-DEV-145: ADMIN은 조직 단위를 고를 수 있다", async () => {
    await renderRoute(<UnitSettingsCard settings={{ temperatureUnit: "C", version: 2 }} canEdit />);
    expect(screen.getByLabelText("조직 기본 온도 단위")).toHaveValue("C");
    expect(screen.getByRole("button", { name: "저장" })).toBeInTheDocument();
  });
});
