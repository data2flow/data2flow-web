/**
 * 스크립트 M5 화면 부품: 템플릿 미리보기(SCR-01.05 TC-SCR-014), 테스트 케이스(SCR-03.03 TC-SCR-049), 배포 확인·배포 후 재처리(SCR-03.06 TC-SCR-062),
 * 오류 스냅샷 → 테스트(SCR-05.01 TC-SCR-081), 로그 수집(SCR-05.02 TC-SCR-083), 성능 경고(SCR-05.03 TC-SCR-085), 설정값(SCR-04.02), 공유 모듈(SCR-04.01).
 * Monaco는 textarea 대역, 차트는 가짜 팩토리(frontend.md §3.4).
 */
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type React from "react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { meOf, renderRoute } from "../../../../test/render";
import type { ScriptApi, ScriptDetail } from "../api";
import { CreateScriptDialog } from "../create-script-dialog";
import type { ModuleApi, ScriptOpsApi } from "../m5-api";
import type { TestCase } from "../model/m5";
import { CreateModuleDialog, ModuleEditor } from "../module-editor";
import { ScriptConfigTab } from "../script-config";
import { ScriptEditor } from "../script-editor";
import { LogCapture, ScriptOps } from "../script-ops";
import { TestCasesTab } from "../test-cases";

const chartFactory = vi.fn(async () => ({ setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn() }));
const ok = <T,>(data: T, status = 200) => ({ ok: true as const, status, data });
const fail = (code: string, status = 400) => ({ ok: false as const, status, code, message: "" });

/** 라우터 스텁이 그릴 때까지 기다린다 */
async function mount(element: React.ReactElement, role: string) {
  const result = await renderRoute(element, { session: meOf(role) });
  await waitFor(() => expect(document.body.textContent).not.toBe(""));
  return result;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const CODE = "function transform(msg, ctx) {\n  return msg;\n}\n";

function detail(overrides: Partial<ScriptDetail> = {}): ScriptDetail {
  return {
    id: "501",
    name: "온도 보정 오프셋",
    kind: "TRANSFORM",
    status: "ENABLED",
    activeVersion: { versionId: "804", versionNo: 4, code: CODE },
    draft: { versionId: "805", versionNo: 5, code: CODE, staticCheck: { ok: true, problems: [] } },
    versions: [],
    bindings: [{ targetType: "MODEL", targetId: "11", name: "EM300-TH" }],
    config: { tempOffset: 0.5 },
    version: 7,
    tests: [],
    ...overrides,
  };
}

function scriptApi(overrides: Partial<ScriptApi> = {}): ScriptApi {
  return {
    check: vi.fn(async () => ok({ ok: true, problems: [] })),
    save: vi.fn(async () => ok({ versionId: "806", versionNo: 6, staticCheck: { ok: true, problems: [] } })),
    detail: vi.fn(async () => ok(detail())),
    deploy: vi.fn(async () =>
      ok({ activeVersionId: "805", versionNo: 5, applied: { reported: 2, total: 2 }, reprocessSuggestion: { requests: [{ sourceId: "7", deviceIds: ["11", "12"], from: "2026-09-27T00:00:00Z", to: "2026-10-04T00:00:00Z", memo: "스크립트 온도 보정 오프셋 v5 배포 후 재처리" }] } }),
    ),
    testRun: vi.fn(async () => ok({ ok: true, output: { metrics: [{ key: "temperature", value: 22.8 }] }, diff: { added: [], removed: [], changed: [] }, logs: [], durationMs: 0.4, outputBytes: 100 })),
    version: vi.fn(async () => ok({ versionNo: 4, code: CODE })),
    ...overrides,
  };
}

const FAILING_RUN = {
  passed: 2,
  failed: 1,
  results: [
    { caseId: "1", name: "기본 업링크", passed: true },
    { caseId: "2", name: "온도 없음", passed: true },
    { caseId: "3", name: "범위 밖 값", passed: false, diff: { changed: [{ key: "temperature", expected: 85, actual: 85.5 }] } },
  ],
};

describe("SCR-01.05 TC-SCR-014 템플릿에서 만들기", () => {
  const templates = [
    { key: "calibration-offset", kind: "TRANSFORM" as const, name: "보정 오프셋", description: "측정값에 설정값을 더합니다", code: "function transform(msg, ctx) {\n  const off = ctx.device.attributes.tempOffset;\n}", configDefaults: { tempOffset: 0 } },
    { key: "moving-average", kind: "TRANSFORM" as const, name: "이동평균", code: "function transform(msg, ctx) { /* avg */ }" },
    { key: "milesight-decoder", kind: "DECODE" as const, name: "Milesight 디코더", code: "function decode(msg) {}" },
  ];

  it("AT-SCR-01.5 '보정 오프셋' 선택 → 코드 미리보기(ctx.device.attributes.tempOffset)·기본 설정값, 종류에 맞는 템플릿만", async () => {
    await mount(<CreateScriptDialog open onClose={() => {}} templates={templates} sources={[{ id: "7", name: "chirpstack-s3" }]} models={[]} idempotencyKey="k" />, "INTEGRATOR");
    const select = screen.getByLabelText("템플릿");
    expect(within(select).queryByText(/Milesight/)).toBeNull();
    await userEvent.selectOptions(select, "calibration-offset");
    expect(screen.getByTestId("template-preview")).toHaveTextContent("ctx.device.attributes.tempOffset");
    expect(screen.getByText("기본 설정값: tempOffset=0")).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("종류"), "DECODE");
    expect(screen.queryByTestId("template-preview")).toBeNull();
    await userEvent.selectOptions(screen.getByLabelText("템플릿"), "milesight-decoder");
    expect(screen.getByTestId("template-preview")).toHaveTextContent("function decode");
  });
});

function casesApi(cases: TestCase[], overrides: Partial<ScriptOpsApi> = {}) {
  return {
    listCases: vi.fn(async () => ok({ responses: cases })),
    createCase: vi.fn(async (_id: string, body: Parameters<ScriptOpsApi["createCase"]>[1]) => ok({ id: "9", ...body } as TestCase, 201)),
    updateCase: vi.fn(async (_id: string, caseId: string, body: Parameters<ScriptOpsApi["updateCase"]>[2]) => ok({ id: caseId, ...body } as TestCase)),
    deleteCase: vi.fn(async () => ok(undefined as void, 204)),
    runCases: vi.fn(async () => ok(FAILING_RUN)),
    ...overrides,
  };
}

describe("SCR-03.03 TC-SCR-049 테스트 케이스 탭(UI-SCR-04)", () => {
  const cases: TestCase[] = [
    { id: "1", name: "기본 업링크", input: { metrics: [{ key: "temperature", value: 22 }] }, expected: {}, compareMode: "TOLERANCE", tolerance: 0.01, lastResult: { passed: true, versionNo: 5 } },
    { id: "2", name: "온도 없음", input: {}, expected: {}, compareMode: "EXACT" },
    { id: "3", name: "범위 밖 값", input: {}, expected: {}, compareMode: "FIELDS", compareFields: ["temperature"] },
  ];

  it("AT-SCR-07.1 [모두 실행] → 케이스별 통과/실패와 차이('temperature 기대 85 / 실제 85.5')", async () => {
    const api = casesApi(cases);
    await mount(<TestCasesTab scriptId="501" initialCases={cases} canWrite api={api} />, "INTEGRATOR");
    expect(screen.getByText("허용 오차 0.01")).toBeInTheDocument();
    expect(screen.getByText("✔ 통과 v5")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "모두 실행" }));
    expect(await screen.findByText("테스트 케이스 2/3 통과")).toBeInTheDocument();
    expect(within(screen.getByTestId("case-3")).getByText("temperature 기대 85 / 실제 85.5")).toBeInTheDocument();
    expect(api.runCases).toHaveBeenCalledWith("501", {});
  });

  it("새 케이스: JSON·허용 오차·이름 중복 검증 후 저장(API-SCR-10), 편집·삭제", async () => {
    const api = casesApi(cases);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await mount(<TestCasesTab scriptId="501" initialCases={cases} canWrite api={api} />, "INTEGRATOR");
    await userEvent.click(screen.getByRole("button", { name: "새 케이스" }));
    const editor = screen.getByRole("region", { name: "테스트 케이스 편집" });
    await userEvent.type(within(editor).getByLabelText("이름"), "기본 업링크");
    fireEvent.change(within(editor).getByLabelText("입력 JSON"), { target: { value: "{" } });
    await userEvent.selectOptions(within(editor).getByLabelText("비교 방식"), "TOLERANCE");
    fireEvent.change(within(editor).getByLabelText("허용 오차"), { target: { value: "2000" } });
    await userEvent.click(within(editor).getByRole("button", { name: "저장" }));
    expect(within(editor).getByText("이미 같은 이름의 케이스가 있습니다")).toBeInTheDocument();
    expect(within(editor).getByText("JSON 형식이 올바르지 않습니다")).toBeInTheDocument();
    expect(within(editor).getByText("허용 오차는 0~1000 사이 숫자입니다")).toBeInTheDocument();
    expect(api.createCase).not.toHaveBeenCalled();
    fireEvent.change(within(editor).getByLabelText("이름"), { target: { value: "새 케이스" } });
    fireEvent.change(within(editor).getByLabelText("입력 JSON"), { target: { value: '{"a":1}' } });
    fireEvent.change(within(editor).getByLabelText("허용 오차"), { target: { value: "0.5" } });
    await userEvent.click(within(editor).getByRole("button", { name: "저장" }));
    expect(api.createCase).toHaveBeenCalledWith("501", { name: "새 케이스", input: { a: 1 }, expected: {}, compareMode: "TOLERANCE", tolerance: 0.5 });
    expect(await screen.findByText("테스트 케이스를 저장했습니다.")).toBeInTheDocument();

    await userEvent.click(within(screen.getByTestId("case-2")).getByRole("button", { name: "편집" }));
    await userEvent.click(within(screen.getByRole("region", { name: "테스트 케이스 편집" })).getByRole("button", { name: "저장" }));
    expect(api.updateCase).toHaveBeenCalledWith("501", "2", expect.objectContaining({ name: "온도 없음", compareMode: "EXACT" }));

    await userEvent.click(within(screen.getByTestId("case-1")).getByRole("button", { name: "삭제" }));
    expect(api.deleteCase).toHaveBeenCalledWith("501", "1");
  });

  it("서버 이름 중복(errors[name])·한도 409 문구, 케이스 없음 안내, 조회 전용", async () => {
    const api = casesApi([], { createCase: vi.fn(async () => ({ ok: false as const, status: 400, code: "INVALID_REQUEST", message: "", errors: [{ field: "name", code: "Duplicated", message: "" }] })) });
    await mount(<TestCasesTab scriptId="501" initialCases={[]} canWrite api={api} />, "INTEGRATOR");
    expect(screen.getByText("테스트 실행 결과에서 [테스트 케이스로 저장]을 눌러 추가하세요")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "모두 실행" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "새 케이스" }));
    await userEvent.type(screen.getByLabelText("이름"), "x");
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(await screen.findByText("이미 같은 이름의 케이스가 있습니다")).toBeInTheDocument();
  });

  it("50개면 [새 케이스] 비활성과 한도 안내, OPERATOR는 버튼 없음", async () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ id: String(i), name: `c${i}`, input: {}, expected: {}, compareMode: "EXACT" as const }));
    const { unmount } = await mount(<TestCasesTab scriptId="501" initialCases={many} canWrite api={casesApi(many)} />, "INTEGRATOR");
    expect(screen.getByRole("button", { name: "새 케이스" })).toBeDisabled();
    expect(screen.getByText("테스트 케이스는 스크립트당 50개까지입니다")).toBeInTheDocument();
    unmount();
    await mount(<TestCasesTab scriptId="501" initialCases={many.slice(0, 1)} canWrite={false} api={casesApi([])} />, "OPERATOR");
    expect(screen.queryByRole("button", { name: "새 케이스" })).toBeNull();
  });
});

describe("SCR-03.03·03.06 배포 확인 대화상자", () => {
  const renderEditor = (api: ScriptApi, canForce = false) =>
    mount(<ScriptEditor script={detail()} canWrite canForce={canForce} recent={[]} recentFailed={false} timezone="Asia/Seoul" api={api} editorFactory={async () => null} />, canForce ? "ADMIN" : "INTEGRATOR");

  it("TC-SCR-049 AT-SCR-07.1 실패 케이스가 있으면 [배포] 비활성과 차이, ADMIN은 사유 10자 이상으로 강제 배포", async () => {
    const api = scriptApi({ runCases: vi.fn(async () => ok(FAILING_RUN)) });
    await renderEditor(api, true);
    await userEvent.click(screen.getByRole("button", { name: "배포" }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("✖ 테스트 케이스 2/3 통과")).toBeInTheDocument();
    expect(within(dialog).getByText("temperature 기대 85 / 실제 85.5")).toBeInTheDocument();
    expect(within(dialog).getByText("실패한 케이스가 있습니다. 관리자는 사유를 남기고 강제 배포할 수 있습니다.")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "배포" })).toBeDisabled();
    expect(api.runCases).toHaveBeenCalledWith("501", { versionId: "805" });
    await userEvent.type(within(dialog).getByLabelText("배포 메모(2~200자)"), "범위 보정");
    await userEvent.click(within(dialog).getByLabelText("강제 배포"));
    await userEvent.type(within(dialog).getByLabelText("강제 배포 사유"), "짧은 사유");
    await userEvent.click(within(dialog).getByRole("button", { name: "강제 배포" }));
    expect(within(dialog).getByText("강제 배포 사유를 10자 이상 입력하세요")).toBeInTheDocument();
    expect(api.deploy).not.toHaveBeenCalled();
    await userEvent.type(within(dialog).getByLabelText("강제 배포 사유"), "입니다 현장 확인");
    await userEvent.click(within(dialog).getByRole("button", { name: "강제 배포" }));
    expect(api.deploy).toHaveBeenCalledWith("501", expect.objectContaining({ force: true, forceReason: "짧은 사유입니다 현장 확인" }));
  });

  it("TC-SCR-062 AT-SCR-03.1 배포 완료 → [지난 데이터 재처리]에 대상·기간 미리 채움, 미검증 측정 항목 링크(시나리오 4)", async () => {
    const api = scriptApi({ runCases: vi.fn(async () => ok({ passed: 3, failed: 0, results: [] })) });
    await renderEditor(api);
    await userEvent.click(screen.getByRole("button", { name: "배포" }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("✔ 테스트 케이스 3/3 통과")).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText("배포 메모(2~200자)"), "오프셋 반영");
    await userEvent.click(within(dialog).getByRole("button", { name: "배포" }));
    const link = await within(dialog).findByRole("link", { name: "↻ 지난 데이터 재처리" });
    expect(link.getAttribute("href")).toBe(
      `/ingest/reprocess?sourceId=7&deviceIds=11%2C12&from=2026-09-27T00%3A00%3A00Z&to=2026-10-04T00%3A00%3A00Z&memo=${encodeURIComponent("스크립트 온도 보정 오프셋 v5 배포 후 재처리").replace(/%20/g, "+")}`,
    );
    expect(within(dialog).getByRole("link", { name: "✓ 미검증 측정 항목 확인·승인" })).toHaveAttribute("href", "/metrics?tab=unverified");
  });

  it("케이스 없음·확인 실패 표시, 서버 SCRIPT_TEST_FAILED면 다시 확인", async () => {
    const runCases = vi.fn().mockResolvedValueOnce(fail("SERVICE_UNAVAILABLE", 503)).mockResolvedValueOnce(ok(FAILING_RUN));
    const api = scriptApi({ runCases, deploy: vi.fn(async () => fail("SCRIPT_TEST_FAILED")) });
    await renderEditor(api);
    await userEvent.click(screen.getByRole("button", { name: "배포" }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("확인하지 못했습니다(배포할 때 서버가 다시 확인합니다)")).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText("배포 메모(2~200자)"), "메모입니다");
    await userEvent.click(within(dialog).getByRole("button", { name: "배포" }));
    expect(await within(dialog).findByText("temperature 기대 85 / 실제 85.5")).toBeInTheDocument();
    expect(runCases).toHaveBeenCalledTimes(2);
  });

  it("케이스가 없으면 '저장된 케이스 없음'으로 통과", async () => {
    await renderEditor(scriptApi({ runCases: vi.fn(async () => ok({ passed: 0, failed: 0, results: [] })) }));
    await userEvent.click(screen.getByRole("button", { name: "배포" }));
    expect(await screen.findByText("저장된 케이스 없음")).toBeInTheDocument();
  });
});

describe("SCR-05.01 TC-SCR-081 오류 목록 → 이 입력으로 테스트", () => {
  const errors = [{ id: "e1", occurredAt: "2026-10-04T00:41:02Z", versionNo: 4, errorCode: "SCRIPT_RUNTIME_ERROR", message: "x is undefined", line: 7, col: 12, deviceId: "11", inputSnapshot: { externalId: "dev-9", metrics: [{ key: "temperature", value: 99 }] } }];
  const opsApi = (overrides: Partial<ScriptOpsApi> = {}) => ({
    stats: vi.fn(async () => ok({ points: [], warnings: [], deployMarks: [] })),
    errors: vi.fn(async () => ok({ responses: errors, totalCount: 1 })),
    logCapture: vi.fn(async () => ok({ enabled: true, until: "2026-10-04T00:30:00Z" })),
    logs: vi.fn(async () => ok({ responses: [] })),
    ...overrides,
  });

  function Harness({ api }: { api: ReturnType<typeof opsApi> }) {
    const [injected, setInjected] = useState<{ input: unknown; seq: number } | null>(null);
    const [tab, setTab] = useState<"ops" | "code">("ops");
    return tab === "ops" ? (
      <ScriptOps
        scriptId="501"
        canWrite
        timezone="Asia/Seoul"
        api={api}
        chartFactory={chartFactory}
        onTestWithInput={(input) => {
          setInjected({ input, seq: 1 });
          setTab("code");
        }}
      />
    ) : (
      <ScriptEditor script={detail()} canWrite canForce={false} recent={[{ id: "1", topic: "t" }]} recentFailed={false} timezone="Asia/Seoul" api={scriptApi()} editorFactory={async () => null} injected={injected} />
    );
  }

  it("AT-SCR-10.1 [이 입력으로 테스트] → 편집기 테스트 패널 직접 입력에 그 입력이 채워진다, 입력 보기", async () => {
    await mount(<Harness api={opsApi()} />, "INTEGRATOR");
    expect(await screen.findByText("x is undefined")).toBeInTheDocument();
    expect(screen.getByText("7:12")).toBeInTheDocument();
    expect(screen.getByText("오류 (최근 1건)")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "입력 보기" }));
    expect(screen.getByText(/"externalId": "dev-9"/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "이 입력으로 테스트" }));
    const box = (await screen.findByLabelText("입력 JSON")) as HTMLTextAreaElement;
    expect(JSON.parse(box.value)).toEqual(errors[0].inputSnapshot);
    expect(screen.getByLabelText("직접 입력")).toBeChecked();
  });

  it("입력 원문이 없는(SCRIPT_READ만) 오류는 버튼이 없고, 오류 0건이면 안내", async () => {
    const { unmount } = await mount(<ScriptOps scriptId="501" canWrite={false} timezone="Asia/Seoul" api={opsApi({ errors: vi.fn(async () => ok({ responses: [{ ...errors[0], inputSnapshot: undefined }], totalCount: 1 })) })} onTestWithInput={() => {}} chartFactory={chartFactory} />, "OPERATOR");
    expect(await screen.findByText("x is undefined")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "이 입력으로 테스트" })).toBeNull();
    unmount();
    await mount(<ScriptOps scriptId="501" canWrite timezone="Asia/Seoul" api={opsApi({ errors: vi.fn(async () => ok({ responses: [] })) })} onTestWithInput={() => {}} chartFactory={chartFactory} />, "INTEGRATOR");
    expect(await screen.findByText("오류가 없습니다")).toBeInTheDocument();
  });

  it("[테스트 케이스로 저장]: 직접 입력 실행 결과를 EXACT 케이스로 저장(API-SCR-10)", async () => {
    const saveCase = vi.fn(async (_id: string, body: Parameters<NonNullable<ScriptApi["saveCase"]>>[1]) => ok({ id: "9", ...body } as TestCase, 201));
    await mount(<ScriptEditor script={detail({ tests: [{ id: "1", name: "케이스 1", input: {}, expected: {}, compareMode: "EXACT" }] })} canWrite canForce={false} recent={[]} recentFailed={false} timezone="Asia/Seoul" api={scriptApi({ saveCase })} editorFactory={async () => null} />, "INTEGRATOR");
    await userEvent.click(screen.getByRole("button", { name: "실행" }));
    await userEvent.click(await screen.findByRole("button", { name: "테스트 케이스로 저장" }));
    expect(await screen.findByText("현재 입력과 출력을 테스트 케이스로 저장했습니다.")).toBeInTheDocument();
    expect(saveCase).toHaveBeenCalledWith("501", expect.objectContaining({ name: "케이스 2", compareMode: "EXACT", expected: { metrics: [{ key: "temperature", value: 22.8 }] } }));
  });
});

describe("SCR-03.05·05.03 TC-SCR-085 운영 지표·성능 경고 배지", () => {
  it("AT-SCR-10.3 p95 25ms 경고와 원인 후보(큰 입력·큰 루프), 오류율, 버전별 합계, 기간 바꾸면 다시 조회", async () => {
    const stats = vi.fn(async () =>
      ok({
        points: [
          { t: "2026-10-03T23:00:00Z", versionNo: 4, processed: 100, errors: 0, avgMs: 3, p95Ms: 8 },
          { t: "2026-10-03T23:30:00Z", versionNo: 5, processed: 200, errors: 30, avgMs: 12, p95Ms: 25 },
        ],
        warnings: [
          { type: "SLOW", value: 25, hints: ["LARGE_INPUT", "LARGE_LOOP", "CUSTOM"] },
          { type: "ERROR_RATE", value: 0.121, hints: [] },
        ],
        deployMarks: [{ versionNo: 5, at: "2026-10-03T23:15:00Z" }],
      }),
    );
    const api = { stats, errors: vi.fn(async () => ok({ responses: [] })), logCapture: vi.fn(), logs: vi.fn(async () => ok({ responses: [] })) };
    await mount(<ScriptOps scriptId="501" canWrite timezone="Asia/Seoul" api={api} onTestWithInput={() => {}} now={() => Date.parse("2026-10-04T00:00:00Z")} chartFactory={chartFactory} />, "OPERATOR");
    expect(await screen.findByText("⚠ 성능 경고 p95 25ms")).toBeInTheDocument();
    expect(screen.getByText(/원인 후보: 큰 입력, 반복 횟수가 큰 루프, CUSTOM/)).toBeInTheDocument();
    expect(screen.getByText("⚠ 오류율 12.1%")).toBeInTheDocument();
    expect(screen.getByText("v5")).toBeInTheDocument();
    expect(screen.getByText("15.0%")).toBeInTheDocument();
    expect(stats).toHaveBeenLastCalledWith("501", { from: "2026-10-03T00:00:00Z", to: "2026-10-04T00:00:00Z", step: "1m" });
    await userEvent.selectOptions(screen.getByLabelText("기간"), "7d");
    await waitFor(() => expect(stats).toHaveBeenLastCalledWith("501", { from: "2026-09-27T00:00:00Z", to: "2026-10-04T00:00:00Z", step: "1h" }));
  });

  it("p95가 20ms 이하로 내려오면 배지가 없고, 지표가 없으면 안내, 조회 실패 문구", async () => {
    const api = {
      stats: vi.fn().mockResolvedValueOnce(ok({ points: [{ t: "2026-10-03T23:00:00Z", versionNo: 5, processed: 10, p95Ms: 19.9 }], warnings: [], deployMarks: [] })).mockResolvedValue(fail("SCRIPT_NOT_FOUND", 404)),
      errors: vi.fn(async () => fail("X", 500)),
      logCapture: vi.fn(),
      logs: vi.fn(async () => ok({ responses: [] })),
    };
    await mount(<ScriptOps scriptId="501" canWrite timezone="Asia/Seoul" api={api} onTestWithInput={() => {}} chartFactory={chartFactory} />, "OPERATOR");
    expect(await screen.findByText("v5")).toBeInTheDocument();
    expect(screen.queryByText(/성능 경고/)).toBeNull();
    await userEvent.selectOptions(screen.getByLabelText("기간"), "1h");
    expect(await screen.findByText("스크립트를 찾을 수 없습니다.")).toBeInTheDocument();
  });
});

describe("SCR-05.02 TC-SCR-083 운영 로그 수집", () => {
  it("AT-SCR-10.2 켜면 남은 시간 표시, 30분이 지나면 '자동으로 꺼졌습니다'", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let now = Date.parse("2026-10-04T00:00:00Z");
    vi.setSystemTime(now);
    const api = {
      logCapture: vi.fn(async () => ok({ enabled: true, until: "2026-10-04T00:30:00Z" })),
      logs: vi.fn(async () => ok({ responses: [{ at: "2026-10-04T00:00:01Z", versionNo: 5, deviceId: "11", message: "offset 0.5" }] })),
    };
    await mount(<LogCapture scriptId="501" canWrite initialUntil={null} timezone="Asia/Seoul" api={api} now={() => now} />, "INTEGRATOR");
    expect(screen.getByRole("status")).toHaveTextContent("꺼짐");
    fireEvent.click(screen.getByRole("button", { name: "로그 수집 켜기" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("수집 중 · 남은 시간 30:00"));
    expect(await screen.findByText(/offset 0.5/)).toBeInTheDocument();
    expect(api.logCapture).toHaveBeenCalledWith("501", true);
    now += 60_000;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(screen.getByRole("status")).toHaveTextContent("남은 시간 29:00");
    expect(screen.getByRole("button", { name: "30분 연장" })).toBeInTheDocument();
    now += 30 * 60_000;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(screen.getByRole("status")).toHaveTextContent("30분이 지나 자동으로 꺼졌습니다");
  });

  it("끄기와 오류, 조회 전용은 버튼 없음", async () => {
    const api = { logCapture: vi.fn().mockResolvedValueOnce(ok({ enabled: false, until: null })).mockResolvedValueOnce(fail("PERMISSION_DENIED", 403)), logs: vi.fn(async () => fail("X", 500)) };
    const { unmount } = await mount(<LogCapture scriptId="501" canWrite initialUntil="2099-01-01T00:00:00Z" timezone="Asia/Seoul" api={api} />, "INTEGRATOR");
    await userEvent.click(screen.getByRole("button", { name: "끄기" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("꺼짐"));
    await userEvent.click(screen.getByRole("button", { name: "로그 수집 켜기" }));
    expect(await screen.findByText("이 작업을 할 권한이 없습니다.")).toBeInTheDocument();
    unmount();
    await mount(<LogCapture scriptId="501" canWrite={false} initialUntil={null} timezone="Asia/Seoul" api={api} />, "OPERATOR");
    expect(screen.queryByRole("button", { name: "로그 수집 켜기" })).toBeNull();
  });
});

describe("SCR-04.02 TC-SCR-070 TC-SCR-071 설정값 탭", () => {
  it("AT-SCR-08.2 값만 바꿔 저장(API-SCR-22, baseVersion), 비밀값 이름 거부, 409 충돌 안내", async () => {
    const saveConfig = vi
      .fn()
      .mockResolvedValueOnce(ok({ scriptId: "501", config: { tempOffset: 0.7 }, version: 8 }))
      .mockResolvedValueOnce(fail("SCRIPT_VERSION_CONFLICT", 409))
      .mockResolvedValueOnce(fail("SCRIPT_CONFIG_SECRET_FORBIDDEN"));
    await mount(<ScriptConfigTab scriptId="501" config={{ tempOffset: 0.5 }} version={7} canWrite api={{ saveConfig }} />, "INTEGRATOR");
    fireEvent.change(screen.getByLabelText("값"), { target: { value: "0.7" } });
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(saveConfig).toHaveBeenCalledWith("501", { config: { tempOffset: 0.7 }, baseVersion: 7 });
    expect(await screen.findByText("설정값을 저장했습니다. 10초 안에 반영됩니다.")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "설정값 추가" }));
    const row = screen.getByTestId("config-row-1");
    await userEvent.type(within(row).getByLabelText("이름"), "apiToken");
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(within(row).getByText(/비밀값으로 보이는 이름은 쓸 수 없습니다/)).toBeInTheDocument();
    expect(saveConfig).toHaveBeenCalledTimes(1);
    fireEvent.change(within(row).getByLabelText("이름"), { target: { value: "enabled" } });
    await userEvent.selectOptions(within(row).getByLabelText("유형"), "boolean");
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(saveConfig).toHaveBeenLastCalledWith("501", { config: { tempOffset: 0.7, enabled: false }, baseVersion: 8 });
    expect(await screen.findByText("다른 사용자가 먼저 바꿨습니다. 새로 고친 뒤 다시 저장하세요.")).toBeInTheDocument();
    await userEvent.click(within(row).getByRole("button", { name: "제거" }));
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(await screen.findByText("비밀값은 설정값에 넣을 수 없습니다")).toBeInTheDocument();
  });

  it("조회 전용은 입력 비활성·버튼 없음, 빈 설정 안내", async () => {
    await mount(<ScriptConfigTab scriptId="501" config={{}} version={1} canWrite={false} api={{ saveConfig: vi.fn() }} />, "OPERATOR");
    expect(screen.getByText("설정값이 없습니다.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "저장" })).toBeNull();
  });
});

describe("SCR-04.01 TC-SCR-069 공유 모듈(UI-SCR-06)", () => {
  const module = { id: "3", name: "milesight-channels", description: "채널 파서", draftCode: "export function parseChannels() { return []; }\n", latestVersionNo: 2, versions: [{ versionNo: 2, releasedAt: "2026-10-03T00:00:00Z" }, { versionNo: 1, releasedAt: "2026-10-01T00:00:00Z" }] };
  const api = (overrides: Partial<ModuleApi> = {}): ModuleApi => ({
    create: vi.fn(async (body) => ok({ id: "4", ...body, draftCode: body.code }, 201)),
    save: vi.fn(async (_id, body) => ok({ ...module, description: body.description, draftCode: body.code })),
    release: vi.fn(async () => ok({ moduleId: "3", versionNo: 3, releasedAt: "2026-10-04T00:00:00Z" }, 201)),
    deleteVersion: vi.fn(async (_id, versionNo) => (versionNo === 1 ? fail("SCRIPT_MODULE_IN_USE", 409) : ok(undefined as void, 204))),
    usage: vi.fn(async () => ok({ moduleId: "3", scripts: [{ scriptId: "501", scriptName: "AM107 디코더", versionNo: 1 }] })),
    ...overrides,
  });

  it("AT-SCR-08.1 버전별 사용 스크립트, 사용 중 버전 삭제 → SCRIPT_MODULE_IN_USE 안내, 미사용 버전 삭제, 저장 후 버전 배포", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const a = api();
    await mount(<ModuleEditor module={module} canWrite timezone="Asia/Seoul" api={a} editorFactory={async () => null} />, "INTEGRATOR");
    expect(await screen.findByRole("link", { name: "AM107 디코더" })).toHaveAttribute("href", "/scripts/501");
    expect(screen.getByText("import { … } from 'module:milesight-channels@2';")).toBeInTheDocument();
    const rows = screen.getAllByRole("row");
    await userEvent.click(within(rows[2]).getByRole("button", { name: "삭제" }));
    expect(await screen.findByText("v1을 쓰는 스크립트가 있어 삭제할 수 없습니다")).toBeInTheDocument();
    await userEvent.click(within(screen.getAllByRole("row")[1]).getByRole("button", { name: "삭제" }));
    await waitFor(() => expect(screen.queryByText("v2")).toBeNull());

    fireEvent.change(screen.getByLabelText("코드"), { target: { value: "export const X = 1;\n" } });
    await userEvent.click(screen.getByRole("button", { name: "버전 배포" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/현재 코드로 v3을 만듭니다/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "버전 배포" }));
    expect(a.save).toHaveBeenCalledWith("3", { name: "milesight-channels", description: "채널 파서", code: "export const X = 1;\n" });
    expect(await screen.findByText(/v3을 배포했습니다/)).toBeInTheDocument();
    expect(a.release).toHaveBeenCalledWith("3");
  });

  it("[저장]과 오류 문구, 조회 전용", async () => {
    const a = api({ save: vi.fn(async () => fail("SCRIPT_CODE_TOO_LARGE")) });
    const { unmount } = await mount(<ModuleEditor module={module} canWrite timezone="Asia/Seoul" api={a} editorFactory={async () => null} />, "INTEGRATOR");
    fireEvent.change(screen.getByLabelText("설명"), { target: { value: "새 설명" } });
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    unmount();
    await mount(<ModuleEditor module={{ ...module, versions: [] }} canWrite={false} timezone="Asia/Seoul" api={api()} editorFactory={async () => null} />, "OPERATOR");
    expect(screen.getByText("아직 배포한 버전이 없습니다")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "버전 배포" })).toBeNull();
  });

  it("새 모듈: 이름 형식·중복 검증 후 생성", async () => {
    const onCreated = vi.fn();
    const create = vi.fn().mockResolvedValueOnce({ ok: false, status: 400, code: "INVALID_REQUEST", message: "", errors: [{ field: "name", code: "Duplicated", message: "" }] }).mockResolvedValueOnce(ok({ id: "4", name: "abc-1" }, 201));
    await mount(<CreateModuleDialog open onClose={() => {}} onCreated={onCreated} api={{ create }} />, "INTEGRATOR");
    await userEvent.type(screen.getByLabelText("모듈 이름"), "Bad Name");
    await userEvent.click(screen.getByRole("button", { name: "만들기" }));
    expect(screen.getByText("이름은 소문자·숫자·- 3~40자입니다")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("모듈 이름"), { target: { value: "abc-1" } });
    await userEvent.click(screen.getByRole("button", { name: "만들기" }));
    expect(await screen.findByText("이미 같은 이름의 모듈이 있습니다")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "만들기" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith({ id: "4", name: "abc-1" }));
    expect(create).toHaveBeenLastCalledWith(expect.objectContaining({ name: "abc-1", code: expect.stringContaining("export function") }));
  });
});
