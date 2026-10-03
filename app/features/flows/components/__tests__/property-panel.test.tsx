import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { meOf, renderRoute } from "../../../../../test/render";
import { catalog, fakeApi, SPACES, textareaFactory } from "../../__tests__/helpers";
import type { FlowNode, NodeType } from "../../model/types";
import { catalogOf } from "../../model/flow-graph";
import { checkArg, commandArgs } from "../control-fields";
import { PropertyPanel, type PanelContext } from "../property-panel";
import { countTargets } from "../target-field";

const devices = [
  { id: "1042", name: "AM107-067999", spaceId: "31", modelId: "12", tags: ["pilot"] },
  { id: "1043", name: "EM300-TH", spaceId: "3", modelId: "11", tags: [] },
];

function Harness({ initial, cat = catalog, readOnly = false, spy }: { initial: FlowNode; cat?: ReturnType<typeof catalogOf>; readOnly?: boolean; spy?: (n: FlowNode) => void }) {
  const [node, setNode] = useState(initial);
  const ctx: PanelContext = { spaces: SPACES, devices, models: [{ id: "12", name: "AM107" }], metricKeys: ["temperature"], api: fakeApi(), editorFactory: textareaFactory };
  return (
    <PropertyPanel
      node={node}
      catalog={cat}
      readOnly={readOnly}
      ctx={ctx}
      onChange={(patch) => {
        const next = { ...node, ...patch };
        setNode(next);
        spy?.(next);
      }}
    />
  );
}

const node = (type: string, config: Record<string, unknown> = {}, name = "노드"): FlowNode => ({ id: "n-test0001", type, typeVersion: 1, name, config, position: { x: 0, y: 0 } });
const render = (el: React.ReactElement) => renderRoute(el, { session: meOf("INTEGRATOR") });

describe("FLW-01.02 UI-FLW-16 설정 폼(스키마 자동 생성)", () => {
  it("임계값 '27℃ 이상 5분': 측정 항목·연산자·값·지속(숫자+단위 → PT5M)·해제", async () => {
    const spy = vi.fn();
    await render(<Harness initial={node("condition.threshold", { op: ">" }, "온도>27")} spy={spy} />);
    const panel = await screen.findByRole("region", { name: "온도>27 설정" });
    await userEvent.type(within(panel).getByRole("combobox", { name: "측정 항목" }), "temperature");
    await userEvent.selectOptions(within(panel).getByRole("combobox", { name: "연산자" }), ">=");
    await userEvent.type(within(panel).getByRole("spinbutton", { name: "값" }), "27");
    await userEvent.type(within(panel).getByRole("spinbutton", { name: "지속" }), "5");
    await userEvent.type(within(panel).getByRole("spinbutton", { name: "해제 값" }), "26");
    expect(spy.mock.lastCall?.[0].config).toEqual({ metric: "temperature", op: ">=", value: 27, for: "PT5M", clear: 26 });
    await userEvent.selectOptions(within(panel).getByRole("combobox", { name: "지속 단위" }), "h");
    expect(spy.mock.lastCall?.[0].config.for).toBe("PT5H");
    await userEvent.clear(within(panel).getByRole("spinbutton", { name: "지속" }));
    await userEvent.type(within(panel).getByRole("spinbutton", { name: "지속" }), "30");
    expect(within(panel).getByText("1초~24시간 사이로 입력하세요")).toBeInTheDocument();
    await userEvent.clear(within(panel).getByRole("spinbutton", { name: "지속" }));
    expect(spy.mock.lastCall?.[0].config.for).toBeUndefined();
    // 반복은 1~100
    await userEvent.type(within(panel).getByRole("spinbutton", { name: "반복" }), "0");
    expect(within(panel).getByText("1 이상이어야 합니다")).toBeInTheDocument();
    // 재시도 0~10
    await userEvent.type(within(panel).getByRole("spinbutton", { name: "재시도 횟수(0~10)" }), "11");
    expect(within(panel).getByText("10 이하여야 합니다")).toBeInTheDocument();
    await userEvent.type(within(panel).getByRole("spinbutton", { name: "간격(ms)" }), "500");
    await userEvent.type(within(panel).getByRole("spinbutton", { name: "시간 제한(ms)" }), "5000");
    expect(spy.mock.lastCall?.[0].retry).toEqual({ maxAttempts: 11, intervalMs: 500, timeoutMs: 5000 });
    // 이름 필수
    await userEvent.clear(within(panel).getByRole("textbox", { name: "노드 이름" }));
    expect(within(panel).getByText("필수 입력입니다")).toBeInTheDocument();
    await userEvent.type(within(panel).getByRole("textbox", { name: "설명" }), "설명");
    expect(spy.mock.lastCall?.[0].description).toBe("설명");
  });

  it("트리거 대상 위젯: 공간+관계+하위 포함 → 현재 대상 N대, 기기·모델·태그 방식", async () => {
    const spy = vi.fn();
    await render(<Harness initial={node("trigger.telemetry", {}, "온도 트리거")} spy={spy} />);
    const panel = await screen.findByRole("region", { name: "온도 트리거 설정" });
    const target = within(panel).getByRole("group", { name: "대상" });
    await userEvent.selectOptions(within(target).getByRole("combobox", { name: "공간" }), "3");
    expect(within(target).getByText("현재 대상 1대")).toBeInTheDocument();
    await userEvent.click(within(target).getByRole("checkbox", { name: "하위 공간 포함" }));
    expect(within(target).getByText("현재 대상 2대")).toBeInTheDocument();
    expect(spy.mock.lastCall?.[0].config.target).toEqual({ spaceId: "3", relation: "measures", includeChildren: true });
    await userEvent.selectOptions(within(target).getByRole("combobox", { name: "관계" }), "controls");
    await userEvent.selectOptions(within(target).getByRole("combobox", { name: "대상 지정 방식" }), "devices");
    await userEvent.click(within(target).getByRole("checkbox", { name: "AM107-067999" }));
    expect(within(target).getByText("현재 대상 1대")).toBeInTheDocument();
    await userEvent.click(within(target).getByRole("checkbox", { name: "AM107-067999" }));
    await userEvent.selectOptions(within(target).getByRole("combobox", { name: "대상 지정 방식" }), "model");
    await userEvent.selectOptions(within(target).getByRole("combobox", { name: "기기 모델" }), "12");
    expect(within(target).getByText("현재 대상 1대")).toBeInTheDocument();
    await userEvent.selectOptions(within(target).getByRole("combobox", { name: "대상 지정 방식" }), "tags");
    await userEvent.type(within(target).getByRole("textbox", { name: "태그(쉼표로 구분)" }), "pilot, x");
    expect(spy.mock.lastCall?.[0].config.target).toEqual({ tags: ["pilot", "x"] });
    expect(within(target).getByText("현재 대상 1대")).toBeInTheDocument();
    // 측정 항목(배열, 쉼표)
    await userEvent.type(within(panel).getByRole("combobox", { name: "측정 항목" }), "temperature, co2");
    expect(spy.mock.lastCall?.[0].config.metrics).toEqual(["temperature", "co2"]);
    expect(countTargets(undefined, devices, SPACES)).toBe(0);
    expect(countTargets({ spaceId: "" }, devices, SPACES)).toBe(0);
  });

  it("제어 위젯: Thermostat → set → mode·목표 온도(5~35, 0.5 단위), 범위 밖은 입력 단계에서 거부", async () => {
    const spy = vi.fn();
    await render(<Harness initial={node("action.control", { validitySeconds: 600 }, "에어컨 냉방")} spy={spy} />);
    const panel = await screen.findByRole("region", { name: "에어컨 냉방 설정" });
    await userEvent.selectOptions(await within(panel).findByRole("combobox", { name: "기능" }), "Thermostat");
    await userEvent.selectOptions(await within(panel).findByRole("combobox", { name: "명령" }), "set");
    await userEvent.selectOptions(within(panel).getByRole("combobox", { name: "mode" }), "cool");
    const temp = within(panel).getByRole("spinbutton", { name: "targetTemperature (°C)" });
    await userEvent.type(temp, "40");
    expect(within(panel).getByText("5~35°C 사이로 설정하세요")).toBeInTheDocument();
    expect(spy.mock.lastCall?.[0].config.args).toEqual({ mode: "cool" });
    await userEvent.clear(temp);
    await userEvent.type(temp, "24.3");
    expect(within(panel).getByText("0.5 단위로 입력하세요")).toBeInTheDocument();
    await userEvent.clear(temp);
    await userEvent.type(temp, "24");
    expect(spy.mock.lastCall?.[0].config).toMatchObject({ capability: "Thermostat", command: "set", args: { mode: "cool", targetTemperature: 24 } });
    expect(within(panel).queryByRole("spinbutton", { name: /currentTemperature/ })).toBeNull();
    // 대상 위젯 기본 관계는 controls
    expect(within(within(panel).getByRole("group", { name: "대상" })).getByRole("combobox", { name: "관계" })).toHaveValue("controls");
  });

  it("JS 함수 노드: 코드 편집기(Monaco 대역)·출력 수·크기 표시, 읽기 전용", async () => {
    const spy = vi.fn();
    await render(<Harness initial={node("transform.js", { code: "function main(msg){ return msg; }", outputs: 1 }, "보정")} spy={spy} />);
    const panel = await screen.findByRole("region", { name: "보정 설정" });
    const editor = within(panel).getByRole("textbox", { name: "코드" });
    await userEvent.type(editor, "//");
    expect(spy.mock.lastCall?.[0].config.code).toContain("//");
    expect(within(panel).getByText(/바이트$/)).toBeInTheDocument();
    await userEvent.clear(within(panel).getByRole("spinbutton", { name: "출력 수(1~10)" }));
    await userEvent.type(within(panel).getByRole("spinbutton", { name: "출력 수(1~10)" }), "11");
    expect(within(panel).getByText("10 이하여야 합니다")).toBeInTheDocument();
  });

  it("스키마 위젯: 불리언·객체(JSON)·문자열, 읽기 전용", async () => {
    const custom: NodeType = { type: "test.widgets", typeVersion: 1, category: "transform", name: "위젯", inputs: [{ name: "in", type: "any" }], outputs: [{ name: "out", type: "any" }], configSchema: { type: "object", properties: { enabled: { type: "boolean", title: "사용" }, mapping: { type: "object", title: "매핑" }, label: { type: "string", title: "라벨" } } } };
    const spy = vi.fn();
    const { unmount } = await render(<Harness initial={node("test.widgets")} cat={catalogOf([custom])} spy={spy} />);
    const panel = await screen.findByRole("region", { name: "노드 설정" });
    await userEvent.click(within(panel).getByRole("checkbox", { name: "사용" }));
    await userEvent.type(within(panel).getByRole("textbox", { name: "라벨" }), "a");
    const mapping = within(panel).getByRole("textbox", { name: "매핑" });
    await userEvent.type(mapping, '{{"a":1}');
    expect(spy.mock.lastCall?.[0].config).toEqual({ enabled: true, label: "a", mapping: { a: 1 } });
    await userEvent.type(mapping, "x");
    expect(within(panel).getByText("형식이 맞지 않습니다(object)")).toBeInTheDocument();
    unmount();
    await render(<Harness initial={node("test.widgets", { label: "b" })} cat={catalogOf([custom])} readOnly />);
    expect(await screen.findByText("보기 전용입니다")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "라벨" })).toBeDisabled();
  });
});

describe("제어 인자 검사 함수", () => {
  it("enum·boolean·integer·step·문자열", () => {
    expect(checkArg({ name: "m", type: "enum", enum: ["a"] }, "b")).toEqual({ problem: "enum" });
    expect(checkArg({ name: "m", type: "enum", enum: ["a"] }, "a")).toEqual({ value: "a" });
    expect(checkArg({ name: "on", type: "boolean" }, "true")).toEqual({ value: true });
    expect(checkArg({ name: "l", type: "integer", min: 1, max: 3 }, "1.5")).toEqual({ problem: "number" });
    expect(checkArg({ name: "l", type: "integer", min: 1, max: 3 }, "2")).toEqual({ value: 2 });
    expect(checkArg({ name: "s", type: "string" }, "x")).toEqual({ value: "x" });
    expect(commandArgs(null, "set")).toEqual([]);
    expect(commandArgs({ name: "X", attributes: [{ name: "a", type: "number" }, { name: "b", type: "number", readOnly: true }], commands: [{ name: "go" }] }, "go").map((a) => a.name)).toEqual(["a"]);
  });
});
