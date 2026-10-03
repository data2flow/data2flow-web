/**
 * 카탈로그 화면 부품: 속성 스키마 편집(DEV-07.05), 별칭 변환 진행률(DEV-04.02), 그룹 조건 작성기·기기 선택(DEV-06.01, UI-DEV-11),
 * 모델·측정 항목 입력 칸(UI-DEV-08·09).
 */
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderRoute } from "../../../../../test/render";
import { AttributeSchemaEditor } from "../attribute-schema-editor";
import { GroupFormBody } from "../group-form";
import { CriteriaBuilder, DevicePicker, type Preview } from "../group-editor";
import { MetricFields } from "../metric-fields";
import { ModelFields } from "../model-fields";
import { RemapProgress } from "../remap-progress";

afterEach(() => vi.useRealTimers());

const models = [
  { id: "11", code: "EM300-TH", name: "EM300-TH" },
  { id: "12", code: "AM107", name: "AM107" },
];
const spaces = [{ id: "1", type: "SITE", name: "광주캠퍼스", children: [{ id: "3", type: "FLOOR", name: "3층" }] }];
const empty = { modelIds: [], spaceIds: [], includeDescendants: true, tags: [], tagMatch: "any" as const, statuses: [] };

describe("DEV-07.05 속성 스키마 편집", () => {
  it("문법 오류·형식 오류를 보이고, 올바르면 폼 미리 보기로 기기 입력값을 검증한다", async () => {
    await renderRoute(<AttributeSchemaEditor initial='{"type":"object","properties":{"serialNo":{"type":"string"},"setpoint":{"type":"number","unit":"℃"}},"required":["serialNo"]}' />);
    expect(await screen.findByText("스키마가 올바릅니다(속성 2개)")).toBeInTheDocument();
    expect(screen.getByText("값을 넣어 기기 입력값을 검증해 보세요")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/setpoint/), "warm");
    expect(screen.getByText("number 형식이어야 합니다")).toBeInTheDocument();
    expect(screen.getByText("필수 값입니다")).toBeInTheDocument();
    expect(screen.getByText("2개 값이 스키마에 맞지 않습니다")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/serialNo/), "SN-1");
    await userEvent.clear(screen.getByLabelText(/setpoint/));
    await userEvent.type(screen.getByLabelText(/setpoint/), "24");
    expect(screen.getByText("입력값이 스키마에 맞습니다")).toBeInTheDocument();
    const box = screen.getByLabelText("속성 스키마(JSON Schema)");
    await userEvent.clear(box);
    await userEvent.type(box, "{{oops");
    expect(screen.getByRole("alert")).toHaveTextContent("JSON 문법이 올바르지 않습니다");
    expect(document.querySelector('input[name="attributeSchema"]')).toHaveValue("{oops");
  });

  it("빈 스키마는 속성 없음", async () => {
    await renderRoute(<AttributeSchemaEditor initial="" readOnly />);
    expect(await screen.findByText("속성이 없습니다.")).toBeInTheDocument();
  });
});

describe("DEV-04.02 별칭 연결 뒤 과거 데이터 변환 진행률", () => {
  it("끝날 때까지 2초마다 조회(가짜 타이머)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const answers = [
      { ok: true as const, status: 200, data: { status: "RUNNING", processed: 500, total: 1000 } },
      { ok: true as const, status: 200, data: { status: "SUCCEEDED", processed: 1000, total: 1000 } },
    ];
    const fetchJob = vi.fn(async () => answers.shift()!);
    await renderRoute(<RemapProgress jobId="9" fetchJob={fetchJob} />);
    expect(await screen.findByText("변환 중 500 / 1000")).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(await screen.findByText("변환을 마쳤습니다(1000건)")).toBeInTheDocument();
    expect(fetchJob).toHaveBeenCalledTimes(2);
  });

  it("조회 실패·변환 실패 안내", async () => {
    const { unmount } = await renderRoute(<RemapProgress jobId="9" fetchJob={async () => ({ ok: false, status: 404, code: "RESOURCE_NOT_FOUND", message: "" })} />);
    expect(await screen.findByText("변환 진행 상태를 불러오지 못했습니다.")).toBeInTheDocument();
    unmount();
    await renderRoute(<RemapProgress jobId="9" fetchJob={async () => ({ ok: true, status: 200, data: { status: "FAILED", processed: 1, total: 0 } })} />);
    expect(await screen.findByText("변환에 실패했습니다. 다시 시도해 주세요.")).toBeInTheDocument();
  });
});

describe("DEV-06.01 TC-DEV-167 동적 그룹 조건 작성기와 미리 보기(API-DEV-33)", () => {
  it("조건이 없으면 안내, 고르면 300ms 뒤 미리 보기(현재 일치 n대·예시), 숨은 필드 criteria", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const preview = vi.fn(async (): Promise<{ ok: true; status: number; data: Preview }> => ({ ok: true, status: 200, data: { count: 2, sample: [{ id: "1", name: "EM500-CO2-152590" }, { id: "2", name: "AM107-067999" }] } }));
    const onCount = vi.fn();
    await renderRoute(<CriteriaBuilder models={models} spaces={spaces} initial={empty} preview={preview} onCount={onCount} />);
    expect(await screen.findByText("조건을 1개 이상 지정하면 일치하는 기기를 미리 보여 줍니다")).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText("AM107"));
    await userEvent.click(screen.getByLabelText("광주캠퍼스 › 3층"));
    await userEvent.type(screen.getByLabelText("태그"), "pilot");
    await userEvent.selectOptions(screen.getByLabelText("태그 일치"), "all");
    await userEvent.click(screen.getByLabelText("사용 중"));
    await userEvent.click(screen.getByLabelText("하위 공간 포함"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(await screen.findByText(/현재 일치: 2대/)).toBeInTheDocument();
    expect(screen.getByText(/EM500-CO2-152590 · AM107-067999/)).toBeInTheDocument();
    expect(preview).toHaveBeenLastCalledWith({ modelIds: ["12"], spaceIds: ["3"], includeDescendants: false, tags: { match: "all", values: ["pilot"] }, statuses: ["ACTIVE"] });
    expect(onCount).toHaveBeenLastCalledWith(2);
    expect(JSON.parse((document.querySelector('input[name="criteria"]') as HTMLInputElement).value)).toMatchObject({ modelIds: ["12"] });
    await userEvent.click(screen.getByLabelText("AM107"));
  });

  it("TC-DEV-087 1,000대를 넘으면 '그룹에는 1,000대까지 넣을 수 있습니다', 다른 오류는 문구", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const onCount = vi.fn();
    const { unmount } = await renderRoute(<CriteriaBuilder models={models} spaces={spaces} initial={{ ...empty, statuses: ["ACTIVE"] }} debounceMs={0} onCount={onCount} preview={async () => ({ ok: false, status: 400, code: "GROUP_SIZE_EXCEEDED", message: "" })} />);
    expect(await screen.findByText("그룹에는 1,000대까지 넣을 수 있습니다")).toBeInTheDocument();
    expect(onCount).toHaveBeenLastCalledWith(1001);
    unmount();
    const second = await renderRoute(<CriteriaBuilder models={models} spaces={spaces} initial={{ ...empty, statuses: ["ACTIVE"] }} debounceMs={0} preview={async () => ({ ok: true, status: 200, data: { count: 1500, sample: [] } })} />);
    expect(await screen.findByText("그룹에는 1,000대까지 넣을 수 있습니다")).toBeInTheDocument();
    second.unmount();
    await renderRoute(<CriteriaBuilder models={models} spaces={spaces} initial={{ ...empty, statuses: ["ACTIVE"] }} debounceMs={0} preview={async () => ({ ok: false, status: 503, code: "SERVICE_UNAVAILABLE", message: "" })} />);
    expect(await screen.findByText("일시적으로 이용할 수 없습니다. 잠시 후 다시 시도해 주세요.")).toBeInTheDocument();
  });
});

describe("DEV-06.01 TC-DEV-166 정적 그룹 기기 선택", () => {
  it("검색 → 추가 → 숨은 deviceIds, 선택 해제, 결과 없음·실패", async () => {
    const search = vi.fn(async (q: string) =>
      q === "none" ? { ok: true as const, status: 200, data: { responses: [] } } : q === "err" ? { ok: false as const, status: 503, code: "SERVICE_UNAVAILABLE", message: "" } : { ok: true as const, status: 200, data: { responses: [{ id: "1042", name: "AM107-067999", externalId: "24e124707c067999" }] } },
    );
    await renderRoute(<DevicePicker search={search} initial={[{ id: "1", name: "EM300-TH-151606" }]} />);
    await userEvent.type(await screen.findByLabelText("기기 검색(이름·외부 ID)"), "AM107{Enter}");
    expect(search).toHaveBeenCalledWith("AM107");
    await userEvent.click(screen.getByRole("button", { name: "추가" }));
    expect(screen.getByRole("button", { name: "추가" })).toBeDisabled();
    expect([...document.querySelectorAll('input[name="deviceIds"]')].map((i) => (i as HTMLInputElement).value)).toEqual(["1", "1042"]);
    expect(screen.getByText("선택한 기기 2대")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "EM300-TH-151606 선택 해제" }));
    expect(screen.getByText("선택한 기기 1대")).toBeInTheDocument();
    const box = screen.getByLabelText("기기 검색(이름·외부 ID)");
    await userEvent.clear(box);
    await userEvent.type(box, "none");
    await userEvent.click(screen.getByRole("button", { name: "검색" }));
    expect(await screen.findByText("검색 결과가 없습니다")).toBeInTheDocument();
    await userEvent.clear(box);
    await userEvent.type(box, "err{Enter}");
    expect(await screen.findByText("요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.")).toBeInTheDocument();
  });

  it("그룹 폼: 유형을 바꾸면 기기 선택 ↔ 조건 작성기, 오류 문구", async () => {
    await renderRoute(<GroupFormBody models={models} spaces={spaces} creating fieldErrors={{ name: "nameRequired", criteria: "criteriaRequired" }} />);
    expect(await screen.findByLabelText("기기 검색(이름·외부 ID)")).toBeInTheDocument();
    expect(screen.getByText("이름을 입력하세요(100자 이하)")).toBeInTheDocument();
    expect(screen.getByText("조건을 1개 이상 지정하세요")).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("유형"), "DYNAMIC");
    expect(screen.getByLabelText("하위 공간 포함")).toBeInTheDocument();
  });

  it("편집 폼은 유형을 바꿀 수 없다(숨은 값)", async () => {
    await renderRoute(<GroupFormBody group={{ id: "61", name: "3층", type: "DYNAMIC", criteria: { statuses: ["ACTIVE"] } }} models={models} spaces={spaces} creating={false} fieldErrors={{ deviceIds: "groupLimit" }} />);
    expect(await screen.findByDisplayValue("3층")).toBeInTheDocument();
    expect(document.querySelector('input[name="type"]')).toHaveValue("DYNAMIC");
    expect(screen.getByLabelText("사용 중")).toBeChecked();
    expect(screen.getByText("그룹에는 1,000대까지 넣을 수 있습니다")).toBeInTheDocument();
  });
});

describe("UI-DEV-08·09 입력 칸", () => {
  it("모델: 새로 만들 때만 코드·측정 항목, 오류 문구", async () => {
    await renderRoute(<ModelFields metrics={[{ id: "101", key: "temperature", version: 1 }]} creating fieldErrors={{ code: "modelCode", metrics: "sensorMetric" }} />);
    expect(await screen.findByText("코드는 영문 대문자·숫자로 시작하는 50자 이하")).toBeInTheDocument();
    expect(screen.getByText("센서 모델은 측정 항목이 1개 이상 있어야 합니다")).toBeInTheDocument();
    expect(screen.getByLabelText("temperature")).toBeInTheDocument();
  });

  it("측정 항목: ENUM을 고르면 값 매핑 칸, 키 오류 문구", async () => {
    await renderRoute(<MetricFields creating fieldErrors={{ key: "metricKey", validMin: "minMax" }} metric={{ enumMap: { open: 1 } }} />);
    expect(await screen.findByText("측정 항목 키는 영문 소문자로 시작하는 64자 이하여야 합니다")).toBeInTheDocument();
    expect(screen.getByText("최소값이 최대값보다 큽니다")).toBeInTheDocument();
    expect(screen.queryByLabelText("값 매핑(라벨=숫자)")).toBeNull();
    await userEvent.selectOptions(screen.getByLabelText("값 형식"), "ENUM");
    await waitFor(() => expect(screen.getByLabelText("값 매핑(라벨=숫자)")).toHaveValue("open=1"));
  });
});
