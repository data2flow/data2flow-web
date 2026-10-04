/**
 * UI-ING-05 재처리 작업(ING-01.04, TC-ING-030)과 UI-ING-06 데이터 품질(ING-06.02, TC-ING-072) 화면 부품.
 */
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { meOf, renderRoute } from "../../../../test/render";
import type { QualityApi, ReprocessApi } from "../m5-api";
import type { QualityItem, ReprocessJob } from "../model/m5";
import { QualityView } from "../quality";
import { ReprocessView } from "../reprocess";

const chartFactory = vi.fn(async () => ({ setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn() }));
const ok = <T,>(data: T, status = 200) => ({ ok: true as const, status, data });
const fail = (code: string, status = 400) => ({ ok: false as const, status, code, message: "" });
const NOW = Date.parse("2026-10-04T00:00:00Z");

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const running: ReprocessJob = { jobId: "12", sourceId: "7", sourceName: "chirpstack-s3", deviceIds: [], from: "2026-09-26T00:00:00Z", to: "2026-10-03T00:00:00Z", status: "RUNNING", total: 102330, processed: 64401, failed: 0, progressPercent: 62.9, requestedByName: "김통합" };
const done: ReprocessJob = { ...running, jobId: "11", status: "COMPLETED", processed: 100, failed: 2, progressPercent: 100 };

function reprocessApi(overrides: Partial<ReprocessApi> = {}): ReprocessApi {
  return {
    preview: vi.fn(async () => ok({ total: 102330, byStatus: { OK: 102000, SCRIPT_ERROR: 330 }, estimatedSeconds: 361, decoder: { key: "chirpstack-v4", version: "1" }, scripts: [{ scope: "model:EM300-TH", scriptId: "501", name: "온도 보정 오프셋", version: 5 }] })),
    create: vi.fn(async () => ok({ jobId: "13", status: "PENDING", total: 102330 }, 202)),
    cancel: vi.fn(async () => ok({ jobId: "12", status: "CANCELLED", processed: 64401 })),
    list: vi.fn(async () => ok({ responses: [{ ...running, status: "COMPLETED", processed: 102330, progressPercent: 100 }, done] })),
    ...overrides,
  };
}

async function mountReprocess(api: ReprocessApi, props: Partial<Parameters<typeof ReprocessView>[0]> = {}, role = "INTEGRATOR") {
  await renderRoute(
    <ReprocessView
      sources={[{ id: "7", name: "chirpstack-s3" }, { id: "8", name: "esp-broker" }]}
      devices={[{ id: "11", name: "EM300-TH-1", sourceId: "7" }, { id: "12", name: "ESP-1", sourceId: "8" }]}
      jobs={[running, done]}
      prefill={{}}
      canWrite={role === "INTEGRATOR"}
      timezone="Asia/Seoul"
      nowMs={NOW}
      api={api}
      {...props}
    />,
    { session: meOf(role) },
  );
  await screen.findByText("작업 목록");
}

describe("ING-01.04 TC-ING-030 재처리 작업(UI-ING-05)", () => {
  it("AT-ING-08.2 진행률 바와 처리/실패, 미리 보기 전 [시작] 없음 → 미리 보기(대상·예상·디코더·스크립트) → 확인 대화상자 → 작업 생성(Idempotency-Key)", async () => {
    const api = reprocessApi();
    await mountReprocess(api);
    const row = screen.getByTestId("job-12");
    expect(within(row).getByLabelText("진행률")).toHaveAttribute("value", "62.9");
    expect(within(row).getByText("62.9%")).toBeInTheDocument();
    expect(within(row).getByText("실행 중")).toBeInTheDocument();
    expect(within(screen.getByTestId("job-11")).getByRole("link", { name: "실패 항목 보기" })).toHaveAttribute("href", "/ingest/failures");
    expect(screen.queryByRole("button", { name: "시작" })).toBeNull();
    expect(screen.getByLabelText("시작")).toHaveValue("2026-09-27T09:00");

    await userEvent.click(screen.getByRole("button", { name: "미리 보기" }));
    expect(screen.getByText("소스를 고르세요", { selector: "p" })).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("소스"), "7");
    expect(within(screen.getByLabelText("기기(선택)")).queryByText("ESP-1")).toBeNull();
    await userEvent.selectOptions(screen.getByLabelText("기기(선택)"), ["11"]);
    await userEvent.type(screen.getByLabelText("메모"), "보정 오프셋 v5 반영");
    await userEvent.click(screen.getByRole("button", { name: "미리 보기" }));
    const body = { sourceId: 7, deviceIds: [11], from: "2026-09-27T00:00:00Z", to: "2026-10-04T00:00:00Z", memo: "보정 오프셋 v5 반영" };
    expect(api.preview).toHaveBeenCalledWith(body);
    expect(await screen.findByText(/대상 102,330건/)).toHaveTextContent("예상 7분");
    expect(screen.getByText("디코더 chirpstack-v4 1")).toBeInTheDocument();
    expect(screen.getByText("스크립트 model:EM300-TH 온도 보정 오프셋 v5")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "시작" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("해당 기간의 측정값이 새 결과로 바뀝니다. 시작할까요?")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "시작" }));
    expect(api.create).toHaveBeenCalledWith(body, expect.any(String));
    expect(await screen.findByText("재처리 작업 RJ-13을 시작했습니다(대상 102,330건).")).toBeInTheDocument();
    expect(api.list).toHaveBeenCalled();
  });

  it("409 ING_REPROCESS_ALREADY_RUNNING 문구, 기간 31일 초과·순서 검증, 대상 0건이면 시작 불가", async () => {
    const api = reprocessApi({ create: vi.fn(async () => fail("ING_REPROCESS_ALREADY_RUNNING", 409)), preview: vi.fn().mockResolvedValueOnce(ok({ total: 0 })).mockResolvedValue(ok({ total: 5 })) });
    await mountReprocess(api, { prefill: { sourceId: "7", from: "2026-08-01T00:00:00Z", to: "2026-10-03T00:00:00Z" } });
    await userEvent.click(screen.getByRole("button", { name: "미리 보기" }));
    expect(screen.getByText("기간은 31일 이하입니다")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("시작"), { target: { value: "2026-10-03T10:00" } });
    fireEvent.change(screen.getByLabelText("끝"), { target: { value: "2026-10-03T09:00" } });
    await userEvent.click(screen.getByRole("button", { name: "미리 보기" }));
    expect(screen.getByText("끝이 시작보다 뒤여야 합니다")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("시작"), { target: { value: "2026-10-01T09:00" } });
    await userEvent.click(screen.getByRole("button", { name: "미리 보기" }));
    expect(await screen.findByText("대상 원본이 없어 시작할 수 없습니다")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "시작" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "미리 보기" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "시작" })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: "시작" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "시작" }));
    expect(await screen.findByText("이 소스에 실행 중인 재처리 작업이 있습니다")).toBeInTheDocument();
  });

  it("[취소] 확인 대화상자 → API-ING-12, 진행 중 작업이 있으면 5초마다 목록을 다시 읽고 끝나면 멈춘다", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const api = reprocessApi();
    await mountReprocess(api);
    await userEvent.click(within(screen.getByTestId("job-12")).getByRole("button", { name: "취소" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/RJ-12 작업을 취소할까요/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "작업 취소" }));
    expect(api.cancel).toHaveBeenCalledWith("12");
    expect(await screen.findByText("RJ-12 작업을 취소했습니다.")).toBeInTheDocument();
    const calls = vi.mocked(api.list).mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(vi.mocked(api.list).mock.calls.length).toBe(calls);
  });

  it("진행 중이면 5초 주기 새로 고침", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const api = reprocessApi({ list: vi.fn(async () => ok({ responses: [running] })) });
    await mountReprocess(api, {}, "INTEGRATOR");
    expect(screen.getByText("진행 중인 작업은 5초마다 새로 고칩니다.")).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(api.list).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(api.list).toHaveBeenCalledTimes(2);
  });

  it("미리 채움(스크립트 배포 뒤), 조회 전용은 폼·취소 없음, 작업 없음 안내, 미리 보기·취소 오류", async () => {
    const api = reprocessApi({ preview: vi.fn(async () => fail("ING_REPROCESS_OUT_OF_RETENTION")), cancel: vi.fn(async () => fail("ING_REPROCESS_NOT_CANCELLABLE", 409)) });
    await mountReprocess(api, { prefill: { sourceId: "7", deviceIds: ["11"], from: "2026-09-27T00:00:00Z", to: "2026-10-04T00:00:00Z", memo: "v5 배포 후" } });
    expect(screen.getByLabelText("소스")).toHaveValue("7");
    expect(screen.getByLabelText("메모")).toHaveValue("v5 배포 후");
    expect(screen.getByText("기기 1대")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "미리 보기" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    await userEvent.click(within(screen.getByTestId("job-12")).getByRole("button", { name: "취소" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "작업 취소" }));
    expect(await screen.findByText("이미 끝난 작업은 취소할 수 없습니다")).toBeInTheDocument();
  });

  it("조회 전용", async () => {
    await mountReprocess(reprocessApi(), { jobs: [] }, "OPERATOR");
    expect(screen.queryByRole("button", { name: "미리 보기" })).toBeNull();
    expect(screen.getByText("재처리 작업이 없습니다")).toBeInTheDocument();
  });
});

describe("ING-06.02 TC-ING-072 데이터 품질(UI-ING-06)", () => {
  const items: QualityItem[] = [
    { targetId: "2", targetName: "EM320-TH-389818", score: 88, completeness: 97, timeliness: 99, validity: 100, stability: 80, gaps: 0, clockSkewSuspect: false },
    { targetId: "1", targetName: "AM103-081175", score: 41, completeness: 55, timeliness: 98, validity: 100, stability: 60, gaps: 3, clockSkewSuspect: true },
  ];
  const api = (overrides: Partial<QualityApi> = {}): QualityApi => ({ trend: vi.fn(async () => ok({ points: [{ day: "2026-10-02", score: 41 }] })), ...overrides });

  it("AT-ING-09.4 점수 오름차순, 점수 41 클릭 → /devices/{id}?tab=chart&highlight=gap,range, 시계 오차 의심, 30일 추이·분포·최하위", async () => {
    const quality = api();
    await renderRoute(
      <QualityView
        items={items}
        summary={{ devices: 2, averageScore: 65, bottom10: [items[1]], distribution: { gaps: 30, outOfRange: 10, suspect: 0, late: 5, expected: 1000, received: 970 } }}
        group="device"
        day="2026-10-03"
        failed={false}
        timezone="Asia/Seoul"
        api={quality}
        chartFactory={chartFactory}
      />,
      { session: meOf("OPERATOR") },
    );
    const link = await screen.findByRole("link", { name: "AM103-081175 점수 41 — 문제 구간 차트 보기" });
    expect(link).toHaveAttribute("href", "/devices/1?tab=chart&highlight=gap,range");
    const rows = screen.getAllByRole("row");
    expect(rows[1]).toHaveTextContent("AM103-081175");
    expect(within(rows[1]).getByText("⏱ 의심")).toBeInTheDocument();
    expect(screen.getByText("대상 2개 · 평균 점수 65")).toBeInTheDocument();
    expect(screen.getByText("3% (30)")).toBeInTheDocument();
    await waitFor(() => expect(quality.trend).toHaveBeenCalledWith({ groupBy: "device", targetId: "1", from: "2026-09-04", to: "2026-10-03" }));
    await userEvent.click(within(rows[2]).getByRole("button", { name: "추이" }));
    await waitFor(() => expect(quality.trend).toHaveBeenLastCalledWith(expect.objectContaining({ targetId: "2" })));
    expect(screen.getByText("30일 점수 추이 · EM320-TH-389818")).toBeInTheDocument();
  });

  it("빈 상태·오류 상태 문구, 공간 묶음은 링크 없음, 추이 오류·없음", async () => {
    const { unmount } = await renderRoute(<QualityView items={[]} summary={null} group="device" day="2026-10-03" failed={false} timezone="UTC" api={api()} />, { session: meOf("OPERATOR") });
    expect(await screen.findByText("아직 계산된 품질 점수가 없습니다. 매일 00:30에 계산됩니다")).toBeInTheDocument();
    unmount();
    const second = await renderRoute(<QualityView items={[]} summary={null} group="device" day="2026-10-03" failed timezone="UTC" api={api()} />, { session: meOf("OPERATOR") });
    expect(await screen.findByText("품질 점수를 불러오지 못했습니다. 잠시 후 다시 시도하세요.")).toBeInTheDocument();
    second.unmount();
    const third = await renderRoute(<QualityView items={items} summary={null} group="space" day="2026-10-03" failed={false} timezone="UTC" api={api({ trend: vi.fn(async () => fail("ING_QUERY_RANGE_TOO_LARGE")) })} chartFactory={chartFactory} />, { session: meOf("ANALYST") });
    expect(await screen.findByText("AM103-081175")).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("분포 데이터가 없습니다")).toBeInTheDocument();
    expect(await screen.findByRole("status")).toBeInTheDocument();
    third.unmount();
    await renderRoute(<QualityView items={items} summary={null} group="model" day="2026-10-03" failed={false} timezone="UTC" api={api({ trend: vi.fn(async () => ok({ points: [] })) })} chartFactory={chartFactory} />, { session: meOf("ANALYST") });
    expect(await screen.findByText("추이 데이터가 없습니다")).toBeInTheDocument();
  });
});
