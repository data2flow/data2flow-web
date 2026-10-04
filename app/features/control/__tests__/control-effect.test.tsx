/**
 * ACT-08 UI-ACT-11 장비 가동·효과 — TC-ACT-133(AT-ACT-12.1): 냉방 APPLIED 뒤 15분간 +0.1℃ → 효과 없음 이벤트 1건 표시,
 * AT-ACT-12.2: 하루 6시간 가동·정격 1.2kW → 6h, 7.2kWh(정격 추정). 기간 바꾸면 날짜(from·to)로 다시 조회하고, 12개월은 일별 응답을 월로 묶는다.
 */
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderRoute } from "../../../../test/render";
import { OperationTab } from "../operation-tab";
import { err, fakeAdminApi, ok } from "./fake-admin";

const REPORT = {
  items: [
    { date: "2026-10-02", onSeconds: 21600, cycles: 4, energyWh: 7200, energySource: "RATED" },
    { date: "2026-10-03", onSeconds: 0, cycles: 0, energyWh: null, energySource: null },
  ],
  noEffectEvents: [{ at: "2026-10-03T03:15:00Z", commandId: "c-1", metric: "temperature", expected: { direction: "down", withinMinutes: 15 }, observed: { start: 27.4, end: 27.5, delta: 0.1 } }],
};

describe("TC-ACT-133 AT-ACT-12.1 AT-ACT-12.2 가동·효과", () => {
  it("합계(6시간·4회·7.2kWh), 일별 표, 효과 없음 1건(기대 ↓ 15m, 실제 +0.1)", async () => {
    const user = userEvent.setup();
    const api = fakeAdminApi({ runtime: vi.fn(async () => ok(REPORT)) });
    await renderRoute(<OperationTab deviceId="2001" timezone="Asia/Seoul" lang="ko" now={() => Date.parse("2026-10-04T00:00:00Z")} api={api} />);
    expect(await screen.findByText("제어 효과 없음 1건")).toBeInTheDocument();
    expect(screen.getAllByText("6시간").length).toBeGreaterThan(0);
    expect(screen.getAllByText("7.2 kWh").length).toBeGreaterThan(0);
    expect(screen.getByText("정격 추정")).toBeInTheDocument();
    expect(screen.getByText("↓ 15m")).toBeInTheDocument();
    expect(screen.getByText("+0.1")).toBeInTheDocument();
    // API-ACT-35(action): from·to는 날짜, 양 끝 포함 7일
    expect(api.runtime).toHaveBeenCalledWith("2001", "2026-09-28", "2026-10-04");
    await user.selectOptions(screen.getByLabelText("기간"), "12m");
    await waitFor(() => expect(api.runtime).toHaveBeenLastCalledWith("2001", "2025-10-05", "2026-10-04"));
    // 일별 응답을 월로 묶는다
    expect(await screen.findByText("2026-10")).toBeInTheDocument();
  });

  it("기록 없음·조회 실패 안내", async () => {
    const api = fakeAdminApi({ runtime: vi.fn(async () => ok({ items: [], noEffectEvents: [] })) });
    const { unmount } = await renderRoute(<OperationTab deviceId="2001" timezone="Asia/Seoul" lang="ko" api={api} />);
    expect(await screen.findByText("가동 기록이 없습니다")).toBeInTheDocument();
    expect(screen.getByText("효과 없음 이벤트가 없습니다")).toBeInTheDocument();
    unmount();
    await renderRoute(<OperationTab deviceId="2001" timezone="Asia/Seoul" lang="ko" api={fakeAdminApi({ runtime: vi.fn(async () => err(503, "SERVICE_UNAVAILABLE")) })} />);
    expect(await screen.findByText("가동 현황을 불러오지 못했습니다")).toBeInTheDocument();
  });
});
