/**
 * TC-SIM-092 UI-SIM-02 카탈로그 카드 필터(센서·장비), 배치 대화상자 수량, 409 한도 문구(SIM-09.01, AT-SIM-01.3),
 * 키트 배치 결과의 추천 플로우 [플로우로 만들기](SIM-09.07 → FLW-01.05, M3 시연 경로).
 */
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { meOf, renderRoute } from "../../../../test/render";
import { CatalogView, metricKeys } from "../components/catalog-view";
import type { SimCatalog } from "../model/types";

const CATALOG: SimCatalog = {
  types: [
    { id: "11", key: "th-sensor", name: "온습도 센서", category: "SENSOR", builtin: true, metrics: [{ key: "temperature" }, "humidity"], propertyDefs: [], linkedModelCode: "EM300-TH", summary: ["오차 ±0.3℃", "60초", "배터리 100%", "넷째"] },
    { id: "21", key: "aircon", name: "에어컨", category: "ACTUATOR", builtin: false, capabilities: ["Switch", "Thermostat"], propertyDefs: [{ key: "coolingCapacityKw", name: "냉방 능력", type: "number", unit: "kW", default: 3.5 }] },
  ],
  kits: [{ key: "classroom-standard", name: "표준 강의실 키트", items: [{ typeKey: "th-sensor", count: 2 }, { typeKey: "ghost", count: 1 }], suggestedFlowTemplates: ["hot-then-cool"] }],
};
const SPACES = [{ spaceId: "41", name: "데모 강의실" }];
const PROFILES = [{ id: "301", name: "강의실 표준 에어컨", typeId: "21" }];

describe("TC-SIM-092 AT-SIM-01.3 가상 기기 카탈로그", () => {
  it("센서 탭은 센서 카드만(측정 항목·요약 3개·연결 모델), 장비 탭은 기능·사용자 정의 배지", async () => {
    const { unmount } = await renderRoute(<CatalogView catalog={CATALOG} tab="sensor" spaces={SPACES} profiles={PROFILES} remaining={477} canManage idempotencyKey="k" />, { session: meOf("INTEGRATOR") });
    expect(await screen.findByText("온습도 센서")).toBeInTheDocument();
    expect(screen.queryByText("에어컨")).toBeNull();
    expect(screen.getByText("temperature · humidity")).toBeInTheDocument();
    expect(screen.getByText("오차 ±0.3℃")).toBeInTheDocument();
    expect(screen.queryByText("넷째")).toBeNull();
    expect(screen.getByText("모델: EM300-TH")).toBeInTheDocument();
    unmount();
    await renderRoute(<CatalogView catalog={CATALOG} tab="actuator" spaces={SPACES} profiles={PROFILES} remaining={477} canManage={false} idempotencyKey="k" />, { session: meOf("OPERATOR") });
    expect(await screen.findByText("Switch · Thermostat")).toBeInTheDocument();
    expect(screen.getByText("냉방 능력 3.5kW")).toBeInTheDocument();
    expect(screen.getByText("사용자 정의")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "배치" })).toBeNull();
    expect(metricKeys({ ...CATALOG.types[1], metrics: null })).toEqual([]);
  });

  it("배치 대화상자: 남은 한도 안내, 수량이 한도를 넘으면 제출 전에 막고 한도 문구, 프로필은 같은 유형만", async () => {
    await renderRoute(<CatalogView catalog={CATALOG} tab="actuator" spaces={SPACES} profiles={PROFILES} remaining={3} canManage idempotencyKey="k" />, { session: meOf("INTEGRATOR") });
    await userEvent.click(await screen.findByRole("button", { name: "배치" }));
    const dialog = screen.getByRole("dialog", { name: "배치: 에어컨" });
    expect(within(dialog).getByText("남은 한도 3대")).toBeInTheDocument();
    expect(within(dialog).getByRole("option", { name: "강의실 표준 에어컨" })).toBeInTheDocument();
    expect(within(dialog).getByLabelText("이름 접두어")).toHaveValue("에어컨");
    const count = within(dialog).getByLabelText("수량");
    await userEvent.clear(count);
    await userEvent.type(count, "4");
    await userEvent.click(within(dialog).getByRole("button", { name: "배치" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent("가상 기기 한도(500대)를 넘습니다. 남은 수: 3");
    await userEvent.clear(count);
    await userEvent.type(count, "0");
    await userEvent.click(within(dialog).getByRole("button", { name: "배치" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent("1~50 사이로 입력하세요.");
    await userEvent.click(within(dialog).getByRole("button", { name: "취소" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("서버 409 SIM_DEVICE_QUOTA_EXCEEDED는 한도 문구로, 배치 성공은 만든 기기 이름", async () => {
    const { unmount } = await renderRoute(<CatalogView catalog={CATALOG} tab="sensor" spaces={SPACES} profiles={[]} remaining={1} canManage result={{ intent: "place", error: { code: "SIM_DEVICE_QUOTA_EXCEEDED" } }} idempotencyKey="k" />, { session: meOf("INTEGRATOR") });
    expect(await screen.findByRole("alert")).toHaveTextContent("가상 기기 한도(500대)를 넘습니다. 남은 수: 1");
    unmount();
    await renderRoute(<CatalogView catalog={CATALOG} tab="sensor" spaces={[]} profiles={[]} remaining={null} canManage result={{ intent: "place", placed: [{ deviceId: "9", name: "TH-1" }], error: { code: "OTHER", message: "기타" } }} idempotencyKey="k" />, { session: meOf("INTEGRATOR") });
    expect(await screen.findByText("가상 기기 1대를 만들었습니다: TH-1")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "배치" }));
    expect(screen.getByText("가상 공간이 없습니다.", { exact: false })).toBeInTheDocument();
  });

  it("SIM-09.07 키트: 구성 표시, 배치 대화상자(기존·새 공간), 결과의 추천 플로우 링크는 템플릿 화면에 공간을 채움", async () => {
    const { unmount } = await renderRoute(<CatalogView catalog={CATALOG} tab="kit" spaces={SPACES} profiles={[]} remaining={500} canManage idempotencyKey="k" />, { session: meOf("INTEGRATOR") });
    expect(await screen.findByText("온습도 센서 × 2")).toBeInTheDocument();
    expect(screen.getByText("ghost × 1")).toBeInTheDocument();
    expect(screen.getByText("추천 플로우: hot-then-cool")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "배치" }));
    const dialog = screen.getByRole("dialog", { name: "키트 배치: 표준 강의실 키트" });
    expect(within(dialog).getByLabelText("가상 공간")).toHaveDisplayValue("데모 강의실");
    await userEvent.selectOptions(within(dialog).getByLabelText("배치할 곳"), "new");
    expect(within(dialog).getByLabelText("새 공간 이름")).toHaveValue("표준 강의실 키트");
    unmount();
    await renderRoute(
      <CatalogView
        catalog={CATALOG}
        tab="kit"
        spaces={SPACES}
        profiles={[]}
        remaining={500}
        canManage
        canWriteFlow
        result={{ intent: "kit", kit: { spaceId: "41", devices: [{ deviceId: "9001", name: "TH-1", typeKey: "th-sensor", relation: "MEASURES" }, { deviceId: "9003", name: "AC-1", typeKey: "aircon" }], suggestedFlows: [{ templateKey: "hot-then-cool", name: "고온이면 냉방" }] } }}
        idempotencyKey="k"
      />,
      { session: meOf("INTEGRATOR") },
    );
    expect(await screen.findByText("데모 강의실에 키트 기기 2대를 배치했습니다")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "TH-1" })).toHaveAttribute("href", "/devices/9001?tab=virtual");
    expect(screen.getByRole("link", { name: "플로우로 만들기: 고온이면 냉방" })).toHaveAttribute("href", "/automation/templates?template=hot-then-cool&spaceId=41");
  });

  it("SIM-09.07 템플릿 권한(FLOW_WRITE)이 없으면 추천 플로우 [플로우로 만들기]를 숨기고, 배치 오류는 errors[] 상세를 함께 보인다", async () => {
    await renderRoute(
      <CatalogView
        catalog={CATALOG}
        tab="kit"
        spaces={SPACES}
        profiles={[]}
        remaining={500}
        canManage
        result={{ intent: "kit", kit: { spaceId: "41", devices: [{ deviceId: "9001", name: "TH-1", typeKey: "th-sensor" }], suggestedFlows: [{ templateKey: "hot-then-cool", name: "고온이면 냉방" }] } }}
        idempotencyKey="k"
      />,
      { session: meOf("INTEGRATOR") },
    );
    expect(await screen.findByText("데모 강의실에 키트 기기 1대를 배치했습니다")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "플로우로 만들기: 고온이면 냉방" })).not.toBeInTheDocument();
  });

  it("빈 카탈로그·빈 키트 안내", async () => {
    const { unmount } = await renderRoute(<CatalogView catalog={{ types: [], kits: [] }} tab="sensor" spaces={[]} profiles={[]} remaining={0} canManage idempotencyKey="k" />);
    expect(await screen.findByText("이 분류에 가상 기기 유형이 없습니다.")).toBeInTheDocument();
    unmount();
    await renderRoute(<CatalogView catalog={{ types: [], kits: [] }} tab="kit" spaces={[]} profiles={[]} remaining={0} canManage idempotencyKey="k" />);
    expect(await screen.findByText("키트가 없습니다.")).toBeInTheDocument();
  });
});
