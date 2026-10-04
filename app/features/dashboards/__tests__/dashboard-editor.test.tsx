/**
 * UI-DSH-04·05 대시보드 편집(TC-DSH-031, AT-DSH-04.1·04.6): 위젯 라이브러리로 추가, 끌어 놓기·크기 조정·복제·삭제(포인터·키보드),
 * 위젯 설정(대상·옵션 스키마 폼), 대시보드 설정(변수), 저장 본문 layout, 409 충돌 모달([다시 불러오기]·[내 변경 유지])
 */
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderRoute } from "../../../../test/render";
import type { SaveResult } from "../api";
import { DashboardEditor } from "../components/dashboard-editor";
import { draftOf } from "../model/transfer";
import type { Dashboard, WidgetTypeInfo } from "../model/types";
import { chartFactory, fakeFetcher } from "./fakes";

const TYPES: WidgetTypeInfo[] = [
  { type: "stat", label: "현재값", optionsSchema: { properties: { unit: { type: "string" }, decimals: { type: "integer", minimum: 0, maximum: 4 }, trend: { type: "boolean" }, thresholds: { type: "array" } } }, targetRule: { min: 1, max: 1, kinds: ["DEVICE_METRIC", "SPACE_AGGREGATE"] } },
  { type: "line", label: "선 차트", optionsSchema: { properties: { legend: { type: "string", enum: ["bottom", "right", "hidden"] }, yMin: { type: "number" } } }, targetRule: { min: 1, max: 20, kinds: ["DEVICE_METRIC", "SPACE_AGGREGATE"] } },
  { type: "markdown", label: "메모", optionsSchema: { properties: { content: { type: "string", maxLength: 10000 } } }, targetRule: { min: 0, max: 0, kinds: [] } },
];

const dashboard = (): Dashboard => ({
  id: "501",
  name: "실습실 운영",
  visibility: "ORG",
  layout: { widgets: [{ id: "w1", type: "stat", title: "CO2", x: 0, y: 0, w: 4, h: 4, targets: [{ kind: "SPACE_AGGREGATE", spaceId: "${space}", metricKey: "co2" }] }] },
  variables: [{ name: "space", type: "SPACE", default: "31" }],
  timeRange: { relative: "24h" },
  resolution: "AUTO",
  refresh: "LIVE",
  editable: true,
  version: 3,
});

function editor(save: (id: string, body: Record<string, unknown>) => Promise<SaveResult>) {
  const d = dashboard();
  const { fetcher, calls } = fakeFetcher(d.layout.widgets);
  const onSaved = vi.fn();
  const onReload = vi.fn();
  const onCancel = vi.fn();
  renderRoute(
    <DashboardEditor
      dashboard={d}
      draft={draftOf(d)}
      types={TYPES}
      timezone="Asia/Seoul"
      targetOptions={{ SPACE: [{ value: "31", label: "실습실" }], DEVICE: [{ value: "1042", label: "CO2 센서" }], METRIC: [{ value: "co2", label: "CO2" }] }}
      onSaved={onSaved}
      onCancel={onCancel}
      onReload={onReload}
      save={save}
      preview={fetcher}
      chartFactory={chartFactory().factory}
    />,
  );
  return { onSaved, onReload, onCancel, calls };
}

const okSave = () => vi.fn(async (_id: string, body: Record<string, unknown>): Promise<SaveResult> => ({ ok: true, dashboard: { ...dashboard(), ...(body as object), version: 4 } as Dashboard }));
const widgetsOf = (save: ReturnType<typeof okSave>, call = 0) => (save.mock.calls[call][1].layout as { widgets: { id: string; x: number; y: number; w: number; h: number; type: string; title?: string; options?: unknown; targets?: unknown }[] }).widgets;

describe("DSH-04.01 편집", () => {
  it("TC-DSH-031 AT-DSH-04.1: 라이브러리로 선 차트 추가 → 대상·옵션 설정 → 복제·삭제 → 저장 본문 layout과 baseVersion", async () => {
    const save = okSave();
    const { onSaved, calls } = editor(save);
    await waitFor(() => expect(calls.map((c) => c.id)).toContain("w1"));
    await userEvent.click(await screen.findByRole("button", { name: "선 차트 위젯 추가" }));
    // 새 위젯이 선택되고 설정 패널이 열린다(대상은 공간 변수로 미리 채움 없음: 기기 측정 항목)
    const deviceInput = screen.getByLabelText("기기 ID");
    await userEvent.type(deviceInput, "1042");
    await userEvent.type(screen.getByLabelText("측정 항목"), "co2");
    await userEvent.selectOptions(screen.getByLabelText("범례 위치"), "right");
    await userEvent.type(screen.getByLabelText("y축 최소"), "400");
    await userEvent.click(screen.getByRole("button", { name: "데이터 추가" }));
    await userEvent.selectOptions(screen.getAllByLabelText("대상 종류")[1], "SPACE_AGGREGATE");
    await userEvent.type(screen.getByLabelText("공간 ID"), "${{space}");
    await userEvent.type(screen.getAllByLabelText("측정 항목")[1], "co2");

    // 복제 후 원래 메모 하나 추가했다가 삭제
    await userEvent.click(screen.getByRole("button", { name: "선 차트 복제" }));
    await userEvent.click(screen.getByRole("button", { name: "메모 위젯 추가" }));
    await userEvent.click(screen.getByRole("button", { name: "메모 삭제" }));
    expect(screen.getByText("위젯 3/40개")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0][0]).toBe("501");
    expect(save.mock.calls[0][1]).toMatchObject({ baseVersion: 3, name: "실습실 운영", variables: [{ name: "space" }] });
    const widgets = widgetsOf(save);
    expect(widgets.map((w) => [w.id, w.type, w.x, w.y, w.w, w.h])).toEqual([
      ["w1", "stat", 0, 0, 4, 4],
      ["w2", "line", 4, 0, 12, 8],
      ["w3", "line", 0, 8, 12, 8],
    ]);
    expect(widgets[1]).toMatchObject({ options: { legend: "right", yMin: 400 }, targets: [{ kind: "DEVICE_METRIC", deviceId: "1042", metricKey: "co2" }, { kind: "SPACE_AGGREGATE", spaceId: "${space}", metricKey: "co2" }] });
    expect(onSaved).toHaveBeenCalled();
  });

  it("저장 전 검사: 이름 없음·대상 수·옵션 형식 오류는 요청 없이 문구로", async () => {
    const save = okSave();
    editor(save);
    await userEvent.clear(await screen.findByLabelText("이름"));
    await userEvent.click(screen.getByRole("button", { name: "현재값 위젯 추가" }));
    await userEvent.click(screen.getByRole("button", { name: "이 데이터 빼기" }));
    await userEvent.type(screen.getByLabelText("소수 자릿수"), "9");
    await userEvent.type(screen.getByLabelText("임계 색 구간"), "{{");
    expect(screen.getByText("JSON 형식이 올바르지 않습니다")).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText("임계 색 구간"));
    await userEvent.type(screen.getByLabelText("임계 색 구간"), "[[]");
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(save).not.toHaveBeenCalled();
    expect(screen.getAllByText("이름을 입력하세요").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/데이터를 1~1개 고르세요/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/옵션 값을 확인하세요\(options.decimals\)/).length).toBe(1);
  });

  it("AT-DSH-04.6 TC-DSH-031: 409면 '다른 사용자가 먼저 저장했습니다'와 [다시 불러오기]·[내 변경 유지](최신 판으로 다시 저장)", async () => {
    const save = vi
      .fn<(id: string, body: Record<string, unknown>) => Promise<SaveResult>>()
      .mockResolvedValueOnce({ ok: false, status: 409, code: "DASHBOARD_VERSION_CONFLICT", message: "", conflict: { version: 4, updatedByName: "이통합" } })
      .mockResolvedValueOnce({ ok: false, status: 400, code: "DASHBOARD_LAYOUT_INVALID", message: "" })
      .mockResolvedValueOnce({ ok: true, dashboard: dashboard() });
    const { onReload, onSaved } = editor(save);
    await userEvent.click(await screen.findByRole("button", { name: "저장" }));
    const dialog = await screen.findByRole("dialog", { name: "저장 충돌" });
    expect(within(dialog).getByText(/다른 사용자가 먼저 저장했습니다\(수정자: 이통합\)/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "다시 불러오기" }));
    expect(onReload).toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole("button", { name: "내 변경 유지" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1][1]).toMatchObject({ baseVersion: 4 });
    expect(await screen.findByText("위젯 배치가 올바르지 않습니다")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(save.mock.calls[2][1]).toMatchObject({ baseVersion: 4 });
  });

  it("TC-DSH-100: 키보드만으로 옮기기(화살표)·크기(Shift+화살표)·삭제(Delete), 막히면 안내", async () => {
    const save = okSave();
    editor(save);
    const widget = await screen.findByRole("region", { name: "CO2" });
    widget.focus();
    await userEvent.keyboard("{ArrowRight}{ArrowRight}{ArrowDown}");
    expect(screen.getByText("위치 2,1 크기 4×4")).toBeInTheDocument();
    await userEvent.keyboard("{Shift>}{ArrowRight}{/Shift}");
    expect(screen.getByText("위치 2,1 크기 5×4")).toBeInTheDocument();
    await userEvent.keyboard("{ArrowUp}{ArrowUp}");
    expect(screen.getByText("다른 위젯과 겹치거나 격자 밖이라 옮길 수 없습니다")).toBeInTheDocument();
    await userEvent.keyboard("a");
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(widgetsOf(save)[0]).toMatchObject({ x: 2, y: 0, w: 5, h: 4 });
    widget.focus();
    await userEvent.keyboard("{Delete}");
    expect(screen.queryByRole("region", { name: "CO2" })).toBeNull();
    expect(screen.getByText("CO2 위젯을 지웠습니다")).toBeInTheDocument();
  });

  it("TC-DSH-031: 포인터로 머리글을 끌어 옮기고 오른쪽 아래 손잡이로 크기 조정(칸 = (960+12)/24px)", async () => {
    const save = okSave();
    editor(save);
    const widget = await screen.findByRole("region", { name: "CO2" });
    const header = widget.querySelector("header") as HTMLElement;
    fireEvent.pointerDown(header, { clientX: 100, clientY: 100 });
    act(() => {
      window.dispatchEvent(new MouseEvent("pointermove", { clientX: 100 + 81, clientY: 100 + 104 }));
    });
    act(() => {
      window.dispatchEvent(new MouseEvent("pointerup"));
    });
    fireEvent.pointerDown(screen.getByTestId("resize-w1"), { clientX: 0, clientY: 0 });
    act(() => {
      window.dispatchEvent(new MouseEvent("pointermove", { clientX: 162, clientY: 52 }));
    });
    act(() => {
      window.dispatchEvent(new MouseEvent("pointerup"));
    });
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(widgetsOf(save)[0]).toMatchObject({ x: 2, y: 2, w: 8, h: 5 });
  });

  it("DSH-04.05: 대시보드 설정에서 변수·공개 범위·기본 범위를 바꾸고 적용(취소하면 그대로)", async () => {
    const save = okSave();
    const { onCancel } = editor(save);
    await userEvent.click(await screen.findByRole("button", { name: "대시보드 설정" }));
    let dialog = screen.getByRole("dialog", { name: "대시보드 설정" });
    await userEvent.click(within(dialog).getByRole("button", { name: "취소" }));
    await userEvent.click(screen.getByRole("button", { name: "대시보드 설정" }));
    dialog = screen.getByRole("dialog", { name: "대시보드 설정" });
    await userEvent.selectOptions(within(dialog).getByLabelText("공개 범위"), "PRIVATE");
    await userEvent.type(within(dialog).getByLabelText("설명"), "메모");
    await userEvent.selectOptions(within(dialog).getByLabelText("시간 범위"), "7d");
    await userEvent.selectOptions(within(dialog).getByLabelText("집계"), "1h");
    await userEvent.selectOptions(within(dialog).getByLabelText("새로고침"), "5m");
    await userEvent.click(within(dialog).getByRole("button", { name: "변수 추가" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "var2 변수 삭제" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "변수 추가" }));
    const names = within(dialog).getAllByLabelText("변수 이름");
    await userEvent.clear(names[1]);
    await userEvent.type(names[1], "device");
    await userEvent.selectOptions(within(dialog).getAllByLabelText("종류")[1], "DEVICE");
    await userEvent.type(within(dialog).getAllByLabelText("기본값")[1], "1042");
    await userEvent.click(within(dialog).getByRole("button", { name: "적용" }));
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls[0][1]).toMatchObject({ visibility: "PRIVATE", description: "메모", timeRange: { relative: "7d" }, resolution: "1h", refresh: "5m", variables: [{ name: "space" }, { name: "device", type: "DEVICE", default: "1042" }] });
    await userEvent.click(screen.getByRole("button", { name: "취소" }));
    expect(onCancel).toHaveBeenCalled();
  });
});
