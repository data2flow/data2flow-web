/**
 * 알림·운영 화면 부품: 템플릿 편집기(UI-RUL-07, TC-RUL-091), 메신저 계정 연결(UI-RUL-11, RUL-05.02 — 일회용 코드 10분),
 * 당직 달력·근무표 편집(UI-RUL-09), 채널 유형·스키마 폼(UI-OPS-06, TC-OPS-143), 공용 부품.
 */
import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { meOf, renderRoute } from "../../../../test/render";
import type { NotifyApi } from "../api";
import { ChannelFields, ChannelTypeList, SchemaFieldInput } from "../components/channel-form";
import { NotifyTabs, ResultAlert, SeverityBadge, useRecipientLabel } from "../components/common";
import { MessengerLinkPanel } from "../components/messenger-link";
import { ShiftEditor, WeekGrid } from "../components/on-call";
import { TemplateEditor } from "../components/template-editor";
import { DEFAULT_VARIABLES } from "../model/template";
import type { Recipient } from "../model/types";

const session = { session: meOf("OPERATOR") };
const ok = <T,>(data: T) => ({ ok: true as const, status: 200, data });
const fail = (code: string) => ({ ok: false as const, status: 409, code, message: "" });

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("UI-RUL-07 템플릿 편집기", () => {
  const template = { notificationTemplateId: "71", templateKey: "alarm.raised", channel: "TELEGRAM", locale: "ko", subject: null, body: "{{alarm.title}}", builtin: true, version: 1 };
  const variables = DEFAULT_VARIABLES.map((name) => ({ name }));

  it("TC-RUL-091 AT-RUL-08.3 입력하는 동안 알 수 없는 변수를 경고하고, 글자 수를 센다", async () => {
    await renderRoute(<TemplateEditor template={template} variables={variables} maxLength={20} alarms={[]} api={{ previewTemplate: vi.fn() }} />, session);
    const body = await screen.findByLabelText("본문");
    await userEvent.type(body, " {{{{foo}}");
    expect(screen.getByText("알 수 없는 변수: foo")).toBeInTheDocument();
    expect(screen.getByText(`${(body as HTMLTextAreaElement).value.length} / 20자`)).toHaveClass("text-bad");
    expect(screen.getByText("미리 볼 최근 알람이 없습니다")).toBeInTheDocument();
  });

  it("변수 버튼은 커서 위치에 넣고, 최근 알람으로 미리 본다(실패는 오류 문구)", async () => {
    const previewTemplate = vi.fn().mockResolvedValueOnce(ok({ subject: "제목", body: "MAJOR 실습실 CO2 높음" })).mockResolvedValueOnce(fail("RESOURCE_NOT_FOUND"));
    await renderRoute(<TemplateEditor template={template} variables={variables} maxLength={4096} alarms={[{ id: "501", title: "실습실 CO2 높음" }]} api={{ previewTemplate }} error="본문을 입력하세요." />, session);
    const body = (await screen.findByLabelText("본문")) as HTMLTextAreaElement;
    body.setSelectionRange(0, 0);
    await userEvent.click(screen.getByRole("button", { name: "alarm.severity 넣기" }));
    expect(body.value).toBe("{{alarm.severity}}{{alarm.title}}");
    expect(screen.getByText("본문을 입력하세요.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "미리 보기" }));
    expect(previewTemplate).toHaveBeenCalledWith("71", "501");
    expect(await screen.findByTestId("template-preview")).toHaveTextContent("제목MAJOR 실습실 CO2 높음");
    await userEvent.click(screen.getByRole("button", { name: "미리 보기" }));
    expect(await screen.findByText("찾을 수 없습니다.")).toBeInTheDocument();
  });
});

describe("UI-RUL-11 메신저 계정 연결(RUL-05.02)", () => {
  const api = (overrides: Partial<NotifyApi> = {}) => ({
    startLink: vi.fn().mockResolvedValue(ok({ code: "K7Q2-9XPA", deepLink: "https://t.me/data2flow_bot?start=K7Q2-9XPA", expiresAt: "2026-10-04T00:10:00Z" })),
    unlink: vi.fn().mockResolvedValue({ ok: true, status: 204, data: undefined }),
    links: vi.fn().mockResolvedValue(ok([{ channel: "TELEGRAM", linkedAt: "2026-10-04T00:05:00Z" }])),
    ...overrides,
  });

  it("일회용 코드와 딥링크, 남은 시간이 1초마다 줄고 10분 뒤 만료 → 다시 받기", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date("2026-10-04T00:00:00Z") });
    const fake = api();
    await renderRoute(<MessengerLinkPanel channel="TELEGRAM" initial={null} api={fake} timezone="Asia/Seoul" now={() => Date.now()} />, session);
    expect(await screen.findByText("연결되지 않음")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "연결하기" }));
    expect(fake.startLink).toHaveBeenCalledWith("TELEGRAM");
    expect(await screen.findByText("K7Q2-9XPA")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "텔레그램에서 열기" })).toHaveAttribute("href", "https://t.me/data2flow_bot?start=K7Q2-9XPA");
    expect(screen.getByText("10:00 뒤 만료")).toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(61_000);
    });
    expect(screen.getByText(/8:5\d 뒤 만료/)).toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(9 * 60_000);
    });
    expect(screen.getByText("코드가 만료되었습니다. 다시 받으세요.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "코드 다시 받기" })).toBeInTheDocument();
  });

  it("[연결 확인]으로 연결되면 상태가 바뀌고, [연결 해제]는 확인 후 DELETE", async () => {
    const fake = api();
    await renderRoute(<MessengerLinkPanel channel="TELEGRAM" initial={null} api={fake} timezone="Asia/Seoul" now={() => Date.parse("2026-10-04T00:00:00Z")} />, session);
    await userEvent.click(await screen.findByRole("button", { name: "연결하기" }));
    await userEvent.click(await screen.findByRole("button", { name: "연결 확인" }));
    expect(await screen.findByText("연결됨")).toBeInTheDocument();
    expect(screen.queryByText("K7Q2-9XPA")).not.toBeInTheDocument();
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    await userEvent.click(screen.getByRole("button", { name: "연결 해제" }));
    expect(fake.unlink).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "연결 해제" }));
    expect(fake.unlink).toHaveBeenCalledWith("TELEGRAM");
    expect(await screen.findByText("연결을 해제했습니다.")).toBeInTheDocument();
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it("상태를 모르면 경고 배지, 시작·해제 실패는 오류, 텔레그램 밖 딥링크는 링크로 보이지 않는다", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const fake = api({ startLink: vi.fn().mockResolvedValueOnce(fail("RATE_LIMITED")).mockResolvedValueOnce(ok({ code: "C", deepLink: "https://evil.example/x", expiresAt: "2026-10-04T00:10:00Z" })), unlink: vi.fn().mockResolvedValue(fail("SERVICE_UNAVAILABLE")), links: vi.fn().mockResolvedValue(fail("RESOURCE_NOT_FOUND")) });
    const { unmount } = await renderRoute(<MessengerLinkPanel channel="TELEGRAM" initial={undefined} api={fake} timezone="Asia/Seoul" now={() => Date.parse("2026-10-04T00:00:00Z")} />, session);
    expect(await screen.findByText("연결 상태를 확인하지 못했습니다")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "연결하기" }));
    expect(fake.startLink).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "연결하기" }));
    expect(await screen.findByText("C")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "텔레그램에서 열기" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "연결 확인" }));
    unmount();
    await renderRoute(<MessengerLinkPanel channel="TELEGRAM" initial={{ channel: "TELEGRAM", linkedAt: "2026-10-03T01:00:00Z" }} api={fake} timezone="Asia/Seoul" />, session);
    expect(await screen.findByText(/에 연결/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "연결 해제" }));
    expect(await screen.findByText("연결됨")).toBeInTheDocument();
  });
});

describe("UI-RUL-09 당직 달력·근무표 편집", () => {
  it("시간대 행 × 요일 열, 빈 근무표 안내", async () => {
    const { unmount } = await renderRoute(
      <WeekGrid
        shifts={[
          { dayOfWeek: 1, from: "09:00", to: "18:00", userId: "7", userName: "김운영" },
          { dayOfWeek: 2, from: "09:00", to: "18:00", userId: "8" },
        ]}
        users={[{ id: "8", name: "이통합" }]}
      />,
      session,
    );
    expect(await screen.findByText("09:00–18:00")).toBeInTheDocument();
    expect(screen.getByText("김운영")).toBeInTheDocument();
    expect(screen.getByText("이통합")).toBeInTheDocument();
    unmount();
    await renderRoute(<WeekGrid shifts={[]} users={[]} />, session);
    expect(await screen.findByText("근무표가 없습니다")).toBeInTheDocument();
  });

  it("근무 추가·수정·빼기가 숨은 입력 shifts JSON에 반영된다", async () => {
    const { container, unmount } = await renderRoute(<ShiftEditor initial={[{ dayOfWeek: 1, from: "09:00", to: "18:00", userId: "7", userName: "김운영" }]} users={[]} usersAvailable={false} />, session);
    const value = () => JSON.parse((container.querySelector('input[name="shifts"]') as HTMLInputElement).value);
    await userEvent.click(await screen.findByRole("button", { name: "근무 추가" }));
    const days = screen.getAllByLabelText("요일");
    await userEvent.selectOptions(days[1], "3");
    const users = screen.getAllByLabelText("담당자");
    await userEvent.type(users[1], "8");
    expect(value()).toEqual([
      { dayOfWeek: 1, from: "09:00", to: "18:00", userId: "7" },
      { dayOfWeek: 3, from: "09:00", to: "18:00", userId: "8" },
    ]);
    await userEvent.click(screen.getAllByRole("button", { name: "근무 빼기" })[0]);
    expect(value()).toHaveLength(1);
    unmount();
    await renderRoute(<ShiftEditor initial={[{ dayOfWeek: 1, from: "09:00", to: "18:00", userId: "" }]} users={[{ id: "1", name: "홍길동" }]} usersAvailable />, session);
    await userEvent.selectOptions(await screen.findByLabelText("담당자"), "1");
    const from = screen.getByLabelText("시작");
    await userEvent.clear(from);
    await userEvent.type(from, "10:00");
    expect(from).toHaveValue("10:00");
  });
});

describe("UI-OPS-06 채널 유형·설정 스키마 폼(OPS-06.06)", () => {
  it("TC-OPS-143 AT-OPS-12.5 Telegram만 활성 링크, 나머지는 준비 중 비활성", async () => {
    await renderRoute(
      <ChannelTypeList
        types={[
          { key: "TELEGRAM", displayName: "Telegram", available: true, configSchema: null },
          { key: "EMAIL", displayName: "Email", available: false, configSchema: null },
          { key: "SMS", displayName: "SMS", available: false, configSchema: null },
        ]}
      />,
      session,
    );
    expect(await screen.findByRole("link", { name: "Telegram" })).toHaveAttribute("href", "/admin/channels?new=TELEGRAM");
    expect(screen.queryByRole("link", { name: /Email/ })).not.toBeInTheDocument();
    expect(screen.getAllByText("준비 중(SPI로 추가 예정)")).toHaveLength(2);
  });

  it("편집 폼이 설정 스키마로 생성되고, 저장된 비밀값은 ●●●● 표시만", async () => {
    const schema = {
      type: "object",
      required: ["chatIds"],
      properties: {
        chatIds: { type: "array", items: { type: "integer" }, title: "chat_id" },
        format: { enum: ["MARKDOWN_V2", "HTML"] },
        silent: { type: "boolean" },
        retries: { type: "integer", description: "최대 재시도" },
        botToken: { type: "string", writeOnly: true },
      },
    };
    await renderRoute(
      <form>
        <ChannelFields
          type={{ key: "TELEGRAM", displayName: "Telegram", available: true, configSchema: schema, capabilities: { defaultRatePerMin: 25 } }}
          channel={{ id: "51", name: "시설팀", type: "TELEGRAM", config: { chatIds: [-100, 42], format: "HTML", silent: true }, secretConfigured: true, rateLimitPerMin: 20, digestWindowSec: 60, enabled: true, status: "OK", version: 1 }}
          problems={{ chatIds: "tooManyItems", name: "nameRequired" }}
        />
      </form>,
      session,
    );
    expect(await screen.findByLabelText(/chat_id/)).toHaveValue("-100\n42");
    expect(screen.getByText("항목이 너무 많습니다(최대 20개).")).toBeInTheDocument();
    expect(screen.getByText("이름을 입력하세요.")).toBeInTheDocument();
    expect(screen.getByLabelText("format")).toHaveValue("HTML");
    expect(screen.getByLabelText("silent")).toBeChecked();
    expect(screen.getByText("최대 재시도")).toBeInTheDocument();
    expect(screen.getByLabelText("봇 토큰")).toHaveAttribute("placeholder", "●●●● 저장됨 — 바꿀 때만 입력");
    expect(screen.getByLabelText("봇 토큰")).toHaveValue("");
  });

  it("새 채널은 유형의 기본 분당 한도, 스키마 없는 텔레그램은 기본 필드, 선택 열거·실수 입력", async () => {
    const { unmount } = await renderRoute(
      <form>
        <ChannelFields type={{ key: "TELEGRAM", displayName: "Telegram", available: true, configSchema: null, capabilities: { defaultRatePerMin: 25 } }} />
      </form>,
      session,
    );
    expect(await screen.findByLabelText("분당 한도")).toHaveValue(25);
    expect(screen.getByLabelText("웹훅 시크릿 토큰")).toHaveAttribute("placeholder", "새로 입력");
    unmount();
    await renderRoute(
      <form>
        <SchemaFieldInput field={{ name: "mode", kind: "enum", required: false, enumValues: ["A"] }} hasSecret={false} />
        <SchemaFieldInput field={{ name: "ratio", kind: "number", required: true, title: "비율" }} config={{ ratio: 0.5 }} hasSecret={false} problem="range" />
      </form>,
      session,
    );
    expect(await screen.findByLabelText("비율")).toHaveValue(0.5);
    expect(screen.getByText("허용 범위를 벗어났습니다.")).toBeInTheDocument();
    expect(screen.getAllByRole("option")).toHaveLength(2);
  });
});

describe("공용 부품", () => {
  function Labels({ recipients }: { recipients: Recipient[] }) {
    const label = useRecipientLabel([{ id: "1", name: "홍길동" }]);
    return (
      <ul>
        {recipients.map((r) => (
          <li key={`${r.type}${r.id}`}>{label(r)}</li>
        ))}
      </ul>
    );
  }

  it("알림 설정 탭, 심각도 배지, 수신자 이름, 결과 문구", async () => {
    await renderRoute(
      <>
        <NotifyTabs current="templates" />
        <SeverityBadge severity="CRITICAL" />
        <Labels recipients={[{ type: "USER", id: "1" }, { type: "USER", id: "2", name: "서버 이름" }, { type: "USER", id: "3" }, { type: "ROLE", id: "OPERATOR" }, { type: "CHANNEL_DEFAULT" }]} />
        <ResultAlert result={{ done: "notify.policy.saved" }} />
        <ResultAlert result={{ error: { code: "POLICY_IN_USE" } }} />
        <ResultAlert result={{}} />
        <ResultAlert />
      </>,
      session,
    );
    expect(await screen.findByRole("link", { name: "알림 템플릿" })).toHaveAttribute("href", "/notifications/templates");
    expect(screen.getByRole("link", { name: "무음 일정" })).toHaveAttribute("href", "/notifications/silences");
    expect(screen.getByText("심각")).toBeInTheDocument();
    expect(screen.getByText("홍길동")).toBeInTheDocument();
    expect(screen.getByText("서버 이름")).toBeInTheDocument();
    expect(screen.getByText("사용자 3")).toBeInTheDocument();
    expect(screen.getByText("운영자 (역할)")).toBeInTheDocument();
    expect(screen.getByText("채널 기본 대상")).toBeInTheDocument();
    expect(screen.getByText("저장했습니다.")).toBeInTheDocument();
    expect(screen.getByText("다른 곳에서 쓰는 정책이라 지울 수 없습니다.")).toBeInTheDocument();
  });
});
