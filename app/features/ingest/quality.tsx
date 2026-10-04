/**
 * 데이터 품질 화면 본문(UI-ING-06, ING-06.02): 순위 표(점수 오름차순 — 점수·완전성·적시성·유효성·안정성·공백·시계 오차 의심),
 * 최하위 10개와 문제 유형 분포(core quality/summary), 선택 대상의 30일 점수 추이(core quality/trend). 기기 묶음에서 점수를 누르면
 * 기기 상세의 문제 구간 차트로 간다(TC-ING-072).
 */
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { TimeseriesChart, type ChartFactory } from "~/components/charts/timeseries-chart";
import { Alert, Badge, Button, Card, EmptyState, Table } from "~/components/ui";
import { errorText } from "~/lib/error-text";
import type { QualityApi } from "./m5-api";
import { distributionRows, qualityLink, scoreTone, sortByScore, trendSeries, type QualityGroup, type QualityItem, type QualitySummary, type QualityTrendPoint } from "./model/m5";

const toneClass = { bad: "text-bad", warn: "text-warn", good: "text-good" } as const;

export function QualityView({
  items,
  summary,
  group,
  day,
  failed,
  timezone,
  api,
  chartFactory,
}: {
  items: QualityItem[];
  summary: QualitySummary | null;
  group: QualityGroup;
  day: string;
  failed: boolean;
  timezone: string;
  api: QualityApi;
  chartFactory?: ChartFactory;
}) {
  const { t } = useTranslation();
  const rows = useMemo(() => sortByScore(items), [items]);
  const [selected, setSelected] = useState<QualityItem | null>(rows[0] ?? null);
  const [trend, setTrend] = useState<QualityTrendPoint[] | null>(null);
  const [trendError, setTrendError] = useState<string | null>(null);

  useEffect(() => {
    if (!selected) return;
    const end = Date.parse(`${day}T00:00:00Z`);
    const from = new Date(end - 29 * 86_400_000).toISOString().slice(0, 10);
    let live = true;
    setTrend(null);
    void api.trend({ groupBy: group, targetId: selected.targetId, from, to: day }).then((r) => {
      if (!live) return;
      if (r.ok) {
        setTrend(r.data.points ?? []);
        setTrendError(null);
      } else setTrendError(errorText(t, r) ?? "");
    });
    return () => {
      live = false;
    };
  }, [api, group, selected, day, t]);

  if (failed) return <Alert tone="danger">{t("ingest.quality.loadFailed")}</Alert>;
  if (rows.length === 0) return <EmptyState title={t("ingest.quality.empty")} />;

  const distribution = distributionRows(summary?.distribution ?? null);
  return (
    <div className="flex flex-col gap-4">
      {summary && (
        <p className="text-[13px] text-muted">
          {t("ingest.quality.summary", { n: summary.devices ?? rows.length, avg: summary.averageScore ?? "–" })}
        </p>
      )}
      <Card title={t("ingest.quality.ranking")}>
        <Table>
          <thead>
            <tr>
              <th>{t(`ingest.quality.groups.${group}`)}</th>
              <th>{t("ingest.quality.score")}</th>
              <th>{t("ingest.quality.completeness")}</th>
              <th>{t("ingest.quality.timeliness")}</th>
              <th>{t("ingest.quality.validity")}</th>
              <th>{t("ingest.quality.stability")}</th>
              <th>{t("ingest.quality.gaps")}</th>
              <th>{t("ingest.quality.clockSkew")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((item) => {
              const link = qualityLink(group, item);
              const tone = scoreTone(item.score);
              return (
                <tr key={item.targetId} aria-selected={selected?.targetId === item.targetId}>
                  <td>{item.targetName ?? item.targetId}</td>
                  <td className={`font-mono font-semibold ${toneClass[tone]}`}>
                    {link ? (
                      <Link to={link} className="underline" aria-label={t("ingest.quality.openChart", { name: item.targetName ?? item.targetId, score: item.score })}>
                        {item.score}
                      </Link>
                    ) : (
                      item.score
                    )}
                  </td>
                  <td className="font-mono">{item.completeness}</td>
                  <td className="font-mono">{item.timeliness}</td>
                  <td className="font-mono">{item.validity}</td>
                  <td className="font-mono">{item.stability}</td>
                  <td className="font-mono">{item.gaps}</td>
                  <td>{item.clockSkewSuspect ? <Badge tone="warning">{`⏱ ${t("ingest.quality.suspect")}`}</Badge> : "–"}</td>
                  <td>
                    <Button onClick={() => setSelected(item)}>{t("ingest.quality.showTrend")}</Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={t("ingest.quality.trend", { name: selected?.targetName ?? selected?.targetId ?? "" })}>
          {trendError ? (
            <Alert tone="warning">{trendError}</Alert>
          ) : trend && trend.length === 0 ? (
            <p className="text-[12.5px] text-muted">{t("ingest.quality.noTrend")}</p>
          ) : (
            <TimeseriesChart series={trendSeries(trend ?? [], t("ingest.quality.score"))} timezone={timezone} loading={trend === null} height={220} factory={chartFactory} title={t("ingest.quality.trendTitle")} />
          )}
        </Card>
        <Card title={t("ingest.quality.distribution")}>
          {distribution.length === 0 ? (
            <p className="text-[12.5px] text-muted">{t("ingest.quality.noDistribution")}</p>
          ) : (
            <ul className="flex flex-col gap-2 text-[13px]">
              {distribution.map((row) => (
                <li key={row.key} className="flex items-center gap-2">
                  <span className="w-28">{t(`ingest.quality.issues.${row.key}`)}</span>
                  <span aria-hidden="true" className="h-3 rounded bg-accent" style={{ width: `${Math.max(2, Math.min(100, row.percent) * 2)}px` }} />
                  <span className="font-mono">{`${row.percent}% (${row.count})`}</span>
                </li>
              ))}
            </ul>
          )}
          {(summary?.bottom10 ?? []).length > 0 && (
            <>
              <h3 className="mt-3 text-[13px] font-semibold">{t("ingest.quality.bottom10")}</h3>
              <ol className="list-decimal pl-5 text-[13px]">
                {(summary?.bottom10 ?? []).map((item) => {
                  const link = qualityLink(group, item);
                  return (
                    <li key={item.targetId}>
                      {link ? (
                        <Link to={link} className="text-accent hover:underline">
                          {item.targetName ?? item.targetId}
                        </Link>
                      ) : (
                        (item.targetName ?? item.targetId)
                      )}{" "}
                      <span className={`font-mono ${toneClass[scoreTone(item.score)]}`}>{item.score}</span>
                    </li>
                  );
                })}
              </ol>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
