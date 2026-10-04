/**
 * UI-TSD-03 데이터 가져오기(TC-TSD-113, TSD-04.02), UI-TSD-04 데이터 보관 설정(TC-TSD-125, TSD-05.01), UI-OPS-01 저장 지표(OPS-01.03).
 */
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderRoute } from "../../../../test/render";
import type { ChartHandle } from "~/components/charts/timeseries-chart";
import { IMPORT_POLL_MS, ImportDetail } from "../components/import-detail";
import { ImportWizard } from "../components/import-wizard";
import { RetentionEditor } from "../components/retention-editor";
import { StoragePanel } from "../components/storage-panel";
import type { EffectivePolicy } from "../model/retention";
import { IMPORT, failed, fakeDataApi } from "./fake-data-api";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

let seq = 0;
async function show(element: React.ReactElement) {
  seq += 1;
  const id = `view-${seq}`;
  await renderRoute(<div data-testid={id}>{element}</div>);
  return within(await screen.findByTestId(id));
}

const CSV = "time,devEui,temperature,co2\n2026-09-01T00:00:00+09:00,24e124136d389818,22.1,520\n2026-09-01 01:00,24e124136d389818,22.0,515\n";

describe("TSD-04.02 UI-TSD-03 가져오기 마법사", () => {
  it("TC-TSD-113 CSV: 앞 20행 미리 보기, 시각 파싱 실패 줄 표시, 매핑 짐작 → 미리 실행(dryRun)으로 작업을 만든다", async () => {
    const api = fakeDataApi();
    const onCreated = vi.fn();
    const view = await show(<ImportWizard timezone="Asia/Seoul" api={api} onCreated={onCreated} readHead={async () => CSV} />);
    await userEvent.click(view.getByRole("button", { name: "미리 실행" }));
    expect(view.getByText("CSV 파일을 고르세요.")).toBeInTheDocument();
    expect(view.getByText("출처 라벨을 넣어 주세요(예: 아카데미 iot-bucket 2026-09).")).toBeInTheDocument();

    const file = new File([CSV], "iot.csv", { type: "text/csv" });
    await userEvent.upload(view.getByLabelText("CSV 파일(2GB 이하)"), file);
    expect(await view.findByText("앞 2행 미리 보기")).toBeInTheDocument();
    expect(view.getByText("시각을 읽을 수 없는 줄: 3")).toBeInTheDocument();
    expect(view.getByLabelText("시각 열")).toHaveValue("time");
    expect(view.getByLabelText("기기 열")).toHaveValue("devEui");
    await userEvent.clear(view.getByLabelText("co2 측정 항목 키"));
    await userEvent.type(view.getByLabelText("co2 측정 항목 키"), "co2_ppm");
    await userEvent.type(view.getByLabelText("출처 라벨"), "아카데미 CSV 2026-09");
    await userEvent.click(view.getByRole("button", { name: "미리 실행" }));
    expect(api.createCsvImport).toHaveBeenCalledWith(file, expect.objectContaining({ timeColumn: "time", deviceColumn: "devEui", deviceKey: "EXTERNAL_ID", metricColumns: [{ column: "temperature", metricKey: "temperature" }, { column: "co2", metricKey: "co2_ppm" }] }), "아카데미 CSV 2026-09", true);
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: "10" })));
  });

  it("CSV 긴 형식·사용자 형식 패턴·서버 오류(IMPORT_FILE_INVALID 필드)", async () => {
    const api = fakeDataApi({ createCsvImport: vi.fn(async () => ({ ok: false as const, status: 400, code: "IMPORT_FILE_INVALID", message: "", errors: [{ field: "mapping.timeFormat", code: "INVALID", message: "" }] })) });
    const view = await show(<ImportWizard timezone="Asia/Seoul" api={api} onCreated={() => {}} readHead={async () => "ts;device_name;metric;value\n1;a;t;2\n"} />);
    await userEvent.upload(view.getByLabelText("CSV 파일(2GB 이하)"), new File(["x"], "x.csv"));
    expect(await view.findByLabelText("측정 항목 열")).toHaveValue("metric");
    expect(view.getByLabelText("기기 식별 방식")).toHaveValue("NAME");
    await userEvent.selectOptions(view.getByLabelText("시각 형식"), "CUSTOM");
    await userEvent.type(view.getByLabelText("출처 라벨"), "x");
    await userEvent.click(view.getByRole("button", { name: "미리 실행" }));
    expect(view.getByText("시각 형식 패턴을 넣어 주세요.")).toBeInTheDocument();
    await userEvent.type(view.getByLabelText("형식 패턴"), "yyyy");
    await userEvent.selectOptions(view.getByLabelText("값 열"), "value");
    await userEvent.selectOptions(view.getByLabelText("열 형태"), "WIDE");
    await userEvent.selectOptions(view.getByLabelText("열 형태"), "LONG");
    await userEvent.click(view.getByRole("button", { name: "미리 실행" }));
    expect(await view.findByText("파일이나 매핑이 올바르지 않습니다.")).toBeInTheDocument();
    expect(view.getByText("mapping.timeFormat")).toBeInTheDocument();
  });

  it("TC-TSD-113 InfluxDB: URL은 http/https, 기간 순서, field 매핑 → 미리 실행(JSON)", async () => {
    const api = fakeDataApi();
    const onCreated = vi.fn();
    const view = await show(<ImportWizard timezone="Asia/Seoul" api={api} onCreated={onCreated} />);
    await userEvent.click(view.getByLabelText("InfluxDB"));
    await userEvent.type(view.getByLabelText("URL"), "ftp://10.116.64.13:8086");
    await userEvent.click(view.getByRole("button", { name: "미리 실행" }));
    expect(view.getByText("InfluxDB URL은 http:// 또는 https://로 시작해야 합니다.")).toBeInTheDocument();
    expect(view.getByText("시작이 끝보다 늦습니다")).toBeInTheDocument();
    await userEvent.clear(view.getByLabelText("URL"));
    await userEvent.type(view.getByLabelText("URL"), "http://10.116.64.13:8086");
    await userEvent.type(view.getByLabelText("org"), "iot-org");
    await userEvent.type(view.getByLabelText("bucket"), "iot-bucket");
    await userEvent.type(view.getByLabelText("토큰"), "secret");
    await userEvent.type(view.getByLabelText("measurement"), "environment");
    await userEvent.type(view.getByLabelText("시작"), "2026-09-01T00:00");
    await userEvent.type(view.getByLabelText("끝"), "2026-10-01T00:00");
    await userEvent.type(view.getByLabelText("field 1"), "co2");
    await userEvent.type(view.getByLabelText("측정 항목 키 1"), "co2");
    await userEvent.click(view.getByRole("button", { name: "+ field 추가" }));
    expect(view.getByLabelText("field 2")).toBeInTheDocument();
    await userEvent.type(view.getByLabelText("출처 라벨"), "아카데미 iot-bucket 2026-09");
    await userEvent.click(view.getByRole("button", { name: "미리 실행" }));
    expect(api.createInfluxImport).toHaveBeenCalledWith(expect.objectContaining({ url: "http://10.116.64.13:8086", from: "2026-08-31T15:00:00Z", to: "2026-09-30T15:00:00Z", fieldMapping: { co2: "co2" }, measurement: "environment", dryRun: true, originLabel: "아카데미 iot-bucket 2026-09" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
  });

  it("IMPORT_SOURCE_UNREACHABLE(502)은 문구로", async () => {
    const api = fakeDataApi({ createInfluxImport: vi.fn(async () => failed(502, "IMPORT_SOURCE_UNREACHABLE")) });
    const view = await show(<ImportWizard timezone="UTC" api={api} onCreated={() => {}} />);
    await userEvent.click(view.getByLabelText("InfluxDB"));
    for (const [label, value] of [["URL", "https://influx"], ["org", "o"], ["bucket", "b"], ["토큰", "t"], ["시작", "2026-09-01T00:00"], ["끝", "2026-09-02T00:00"], ["출처 라벨", "l"]]) await userEvent.type(view.getByLabelText(label), value);
    await userEvent.click(view.getByRole("button", { name: "미리 실행" }));
    expect(await view.findByText("InfluxDB에 연결할 수 없습니다.")).toBeInTheDocument();
  });
});

describe("TSD-04.02 UI-TSD-03 가져오기 작업", () => {
  it("AT-TSD-05.3 미리 실행 결과(예상 행·중복 예상·매핑 안 된 기기) → [가져오기 실행] → 3초마다 진행률, 완료", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const api = fakeDataApi({ getImport: vi.fn(async () => ({ ok: true as const, status: 200, data: { ...IMPORT, status: "SUCCEEDED" as const, dryRun: false, inserted: 1_272_298 } })) });
    const view = await show(<ImportDetail initial={IMPORT} errors={[{ lineOrPoint: "24e1…9818", errorCode: "DEVICE_NOT_MAPPED", message: "매핑 안 된 기기" }]} canImport timezone="Asia/Seoul" lang="ko" api={api} />);
    expect(view.getByText("미리 실행 완료")).toBeInTheDocument();
    expect(view.getByText("1,284,300")).toBeInTheDocument();
    expect(view.getByText("중복 예상")).toBeInTheDocument();
    expect(view.getByText("DEVICE_NOT_MAPPED")).toBeInTheDocument();
    expect(view.getByText("출처: 아카데미 iot-bucket 2026-09")).toBeInTheDocument();
    await userEvent.click(view.getByRole("button", { name: "가져오기 실행" }));
    expect(api.runImport).toHaveBeenCalledWith("9");
    expect(await view.findByText("가져오는 중")).toBeInTheDocument();
    expect(view.getByLabelText("진행률")).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(IMPORT_POLL_MS);
    });
    expect(await view.findByText("완료")).toBeInTheDocument();
    expect(view.getByText("1,272,298")).toBeInTheDocument();
    expect(view.queryByRole("button", { name: "가져오기 실행" })).toBeNull();
  });

  it("오류 목록 CSV 내려받기, 실행 실패 문구, 권한 없으면 [실행] 없음, 오류 없음 안내", async () => {
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:err"), revokeObjectURL: vi.fn() }));
    const download = vi.fn();
    const api = fakeDataApi({ runImport: vi.fn(async () => failed(409, "IMPORT_STATE_CONFLICT")) });
    const view = await show(<ImportDetail initial={{ ...IMPORT, error: "일부 실패" }} errors={[{ lineOrPoint: "3", errorCode: "TIME_PARSE" }]} canImport timezone="Asia/Seoul" lang="ko" api={api} download={download} />);
    expect(view.getByText("일부 실패")).toBeInTheDocument();
    await userEvent.click(view.getByRole("button", { name: "오류 목록 내려받기" }));
    expect(download).toHaveBeenCalledWith("blob:err", "import-9-errors.csv");
    await userEvent.click(view.getByRole("button", { name: "가져오기 실행" }));
    expect(await view.findByText("미리 실행이 끝난 작업만 실행할 수 있습니다.")).toBeInTheDocument();

    const other = await show(<ImportDetail initial={{ ...IMPORT, sample: [] }} errors={[]} canImport={false} timezone="Asia/Seoul" lang="ko" api={api} />);
    expect(other.queryByRole("button", { name: "가져오기 실행" })).toBeNull();
    expect(other.getByText("오류가 없습니다.")).toBeInTheDocument();
  });
});

const EFFECTIVE: EffectivePolicy[] = [
  { scope: "ORG", dataClass: "RAW_MESSAGE", retainDays: 30, archiveBeforeDelete: false, minDays: 7 },
  { scope: "ORG", dataClass: "TELEMETRY", retainDays: 365, compressAfterDays: 7, archiveBeforeDelete: false, minDays: 30 },
  { scope: "ORG", dataClass: "LINK", retainDays: 90, archiveBeforeDelete: false, minDays: 7 },
  { scope: "ORG", dataClass: "AGG_1M", retainDays: 90, archiveBeforeDelete: false, minDays: 30 },
  { scope: "ORG", dataClass: "AGG_1H", retainDays: 1095, archiveBeforeDelete: false, minDays: 365 },
  { scope: "ORG", dataClass: "AGG_1D", retainDays: 0, archiveBeforeDelete: false, minDays: 0 },
  { scope: "ORG", dataClass: "FLOW_EXECUTION", retainDays: 30, archiveBeforeDelete: false, minDays: 7 },
  { scope: "ORG", dataClass: "ANALYSIS_RESULT", retainDays: 365, archiveBeforeDelete: false, minDays: 30 },
  { scope: "ORG", dataClass: "AUDIT_LOG", retainDays: 365, archiveBeforeDelete: false, minDays: 365 },
  { scope: "ORG", dataClass: "NOTIFICATION_DELIVERY", retainDays: 90, archiveBeforeDelete: false, minDays: 30 },
  { scope: "ORG", dataClass: "COMMAND", retainDays: 365, archiveBeforeDelete: false, minDays: 90 },
  { scope: "ORG", dataClass: "DEVICE_STATE_HISTORY", retainDays: 365, archiveBeforeDelete: false, minDays: 90 },
  { scope: "ORG", dataClass: "WEBHOOK_DELIVERY", retainDays: 90, archiveBeforeDelete: false, minDays: 30 },
  { scope: "METRIC", scopeRef: "door", dataClass: "TELEMETRY", retainDays: 365, archiveBeforeDelete: false, storeMode: "ON_CHANGE" },
  { scope: "MODEL", scopeRef: "11", dataClass: "AGG_1H", retainDays: 2000, archiveBeforeDelete: false },
];
const STATS = { totalBytes: 190 * 1024 * 1024, partitions: [{ table: "telemetry", name: "telemetry_2026_10", state: "ACTIVE", rows: 1_200_000, bytes: 180 * 1024 * 1024, compressionRatio: 3.2 }, { table: "raw_messages", name: "raw_messages_2026_10", state: null, rows: null, bytes: 10 * 1024 * 1024, compressionRatio: null }] };
const ARCHIVES = [{ id: "1", dataClass: "TELEMETRY", rangeFrom: "2025-09-01T00:00:00Z", rangeTo: "2025-10-01T00:00:00Z", objectKey: "k", format: "PARQUET", rowsCount: 1000, bytes: 2048, createdAt: "2026-10-01T00:00:00Z" }];
const METRICS = [{ key: "LAeq", name: "소음" }, { key: "door", name: null }];
const MODELS = [{ id: "11", name: "EM300-TH" }];

describe("TSD-05.01 UI-TSD-04 데이터 보관 설정", () => {
  it("TC-TSD-125 AT: LAeq 원본 90일 재정의 추가 → 영향 미리 보기(삭제될 행·용량·항목별) → [확인하고 저장](confirmToken)", async () => {
    const api = fakeDataApi();
    const view = await show(<RetentionEditor effective={EFFECTIVE} stats={STATS} archives={ARCHIVES} canSave timezone="Asia/Seoul" lang="ko" metrics={METRICS} models={MODELS} api={api} />);
    expect(view.getByLabelText("측정값 원본 보관 일수")).toHaveValue("365");
    expect(view.getByText("0 = 무기한")).toBeInTheDocument();
    expect(view.getAllByText("30~3650일").length).toBeGreaterThan(0);
    expect(view.getByText("190.0 MB", { exact: false })).toBeInTheDocument();
    expect(view.getByText("3.2×")).toBeInTheDocument();
    expect(view.getByText("raw_messages_2026_10")).toBeInTheDocument();
    await userEvent.click(view.getByRole("button", { name: "+ 재정의 추가" }));
    await userEvent.selectOptions(view.getByLabelText("재정의 3 대상"), "LAeq");
    await userEvent.click(view.getByLabelText("재정의 3 삭제 전 장기 보관"));
    await userEvent.click(view.getByRole("button", { name: "영향 미리 보기 후 저장" }));
    const dialog = await screen.findByRole("dialog", { name: "보관 기간 단축 영향" });
    expect(within(dialog).getByText("저장하면 다음 야간 작업에서 약 1,200,000행, 180.0 MB이 삭제됩니다.")).toBeInTheDocument();
    expect(within(dialog).getByText("LAeq")).toBeInTheDocument();
    const [items] = vi.mocked(api.previewRetention).mock.calls[0];
    expect(items).toHaveLength(16);
    expect(items[15]).toEqual({ scope: "METRIC", scopeRef: "LAeq", dataClass: "TELEMETRY", retainDays: 90, archiveBeforeDelete: true });
    expect(items[13]).toMatchObject({ scopeRef: "door", storeMode: "ON_CHANGE" });
    await userEvent.click(within(dialog).getByRole("button", { name: "확인하고 저장" }));
    expect(api.saveRetention).toHaveBeenCalledWith(items, "1760000000.abc");
    expect(await view.findByText(/저장했습니다\. .* 야간 작업부터 적용됩니다\./)).toBeInTheDocument();
  });

  it("TC-TSD-125 입력 검증: 허용 범위 밖·중복 재정의는 저장하지 않는다", async () => {
    const api = fakeDataApi();
    const view = await show(<RetentionEditor effective={EFFECTIVE} stats={STATS} archives={[]} canSave timezone="Asia/Seoul" lang="ko" metrics={METRICS} models={MODELS} api={api} />);
    await userEvent.clear(view.getByLabelText("원본 메시지 보관 일수"));
    await userEvent.type(view.getByLabelText("원본 메시지 보관 일수"), "3");
    await userEvent.click(view.getByRole("button", { name: "+ 재정의 추가" }));
    await userEvent.selectOptions(view.getByLabelText("재정의 3 범위"), "MODEL");
    await userEvent.selectOptions(view.getByLabelText("재정의 3 대상"), "11");
    await userEvent.selectOptions(view.getByLabelText("재정의 3 데이터 종류"), "AGG_1H");
    await userEvent.clear(view.getByLabelText("재정의 3 보관 일수"));
    await userEvent.type(view.getByLabelText("재정의 3 보관 일수"), "400");
    await userEvent.click(view.getByRole("button", { name: "영향 미리 보기 후 저장" }));
    expect(view.getByText("보관 기간이 허용 범위를 벗어났습니다")).toBeInTheDocument();
    expect(view.getByText("같은 범위·대상·종류의 재정의가 이미 있습니다")).toBeInTheDocument();
    expect(api.previewRetention).not.toHaveBeenCalled();
    await userEvent.click(view.getByRole("button", { name: "재정의 3 삭제" }));
    await userEvent.click(view.getByRole("button", { name: "재정의 2 삭제" }));
    await userEvent.click(view.getByRole("button", { name: "재정의 1 삭제" }));
    expect(view.getByText("재정의가 없습니다. 모두 조직 기본을 따릅니다.")).toBeInTheDocument();
  });

  it("줄지 않으면 미리 보기 없이 바로 저장, 저장 실패(RETENTION_CONFIRM_REQUIRED)는 문구로, 저장 방식은 측정 항목·측정값 원본만", async () => {
    const api = fakeDataApi({
      previewRetention: vi.fn(async () => ({ ok: true as const, status: 200, data: { affectedRows: 0, affectedBytes: 0, byMetric: [], shortened: false } })),
      saveRetention: vi.fn(async () => failed(409, "RETENTION_CONFIRM_REQUIRED")),
    });
    const view = await show(<RetentionEditor effective={EFFECTIVE} stats={null} archives={[]} canSave timezone="Asia/Seoul" lang="ko" metrics={METRICS} models={MODELS} api={api} />);
    expect(view.getByText("불러오지 못했습니다. 잠시 뒤 다시 시도해 주세요.")).toBeInTheDocument();
    expect(view.getByText("장기 보관 파일이 없습니다.")).toBeInTheDocument();
    expect(view.getByLabelText("재정의 1 저장 방식")).toHaveValue("ON_CHANGE");
    await userEvent.selectOptions(view.getByLabelText("재정의 1 저장 방식"), "ALL");
    expect(view.queryByLabelText("재정의 2 저장 방식")).toBeNull();
    await userEvent.click(view.getByLabelText("측정값 원본 삭제 전 장기 보관"));
    await userEvent.click(view.getByRole("button", { name: "영향 미리 보기 후 저장" }));
    await waitFor(() => expect(api.saveRetention).toHaveBeenCalledWith(expect.any(Array), undefined));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(await view.findByText(/보관 기간을 줄이려면 영향 미리 보기를 확인해야 합니다/)).toBeInTheDocument();
  });

  it("미리 보기 실패·취소, 저장 성공 시 서버 값으로 다시 그림(적용 시각 없음)", async () => {
    const api = fakeDataApi({ previewRetention: vi.fn(async () => failed(400, "RETENTION_INVALID")) });
    const view = await show(<RetentionEditor effective={EFFECTIVE} stats={STATS} archives={[]} canSave timezone="Asia/Seoul" lang="ko" metrics={METRICS} models={MODELS} api={api} />);
    await userEvent.click(view.getByRole("button", { name: "영향 미리 보기 후 저장" }));
    expect(await view.findAllByText("보관 기간이 허용 범위를 벗어났습니다")).not.toHaveLength(0);

    const api2 = fakeDataApi({ saveRetention: vi.fn(async () => ({ ok: true as const, status: 200, data: { effective: EFFECTIVE.slice(0, 13), appliesAt: null } })) });
    const view2 = await show(<RetentionEditor effective={EFFECTIVE} stats={STATS} archives={[]} canSave timezone="Asia/Seoul" lang="ko" metrics={METRICS} models={MODELS} api={api2} />);
    await userEvent.click(view2.getByRole("button", { name: "영향 미리 보기 후 저장" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "취소" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    await userEvent.click(view2.getByRole("button", { name: "영향 미리 보기 후 저장" }));
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "확인하고 저장" }));
    expect(await view2.findByText("저장했습니다.")).toBeInTheDocument();
    expect(view2.getByText("재정의가 없습니다. 모두 조직 기본을 따릅니다.")).toBeInTheDocument();
  });

  it("권한별 노출: 저장 권한이 없으면(INTEGRATOR 보기) 입력·저장 버튼이 막힌다, 알 수 없는 대상도 이름으로 보인다", async () => {
    const view = await show(<RetentionEditor effective={[...EFFECTIVE, { scope: "METRIC", scopeRef: "pm25", dataClass: "AGG_1M", retainDays: 60, archiveBeforeDelete: false }]} stats={STATS} archives={[]} canSave={false} timezone="Asia/Seoul" lang="ko" metrics={METRICS} models={[]} api={fakeDataApi()} />);
    expect(view.getByLabelText("원본 메시지 보관 일수")).toBeDisabled();
    expect(view.queryByRole("button", { name: "영향 미리 보기 후 저장" })).toBeNull();
    expect(view.queryByRole("button", { name: "+ 재정의 추가" })).toBeNull();
    expect(view.getByRole("option", { name: "pm25" })).toBeInTheDocument();
    expect(view.getByRole("option", { name: "11" })).toBeInTheDocument();
    expect(view.getAllByRole("option", { name: "소음 (LAeq)" }).length).toBeGreaterThan(0);
  });
});

describe("OPS-01.03 UI-OPS-01 저장 지표", () => {
  const metrics = {
    dbSizeBytes: 41_015_000_000,
    tables: [{ schema: "data2flow_pipeline", table: "telemetry", bytes: 30e9, rows: 9e8 }],
    dailyGrowthBytes: [
      { day: "2026-10-02", bytes: 40e9, growthBytes: null },
      { day: "2026-10-03", bytes: 41e9, growthBytes: 966_367_642 },
    ],
    diskFreePercent: 19,
    diskCapacityBytes: 200 * 1024 ** 3,
    checkedAt: "2026-10-04T00:00:00Z",
  };
  const chart = () => {
    const options: Record<string, unknown>[] = [];
    const handle: ChartHandle = { setOption: (o) => options.push(o), resize: () => {}, dispose: () => {} };
    return { options, factory: async () => handle };
  };

  it("TC-OPS-013 DB 용량·하루 증가량·상위 테이블·추이 차트, 디스크 여유 19%는 경고색 + 아이콘·문자", async () => {
    const c = chart();
    const view = await show(<StoragePanel metrics={metrics} timezone="Asia/Seoul" lang="ko" chartFactory={c.factory} />);
    expect(view.getByText("38.2 GB")).toBeInTheDocument();
    expect(view.getByText("하루 평균 +921.6 MB")).toBeInTheDocument();
    expect(view.getByText("data2flow_pipeline.telemetry")).toBeInTheDocument();
    expect(view.getByRole("alert")).toHaveTextContent("⚠ 디스크 여유가 20% 미만입니다");
    expect(view.getByText("19%")).toBeInTheDocument();
    expect(view.getByText("디스크 용량 200.0 GB")).toBeInTheDocument();
    await waitFor(() => expect(c.options.length).toBeGreaterThan(0));
    expect(JSON.stringify(c.options.at(-1))).toContain("GB");
  });

  it("여유가 충분하면 경고 없음, 용량 설정이 없으면 안내, 지표를 못 받으면 경고", async () => {
    const view = await show(<StoragePanel metrics={{ ...metrics, diskFreePercent: 64, diskCapacityBytes: null, dailyGrowthBytes: [], checkedAt: null }} timezone="Asia/Seoul" lang="ko" chartFactory={chart().factory} />);
    expect(view.queryByRole("alert")).toBeNull();
    expect(view.getByText("64%")).toBeInTheDocument();
    const unknown = await show(<StoragePanel metrics={{ ...metrics, diskFreePercent: null }} timezone="Asia/Seoul" lang="ko" chartFactory={chart().factory} />);
    expect(unknown.getByText("디스크 용량 설정이 없어 여유 공간을 계산하지 않습니다.")).toBeInTheDocument();
    const none = await show(<StoragePanel metrics={null} timezone="Asia/Seoul" lang="ko" />);
    expect(none.getByText("저장 지표를 불러올 수 없습니다")).toBeInTheDocument();
  });
});
