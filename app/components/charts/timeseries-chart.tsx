/**
 * 공통 시계열 차트(UI-TSD-07). 옵션은 lib/chart-model이 만들고, 이 부품은 ECharts로 그리기·상태 표시·표로 보기만 맡는다.
 * 상태: 로딩(이전 차트 흐리게 유지), 데이터 없음, 일부 계열 오류(범례에 경고 표시)
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { buildChartOption, hasData, roundTo, toTable, tooltipTime, type ChartAnnotation, type ChartSeries } from "~/lib/chart-model";
import { formatDateTime } from "~/lib/format";
import { isDarkNow } from "~/lib/theme";
import { Button, Table, cx } from "../ui";

export interface ChartHandle {
  setOption: (option: Record<string, unknown>, notMerge?: boolean) => void;
  resize: () => void;
  dispose: () => void;
}

export type ChartFactory = (element: HTMLDivElement, dark: boolean) => Promise<ChartHandle>;

const defaultFactory: ChartFactory = async (element, dark) => {
  const { echarts } = await import("~/lib/echarts.client");
  return echarts.init(element, dark ? "dark" : undefined, { renderer: "canvas" }) as unknown as ChartHandle;
};


export interface TimeseriesChartProps {
  series: ChartSeries[];
  timezone: string;
  annotations?: ChartAnnotation[];
  target?: { min?: number | null; max?: number | null } | null;
  loading?: boolean;
  height?: number;
  /** 테스트에서 가짜 차트를 넣는다 */
  factory?: ChartFactory;
  title?: string;
}

export function TimeseriesChart({ series, timezone, annotations, target, loading, height = 280, factory = defaultFactory, title }: TimeseriesChartProps) {
  const { t, i18n } = useTranslation();
  const element = useRef<HTMLDivElement>(null);
  const chart = useRef<ChartHandle | null>(null);
  const [ready, setReady] = useState(false);
  const [showTable, setShowTable] = useState(false);
  const dark = isDarkNow();
  const option = useMemo(
    () =>
      buildChartOption(series, {
        timezone,
        lang: i18n.language,
        annotations,
        target,
        dark,
        labels: { outOfRange: t("chart.quality.1"), suspect: t("chart.quality.3"), virtual: t("chart.virtual"), noData: t("chart.noData"), gap: t("chart.gap") },
      }),
    [series, timezone, annotations, target, dark, t, i18n.language],
  );

  useEffect(() => {
    let disposed = false;
    const node = element.current;
    if (!node) return;
    factory(node, dark)
      .then((handle) => {
        if (disposed) return handle.dispose();
        chart.current = handle;
        setReady(true);
      })
      .catch(() => setReady(false));
    const onResize = () => chart.current?.resize();
    window.addEventListener("resize", onResize);
    return () => {
      disposed = true;
      window.removeEventListener("resize", onResize);
      chart.current?.dispose();
      chart.current = null;
    };
  }, [factory, dark]);

  useEffect(() => {
    if (!ready || !chart.current) return;
    const time = tooltipTime(timezone, i18n.language);
    chart.current.setOption({ ...option, tooltip: { trigger: "axis", valueFormatter: (v: unknown) => (typeof v === "number" ? roundTo(v, series[0]?.precision) : "–"), axisPointer: { label: { formatter: (p: { value: number }) => time(p.value) } } } }, true);
  }, [ready, option, timezone, i18n.language, series]);

  const empty = !loading && !hasData(series);
  const failed = series.filter((s) => s.error);
  return (
    <figure className="m-0" aria-label={title ?? t("chart.label")}>
      {failed.length > 0 && (
        <p role="status" className="mb-1 text-[12px] text-warn">
          {t("chart.partialError", { names: failed.map((s) => s.label).join(", ") })}
        </p>
      )}
      <div className="relative">
        <div ref={element} data-testid="timeseries-chart" style={{ height }} className={cx("w-full", loading && "opacity-40")} aria-hidden={empty} />
        {empty && <p className="absolute inset-0 flex items-center justify-center text-[13px] text-muted">{t("chart.noData")}</p>}
        {loading && (
          <p role="status" className="absolute right-2 top-2 text-[12px] text-muted">
            {t("chart.loading")}
          </p>
        )}
      </div>
      <div className="mt-1 flex justify-end">
        <Button variant="ghost" onClick={() => setShowTable((v) => !v)} aria-expanded={showTable}>
          {showTable ? t("chart.hideTable") : t("chart.showTable")}
        </Button>
      </div>
      {showTable && <ChartTable series={series} timezone={timezone} lang={i18n.language} />}
    </figure>
  );
}

function ChartTable({ series, timezone, lang }: { series: ChartSeries[]; timezone: string; lang: string }) {
  const { t } = useTranslation();
  const rows = toTable(series).slice(-100);
  return (
    <Table>
      <caption className="sr-only">{t("chart.tableCaption")}</caption>
      <thead>
        <tr>
          <th scope="col">{t("chart.time")}</th>
          {series.map((s) => (
            <th scope="col" key={s.key}>
              {s.label}
              {s.unit ? ` (${s.unit})` : ""}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.time}>
            <td className="font-mono">{formatDateTime(row.time, timezone, lang, true)}</td>
            {row.values.map((v, i) => (
              <td key={series[i].key} className="font-mono">
                {roundTo(v, series[i].precision)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
