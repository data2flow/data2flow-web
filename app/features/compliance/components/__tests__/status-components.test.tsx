/**
 * 종합 점수 카드(UI-CMP-05, TC-CMP-028~031 화면 쪽)와 준수 현황판 부품(UI-CMP-06): 등급 색, 일부 제외·기본 기준 배지, [계산식 보기], 줄 펼침.
 */
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderRoute } from "../../../../../test/render";
import { gradeOf, resolvePeriod, type ScoreView, type StatusRow } from "../../model/status";
import { ScoreCard } from "../score-card";
import { StatusTable } from "../status-board";

const score = (extra: Partial<ScoreView> = {}): ScoreView => ({
  spaceId: "31",
  time: "2026-10-04T00:00:00Z",
  score: 85,
  grade: "GOOD",
  indices: { co2: 4, pm2_5: 5 },
  topPenaltyMetric: "co2",
  topPenaltyValue: 820,
  basis: "PROFILE",
  excludedMetrics: [],
  partial: false,
  profileVersions: [],
  formulaVersion: "IEQ-1",
  inputs: [{ metricKey: "co2", avg5m: 820, unit: "ppm", weight: 1, boundary: { lower: null, upper: 1000 } }],
  ...extra,
});

const row = (extra: Partial<StatusRow> = {}): StatusRow => ({
  space: { id: "31", name: "실습실" },
  profile: { id: "101", name: "우리 학교 기준", versionNo: 2 },
  ratio: 92.4,
  exceededByMetric: [{ metricKey: "co2", hours: 18 }],
  missingRatio: 2,
  qualityWarning: false,
  streak: { currentDays: 47, requiredDays: 90 },
  score: 72,
  ...extra,
});

describe("UI-CMP-05 종합 점수 카드", () => {
  it("점수·등급 색, [계산식 보기]로 공개 계산식과 입력값을 연다", async () => {
    await renderRoute(<ScoreCard score={score()} timezone="Asia/Seoul" lang="ko" />);
    expect(await screen.findByText("85")).toHaveClass("text-good-ink");
    expect(screen.getByText(/좋음/)).toBeInTheDocument();
    expect(screen.queryByText("기본 기준")).not.toBeInTheDocument();
    expect(screen.queryByText("5분 평균")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "계산식 보기" }));
    expect(screen.getByRole("button", { name: "계산식 보기" })).toHaveAttribute("aria-expanded", "true");
    const table = screen.getByRole("table");
    expect(within(table).getByText("5분 평균")).toBeInTheDocument();
    expect(within(table).getByText("CO2")).toBeInTheDocument();
    expect(screen.getByText("IEQ-1")).toBeInTheDocument();
  });

  it("기본 기준·일부 제외 배지, 데이터가 없으면 안내", async () => {
    await renderRoute(<ScoreCard score={score({ score: null, grade: null, basis: "DEFAULT", partial: true, indices: { co2: null } })} timezone="Asia/Seoul" lang="ko" />);
    expect(await screen.findByText("기본 기준")).toBeInTheDocument();
    expect(screen.getByText("일부 항목 제외")).toBeInTheDocument();
    expect(screen.getByText("최근 10분 데이터가 없어 점수를 계산하지 못했습니다")).toBeInTheDocument();
  });

  it("등급 경계(80·60·40)와 기간 고르기", () => {
    expect([80, 79, 60, 59, 40, 39, null].map(gradeOf)).toEqual(["GOOD", "MODERATE", "MODERATE", "POOR", "POOR", "BAD", null]);
    expect(resolvePeriod("7", null, null, "2026-10-04")).toEqual({ period: "7", from: "2026-09-28", to: "2026-10-04" });
    expect(resolvePeriod("custom", "2026-10-05", "2026-10-01", "2026-10-04")).toEqual({ period: "30", from: "2026-09-05", to: "2026-10-04" });
  });
});

describe("UI-CMP-06 준수 현황 표", () => {
  it("깨진 줄은 빨간 테두리와 깨짐 배지, 펼친 줄은 일별 상세(실패 시 안내)", async () => {
    const rows = [row(), row({ space: { id: "32", name: "사무실" }, qualityWarning: true, streak: { currentDays: 0, requiredDays: 90, brokenOn: "2026-10-02", brokenMetric: "co2" } })];
    await renderRoute(<StatusTable rows={rows} openKey="32:101" detail={null} linkFor={(k) => `/compliance/status${k ? `?open=${k}` : ""}`} timezone="Asia/Seoul" lang="ko" />);
    expect(await screen.findByText("47/90일")).toBeInTheDocument();
    expect(screen.getByText(/깨짐: CO2/)).toBeInTheDocument();
    expect(document.querySelector('[data-status-row="32:101"]')).toHaveClass("outline-bad");
    expect(screen.getByLabelText("데이터 품질 기준 미달(결측 10% 초과)")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /실습실/ })).toHaveAttribute("href", "/compliance/status?open=31:101");
    expect(screen.getByRole("link", { name: /사무실/ })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("일별 현황을 불러오지 못했습니다")).toBeInTheDocument();
  });
});
