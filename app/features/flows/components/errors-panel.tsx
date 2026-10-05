/**
 * 오류 탭(FLW-05.03 오류 격리, API-FLW-14): 최근 1시간 실행·오류 수·오류율, 노드별 오류. 오류는 그 실행만 끝내고 다른 플로우와
 * 같은 기기의 다음 메시지는 막지 않는다는 안내. 실시간 디버그 스트림(API-FLW-40)은 M4.
 */
import { useTranslation } from "react-i18next";
import { Table } from "~/components/ui";
import type { FlowMetrics } from "../model/types";

export function ErrorsPanel({ metrics, nameOf }: { metrics: FlowMetrics | null; nameOf: (id: string) => string }) {
  const { t } = useTranslation();
  // 엔진 지표를 아직 받을 수 없으면(503 SERVICE_UNAVAILABLE 등) 오류가 아니라 "지표 없음"으로 보여 준다
  if (!metrics?.summary) return <p className="text-[12.5px] text-muted">{t("flows.errors.unavailable")}</p>;
  const failing = (metrics.nodes ?? []).filter((n) => n.errors > 0);
  return (
    <div className="flex flex-col gap-2 text-[12.5px]">
      <p>{t("flows.errors.summary", { executions: metrics.summary.executions, errors: metrics.summary.errors, rate: ((metrics.summary.errorRate ?? 0) * 100).toFixed(1) })}</p>
      <p className="text-muted">{t("flows.errors.isolation")}</p>
      {failing.length === 0 ? (
        <p>{t("flows.errors.none")}</p>
      ) : (
        <Table>
          <thead>
            <tr>
              <th>{t("flows.errors.node")}</th>
              <th>{t("flows.errors.processed")}</th>
              <th>{t("flows.errors.count")}</th>
            </tr>
          </thead>
          <tbody>
            {failing.map((n) => (
              <tr key={n.nodeId}>
                <td>
                  {nameOf(n.nodeId)} <span className="font-mono text-muted">{n.nodeId}</span>
                </td>
                <td className="font-mono">{n.processed}</td>
                <td className="font-mono text-bad-ink">{n.errors}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
