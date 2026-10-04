/**
 * UI-RUL-06 알림 정책 폼(RUL-03.02·03.03) — TC-RUL-071: 심각도·공간·시간대 선택, 설정되지 않은 채널(CHANNEL_NOT_CONFIGURED)을 필드 오류로,
 * 수신자에 "현재 당직자" 선택 가능. 에스컬레이션은 최대 3단계(TC-RUL-077).
 */
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderRoute, meOf } from "../../../../test/render";
import { PolicyForm } from "../components/policy-form";
import { emptyPolicy } from "../model/policy";
import type { NotificationPolicy } from "../model/types";

const spaces = [{ id: "2", name: "본관", type: "BUILDING", children: [{ id: "31", name: "실습실", type: "ROOM" }] }];
const channelTypes = [
  { key: "TELEGRAM", displayName: "Telegram", available: true, configSchema: null },
  { key: "SMS", displayName: "SMS", available: false, configSchema: null },
];
const templates = [{ notificationTemplateId: "71", templateKey: "alarm.raised", channel: "TELEGRAM", locale: "ko", subject: null, body: "b", builtin: true, customized: false, version: 1 }];

function hidden(name: string) {
  return [...document.querySelectorAll<HTMLInputElement>(`input[type="hidden"][name="${name}"]`)].map((i) => i.value);
}

async function render(policy: NotificationPolicy = emptyPolicy(), extra: Partial<Parameters<typeof PolicyForm>[0]> = {}) {
  await renderRoute(
    <form>
      <PolicyForm policy={policy} spaces={spaces} rules={[{ id: "r-1", name: "실습실 CO2 높음" }]} templates={templates} channelTypes={channelTypes} users={[]} usersAvailable={false} {...extra} />
    </form>,
    { session: meOf("OPERATOR") },
  );
  await screen.findByLabelText("이름");
}

describe("TC-RUL-071 알림 정책 폼", () => {
  it("기본값: 현재 당직자 수신자, 웹 채널, 재알림 30분, 묶기 끔, 해제 알림 켬. 등록된 채널만 고를 수 있다", async () => {
    await render();
    expect(hidden("recipient")).toEqual(["ON_CALL:"]);
    expect(screen.getByLabelText("웹")).toBeChecked();
    expect(screen.getByLabelText("텔레그램")).not.toBeChecked();
    expect(screen.queryByLabelText("SMS")).not.toBeInTheDocument();
    expect(screen.getByLabelText("재알림 간격")).toHaveValue("30");
    expect(screen.getByLabelText("묶기")).toHaveValue("0");
    expect(screen.getByLabelText("해제 알림 보냄")).toBeChecked();
    // 공간을 고르기 전에는 하위 포함을 바꿀 수 없다
    expect(screen.getByLabelText("하위 공간 포함")).toBeDisabled();
    await userEvent.selectOptions(screen.getByLabelText("공간"), "31");
    expect(screen.getByLabelText("하위 공간 포함")).toBeEnabled();
  });

  it("설정되지 않은 채널 오류를 채널 필드에, 텔레그램을 고르면 채널별 템플릿 선택", async () => {
    await render(emptyPolicy(), { errors: { channels: "channelNotConfigured", name: "nameRequired" } });
    expect(screen.getByText("설정되지 않은 채널입니다. 관리 > 알림 채널에서 먼저 등록하세요.")).toBeInTheDocument();
    expect(screen.getByText("이름을 입력하세요.")).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText("텔레그램"));
    const template = screen.getByLabelText("텔레그램 템플릿");
    expect(within(template).getByRole("option", { name: "alarm.raised (ko)" })).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText("텔레그램"));
    expect(screen.queryByLabelText("텔레그램 템플릿")).not.toBeInTheDocument();
  });

  it("수신자: 역할·사용자(ID 입력)·현재 당직자 추가, 중복 무시, 빼기", async () => {
    await render();
    await userEvent.selectOptions(screen.getAllByLabelText("대상")[0], "OPERATOR");
    await userEvent.click(screen.getAllByRole("button", { name: "수신자 추가" })[0]);
    expect(screen.getByText("운영자 (역할)")).toBeInTheDocument();
    await userEvent.selectOptions(screen.getAllByLabelText("종류")[0], "USER");
    await userEvent.type(screen.getAllByPlaceholderText("사용자 ID")[0], "7");
    await userEvent.click(screen.getAllByRole("button", { name: "수신자 추가" })[0]);
    await userEvent.selectOptions(screen.getAllByLabelText("종류")[0], "ON_CALL");
    await userEvent.click(screen.getAllByRole("button", { name: "수신자 추가" })[0]);
    expect(hidden("recipient")).toEqual(["ON_CALL:", "ROLE:OPERATOR", "USER:7"]);
    await userEvent.click(screen.getByRole("button", { name: "현재 당직자 빼기" }));
    expect(hidden("recipient")).toEqual(["ROLE:OPERATOR", "USER:7"]);
    expect(screen.getByText("사용자 7")).toBeInTheDocument();
  });

  it("관리자는 회원 목록에서 사용자를 고른다", async () => {
    await render(emptyPolicy(), { users: [{ id: "1", name: "홍길동" }], usersAvailable: true });
    await userEvent.selectOptions(screen.getAllByLabelText("종류")[0], "USER");
    await userEvent.selectOptions(screen.getAllByLabelText("대상")[0], "1");
    await userEvent.click(screen.getAllByRole("button", { name: "수신자 추가" })[0]);
    expect(hidden("recipient")).toContain("USER:1");
    expect(screen.getByRole("button", { name: "홍길동 빼기" })).toBeInTheDocument();
  });

  it("TC-RUL-077 에스컬레이션 단계는 최대 3개, 단계 JSON에 대기·수신자", async () => {
    await render();
    const add = () => userEvent.click(screen.getByRole("button", { name: "단계 추가" }));
    await add();
    await add();
    await add();
    expect(screen.queryByRole("button", { name: "단계 추가" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "3단계 빼기" }));
    await userEvent.click(screen.getByRole("button", { name: "2단계 빼기" }));
    const step = screen.getByTestId("step-1");
    await userEvent.clear(within(step).getByLabelText("대기(분)"));
    await userEvent.type(within(step).getByLabelText("대기(분)"), "15");
    await userEvent.selectOptions(within(step).getByLabelText("종류"), "ON_CALL");
    await userEvent.click(within(step).getByRole("button", { name: "수신자 추가" }));
    expect(JSON.parse(hidden("steps")[0])).toEqual([{ waitMinutes: 15, recipients: ["ON_CALL:"] }]);
  });

  it("시간대 지정: 요일(평일 기본)과 시작·끝, 규칙 목록이 없으면 안내와 기존 규칙 유지", async () => {
    await render({ ...emptyPolicy(), ruleIds: ["r-9"], timeWindow: { days: [6], from: "22:00", to: "07:00" } }, { rules: null });
    expect(screen.getByLabelText("토")).toBeChecked();
    expect(screen.getByLabelText("월")).not.toBeChecked();
    expect(screen.getByLabelText("시작")).toHaveValue("22:00");
    expect(screen.getByText(/규칙 목록을 불러오지 못했습니다/)).toBeInTheDocument();
    expect(hidden("ruleIds")).toEqual(["r-9"]);
    await userEvent.click(screen.getByLabelText("항상"));
    expect(screen.queryByLabelText("토")).not.toBeInTheDocument();
    await userEvent.click(screen.getByLabelText("요일·시간 지정"));
    expect(screen.getByLabelText("토")).toBeChecked();
  });

  it("읽기 전용이면 수신자·단계 편집 버튼이 없다", async () => {
    await render({ ...emptyPolicy(), renotifyMinutes: 90, aggregateWindowSec: 90, steps: [{ stepNo: 1, waitMinutes: 10, recipients: [{ type: "ROLE", id: "ADMIN" }] }] }, { readOnly: true });
    expect(screen.queryByRole("button", { name: "수신자 추가" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "단계 추가" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("재알림 간격")).toHaveValue("90");
    expect(screen.getByText("관리자 (역할)")).toBeInTheDocument();
  });
});
