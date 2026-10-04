/**
 * UI-SIM-11 원본 선택 재생(SIM-06.01·06.02): TC-SIM-069~071 — 기간(보관 30일·최대 31일)·소스·기기, 대상 건수, 시각 기준, 재생 시작.
 */
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { meOf, renderRoute } from "../../../../test/render";
import { localInput } from "../components/raw-replay";
import { ReplayView } from "../components/replay-view";
import { rawReplayBody } from "../model/replay";
import { fakeSimApi } from "./fake-sim-api";

const NOW = Date.parse("2026-10-04T00:00:00Z");
const base = { sourceId: "7", deviceIds: ["1042"], from: "2026-10-02T00:00:00Z", to: "2026-10-03T00:00:00Z", basis: "NOW" as const, acceleration: 60, cloneSpaceId: "41" };

describe("[SIM-06.01][SIM-06.02] 원본 재생 요청 본문", () => {
  it("TC-SIM-069 RAW 본문(UTC 시각, 기기 목록, 접미사), 지정 시각 기준", () => {
    expect(rawReplayBody({ ...base, cloneSuffix: " [재생]" }, NOW).body).toEqual({
      source: { type: "RAW", sourceId: "7", deviceIds: ["1042"], from: "2026-10-02T00:00:00.000Z", to: "2026-10-03T00:00:00.000Z" },
      timeShift: { basis: "NOW" },
      acceleration: 60,
      cloneSpaceId: "41",
      cloneSuffix: " [재생]",
    });
    expect(rawReplayBody({ ...base, basis: "AT", at: "2026-10-05T09:00:00Z" }, NOW).body?.timeShift).toEqual({ basis: "AT", at: "2026-10-05T09:00:00.000Z" });
  });

  it("TC-SIM-070 소스 필수, 시작 < 끝, 최대 31일, 원본 보관 30일 밖 거부, 가속 1~60, 공간 필수, 지정 시각 형식", () => {
    expect(rawReplayBody({ ...base, sourceId: "", cloneSpaceId: "", acceleration: 61 }, NOW).problems).toEqual({ sourceId: { key: "sourceRequired" }, cloneSpaceId: { key: "spaceRequired" }, acceleration: { key: "range", values: { min: 1, max: 60 } } });
    expect(rawReplayBody({ ...base, to: base.from }, NOW).problems.to).toEqual({ key: "rangeOrder" });
    expect(rawReplayBody({ ...base, from: "2026-09-03T00:00:00Z", to: "2026-10-06T00:00:00Z" }, NOW).problems).toMatchObject({ to: { key: "rangeTooLong" }, from: { key: "retention", values: { days: 30 } } });
    expect(rawReplayBody({ ...base, from: "x", to: "" }, NOW).problems).toEqual({ from: { key: "dateTime" }, to: { key: "dateTime" } });
    expect(rawReplayBody({ ...base, basis: "AT", at: "" }, NOW).problems.at).toEqual({ key: "dateTime" });
    expect(localInput(Date.UTC(2026, 0, 2, 3, 4))).toMatch(/^2026-01-0\dT\d{2}:04$/);
  });
});

describe("[SIM-06.01] UI-SIM-11 원본 선택", () => {
  const props = { spaces: [{ spaceId: "41", name: "데모 강의실" }], sources: [{ id: "7", name: "ChirpStack s3" }, { id: "8", name: "빈 소스" }], devices: [{ id: "1042", name: "AM107-067999", sourceId: "7" }, { id: "1043", name: "EM300", sourceId: "7" }], now: NOW, canRun: true };

  it("TC-SIM-071 소스의 실제 기기만 후보, 대상 건수 확인 → 재생 시작 → 실행 화면, 파일 탭으로 전환", async () => {
    const api = fakeSimApi();
    api.replay = vi.fn(async (_b: Record<string, unknown>, dry: boolean) => ({ ok: true as const, status: dry ? 200 : 201, data: dry ? { total: 2880 } : { runId: "77", total: 2880 } }));
    const navigate = vi.fn();
    await renderRoute(<ReplayView {...props} api={api} navigate={navigate} />, { session: meOf("OPERATOR") });
    expect(await screen.findByText("보관된 실제 원본 재생")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "원본 선택" })).toHaveAttribute("aria-selected", "true");
    await userEvent.click(screen.getByLabelText("AM107-067999"));
    expect(screen.getByText("기기(선택 1대)")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "대상 건수 확인" }));
    expect(await screen.findByText("대상 원본 2,880건")).toBeInTheDocument();
    const [body, dry] = (api.replay as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(dry).toBe(true);
    expect(body).toMatchObject({ source: { type: "RAW", sourceId: "7", deviceIds: ["1042"] }, acceleration: 60, cloneSpaceId: "41" });
    await userEvent.click(screen.getByRole("button", { name: "재생 시작" }));
    expect(navigate).toHaveBeenCalledWith("/sim/runs/77");
    await userEvent.selectOptions(screen.getByLabelText("소스"), "8");
    expect(screen.getByText("이 소스로 들어오는 실제 기기가 없습니다.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "파일 가져오기" }));
    expect(screen.getByLabelText("CSV 또는 JSON Lines 파일")).toBeInTheDocument();
  });

  it("검사 실패는 요청하지 않고 문구, core가 재생 경로를 아직 열지 않았으면(404) 안내, 다른 오류 문구", async () => {
    const api = fakeSimApi();
    api.replay = vi.fn(async () => ({ ok: false as const, status: 404, code: "RESOURCE_NOT_FOUND", message: "" }));
    const { unmount } = await renderRoute(<ReplayView {...props} sources={[]} api={api} navigate={vi.fn()} />, { session: meOf("OPERATOR") });
    await userEvent.click(await screen.findByRole("button", { name: "재생 시작" }));
    expect(screen.getByText("소스를 고르세요.")).toBeInTheDocument();
    expect(api.replay).not.toHaveBeenCalled();
    unmount();
    await renderRoute(<ReplayView {...props} api={api} navigate={vi.fn()} />, { session: meOf("OPERATOR") });
    await userEvent.click(await screen.findByRole("button", { name: "재생 시작" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("실제 데이터 재생은 아직 쓸 수 없습니다");
    api.replay = vi.fn(async () => ({ ok: false as const, status: 400, code: "ING_QUERY_RANGE_TOO_LARGE", message: "기간이 너무 깁니다" }));
    await userEvent.click(screen.getByRole("button", { name: "대상 건수 확인" }));
    expect(await screen.findByRole("alert")).not.toHaveTextContent("아직 쓸 수 없습니다");
  });
});
