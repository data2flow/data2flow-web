/**
 * 수집 M5 화면 모델: 재처리(ING-01.04, UI-ING-05)와 데이터 품질(ING-06.02, UI-ING-06)
 */
import { describe, expect, it } from "vitest";
import { checkReprocessForm, distributionRows, formatDuration, hasActiveJob, isoToZonedLocal, jobTone, progressOf, qualityLink, scoreTone, sortByScore, trendSeries, zonedLocalToIso } from "../m5";

describe("ING-01.04 TC-ING-030 재처리 폼 검증과 진행률", () => {
  const form = { sourceId: "7", deviceIds: [], from: "2026-09-26T00:00:00Z", to: "2026-10-03T00:00:00Z", memo: " 보정 v4 " };

  it("AT-ING-08.2 소스 필수, 기간 순서·31일 이하, 메모 200자, 요청 본문", () => {
    expect(checkReprocessForm(form).body).toEqual({ sourceId: 7, from: "2026-09-26T00:00:00Z", to: "2026-10-03T00:00:00Z", memo: "보정 v4" });
    expect(checkReprocessForm({ ...form, deviceIds: ["11", "x"], memo: "" }).body).toEqual({ sourceId: 7, deviceIds: [11], from: "2026-09-26T00:00:00Z", to: "2026-10-03T00:00:00Z" });
    expect(checkReprocessForm({ ...form, sourceId: "" }).errors.sourceId).toBe("source");
    expect(checkReprocessForm({ ...form, from: "" }).errors.period).toBe("periodRequired");
    expect(checkReprocessForm({ ...form, from: form.to }).errors.period).toBe("periodOrder");
    expect(checkReprocessForm({ ...form, from: "2026-08-01T00:00:00Z" }).errors.period).toBe("periodTooLong");
    expect(checkReprocessForm({ ...form, memo: "x".repeat(201) }).errors.memo).toBe("memo");
  });

  it("진행률(서버 값 우선, 완료 100), 상태 색, 진행 중 여부, 예상 시간 단위", () => {
    expect(progressOf({ status: "RUNNING", processed: 64401, total: 102330, progressPercent: null })).toBe(62.9);
    expect(progressOf({ status: "RUNNING", processed: 1, total: 2, progressPercent: 63 })).toBe(63);
    expect(progressOf({ status: "COMPLETED", processed: 0, total: 0 })).toBe(100);
    expect(progressOf({ status: "PENDING", processed: 0, total: 0 })).toBe(0);
    expect(["COMPLETED", "FAILED", "CANCELLED", "RUNNING", "PENDING"].map(jobTone)).toEqual(["success", "danger", "neutral", "info", "warning"]);
    expect(hasActiveJob([{ status: "COMPLETED" }, { status: "QUEUED" }])).toBe(true);
    expect(hasActiveJob([{ status: "FAILED" }])).toBe(false);
    expect(formatDuration(42)).toEqual({ unit: "s", n: 42 });
    expect(formatDuration(361)).toEqual({ unit: "m", n: 7 });
    expect(formatDuration(5400)).toEqual({ unit: "h", n: 1.5 });
    expect(formatDuration(null)).toEqual({ unit: "s", n: 0 });
  });

  it("조직 시간대 벽시계 ↔ UTC(datetime-local)", () => {
    expect(zonedLocalToIso("2026-10-03T09:00", "Asia/Seoul")).toBe("2026-10-03T00:00:00Z");
    expect(zonedLocalToIso("bad", "Asia/Seoul")).toBeNull();
    expect(isoToZonedLocal("2026-10-03T00:00:00Z", "Asia/Seoul")).toBe("2026-10-03T09:00");
    expect(isoToZonedLocal("x", "UTC")).toBe("");
    expect(isoToZonedLocal(null, "UTC")).toBe("");
  });
});

describe("ING-06.02 TC-ING-072 데이터 품질 화면 모델", () => {
  const items = [
    { targetId: "2", targetName: "EM320", score: 88, completeness: 97, timeliness: 99, validity: 100, stability: 80, gaps: 0, clockSkewSuspect: false },
    { targetId: "1", targetName: "AM103", score: 41, completeness: 55, timeliness: 98, validity: 100, stability: 60, gaps: 3, clockSkewSuspect: false },
  ];

  it("AT-ING-09.4 점수 오름차순, 점수 색, 기기 묶음만 문제 구간 차트 링크", () => {
    expect(sortByScore(items).map((i) => i.targetId)).toEqual(["1", "2"]);
    expect([41, 70, 90].map(scoreTone)).toEqual(["bad", "warn", "good"]);
    expect(qualityLink("device", items[1])).toBe("/devices/1?tab=chart&highlight=gap,range");
    expect(qualityLink("space", items[1])).toBeNull();
  });

  it("문제 유형 분포 비율과 추이 계열", () => {
    expect(distributionRows({ gaps: 30, outOfRange: 10, suspect: 0, late: 5, expected: 1000, received: 970 })).toEqual([
      { key: "gaps", count: 30, percent: 3 },
      { key: "outOfRange", count: 10, percent: 1 },
      { key: "suspect", count: 0, percent: 0 },
      { key: "late", count: 5, percent: 0.5 },
    ]);
    expect(distributionRows(null)).toEqual([]);
    expect(distributionRows({ gaps: 1, outOfRange: 0, suspect: 0, late: 0, expected: 0, received: 0 })[0].percent).toBe(100);
    expect(trendSeries([{ day: "2026-10-02", score: 41 }], "점수")[0].points).toEqual([["2026-10-02T00:00:00Z", 41, null]]);
  });
});
