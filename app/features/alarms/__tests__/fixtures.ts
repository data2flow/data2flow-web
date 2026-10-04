/** 알람 상세 부품 테스트 픽스처(API-RUL-11 모양) */
import type { AlarmDetailData } from "../components/alarm-detail-view";

export function detail(extra: Partial<AlarmDetailData["alarm"]> = {}): AlarmDetailData {
  return {
    alarm: {
      id: "9001",
      severity: "MAJOR",
      status: "ACTIVE",
      title: "고CO2 · 실습실 / 전방 좌측",
      source: { type: "RULE", ruleId: "301", ruleName: "본관 고CO2" },
      device: { id: "1042", name: "EM500-CO2-152590" },
      space: { id: "31", path: ["본관", "3층", "실습실"] },
      metric: "co2",
      unit: "ppm",
      triggerValue: 1050,
      peakValue: 1180,
      lastValue: 1120,
      occurrenceCount: 3,
      raisedAt: "2026-10-03T01:05:00Z",
      threshold: { raise: 1000, clear: 900 },
      ...extra,
    },
    events: [
      { type: "RERAISED", at: "2026-10-03T01:09:00Z", data: { value: 1180 } },
      { type: "RAISED", at: "2026-10-03T01:05:00Z", data: { value: 1050 } },
      { type: "NOTIFIED", at: "2026-10-03T01:05:02Z", data: { channel: "TELEGRAM", recipient: "시설팀", status: "SENT" } },
    ],
    children: [],
    chart: { metric: "co2", from: "2026-10-02T23:05:00Z", to: "2026-10-03T03:05:00Z" },
  };
}
