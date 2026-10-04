/**
 * 규칙 화면이 브라우저에서 부르는 API(BFF `/bff/api/core/**`, design/api/RUL-api.md). 화면 부품은 이 묶음을 받아 쓰고, 테스트는 가짜를 넣는다.
 * 저장·상태 변경은 라우트 action(서버)이 하고, 여기에는 화면을 떠나지 않는 시뮬레이션만 둔다.
 */
import { bffJson, type BffJsonResult } from "~/lib/bff-client";
import type { RulePayload, SimulationResult } from "./model/types";

export interface RulesApi {
  /** API-RUL-06: 저장 전(`ruleId` 없음) 또는 저장된 규칙. core는 동기로 결과(200)를 준다(작업 조회 API 없음) */
  simulate(body: { rule: RulePayload; from: string; to: string }, ruleId?: string): Promise<BffJsonResult<SimulationResult>>;
}

const base = "/bff/api/core";

export const rulesApi: RulesApi = {
  simulate: (body, ruleId) => bffJson(ruleId ? `${base}/rules/${encodeURIComponent(ruleId)}/simulate` : `${base}/rules/simulate`, { method: "POST", body }),
};

