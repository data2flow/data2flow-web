/**
 * TC-RUL-044 AT-RUL-06.3 VIEWER는 확인 버튼이 없다(API 403은 SSR 통합 test/alarms.test.ts), TC-RUL-054 AT-RUL-06.5 담당자 지정과 조치 기록이
 * 이력 타임라인에 순서대로 보인다. 처리 결과·오류 문구, 메모 길이 오류.
 */
import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { meOf, renderRoute } from "../../../../test/render";
import { AlarmDetailView } from "../components/alarm-detail-view";
import { detail } from "./fixtures";

const NOW = Date.parse("2026-10-03T01:14:00Z");

describe("TC-RUL-044 TC-RUL-054 알람 처리", () => {
  it("VIEWER: 확인·무음·담당자·메모·해제가 없다", async () => {
    await renderRoute(<AlarmDetailView detail={detail()} deliveries={null} series={[]} users={[]} canHandle={false} timezone="Asia/Seoul" nowMs={NOW} />, { session: meOf("VIEWER") });
    expect(await screen.findByText("MAJOR 중요")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "확인" })).toBeNull();
    expect(screen.queryByRole("button", { name: "무음" })).toBeNull();
    expect(screen.queryByRole("button", { name: "담당자 지정" })).toBeNull();
    expect(screen.queryByLabelText("메모")).toBeNull();
    expect(screen.queryByRole("button", { name: "해제" })).toBeNull();
  });

  it("OPERATOR: 확인·무음(30분~24시간)·담당자(나)·메모·조치 종류·해제, 담당자 지정과 조치 기록이 타임라인에 순서대로", async () => {
    const data = detail({ assignee: { userId: "7", name: "김운영" } });
    data.events = [
      ...data.events,
      { type: "ASSIGNED", at: "2026-10-03T01:10:00Z", actor: { name: "김운영" }, data: { assignee: { userId: "7", name: "김운영" } } },
      { type: "ACTION", at: "2026-10-03T01:12:00Z", actor: { name: "김운영" }, data: { actionType: "ONSITE", text: "환기 장치 점검 요청함" } },
      { type: "NOTE", at: "2026-10-03T01:11:00Z", data: { text: "메모 하나" } },
      { type: "ESCALATED", at: "2026-10-03T01:13:00Z", data: { stepNo: 2 } },
      { type: "CLEARED", at: "2026-10-03T01:14:00Z", data: { reason: "AUTO" } },
      { type: "FLAPPING_ON", at: "2026-10-03T01:14:30Z" },
    ];
    await renderRoute(<AlarmDetailView detail={data} deliveries={null} series={[]} users={[{ userId: "7", name: "김운영" }, { userId: "1", name: "홍길동" }]} meId="7" canHandle timezone="Asia/Seoul" nowMs={NOW} result={{ intent: "assign", ok: true }} />, { session: meOf("OPERATOR") });
    expect(await screen.findByRole("button", { name: "확인" })).toBeInTheDocument();
    expect(screen.getByText("담당자를 지정했습니다")).toBeInTheDocument();
    expect(within(screen.getByLabelText("무음", { selector: "select" })).getAllByRole("option").map((o) => o.textContent)).toEqual(["30분", "1시간", "4시간", "1일"]);
    expect(screen.getByLabelText("담당자", { selector: "select" })).toHaveValue("7");
    expect(screen.getByRole("option", { name: "김운영 (나)" })).toBeInTheDocument();
    expect(within(screen.getByLabelText("조치 종류")).getAllByRole("option")).toHaveLength(5);
    expect(screen.getByRole("button", { name: "해제" })).toBeInTheDocument();
    const items = within(screen.getByRole("list", { name: "타임라인" })).getAllByRole("listitem").map((li) => li.textContent ?? "");
    const at = (needle: string) => items.findIndex((text) => text.includes(needle));
    expect(at("담당자 지정→ 김운영")).toBeLessThan(at("메모 하나"));
    expect(at("메모 하나")).toBeLessThan(at("현장 확인 환기 장치 점검 요청함"));
    expect(items[at("에스컬레이션")]).toContain("2단계");
    expect(items[at("해제")]).toContain("조건 해소");
    expect(at("플래핑 시작")).toBe(items.length - 1);
  });

  it("이미 확인한 알람은 [확인] 없음, 오류·메모 길이 문구", async () => {
    await renderRoute(<AlarmDetailView detail={detail({ status: "ACKNOWLEDGED", ackedAt: "2026-10-03T01:06:00Z", ackedBy: { userId: "1", name: "홍길동" } })} deliveries={null} series={[]} users={[]} canHandle timezone="Asia/Seoul" nowMs={NOW} result={{ intent: "note", error: { code: "ALARM_STATE_CONFLICT" }, fieldErrors: { text: "alarms.v.noteLength" } }} />, { session: meOf("OPERATOR") });
    expect(await screen.findByText("이미 처리된 알람입니다")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "확인" })).toBeNull();
    expect(screen.getByText("메모는 1~2000자입니다")).toBeInTheDocument();
    expect(screen.getByText(/홍길동/)).toBeInTheDocument();
  });
});
