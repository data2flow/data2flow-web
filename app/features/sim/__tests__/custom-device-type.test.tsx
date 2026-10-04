/**
 * UI-SIM-14 사용자 정의 가상 기기 유형(SIM-09.06): TC-SIM-103 — 측정 항목·기능 선택, 특성 정의 입력, 저장 본문. AT-SIM-14.1
 */
import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { meOf, renderRoute } from "../../../../test/render";
import { TypeEditor } from "../components/type-editor";
import { draftFromType, emptyDef, enumList, typeBody, validateDraft, type TypeDraft } from "../model/custom-type";
import type { SimType } from "../model/types";

const voc: TypeDraft = {
  name: "VOC 센서",
  category: "SENSOR",
  icon: "",
  description: "",
  linkedModelCode: "am107",
  metrics: [{ key: "tvoc", source: "GENERATOR" }],
  capabilities: [],
  defs: [{ ...emptyDef(), key: "errorPct", name: "측정 오차", unit: "%", min: "0", max: "50", default: "10" }],
  effects: [],
};

describe("[SIM-09.06] 사용자 정의 유형 검증·본문", () => {
  it("이름 2~80자, 측정 항목·기능 필수, 키 규칙·중복, 최소≤최대, 기본값 범위, 선택지·예/아니오, 물리 영향은 숫자 특성", () => {
    expect(validateDraft(voc)).toEqual({});
    const bad = validateDraft({
      ...voc,
      name: "V",
      metrics: [],
      defs: [
        { ...emptyDef(), key: "Bad", name: "", default: "x" },
        { ...emptyDef(), key: "errorPct", name: "a", min: "5", max: "1", default: "3" },
        { ...emptyDef(), key: "errorPct", name: "a", min: "0", max: "10", default: "11" },
        { ...emptyDef(), key: "mode", name: "a", type: "enum", enumValues: " ", default: "" },
        { ...emptyDef(), key: "mode2", name: "a", type: "enum", enumValues: "a, b", default: "c" },
        { ...emptyDef(), key: "flag", name: "a", type: "boolean", default: "" },
        { ...emptyDef(), key: "num", name: "a", min: "x", max: "y", default: "" },
      ],
    });
    expect(bad).toMatchObject({
      name: { key: "length" },
      metrics: { key: "metricsRequired" },
      "defs.0.key": { key: "propertyKey" },
      "defs.0.name": { key: "length" },
      "defs.0.default": { key: "number" },
      "defs.1.max": { key: "minMax" },
      "defs.2.key": { key: "duplicateKey" },
      "defs.2.default": { key: "range", values: { min: "0", max: "10" } },
      "defs.3.enumValues": { key: "enumRequired" },
      "defs.4.default": { key: "enum" },
      "defs.5.default": { key: "boolean" },
      "defs.6.min": { key: "number" },
      "defs.6.max": { key: "number" },
    });
    expect(validateDraft({ ...voc, defs: Array.from({ length: 51 }, (_, i) => ({ ...emptyDef(), key: `p${i}x`, name: "a", default: "1" })) }).defs).toEqual({ key: "tooManyDefs", values: { max: 50 } });
    const actuator: TypeDraft = { ...voc, category: "ACTUATOR", metrics: [], capabilities: [], effects: [{ effect: "COOLING", propertyKey: "missing" }] };
    expect(validateDraft(actuator)).toMatchObject({ capabilities: { key: "capabilitiesRequired" }, "effects.0": { key: "effectProperty" } });
    expect(enumList("a, ,b")).toEqual(["a", "b"]);
  });

  it("요청 본문(API-SIM-03): 숫자·선택지·예/아니오 기본값 타입, 센서는 metrics+defaultSource, 장비는 capabilities+physicsEffects", () => {
    expect(typeBody({ ...voc, icon: " voc ", description: " 설명 ", defs: [...voc.defs, { ...emptyDef(), key: "mode", name: "모드", type: "enum", enumValues: "a,b", default: "a" }, { ...emptyDef(), key: "flag", name: "켜짐", type: "boolean", default: "true", description: "d" }] })).toEqual({
      name: "VOC 센서",
      category: "SENSOR",
      icon: "voc",
      description: "설명",
      linkedModelCode: "am107",
      metrics: [{ key: "tvoc", defaultSource: { kind: "GENERATOR" } }],
      propertyDefs: [
        { key: "errorPct", name: "측정 오차", type: "number", unit: "%", min: 0, max: 50, default: 10 },
        { key: "mode", name: "모드", type: "enum", enumValues: ["a", "b"], default: "a" },
        { key: "flag", name: "켜짐", type: "boolean", default: true, description: "d" },
      ],
    });
    const body = typeBody({ ...voc, category: "ACTUATOR", linkedModelCode: "", capabilities: ["Thermostat"], defs: [{ ...emptyDef(), key: "coolingCapacityKw", name: "냉방 용량", min: "", max: "", default: "3.5" }], effects: [{ effect: "COOLING", propertyKey: "coolingCapacityKw" }] });
    expect(body).toMatchObject({ capabilities: ["Thermostat"], physicsEffects: [{ effect: "COOLING", propertyKey: "coolingCapacityKw" }], propertyDefs: [{ key: "coolingCapacityKw", default: 3.5 }] });
    expect(body).not.toHaveProperty("metrics");
    expect(body).not.toHaveProperty("linkedModelCode");
  });

  it("카탈로그 유형 → 편집 값(문자열·객체 측정 항목, 물리 영향), 새 유형 기본값", () => {
    const type: SimType = { id: "901", key: "custom-901", name: "제습기", category: "ACTUATOR", builtin: false, metrics: ["humidity", { key: "power", defaultSource: { kind: "GENERATOR" } }], capabilities: ["Switch"], propertyDefs: [{ key: "ratedW", name: "정격", type: "number", min: 0, max: 2000, default: 300, unit: "W" }, { key: "mode", name: "모드", type: "enum", enumValues: ["a"], default: "a" }], physicsEffects: [{ effect: "DEHUMIDIFICATION", propertyKey: "ratedW" }], icon: "drop", description: "설명", version: 3 };
    const draft = draftFromType(type);
    expect(draft.metrics).toEqual([{ key: "humidity", source: "PHYSICS" }, { key: "power", source: "GENERATOR" }]);
    expect(draft.defs[0]).toMatchObject({ key: "ratedW", min: "0", max: "2000", default: "300", unit: "W" });
    expect(draft.defs[1].enumValues).toBe("a");
    expect(draft.effects).toEqual([{ effect: "DEHUMIDIFICATION", propertyKey: "ratedW" }]);
    expect(draft).toMatchObject({ icon: "drop", description: "설명" });
    expect(draftFromType(null, "ACTUATOR")).toMatchObject({ name: "", category: "ACTUATOR", defs: [] });
  });
});

describe("[SIM-09.06][AT-SIM-14.1] UI-SIM-14 편집 화면", () => {
  const props = { typeId: null, canManage: true, metricOptions: ["tvoc", "co2"], capabilityOptions: ["Switch", "Thermostat"], modelOptions: [{ code: "am107", name: "AM107" }], backTo: "/sim/catalog?tab=sensor" };

  it("TC-SIM-103 측정 항목 선택(기본 출처), 특성 정의 입력, 잘못된 입력은 제출을 막고 문구 표시", async () => {
    await renderRoute(<TypeEditor {...props} initial={draftFromType(null)} />, { session: meOf("INTEGRATOR") });
    await userEvent.type(await screen.findByLabelText("이름"), "VOC 센서");
    await userEvent.click(screen.getByLabelText("tvoc"));
    await userEvent.selectOptions(screen.getByLabelText("tvoc 기본 출처"), "GENERATOR");
    await userEvent.click(screen.getByRole("button", { name: "+ 특성 추가" }));
    const row = screen.getByRole("listitem", { name: "특성 1" });
    await userEvent.type(within(row).getByLabelText("키"), "error pct");
    fireEvent.submit(screen.getByRole("form", { name: "사용자 정의 유형" }));
    expect(await screen.findByText("키는 영문 소문자로 시작하는 영문·숫자 2~40자입니다.")).toBeInTheDocument();
    await userEvent.clear(within(row).getByLabelText("키"));
    await userEvent.type(within(row).getByLabelText("키"), "errorPct");
    await userEvent.type(within(row).getByLabelText("이름"), "측정 오차");
    await userEvent.type(within(row).getByLabelText("최소"), "0");
    await userEvent.type(within(row).getByLabelText("최대"), "50");
    await userEvent.type(within(row).getByLabelText("기본값"), "60");
    fireEvent.submit(screen.getByRole("form", { name: "사용자 정의 유형" }));
    expect(await screen.findByText("0~50 사이로 입력하세요.")).toBeInTheDocument();
    await userEvent.clear(within(row).getByLabelText("기본값"));
    await userEvent.type(within(row).getByLabelText("기본값"), "10");
    const hidden = document.querySelector('input[name="draft"]') as HTMLInputElement;
    expect(JSON.parse(hidden.value)).toMatchObject({ name: "VOC 센서", metrics: [{ key: "tvoc", source: "GENERATOR" }], defs: [{ key: "errorPct", default: "10" }] });
    expect(validateDraft(JSON.parse(hidden.value) as TypeDraft)).toEqual({});
    await userEvent.click(screen.getByRole("button", { name: "특성 삭제" }));
    expect(screen.getByText("정의한 특성이 없습니다.")).toBeInTheDocument();
  });

  it("장비: 기능 선택·물리 영향(숫자 특성 연결), 기존 유형은 분류 고정·[유형 삭제]·baseVersion, 서버 오류·읽기 전용", async () => {
    const existing = draftFromType({ id: "901", key: "k", name: "제습기", category: "ACTUATOR", builtin: false, capabilities: [], propertyDefs: [{ key: "ratedW", name: "정격", type: "number", min: 0, max: 2000, default: 300 }] });
    const { unmount } = await renderRoute(<TypeEditor {...props} typeId="901" baseVersion={3} initial={existing} result={{ intent: "saveType", error: { code: "SIM_TYPE_IN_USE" }, fieldErrors: { name: { key: "length", values: { min: 2, max: 80 } } } }} />, { session: meOf("INTEGRATOR") });
    expect(await screen.findByText("사용 중인 유형입니다")).toBeInTheDocument();
    expect(screen.getByText("2~80자로 입력하세요.")).toBeInTheDocument();
    expect(screen.getByLabelText("분류")).toBeDisabled();
    expect((document.querySelector('input[name="baseVersion"]') as HTMLInputElement).value).toBe("3");
    expect(screen.getByRole("button", { name: "유형 삭제" })).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText("Thermostat"));
    await userEvent.click(screen.getByRole("button", { name: "+ 영향 추가" }));
    await userEvent.selectOptions(screen.getByLabelText("영향 종류"), "DEHUMIDIFICATION");
    expect(JSON.parse((document.querySelector('input[name="draft"]') as HTMLInputElement).value)).toMatchObject({ capabilities: ["Thermostat"], effects: [{ effect: "DEHUMIDIFICATION", propertyKey: "ratedW" }] });
    await userEvent.selectOptions(screen.getByLabelText("연결할 특성"), "");
    fireEvent.submit(screen.getByRole("form", { name: "사용자 정의 유형" }));
    expect(await screen.findByText("영향에 연결할 숫자 특성을 고르세요.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "영향 삭제" }));
    expect(screen.getByText("물리 영향이 없습니다.")).toBeInTheDocument();
    unmount();
    await renderRoute(<TypeEditor {...props} canManage={false} initial={voc} />, { session: meOf("OPERATOR") });
    expect((await screen.findAllByLabelText("이름"))[0]).toBeDisabled();
    expect(screen.queryByRole("button", { name: "저장" })).toBeNull();
    expect(screen.getByRole("link", { name: "카탈로그로 돌아가기" })).toHaveAttribute("href", "/sim/catalog?tab=sensor");
  });
});
