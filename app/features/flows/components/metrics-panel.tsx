/**
 * 하단 [지표] 탭(UI-FLW-10, FLW-05.05, API-FLW-14): 기간 1시간·24시간·7일, 카드(실행·오류·오류율·평균·p95·제어·알림·Sink·버린 트리거),
 * 노드별 표, 시간대별 막대. 엔진 지표를 받을 수 없으면 core가 503 FLOW_METRICS_UNAVAILABLE을 주고 화면은 "지표 없음"(ADR-047).
 */
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, SelectField, Table } from "~/components/ui";
import { errorText } from "~/lib/error-text";
import { formatNumber } from "~/lib/format";
import type { FlowApi } from "../api";
import type { FlowMetrics } from "../model/types";

export type MetricsWindow = "1h" | "24h" | "7d";

export function MetricsPanel({ flowId, api, initial, nameOf }: { flowId: string; api: Pick<FlowApi, "metrics">; initial?: FlowMetrics | null; nameOf: (id: string) => string }) {
  const { t, i18n } = useTranslation();
  const [range, setRange] = useState<MetricsWindow>("1h");
  const [metrics, setMetrics] = useState<FlowMetrics | null>(initial ?? null);
  const [state, setState] = useState<"ready" | "loading" | "unavailable" | "error">(initial ? "ready" : "loading");
  const [error, setError] = useState<string | undefined>();
  // 처음 1시간 지표는 loader가 이미 불러왔다
  const skipFirst = useRef(Boolean(initial));
  useEffect(() => {
    if (skipFirst.current) {
      skipFirst.current = false;
      return;
    }
    let cancelled = false;
    setState("loading");
    void api.metrics(flowId, range).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setMetrics(result.data);
        setState("ready");
      } else if (result.status === 503 || result.code === "FLOW_METRICS_UNAVAILABLE") {
        setMetrics(null);
        setState("unavailable");
      } else {
        setError(errorText(t, result));
        setState("error");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [api, flowId, range, initial, t]);

  const n = (v: number | undefined | null) => formatNumber(v ?? 0, i18n.language);
  const summary = metrics?.summary;
  const series = metrics?.series ?? [];
  const peak = Math.max(1, ...series.map((p) => p.executions));
  return (
    <section aria-label={t("flows.metrics.title")} className="flex flex-col gap-2 text-[12.5px]">
      <div className="flex items-end gap-2">
        <SelectField label={t("flows.metrics.window")} value={range} onChange={(e) => setRange(e.target.value as MetricsWindow)}>
          {(["1h", "24h", "7d"] as const).map((w) => (
            <option key={w} value={w}>
              {t(`flows.metrics.windows.${w}`)}
            </option>
          ))}
        </SelectField>
      </div>
      {state === "loading" && <p className="text-muted">{t("common.processing")}</p>}
      {state === "unavailable" && <p className="text-muted">{t("flows.metrics.unavailable")}</p>}
      {state === "error" && <Alert tone="danger">{error}</Alert>}
      {state === "ready" && summary && (
        <>
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ["executions", n(summary.executions)],
              ["errors", t("flows.metrics.errorsValue", { n: n(summary.errors), rate: ((summary.errorRate ?? 0) * 100).toFixed(1) })],
              ["latency", t("flows.metrics.latencyValue", { avg: (summary.avgMs ?? 0).toFixed(1), p95: (summary.p95Ms ?? 0).toFixed(1) })],
              ["actions", t("flows.metrics.actionsValue", { command: n(summary.actions?.command), notify: n(summary.actions?.notify), sink: n(summary.actions?.sink) })],
              ["dropped", n(summary.droppedTriggers)],
            ].map(([key, value]) => (
              <div key={key} className="rounded-md border border-line p-2">
                <dt className="text-[11.5px] text-muted">{t(`flows.metrics.card.${key}`)}</dt>
                <dd className="font-semibold">{value}</dd>
              </div>
            ))}
          </dl>
          {series.length > 0 && (
            <div aria-label={t("flows.metrics.series")} role="img" className="flex h-16 items-end gap-px">
              {series.map((p) => (
                <span key={p.t} title={`${p.t} · ${p.executions}`} className={p.errors > 0 ? "flex-1 bg-warn" : "flex-1 bg-accent"} style={{ height: `${Math.max(2, Math.round((p.executions / peak) * 100))}%` }} />
              ))}
            </div>
          )}
          {(metrics?.nodes ?? []).length > 0 && (
            <Table>
              <thead>
                <tr>
                  <th>{t("flows.errors.node")}</th>
                  <th>{t("flows.errors.processed")}</th>
                  <th>{t("flows.errors.count")}</th>
                  <th>{t("flows.metrics.avgMs")}</th>
                </tr>
              </thead>
              <tbody>
                {metrics!.nodes.map((node) => (
                  <tr key={node.nodeId}>
                    <td>{nameOf(node.nodeId)}</td>
                    <td>{n(node.processed)}</td>
                    <td className={node.errors > 0 ? "text-bad" : undefined}>{n(node.errors)}</td>
                    <td>{(node.avgMs ?? 0).toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </>
      )}
    </section>
  );
}
