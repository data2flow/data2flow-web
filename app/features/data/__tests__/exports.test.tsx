/**
 * UI-TSD-02 내보내기 대화상자·작업 목록(TC-TSD-075·107, TSD-04.01), UI-TSD-08 정기 내보내기·데이터 사전(TC-TSD-164, TSD-04.03·07.02·07.04).
 */
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type React from "react";
import { renderRoute } from "../../../../test/render";
import { DictionaryPanel, ExportJobsPanel, POLL_MS, SchedulesPanel } from "../components/exports-panels";
import { ExportDialog } from "../components/export-dialog";
import { ScheduleEditor } from "../components/schedule-editor";
import type { DataDictionary } from "../model/dictionary";
import type { TelemetryQuery } from "../model/exports";
import { JOB, SCHEDULE, failed, fakeDataApi } from "./fake-data-api";

const query: TelemetryQuery = {
  series: [
    { deviceId: "1042", metric: "temperature", label: "AM107 temperature" },
    { deviceId: "1042", metric: "co2", label: "AM107 co2" },
  ],
  from: "2026-10-03T00:00:00Z",
  to: "2026-10-04T00:00:00Z",
  resolution: "auto",
  tz: "Asia/Seoul",
};
const labels = [
  { id: "1042", label: "AM107 temperature", metric: "temperature", unit: "℃" },
  { id: "1042", label: "AM107 co2", metric: "co2", unit: "ppm" },
];

afterEach(() => {
  vi.useRealTimers();
});

let seq = 0;
/** 라우터 스텁이 그릴 때까지 기다리고, 그 화면 안에서만 찾는 도우미를 돌려준다 */
async function show(element: React.ReactElement) {
  seq += 1;
  const id = `view-${seq}`;
  await renderRoute(<div data-testid={id}>{element}</div>);
  return within(await screen.findByTestId(id));
}

describe("TSD-04.01 UI-TSD-02 내보내기 대화상자", () => {
  it("TC-TSD-107 조건 요약·형식·열 형태 미리 보기 3행·예상 행 수, 동기면 BFF 주소로 바로 내려받는다(AT-TSD-04.1)", async () => {
    const api = fakeDataApi({
      listExports: vi.fn(async () => ({ ok: true as const, status: 200, data: { responses: [] } })),
      createExport: vi.fn(async () => ({ ok: true as const, status: 200, data: { mode: "SYNC" as const, downloadUrl: "/api/v1/core/exports/9/file?expires=1&signature=ab", estimatedRows: 48 } })),
    });
    const download = vi.fn();
    const onClose = vi.fn();
    await show(<ExportDialog open onClose={onClose} query={query} labels={labels} resolutionUsed="1h" timezone="Asia/Seoul" api={api} download={download} />);
    const dialog = await screen.findByRole("dialog", { name: "내보내기" });
    expect(within(dialog).getByText(/시계열 2개/)).toBeInTheDocument();
    const preview = within(dialog).getByLabelText("예시 미리 보기");
    expect(preview.textContent?.split("\n")[0]).toBe("time,device_id,device_name,space_path,metric,value,unit,quality");
    expect(preview.textContent?.split("\n")).toHaveLength(4);
    expect(within(dialog).getByText("예상 48행 · 바로 내려받기")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByLabelText("넓은 형식"));
    expect(within(dialog).getByLabelText("예시 미리 보기").textContent?.split("\n")[0]).toBe("time,AM107 temperature,AM107 co2");
    await userEvent.click(within(dialog).getByLabelText("품질 코드 포함"));
    await userEvent.click(within(dialog).getByLabelText("Excel"));
    await userEvent.selectOptions(within(dialog).getByLabelText("시간대"), "UTC");
    await userEvent.click(within(dialog).getByRole("button", { name: "내보내기" }));
    expect(api.createExport).toHaveBeenCalledWith({ query: { ...query, tz: "UTC" }, format: "XLSX", columns: "WIDE", includeQuality: false, tz: "UTC" });
    expect(download).toHaveBeenCalledWith("/bff/api/core/exports/9/file?expires=1&signature=ab");
    expect(onClose).toHaveBeenCalled();
  });

  it("AT-TSD-04.2 비동기면 '완료되면 알려 드립니다'와 작업 목록 링크", async () => {
    const api = fakeDataApi({ listExports: vi.fn(async () => ({ ok: true as const, status: 200, data: { responses: [] } })) });
    await show(<ExportDialog open onClose={() => {}} query={{ ...query, from: "2025-10-04T00:00:00Z", resolution: "1m" }} labels={labels} timezone="Asia/Seoul" api={api} download={vi.fn()} />);
    expect(await screen.findByText(/예상 1,051,200행 · 작업으로 만들고/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "내보내기" }));
    expect(await screen.findByText("완료되면 알려 드립니다.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "작업 목록 보기" })).toHaveAttribute("href", "/exports");
  });

  it("TC-TSD-075 진행 중인 비동기 작업이 3개면 [내보내기]를 막는다", async () => {
    const api = fakeDataApi({ listExports: vi.fn(async () => ({ ok: true as const, status: 200, data: { responses: [JOB, { ...JOB, id: "2" }, { ...JOB, id: "3", status: "QUEUED" as const }] } })) });
    await renderRoute(<ExportDialog open onClose={() => {}} query={query} labels={labels} timezone="Asia/Seoul" api={api} />);
    expect(await screen.findByText("진행 중인 내보내기가 3개입니다. 끝난 뒤 다시 시도해 주세요.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "내보내기" })).toBeDisabled();

  });

  it("TC-TSD-103 서버 한도 오류(429 EXPORT_LIMIT_EXCEEDED)는 문구로", async () => {
    const limited = fakeDataApi({ listExports: vi.fn(async () => ({ ok: true as const, status: 200, data: { responses: [] } })), createExport: vi.fn(async () => failed(429, "EXPORT_LIMIT_EXCEEDED")) });
    await show(<ExportDialog open onClose={() => {}} query={query} labels={labels} timezone="Asia/Seoul" api={limited} />);
    await waitFor(() => expect(limited.listExports).toHaveBeenCalled());
    await userEvent.click(screen.getByRole("button", { name: "내보내기" }));
    expect(await screen.findByText("진행 중인 내보내기가 너무 많습니다. 끝난 뒤 다시 시도해 주세요.")).toBeInTheDocument();
  });

  it("TSD-04.03 [정기 내보내기로 저장]: 같은 조건으로 일정을 만든다(기간은 일정이 정함)", async () => {
    const api = fakeDataApi();
    await show(<ExportDialog open onClose={() => {}} query={query} labels={labels} timezone="Asia/Seoul" api={api} />);
    await userEvent.click(await screen.findByRole("button", { name: "정기 내보내기로 저장" }));
    await userEvent.type(screen.getByLabelText("이름"), "일별 실내환경");
    await userEvent.type(screen.getByLabelText("수신자"), "ops@java21.net");
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(api.createSchedule).toHaveBeenCalledWith(expect.objectContaining({ name: "일별 실내환경", cron: "0 7 * * *", relativePeriod: "PREVIOUS_DAY", recipients: ["ops@java21.net"], query: { series: query.series, resolution: "auto", tz: "Asia/Seoul" } }));
    expect(await screen.findByText("정기 내보내기를 저장했습니다.")).toBeInTheDocument();
  });

  it("닫혀 있으면 그리지 않는다", async () => {
    const api = fakeDataApi();
    await show(<ExportDialog open={false} onClose={() => {}} query={query} labels={labels} timezone="Asia/Seoul" api={api} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(api.listExports).not.toHaveBeenCalled();
  });
});

describe("TSD-04.03 정기 내보내기 설정", () => {
  it("TC-TSD-075 입력 검증: 반복 규칙 필수, 수신자 메일 형식", async () => {
    const api = fakeDataApi();
    await show(<ScheduleEditor query={query} api={api} onSaved={() => {}} onCancel={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(screen.getByText("이름을 넣어 주세요(100자 이하).")).toBeInTheDocument();
    expect(screen.getByText("수신자를 한 명 이상 넣어 주세요.")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("이름"), "주간");
    await userEvent.selectOptions(screen.getByLabelText("주기"), "");
    await userEvent.type(screen.getByLabelText("수신자"), "ops@, x");
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(screen.getByText("반복 규칙을 정해 주세요.")).toBeInTheDocument();
    expect(screen.getByText("메일 주소 형식이 올바르지 않습니다.")).toBeInTheDocument();
    expect(api.createSchedule).not.toHaveBeenCalled();
  });

  it("TC-TSD-164 S3·SFTP 대상 [연결 테스트] 단계 결과, 매주·매월 반복, 조회 조건 없음 안내", async () => {
    const api = fakeDataApi();
    const onSaved = vi.fn();
    await show(<ScheduleEditor query={query} api={api} onSaved={onSaved} onCancel={() => {}} />);
    await userEvent.type(screen.getByLabelText("이름"), "주간 실내환경");
    await userEvent.selectOptions(screen.getByLabelText("주기"), "WEEKLY");
    await userEvent.selectOptions(screen.getByLabelText("요일"), "1");
    await userEvent.selectOptions(screen.getByLabelText("전달"), "STORAGE");
    await userEvent.selectOptions(screen.getByLabelText("대상 종류"), "SFTP");
    await userEvent.type(screen.getByLabelText("호스트 *"), "sftp.example");
    await userEvent.type(screen.getByLabelText("사용자 이름 *"), "bi");
    await userEvent.type(screen.getByLabelText("비밀번호"), "pw");
    await userEvent.click(screen.getByRole("button", { name: "연결 테스트" }));
    const steps = await screen.findByRole("list", { name: "연결 테스트 결과" });
    expect(within(steps).getByText("✔ 연결")).toBeInTheDocument();
    expect(within(steps).getByText("✖ 테스트 파일 쓰기 — AccessDenied")).toBeInTheDocument();
    expect(api.testTarget).toHaveBeenCalledWith({ targetType: "SFTP", target: { host: "sftp.example", username: "bi" }, credential: { password: "pw" } });
    await userEvent.selectOptions(screen.getByLabelText("형식"), "PARQUET");
    await userEvent.selectOptions(screen.getByLabelText("기간"), "PREVIOUS_WEEK");
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(api.createSchedule).toHaveBeenCalledWith(expect.objectContaining({ cron: "0 7 * * 1", format: "PARQUET", relativePeriod: "PREVIOUS_WEEK", delivery: "STORAGE", targetType: "SFTP" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());

    const broken = fakeDataApi({ testTarget: vi.fn(async () => failed(502, "EXPORT_TARGET_UNWRITABLE")) });
    await show(<ScheduleEditor query={null} api={broken} onSaved={() => {}} onCancel={() => {}} />);
    const editors = screen.getAllByRole("region", { name: "정기 내보내기 설정" });
    const second = editors[editors.length - 1];
    await userEvent.selectOptions(within(second).getByLabelText("주기"), "MONTHLY");
    await userEvent.clear(within(second).getByLabelText("날짜(1~28)"));
    await userEvent.type(within(second).getByLabelText("날짜(1~28)"), "40");
    await userEvent.selectOptions(within(second).getByLabelText("전달"), "STORAGE");
    await userEvent.click(within(second).getByRole("button", { name: "연결 테스트" }));
    expect(await within(second).findByText("전달 대상에 파일을 쓸 수 없습니다.")).toBeInTheDocument();
    await userEvent.click(within(second).getByRole("button", { name: "저장" }));
    expect(within(second).getByText("조회 조건이 없습니다. 데이터 탐색에서 조건을 정한 뒤 저장하세요.")).toBeInTheDocument();
    expect(within(second).getByText("대상의 필수 항목(*)을 넣어 주세요.")).toBeInTheDocument();
  });

  it("고치기는 PATCH + baseVersion, 저장된 자격은 다시 받지 않고, 실패는 문구로", async () => {
    const api = fakeDataApi({ updateSchedule: vi.fn(async () => failed(409, "VERSION_CONFLICT")) });
    await show(<ScheduleEditor schedule={{ ...SCHEDULE, delivery: "STORAGE", targetType: "S3", target: { endpoint: "https://s3", bucket: "bi" }, credentialConfigured: true }} api={api} onSaved={() => {}} onCancel={() => {}} />);
    expect(screen.getAllByText("저장된 자격 증명이 있습니다. 바꿀 때만 입력하세요.")).toHaveLength(2);
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(api.updateSchedule).toHaveBeenCalledWith("5", expect.objectContaining({ baseVersion: 3, targetType: "S3", target: { endpoint: "https://s3", bucket: "bi" } }));
    expect((vi.mocked(api.updateSchedule).mock.calls[0][1] as Record<string, unknown>).credential).toBeUndefined();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});

describe("TSD-04.01 UI-TSD-02 작업 목록", () => {
  it("TC-TSD-107 진행 중이면 5초마다 다시 읽고, 완료되면 [다운로드](BFF 주소)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const done = { ...JOB, status: "SUCCEEDED" as const, rows: 3_000_000, bytes: 150 * 1024 * 1024, downloadUrl: "/api/v1/core/exports/71/file?expires=9&signature=cd", expiresAt: "2026-10-11T00:00:00Z" };
    const api = fakeDataApi({ listExports: vi.fn(async () => ({ ok: true as const, status: 200, data: { responses: [done] } })) });
    const download = vi.fn();
    await show(<ExportJobsPanel initial={[JOB]} timezone="Asia/Seoul" lang="ko" api={api} download={download} />);
    expect(screen.getByText("진행 중")).toBeInTheDocument();
    expect(screen.getByText("3,000,000")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "다운로드" })).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS);
    });
    expect(api.listExports).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("완료")).toBeInTheDocument();
    expect(screen.getByText("150.0 MB")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "다운로드" }));
    expect(download).toHaveBeenCalledWith("/bff/api/core/exports/71/file?expires=9&signature=cd");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS * 3);
    });
    expect(api.listExports).toHaveBeenCalledTimes(1);
  });

  it("TC-TSD-107 TSD-04.03 메일 링크 화면(only): 그 작업 하나만 다시 읽고 목록은 읽지 않는다", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const done = { ...JOB, status: "SUCCEEDED" as const, downloadUrl: "/api/v1/core/exports/71/file?expires=9&signature=cd" };
    const api = fakeDataApi({ getExport: vi.fn(async () => ({ ok: true as const, status: 200, data: done })) });
    await show(<ExportJobsPanel initial={[JOB]} only={JOB.id} timezone="Asia/Seoul" lang="ko" api={api} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS);
    });
    expect(api.getExport).toHaveBeenCalledWith(JOB.id);
    expect(api.listExports).not.toHaveBeenCalled();
    expect(await screen.findByRole("button", { name: "다운로드" })).toBeInTheDocument();
  });

  it("[취소] → 취소됨, 실패는 문구, 빈 목록·불러오기 실패 안내, 정기 표시", async () => {
    const api = fakeDataApi();
    await show(<ExportJobsPanel initial={[{ ...JOB, scheduleId: "5" }, { ...JOB, id: "70", status: "FAILED", error: "디스크 부족" }]} timezone="Asia/Seoul" lang="ko" api={api} />);
    expect(screen.getByText("(정기)")).toBeInTheDocument();
    expect(screen.getByText("디스크 부족")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "취소" }));
    expect(await screen.findByText("취소됨")).toBeInTheDocument();
    expect(api.cancelExport).toHaveBeenCalledWith("71");

    const bad = fakeDataApi({ cancelExport: vi.fn(async () => failed(409, "EXPORT_STATE_CONFLICT")) });
    await show(<ExportJobsPanel initial={[JOB]} timezone="Asia/Seoul" lang="ko" api={bad} />);
    const cancels = screen.getAllByRole("button", { name: "취소" });
    await userEvent.click(cancels[cancels.length - 1]);
    expect(await screen.findByText("지금 상태에서는 할 수 없는 작업입니다.")).toBeInTheDocument();

    await show(<ExportJobsPanel initial={[]} timezone="Asia/Seoul" lang="ko" api={api} />);
    expect(screen.getByText("내보내기 작업이 없습니다")).toBeInTheDocument();
    await show(<ExportJobsPanel initial={[]} failed timezone="Asia/Seoul" lang="ko" api={api} />);
    expect(screen.getByText("불러오지 못했습니다. 잠시 뒤 다시 시도해 주세요.")).toBeInTheDocument();
  });
});

describe("TSD-07.02 UI-TSD-08 정기 내보내기 목록", () => {
  it("TC-TSD-164 마지막 실행 실패는 빨간 배지와 사유, [끄기]·[편집]·[삭제]", async () => {
    const api = fakeDataApi();
    await show(<SchedulesPanel initial={[SCHEDULE, { ...SCHEDULE, id: "6", name: "주간", cron: "0 2 * * 1", lastStatus: "SUCCEEDED", lastFileVersion: 2, lastError: null, delivery: "STORAGE", targetType: "S3" }, { ...SCHEDULE, id: "7", name: "월간", cron: "0 1 3 * *", lastStatus: null, enabled: false }]} timezone="Asia/Seoul" lang="ko" api={api} />);
    expect(screen.getByText("✖ 실패")).toBeInTheDocument();
    expect(screen.getByText("인증 실패")).toBeInTheDocument();
    expect(screen.getByText("✔ 완료 v2")).toBeInTheDocument();
    expect(screen.getByText("매일 07:00")).toBeInTheDocument();
    expect(screen.getByText("매주 월요일 02:00")).toBeInTheDocument();
    expect(screen.getByText("매월 3일 01:00")).toBeInTheDocument();
    expect(screen.getByText("S3")).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole("button", { name: "끄기" })[0]);
    expect(api.updateSchedule).toHaveBeenCalledWith("5", { enabled: false, baseVersion: 3 });
    await userEvent.click(screen.getByRole("button", { name: "월간 삭제" }));
    await waitFor(() => expect(screen.queryByText("월간")).toBeNull());
    await userEvent.click(screen.getAllByRole("button", { name: "편집" })[0]);
    const editor = screen.getByRole("region", { name: "정기 내보내기 설정" });
    await userEvent.clear(within(editor).getByLabelText("이름"));
    await userEvent.type(within(editor).getByLabelText("이름"), "일별 v2");
    await userEvent.click(within(editor).getByRole("button", { name: "저장" }));
    expect(await screen.findByText("일별 v2")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "정기 내보내기 설정" })).toBeNull();
  });

  it("빈 목록·실패 응답", async () => {
    const api = fakeDataApi({ updateSchedule: vi.fn(async () => failed(409, "VERSION_CONFLICT")), deleteSchedule: vi.fn(async () => failed(404, "RESOURCE_NOT_FOUND")) });
    await show(<SchedulesPanel initial={[{ ...SCHEDULE, cron: "*/5 * * * *" }]} timezone="Asia/Seoul" lang="ko" api={api} />);
    expect(screen.getByText("*/5 * * * *")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "끄기" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: `${SCHEDULE.name} 삭제` }));
    expect(screen.getByText(SCHEDULE.name)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "편집" }));
    await userEvent.click(screen.getByRole("button", { name: "취소" }));
    await show(<SchedulesPanel initial={[]} failed timezone="Asia/Seoul" lang="ko" api={api} />);
    expect(screen.getByText("불러오지 못했습니다. 잠시 뒤 다시 시도해 주세요.")).toBeInTheDocument();
    await show(<SchedulesPanel initial={[]} timezone="Asia/Seoul" lang="ko" api={api} />);
    expect(screen.getByText("정기 내보내기가 없습니다")).toBeInTheDocument();
  });
});

describe("TSD-07.04 UI-TSD-08 데이터 사전", () => {
  const dictionary: DataDictionary = {
    version: 4,
    generatedAt: "2026-10-03T00:00:00Z",
    tables: [],
    metrics: [
      { key: "temperature", displayName: "온도", unit: "℃", aggDefault: "avg", validMin: -40, validMax: 85 },
      { key: "co2", displayName: null, unit: null, aggDefault: null },
    ],
    qualityCodes: [
      { code: 0, meaning: "정상", includedInAggregates: true },
      { code: 2, meaning: "미검증", includedInAggregates: false },
    ],
    spaces: [
      { id: "1", parentId: null, type: "SITE", name: "광주캠퍼스" },
      { id: "31", parentId: "1", type: "ROOM", name: "실습실" },
    ],
  };

  it("TC-TSD-164 AT-TSD-19.1 판 번호·측정 항목(키·이름·단위·집계)·품질 코드·공간 계층, [HTML]·[JSON] 내려받기", async () => {
    const download = vi.fn();
    const createObjectURL = vi.fn(() => "blob:dict");
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
    await show(<DictionaryPanel dictionary={dictionary} timezone="Asia/Seoul" lang="ko" download={download} />);
    expect(screen.getByText("데이터 사전 v4")).toBeInTheDocument();
    const metrics = screen.getByRole("table", { name: "측정 항목" });
    expect(within(metrics).getByText("temperature")).toBeInTheDocument();
    expect(within(metrics).getByText("-40 ~ 85")).toBeInTheDocument();
    expect(screen.getByText("미검증")).toBeInTheDocument();
    expect(screen.getByText("실습실").closest("li")).toHaveStyle({ paddingLeft: "16px" });
    await userEvent.click(screen.getByRole("button", { name: "HTML 내려받기" }));
    expect(download).toHaveBeenCalledWith("/bff/api/core/data-dictionary?format=html&version=4", "data-dictionary-v4.html");
    await userEvent.click(screen.getByRole("button", { name: "JSON 내려받기" }));
    expect(download).toHaveBeenLastCalledWith("blob:dict", "data-dictionary-v4.json");
    vi.unstubAllGlobals();
  });

  it("사전이 없으면 안내, 불러오기 실패는 경고", async () => {
    await show(<DictionaryPanel dictionary={null} timezone="Asia/Seoul" lang="ko" />);
    expect(screen.getByText("데이터 사전이 없습니다")).toBeInTheDocument();
    await show(<DictionaryPanel dictionary={null} failed timezone="Asia/Seoul" lang="ko" />);
    expect(screen.getByText("불러오지 못했습니다. 잠시 뒤 다시 시도해 주세요.")).toBeInTheDocument();
  });
});
