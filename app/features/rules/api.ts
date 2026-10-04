/**
 * 규칙 화면이 브라우저에서 부르는 API(BFF `/bff/api/core/**`, design/api/RUL-api.md). 화면 부품은 이 묶음을 받아 쓰고, 테스트는 가짜를 넣는다.
 * 저장·상태 변경은 라우트 action(서버)이 하고, 여기에는 화면을 떠나지 않는 시뮬레이션만 둔다.
 */
import { bffJson, type BffJsonResult } from "~/lib/bff-client";
import type { RulePayload, SimulationJob, SimulationResult } from "./model/types";

export interface RulesApi {
  /** API-RUL-06: 저장 전(`ruleId` 없음) 또는 저장된 규칙. 데이터가 많으면 202 `{jobId}` */
  simulate(body: { rule: RulePayload; from: string; to: string }, ruleId?: string): Promise<BffJsonResult<SimulationResult | { jobId: string }>>;
  simulationJob(jobId: string): Promise<BffJsonResult<SimulationJob>>;
}

const base = "/bff/api/core";

export const rulesApi: RulesApi = {
  simulate: (body, ruleId) => bffJson(ruleId ? `${base}/rules/${encodeURIComponent(ruleId)}/simulate` : `${base}/rules/simulate`, { method: "POST", body }),
  simulationJob: (jobId) => bffJson(`${base}/rule-simulations/${encodeURIComponent(jobId)}`),
};

export function isJob(data: SimulationResult | { jobId: string } | undefined): data is { jobId: string } {
  return Boolean(data && typeof (data as { jobId?: unknown }).jobId === "string");
}
