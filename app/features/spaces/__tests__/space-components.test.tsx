/**
 * 공간 화면 부품(UI-DEV-01·02·03, UI-DSH-02): TC-DEV-006·014·019·025·285, DSH-01.02.
 */
import { act, fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { meOf, renderRoute } from "../../../../test/render";
import type { EventSourceLike } from "~/lib/event-stream";
import { flattenSpaces } from "~/lib/spaces";
import { FloorplanPanel } from "../components/floorplan";
import { ModeCard, PropsForm, ScheduleEditor, TargetsEditor } from "../components/space-manage";
import { ChildSpaces, ComfortBadge, DeviceCards } from "../components/space-overview";
import { DeleteDialog, SpaceTree, filterTree } from "../components/space-tree";

const tree = [
  {
    id: "1",
    type: "SITE",
    name: "광주캠퍼스",
    code: "gwangju",
    children: [{ id: "2", type: "BUILDING", name: "본관", children: [{ id: "3", type: "FLOOR", name: "3층", counts: { devices: 9, offline: 1 }, children: [{ id: "31", type: "ROOM", name: "실습실", code: "lab", counts: { devices: 6 } }, { id: "32", type: "ROOM", name: "사무실" }] }] }],
  },
];

describe("UI-DEV-01 공간 트리 TC-DEV-006", () => {
  it("타입·기기 수·오프라인 배지, 검색은 맞는 공간과 조상만, 현재 공간 강조", async () => {
    await renderRoute(<SpaceTree spaces={tree} selectedId="31" canEdit={false} />, { session: meOf("VIEWER") });
    const nav = await screen.findByRole("navigation", { name: "공간 트리" });
    expect(within(nav).getByRole("link", { name: /실습실/ })).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("오프라인 1")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "사이트 추가" })).toBeNull();
    await userEvent.type(screen.getByLabelText("공간 검색"), "lab");
    expect(within(nav).getAllByRole("link").map((a) => a.textContent)).toEqual(["사이트광주캠퍼스", "건물본관", "층3층9오프라인 1", "실실습실6"]);
    await userEvent.clear(screen.getByLabelText("공간 검색"));
    await userEvent.type(screen.getByLabelText("공간 검색"), "없음");
    expect(screen.getByText("검색 결과가 없습니다.")).toBeInTheDocument();
  });

  it("편집 도구(DEV_ADMIN): 하위 추가는 상위보다 작은 종류만, 사이트 추가는 시간대 칸, 이동 대상은 순환 제외", async () => {
    await renderRoute(<SpaceTree spaces={tree} selectedId="3" canEdit />, { session: meOf("INTEGRATOR") });
    await userEvent.click(await screen.findByRole("button", { name: "하위 추가" }));
    const dialog = screen.getByRole("dialog", { name: "3층 아래에 공간 추가" });
    expect([...within(dialog).getByLabelText<HTMLSelectElement>("종류").options].map((o) => o.value)).toEqual(["ROOM", "ZONE"]);
    expect(within(dialog).queryByLabelText("시간대")).toBeNull();
    expect(dialog.querySelector('input[name="parentId"]')).toHaveValue("3");
    await userEvent.click(within(dialog).getByRole("button", { name: "취소" }));
    await userEvent.click(screen.getByRole("button", { name: "사이트 추가" }));
    expect(within(screen.getByRole("dialog")).getByLabelText("시간대")).toHaveValue("Asia/Seoul");
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "취소" }));
    await userEvent.click(screen.getByRole("button", { name: "이동" }));
    const move = screen.getByRole("dialog", { name: "3층 이동" });
    expect([...within(move).getByLabelText<HTMLSelectElement>("새 상위 공간").options].map((o) => o.textContent)).toEqual(["–", "광주캠퍼스"]);
    await userEvent.click(within(move).getByRole("button", { name: "취소" }));
    await userEvent.click(screen.getByRole("button", { name: "이름 바꾸기" }));
    expect(within(screen.getByRole("dialog")).getByLabelText("이름")).toHaveValue("3층");
  });

  it("오류 결과가 오면 해당 대화상자를 다시 열고 문구를 보인다", async () => {
    await renderRoute(<SpaceTree spaces={tree} selectedId="3" canEdit result={{ intent: "create", parentId: "3", fieldErrors: { name: "nameDuplicate" } }} />, { session: meOf("INTEGRATOR") });
    expect(await screen.findByText("같은 이름의 공간이 이미 있습니다")).toBeInTheDocument();
  });

  it("삭제: 이름을 입력해야 버튼이 켜지고, 막히면 막는 항목과 [기기 보기]", async () => {
    const space = flattenSpaces(tree).find((s) => s.id === "3")!;
    await renderRoute(<DeleteDialog space={space} onClose={() => {}} result={{ intent: "delete", error: { code: "SPACE_NOT_EMPTY" }, blockers: { children: 2, devices: 9 } }} />, { session: meOf("INTEGRATOR") });
    const button = within(await screen.findByRole("dialog")).getAllByRole("button", { name: "삭제" }).at(-1)!;
    expect(button).toBeDisabled();
    await userEvent.type(screen.getByLabelText('확인을 위해 공간 이름 "3층"을 입력하세요'), "3층");
    expect(button).toBeEnabled();
    expect(screen.getByText("하위 공간 2개, 기기 9대, 마커 0개, 작업 지시 0건이 있어 삭제할 수 없습니다.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "기기 보기" })).toHaveAttribute("href", "/devices?spaceId=3");
  });

  it("filterTree는 검색어가 없으면 그대로", () => {
    const flat = flattenSpaces(tree);
    expect(filterTree(flat, " ")).toBe(flat);
  });
});

describe("UI-DEV-02 관리 탭", () => {
  it("TC-DEV-014 속성: 사이트는 주소·좌표·격자, 권한 없으면 입력 잠금·저장 없음, 결과 표시", async () => {
    const { unmount } = await renderRoute(<PropsForm space={{ id: "1", type: "SITE", name: "광주", kmaNx: 59, kmaNy: 74, version: 1 }} canEdit result={{ intent: "props", ok: true }} />);
    expect(await screen.findByText("기상청 격자 nx 59, ny 74(자동 계산)")).toBeInTheDocument();
    expect(screen.getByText("저장했습니다.")).toBeInTheDocument();
    unmount();
    await renderRoute(<PropsForm space={{ id: "31", type: "ROOM", name: "실습실" }} canEdit={false} result={{ intent: "props", error: { code: "VERSION_CONFLICT" } }} />);
    expect(await screen.findByLabelText("이름")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "저장" })).toBeNull();
    expect(screen.queryByLabelText("주소")).toBeNull();
    expect(screen.getByText(/다른 사용자가 먼저 수정했습니다/)).toBeInTheDocument();
  });

  it("TC-DEV-025 목표 환경: 최소>최대 문구와 저장 막힘, 상속 행 회색과 출처, 상속 켜면 직접 행 숨김", async () => {
    const data = { inherit: false, items: [{ metricKey: "co2", max: 1000 }], effective: [{ metricKey: "temperature", min: 20, max: 26, inheritedFromSpaceId: "1", inheritedFromSpaceName: "광주캠퍼스" }] };
    await renderRoute(<TargetsEditor data={data} metrics={[{ key: "co2", displayName: "CO2" }, { key: "temperature" }]} canEdit />);
    expect(await screen.findByText("상속: 광주캠퍼스")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "항목 추가" }));
    const mins = screen.getAllByLabelText("최소");
    const maxes = screen.getAllByLabelText("최대");
    await userEvent.selectOptions(screen.getAllByLabelText("측정 항목")[1], "temperature");
    await userEvent.type(mins[1], "30");
    await userEvent.type(maxes[1], "20");
    expect(screen.getByText("최소값이 최대값보다 큽니다")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "저장" })).toBeDisabled();
    await userEvent.click(screen.getAllByRole("button", { name: "제거" })[1]);
    expect(screen.getByRole("button", { name: "저장" })).toBeEnabled();
    expect(document.querySelector('input[name="items"]')).toHaveValue(JSON.stringify([{ metricKey: "co2", max: 1000 }]));
    await userEvent.click(screen.getByLabelText("상위 값 사용"));
    expect(screen.queryAllByLabelText("최소")).toHaveLength(0);
  });

  it("TC-DEV-285 운영 시간: 구간 추가·겹침 문구·저장 막힘, 상속 안내", async () => {
    const { unmount } = await renderRoute(<ScheduleEditor data={{ inherit: false, slots: [{ dayOfWeek: 1, start: "09:00", end: "12:00" }] }} canEdit />);
    await userEvent.click(await screen.findByRole("button", { name: "구간 추가" }));
    expect(screen.getAllByText("같은 요일의 시간 구간이 겹칩니다")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "저장" })).toBeDisabled();
    const starts = screen.getAllByLabelText("시작");
    await userEvent.clear(starts[1]);
    await userEvent.type(starts[1], "12:00");
    expect(screen.queryByText("같은 요일의 시간 구간이 겹칩니다")).toBeNull();
    await userEvent.selectOptions(screen.getAllByLabelText("요일")[1], "2");
    await userEvent.click(screen.getAllByRole("button", { name: "제거" })[1]);
    await userEvent.click(screen.getByRole("button", { name: "제거" }));
    expect(screen.getByText("운영 시간 구간이 없습니다(항상 미운영).")).toBeInTheDocument();
    unmount();
    await renderRoute(<ScheduleEditor data={{ inherit: true, inheritedFromSpaceName: "광주캠퍼스", slots: [] }} canEdit={false} result={{ intent: "schedule", error: { code: "SCHEDULE_OVERLAP" } }} />);
    expect(await screen.findByText("상위 공간(광주캠퍼스)의 시간표를 따릅니다.")).toBeInTheDocument();
    expect(screen.getByText("같은 요일의 시간 구간이 겹칩니다.")).toBeInTheDocument();
  });

  it("운영 모드 카드: 현재 모드·원인·다음 변경, 7일 넘는 종료는 막힘, 권한 없으면 지정 폼 없음", async () => {
    const now = Date.parse("2026-10-04T00:00:00Z");
    const { unmount } = await renderRoute(<ModeCard data={{ mode: "OCCUPIED", source: "SCHEDULE", nextChangeAt: "2026-10-04T09:00:00Z" }} canOverride timezone="Asia/Seoul" lang="ko" now={now} />);
    expect((await screen.findAllByText("운영 중"))[0].tagName).toBe("SPAN");
    expect(screen.getByText("원인: 시간표")).toBeInTheDocument();
    expect(screen.getByText("다음 변경 2026-10-04 18:00")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("종료 시각"), { target: { value: "2026-10-20T10:00" } });
    expect(screen.getByText("7일 이내로 지정하세요")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "적용" })).toBeDisabled();
    unmount();
    await renderRoute(<ModeCard data={null} canOverride={false} timezone="UTC" lang="ko" now={now} />);
    expect(await screen.findByText("운영 모드 정보가 없습니다.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "적용" })).toBeNull();
  });
});

describe("UI-DEV-03 평면도 TC-DEV-019", () => {
  it("평면도 없음: 편집 권한자는 업로드, 잘못된 형식은 문구와 버튼 막힘; 권한 없으면 안내", async () => {
    const { unmount } = await renderRoute(<FloorplanPanel view={null} devices={[]} canEdit />);
    expect(await screen.findByText("평면도 이미지를 올려 기기를 배치하세요")).toBeInTheDocument();
    await userEvent.upload(screen.getByLabelText(/평면도 이미지/), new File(["x"], "a.gif", { type: "image/gif" }), { applyAccept: false });
    expect(screen.getByText("이미지 형식이나 크기가 올바르지 않습니다")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "업로드" })).toBeDisabled();
    unmount();
    await renderRoute(<FloorplanPanel view={{ imageUrl: null }} devices={[]} canEdit={false} />);
    expect(await screen.findByText("평면도는 관리자가 올릴 수 있습니다.")).toBeInTheDocument();
  });

  it("편집 모드에서만 배치: 기기 고르고 이미지 누르면 비율 좌표 마커, 저장 값", async () => {
    const view = { imageUrl: "/plan.png", markers: [{ deviceId: "1042", deviceName: "AM107", x: 0.1, y: 0.1, metrics: [{ key: "co2", value: 517, unit: "ppm" }] }] };
    await renderRoute(<FloorplanPanel view={view} devices={[{ id: "1042", name: "AM107" }, { id: "1050", name: "EM300" }]} canEdit result={{ intent: "markers", ok: true }} />);
    expect(await screen.findByText("517ppm")).toBeInTheDocument();
    expect(screen.getByText("저장했습니다.")).toBeInTheDocument();
    const image = screen.getByTestId("floorplan-image");
    image.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100, x: 0, y: 0, toJSON: () => ({}) });
    fireEvent.click(image, { clientX: 50, clientY: 50 });
    expect(screen.queryByText("EM300")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "편집 모드" }));
    await userEvent.click(screen.getByRole("button", { name: "EM300" }));
    expect(screen.getByText("평면도에서 놓을 위치를 누르세요.")).toBeInTheDocument();
    fireEvent.click(image, { clientX: 50, clientY: 50 });
    expect(screen.getByText("모든 기기를 배치했습니다.")).toBeInTheDocument();
    expect(document.querySelector('input[name="markers"]')).toHaveValue(JSON.stringify([{ deviceId: "1042", x: 0.1, y: 0.1 }, { deviceId: "1050", x: 0.25, y: 0.5 }]));
    await userEvent.click(screen.getByRole("button", { name: "AM107 마커 제거" }));
    expect(document.querySelector('input[name="markers"]')).toHaveValue(JSON.stringify([{ deviceId: "1050", x: 0.25, y: 0.5 }]));
    await userEvent.click(screen.getByRole("button", { name: "보기 모드" }));
  });

  it("보기 모드에서 저장 오류를 보여 준다", async () => {
    await renderRoute(<FloorplanPanel view={{ imageUrl: "/p.png" }} devices={[]} canEdit={false} result={{ intent: "markers", error: { code: "DEVICE_NOT_FOUND" } }} />);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});

class FakeSource implements EventSourceLike {
  static last: FakeSource;
  readyState = 0;
  onopen: ((e: Event) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  listeners: Record<string, ((e: MessageEvent) => void)[]> = {};
  constructor(readonly url: string) {
    FakeSource.last = this;
  }
  addEventListener(type: string, l: (e: MessageEvent) => void) {
    (this.listeners[type] ??= []).push(l);
  }
  close() {}
}

describe("UI-DSH-02 개요 카드(DSH-01.02, DSH-05.01)", () => {
  it("기기 카드 현재값을 space:{id} 실시간 이벤트로 갱신, 쾌적도 배지는 글자+기호", async () => {
    const now = Date.parse("2026-10-04T00:00:00Z");
    const devices = [{ id: "1042", name: "AM107-067999", modelName: "AM107", connection: "ONLINE", lastSeenAt: "2026-10-03T23:59:48Z", battery: 92, rssi: -33, metrics: [{ key: "co2", value: 517, unit: "ppm" }] }];
    await renderRoute(
      <>
        <ComfortBadge state="WARNING" />
        <DeviceCards spaceId="31" devices={devices} now={now} lang="ko" streamOptions={{ createSource: (u) => new FakeSource(u), checkSession: async () => true }} />
        <ChildSpaces>{[{ id: "311", name: "강단", type: "ZONE" }]}</ChildSpaces>
      </>,
    );
    expect(await screen.findByText("경고")).toBeInTheDocument();
    expect(FakeSource.last.url).toBe(`/bff/stream/live?topics=${encodeURIComponent("space:31")}`);
    expect(screen.getByText("517ppm")).toBeInTheDocument();
    expect(screen.getByText("마지막 수신 12초 전 · 배터리 92% · -33dBm")).toBeInTheDocument();
    act(() => FakeSource.last.listeners["device-update"][0]({ data: JSON.stringify({ deviceId: "1042", metrics: [{ key: "co2", value: 1150, unit: "ppm", at: "2026-10-04T00:00:00Z" }], connection: "ONLINE" }), lastEventId: "" } as MessageEvent));
    expect(screen.getByText("1,150ppm")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "강단" })).toHaveAttribute("href", "/spaces/311");
  });

  it("기기가 없으면 안내와 기기 배치 링크(연결하지 않음)", async () => {
    await renderRoute(<DeviceCards spaceId="3" devices={[]} now={0} lang="ko" />);
    expect(await screen.findByText("이 공간에 기기가 없습니다")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "기기 배치" })).toHaveAttribute("href", "/devices/pending");
  });
});
