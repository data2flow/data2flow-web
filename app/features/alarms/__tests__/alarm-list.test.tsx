/**
 * TC-RUL-058 AT-RUL-06.4 알람 목록(UI-RUL-04, RUL-02.06): 필터가 URL 검색 매개변수와 같이 움직이고, SSE로 새 알람이 오면 목록 맨 위(3초 강조),
 * 150건 일괄 확인 후 건별 결과(성공·실패), 빈 목록 문구. 201건은 막는다. 일괄 무음, 연결 끊김 띠.
 */
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { meOf, renderRoute } from "../../../../test/render";
import { FakeES, live } from "../../control/__tests__/fake-live";
import type { AlarmsApi } from "../api";
import { AlarmListView, formatDuration } from "../components/alarm-list-view";
import { HIGHLIGHT_MS, filterFromParams, type Alarm } from "../model/alarms";

const NOW = Date.parse("2026-10-04T00:00:00Z");
const alarm = (i: number, extra: Partial<Alarm> = {}): Alarm => ({ id: String(i), severity: "MAJOR", status: "ACTIVE", title: `고CO2 ${i}`, source: { type: "RULE", ruleId: "r-1" }, device: { id: "1042", name: "AM107-067999" }, space: { id: "31", path: ["본관", "실습실"] }, triggerValue: 1050, peakValue: 1180, occurrenceCount: 3, raisedAt: new Date(NOW - i * 60_000).toISOString(), ...extra });

function Where() {
  const location = useLocation();
  return <output data-testid="where">{location.search}</output>;
}

function fakeApi(overrides: Partial<AlarmsApi> = {}): AlarmsApi & Record<string, ReturnType<typeof vi.fn>> {
  return {
    bulkAck: vi.fn(async (ids: string[]) => ({ ok: true as const, status: 200, data: { results: ids.map((id, i) => (i === 0 ? { alarmId: id, ok: false, code: "ALARM_STATE_CONFLICT" } : { alarmId: id, ok: true })) } })),
    silence: vi.fn(async () => ({ ok: true as const, status: 201, data: { silenceId: "s" } })),
    ...overrides,
  } as AlarmsApi & Record<string, ReturnType<typeof vi.fn>>;
}

async function setup(alarms: Alarm[], options: { search?: string; role?: string; api?: AlarmsApi } = {}) {
  const api = options.api ?? fakeApi();
  const filter = filterFromParams(new URLSearchParams(options.search ?? ""));
  await renderRoute(
    <>
      <AlarmListView alarms={alarms} counts={{ byStatus: { ACTIVE: alarms.length }, bySeverity: { MAJOR: alarms.length } }} filter={filter} totalPages={1} spaces={[]} canHandle={(options.role ?? "OPERATOR") !== "VIEWER"} timezone="Asia/Seoul" now={() => NOW} api={api} live={live} />
      <Where />
    </>,
    { session: meOf(options.role ?? "OPERATOR"), path: "/alarms", url: `/alarms${options.search ? `?${options.search}` : ""}` },
  );
  return { api, es: () => FakeES.all.at(-1)! };
}

beforeEach(() => {
  FakeES.all = [];
});
afterEach(() => vi.useRealTimers());

describe("TC-RUL-058 AT-RUL-06.4 알람 목록", () => {
  it("필터를 바꾸면 URL 검색 매개변수가 바뀐다(상태·심각도·기간·출처·공간 이벤트, 요약 바 클릭)", async () => {
    const user = userEvent.setup();
    await setup([alarm(1)]);
    await user.selectOptions(await screen.findByLabelText("상태"), "CLEARED");
    expect(screen.getByTestId("where")).toHaveTextContent("?status=CLEARED");
    await user.selectOptions(screen.getByLabelText("심각도"), "MAJOR");
    expect(screen.getByTestId("where")).toHaveTextContent("?severity=MAJOR");
    await user.selectOptions(screen.getByLabelText("기간"), "7d");
    expect(screen.getByTestId("where")).toHaveTextContent("?range=7d");
    await user.selectOptions(screen.getByLabelText("출처"), "FLOW");
    expect(screen.getByTestId("where")).toHaveTextContent("?sourceType=FLOW");
    await user.click(screen.getByRole("checkbox", { name: "공간 이벤트로 묶기" }));
    expect(screen.getByTestId("where")).toHaveTextContent("?groupBySpaceEvent=true");
    await user.click(screen.getByRole("button", { name: /^확인됨/ }));
    expect(screen.getByTestId("where")).toHaveTextContent("?status=ACKNOWLEDGED");
    await user.selectOptions(screen.getByLabelText("상태"), "all");
    expect(screen.getByTestId("where")).toHaveTextContent("status=ACTIVE%2CACKNOWLEDGED%2CSUPPRESSED%2CCLEARED");
  });

  it("SSE로 새 알람이 오면 맨 위에 3초 강조, 상태 변경 반영, 해제되면 열린 목록에서 빠진다", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { es } = await setup([alarm(1)]);
    await waitFor(() => expect(FakeES.all.length).toBeGreaterThan(0));
    expect(es().url).toBe("/bff/stream/alarms");
    act(() => es().emit("alarm.raised", alarm(99, { severity: "CRITICAL", title: "게이트웨이 오프라인" })));
    const list = screen.getByRole("list", { name: "알람" });
    expect(within(list).getAllByRole("link")[0]).toHaveTextContent("게이트웨이 오프라인");
    expect(screen.getByLabelText("새 알람: 게이트웨이 오프라인")).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(HIGHLIGHT_MS);
    });
    expect(screen.queryByLabelText("새 알람: 게이트웨이 오프라인")).toBeNull();
    act(() => es().emit("alarm.updated", alarm(1, { status: "ACKNOWLEDGED", ackedBy: { userId: "7", name: "김운영" } })));
    expect(screen.getAllByText("확인됨").length).toBeGreaterThan(1);
    act(() => es().emit("alarm.cleared", alarm(1, { status: "CLEARED" })));
    expect(screen.queryByText("고CO2 1")).toBeNull();
    act(() => es().emit("alarm.raised", "garbage"));
  });

  it("150건 선택 → 일괄 확인 → 건별 결과(성공 149·실패 1), 실패만 선택 유지", { timeout: 20_000 }, async () => {
    const user = userEvent.setup();
    const alarms = Array.from({ length: 150 }, (_, i) => alarm(i + 1));
    const { api } = await setup(alarms);
    await user.click(await screen.findByLabelText("이 페이지 모두 선택", {}, { timeout: 10_000 }));
    expect(screen.getByText("선택 150건")).toBeInTheDocument();
    await user.click(screen.getByText("확인", { selector: "button" }));
    expect(api.bulkAck).toHaveBeenCalledWith(alarms.map((a) => a.id));
    expect(await screen.findByText("149건 확인, 1건 실패", {}, { timeout: 10_000 })).toBeInTheDocument();
    expect(screen.getByText("이미 처리된 알람입니다")).toBeInTheDocument();
    expect(screen.getByText("선택 1건")).toBeInTheDocument();
    expect(screen.getAllByText("처리됨")).toHaveLength(149);
  });

  it("201건이면 한도 안내(BR-RUL-21)", { timeout: 20_000 }, async () => {
    const user = userEvent.setup();
    const { api } = await setup(Array.from({ length: 201 }, (_, i) => alarm(i + 1)));
    await user.click(await screen.findByLabelText("이 페이지 모두 선택", {}, { timeout: 10_000 }));
    await user.click(screen.getByText("확인", { selector: "button" }));
    expect(screen.getAllByText("한 번에 200건까지 처리할 수 있습니다").length).toBeGreaterThan(0);
    expect(api.bulkAck).not.toHaveBeenCalled();
    await user.selectOptions(screen.getByLabelText("무음"), "30");
    expect(api.silence).not.toHaveBeenCalled();
  });

  it("일괄 무음 30분은 알람마다 무음(대상 ALARM)", async () => {
    const user = userEvent.setup();
    const { api } = await setup([alarm(1), alarm(2), alarm(3)]);
    await user.click(await screen.findByRole("checkbox", { name: "고CO2 2 선택" }));
    await user.click(screen.getByRole("checkbox", { name: "고CO2 3 선택" }));
    await user.selectOptions(screen.getByLabelText("무음"), "30");
    expect(api.silence).toHaveBeenCalledTimes(2);
    expect(api.silence).toHaveBeenCalledWith({ kind: "ONE_TIME", target: { type: "ALARM", id: "2" }, startsAt: "2026-10-04T00:00:00.000Z", endsAt: "2026-10-04T00:30:00.000Z" });
    expect(await screen.findByText("2건 무음, 0건 실패")).toBeInTheDocument();
  });

  it("일괄 확인 실패(403)·무음 실패 문구", async () => {
    const user = userEvent.setup();
    const api = fakeApi({ bulkAck: vi.fn(async () => ({ ok: false as const, status: 403, code: "PERMISSION_DENIED", message: "" })), silence: vi.fn(async () => ({ ok: false as const, status: 400, code: "SILENCE_RANGE_INVALID", message: "" })) });
    await setup([alarm(1)], { api });
    await user.click(await screen.findByRole("checkbox", { name: "고CO2 1 선택" }));
    await user.click(screen.getByRole("button", { name: "확인" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("무음"), "60");
    expect(await screen.findByText("0건 무음, 1건 실패")).toBeInTheDocument();
  });

  it("빈 목록 문구, VIEWER는 선택·확인 없음, 하위 알람·공간 이벤트 묶음, 지속 시간 표기", async () => {
    await setup([], { role: "VIEWER" });
    expect(await screen.findByText("현재 열린 알람이 없습니다 ✓")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "확인" })).toBeNull();
    await setup([alarm(1, { childCount: 1, severity: "CRITICAL" }), alarm(2, { parentAlarmId: "1", status: "SUPPRESSED", suppressedReason: "PARENT" }), alarm(3, { spaceEventId: "e"}), alarm(4, { spaceEventId: "e", flapping: true })], { search: "groupBySpaceEvent=true" });
    expect(await screen.findByText("하위 1")).toBeInTheDocument();
    expect(screen.getByText("상위 원인")).toBeInTheDocument();
    expect(screen.getByText("플래핑")).toBeInTheDocument();
    expect(screen.getByText("공간 이벤트 · 본관 / 실습실 · 알람 2건")).toBeInTheDocument();
    const t = (key: string, o?: Record<string, unknown>) => `${key}:${String(o?.n)}`;
    expect(formatDuration(90000, t)).toBe("alarms.dur.days:1");
    expect(formatDuration(7200, t)).toBe("alarms.dur.hours:2");
    expect(formatDuration(5, t)).toBe("alarms.dur.seconds:5");
  });
});
