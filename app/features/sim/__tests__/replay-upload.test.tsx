/**
 * TC-SIM-075 UI-SIM-11 업로드 → 열 매핑 → 미리 보기 → 재생, 오류 행 표시(SIM-06.03, AT-SIM-12.3).
 */
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { meOf, renderRoute } from "../../../../test/render";
import { ReplayView } from "../components/replay-view";
import type { ReplayFile } from "../model/types";
import { failure, fakeSimApi } from "./fake-sim-api";

const SPACES = [{ spaceId: "41", name: "데모 강의실" }];
const FILE: ReplayFile = {
  fileId: "f-1",
  rows: 10_000,
  columns: ["timestamp", "deviceId", "temperature", "Humidity"],
  preview: Array.from({ length: 25 }, (_, i) => ({ timestamp: `2026-10-02T00:${String(i).padStart(2, "0")}:00Z`, deviceId: "AM107-067999", temperature: 22 + i / 10, Humidity: 44 })),
};

describe("TC-SIM-075 AT-SIM-12.3 실제 데이터 재생 — 파일 가져오기", () => {
  it("업로드 전: 100MB 넘는 파일·지원하지 않는 확장자는 바로 막는다", async () => {
    await renderRoute(<ReplayView spaces={SPACES} canRun api={fakeSimApi()} navigate={vi.fn()} />, { session: meOf("OPERATOR") });
    const input = (await screen.findByLabelText("CSV 또는 JSON Lines 파일")) as HTMLInputElement;
    const big = new File(["x"], "classroom.csv", { type: "text/csv" });
    Object.defineProperty(big, "size", { value: 101 * 1024 * 1024 });
    fireEvent.change(input, { target: { files: [big] } });
    expect(screen.getByRole("alert")).toHaveTextContent("파일은 100MB 이하여야 합니다.");
    expect(screen.getByRole("button", { name: "올리기" })).toBeDisabled();
    fireEvent.change(input, { target: { files: [new File(["x"], "data.xlsx")] } });
    expect(screen.getByRole("alert")).toHaveTextContent("CSV 또는 JSON Lines 파일만 올릴 수 있습니다.");
    fireEvent.change(input, { target: { files: [new File(["a,b"], "classroom-10k.csv")] } });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText(/열 매핑/)).toBeNull();
  });

  it("업로드 오류(SIM_IMPORT_INVALID)는 문제 행 번호와 이유", async () => {
    await renderRoute(<ReplayView spaces={SPACES} canRun uploadError={{ code: "SIM_IMPORT_INVALID", row: 12, reason: "열 누락" }} api={fakeSimApi()} navigate={vi.fn()} />, { session: meOf("OPERATOR") });
    expect(await screen.findByRole("alert")).toHaveTextContent("파일 형식이 올바르지 않습니다 12행: 열 누락");
  });

  it("매핑 추측·미리 보기 20행 → 대상 건수(dryRun) → 재생 시작 → 실행 패널", async () => {
    const api = fakeSimApi();
    const navigate = vi.fn();
    await renderRoute(<ReplayView uploaded={FILE} spaces={SPACES} canRun api={api} navigate={navigate} />, { session: meOf("OPERATOR") });
    expect(await screen.findByText("열 매핑 (10000행)")).toBeInTheDocument();
    expect(screen.getByLabelText("시각 열")).toHaveDisplayValue("timestamp");
    expect(screen.getByLabelText("기기 ID 열")).toHaveDisplayValue("deviceId");
    expect(screen.getByLabelText("temperature 열의 측정 키")).toHaveValue("temperature");
    const table = screen.getByText("미리 보기 20행").nextElementSibling as HTMLElement;
    expect(within(table).getAllByRole("row")).toHaveLength(21);
    // Humidity 열은 키가 비어 있어 제외, 잘못된 키는 문구
    await userEvent.type(screen.getByLabelText("Humidity 열의 측정 키"), "Hum Bad");
    await userEvent.click(screen.getByRole("button", { name: "대상 건수 확인" }));
    expect(screen.getByText("측정 키는 영문 소문자로 시작하는 소문자·숫자·_ 입니다.")).toBeInTheDocument();
    expect(api.replay).not.toHaveBeenCalled();
    await userEvent.clear(screen.getByLabelText("Humidity 열의 측정 키"));
    await userEvent.type(screen.getByLabelText("Humidity 열의 측정 키"), "humidity");
    await userEvent.click(screen.getByRole("button", { name: "대상 건수 확인" }));
    expect(await screen.findByText("대상 측정값 20000건")).toBeInTheDocument();
    expect(api.replay).toHaveBeenCalledWith(
      {
        source: { type: "FILE", fileId: "f-1", columnMapping: { time: "timestamp", deviceId: "deviceId", metrics: { temperature: "temperature", Humidity: "humidity" } }, timeFormat: "ISO8601" },
        timeShift: { basis: "NOW" },
        acceleration: 60,
        cloneSpaceId: "41",
        cloneSuffix: " [재생]",
      },
      true,
    );
    await userEvent.selectOptions(screen.getByLabelText("시각 기준"), "AT");
    await userEvent.click(screen.getByRole("button", { name: "재생 시작" }));
    expect(screen.getByText("날짜와 시각을 입력하세요.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("시작 시각"), { target: { value: "2026-10-05T09:00" } });
    await userEvent.selectOptions(screen.getByLabelText("시각 형식"), "EPOCH_MS");
    await userEvent.click(screen.getByRole("button", { name: "재생 시작" }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/sim/runs/77"));
    expect(api.replay).toHaveBeenLastCalledWith(expect.objectContaining({ timeShift: { basis: "AT", at: expect.stringMatching(/^2026-10-05T/) } }), false);
  });

  it("매핑 필수(시각·기기)와 재생 실패 문구, 실행 권한이 없으면 버튼 없음", async () => {
    const api = fakeSimApi({ replay: vi.fn(() => failure(400, "SIM_IMPORT_INVALID")) });
    const { unmount } = await renderRoute(<ReplayView uploaded={{ ...FILE, columns: ["a", "b"], preview: [] }} spaces={SPACES} canRun api={api} navigate={vi.fn()} />, { session: meOf("OPERATOR") });
    await userEvent.click(await screen.findByRole("button", { name: "대상 건수 확인" }));
    expect(screen.getAllByText("열을 고르세요.")).toHaveLength(2);
    await userEvent.selectOptions(screen.getByLabelText("시각 열"), "a");
    await userEvent.selectOptions(screen.getByLabelText("기기 ID 열"), "b");
    await userEvent.click(screen.getByRole("button", { name: "대상 건수 확인" }));
    expect(screen.getByText("측정 열을 하나 이상 연결하세요.")).toBeInTheDocument();
    unmount();
    await renderRoute(<ReplayView uploaded={FILE} spaces={SPACES} canRun api={api} navigate={vi.fn()} />, { session: meOf("OPERATOR") });
    await userEvent.click(await screen.findByRole("button", { name: "재생 시작" }));
    expect(await screen.findByText("파일 형식이 올바르지 않습니다")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "대상 건수 확인" }));
    expect(await screen.findAllByText("파일 형식이 올바르지 않습니다")).toHaveLength(1);
  });
});
