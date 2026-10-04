/**
 * 실행 결과 리포트의 기대 결과 판정(UI-SIM-12, SIM-04.06): 판정(통과·실패·판정 불가), 기대 결과 설명, 근거 링크.
 * 리포트(API-SIM-17)의 `expectations[]`는 판정과 근거만 담고, 설명은 시나리오(API-SIM-12)의 `expectations[]`를 ID로 찾아 만든다.
 */
import type { Expectation, SimReport } from "./types";

export type ReportExpectation = SimReport["expectations"][number];
export type Verdict = "PASSED" | "FAILED" | "SKIPPED";

/** 정지(부분) 실행에서 판정할 수 없던 항목은 SKIPPED(TC-SIM-057) */
export function verdictOf(x: ReportExpectation): Verdict {
  if (x.state === "SKIPPED" || x.passed === null || x.passed === undefined) return "SKIPPED";
  return x.passed ? "PASSED" : "FAILED";
}

/** 리포트의 시나리오에서 기대 결과 정의를 찾는다(없으면 undefined) */
export function scenarioExpectations(report: Pick<SimReport, "scenario">): Expectation[] {
  const scenario = report.scenario;
  if (!scenario || typeof scenario === "string") return [];
  return Array.isArray(scenario.expectations) ? scenario.expectations : [];
}

const str = (v: unknown) => (v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));

/**
 * 기대 결과 한 줄 설명의 문구 키와 값. 예: "10:30까지 ERV-1 power=ON", "알람 == 1건", "temperature 22~26 90% 유지", "제어 10회 이하"
 * `names`는 기기 ID → 이름
 */
export function describeExpectation(exp: Expectation | undefined, names: Record<string, string> = {}): { key: string; values: Record<string, string> } | null {
  if (!exp) return null;
  const target = exp.target ?? {};
  const condition = exp.condition ?? {};
  const device = target.deviceId !== undefined ? (names[String(target.deviceId)] ?? String(target.deviceId)) : "";
  switch (exp.kind) {
    case "DEVICE_STATE_REACHED":
      return { key: exp.deadline ? "deviceStateBy" : "deviceState", values: { device, state: Object.entries(condition).map(([k, v]) => `${k}=${str(v)}`).join(", "), deadline: exp.deadline ?? "" } };
    case "ALARM_COUNT":
      return { key: "alarmCount", values: { op: str(condition.op ?? "=="), value: str(condition.value) } };
    case "METRIC_RANGE_RATIO":
      return { key: "metricRange", values: { metric: str(target.metric), min: str(condition.min), max: str(condition.max), pct: condition.ratio === undefined ? "" : String(Math.round(Number(condition.ratio) * 100)) } };
    case "CONTROL_COUNT_MAX":
      return { key: "controlMax", values: { device, max: str(condition.max) } };
    default:
      return null;
  }
}

/** 근거를 확인할 화면: 알람 수 → 알람 목록(규칙·공간), 기기 상태·제어 횟수 → 기기 명령 이력, 측정값 범위 → 공간 */
export function evidenceLink(exp: Expectation | undefined): string | null {
  if (!exp) return null;
  const target = exp.target ?? {};
  const enc = (v: unknown) => encodeURIComponent(String(v));
  if (exp.kind === "ALARM_COUNT") {
    if (target.ruleId !== undefined && target.ruleId !== null) return `/alarms?ruleId=${enc(target.ruleId)}`;
    if (target.spaceId !== undefined && target.spaceId !== null) return `/alarms?spaceId=${enc(target.spaceId)}`;
    return "/alarms";
  }
  if ((exp.kind === "DEVICE_STATE_REACHED" || exp.kind === "CONTROL_COUNT_MAX") && target.deviceId !== undefined && target.deviceId !== null) return `/devices/${enc(target.deviceId)}?tab=commands`;
  if (exp.kind === "METRIC_RANGE_RATIO" && target.spaceId !== undefined && target.spaceId !== null) return `/spaces/${enc(target.spaceId)}`;
  return null;
}

/** 근거의 알람 ID 목록(알람 수 실패 때 실제 알람, TC-SIM-057) */
export function evidenceAlarmIds(x: ReportExpectation): string[] {
  const ids = x.evidence?.alarmIds;
  return Array.isArray(ids) ? ids.map(String) : [];
}
