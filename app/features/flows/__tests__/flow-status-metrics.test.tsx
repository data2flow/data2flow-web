/**
 * 플로우 지표(FLW-05.05, UI-FLW-10, API-FLW-14)와 섀도우 비교(FLW-06.08, UI-FLW-12).
 */
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { meOf, renderRoute } from "../../../../test/render";
import { MetricsPanel } from "../components/metrics-panel";
import { ShadowPanel, shadowProgress } from "../components/shadow-panel";
import type { FlowMetrics, ShadowStatus } from "../model/types";
import { coolingGraph, detailOf, fakeApi, renderEditor, stubReactFlowDom } from "./helpers";

beforeEach(() => stubReactFlowDom());

const M: FlowMetrics = {
  summary: { executions: 1000, errors: 20, errorRate: 0.02, avgMs: 1.24, p95Ms: 4.2, actions: { command: 9, notify: 3, sink: 0 }, droppedTriggers: 2 },
  nodes: [{ nodeId: "n-thr00001", processed: 1000, errors: 20, avgMs: 0.3 }],
  series: [
    { t: "2026-10-04T00:00:00Z", executions: 400, errors: 0 },
    { t: "2026-10-04T00:01:00Z", executions: 600, errors: 20 },
  ],
};
const nameOf = (id: string) => (id === "n-thr00001" ? "임계값" : id);

describe("FLW-05.05 TC-FLW-109 AT-FLW-10.4 플로우 지표", () => {
  it("1시간: 실행 1,000, 오류 20(2%), 평균·p95 소요 시간, 행동 수, 노드별 표", async () => {
    const metrics = vi.fn();
    await renderRoute(<MetricsPanel flowId="f-7f3a" api={{ metrics }} initial={M} nameOf={nameOf} />, { session: meOf("OPERATOR") });
    const region = await screen.findByRole("region", { name: "플로우 지표" });
    expect(within(region).getByText("실행 수").nextElementSibling).toHaveTextContent("1,000");
    expect(within(region).getByText("20 (2.0%)")).toBeInTheDocument();
    expect(within(region).getByText("평균 1.2ms · p95 4.2ms")).toBeInTheDocument();
    expect(within(region).getByText("제어 9 · 알림 3 · 저장 0")).toBeInTheDocument();
    expect(within(region).getByRole("cell", { name: "임계값" })).toBeInTheDocument();
    expect(within(region).getByRole("img", { name: "시간대별 실행 수" }).children).toHaveLength(2);
    expect(metrics).not.toHaveBeenCalled();
  });

  it("기간을 24시간으로 바꾸면 다시 부르고, 503 FLOW_METRICS_UNAVAILABLE이면 '지표 없음', 다른 오류는 문구", async () => {
    const metrics = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503, code: "FLOW_METRICS_UNAVAILABLE", message: "" })
      .mockResolvedValueOnce({ ok: false, status: 500, code: "INTERNAL_ERROR", message: "" })
      .mockResolvedValueOnce({ ok: true, status: 200, data: M });
    await renderRoute(<MetricsPanel flowId="f-7f3a" api={{ metrics }} initial={M} nameOf={nameOf} />, { session: meOf("OPERATOR") });
    await userEvent.selectOptions(await screen.findByLabelText("기간"), "24h");
    expect(await screen.findByText("지표 없음(플로우 엔진에 연결할 수 없습니다. 잠시 뒤 다시 확인하세요)")).toBeInTheDocument();
    expect(metrics).toHaveBeenCalledWith("f-7f3a", "24h");
    await userEvent.selectOptions(screen.getByLabelText("기간"), "7d");
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("기간"), "1h");
    expect(await screen.findByText("20 (2.0%)")).toBeInTheDocument();
  });

  it("편집기 [지표] 탭: 처음 지표가 없으면 바로 불러온다", async () => {
    const api = fakeApi({ metrics: vi.fn(() => Promise.resolve({ ok: true as const, status: 200, data: M })) });
    await renderEditor({ role: "ANALYST", detail: detailOf(coolingGraph(), { status: "ACTIVE", activeVersion: 13, draftVersion: null }), api });
    await userEvent.click(screen.getByRole("tab", { name: "지표" }));
    expect(await screen.findByText("20 (2.0%)")).toBeInTheDocument();
  });
});

const SHADOW: ShadowStatus = {
  status: "RUNNING",
  version: 14,
  startedAt: "2026-10-04T00:00:00Z",
  endsAt: "2026-10-04T01:00:00Z",
  stats: { branches: [{ nodeId: "n-thr00001", port: "true", active: 12, shadow: 16 }], actions: { active: { command: 3, notify: 0, sink: 0 }, shadow: { command: 7, notify: 0, sink: 0 } }, errors: { shadow: 0 } },
  diffs: [{ messageId: "m-9", at: "2026-10-04T00:12:03Z", active: { port: "false" }, shadow: { port: "true" } }],
};

describe("FLW-06.08 TC-FLW-156 AT-FLW-14.1 섀도우 비교", () => {
  it("v13 실행 중 v14 섀도우: 분기·행동 비교, 'v14였다면 제어 +4회', [중단]·[v14로 전환]", async () => {
    const onPromote = vi.fn();
    const onCancel = vi.fn();
    await renderRoute(<ShadowPanel shadow={SHADOW} activeVersion={13} now={Date.parse("2026-10-04T00:42:00Z")} timezone="Asia/Seoul" canWrite nameOf={nameOf} onPromote={onPromote} onCancel={onCancel} />, { session: meOf("OPERATOR") });
    expect(await screen.findByText("섀도우 비교 v13(실행) vs v14(섀도우)")).toBeInTheDocument();
    expect(screen.getByText("42분 경과 / 60분")).toBeInTheDocument();
    expect(screen.getByRole("row", { name: /분기 임계값 true 12 16 \+4/ })).toBeInTheDocument();
    expect(screen.getByText("v14였다면 제어 +4회")).toBeInTheDocument();
    expect(screen.getByText("결과가 달라진 메시지 1건")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "v14로 전환" }));
    await userEvent.click(screen.getByRole("button", { name: "중단" }));
    expect(onPromote).toHaveBeenCalledOnce();
    expect(onCancel).toHaveBeenCalledOnce();
    expect(shadowProgress({ status: "RUNNING" }, 0)).toBeNull();
  });

  it("편집기: 적용 대화상자에서 섀도우(10~1440분)로 먼저 실행 → apply에 shadow, 배너와 비교 탭, 전환하면 다시 불러온다", async () => {
    const shadow = vi.fn().mockResolvedValueOnce({ ok: false, status: 404, code: "RESOURCE_NOT_FOUND", message: "" }).mockResolvedValue({ ok: true, status: 200, data: SHADOW });
    const apply = vi.fn(() => Promise.resolve({ ok: true as const, status: 200, data: {} }));
    const endShadow = vi.fn(() => Promise.resolve({ ok: true as const, status: 204, data: undefined }));
    const onReload = vi.fn();
    const api = fakeApi({ shadow, apply, endShadow });
    await renderEditor({ role: "OPERATOR", detail: detailOf(coolingGraph(), { status: "ACTIVE", activeVersion: 13, draftVersion: 14 }), api, onReload });
    await userEvent.click(screen.getByRole("button", { name: "적용" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("checkbox", { name: "섀도우로 먼저 실행(실제 행동 없이 비교)" }));
    const minutes = within(dialog).getByLabelText("섀도우 기간(분)");
    await userEvent.clear(minutes);
    await userEvent.type(minutes, "5");
    expect(within(dialog).getByText("기간은 10~1440분입니다")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "섀도우 시작" })).toBeDisabled();
    await userEvent.clear(minutes);
    await userEvent.type(minutes, "60");
    await userEvent.click(within(dialog).getByRole("button", { name: "섀도우 시작" }));
    expect(apply).toHaveBeenCalledWith("f-7f3a", expect.objectContaining({ version: 14, baseVersion: 13, shadow: { durationMinutes: 60 } }));
    expect(await screen.findByText("v14을(를) 60분 동안 섀도우로 실행합니다")).toBeInTheDocument();
    expect(await screen.findByText("v14였다면 제어 +4회")).toBeInTheDocument();
    expect(screen.getByText(/v14 섀도우 진행 중입니다/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "v14로 전환" }));
    expect(endShadow).toHaveBeenCalledWith("f-7f3a", "promote");
    expect(await screen.findByText("v14로 전환했습니다")).toBeInTheDocument();
    expect(onReload).toHaveBeenCalled();
  });

  it("TC-FLW-157 섀도우 진행 중 일반 적용 → 409 FLOW_SHADOW_IN_PROGRESS 문구", async () => {
    const api = fakeApi({ apply: vi.fn(() => Promise.resolve({ ok: false as const, status: 409, code: "FLOW_SHADOW_IN_PROGRESS", message: "" })) });
    await renderEditor({ role: "OPERATOR", detail: detailOf(coolingGraph(), { status: "ACTIVE", activeVersion: 13, draftVersion: 14 }), api });
    await userEvent.click(screen.getByRole("button", { name: "적용" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "적용" }));
    expect(await within(dialog).findByText("섀도우 비교가 끝난 뒤 적용하세요")).toBeInTheDocument();
  });
});
