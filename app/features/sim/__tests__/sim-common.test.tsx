/**
 * 가상 환경 공용 부품: 구역 탭(00-navigation.md "가상 환경"), 실행 상태 배지, 시뮬레이션·실제 시각 함께 표시, 영어 문구(ADR-037).
 */
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { meOf, renderRoute } from "../../../../test/render";
import { Clocks, RunStatusBadge, SimAreaTabs, VirtualBadge } from "../components/common";

describe("가상 환경 공용 부품", () => {
  it("구역 탭 6개와 현재 탭, 상태 배지, 시각 두 개", async () => {
    await renderRoute(
      <>
        <SimAreaTabs current="scenarios" />
        <RunStatusBadge status="PAUSED" />
        <RunStatusBadge status={"UNKNOWN" as never} />
        <Clocks simClock="2026-08-12T04:00:00Z" now={Date.parse("2026-10-04T01:00:00Z")} timezone="Asia/Seoul" lang="ko" />
        <VirtualBadge />
      </>,
      { session: meOf("OPERATOR") },
    );
    const links = (await screen.findByRole("navigation", { name: "tabs" })).querySelectorAll("a");
    expect([...links].map((a) => a.getAttribute("href"))).toEqual(["/sim", "/sim/catalog", "/sim/profiles", "/sim/spaces", "/sim/scenarios", "/sim/replay"]);
    expect(screen.getByRole("link", { name: "시나리오" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("일시정지")).toBeInTheDocument();
    expect(screen.getByText("UNKNOWN")).toBeInTheDocument();
    expect(screen.getByText("2026-08-12 13:00:00")).toBeInTheDocument();
    expect(screen.getByText("2026-10-04 10:00:00")).toBeInTheDocument();
    expect(screen.getByText("가상")).toBeInTheDocument();
  });

  it("영어 화면", async () => {
    await renderRoute(<SimAreaTabs current="home" />, { session: meOf("OPERATOR"), lang: "en" });
    expect(await screen.findByRole("link", { name: "Device catalog" })).toBeInTheDocument();
  });
});
