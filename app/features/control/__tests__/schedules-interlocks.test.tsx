/**
 * ACT-02.07 UI-ACT-05 예약 제어(TC-ACT-060 운영 시간 +10분, TC-ACT-063 SCHEDULE_INVALID)와 ACT-06.02 UI-ACT-06 인터락(TC-ACT-101 차단 기록, TC-ACT-102 INTERLOCK_INVALID).
 */
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderRoute } from "../../../../test/render";
import { InterlockManager } from "../interlocks";
import type { Interlock, Schedule } from "../model/admin";
import { ScheduleManager, utcToLocalInput } from "../schedules";
import { err, fakeAdminApi, ok } from "./fake-admin";

const SPACES = [{ id: "31", name: "실습실", type: "ROOM", children: [] }] as never;
const SCENES = [{ sceneId: "501", name: "수업 모드" }];
const DEVICES = [{ id: "2001", name: "AC-1 실습실 에어컨" }];
const SCHEDULE: Schedule = {
  controlScheduleId: "601",
  name: "아침 준비",
  kind: "RECURRING",
  target: { sceneId: "501" },
  cron: "50 8 * * 1,2,3,4,5",
  skipHolidays: true,
  timezone: "Asia/Seoul",
  enabled: true,
  nextRunAt: "2026-10-05T23:50:00Z",
  lastRun: { at: "2026-10-02T23:50:00Z", status: "SUCCEEDED" },
  targetSummary: "장면 수업 모드",
  version: 2,
};

describe("UI-ACT-05 예약 제어", () => {
  it("목록: 대상·종류·다음 실행·마지막 결과, 활성 토글(API-ACT-15 enable/disable)", async () => {
    const user = userEvent.setup();
    const api = fakeAdminApi();
    await renderRoute(<ScheduleManager initial={[SCHEDULE]} scenes={SCENES} devices={DEVICES} spaces={SPACES} timezone="Asia/Seoul" lang="ko" api={api} />);
    expect(await screen.findByText("장면 수업 모드")).toBeInTheDocument();
    expect(screen.getByText("다음 실행: 2026-10-06 08:50")).toBeInTheDocument();
    expect(screen.getByText("성공")).toBeInTheDocument();
    await user.click(screen.getByRole("switch", { name: "아침 준비 활성" }));
    await waitFor(() => expect(screen.getByRole("switch", { name: "아침 준비 활성" })).not.toBeChecked());
    expect(api.setScheduleEnabled).toHaveBeenCalledWith("601", false);
  });

  it("TC-ACT-060 AT-ACT-06.3: 공간 운영 시간 종료 +10분 퇴실 모드 → 본문 spaceHours, 휴일 제외", async () => {
    const user = userEvent.setup();
    const api = fakeAdminApi({
      createSchedule: vi.fn(async (body) => ok({ ...SCHEDULE, ...body, targetSummary: null, controlScheduleId: "602", nextRunAt: "2026-10-04T09:10:00Z" } as Schedule, 201)),
    });
    await renderRoute(<ScheduleManager initial={[]} scenes={SCENES} devices={DEVICES} spaces={SPACES} timezone="Asia/Seoul" lang="ko" api={api} />);
    expect(await screen.findByText("예약이 없습니다")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "새 예약" }));
    await user.click(screen.getByRole("button", { name: "저장" }));
    expect(screen.getByText("이름을 1~100자로 입력하세요")).toBeInTheDocument();
    expect(screen.getByText("장면을 고르세요")).toBeInTheDocument();
    await user.type(screen.getByLabelText("이름"), "퇴실");
    await user.selectOptions(screen.getByLabelText("장면"), "501");
    await user.selectOptions(screen.getByLabelText("일정 종류"), "SPACE_HOURS");
    await user.click(screen.getByRole("button", { name: "저장" }));
    expect(screen.getByText("공간과 ±분(정수)을 입력하세요")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("공간"), "31");
    await user.click(screen.getByRole("button", { name: "저장" }));
    await screen.findByText("예약을 저장했습니다. 다음 실행: 2026-10-04 18:10");
    expect(api.createSchedule.mock.calls[0][0]).toEqual({
      name: "퇴실",
      target: { sceneId: "501" },
      kind: "SPACE_HOURS",
      skipHolidays: true,
      timezone: "Asia/Seoul",
      spaceHours: { spaceId: "31", edge: "END", offsetMinutes: 10 },
    });
    expect(screen.getByText("수업 모드")).toBeInTheDocument();
  });

  it("반복: 요일·시각 → cron, 직접 cron 오류·기간 역전, 서버 SCHEDULE_INVALID(TC-ACT-063), 기기 명령 대상·한 번 실행", async () => {
    const user = userEvent.setup();
    const api = fakeAdminApi({ createSchedule: vi.fn(async () => err(400, "SCHEDULE_INVALID")) });
    await renderRoute(<ScheduleManager initial={[]} scenes={SCENES} devices={DEVICES} spaces={SPACES} timezone="Asia/Seoul" lang="ko" api={api} />);
    await user.click(await screen.findByRole("button", { name: "새 예약" }));
    await user.type(screen.getByLabelText("이름"), "아침");
    await user.selectOptions(screen.getByLabelText("장면"), "501");
    await user.type(screen.getByLabelText("cron(선택)"), "매일");
    await user.type(screen.getByLabelText("유효 시작일"), "2026-12-01");
    await user.type(screen.getByLabelText("유효 종료일"), "2026-11-01");
    await user.click(screen.getByRole("button", { name: "저장" }));
    expect(screen.getByText("요일과 시각을 고르거나 올바른 cron을 입력하세요")).toBeInTheDocument();
    expect(screen.getByText("종료일은 시작일 이후여야 합니다")).toBeInTheDocument();
    await user.clear(screen.getByLabelText("cron(선택)"));
    await user.clear(screen.getByLabelText("유효 종료일"));
    await user.click(screen.getByRole("button", { name: "저장" }));
    expect(await screen.findByText("일정이 올바르지 않습니다")).toBeInTheDocument();
    expect(api.createSchedule.mock.calls[0][0]).toMatchObject({ kind: "RECURRING", cron: "50 8 * * 1,2,3,4,5", validFrom: "2026-12-01" });

    await user.selectOptions(screen.getByLabelText("대상 종류"), "device");
    await user.selectOptions(screen.getByLabelText("기기"), "2001");
    await user.type(screen.getByLabelText("기능"), "Switch");
    await user.clear(screen.getByLabelText("인자(JSON)"));
    await user.type(screen.getByLabelText("인자(JSON)"), "[[1]]");
    await user.selectOptions(screen.getByLabelText("일정 종류"), "ONCE");
    await user.click(screen.getByRole("button", { name: "저장" }));
    expect(screen.getByText("JSON 객체로 입력하세요")).toBeInTheDocument();
    expect(screen.getByText("실행 일시를 입력하세요")).toBeInTheDocument();
  });

  it("기존 예약 열기(조직 시간대로 되돌림)·수정 baseVersion·삭제", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const once: Schedule = {
      ...SCHEDULE,
      controlScheduleId: "603",
      name: "행사",
      kind: "ONCE",
      cron: null,
      targetSummary: null,
      at: "2026-10-10T01:00:00Z",
      target: { deviceId: "2001", capability: "Switch", command: "set", args: { on: true } },
    };
    const api = fakeAdminApi({ schedule: vi.fn(async () => ok(once)), updateSchedule: vi.fn(async (_id, body) => ok({ ...once, ...body, version: 3 } as Schedule)) });
    await renderRoute(<ScheduleManager initial={[once]} scenes={SCENES} devices={DEVICES} spaces={SPACES} timezone="Asia/Seoul" lang="ko" api={api} />);
    await user.click(await screen.findByRole("button", { name: "행사" }));
    expect(await screen.findByLabelText("실행 일시")).toHaveValue("2026-10-10T10:00");
    expect(screen.getByLabelText("인자(JSON)")).toHaveValue('{"on":true}');
    await user.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(api.updateSchedule).toHaveBeenCalled());
    expect(api.updateSchedule.mock.calls[0][1]).toMatchObject({ at: "2026-10-10T01:00:00Z", baseVersion: 2, target: { deviceId: "2001", capability: "Switch", command: "set", args: { on: true } } });
    expect(await screen.findByText("AC-1 실습실 에어컨 Switch.set")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "삭제" }));
    await waitFor(() => expect(screen.queryByText("행사")).not.toBeInTheDocument());
    expect(utcToLocalInput("2026-10-03T15:30:00Z", "Asia/Seoul")).toBe("2026-10-04T00:30");
  });
});

const INTERLOCK: Interlock = {
  interlockId: "701",
  name: "창문 열림 시 냉난방 금지",
  spaceId: "31",
  includeChildren: true,
  condition: { kind: "state", relation: "measures", capability: "Contact", attribute: "open", op: "==", value: true },
  forbid: { capability: "Thermostat", command: "set", argsMatch: { mode: { in: ["cool", "heat"] } } },
  message: "창문이 열려 있어 냉난방을 막았습니다",
  enabled: true,
  blocks7d: 4,
  version: 1,
};

describe("UI-ACT-06 인터락", () => {
  it("목록·차단 기록(TC-ACT-101)·열어서 조건 요약·수정 baseVersion", async () => {
    const user = userEvent.setup();
    const api = fakeAdminApi({ interlock: vi.fn(async () => ok(INTERLOCK)), updateInterlock: vi.fn(async (_id, body) => ok({ ...INTERLOCK, ...body, version: 2 } as Interlock)) });
    await renderRoute(<InterlockManager initial={[INTERLOCK]} spaces={SPACES} devices={DEVICES} timezone="Asia/Seoul" lang="ko" api={api} />);
    expect(await screen.findByText("Thermostat.set · mode ∈ {cool, heat}")).toBeInTheDocument();
    expect(screen.getByText("(하위 포함)")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "창문 열림 시 냉난방 금지 차단 기록 보기" }));
    expect(await screen.findByText("최근 차단 기록")).toBeInTheDocument();
    expect(screen.getAllByText("창문이 열려 있어 냉난방을 막았습니다").length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: "창문 열림 시 냉난방 금지" }));
    expect(await screen.findByText("Contact.open == true → 금지 Thermostat.set · mode ∈ {cool, heat}")).toBeInTheDocument();
    expect(screen.getAllByText("Contact.open == true").length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(api.updateInterlock).toHaveBeenCalled());
    expect(api.updateInterlock.mock.calls[0][1]).toMatchObject({
      baseVersion: 1,
      condition: { kind: "state", relation: "measures", capability: "Contact", attribute: "open", op: "==", value: true },
      forbid: { capability: "Thermostat", command: "set", argsMatch: { mode: { in: ["cool", "heat"] } } },
    });
  });

  it("새 인터락(측정값: 실외 pm2_5 > 75 → 환기 금지) 검증, 서버 INTERLOCK_INVALID(TC-ACT-102), 삭제", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const api = fakeAdminApi({ createInterlock: vi.fn(async () => err(400, "INTERLOCK_INVALID")) });
    await renderRoute(<InterlockManager initial={[INTERLOCK]} spaces={SPACES} devices={DEVICES} timezone="Asia/Seoul" lang="ko" api={api} />);
    await user.click(await screen.findByRole("button", { name: "새 인터락" }));
    expect(screen.getByText(/보고 주기 × 3, 최소 5분/)).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("조건 종류"), "metric");
    await user.clear(screen.getByLabelText("금지 기능"));
    await user.click(screen.getByRole("button", { name: "저장" }));
    expect(screen.getByText("이름을 1~100자로 입력하세요")).toBeInTheDocument();
    expect(screen.getByText("공간을 고르세요")).toBeInTheDocument();
    expect(screen.getByText("측정 항목을 입력하세요")).toBeInTheDocument();
    expect(screen.getByText("금지할 기능을 입력하세요")).toBeInTheDocument();
    expect(screen.getByText(/요청자에게 보일 사유/)).toBeInTheDocument();
    await user.type(screen.getByLabelText("이름"), "미세먼지 시 외기 금지");
    await user.selectOptions(screen.getByLabelText("공간"), "31");
    await user.type(screen.getByLabelText("측정 항목"), "pm2_5");
    await user.selectOptions(screen.getByLabelText("연산자"), ">");
    await user.clear(screen.getByLabelText("값"));
    await user.type(screen.getByLabelText("값"), "75");
    await user.type(screen.getByLabelText("금지 기능"), "Ventilation");
    await user.clear(screen.getByLabelText("인자 속성(선택)"));
    await user.clear(screen.getByLabelText("금지 값"));
    await user.type(screen.getByLabelText("사유 문구"), "미세먼지가 높아 외기 환기를 막았습니다");
    await user.click(screen.getByRole("button", { name: "저장" }));
    expect(await screen.findByText("인터락 설정이 올바르지 않습니다")).toBeInTheDocument();
    expect(api.createInterlock.mock.calls[0][0]).toEqual({
      name: "미세먼지 시 외기 금지",
      spaceId: "31",
      includeChildren: true,
      condition: { kind: "metric", spaceAgg: "avg", metric: "pm2_5", op: ">", value: 75 },
      forbid: { capability: "Ventilation", command: "set" },
      message: "미세먼지가 높아 외기 환기를 막았습니다",
      enabled: true,
    });
    await user.click(screen.getByRole("button", { name: "삭제" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "창문 열림 시 냉난방 금지" })).not.toBeInTheDocument());
  });
});
