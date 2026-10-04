/**
 * UI-SCR-07 수식 항목 편집(SCR-01.06, TC-SCR-019): 측정 키 자동완성·칩, 입력 중 문법 검사와 오류 위치 밑줄, 미리 보기(API-SCR-21), 저장·수정·삭제(API-SCR-20).
 */
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { meOf, renderRoute } from "../../../../test/render";
import { FormulaEditor } from "../formula-editor";
import type { FormulaApi, FormulaMetric } from "../m5-api";

const chartFactory = vi.fn(async () => ({ setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn() }));
const ok = <T,>(data: T, status = 200) => ({ ok: true as const, status, data });
const fail = (code: string, status = 400) => ({ ok: false as const, status, code, message: "" });

const targets = {
  MODEL: [{ id: "11", name: "EM300-TH · 온습도" }],
  DEVICE: [{ id: "21", name: "AM107-1" }],
  SPACE: [{ id: "31", name: "본관 › 실습실" }],
};
const formulas: FormulaMetric[] = [{ id: "1", resultKey: "thi", displayName: "불쾌지수", unit: null, expression: "thi(temperature, humidity)", targetType: "MODEL", targetId: "11", targetName: "EM300-TH", status: "ACTIVE", version: 3 }];

function fakeApi(overrides: Partial<FormulaApi> = {}): FormulaApi {
  return {
    create: vi.fn(async (body) => ok({ id: "2", ...body, unit: body.unit ?? null, targetName: "x", version: 1 } as FormulaMetric, 201)),
    update: vi.fn(async (id, body) => ok({ id, ...body, version: 4 } as unknown as FormulaMetric)),
    remove: vi.fn(async () => ok(undefined as void, 204)),
    preview: vi.fn(async () => ok({ series: [{ t: "2026-10-03T00:00:00Z", value: 71.2 }], inputs: { temperature: [{ t: "2026-10-03T00:00:00Z", value: 27 }] } })),
    ...overrides,
  };
}

async function mount(api: FormulaApi, canWrite = true, onChanged = vi.fn()) {
  await renderRoute(<FormulaEditor formulas={formulas} targets={targets} metricKeys={["temperature", "humidity", "co2"]} canWrite={canWrite} timezone="Asia/Seoul" api={api} onChanged={onChanged} chartFactory={chartFactory} />, {
    session: meOf(canWrite ? "INTEGRATOR" : "OPERATOR"),
  });
  await screen.findByText("불쾌지수");
  return onChanged;
}

afterEach(() => vi.restoreAllMocks());

describe("SCR-01.06 TC-SCR-019 수식 항목 편집기", () => {
  it("AT-SCR-06.3 측정 키 자동완성, 오타 'temprature' → 오류 문구와 위치 밑줄, 고치면 미리 보기·저장", async () => {
    const api = fakeApi();
    const onChanged = await mount(api);
    await userEvent.click(screen.getByRole("button", { name: "새 수식" }));
    const box = screen.getByLabelText("수식") as HTMLTextAreaElement;
    await userEvent.type(box, "temp");
    const options = within(screen.getByRole("listbox", { name: "자동완성" })).getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["temperature"]);
    await userEvent.click(options[0]);
    expect(box.value).toBe("temperature");

    fireEvent.change(box, { target: { value: "temprature * 2", selectionStart: 14 } });
    expect(screen.getByRole("alert")).toHaveTextContent("알 수 없는 측정 항목: temprature (1:1)");
    expect(screen.getByTestId("formula-error-mark")).toHaveTextContent("temprature");
    expect(screen.getByRole("button", { name: "미리 보기" })).toBeDisabled();

    fireEvent.change(box, { target: { value: "thi(temperature, humidity)" } });
    expect(screen.queryByTestId("formula-error-mark")).toBeNull();
    await userEvent.type(screen.getByLabelText("결과 키"), "thi2");
    await userEvent.type(screen.getByLabelText("표시 이름"), "불쾌지수2");
    await userEvent.click(screen.getByRole("button", { name: "미리 보기" }));
    expect(api.preview).toHaveBeenCalledWith({ expression: "thi(temperature, humidity)", targetType: "MODEL", targetId: "11", hours: 24 });
    expect(await screen.findByRole("figure", { name: "수식 미리 보기" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "저장·배포" }));
    expect(api.create).toHaveBeenCalledWith({ resultKey: "thi2", displayName: "불쾌지수2", expression: "thi(temperature, humidity)", targetType: "MODEL", targetId: "11", status: "ACTIVE" });
    expect(await screen.findByText("thi2을 저장했습니다. 다음 메시지부터 계산합니다.")).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalled();
  });

  it("결과 키 중복(표준 키·다른 수식)·형식, 표시 이름 필수, 서버 SCRIPT_FORMULA_KEY_CONFLICT", async () => {
    const api = fakeApi({ create: vi.fn(async () => fail("SCRIPT_FORMULA_KEY_CONFLICT", 409)) });
    await mount(api);
    await userEvent.click(screen.getByRole("button", { name: "새 수식" }));
    fireEvent.change(screen.getByLabelText("수식"), { target: { value: "co2 * 1" } });
    await userEvent.type(screen.getByLabelText("결과 키"), "temperature");
    await userEvent.click(screen.getByRole("button", { name: "저장·배포" }));
    expect(screen.getByText("이미 있는 측정 항목입니다")).toBeInTheDocument();
    expect(screen.getByText("표시 이름을 1~80자로 입력하세요")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("결과 키"), { target: { value: "thi" } });
    await userEvent.click(screen.getByRole("button", { name: "저장·배포" }));
    expect(screen.getByText("이미 있는 측정 항목입니다")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("결과 키"), { target: { value: "9x" } });
    await userEvent.click(screen.getByRole("button", { name: "저장·배포" }));
    expect(screen.getByText(/결과 키는 영문으로 시작하는/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("결과 키"), { target: { value: "co2_x" } });
    await userEvent.type(screen.getByLabelText("표시 이름"), "CO2 x");
    await userEvent.click(screen.getByRole("button", { name: "저장·배포" }));
    expect(await screen.findByText("이미 있는 측정 항목입니다")).toBeInTheDocument();
    expect(api.create).toHaveBeenCalledTimes(1);
  });

  it("대상 유형 바꾸기·칩으로 넣기·창 수식, 수정은 baseVersion으로 PUT(409 안내), 삭제", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const api = fakeApi({ update: vi.fn(async () => fail("VERSION_CONFLICT", 409)) });
    const onChanged = await mount(api);
    await userEvent.click(screen.getByRole("button", { name: "편집" }));
    expect(screen.getByLabelText("결과 키")).toBeDisabled();
    await userEvent.selectOptions(screen.getByLabelText("대상 유형"), "SPACE");
    expect(screen.getByLabelText("적용 대상")).toHaveValue("31");
    await userEvent.click(screen.getByText("측정 키·함수 넣기"));
    const box = screen.getByLabelText("수식") as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "", selectionStart: 0 } });
    await userEvent.click(screen.getByRole("button", { name: "rolling_mean()" }));
    await userEvent.click(screen.getByRole("button", { name: "co2" }));
    await userEvent.type(box, ", 10m)");
    expect(box.value).toBe("rolling_mean(co2, 10m)");
    await userEvent.click(screen.getByRole("button", { name: "저장·배포" }));
    expect(api.update).toHaveBeenCalledWith("1", expect.objectContaining({ expression: "rolling_mean(co2, 10m)", targetType: "SPACE", targetId: "31", baseVersion: 3 }));
    expect(await screen.findByText("다른 사용자가 먼저 바꿨습니다. 새로 고친 뒤 다시 저장하세요.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "삭제" }));
    expect(api.remove).toHaveBeenCalledWith("1");
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it("미리 보기 데이터 없음·오류, 조회 전용(OPERATOR)은 작성 버튼 없음, 빈 목록 안내", async () => {
    const api = fakeApi({ preview: vi.fn().mockResolvedValueOnce(ok({ series: [], inputs: {} })).mockResolvedValueOnce(fail("INVALID_REQUEST")) });
    await mount(api);
    await userEvent.click(screen.getByRole("button", { name: "새 수식" }));
    fireEvent.change(screen.getByLabelText("수식"), { target: { value: "c2f(temperature)" } });
    await userEvent.selectOptions(screen.getByLabelText("미리 보기 기간"), "6");
    await userEvent.click(screen.getByRole("button", { name: "미리 보기" }));
    expect(await screen.findByText("이 기간에 계산할 데이터가 없습니다")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "미리 보기" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "취소" }));
    expect(screen.queryByLabelText("수식")).toBeNull();
  });

  it("OPERATOR: 목록만", async () => {
    await mount(fakeApi(), false);
    expect(screen.queryByRole("button", { name: "새 수식" })).toBeNull();
    expect(screen.queryByRole("button", { name: "편집" })).toBeNull();
  });
});
