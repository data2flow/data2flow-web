/**
 * 스크립트 사용처(SCR-04.04, UI-SCR-08): 영향 범위 합계(기기 수·24시간 처리량)와 삭제 가능 여부.
 * 사용 중(연결 대상이나 플로우 노드 참조가 있음)이면 삭제할 수 없다(SCRIPT_IN_USE, AT-SCR-09.2).
 */
import type { ScriptUsage } from "../api";

export function usageImpact(usage: ScriptUsage | null | undefined): { bindings: number; deviceCount: number; processed24h: number; flowNodes: number } {
  const bindings = usage?.bindings ?? [];
  return {
    bindings: bindings.length,
    deviceCount: bindings.reduce((n, b) => n + (b.deviceCount ?? 0), 0),
    processed24h: bindings.reduce((n, b) => n + (b.processed24h ?? 0), 0),
    flowNodes: usage?.flowNodes?.length ?? 0,
  };
}

export function inUse(usage: ScriptUsage | null | undefined): boolean {
  const impact = usageImpact(usage);
  return impact.bindings > 0 || impact.flowNodes > 0;
}
