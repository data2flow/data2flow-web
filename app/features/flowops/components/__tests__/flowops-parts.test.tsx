/**
 * 자동화 부가 화면 부품: 승격 대상 매핑 표(UI-FLW-13, TC-FLW-200), 스냅샷 비교(UI-FLW-18, TC-FLW-233), 연결 테스트 결과(UI-FLW-08, TC-FLW-083),
 * 자동 검사 결과(UI-FLW-19, TC-FLW-243), 하위 메뉴(권한별).
 */
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { meOf, renderRoute } from "../../../../../test/render";
import { buildMappingRows } from "../../model/mapping";
import { normalizeCompare } from "../../model/snapshot";
import { ChecksList, FlowOpsTabs, MappingTable, SinkTestResultView, SnapshotCompareView } from "../parts";

describe("UI-FLW-13 MappingTable", () => {
  const rows = buildMappingRows(
    [
      { kind: "SPACE", id: "v-31", name: "실습실" },
      { kind: "RELATION", id: "controls/Thermostat", name: "controls/Thermostat" },
      { kind: "DEVICE", id: "v-ac", name: "가상 에어컨" },
    ],
    { SPACE: [{ id: "31", name: "실습실" }], DEVICE: [{ id: "1042", name: "실습실 에어컨" }] },
  );

  it("TC-FLW-200 AT-FLW-21.2 가상 기기 1대 매핑 누락 → ✗와 누락 수, 요청 버튼 막힘 → 고르면 풀림", async () => {
    await renderRoute(<MappingTable rows={rows} submit={(blocked) => <button disabled={blocked}>요청</button>} />, { session: meOf("OPERATOR") });
    expect(await screen.findByText("매핑되지 않은 대상 1개")).toBeInTheDocument();
    expect(screen.getByText("공간 매핑을 따름")).toBeInTheDocument();
    expect(screen.getAllByText("✗ 매핑 안 됨")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "요청" })).toBeDisabled();
    expect(screen.getByLabelText("실습실의 대상")).toHaveValue("31");
    await userEvent.selectOptions(screen.getByLabelText("가상 에어컨의 대상"), "1042");
    expect(screen.queryByText("매핑되지 않은 대상 1개")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "요청" })).toBeEnabled();
    await userEvent.selectOptions(screen.getByLabelText("실습실의 대상"), "");
    expect(screen.getByText("매핑되지 않은 대상 1개")).toBeInTheDocument();
  });

  it("읽기 전용(대상 이름), 참조 없음 안내", async () => {
    const mapped = buildMappingRows([{ kind: "DEVICE", id: "v-ac", name: "가상 에어컨" }], { DEVICE: [{ id: "1042", name: "실습실 에어컨" }] }, { "DEVICE:v-ac": "1042" });
    const { unmount } = await renderRoute(<MappingTable rows={mapped} readOnly />, { session: meOf("OPERATOR") });
    expect(await screen.findByText("실습실 에어컨")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    unmount();
    await renderRoute(<MappingTable rows={[]} />, { session: meOf("OPERATOR") });
    expect(await screen.findByText("매핑할 참조가 없습니다")).toBeInTheDocument();
  });
});

describe("UI-FLW-18 SnapshotCompareView", () => {
  it("TC-FLW-233 노드 추가 1, 설정 변경 2, 스크립트 v3→v4(같은 버전은 숨김)", async () => {
    const compare = normalizeCompare({
      flows: [{ flowId: "f", flowName: "고온이면 냉방", added: ["n-dbg"], removed: ["n-old"], changed: [{ nodeId: "n-thr", field: "config.value", from: 27, to: 28 }, { nodeId: "n-thr", field: "config.args", from: { a: 1 }, to: null }] }],
      scripts: [{ scriptId: "s-12", from: 3, to: 4 }, { scriptId: "s-13", from: 1, to: 1 }],
      subflows: [{ subflowId: "sf-avg", from: null, to: 2 }],
    });
    await renderRoute(<SnapshotCompareView compare={compare} names={["S1", "S2"]} />, { session: meOf("OPERATOR") });
    expect(await screen.findByText("노드 추가 1, 삭제 1, 설정 변경 2, 스크립트 버전 차이 1")).toBeInTheDocument();
    expect(screen.getByText("노드 추가: n-dbg")).toBeInTheDocument();
    expect(screen.getByText("노드 삭제: n-old")).toBeInTheDocument();
    expect(screen.getByText("n-thr config.value: 27 → 28")).toBeInTheDocument();
    expect(screen.getByText('n-thr config.args: {"a":1} → –')).toBeInTheDocument();
    expect(screen.getByText("스크립트 s-12: v3 → v4")).toBeInTheDocument();
    expect(screen.queryByText(/s-13/)).not.toBeInTheDocument();
    expect(screen.getByText("서브플로우 sf-avg: – → v2")).toBeInTheDocument();
  });

  it("차이 없음", async () => {
    await renderRoute(<SnapshotCompareView compare={normalizeCompare({})} names={["S1", "S2"]} />, { session: meOf("OPERATOR") });
    expect(await screen.findByText("차이가 없습니다")).toBeInTheDocument();
  });
});

describe("UI-FLW-08 SinkTestResultView", () => {
  it("TC-FLW-083 성공(지연 ms)·원인별 실패 문구", async () => {
    const { unmount } = await renderRoute(<SinkTestResultView result={{ ok: true, latencyMs: 12 }} />, { session: meOf("INTEGRATOR") });
    expect(await screen.findByText("연결됨 (12ms)")).toBeInTheDocument();
    unmount();
    const second = await renderRoute(<SinkTestResultView result={{ ok: false, error: { kind: "TLS", message: "handshake" } }} />, { session: meOf("INTEGRATOR") });
    expect(await screen.findByText("연결할 수 없습니다: TLS 오류 (handshake)")).toBeInTheDocument();
    second.unmount();
    await renderRoute(<SinkTestResultView result={null} failureMessage="연결할 수 없습니다: TIMEOUT" />, { session: meOf("INTEGRATOR") });
    expect(await screen.findByText(/연결할 수 없습니다: 시간 초과/)).toBeInTheDocument();
  });
});

describe("UI-FLW-19 ChecksList·하위 메뉴", () => {
  it("TC-FLW-243 검사 통과·실패와 사유, 검사 없음", async () => {
    const { unmount } = await renderRoute(
      <ChecksList
        checks={[
          { name: "testRun", passed: true },
          { name: "replayCommands", passed: false, detail: "120 / 50" },
          { name: "custom", passed: true, detail: null },
        ]}
      />,
      { session: meOf("ADMIN") },
    );
    expect(await screen.findByText("통과 · 시험 실행")).toBeInTheDocument();
    expect(screen.getByText("실패 · 재생 제어 횟수 — 120 / 50")).toBeInTheDocument();
    expect(screen.getByText("통과 · custom")).toBeInTheDocument();
    unmount();
    await renderRoute(<ChecksList checks={[]} />, { session: meOf("ADMIN") });
    expect(await screen.findByText("–")).toBeInTheDocument();
  });

  it("하위 메뉴는 권한으로 거른다: OPERATOR는 플로우·스냅샷, ADMIN은 전부", async () => {
    const { unmount } = await renderRoute(<FlowOpsTabs current="snapshots" />, { session: meOf("OPERATOR") });
    const links = await screen.findAllByRole("link");
    expect(links.map((a) => a.textContent)).toEqual(["플로우", "스냅샷"]);
    expect(screen.getByRole("link", { name: "스냅샷" })).toHaveAttribute("aria-current", "page");
    unmount();
    await renderRoute(<FlowOpsTabs current="sinks" />, { session: meOf("ADMIN") });
    expect((await screen.findAllByRole("link")).map((a) => a.getAttribute("href"))).toEqual(["/automation/flows", "/automation/snapshots", "/automation/pipelines", "/automation/packages", "/automation/sink-connections"]);
  });
});
