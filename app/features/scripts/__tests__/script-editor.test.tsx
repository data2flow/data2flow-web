/**
 * UI-SCR-02 스크립트 편집기(SCR-03.01·03.02·04.05) 화면 부품. Monaco는 textarea 대역(frontend.md §3.4).
 */
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { meOf, renderRoute } from "../../../../test/render";
import type { EditorApi } from "~/components/code-editor";
import type { ScriptApi, ScriptDetail } from "../api";
import { CreateScriptDialog } from "../create-script-dialog";
import { ScriptEditor } from "../script-editor";
import { ScriptVersions } from "../script-versions";

const CODE = 'function transform(msg, ctx) {\n  // 보정\n  const fs = require("fs");\n  return msg;\n}\n';

function detail(overrides: Partial<ScriptDetail> = {}): ScriptDetail {
  return {
    id: "501",
    name: "온도 보정 오프셋",
    kind: "TRANSFORM",
    status: "ENABLED",
    activeVersion: { versionId: "804", versionNo: 4, code: "function transform(msg){return msg}" },
    draft: { versionId: "805", versionNo: 5, code: CODE, staticCheck: { ok: false, problems: [{ line: 3, col: 9, severity: "ERROR", code: "SCRIPT_FORBIDDEN_API", message: "금지된 API: require" }] } },
    versions: [
      { versionId: "805", versionNo: 5, status: "DRAFT" },
      { versionId: "804", versionNo: 4, status: "ACTIVE", deployMemo: "오프셋 분리", deployedBy: "이통합", deployedAt: "2026-10-02T08:40:00Z", forced: true },
    ],
    bindings: [{ targetType: "MODEL", targetId: "11", name: "EM300-TH" }],
    usage: { bindings: [{ processed24h: 17280 }] },
    config: { tempOffset: -0.5 },
    ...overrides,
  };
}

function fakeApi(overrides: Partial<ScriptApi> = {}): ScriptApi {
  return {
    check: vi.fn(async () => ({ ok: true as const, status: 200, data: { ok: true, problems: [] } })),
    save: vi.fn(async (_id, body) => ({ ok: true as const, status: 200, data: { versionId: "806", versionNo: body.baseVersionNo + 1, staticCheck: { ok: true, problems: [] } } })),
    detail: vi.fn(async () => ({ ok: true as const, status: 200, data: detail({ draft: { versionId: "806", versionNo: 6, code: "function transform(msg){ /* 다른 사람 */ return msg }", staticCheck: { ok: true, problems: [] } } }) })),
    deploy: vi.fn(async () => ({ ok: true as const, status: 200, data: { activeVersionId: "805", applied: { reported: 2, total: 2 } } })),
    testRun: vi.fn(async () => ({
      ok: true as const,
      status: 200,
      data: { ok: true, output: { metrics: [{ key: "temperature", value: 22.8 }] }, diff: { added: [{ key: "dew_point", value: 9.4 }], removed: [], changed: [{ key: "temperature", from: 22.3, to: 22.8 }] }, logs: [{ message: "offset" }, { message: "offset" }, { message: "offset" }], durationMs: 0.4, outputBytes: 1229 },
    })),
    version: vi.fn(async () => ({ ok: true as const, status: 200, data: { versionNo: 4, code: "function transform(msg){return msg} // v4" } })),
    ...overrides,
  };
}

const textarea = async () => (await screen.findByLabelText("코드")) as HTMLTextAreaElement;
const recent = [{ id: "8812345", receivedAt: "2026-10-03T23:58:00Z", topic: "application/1/device/24e124136d151606/event/up", deviceName: "EM300-TH-151606", status: "OK" }];

function renderEditor(api: ScriptApi, props: Partial<Parameters<typeof ScriptEditor>[0]> = {}) {
  return renderRoute(<ScriptEditor script={detail()} canWrite canForce={false} recent={recent} recentFailed={false} timezone="Asia/Seoul" api={api} editorFactory={async () => null} {...props} />, { session: meOf("INTEGRATOR") });
}

afterEach(() => vi.useRealTimers());

describe("SCR-04.05 TC-SCR-040 정적 검사 표시와 배포 가능 여부", () => {
  it("AT-SCR-01.2 문제 목록에 '금지된 API: require (3:9)', 오류가 있으면 [배포] 비활성", async () => {
    await renderEditor(fakeApi());
    expect(await screen.findByText("금지된 API: require (3:9)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "배포" })).toBeDisabled();
    expect(screen.getByText("오류가 있어 배포할 수 없습니다. 경고만 있으면 배포할 수 있습니다.")).toBeInTheDocument();
    expect(screen.getByText("오류 1 · 경고 0")).toBeInTheDocument();
  });

  it("AT-SCR-01.3 입력을 멈추고 500ms 뒤 서버 검사, 경고만 남으면 [배포] 가능, 필수 함수가 없으면 즉시 오류", async () => {
    const api = fakeApi({ check: vi.fn(async () => ({ ok: true as const, status: 200, data: { ok: true, problems: [{ line: 2, col: 3, severity: "WARNING" as const, message: "debugger 문은 무시됩니다" }] } })) });
    await renderEditor(api);
    const box = await textarea();
    vi.useFakeTimers();
    fireEvent.change(box, { target: { value: "function decode(msg) {}" } });
    expect(screen.getByText("transform(msg, ctx) 함수가 필요합니다 (1:1)")).toBeInTheDocument();
    fireEvent.change(box, { target: { value: "function transform(msg, ctx) {\n  debugger;\n  return msg;\n}" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(499);
    });
    expect(api.check).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(api.check).toHaveBeenCalledExactlyOnceWith("TRANSFORM", "function transform(msg, ctx) {\n  debugger;\n  return msg;\n}");
    expect(screen.getByText("debugger 문은 무시됩니다 (2:3)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "배포" })).toBeEnabled();
    expect(screen.getByLabelText("저장하지 않은 변경 있음")).toBeInTheDocument();
  });

  it("문제를 누르면 편집기의 그 줄·열로 이동하고, 문제는 편집기 표시(markers)로도 넘긴다", async () => {
    const editor: EditorApi = { setValue: vi.fn(), getValue: vi.fn(() => ""), setProblems: vi.fn(), reveal: vi.fn(), dispose: vi.fn() };
    await renderEditor(fakeApi(), { editorFactory: async () => editor });
    await waitFor(() => expect(editor.setProblems).toHaveBeenCalledWith([expect.objectContaining({ line: 3, col: 9, severity: "ERROR" })]));
    await userEvent.click(screen.getByRole("button", { name: /금지된 API: require/ }));
    expect(editor.reveal).toHaveBeenCalledWith(3, 9);
  });

  it("저장하면 DRAFT 버전을 올리고 검사 결과를 반영, 409 SCRIPT_VERSION_CONFLICT는 비교 대화상자", async () => {
    const api = fakeApi();
    const { unmount } = await renderEditor(api);
    const box = await textarea();
    fireEvent.change(box, { target: { value: "function transform(msg, ctx) { return msg; }" } });
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(api.save).toHaveBeenCalledWith("501", { code: "function transform(msg, ctx) { return msg; }", baseVersionNo: 5 });
    expect(await screen.findByText("DRAFT v6을 저장했습니다.")).toBeInTheDocument();
    expect(screen.queryByText(/금지된 API/)).toBeNull();
    unmount();

    const conflicted = fakeApi({ save: vi.fn(async () => ({ ok: false as const, status: 409, code: "SCRIPT_VERSION_CONFLICT", message: "" })) });
    await renderEditor(conflicted);
    fireEvent.change(await textarea(), { target: { value: "function transform(msg, ctx) { return msg; } // 내 것" } });
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    const dialog = await screen.findByRole("dialog", { name: "새 버전이 있습니다" });
    expect(within(dialog).getByTestId("conflict-mine")).toHaveTextContent("// 내 것");
    expect(within(dialog).getByTestId("conflict-latest")).toHaveTextContent("다른 사람");
    expect(within(dialog).getByText("최신 저장본 v6")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "내 코드 유지하고 비교" }));
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(conflicted.save).toHaveBeenLastCalledWith("501", expect.objectContaining({ baseVersionNo: 6 }));
    await screen.findByRole("dialog", { name: "새 버전이 있습니다" });
    await userEvent.click(screen.getByRole("button", { name: "다시 불러오기" }));
    expect(await textarea()).toHaveValue("function transform(msg){ /* 다른 사람 */ return msg }");
  });

  it("저장 실패(다른 오류)와 충돌 뒤 최신본 조회 실패는 오류 문구", async () => {
    const api = fakeApi({ save: vi.fn(async () => ({ ok: false as const, status: 400, code: "SCRIPT_CODE_TOO_LARGE", message: "" })) });
    const { unmount } = await renderEditor(api);
    fireEvent.change(await textarea(), { target: { value: "x" } });
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(await screen.findByText("코드가 64KB를 넘었습니다.")).toBeInTheDocument();
    unmount();
    const both = fakeApi({ save: vi.fn(async () => ({ ok: false as const, status: 409, code: "SCRIPT_VERSION_CONFLICT", message: "" })), detail: vi.fn(async () => ({ ok: false as const, status: 503, code: "SERVICE_UNAVAILABLE", message: "" })) });
    await renderEditor(both);
    fireEvent.change(await textarea(), { target: { value: "y" } });
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(await screen.findByText("다른 사용자가 먼저 저장하거나 배포했습니다.")).toBeInTheDocument();
  });

  it("64KB를 넘으면 표시하고 저장을 막는다, 저장 안 한 변경이 있으면 떠날 때 경고", async () => {
    await renderEditor(fakeApi(), { script: detail({ draft: { versionId: "805", versionNo: 5, code: "function transform(msg){}", staticCheck: { ok: true, problems: [] } } }) });
    fireEvent.change(await textarea(), { target: { value: `function transform(msg){} //${"x".repeat(70_000)}` } });
    expect(screen.getByText("코드가 64KB를 넘었습니다")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "저장" })).toBeDisabled();
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
});

describe("SCR-03.04 배포 대화상자(UI-SCR-02)", () => {
  const clean = () => detail({ draft: { versionId: "805", versionNo: 5, code: "function transform(msg){ return msg }", staticCheck: { ok: true, problems: [] } } });

  it("메모 2~200자 필수, 배포하면 적용 n/n, 본문에 versionId·baseActiveVersionId", async () => {
    const api = fakeApi();
    await renderEditor(api, { script: clean() });
    await userEvent.click(await screen.findByRole("button", { name: "배포" }));
    const dialog = await screen.findByRole("dialog", { name: "배포" });
    expect(within(dialog).getByText("✔ 통과")).toBeInTheDocument();
    expect(within(dialog).getByText("영향: 연결 대상 1개, 최근 24시간 처리 17280건")).toBeInTheDocument();
    expect(within(dialog).queryByText("강제 배포")).toBeNull();
    await userEvent.click(within(dialog).getByRole("button", { name: "배포" }));
    expect(within(dialog).getByText("배포 메모를 입력하세요")).toBeInTheDocument();
    expect(api.deploy).not.toHaveBeenCalled();
    await userEvent.type(within(dialog).getByLabelText("배포 메모(2~200자)"), "오프셋 조정");
    await userEvent.click(within(dialog).getByRole("button", { name: "배포" }));
    expect(api.deploy).toHaveBeenCalledWith("501", { versionId: "805", memo: "오프셋 조정", baseActiveVersionId: "804" });
    expect(await within(dialog).findByText("배포했습니다. 인스턴스 적용 2/2")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "닫기" }));
    expect(screen.getByText("ACTIVE v5")).toBeInTheDocument();
  });

  it("TC-SCR-079 서버가 SCRIPT_STATIC_CHECK_FAILED로 거부하면 문구, 저장 안 한 변경은 배포되지 않는다는 안내", async () => {
    const api = fakeApi({ deploy: vi.fn(async () => ({ ok: false as const, status: 400, code: "SCRIPT_STATIC_CHECK_FAILED", message: "" })) });
    await renderEditor(api, { script: clean() });
    fireEvent.change(await textarea(), { target: { value: "function transform(msg){ return msg } // 수정" } });
    await userEvent.click(screen.getByRole("button", { name: "배포" }));
    const dialog = await screen.findByRole("dialog", { name: "배포" });
    expect(within(dialog).getByText("저장하지 않은 변경은 배포되지 않습니다. 먼저 저장하세요.")).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText("배포 메모(2~200자)"), "배포 시도");
    await userEvent.click(within(dialog).getByRole("button", { name: "배포" }));
    expect(await within(dialog).findByText("정적 검사 오류가 있어 배포할 수 없습니다. 문제 목록을 확인하세요.")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "취소" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("ADMIN 강제 배포는 사유 필수(TC-SCR-049: 10자 이상), force·forceReason을 보낸다", async () => {
    const api = fakeApi();
    await renderEditor(api, { script: clean(), canForce: true });
    await userEvent.click(await screen.findByRole("button", { name: "배포" }));
    const dialog = await screen.findByRole("dialog", { name: "배포" });
    await userEvent.type(within(dialog).getByLabelText("배포 메모(2~200자)"), "긴급 수정");
    await userEvent.click(within(dialog).getByLabelText("강제 배포"));
    await userEvent.click(within(dialog).getByRole("button", { name: "강제 배포" }));
    expect(within(dialog).getByText("강제 배포 사유를 10자 이상 입력하세요")).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText("강제 배포 사유"), "테스트 케이스 오탐 확인");
    await userEvent.click(within(dialog).getByRole("button", { name: "강제 배포" }));
    expect(api.deploy).toHaveBeenCalledWith("501", { versionId: "805", memo: "긴급 수정", baseActiveVersionId: "804", force: true, forceReason: "테스트 케이스 오탐 확인" });
  });
});

describe("SCR-03.02 TC-SCR-046 테스트 실행 패널", () => {
  it("AT-SCR-02.1 최근 원본 목록에서 고르고 실행, 차이 강조·로그 x 3·실행 정보", async () => {
    const api = fakeApi();
    await renderEditor(api);
    const select = (await screen.findByLabelText("원본 메시지 선택")) as HTMLSelectElement;
    expect(select.options[0].textContent).toBe("#8812345 · 2026-10-04 08:58:00 · EM300-TH-151606 · OK");
    await userEvent.click(screen.getByRole("button", { name: "실행" }));
    expect(api.testRun).toHaveBeenCalledWith({ kind: "TRANSFORM", code: CODE, scriptId: "501", rawMessageId: "8812345", context: { device: { attributes: {} }, last: {}, config: { tempOffset: -0.5 } } });
    expect(await screen.findByText(/"value": 22.8/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "차이" }));
    expect(screen.getByText("추가 dew_point: 9.4")).toHaveAttribute("data-diff", "added");
    expect(screen.getByText("변경 temperature: 22.3 → 22.8")).toHaveClass("text-fair-ink");
    await userEvent.click(screen.getByRole("tab", { name: "로그" }));
    expect(screen.getByText("x 3")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "정보" }));
    expect(screen.getByText(/실행 0.4ms · 출력 1.2KB/)).toBeInTheDocument();
  });

  it("AT-SCR-02.2 시간 초과는 배지와 오류 위치, 직접 입력 JSON 오류는 줄·열, API 실패는 문구", async () => {
    const api = fakeApi({
      testRun: vi.fn(async () => ({ ok: true as const, status: 200, data: { ok: false, output: null, logs: [], durationMs: 50, outputBytes: 0, error: { code: "SCRIPT_TIMEOUT", message: "실행 시간 50ms를 넘었습니다", line: 2, col: 3 } } })),
    });
    await renderEditor(api, { recent: [], recentFailed: true });
    expect(await screen.findByText("최근 원본 메시지를 불러오지 못했습니다. 직접 입력을 쓰세요.")).toBeInTheDocument();
    const input = screen.getByLabelText("입력 JSON");
    fireEvent.change(input, { target: { value: '{\n  "metrics": x\n}' } });
    await userEvent.click(screen.getByRole("button", { name: "실행" }));
    expect(screen.getByText("JSON 형식이 올바르지 않습니다 (2:14)")).toBeInTheDocument();
    expect(api.testRun).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: '{"metrics": []}' } });
    fireEvent.change(screen.getByLabelText(/컨텍스트/), { target: { value: "" } });
    await userEvent.click(screen.getByRole("button", { name: "실행" }));
    expect(api.testRun).toHaveBeenCalledWith(expect.objectContaining({ input: { metrics: [] }, context: undefined }));
    expect(await screen.findByText("시간 초과")).toBeInTheDocument();
    expect(screen.getByText("실행 시간 50ms를 넘었습니다 (2:3)")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/컨텍스트/), { target: { value: "{" } });
    await userEvent.click(screen.getByRole("button", { name: "실행" }));
    expect(screen.getByText("JSON 형식이 올바르지 않습니다 (1:2)")).toBeInTheDocument();
  });

  it("실행 API가 실패하면 오류 문구, 빈 입력은 안내, 런타임 오류는 '실행 오류' 배지·빈 차이·빈 로그", async () => {
    const failing = fakeApi({ testRun: vi.fn(async () => ({ ok: false as const, status: 429, code: "RATE_LIMITED", message: "" })) });
    const { unmount } = await renderEditor(failing, { recent: [] });
    const input = await screen.findByLabelText("입력 JSON");
    fireEvent.change(input, { target: { value: "" } });
    await userEvent.click(screen.getByRole("button", { name: "실행" }));
    expect(screen.getByText("입력 JSON을 넣으세요")).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "{}" } });
    await userEvent.click(screen.getByRole("button", { name: "실행" }));
    expect(await screen.findByText(/요청이 너무 많습니다/)).toBeInTheDocument();
    unmount();
    const runtime = fakeApi({ testRun: vi.fn(async () => ({ ok: true as const, status: 200, data: { ok: false, error: { code: "SCRIPT_RUNTIME_ERROR", message: "TypeError" } } })) });
    await renderEditor(runtime);
    await userEvent.click(await screen.findByRole("button", { name: "실행" }));
    expect(await screen.findByText("실행 오류")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("TypeError");
    await userEvent.click(screen.getByRole("tab", { name: "차이" }));
    expect(screen.getByText("바뀐 값이 없습니다")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "로그" }));
    expect(screen.getByText("로그가 없습니다")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "출력" }));
    expect(screen.getByText("null")).toBeInTheDocument();
  });
});

describe("권한별 노출(SCRIPT_READ만)", () => {
  it("OPERATOR는 읽기 전용: 저장·배포·테스트 없음, 입력해도 검사하지 않음", async () => {
    const api = fakeApi();
    await renderEditor(api, { canWrite: false, script: detail({ draft: null }) });
    expect(await screen.findByText("조회 전용입니다. 작성·배포는 INTEGRATOR 이상만 할 수 있습니다.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "저장" })).toBeNull();
    expect(screen.queryByRole("button", { name: "배포" })).toBeNull();
    expect(screen.queryByRole("button", { name: "실행" })).toBeNull();
    expect(await textarea()).toHaveAttribute("readonly");
    expect(screen.getByText("ACTIVE v4")).toBeInTheDocument();
  });
});

describe("UI-SCR-03 버전 목록", () => {
  it("버전·상태·강제 표시, [코드 보기]는 그 버전 코드, 실패는 문구, 없으면 안내", async () => {
    const api = fakeApi();
    const { unmount } = await renderRoute(<ScriptVersions scriptId="501" versions={detail().versions!} timezone="Asia/Seoul" api={api} />);
    expect(await screen.findByText("강제")).toBeInTheDocument();
    expect(screen.getByText("이통합 2026-10-02 17:40")).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole("button", { name: "코드 보기" })[1]);
    expect(api.version).toHaveBeenCalledWith("501", "804");
    expect(await screen.findByText(/\/\/ v4/)).toBeInTheDocument();
    unmount();
    const failing = fakeApi({ version: vi.fn(async () => ({ ok: false as const, status: 404, code: "RESOURCE_NOT_FOUND", message: "" })) });
    const second = await renderRoute(<ScriptVersions scriptId="501" versions={detail().versions!} timezone="UTC" api={failing} />);
    await userEvent.click((await screen.findAllByRole("button", { name: "코드 보기" }))[0]);
    expect(await screen.findByText("찾을 수 없습니다.")).toBeInTheDocument();
    second.unmount();
    await renderRoute(<ScriptVersions scriptId="501" versions={[]} timezone="UTC" api={api} />);
    expect(await screen.findByText("버전이 없습니다")).toBeInTheDocument();
  });
});

describe("UI-SCR-01 새 스크립트 대화상자", () => {
  it("종류에 따라 연결 대상이 바뀌고(DECODE 소스 하나, TRANSFORM 모델), 템플릿은 그 종류만, 검증 문구", async () => {
    const templates = [
      { key: "calibration-offset", kind: "TRANSFORM" as const, name: "보정 오프셋", description: "값에 더함" },
      { key: "milesight-decoder", kind: "DECODE" as const, name: "Milesight 디코더" },
    ];
    await renderRoute(
      <CreateScriptDialog
        open
        onClose={() => {}}
        templates={templates}
        sources={[{ id: "7", name: "ChirpStack s3" }]}
        models={[{ id: "11", code: "EM300-TH", name: "EM300-TH" }]}
        idempotencyKey="k"
        fieldErrors={{ name: "name", bindings: "transformTargets" }}
        error="이미 같은 이름의 스크립트가 있습니다"
        initialTemplate="calibration-offset"
      />,
      { session: meOf("INTEGRATOR") },
    );
    expect(await screen.findByText("이름은 2~80자로 입력해 주세요.")).toBeInTheDocument();
    expect(screen.getByText("이미 같은 이름의 스크립트가 있습니다")).toBeInTheDocument();
    expect(screen.getByText("TRANSFORM 스크립트는 모델이나 기기에 연결합니다")).toBeInTheDocument();
    expect(screen.getByLabelText("EM300-TH")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "보정 오프셋 — 값에 더함" })).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("종류"), "DECODE");
    expect(screen.getByLabelText("연결할 소스(DECODE는 하나)")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Milesight 디코더" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /보정 오프셋/ })).toBeNull();
  });
});

describe("SCR-03.07 AIA-04.01 편집기 안 AI 작성 도우미(UI-AIA-02)", () => {
  it("TC-AIA-040 AI_USE면 오른쪽에 도우미 패널, [편집기에 넣기]가 편집기 내용을 바꾸고 저장하지 않은 표시가 켜진다", async () => {
    const assist = {
      scriptAssist: vi.fn(async () => ({ ok: true as const, status: 200, data: { assistId: "1", attempt: 1, code: "function decode(input) { return { t: 1 }; }", test: { status: "PASS" as const, durationMs: 0.2 } } })),
    } as unknown as Parameters<typeof ScriptEditor>[0]["aiAssist"];
    await renderEditor(fakeApi(), { aiAssist: assist });
    await userEvent.type(await screen.findByLabelText("요구사항"), "온도 디코드");
    await userEvent.click(screen.getByRole("button", { name: "초안 만들기" }));
    await userEvent.click(await screen.findByRole("button", { name: "편집기에 넣기" }));
    expect(screen.getByLabelText("저장하지 않은 변경 있음")).toBeInTheDocument();
  });

  it("도우미가 없으면(AI_USE 없음) 패널이 없다", async () => {
    await renderEditor(fakeApi());
    await screen.findByRole("button", { name: "배포" });
    expect(screen.queryByText("AI로 작성")).toBeNull();
  });
});
