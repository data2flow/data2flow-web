/**
 * AI 화면 인수 시험: 스크립트 작성 도우미(UI-AIA-02, AIA-04.01~04.03), 도움말 대화(AIA-09.01), AI 설정·사용량·평가(UI-AIA-06, AIA-07.04~07.07),
 * MCP 연결 안내(UI-AIA-07, AIA-08).
 */
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderRoute } from "../../../../test/render";
import { EvalTab, ProviderBanner, SettingsTab, UsageTab, validateSettings } from "../components/ai-admin";
import { AiMarkdown } from "../components/ai-markdown";
import { HelpLauncher, HelpPanel } from "../components/help-chat";
import { McpConnect } from "../components/mcp-connect";
import { ScriptAssistPanel } from "../components/script-assist-panel";
import { SETTINGS, fakeAiApi, streamOf } from "./fake-ai-api";

const RECENT = [{ id: "5001", deviceName: "EM300-151606", topic: "application/1/device/x/event/up" }];
const fail = (status: number, code: string, errors?: { field: string; code: string; message: string }[]) => ({ ok: false as const, status, code, message: "", errors });

describe("AIA-04.01 UI-AIA-02 스크립트 작성 도우미", () => {
  it("TC-AIA-040 AT-AIA-04.1 초안 코드와 시험 결과를 함께 보이고 [편집기에 넣기]로 편집기 내용만 바꾼다", async () => {
    const api = fakeAiApi();
    const onInsert = vi.fn();
    await renderRoute(<ScriptAssistPanel scriptId="12" kind="TRANSFORM" recent={RECENT} api={api} onInsert={onInsert} />);
    await userEvent.click(await screen.findByRole("button", { name: "초안 만들기" }));
    expect(screen.getByText("요구사항을 1~1000자로 입력하세요")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("요구사항"), "온도에서 0.5를 빼고 이슬점 추가");
    await userEvent.click(screen.getByRole("button", { name: "초안 만들기" }));
    expect(api.scriptAssist).toHaveBeenCalledWith({ scriptId: "12", stage: "TRANSFORM", sample: { rawMessageId: "5001" }, requirement: "온도에서 0.5를 빼고 이슬점 추가" });
    const result = await screen.findByRole("region", { name: "AI 초안" });
    expect(within(result).getByLabelText("초안 코드")).toHaveTextContent("function transform(m){ return m; }");
    expect(within(result).getByText("시험 통과 0.4ms")).toBeInTheDocument();
    expect(within(result).getByText("시도 1/5")).toBeInTheDocument();
    expect(within(result).getByText("AI 작성")).toBeInTheDocument();
    expect(within(result).queryByRole("button", { name: /고쳐 달라고/ })).toBeNull();
    await userEvent.click(within(result).getByRole("button", { name: "편집기에 넣기" }));
    expect(onInsert).toHaveBeenCalledWith("function transform(m){ return m; }");
    expect(screen.getByText("편집기에 넣었습니다. 저장·배포는 검토 후 직접 하세요.")).toBeInTheDocument();
  });

  it("TC-AIA-041 시험이 실패하면 [오류로 고쳐 달라고 하기]가 이전 시도 ID로 다시 요청하고, 5회가 되면 직접 수정 안내", async () => {
    let attempt = 0;
    const scriptAssist = vi.fn(async () => {
      attempt += 1;
      return { ok: true as const, status: 200, data: { assistId: "55", attempt, code: `// v${attempt}`, test: { status: "FAIL" as const, input: { t: 1 }, output: null, error: { message: "dew_point is not defined" }, durationMs: 1 } } };
    });
    const api = fakeAiApi({ scriptAssist });
    await renderRoute(<ScriptAssistPanel scriptId="12" kind="DECODE" recent={RECENT} api={api} onInsert={vi.fn()} />);
    await userEvent.type(await screen.findByLabelText("요구사항"), "이슬점 추가");
    await userEvent.click(screen.getByRole("button", { name: "초안 만들기" }));
    expect(await screen.findByText("시험 실패 1ms")).toBeInTheDocument();
    expect(screen.getByText(/dew_point is not defined/)).toBeInTheDocument();
    for (let n = 1; n < 5; n += 1) {
      await userEvent.click(await screen.findByRole("button", { name: `오류로 고쳐 달라고 하기 (${n}/5)` }));
      await screen.findByText(`시도 ${n + 1}/5`);
    }
    expect(scriptAssist).toHaveBeenLastCalledWith(expect.objectContaining({ previousAttemptId: "55", stage: "DECODE" }));
    expect(screen.queryByRole("button", { name: /고쳐 달라고/ })).toBeNull();
    expect(screen.getByText("다시 요청 한도(5회)를 다 썼습니다. 직접 수정이 필요합니다.")).toBeInTheDocument();
  });

  it("정적 검사 문제는 행·열과 함께, 붙여넣은 샘플은 payload로 보낸다", async () => {
    const api = fakeAiApi({ scriptAssist: vi.fn(async () => ({ ok: true as const, status: 200, data: { assistId: "1", attempt: 1, code: "x", test: { status: "FAIL" as const, error: { severity: "ERROR", code: "SCRIPT_SYNTAX", message: "Unexpected token", line: 3, col: 7 } } } })) });
    await renderRoute(<ScriptAssistPanel scriptId="12" kind="DECODE" recent={[]} api={api} onInsert={vi.fn()} />);
    await userEvent.type(await screen.findByLabelText("요구사항"), "디코드");
    await userEvent.click(screen.getByRole("button", { name: "초안 만들기" }));
    expect(screen.getByText("원본 샘플을 고르거나 붙여넣으세요")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("샘플 payload(JSON 또는 글자)"), { target: { value: '{"b64":"AQI="}' } });
    await userEvent.click(screen.getByRole("button", { name: "초안 만들기" }));
    expect(api.scriptAssist).toHaveBeenCalledWith(expect.objectContaining({ sample: { payload: { b64: "AQI=" } } }));
    expect(await screen.findByText(/정적 검사 오류\(3행 7열\):/)).toBeInTheDocument();
    expect(screen.getByText(/Unexpected token/)).toBeInTheDocument();
  });

  it("AI 사용 불가(503)·꺼짐(409)·한도 초과 400 ATTEMPT_LIMIT 안내", async () => {
    const scriptAssist = vi.fn().mockResolvedValueOnce(fail(503, "AI_PROVIDER_UNAVAILABLE")).mockResolvedValueOnce(fail(409, "AI_DISABLED")).mockResolvedValueOnce(fail(400, "INVALID_REQUEST", [{ field: "previousAttemptId", code: "ATTEMPT_LIMIT", message: "" }]));
    await renderRoute(<ScriptAssistPanel scriptId="12" kind="DECODE" recent={RECENT} api={fakeAiApi({ scriptAssist })} onInsert={vi.fn()} />);
    await userEvent.type(await screen.findByLabelText("요구사항"), "x");
    await userEvent.click(screen.getByRole("button", { name: "초안 만들기" }));
    expect(await screen.findByText("AI 사용 불가")).toBeInTheDocument();
    expect(screen.getByText(/편집기와 시험 실행은 그대로 쓸 수 있습니다/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "초안 만들기" }));
    expect(await screen.findByText("이 조직에서 AI 기능이 꺼져 있습니다.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "초안 만들기" }));
    expect(await screen.findByText("다시 요청 한도(5회)를 다 썼습니다. 직접 수정이 필요합니다.")).toBeInTheDocument();
  });

  it("다른 오류는 일반 문구", async () => {
    await renderRoute(<ScriptAssistPanel scriptId="12" kind="DECODE" recent={RECENT} api={fakeAiApi({ scriptAssist: vi.fn(async () => fail(500, "INTERNAL_ERROR")) })} onInsert={vi.fn()} />);
    await userEvent.type(await screen.findByLabelText("요구사항"), "x");
    await userEvent.click(screen.getByRole("button", { name: "초안 만들기" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});

describe("AIA-09.01 도움말 대화(HELP)", () => {
  it("TC-AIA-023 질문 → 스트리밍 답과 근거 문서 카드, 화면 맥락(screenId)을 보낸다, Esc로 닫는다", async () => {
    const api = fakeAiApi();
    const onClose = vi.fn();
    await renderRoute(<HelpPanel api={api} onClose={onClose} screenId="/rules" />);
    const input = await screen.findByLabelText("질문");
    await userEvent.type(input, "규칙은 어떻게 만들어요?{Enter}");
    expect(api.ask).toHaveBeenCalledWith(null, { content: "규칙은 어떻게 만들어요?", mode: "HELP", context: { screenId: "/rules" } }, expect.any(Function), expect.any(AbortSignal));
    expect(await screen.findByText("규칙은 알람 > 규칙에서 만듭니다.")).toBeInTheDocument();
    const sources = screen.getByRole("list", { name: "근거 문서" });
    expect(within(sources).getByRole("link", { name: "열기" })).toHaveAttribute("href", "/rules/new");
    await userEvent.type(screen.getByLabelText("질문"), "더 알려 줘{Enter}");
    expect(api.ask).toHaveBeenLastCalledWith("8", expect.objectContaining({ content: "더 알려 줘" }), expect.any(Function), expect.any(AbortSignal));
    fireEvent.keyDown(screen.getByRole("dialog", { name: "도움말" }), { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("TC-AIA-023 503이면 '잠시 연결할 수 없습니다'와 [다시 시도], 429면 입력을 막는다, 2,000자 초과 안내", async () => {
    const ask = vi.fn().mockResolvedValueOnce(fail(503, "AI_PROVIDER_UNAVAILABLE")).mockResolvedValueOnce(fail(429, "AI_QUOTA_EXCEEDED"));
    await renderRoute(<HelpPanel api={fakeAiApi({ ask })} onClose={vi.fn()} screenId="/" />);
    await userEvent.click(await screen.findByRole("button", { name: "규칙은 어떻게 만들어요?" }));
    expect(await screen.findByText(/AI 서비스에 잠시 연결할 수 없습니다/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(await screen.findByText("오늘 AI 사용 한도를 다 썼습니다.")).toBeInTheDocument();
    expect(screen.getByLabelText("질문")).toBeDisabled();
    expect(ask).toHaveBeenCalledTimes(2);
  });

  it("2,000자를 넘으면 안내하고 보내지 않는다", async () => {
    const api = fakeAiApi();
    await renderRoute(<HelpPanel api={api} onClose={vi.fn()} screenId="/" />);
    fireEvent.change(await screen.findByLabelText("질문"), { target: { value: "가".repeat(2001) } });
    expect(screen.getByText("2000자 이내로 입력하세요")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "보내기" })).toBeDisabled();
  });

  it("TC-AIA-037 대화 목록에서 이전 대화를 열고, 한 건 삭제, [전체 삭제]는 확인 뒤 빈 목록", async () => {
    const api = fakeAiApi();
    await renderRoute(<HelpPanel api={api} onClose={vi.fn()} screenId="/" />);
    await userEvent.click(await screen.findByRole("button", { name: "대화 목록" }));
    await userEvent.click(await screen.findByRole("button", { name: "규칙 만들기" }));
    expect(await screen.findByText("규칙 화면에서 만듭니다")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "대화 목록" }));
    await userEvent.click(await screen.findByRole("button", { name: "전체 삭제" }));
    expect(screen.getByText("모든 대화를 지울까요?")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "예" }));
    expect(api.deleteAllConversations).toHaveBeenCalled();
    expect(await screen.findByText("대화가 없습니다.")).toBeInTheDocument();
  });

  it("한 건 삭제는 목록에서 빠진다, [새 대화]는 비운다", async () => {
    const api = fakeAiApi();
    await renderRoute(<HelpPanel api={api} onClose={vi.fn()} screenId="/" />);
    await userEvent.click(await screen.findByRole("button", { name: "대화 목록" }));
    await userEvent.click(await screen.findByRole("button", { name: "규칙 만들기 삭제" }));
    expect(api.deleteConversation).toHaveBeenCalledWith("7");
    expect(await screen.findByText("대화가 없습니다.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "새 대화" }));
    expect(screen.getByText(/data2flow 사용법이나 오류 뜻을 물어보세요/)).toBeInTheDocument();
  });

  it("TC-AIA-066 조직 AI가 꺼져 있으면(409) [도움말] 버튼을 숨기고, 켜져 있으면 열고 닫는다", async () => {
    const off = fakeAiApi({ conversations: vi.fn(async () => fail(409, "AI_DISABLED")) as never });
    const first = await renderRoute(<HelpLauncher api={off} />);
    await waitFor(() => expect(screen.queryByRole("button", { name: "도움말" })).toBeNull());
    first.unmount();
    await renderRoute(<HelpLauncher api={fakeAiApi()} />);
    await userEvent.click(await screen.findByRole("button", { name: "도움말" }));
    expect(screen.getByRole("dialog", { name: "도움말" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "닫기" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("[중지]는 진행 중인 요청을 끊는다", async () => {
    let signal: AbortSignal | undefined;
    const ask = vi.fn((_id: unknown, _b: unknown, _e: unknown, s?: AbortSignal) => {
      signal = s;
      return new Promise<{ ok: true }>((resolve) => s?.addEventListener("abort", () => resolve({ ok: true })));
    });
    await renderRoute(<HelpPanel api={fakeAiApi({ ask: ask as never })} onClose={vi.fn()} screenId="/" />);
    await userEvent.type(await screen.findByLabelText("질문"), "질문{Enter}");
    await userEvent.click(await screen.findByRole("button", { name: "중지" }));
    expect(signal?.aborted).toBe(true);
    await screen.findByRole("button", { name: "보내기" });
  });
});

describe("AIA-07 UI-AIA-06 AI 설정·사용량·평가", () => {
  it("TC-AIA-065 제공자 NONE이면 'AI 사용 불가' 띠, 준비 중·배포 불가 제공자 표시, 저장은 baseVersion과 함께", async () => {
    const api = fakeAiApi();
    await renderRoute(<SettingsTab initial={SETTINGS} api={api} timezone="Asia/Seoul" />);
    expect(await screen.findByText(/AI 제공자가 없습니다\(NONE, 키 없음\)/)).toBeInTheDocument();
    const provider = screen.getByLabelText("제공자") as HTMLSelectElement;
    expect([...provider.options].map((o) => [o.textContent, o.disabled])).toEqual([
      ["없음(NONE)", false],
      ["시험용 가짜(FAKE) (이 배포에서 못 고름)", true],
      ["Anthropic (준비 중)", false],
    ]);
    await userEvent.selectOptions(provider, "ANTHROPIC");
    expect(screen.getByText("제공자·모델을 바꾸면 최근 평가가 기준을 넘어야 저장됩니다.")).toBeInTheDocument();
    const days = screen.getByLabelText("기록 보관 기간(일)");
    await userEvent.clear(days);
    await userEvent.type(days, "400");
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(screen.getByText("7~365일 사이로 넣으세요")).toBeInTheDocument();
    expect(api.saveSettings).not.toHaveBeenCalled();
    await userEvent.clear(days);
    await userEvent.type(days, "30");
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(api.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ provider: "ANTHROPIC", logRetentionDays: 30, evalThreshold: 0.9, baseVersion: 4 }));
    expect(await screen.findByText("저장했습니다.")).toBeInTheDocument();
  });

  it("TC-AIA-072 AT-AIA-07.3 평가 기준 미달이면 409 AI_EVAL_BELOW_THRESHOLD 문구", async () => {
    const api = fakeAiApi({ saveSettings: vi.fn(async () => fail(409, "AI_EVAL_BELOW_THRESHOLD")) as never });
    await renderRoute(<SettingsTab initial={{ ...SETTINGS, provider: "FAKE" }} api={api} timezone="Asia/Seoul" />);
    expect(await screen.findByText(/시험용 가짜 제공자\(FAKE\)입니다/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(await screen.findByText(/최근 평가가 기준에 못 미쳐/)).toBeInTheDocument();
  });

  it("설정 검증 규칙과 꺼짐 띠", async () => {
    expect(validateSettings({ dailyRequestLimit: "-1", dailyTokenLimit: "", perUserDailyLimit: "1.5", logRetentionDays: "3", suggestionTtlMinutes: "200", evalThreshold: "120", model: " " })).toEqual({
      dailyRequestLimit: "INT",
      dailyTokenLimit: "INT",
      perUserDailyLimit: "INT",
      logRetentionDays: "RETENTION",
      suggestionTtlMinutes: "TTL",
      evalThreshold: "PERCENT",
      model: "REQUIRED",
    });
    await renderRoute(<ProviderBanner settings={{ enabled: false, provider: "ANTHROPIC" }} />);
    expect(await screen.findByText(/AI 기능이 꺼져 있습니다/)).toBeInTheDocument();
  });

  it("TC-AIA-071 AT-AIA-07.1 사용량: 기능별 묶음·비용·오늘 한도 대비 %(85%), 한도 도달 행 배지", async () => {
    const api = fakeAiApi();
    await renderRoute(<UsageTab api={api} now={() => Date.parse("2026-10-04T00:00:00Z")} />);
    expect(await screen.findByText("요청 85 / 100 (85%)")).toBeInTheDocument();
    expect(screen.getByRole("meter", { name: "요청" })).toHaveAttribute("aria-valuenow", "85");
    expect(api.usage).toHaveBeenCalledWith({ from: "2026-09-04T00:00:00.000Z", to: "2026-10-04T00:00:00.000Z", groupBy: "day" });
    await userEvent.selectOptions(screen.getByLabelText("묶음"), "feature");
    await waitFor(() => expect(api.usage).toHaveBeenLastCalledWith(expect.objectContaining({ groupBy: "feature" })));
    expect(await screen.findByRole("cell", { name: "분석 해설" })).toBeInTheDocument();
    expect(screen.getByText("$0.42")).toBeInTheDocument();
    expect(screen.getByText("한도 도달")).toBeInTheDocument();
    expect(screen.getByText(/요청 50 · 입력 토큰 35,000 · 출력 토큰 10,000 · 추정 비용 \$0.50/)).toBeInTheDocument();
  });

  it("사용량: AI가 꺼져 있으면 안내", async () => {
    await renderRoute(<UsageTab api={fakeAiApi({ usage: vi.fn(async () => fail(409, "AI_DISABLED")) as never })} />);
    expect(await screen.findByText("이 조직에서 AI 기능이 꺼져 있습니다.")).toBeInTheDocument();
  });

  it("TC-AIA-098 평가: 평가 셋 요약·최근 실행(정확도·수치 일치율·인젝션 방어율·통과), [평가 실행]은 진행 중 행을 앞에", async () => {
    const api = fakeAiApi();
    await renderRoute(<EvalTab api={api} model="claude-opus-5-5" timezone="Asia/Seoul" />);
    expect(await screen.findByText(/질문 2건 · commentary 1 · injection 1 · 인젝션 1건/)).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "96%" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "평가 실행" }));
    expect(api.startEval).toHaveBeenCalledWith({ model: "claude-opus-5-5" });
    expect(await screen.findByText("진행 중")).toBeInTheDocument();
  });
});

describe("AIA-08 UI-AIA-07 MCP 연결 안내", () => {
  const TOOLS = [
    { name: "query_telemetry", version: "v1", description: "시계열 조회", scope: "read:telemetry" },
    { name: "list_devices", version: "v1", description: "기기 목록", scope: "read:devices" },
  ];
  it("TC-AIA-087 AT-AIA-08.1 엔드포인트·클라이언트별 예시·도구 이름·버전·범위·설명, 범위로 거르기", async () => {
    await renderRoute(<McpConnect tools={TOOLS} toolsError={null} />);
    expect(await screen.findByText("https://data2flow-mcp.java21.net/mcp")).toBeInTheDocument();
    expect(screen.getByLabelText("클라이언트 설정 예시").textContent).toContain('"Authorization": "Bearer <토큰>"');
    await userEvent.click(screen.getByRole("tab", { name: "Claude Code" }));
    expect(screen.getByLabelText("클라이언트 설정 예시").textContent).toContain("claude mcp add --transport http data2flow");
    expect(screen.getByRole("cell", { name: "query_telemetry" })).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("범위"), "read:devices");
    expect(screen.queryByRole("cell", { name: "query_telemetry" })).toBeNull();
    expect(screen.getByRole("cell", { name: "list_devices" })).toBeInTheDocument();
  });

  it("AI가 꺼져 있으면 도구 목록 대신 안내", async () => {
    await renderRoute(<McpConnect tools={[]} toolsError={{ code: "AI_DISABLED" }} />);
    expect(await screen.findByText("이 조직에서 AI 기능이 꺼져 있어 MCP 도구를 쓸 수 없습니다.")).toBeInTheDocument();
  });
});

describe("AIA-07.02 AI 답변 그리기", () => {
  it("HTML은 글자로, 외부 링크는 글자만, 화면 주소는 링크, 목록·굵게·제목", async () => {
    const onCite = vi.fn();
    await renderRoute(<AiMarkdown text={"# 제목\n\n- **굵게** <img src=x onerror=alert(1)>\n- [외부](https://evil.example)\n\n[규칙](/rules) [근거](#result-table-a)"} onCite={onCite} />);
    expect(await screen.findByText("제목")).toBeInTheDocument();
    expect(screen.getByText("굵게").tagName).toBe("STRONG");
    expect(document.querySelector("img")).toBeNull();
    expect(screen.queryByRole("link", { name: "외부" })).toBeNull();
    expect(screen.getByText("외부")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "규칙" })).toHaveAttribute("href", "/rules");
    await act(async () => screen.getByRole("button", { name: "근거" }).click());
    expect(onCite).toHaveBeenCalledWith("result-table-a");
  });
});

describe("streamOf 도우미", () => {
  it("이벤트를 차례로 흘린다", async () => {
    const fn = streamOf([{ event: "delta", data: { text: "a" } }]);
    const seen: string[] = [];
    await fn({}, (e: { event: string }) => seen.push(e.event));
    expect(seen).toEqual(["delta"]);
  });
});
