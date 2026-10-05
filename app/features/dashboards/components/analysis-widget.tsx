/**
 * 분석 결과 위젯(DSH-04.04, ANA-05.06, API-DSH-09 `analysis` → {analysisId, deleted, analysisName, runId, finishedAt, chart?, metrics?, caveats?}).
 * 늘 그 분석의 최근 성공 결과를 보여 준다(BR-ANA-15). 분석이 지워졌으면 "삭제된 분석", 아직 성공 결과가 없으면 안내.
 * 차트는 결과 화면과 같은 ChartSpec 렌더러, 아래에 결과 시각과 결과 화면 링크. 주의 문구(참고용 등)는 그대로 둔다(TC-DSH-041).
 */
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import type { ChartFactory } from "~/components/charts/timeseries-chart";
import { Badge } from "~/components/ui";
import { ChartSpecView } from "~/features/analytics/components/chart-spec-view";
import { metricText } from "~/features/analytics/model/result";
import type { ChartSpec, Metric } from "~/features/analytics/model/types";
import { formatDateTime } from "~/lib/format";

export interface AnalysisWidgetData {
  analysisId: string | null;
  deleted?: boolean;
  analysisName?: string;
  templateKey?: string;
  runId: string | null;
  finishedAt?: string | null;
  chart?: ChartSpec | null;
  metrics?: Metric[] | null;
  caveats?: string[] | null;
  expiresAt?: string | null;
}

export function AnalysisWidget({ data, timezone, height, chartFactory }: { data: AnalysisWidgetData | null; timezone: string; height: number; chartFactory?: ChartFactory }) {
  const { t, i18n } = useTranslation();
  if (!data) return null;
  if (data.deleted) return <p className="text-[13px] text-muted">{t("dashboards.analysis.deleted")}</p>;
  if (!data.runId) return <p className="text-[13px] text-muted">{t("dashboards.analysis.noResult")}</p>;
  const metrics = data.metrics ?? [];
  const chartHeight = Math.max(120, height - (metrics.length ? 96 : 40));
  return (
    <div className="flex h-full flex-col gap-2">
      {(data.caveats ?? []).length > 0 && (
        <p className="flex flex-wrap items-center gap-1 text-[11.5px] text-fair-ink">
          <Badge tone="warning">{t("dashboards.analysis.reference")}</Badge>
          {data.caveats![0]}
        </p>
      )}
      {metrics.length > 0 && (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
          {metrics.map((m) => {
            const { value, range } = metricText(m, i18n.language);
            return (
              <div key={m.key} className="rounded border border-line p-2">
                <p className="text-[11.5px] text-muted">{m.label ?? m.key}</p>
                <p className="text-[16px] font-bold tabular-nums">{value}</p>
                {range && <p className="text-[11px] text-muted">{range}</p>}
              </div>
            );
          })}
        </div>
      )}
      {data.chart && <ChartSpecView spec={data.chart} timezone={timezone} height={chartHeight} factory={chartFactory} />}
      <p className="mt-auto flex justify-between text-[11.5px] text-muted">
        <span>{t("dashboards.analysis.resultAt", { at: formatDateTime(data.finishedAt, timezone, i18n.language) })}</span>
        {data.analysisId && (
          <Link to={`/analytics/${encodeURIComponent(data.analysisId)}/runs/${encodeURIComponent(data.runId)}`} className="text-accent hover:underline">
            {t("dashboards.analysis.open")}
          </Link>
        )}
      </p>
    </div>
  );
}
