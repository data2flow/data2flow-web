/**
 * ChartSpec 공통 렌더러(ANA-05.02). 선·띠·산점도·막대·히트맵·게이지는 ECharts, 달력·타임라인·표는 HTML로 그린다.
 * 결과 화면(UI-ANA-05)과 대시보드 분석 위젯(DSH-04.04)이 함께 쓴다. 색은 팔레트·토큰만 쓴다.
 */
import { useCallback, useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { EChartView } from "~/components/charts/echart-view";
import type { ChartFactory } from "~/components/charts/timeseries-chart";
import { Table } from "~/components/ui";
import { formatDateTime, formatNumber } from "~/lib/format";
import { isDarkNow } from "~/lib/theme";
import { calendarColor, chartOption, chartTable } from "../model/chartspec";
import type { ChartSpec, TableSpec } from "../model/types";

export function cellText(value: unknown, type: string | undefined, timezone: string, lang: string): string {
  if (value === null || value === undefined || value === "") return "–";
  if (type === "datetime" && typeof value === "string") return formatDateTime(value, timezone, lang);
  if (typeof value === "number") return formatNumber(value, lang);
  if (typeof value === "boolean") return value ? "✔" : "–";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function SpecTable({ table, timezone, lang, highlight, rowAction, actionLabel }: { table: TableSpec; timezone: string; lang: string; highlight?: boolean; rowAction?: (row: Record<string, unknown>) => ReactNode; actionLabel?: string }) {
  return (
    <div id={`result-table-${table.id}`} className={highlight ? "rounded-md ring-2 ring-accent" : undefined}>
      <Table>
        <thead>
          <tr>
            {table.columns.map((c) => (
              <th key={c.key}>{c.unit ? `${c.label ?? c.key} (${c.unit})` : (c.label ?? c.key)}</th>
            ))}
            {rowAction && <th>{actionLabel}</th>}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, i) => (
            <tr key={i}>
              {table.columns.map((c) => (
                <td key={c.key} className={c.type === "number" ? "text-right tabular-nums" : undefined}>
                  {cellText(row[c.key], c.type, timezone, lang)}
                </td>
              ))}
              {rowAction && <td>{rowAction(row)}</td>}
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}

function CalendarGrid({ spec, lang }: { spec: ChartSpec; lang: string }) {
  const days = spec.calendar?.days ?? [];
  const values = days.map((d) => d[1]).filter((v): v is number => typeof v === "number");
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 1;
  const dark = isDarkNow();
  const clusters = new Map<string, number>();
  for (const d of days) if (d[2] !== undefined && d[2] !== null) clusters.set(String(d[2]), (clusters.get(String(d[2])) ?? 0) + 1);
  return (
    <div>
      <div className="grid grid-cols-7 gap-1" role="grid" aria-label={spec.title}>
        {days.map(([date, value, cluster]) => {
          const { color, opacity } = calendarColor(value, cluster, min, max, dark);
          return (
            <div key={date} role="gridcell" title={`${date} · ${value === null ? "–" : formatNumber(value, lang)}${cluster !== undefined ? ` · #${cluster}` : ""}`} className="flex h-8 items-end rounded border border-line p-0.5 text-[10px] text-muted" style={{ background: color, opacity }}>
              {date.slice(5)}
            </div>
          );
        })}
      </div>
      {clusters.size > 0 && (
        <ul className="mt-2 flex flex-wrap gap-3 text-[12px] text-muted" aria-label="legend">
          {[...clusters.entries()].map(([id, n]) => (
            <li key={id} className="inline-flex items-center gap-1">
              <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: calendarColor(null, id, 0, 1, dark).color }} />
              {`#${id} (${n})`}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TimelineBars({ spec, timezone, lang }: { spec: ChartSpec; timezone: string; lang: string }) {
  const items = spec.timeline?.items ?? [];
  const times = items.flatMap((it) => [Date.parse(it.from), Date.parse(it.to)]).filter(Number.isFinite);
  const start = times.length ? Math.min(...times) : 0;
  const end = times.length ? Math.max(...times) : 1;
  const span = Math.max(1, end - start);
  return (
    <div className="relative h-8 w-full rounded border border-line bg-bg" aria-label={spec.title}>
      {items.map((it, i) => {
        const left = ((Date.parse(it.from) - start) / span) * 100;
        const width = Math.max(0.5, ((Date.parse(it.to) - Date.parse(it.from)) / span) * 100);
        const busy = (it.state ?? "").toUpperCase() !== "EMPTY" && (it.state ?? "").toUpperCase() !== "VACANT";
        return (
          <span
            key={i}
            title={`${it.label ?? it.state ?? ""} ${formatDateTime(it.from, timezone, lang)} – ${formatDateTime(it.to, timezone, lang)}`}
            className={busy ? "absolute top-1 bottom-1 rounded-sm bg-accent" : "absolute top-1 bottom-1 rounded-sm bg-line"}
            style={{ left: `${left}%`, width: `${width}%` }}
          />
        );
      })}
    </div>
  );
}

export interface ChartSpecViewProps {
  spec: ChartSpec;
  timezone: string;
  height?: number;
  factory?: ChartFactory;
  /** 데이터 표로 보기 */
  asTable?: boolean;
}

export function ChartSpecView({ spec, timezone, height = 260, factory, asTable }: ChartSpecViewProps) {
  const { t, i18n } = useTranslation();
  const option = useCallback((dark: boolean) => chartOption(spec, dark) ?? {}, [spec]);
  const table = useMemo(() => chartTable(spec), [spec]);
  const label = spec.title ?? t("analytics.result.chart");
  if (asTable || spec.type === "table") {
    if (spec.type === "table" && spec.table) return <SpecTable table={spec.table} timezone={timezone} lang={i18n.language} />;
    return (
      <Table>
        <caption className="sr-only">{label}</caption>
        <thead>
          <tr>
            {table.columns.map((c, i) => (
              <th key={i}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, i) => (
            <tr key={i}>
              {row.map((v, j) => (
                <td key={j}>{typeof v === "number" ? formatNumber(v, i18n.language) : (v ?? "–")}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </Table>
    );
  }
  if (spec.type === "calendar") return <CalendarGrid spec={spec} lang={i18n.language} />;
  if (spec.type === "timeline") return <TimelineBars spec={spec} timezone={timezone} lang={i18n.language} />;
  if (!chartOption(spec)) return <p className="text-[13px] text-muted">{t("analytics.result.unsupportedChart", { type: spec.type })}</p>;
  return <EChartView option={option} height={height} factory={factory} label={label} />;
}
