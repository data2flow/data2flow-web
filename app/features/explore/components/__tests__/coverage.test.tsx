/**
 * TSD-02.04 UI-TSD-06 데이터 완전성: 기기별 행(완전성 낮은 순, 가장 긴 공백), 행을 펼치면 공백 목록과 탐색기 링크(앞뒤 1시간).
 */
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderRoute } from "../../../../../test/render";
import { decodeState } from "../../model/state";
import { CoverageTable, coverageRows, gapHref } from "../coverage";

const DEVICES = [
  { deviceId: "1050", deviceName: "EM300-TH-151606", intervalSec: 600, expected: 144, missing: 0, completenessPercent: 100 },
  { deviceId: "1042", deviceName: "AM107-067999", intervalSec: 600, expected: 144, missing: 11, completenessPercent: 92.4 },
];
const GAPS = [
  { deviceId: "1042", from: "2026-10-03T10:00:00Z", to: "2026-10-03T10:20:00Z", expectedCount: 2 },
  { deviceId: "1042", from: "2026-10-03T02:00:00Z", to: "2026-10-03T03:30:00Z", expectedCount: 9 },
];

describe("UI-TSD-06 데이터 완전성", () => {
  it("기기별 실제 수신 수와 가장 긴 공백을 계산하고 완전성이 낮은 기기부터 보인다", () => {
    const rows = coverageRows(DEVICES, GAPS);
    expect(rows.map((r) => [r.deviceId, r.received, r.gaps.length, r.longestGapMs])).toEqual([
      ["1042", 133, 2, 90 * 60_000],
      ["1050", 144, 0, 0],
    ]);
    expect(rows[0].gaps[0].from).toBe("2026-10-03T02:00:00Z");
  });

  it("공백 링크는 탐색기의 앞뒤 1시간 구간, 측정 항목을 모르면 기기 상세 데이터 탭", () => {
    const href = gapHref(GAPS[1], "AM107", ["temperature", "co2"]);
    const state = decodeState(new URLSearchParams(href.split("?")[1]).get("q"));
    expect(state).toMatchObject({ range: "custom", from: "2026-10-03T01:00:00Z", to: "2026-10-03T04:30:00Z" });
    expect(state.series.map((s) => s.metric)).toEqual(["temperature", "co2"]);
    expect(gapHref(GAPS[1], "AM107", [])).toBe("/devices/1042?tab=data");
  });

  it("기기를 누르면 공백 목록을 펼친다", async () => {
    const user = userEvent.setup();
    await renderRoute(<CoverageTable rows={coverageRows(DEVICES, GAPS)} metricsOf={{ "1042": ["temperature"] }} timezone="Asia/Seoul" lang="ko" />);
    expect(await screen.findByText("92.4%")).toBeInTheDocument();
    expect(screen.getByText("1시간 30분")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /AM107-067999/ }));
    const list = screen.getByRole("list", { name: "AM107-067999 공백 목록" });
    expect(list).toHaveTextContent("누락 추정 9건");
    expect(screen.getByRole("button", { name: "EM300-TH-151606" })).toBeDisabled();
  });
});
