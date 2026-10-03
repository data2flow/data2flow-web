/**
 * TC-SIM-098 UI-SIM-04 특성 정의 → 숫자·선택·불리언 칸 자동 생성, 단위 표시, 범위 밖 입력 즉시 오류(SIM-09.03, BR-SIM-03, AT-SIM-03.2).
 */
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { meOf, renderRoute } from "../../../../test/render";
import { PropertyForm } from "../components/property-form";
import type { PropertyRow } from "../model/types";

const ROWS: PropertyRow[] = [
  { key: "coolingCapacityKw", value: 3.5, origin: "CATALOG", def: { key: "coolingCapacityKw", name: "냉방 능력", type: "number", unit: "kW", min: 0.5, max: 20, default: 3.5 } },
  { key: "defaultMode", value: "cool", origin: "CATALOG", def: { key: "defaultMode", name: "기본 모드", type: "enum", enumValues: ["cool", "heat", "dry"], default: "cool" } },
  { key: "inverter", value: true, origin: "PROFILE", def: { key: "inverter", name: "인버터", type: "boolean", default: true } },
  // 카탈로그에 새로 생긴 특성도 화면 수정 없이 나타난다
  { key: "noiseDb", value: 40, origin: "CATALOG", def: { key: "noiseDb", name: "실내기 소음", type: "number", unit: "dB", min: 20, max: 70, default: 40 } },
];

describe("TC-SIM-098 AT-SIM-03.2 정의로 만든 특성 폼", () => {
  it("정의 타입별 칸·단위·범위 표시, 새 특성도 표시", async () => {
    await renderRoute(<PropertyForm rows={ROWS} layer="PROFILE" canEdit onSave={vi.fn()} />, { session: meOf("INTEGRATOR") });
    expect(await screen.findByLabelText("냉방 능력 (kW)")).toHaveValue("3.5");
    expect(screen.getByText("0.5~20")).toBeInTheDocument();
    expect(screen.getByLabelText("기본 모드")).toHaveDisplayValue("cool");
    expect(screen.getByLabelText("인버터")).toBeChecked();
    expect(screen.getByLabelText("실내기 소음 (dB)")).toHaveValue("40");
    expect(screen.getAllByText("카탈로그")).toHaveLength(3);
    expect(screen.getByText("직접 설정")).toBeInTheDocument();
  });

  it("범위 밖·숫자 아님은 바로 오류(허용 범위 안내)이고 저장 비활성, 선택·불리언 변경은 바꾼 값만 저장", async () => {
    const onSave = vi.fn(async () => ({ ok: true }));
    await renderRoute(<PropertyForm rows={ROWS} layer="PROFILE" canEdit onSave={onSave} />, { session: meOf("INTEGRATOR") });
    const cap = await screen.findByLabelText("냉방 능력 (kW)");
    await userEvent.clear(cap);
    await userEvent.type(cap, "25");
    expect(screen.getByRole("alert")).toHaveTextContent("허용 범위(0.5~20 kW)를 벗어났습니다.");
    expect(screen.getByRole("button", { name: "저장" })).toBeDisabled();
    await userEvent.clear(cap);
    await userEvent.type(cap, "abc");
    expect(screen.getByRole("alert")).toHaveTextContent("숫자를 입력하세요.");
    await userEvent.clear(cap);
    await userEvent.type(cap, "3.5");
    expect(screen.queryByRole("alert")).toBeNull();
    await userEvent.selectOptions(screen.getByLabelText("기본 모드"), "heat");
    await userEvent.click(screen.getByLabelText("인버터"));
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(onSave).toHaveBeenCalledWith({ defaultMode: "heat", inverter: false });
  });
});
