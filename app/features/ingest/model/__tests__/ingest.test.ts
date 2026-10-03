/**
 * 수집 모니터·실패 메시지 모델(DSH-03.01·03.03·03.04, ING-07.03, UI-ING-01).
 */
import { describe, expect, it } from "vitest";
import {
  alertTone,
  cardTone,
  checkDiscardReason,
  checkThresholds,
  connectionTone,
  failureLinkOf,
  failureStageOf,
  latencySeries,
  mergeLive,
  messageTopic,
  orderedStages,
  periodRange,
  reprocessProblem,
  secondsSince,
  stageFailing,
  summarize,
  throughputSeries,
} from "../ingest";

describe("DSH-03.04 TC-DSH-021 단계 → 실패 목록 링크", () => {
  it("서버 failureLink를 먼저, 없으면 단계·오류 코드로 만든다. SOURCE·VALIDATE는 링크 없음", () => {
    expect(failureLinkOf({ key: "SCRIPT", failureLink: "https://x/ingest/failures?stage=SCRIPT&code=SCRIPT_ERROR" })).toBe("/ingest/failures?stage=SCRIPT&code=SCRIPT_ERROR");
    expect(failureLinkOf({ key: "SCRIPT" })).toBe("/ingest/failures?stage=SCRIPT&code=SCRIPT_ERROR");
    expect(failureLinkOf({ key: "DECODE" })).toBe("/ingest/failures?stage=DECODE&code=DECODE_ERROR");
    expect(failureLinkOf({ key: "EVENT" })).toBe("/ingest/failures?stage=PUBLISH");
    expect(failureLinkOf({ key: "STORE" })).toBe("/ingest/failures?stage=STORE");
    expect(failureLinkOf({ key: "SOURCE" })).toBeUndefined();
    expect(failureStageOf("VALIDATE")).toBeUndefined();
  });

  it("단계 순서 고정, 실패 여부, 실시간 합치기", () => {
    expect(orderedStages([{ key: "STORE", inPerMin: 2 }]).map((s) => s.key)).toEqual(["SOURCE", "DECODE", "SCRIPT", "VALIDATE", "STORE", "EVENT"]);
    expect(orderedStages(undefined)[4]).toEqual({ key: "STORE" });
    expect(stageFailing({ key: "SCRIPT", failPerMin: 12 })).toBe(true);
    expect(stageFailing({ key: "SCRIPT" })).toBe(false);
    const base = { stages: [{ key: "SCRIPT" }], sources: [{ id: "7", name: "a" }], throughput: [] };
    expect(mergeLive(base, { stages: [{ key: "SCRIPT", failPerMin: 3 }] })).toMatchObject({ stages: [{ failPerMin: 3 }], sources: base.sources });
    expect(mergeLive(base, null)).toBe(base);
    expect(mergeLive(base, { sources: [] }).sources).toEqual([]);
  });
});

describe("UI-ING-01 카드 색·경고", () => {
  it("CRITICAL이면 빨강, WARNING이면 주황, 해당 없으면 초록", () => {
    expect(cardTone("streamLagSec", [{ level: "CRITICAL", code: "INGEST_LAG_HIGH" }])).toBe("bad");
    expect(cardTone("heartbeat", [{ level: "WARNING", code: "HEARTBEAT_DELAYED" }])).toBe("warn");
    expect(cardTone("perMinute", [{ level: "CRITICAL", code: "INGEST_LAG_HIGH" }])).toBe("good");
    expect(cardTone("unknown", undefined)).toBe("good");
    expect(alertTone("CRITICAL")).toBe("danger");
    expect(alertTone("WARNING")).toBe("warning");
    expect(["CONNECTED", "CONNECTING", "ERROR", undefined].map((s) => connectionTone(s))).toEqual(["good", "warn", "bad", "muted"]);
  });

  it("알람 기준 검증: 범위와 경고 < 위험", () => {
    expect(checkThresholds({ lagWarnSec: 60, lagCriticalSec: 300, heartbeatCriticalSec: 120 })).toEqual({});
    expect(checkThresholds({ lagWarnSec: 300, lagCriticalSec: 300, heartbeatCriticalSec: 120 })).toEqual({ lagWarnSec: "order" });
    expect(checkThresholds({ lagWarnSec: 5, lagCriticalSec: 8000, heartbeatCriticalSec: 601 })).toEqual({ lagWarnSec: "range", lagCriticalSec: "range", heartbeatCriticalSec: "range" });
    expect(checkThresholds({ lagWarnSec: Number.NaN, lagCriticalSec: 100, heartbeatCriticalSec: 10 })).toEqual({ lagWarnSec: "range" });
  });
});

describe("DSH-03.03 TC-DSH-027 메시지 스트림 토픽(API-DSH-21)", () => {
  it("소스·기기·결과 필터를 토픽 쿼리에 그대로 넣는다", () => {
    expect(messageTopic({})).toBe("ingest-messages?sourceId=&deviceId=&result=");
    expect(messageTopic({ sourceId: "7", deviceId: "1042", result: "SCRIPT_ERROR" })).toBe("ingest-messages?sourceId=7&deviceId=1042&result=SCRIPT_ERROR");
  });
});

describe("DSH-03.02·OPS-01.02 차트 계열", () => {
  it("소스별 처리량과 지연 p50/p95", () => {
    const series = throughputSeries({ stages: [], sources: [{ id: "7", name: "ChirpStack s3" }], throughput: [{ sourceId: "7", points: [["2026-10-03T23:59:00Z", 12]] }, { sourceId: "9", points: [] }] }, "건/분");
    expect(series[0]).toMatchObject({ key: "src-7", label: "ChirpStack s3", unit: "건/분", points: [["2026-10-03T23:59:00Z", 12, null]] });
    expect(series[1].label).toBe("9");
    expect(throughputSeries({ stages: [], sources: [] }, "x")).toEqual([]);
    const latency = latencySeries([{ t: "2026-10-03T23:59:00Z", latencyP50Ms: 200 }], { p50: "p50", p95: "p95" });
    expect(latency.map((s) => s.points[0][1])).toEqual([200, null]);
  });
});

describe("ING-07.03 재처리·폐기 규칙", () => {
  it("1~5,000건, 폐기 사유 2~200자, 결과 집계", () => {
    expect(reprocessProblem(0)).toBe("none");
    expect(reprocessProblem(5000)).toBeUndefined();
    expect(reprocessProblem(5001)).toBe("tooMany");
    expect(checkDiscardReason(" x ")).toBe(false);
    expect(checkDiscardReason("매핑 오류")).toBe(true);
    expect(checkDiscardReason("x".repeat(201))).toBe(false);
    expect(summarize({ results: [{ id: "1", outcome: "RESOLVED" }, { id: "2", outcome: "LOCKED" }, { id: "3", outcome: "SAME_ERROR" }] })).toEqual({ RESOLVED: 1, SAME_ERROR: 1, OTHER_ERROR: 0, LOCKED: 1 });
  });

  it("기간과 경과 초", () => {
    const now = Date.parse("2026-10-04T00:00:00Z");
    expect(periodRange(1, now)).toEqual({ from: "2026-10-03T00:00:00Z", to: "2026-10-04T00:00:00Z" });
    expect(periodRange(99, now).from).toBe("2026-09-27T00:00:00Z");
    expect(secondsSince(now - 5500, now)).toBe(5);
    expect(secondsSince(null, now)).toBeNull();
    expect(secondsSince(now + 1000, now)).toBe(0);
  });
});
