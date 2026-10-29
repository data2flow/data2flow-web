/**
 * 대시보드 위젯 `energy-kpi`·`energy-trend`(ENE-01.05, AT-ENE-03.1). 데이터는 API-ENE-10을 그대로 쓴다(별도 API 없음).
 * kpi: 사용량(비교 ±%)·비용·탄소·EUI, 추정이 섞였으면 "추정 포함 N%" 배지, 하위 공간 상위 N개를 누르면 그 공간의 에너지 대시보드로 내려간다.
 * trend: 일·월 추이(사용량이면 추정분 빗금과 기준선 선). 로딩·권한·오류 상태는 위젯 틀(dashboard-grid)이 그린다.
 */
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { EChartView } from "~/components/charts/echart-view";
import type { ChartFactory } from "~/components/charts/timeseries-chart";
import { Badge } from "~/components/ui";
import { formatNumber } from "~/lib/format";
import { diffText, diffTone } from "../model/dashboard";
import { percent } from "../model/settings";
import { MEASURE_UNIT, energyHref, energyTrendOption, kpiEmpty, type EnergyKpiPayload, type EnergyTrendPayload } from "../model/widgets";

export function EnergyKpiWidget({ data }: { data: EnergyKpiPayload | null }) {
  const { t, i18n } = useTranslation();
  const num = (v: number | null | undefined, precision = 0, unit?: string) => formatNumber(v, i18n.language, { precision, unit });
  if (!data || kpiEmpty(data)) return <p className="flex h-full items-center justify-center text-[13px] text-muted">{t("energy.dashboard.noData")}</p>;
  const totals = data.totals!;
  const diff = data.compare && !data.compare.reason ? (data.compare.diffRatio ?? null) : null;
  const estimated = totals.estimatedRatio ?? 0;
  return (
    <div className="flex h-full flex-col gap-2 overflow-auto text-[13px]" data-energy-kpi>
      <div className="flex flex-wrap items-baseline gap-2">
        <Link to={energyHref(data.scope?.spaceId)} className="text-[20px] font-semibold text-text hover:underline" data-metric="kwh">
          {num(totals.kwh, 0, "kWh")}
        </Link>
        {diffText(diff) && (
          <Badge tone={diffTone(diff)}>
            {t(`energy.dashboard.compares.${data.compare!.kind}`)} {diffText(diff)}
          </Badge>
        )}
        {estimated > 0 && <Badge tone="warning">{t("energy.widget.estimated", { ratio: percent(estimated) })}</Badge>}
      </div>
      <dl className="grid grid-cols-3 gap-2">
        {(
          [
            ["krw", num(totals.krw, 0, t("energy.dashboard.won"))],
            ["tco2", num(totals.tco2, 2, "tCO2eq")],
            ["eui", num(totals.euiKwhPerM2, 1, "kWh/㎡")],
          ] as const
        ).map(([key, value]) => (
          <div key={key} data-metric={key}>
            <dt className="text-[11.5px] text-muted">{t(`energy.dashboard.cards.${key}`)}</dt>
            <dd className="font-medium">{value}</dd>
          </div>
        ))}
      </dl>
      {data.children.length > 0 && (
        <ul className="flex flex-col gap-1" aria-label={t("energy.dashboard.children")}>
          {data.children.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-2">
              <Link to={energyHref(c.id)} className="truncate text-accent hover:underline">
                {c.name}
              </Link>
              <span className="whitespace-nowrap text-muted">
                {num(c.kwh, 0, "kWh")}
                {c.share != null && ` · ${percent(c.share)}`}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-auto text-[11.5px] text-muted">
        {data.scope?.name ?? t("energy.dashboard.portfolio")} · {data.from} ~ {data.to}
      </p>
    </div>
  );
}

export function EnergyTrendWidget({ data, height, chartFactory, loading }: { data: EnergyTrendPayload | null; height: number; chartFactory?: ChartFactory; loading?: boolean }) {
  const { t } = useTranslation();
  const option = useCallback(
    (dark: boolean) =>
      energyTrendOption(data!, { measured: t("energy.dashboard.measured"), estimated: t("energy.dashboard.estimated"), baseline: t("energy.dashboard.baseline"), unit: MEASURE_UNIT[data?.measure ?? "kwh"] }, dark),
    [data, t],
  );
  if (!data || data.series.length === 0) return <p className="flex h-full items-center justify-center text-[13px] text-muted">{t("energy.dashboard.noData")}</p>;
  return <EChartView option={option} height={height} factory={chartFactory} loading={loading} label={t("energy.widget.trendLabel", { name: data.scope?.name ?? t("energy.dashboard.portfolio"), from: data.from, to: data.to })} />;
}
