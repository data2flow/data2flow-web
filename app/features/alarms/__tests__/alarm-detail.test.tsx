/**
 * TC-RUL-039 알람 상세(UI-RUL-05, RUL-02.01): 심각도 색·출처 링크(규칙 → 규칙 편집, 플로우 → 플로우 노드), 대상 경로,
 * 발생 값·최고값·횟수, 공간 범위 밖 대상 이름은 가림. 차트(기준선 띠·알람 구간), 하위 알람, 발송 이력(TC-RUL-066 2건 SENT).
 */
import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { meOf, renderRoute } from "../../../../test/render";
import { fakeChart } from "../../rules/__tests__/fakes";
import { AlarmDetailView } from "../components/alarm-detail-view";
import { SeverityBadge } from "../components/badges";
import { detail } from "./fixtures";

const NOW = Date.parse("2026-10-03T01:14:00Z");
const series = [{ key: "a", label: "co2", unit: "ppm", points: [["2026-10-03T01:00:00Z", 980, 0], ["2026-10-03T01:05:00Z", 1050, 0]] as [string, number, number][] }];

describe("TC-RUL-039 알람 상세 표시", () => {
  it("심각도·상태·출처 규칙 링크·대상 링크·값·횟수·지속, 기준선 띠와 알람 구간, 발송 이력 2건 SENT", async () => {
    const chart = fakeChart();
    await renderRoute(
      <AlarmDetailView
        detail={detail()}
        deliveries={[
          { deliveryId: "d-1", channel: "WEB", recipient: "김운영", status: "SENT", attempts: 1, sentAt: "2026-10-03T01:05:01Z" },
          { deliveryId: "d-2", channel: "TELEGRAM", recipient: "시설팀", status: "SENT", attempts: 1, sentAt: "2026-10-03T01:05:02Z" },
          { deliveryId: "d-3", channel: "TELEGRAM", recipient: "박팀장", status: "SKIPPED", skipReason: "DND", attempts: 0, lastError: "방해 금지" },
        ]}
        series={series}
        users={[{ userId: "7", name: "김운영" }]}
        meId="7"
        canHandle
        timezone="Asia/Seoul"
        nowMs={NOW}
        chartFactory={chart.factory}
      />,
      { session: meOf("OPERATOR") },
    );
    expect(await screen.findByText("MAJOR 중요")).toBeInTheDocument();
    expect(screen.getAllByText("발생").length).toBeGreaterThan(1);
    expect(screen.getByRole("link", { name: "본관 고CO2" })).toHaveAttribute("href", "/rules/301");
    expect(screen.getByRole("link", { name: "EM500-CO2-152590" })).toHaveAttribute("href", "/devices/1042");
    expect(screen.getByText(/본관 \/ 3층 \/ 실습실/)).toBeInTheDocument();
    expect(screen.getByText("발생 1,050 ppm · 최고 1,180 ppm · 현재 1,120 ppm")).toBeInTheDocument();
    expect(screen.getByText(/3회 · 지속 9분/)).toBeInTheDocument();
    expect(screen.getByText("발생 기준 1000 · 해제 기준 900")).toBeInTheDocument();
    await waitFor(() => expect(chart.options.length).toBeGreaterThan(0));
    expect(JSON.stringify(chart.options.at(-1))).toContain("markArea");
    const table = screen.getByRole("table");
    expect(within(table).getAllByText("SENT")).toHaveLength(2);
    expect(within(table).getByText("SKIPPED_DND")).toBeInTheDocument();
    const timeline = screen.getByRole("list", { name: "타임라인" });
    expect(within(timeline).getAllByRole("listitem").map((li) => li.textContent?.replace(/^.*?\d{2}:\d{2}:\d{2}/, ""))).toEqual(["발생값 1050", "알림 발송TELEGRAM · 시설팀 · SENT", "재발생값 1180"]);
  });

  it("플로우 출처는 플로우 노드로, 권한 밖 대상 이름은 가림, 시스템 출처는 링크 없음, 하위 알람·해제 사유·상위 알람", async () => {
    const { unmount } = await renderRoute(
      <AlarmDetailView detail={{ ...detail({ source: { type: "FLOW", flowId: "f-7f3a", nodeId: "n-thr00001", flowName: "고온이면 냉방" }, device: { id: "1099", name: null }, status: "CLEARED", clearedAt: "2026-10-03T01:20:00Z", clearReason: "PARENT_CLEARED", parentAlarmId: "9000", assignee: { userId: "1", name: "홍길동" } }) }} deliveries={null} series={[]} users={[]} canHandle={false} timezone="Asia/Seoul" nowMs={NOW} />,
      { session: meOf("VIEWER") },
    );
    expect(await screen.findByRole("link", { name: "고온이면 냉방 · n-thr00001" })).toHaveAttribute("href", "/automation/flows/f-7f3a?node=n-thr00001");
    expect(screen.getByText(/권한 밖 대상/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /1099/ })).toBeNull();
    expect(screen.getByText(/상위 알람 해제/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "상위 알람 보기" })).toHaveAttribute("href", "/alarms/9000");
    expect(screen.getByText("홍길동")).toBeInTheDocument();
    unmount();
    await renderRoute(
      <AlarmDetailView
        detail={{ ...detail({ source: { type: "SYSTEM" }, device: null, childCount: 2, severity: "CRITICAL", threshold: null }), events: [], children: [{ ...detail().alarm, id: "9101", title: "무수신 · EM300", status: "SUPPRESSED", suppressedReason: "PARENT" }] }}
        deliveries={[]}
        series={[]}
        users={[]}
        canHandle={false}
        timezone="Asia/Seoul"
        nowMs={NOW}
      />,
      { session: meOf("VIEWER") },
    );
    expect(await screen.findByText("시스템")).toBeInTheDocument();
    expect(screen.getByText("하위 알람 1건")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "무수신 · EM300" })).toHaveAttribute("href", "/alarms/9101");
    expect(screen.getByText("기록이 없습니다")).toBeInTheDocument();
    expect(screen.getByText("발송한 알림이 없습니다")).toBeInTheDocument();
  });

  it("심각도 배지는 글자를 함께(짧은 표기), 모르는 값은 그대로", async () => {
    await renderRoute(
      <>
        <SeverityBadge severity="CRITICAL" short />
        <SeverityBadge severity="WEIRD" />
      </>,
      { session: meOf("VIEWER") },
    );
    expect(await screen.findByText("CRIT")).toBeInTheDocument();
    expect(screen.getByText("WEIRD")).toBeInTheDocument();
  });
});
