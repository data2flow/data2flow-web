/**
 * TC-DEV-297 UI-DEV-14 조직 달력 부품: 월·주·목록, 일정 색·출처, 대화상자 입력 검증("시작일이 종료일보다 늦습니다", 366일),
 * 권한별 노출(등록 O+, 외부 달력 연결 I+), 자동 일정은 운영 모드 영향만.
 */
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderRoute } from "../../../../test/render";
import { CalendarGrid, CalendarToolbar, EventDialog, ExternalCalendarLink } from "../components/calendar-view";
import type { CalendarEvent } from "../model/calendar";

const events: CalendarEvent[] = [
  { id: "501", title: "개천절", type: "HOLIDAY", startsOn: "2026-10-03", endsOn: "2026-10-03", origin: "HOLIDAY_API", affectsMode: "HOLIDAY", version: 1 },
  { id: "503", title: "중간고사 기간", type: "EXAM", startsOn: "2026-10-12", endsOn: "2026-10-14", origin: "ICAL", affectsMode: "NONE", originDeleted: true, locallyModified: true, version: 2 },
  { id: "601", title: "축제", type: "EVENT", startsOn: "2026-10-21", endsOn: "2026-10-21", startTime: "10:00", endTime: "12:00", origin: "MANUAL", affectsMode: "NONE", scopeSpaceIds: ["1"], version: 1 },
];
const spaces = [{ id: "1", type: "SITE", name: "광주캠퍼스", children: [{ id: "31", type: "ROOM", name: "실습실" }] }];

describe("TC-DEV-297 달력 보기", () => {
  it("월 보기: 요일 머리, 여러 날 일정은 칸마다, 출처 기호·원본 삭제됨, 누르면 열기", async () => {
    const onOpen = vi.fn();
    await renderRoute(<CalendarGrid view="month" anchor="2026-10-01" events={events} today="2026-10-04" onOpen={onOpen} />);
    const grid = await screen.findByRole("table", { name: "달력" });
    expect(within(grid).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["월", "화", "수", "목", "금", "토", "일"]);
    expect(grid.querySelectorAll('[data-event="503"]')).toHaveLength(3);
    expect(grid.querySelector('[data-date="2026-10-03"]')).toHaveTextContent("★ 개천절");
    expect(grid.querySelector('[data-date="2026-10-12"]')).toHaveTextContent("원본 삭제됨");
    expect(screen.getAllByLabelText("공휴일")).toHaveLength(1);
    await userEvent.click(grid.querySelector('[data-event="601"]')!);
    expect(onOpen).toHaveBeenCalledWith(events[2]);
  });

  it("목록 보기는 시작일 순·기간 표시, 비어 있으면 안내", async () => {
    const { unmount } = await renderRoute(<CalendarGrid view="list" anchor="2026-10-01" events={[events[2], events[1]]} today="x" onOpen={() => undefined} />);
    const list = await screen.findByRole("list", { name: "일정 목록" });
    expect(within(list).getAllByRole("listitem").map((li) => li.textContent)).toEqual([expect.stringContaining("2026-10-12 ~ 2026-10-14"), expect.stringContaining("2026-10-21")]);
    unmount();
    await renderRoute(<CalendarGrid view="list" anchor="2026-10-01" events={[]} today="x" onOpen={() => undefined} />);
    expect(await screen.findByText("이 기간에 일정이 없습니다")).toBeInTheDocument();
  });

  it("도구 막대: 이전·오늘·다음·보기 링크, 등록 권한자만 [+ 일정]", async () => {
    const onAdd = vi.fn();
    const hrefFor = (p: { view?: string; anchor?: string; shift?: number }) => `/calendar?view=${p.view ?? "month"}&a=${p.anchor ?? ""}&s=${p.shift ?? 0}`;
    const { unmount } = await renderRoute(<CalendarToolbar view="week" anchor="2026-10-09" today="2026-10-04" spaceId="" spaces={spaces} hrefFor={hrefFor} canWrite onAdd={onAdd} />);
    expect(await screen.findByRole("link", { name: "이전" })).toHaveAttribute("href", "/calendar?view=month&a=&s=-1");
    expect(screen.getByRole("link", { name: "오늘" })).toHaveAttribute("href", "/calendar?view=month&a=2026-10-04&s=0");
    expect(screen.getByRole("link", { name: "주" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("2026년 10월")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "+ 일정" }));
    expect(onAdd).toHaveBeenCalled();
    unmount();
    await renderRoute(<CalendarToolbar view="month" anchor="2026-10-09" today="2026-10-04" spaceId="31" spaces={spaces} hrefFor={hrefFor} canWrite={false} onAdd={onAdd} />);
    expect(await screen.findByLabelText("범위")).toHaveValue("31");
    expect(screen.queryByRole("button", { name: "+ 일정" })).toBeNull();
  });

  it("외부 달력 연결은 INTEGRATOR(SRC_ADMIN)에게만", async () => {
    const { unmount } = await renderRoute(<ExternalCalendarLink canConnect />);
    expect(await screen.findByRole("link", { name: "외부 달력 연결" })).toHaveAttribute("href", "/sources/context");
    unmount();
    const { container } = await renderRoute(<><p>x</p><ExternalCalendarLink canConnect={false} /></>);
    await screen.findByText("x");
    expect(container.querySelector('a[href="/sources/context"]')).toBeNull();
  });
});

describe("TC-DEV-297 일정 대화상자", () => {
  it("새 일정: 시작 > 종료면 \"시작일이 종료일보다 늦습니다\", 366일 초과 문구, 저장 막힘; 유형을 바꾸면 영향 기본값", async () => {
    await renderRoute(<EventDialog event={null} defaultDate="2026-10-20" spaces={spaces} canWrite onClose={() => undefined} />);
    const dialog = await screen.findByRole("dialog", { name: "+ 일정" });
    const save = within(dialog).getByRole("button", { name: "저장" });
    expect(save).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText("제목"), "휴관");
    expect(save).toBeEnabled();
    const ends = within(dialog).getByLabelText("종료일");
    await userEvent.clear(ends);
    await userEvent.type(ends, "2026-10-19");
    expect(within(dialog).getByText("시작일이 종료일보다 늦습니다")).toBeInTheDocument();
    expect(save).toBeDisabled();
    await userEvent.clear(ends);
    await userEvent.type(ends, "2027-10-25");
    expect(within(dialog).getByText("기간은 최대 366일입니다")).toBeInTheDocument();
    await userEvent.clear(ends);
    await userEvent.type(ends, "2026-10-21");
    expect(within(dialog).getByLabelText("운영 모드 영향")).toHaveValue("NONE");
    await userEvent.selectOptions(within(dialog).getByLabelText("유형"), "CLOSURE");
    expect(within(dialog).getByLabelText("운영 모드 영향")).toHaveValue("HOLIDAY");
    await userEvent.selectOptions(within(dialog).getByLabelText("운영 모드 영향"), "NONE");
    await userEvent.selectOptions(within(dialog).getByLabelText("유형"), "VACATION");
    expect(within(dialog).getByLabelText("운영 모드 영향")).toHaveValue("NONE");
    await userEvent.type(within(dialog).getByLabelText("시작 시각(선택)"), "09:00");
    expect(within(dialog).getByText("시작·종료 시각을 함께 입력하세요")).toBeInTheDocument();
  });

  it("자동 일정(공휴일·iCal)은 영향만 바꾸고 삭제 없음, 원본 삭제됨 안내; 수동 일정은 삭제 버튼; 읽기 전용은 저장 없음", async () => {
    const { unmount } = await renderRoute(<EventDialog event={events[1]} defaultDate="x" spaces={spaces} canWrite onClose={() => undefined} result={{ intent: "update", error: { code: "VERSION_CONFLICT" } }} />);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/iCal 가져옴에서 가져온 일정입니다/)).toBeInTheDocument();
    expect(within(dialog).getByText(/가져온 원본에서 삭제된 일정입니다/)).toBeInTheDocument();
    expect(within(dialog).getByLabelText("제목")).toBeDisabled();
    expect(within(dialog).getByLabelText("운영 모드 영향")).toBeEnabled();
    expect(within(dialog).queryByRole("button", { name: "삭제" })).toBeNull();
    expect(within(dialog).getAllByRole("alert").length).toBeGreaterThan(0);
    unmount();
    const { unmount: u2 } = await renderRoute(<EventDialog event={events[2]} defaultDate="x" spaces={spaces} canWrite onClose={() => undefined} result={{ intent: "update", fieldErrors: { title: "Size" } }} />);
    const manual = await screen.findByRole("dialog", { name: "일정 수정" });
    expect(within(manual).getByRole("button", { name: "삭제" })).toBeInTheDocument();
    expect(within(manual).getByLabelText("시작 시각(선택)")).toHaveValue("10:00");
    expect(within(manual).getByText("Size")).toBeInTheDocument();
    u2();
    await renderRoute(<EventDialog event={events[0]} defaultDate="x" spaces={spaces} canWrite={false} onClose={() => undefined} />);
    const ro = await screen.findByRole("dialog", { name: "개천절" });
    expect(within(ro).queryByRole("button", { name: "저장" })).toBeNull();
    expect(within(ro).getByLabelText("운영 모드 영향")).toBeDisabled();
  });
});
