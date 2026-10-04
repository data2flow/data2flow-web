/**
 * 동시 편집 표시(FLW-11.01, FLW-06.09, UI-FLW-17, API-FLW-42)와 플로우 설정·설명서(UI-FLW-09·22, FLW-11.06).
 */
import { act, fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkSettings, modeOf, ownerMissing, modeProblem, parseInitial, settingsFormOf, settingsPatch, toMode, variableProblems, variablesOf } from "../model/settings";
import type { FakeSocket } from "./fake-socket";
import { coolingGraph, detailOf, fakeApi, renderEditor, stubReactFlowDom } from "./helpers";

beforeEach(() => stubReactFlowDom());
afterEach(() => vi.useRealTimers());

const nodeEl = (container: HTMLElement, id: string) => container.querySelector(`.react-flow__node[data-id="${id}"]`) as HTMLElement;
const presenceSocket = (sockets: { sockets: FakeSocket[] }) => sockets.sockets.find((s) => s.url.endsWith("/presence"))!;
const A = { userId: "21", name: "A", color: "#e5484d", readOnly: false, selected: [] as string[] };

describe("FLW-11.01 TC-FLW-222 AT-FLW-25.1 다른 사람이 고른 노드 표시", () => {
  it("편집 참여 채널에 연결해 참여자 아바타와, A가 고른 노드에 A의 색 테두리·이름표를 보인다", async () => {
    const { container, sockets } = await renderEditor({ role: "OPERATOR", detail: detailOf(coolingGraph()) });
    const socket = presenceSocket(sockets);
    expect(socket.url).toMatch(/\/bff\/stream\/flows\/f-7f3a\/presence$/);
    act(() => socket.open());
    act(() => socket.emit({ type: "presence.snapshot", participants: [{ userId: "7", name: "김운영" }, { ...A, selected: ["n-thr00001"] }] }));
    expect(screen.getByLabelText("함께 보고 있는 사람")).toHaveTextContent("A");
    expect(screen.getByLabelText("함께 보고 있는 사람")).not.toHaveTextContent("김운영");
    expect(within(nodeEl(container, "n-thr00001")).getByText("A 편집 중")).toBeInTheDocument();
  });

  it("내가 노드를 고르면 200ms 뒤 presence.select, 설정 패널을 열면 lock.acquire, 20초마다 heartbeat", async () => {
    const { container, sockets } = await renderEditor({ role: "OPERATOR", detail: detailOf(coolingGraph()) });
    const socket = presenceSocket(sockets);
    vi.useFakeTimers();
    act(() => socket.open());
    act(() => {
      fireEvent.click(nodeEl(container, "n-thr00001"));
    });
    expect(socket.sent).toContainEqual({ type: "lock.acquire", nodeId: "n-thr00001" });
    expect(socket.sent).not.toContainEqual({ type: "presence.select", nodeIds: ["n-thr00001"] });
    act(() => vi.advanceTimersByTime(200));
    expect(socket.sent).toContainEqual({ type: "presence.select", nodeIds: ["n-thr00001"] });
    act(() => vi.advanceTimersByTime(20_000));
    expect(socket.sent).toContainEqual({ type: "heartbeat" });
  });
});

describe("FLW-11.01 TC-FLW-224 AT-FLW-25.2 · TC-FLW-226 AT-FLW-25.3 편집 잠금", () => {
  it("A가 잡은 노드의 설정 패널은 읽기 전용 'A님이 편집 중입니다', A가 떠나 잠금이 풀리면 다시 요청해 편집할 수 있다", async () => {
    const { container, sockets } = await renderEditor({ role: "OPERATOR", detail: detailOf(coolingGraph()) });
    const socket = presenceSocket(sockets);
    act(() => socket.open());
    act(() => socket.emit({ type: "presence.snapshot", participants: [{ userId: "7", name: "김운영" }, A] }));
    vi.useFakeTimers();
    act(() => {
      fireEvent.click(nodeEl(container, "n-thr00001"));
    });
    act(() => socket.emit({ type: "lock.denied", nodeId: "n-thr00001", holder: { userId: "21", name: "A" } }));
    expect(screen.getByText("A님이 편집 중입니다(읽기 전용)")).toBeInTheDocument();
    expect(screen.getByLabelText("노드 이름")).toBeDisabled();
    // 잠금이 남아 있는 동안 20초마다 다시 묻는다
    const asked = () => socket.sent.filter((m) => JSON.stringify(m) === JSON.stringify({ type: "lock.acquire", nodeId: "n-thr00001" })).length;
    const before = asked();
    act(() => vi.advanceTimersByTime(20_000));
    expect(asked()).toBe(before + 1);
    // A 브라우저 강제 종료 → 60초 뒤 서버 잠금이 풀려 허가
    act(() => vi.advanceTimersByTime(40_000));
    act(() => socket.emit({ type: "lock.granted", nodeId: "n-thr00001", holder: { userId: "7", name: "김운영" } }));
    expect(screen.queryByText("A님이 편집 중입니다(읽기 전용)")).toBeNull();
    expect(screen.getByLabelText("노드 이름")).not.toBeDisabled();
  });
});

describe("FLW-11.01 TC-FLW-229 AT-FLW-25.4 보기 전용 참여자", () => {
  it("편집 권한이 없으면 노드를 골라도 잠금을 잡지 않고, 다른 보기 전용 참여자는 '(보기)'로 표시", async () => {
    const { container, sockets } = await renderEditor({ role: "ANALYST", detail: detailOf(coolingGraph()) });
    const socket = presenceSocket(sockets);
    act(() => socket.open());
    act(() => socket.emit({ type: "presence.snapshot", participants: [{ userId: "9", name: "B", readOnly: true }] }));
    fireEvent.click(nodeEl(container, "n-thr00001"));
    expect(socket.sent.some((m) => (m as { type: string }).type === "lock.acquire")).toBe(false);
    expect(screen.getByLabelText("함께 보고 있는 사람")).toHaveTextContent("B (보기)");
  });

  it("다른 사람이 저장하면(flow.updated) 다시 불러오기 안내, 연결이 끊기면 협업 끊김 띠", async () => {
    const onReload = vi.fn();
    const { sockets } = await renderEditor({ role: "OPERATOR", detail: detailOf(coolingGraph()), onReload });
    const socket = presenceSocket(sockets);
    act(() => socket.open());
    act(() => socket.emit({ type: "flow.updated", version: 15, by: { userId: "21", name: "A" } }));
    expect(screen.getByText(/A님이 v15을\(를\) 저장했습니다/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "다시 불러오기" }));
    expect(onReload).toHaveBeenCalled();
    act(() => socket.serverClose(1006));
    expect(screen.getByText("실시간 협업 연결이 끊겼습니다. 다시 연결 중…")).toBeInTheDocument();
  });
});

describe("FLW-11.06 UI-FLW-22 · UI-FLW-09 플로우 설명서·설정", () => {
  it("목적·책임자(나로 지정)·관련 공간·설명을 바꾼 키만 PATCH, 목적이 비면 저장 못 함", async () => {
    const api = fakeApi();
    const onReload = vi.fn();
    const detail = detailOf(coolingGraph(), { status: "ACTIVE", activeVersion: 13, draftVersion: null, purpose: "실습실 냉방", errorRateThreshold: 0.1 } as never);
    await renderEditor({ role: "OPERATOR", detail, api, onReload });
    await userEvent.click(screen.getByRole("tab", { name: "설정" }));
    const docs = await screen.findByRole("region", { name: "설명서" });
    const purpose = within(docs).getByLabelText("목적");
    await userEvent.clear(purpose);
    expect(within(docs).getByText("목적은 1~200자로 입력하세요")).toBeInTheDocument();
    expect(within(docs).getByRole("button", { name: "설정 저장" })).toBeDisabled();
    await userEvent.type(purpose, "실습실 냉방 자동화");
    await userEvent.click(within(docs).getByRole("button", { name: "나로 지정" }));
    await userEvent.selectOptions(within(docs).getByLabelText("관련 공간"), ["31"]);
    await userEvent.click(within(docs).getByRole("checkbox", { name: "DEGRADED면 자동 일시 정지" }));
    await userEvent.click(within(docs).getByRole("radio", { name: "보관 후 재개 때 처리(최대 1시간)" }));
    const rate = within(docs).getByLabelText("오류율 기준(%/5분)");
    await userEvent.clear(rate);
    await userEvent.type(rate, "15");
    await userEvent.click(within(docs).getByRole("button", { name: "설정 저장" }));
    expect(api.updateSettings).toHaveBeenCalledWith("f-7f3a", { purpose: "실습실 냉방 자동화", ownerUserId: "7", relatedSpaceIds: ["31"], pauseMode: "BUFFER", autoPauseOnDegraded: true, errorRateThreshold: 0.15 });
    expect(await within(docs).findByText("설정을 저장했습니다")).toBeInTheDocument();
    expect(onReload).toHaveBeenCalled();
  });

  it("실행 모드·변수 정의는 정의를 바꿔 저장 대상이 되고(버전에 포함), 변수 현재 값은 [값 초기화]", async () => {
    const api = fakeApi({ variables: vi.fn(() => Promise.resolve({ ok: true as const, status: 200, data: { responses: [{ name: "var1", type: "string", value: "hot" }] } })) });
    await renderEditor({ role: "OPERATOR", detail: detailOf(coolingGraph()), api });
    await userEvent.click(screen.getByRole("tab", { name: "설정" }));
    const exec = await screen.findByRole("region", { name: "실행 모드·변수" });
    await userEvent.click(within(exec).getByRole("radio", { name: "parallel(동시)" }));
    const max = within(exec).getByLabelText("최대 동시 실행");
    await userEvent.clear(max);
    await userEvent.type(max, "60");
    expect(within(exec).getByText("최대 동시 실행은 1~50입니다")).toBeInTheDocument();
    await userEvent.click(within(exec).getByRole("button", { name: "변수 추가" }));
    expect(screen.getByTitle("저장 안 된 변경")).toBeInTheDocument();
    expect(await within(exec).findByText("hot")).toBeInTheDocument();
    await userEvent.click(within(exec).getByRole("button", { name: "값 초기화" }));
    expect(api.resetVariable).toHaveBeenCalledWith("f-7f3a", "var1");
    expect(await screen.findByText("var1 변수 값을 초기화했습니다")).toBeInTheDocument();
  });

  it("설정 모델: 패치·검증·실행 모드·변수", () => {
    const base = settingsFormOf({ flowId: "f", name: "x", status: "ACTIVE", tags: ["a"], errorRateThreshold: 0.1 });
    expect(base.errorRatePercent).toBe("10");
    expect(settingsPatch(base, { ...base, tags: "a, b", description: "d", catchFlowId: " f-c " })).toEqual({ tags: ["a", "b"], description: "d", catchFlowId: "f-c" });
    expect(settingsPatch(base, { ...base, ownerUserId: "" })).toEqual({});
    expect(checkSettings({ ...base, purpose: "p", description: "x".repeat(4001), errorRatePercent: "0", catchFlowId: "f" }, "f")).toEqual({ description: "description", errorRatePercent: "errorRate", catchFlowId: "catchSelf" });
    expect(modeOf(undefined)).toEqual({ concurrency: "queued", keyBy: "deviceId", max: "10" });
    expect(modeOf({ concurrency: "parallel", keyBy: "spaceId", max: 5 })).toEqual({ concurrency: "parallel", keyBy: "spaceId", max: "5" });
    expect(modeProblem({ concurrency: "queued", keyBy: "deviceId", max: "999" })).toBeUndefined();
    expect(toMode({ concurrency: "parallel", keyBy: "flow", max: "5" })).toEqual({ concurrency: "parallel", keyBy: "flow", max: 5 });
    expect(variablesOf([{ name: "a", type: "weird", initial: 1 }, null, "x"])).toEqual([{ name: "a", type: "string", initial: 1 }]);
    expect(variablesOf(undefined)).toEqual([]);
    expect(variableProblems([{ name: "a b", type: "string", initial: "" }, { name: "x", type: "string", initial: "" }, { name: "x", type: "string", initial: "" }])).toEqual([
      { index: 0, rule: "name" },
      { index: 2, rule: "duplicate" },
    ]);
    expect(parseInitial("number", "3")).toBe(3);
    expect(parseInitial("number", "")).toBe(0);
    expect(parseInitial("boolean", "true")).toBe(true);
    expect(parseInitial("json", '{"a":1}')).toEqual({ a: 1 });
    expect(parseInitial("json", "{")).toBe("{");
    expect(parseInitial("string", "s")).toBe("s");
    // TC-FLW-276 책임자 없음: 비었거나 비활성 사용자. 필드가 오지 않으면 판단하지 않는다
    expect(ownerMissing({ ownerUserId: null })).toBe(true);
    expect(ownerMissing({ owner: { active: false } })).toBe(true);
    expect(ownerMissing({ owner: { active: true }, ownerUserId: "7" })).toBe(false);
    expect(ownerMissing({})).toBe(false);
  });
});
