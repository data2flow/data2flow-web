/**
 * ACT-01.04 UI-ACT-10 기능 카탈로그 — TC-ACT-009(AT-ACT-13.1): 사용자 정의 기능 `custom.Humidifier`(targetHumidity 30~70) 정의 → 컨트롤 미리보기(슬라이더),
 * AT-ACT-13.2: 표준 이름은 CAPABILITY_NAME_RESERVED, BR-ACT-22(custom. 접두어·속성 형식), 권한별(CAPABILITY_MANAGE) 추가 버튼.
 */
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderRoute } from "../../../../test/render";
import { CapabilityCatalog } from "../capability-catalog";
import { err, fakeAdminApi, ok } from "./fake-admin";

const ROWS = [
  { name: "Thermostat", version: 1, standard: true, matterCluster: "Thermostat", attributeCount: 3, commandCount: 1 },
  { name: "custom.Mister", version: 2, standard: false, attributeCount: 1, commandCount: 1 },
];
const THERMOSTAT = {
  name: "Thermostat",
  version: 1,
  standard: true,
  matterCluster: "Thermostat",
  attributes: [
    { name: "mode", type: "enum", enum: ["off", "cool", "heat"] },
    { name: "targetTemperature", type: "number", unit: "°C", min: 5, max: 35, step: 0.5 },
    { name: "currentTemperature", type: "number", unit: "°C", readOnly: true },
  ],
  commands: [{ name: "set", sets: ["mode", "targetTemperature"] }],
  expectedEffects: [{ when: { command: "set", args: { mode: "cool" } }, metric: "temperature", direction: "down" as const, withinMinutes: 15 }],
};

const setJson = (value: string) => fireEvent.change(screen.getByLabelText("기능 정의(JSON)"), { target: { value } });

describe("TC-ACT-009 AT-ACT-13.1 사용자 정의 기능", () => {
  it("템플릿(custom.Humidifier)으로 시작 → 미리보기에 30~70 슬라이더 → 저장하면 목록에 추가", async () => {
    const user = userEvent.setup();
    const api = fakeAdminApi({ createCapability: vi.fn(async (body) => ok({ ...body, version: 1, standard: false }, 201)) });
    await renderRoute(<CapabilityCatalog initial={ROWS} canManage api={api} />);
    await user.click(await screen.findByRole("button", { name: "사용자 정의 기능 추가" }));
    const preview = await screen.findByRole("region", { name: "컨트롤 미리보기" });
    expect(preview.querySelector('input[type="range"]')).toHaveAttribute("min", "30");
    expect(preview.querySelector('input[type="range"]')).toHaveAttribute("max", "70");
    expect(preview.querySelector('input[role="switch"]')).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "저장" }));
    await screen.findByText("기능을 저장했습니다");
    expect(api.createCapability.mock.calls[0][0]).toMatchObject({ name: "custom.Humidifier", commands: [{ name: "set", sets: ["on", "targetHumidity"] }] });
    expect(screen.getByRole("button", { name: "custom.Humidifier" })).toBeInTheDocument();
  });

  it("AT-ACT-13.2 BR-ACT-22: JSON 오류·표준 이름·custom. 접두어·속성·명령 검사, 서버 거부 문구", async () => {
    const user = userEvent.setup();
    const api = fakeAdminApi({ createCapability: vi.fn(async () => err(409, "CAPABILITY_NAME_RESERVED")) });
    await renderRoute(<CapabilityCatalog initial={ROWS} canManage api={api} />);
    await user.click(await screen.findByRole("button", { name: "사용자 정의 기능 추가" }));
    setJson("{");
    expect(await screen.findByText("JSON 형식이 올바르지 않습니다")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "저장" })).toBeDisabled();
    setJson(JSON.stringify({ name: "Switch", attributes: [{ name: "on", type: "boolean" }], commands: [] }));
    expect(screen.getByText("표준 기능 이름은 쓸 수 없습니다")).toBeInTheDocument();
    setJson(JSON.stringify({ name: "Humidifier", attributes: [], commands: [{ name: "set", sets: ["x"] }] }));
    expect(screen.getByText(/custom\.으로 시작해야 합니다/)).toBeInTheDocument();
    expect(screen.getByText("속성을 하나 이상 정의하세요")).toBeInTheDocument();
    expect(screen.getByText("명령의 sets는 정의한 속성 이름이어야 합니다")).toBeInTheDocument();
    setJson(
      JSON.stringify({
        name: "custom.A",
        attributes: [
          { name: "x", type: "enum" },
          { name: "y", type: "number", min: 9, max: 1 },
        ],
        commands: [],
      }),
    );
    expect(screen.getByText(/enum은 값 목록이 필요합니다/)).toBeInTheDocument();
    expect(screen.getByText("최소값이 최대값보다 큽니다")).toBeInTheDocument();
    setJson(JSON.stringify({ name: "custom.Ok", attributes: [{ name: "on", type: "boolean" }], commands: [{ name: "set", sets: ["on"] }] }));
    await user.click(screen.getByRole("button", { name: "저장" }));
    expect(await screen.findByText("표준 기능 이름은 쓸 수 없습니다")).toBeInTheDocument();
  });

  it("상세: 속성·명령·기대 효과·Matter, 표준 기능은 수정 버튼 없음, 사용자 정의는 수정(PUT, 이름 제외)", async () => {
    const user = userEvent.setup();
    const custom = { name: "custom.Mister", version: 2, standard: false, attributes: [{ name: "level", type: "integer", min: 1, max: 3 }], commands: [{ name: "set", sets: ["level"] }] };
    const api = fakeAdminApi({
      capability: vi.fn(async (name: string) => ok(name === "Thermostat" ? THERMOSTAT : custom)),
      updateCapability: vi.fn(async (name: string, body) => ok({ ...body, name, version: 3, standard: false })),
    });
    await renderRoute(<CapabilityCatalog initial={ROWS} canManage api={api} />);
    await user.click(await screen.findByRole("button", { name: "Thermostat" }));
    expect(await screen.findByText("Thermostat v1")).toBeInTheDocument();
    expect(screen.getByText("5~35 (0.5)")).toBeInTheDocument();
    expect(screen.getByText("Matter 대응 클러스터: Thermostat")).toBeInTheDocument();
    expect(screen.getByText(/기대 효과: .* temperature ↓ \(15분 안\)/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "편집" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "custom.Mister" }));
    await user.click(await screen.findByRole("button", { name: "편집" }));
    expect(await screen.findByRole("group", { name: "custom.Mister 단계" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(api.updateCapability).toHaveBeenCalled());
    expect(api.updateCapability.mock.calls[0][0]).toBe("custom.Mister");
    expect(api.updateCapability.mock.calls[0][1]).not.toHaveProperty("name");
  });

  it("관리 권한이 없으면(OPERATOR) 추가 버튼이 없고, 상세를 못 읽으면 오류 문구", async () => {
    const user = userEvent.setup();
    const api = fakeAdminApi({ capability: vi.fn(async () => err(404, "CAPABILITY_NOT_FOUND")) });
    await renderRoute(<CapabilityCatalog initial={[]} failed canManage={false} api={api} />);
    expect(await screen.findByText("목록을 불러오지 못했습니다")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "사용자 정의 기능 추가" })).not.toBeInTheDocument();
    await renderRoute(<CapabilityCatalog initial={ROWS} canManage={false} api={api} />);
    await user.click((await screen.findAllByRole("button", { name: "Thermostat" }))[0]);
    expect(await screen.findAllByRole("alert")).not.toHaveLength(0);
  });
});
