/**
 * DEV-02.07 UI-DEV-06 기기 상세 M4 — TC-DEV-070(AT-DEV-05.2: "냉방 켜짐" 구간이 띠로 겹쳐 보임), 규칙·알람 탭(경유 표시), 변경 이력 탭(API-DEV-27),
 * DEV-09.01 온보딩 바로가기(BR-DEV-26).
 */
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ChartHandle } from "~/components/charts/timeseries-chart";
import { renderRoute } from "../../../../test/render";
import { DeviceDataPanel, OnboardingChecklist } from "../components";
import { DeviceHistoryTab, DeviceRulesTab } from "../detail-tabs";

const live = { createSource: () => ({ readyState: 0, onopen: null, onerror: null, addEventListener() {}, close() {} }), checkSession: async () => true };

describe("TC-DEV-070 AT-DEV-05.2 명령 구간 띠", () => {
  it("액추에이터 데이터 탭: 적용된 명령(냉방 켜짐)을 다음 명령까지 띠로 겹치고, 끄면 띠가 사라진다", async () => {
    const handle: ChartHandle & { last?: { series: { markArea?: { data: [{ name: string; xAxis: number }, { xAxis: number }][] } }[] } } = {
      setOption: vi.fn((o) => {
        handle.last = o as never;
      }),
      resize: vi.fn(),
      dispose: vi.fn(),
    };
    const calls: string[] = [];
    const fetcher = vi.fn(async (path: string) => {
      calls.push(path);
      if (path.includes("/annotations")) return { ok: true as const, status: 200, data: { responses: [] } };
      if (path.includes("/commands")) {
        return {
          ok: true as const,
          status: 200,
          data: {
            responses: [
              {
                id: "c1",
                status: "APPLIED",
                deviceId: "2001",
                capability: "Thermostat",
                command: "set",
                args: { mode: "cool", targetTemperature: 24 },
                timeline: [{ status: "REQUESTED", at: "2026-10-03T03:00:00Z" }],
              },
              { id: "c2", status: "APPLIED", deviceId: "2001", capability: "Thermostat", command: "set", args: { mode: "off" }, timeline: [{ status: "REQUESTED", at: "2026-10-03T05:00:00Z" }] },
              { id: "c3", status: "FAILED", deviceId: "2001", capability: "Switch", command: "set", args: { on: true }, timeline: [{ status: "REQUESTED", at: "2026-10-03T06:00:00Z" }] },
            ],
          },
        };
      }
      return { ok: true as const, status: 200, data: { resolutionUsed: "1m", series: [{ metric: "temperature", unit: "℃", points: [["2026-10-03T04:00:00Z", 26, 0]] }] } };
    });
    const user = userEvent.setup();
    await renderRoute(
      <DeviceDataPanel
        deviceId="2001"
        metrics={["temperature"]}
        timezone="Asia/Seoul"
        now={() => Date.parse("2026-10-04T00:00:00Z")}
        fetcher={fetcher as never}
        live={live}
        chartFactory={async () => handle}
        showCommands
      />,
    );
    await waitFor(() => expect(handle.last?.series[0].markArea?.data.length).toBe(1));
    const [from, to] = handle.last!.series[0].markArea!.data[0];
    expect(from.name).toBe("Thermostat.set(cool, 24)");
    expect(from.xAxis).toBe(Date.parse("2026-10-03T03:00:00Z"));
    expect(to.xAxis).toBe(Date.parse("2026-10-03T05:00:00Z"));
    expect(calls.find((c) => c.includes("/commands"))).toBe("/bff/api/core/devices/2001/commands?from=2026-10-03T00%3A00%3A00Z&to=2026-10-04T00%3A00%3A00Z&status=APPLIED&size=100");
    await user.click(screen.getByLabelText("명령 구간 띠"));
    await waitFor(() => expect(handle.last?.series[0].markArea).toBeUndefined());
  });
});

describe("UI-DEV-06 규칙·알람·변경 이력 탭", () => {
  it("규칙(경유)·열린 알람·규칙 템플릿 적용(RULE_WRITE), 빈 상태와 실패 안내", async () => {
    const { unmount } = await renderRoute(
      <DeviceRulesTab
        rules={[{ rule: { ruleId: "r1", name: "실습실 고CO2", status: "ACTIVE", conditionSummary: "co2 > 1000", scope: { type: "SPACE", ids: ["3"] }, severity: "MAJOR" }, via: "SPACE" }]}
        alarms={[{ id: "a1", severity: "CRITICAL", status: "ACKNOWLEDGED", title: "CO2 1,240ppm", raisedAt: "2026-10-03T23:40:00Z" }]}
        canReadRules
        canWriteRules
        deviceId="1042"
        spaceId="31"
        timezone="Asia/Seoul"
        lang="ko"
      />,
    );
    expect(await screen.findByText("열린 알람 1건")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "CO2 1,240ppm" })).toHaveAttribute("href", "/alarms/a1");
    expect(screen.getByText("심각")).toBeInTheDocument();
    expect(screen.getByText("확인됨")).toBeInTheDocument();
    expect(screen.getByText("공간 경유")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "규칙 템플릿 적용" })).toHaveAttribute("href", "/rules/new?deviceId=1042&spaceId=31");
    unmount();
    await renderRoute(<DeviceRulesTab rules={[]} alarms={[]} rulesFailed alarmsFailed canReadRules canWriteRules={false} deviceId="1042" timezone="Asia/Seoul" lang="ko" />);
    expect(await screen.findByText("알람을 불러오지 못했습니다")).toBeInTheDocument();
    expect(screen.getByText("규칙을 불러오지 못했습니다")).toBeInTheDocument();
    expect(screen.queryByText("규칙 템플릿 적용")).not.toBeInTheDocument();
  });

  it("변경 이력: 시각·누가·무엇·변경 목록, 더 보기, 빈 상태·실패", async () => {
    const { unmount } = await renderRoute(
      <DeviceHistoryTab
        entries={[
          { at: "2026-10-03T02:00:00Z", actor: { userId: "8", name: "이통합" }, action: "MOVED", changes: { spaceId: [null, "31"], tags: [["a"], ["a", "b"]] } },
          { at: "2026-10-01T00:00:00Z", actor: "system", action: "CUSTOM", changes: null },
        ]}
        timezone="Asia/Seoul"
        lang="ko"
        moreHref="?tab=history&page=2"
      />,
    );
    expect(await screen.findByText("2026-10-03 11:00:00")).toBeInTheDocument();
    expect(screen.getByText("공간 이동")).toBeInTheDocument();
    expect(screen.getByText("spaceId: – → 31")).toBeInTheDocument();
    expect(screen.getByText('tags: ["a"] → ["a","b"]')).toBeInTheDocument();
    expect(screen.getByText("system")).toBeInTheDocument();
    expect(screen.getByText("CUSTOM")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "더 보기" })).toHaveAttribute("href", "/?tab=history&page=2");
    unmount();
    await renderRoute(<DeviceHistoryTab entries={[]} failed timezone="Asia/Seoul" lang="ko" />);
    expect(await screen.findByText("변경 이력을 불러오지 못했습니다")).toBeInTheDocument();
  });

  it("DEV-09.01 온보딩 미완료 항목 바로가기", async () => {
    await renderRoute(
      <OnboardingChecklist
        onboarding={{ firstData: true, model: false, space: true, decodeOk: true, rulesApplied: false }}
        links={(item) => (item === "rulesApplied" ? "/rules/new?deviceId=1" : undefined)}
      />,
    );
    expect(await screen.findByRole("link", { name: "규칙 바로가기" })).toHaveAttribute("href", "/rules/new?deviceId=1");
    expect(screen.queryByRole("link", { name: "모델 바로가기" })).not.toBeInTheDocument();
  });
});
