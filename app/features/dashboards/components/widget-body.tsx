/**
 * 위젯 종류별 본문(UI-DSH-05 위젯 목록). 상태는 색만 쓰지 않고 아이콘·글자를 함께 쓴다(DSH-11.04, BR-DSH-15).
 * 텍스트(markdown) 위젯은 HTML을 해석하지 않고 글자 그대로 보여 준다(스크립트·HTML 제거).
 */
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { EChartView } from "~/components/charts/echart-view";
import { TimeseriesChart, type ChartFactory } from "~/components/charts/timeseries-chart";
import { Badge } from "~/components/ui";
import { fromWidgetAnnotations } from "~/lib/chart-model";
import { formatDateTime, formatNumber } from "~/lib/format";
import { statusIcon, type StatusTone } from "~/lib/palette";
import { barOption, gaugeOption, heatmapOption, thresholdTone, toChartSeries, trendOf, type TableView } from "../model/data";
import type { AlarmItem, FloorplanPayload, GaugePayload, HeatmapPayload, SeriesPayload, StatPayload, StatusItem, TablePayload, Widget, WidgetData } from "../model/types";
import type { ZoomWindow } from "../model/time";
import { DataTable } from "./data-table";

/** 게이트웨이 경로(`/api/v1/...`)로 온 이미지 주소를 BFF 경로로 */
export function toBffUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith("/api/v1/core/public/branding/assets/")) return `/branding/assets/${url.split("/").pop()}`;
  if (url.startsWith("/api/v1/")) return `/bff/api/${url.slice("/api/v1/".length)}`;
  return url;
}

export function connectionTone(connection: string | null | undefined): StatusTone {
  if (connection === "ONLINE") return "good";
  if (connection === "OFFLINE") return "bad";
  return "muted";
}

export function severityTone(severity: string): StatusTone {
  if (severity === "CRITICAL" || severity === "MAJOR") return "bad";
  if (severity === "MINOR" || severity === "WARNING") return "warn";
  return "muted";
}

export const badgeTone = (tone: StatusTone) => ({ good: "success", warn: "warning", bad: "danger", muted: "neutral" } as const)[tone];

export interface WidgetBodyProps {
  widget: Widget;
  data: WidgetData;
  timezone: string;
  height: number;
  zoom?: ZoomWindow | null;
  onZoom?: (window: ZoomWindow) => void;
  tableOpen: boolean;
  table: TableView;
  chartFactory?: ChartFactory;
  loading?: boolean;
}

export function WidgetBody({ widget, data, timezone, height, zoom, onZoom, tableOpen, table, chartFactory, loading }: WidgetBodyProps) {
  const { t, i18n } = useTranslation();
  const title = widget.title || t(`dashboards.types.${widget.type}`, { defaultValue: widget.type });
  const payload = data.data;
  const options = useMemo(() => widget.options ?? {}, [widget.options]);
  const tableBlock = tableOpen && <DataTable view={table} caption={t("dashboards.table.caption", { title })} summary={t("dashboards.table.summary", { title, rows: table.rows.length })} />;
  const bar = useCallback((dark: boolean) => barOption(payload as SeriesPayload, options, dark), [payload, options]);
  const gauge = useCallback((dark: boolean) => gaugeOption(payload as GaugePayload, dark), [payload]);
  const heat = useCallback((dark: boolean) => heatmapOption(payload as HeatmapPayload, dark), [payload]);
  const series = useMemo(() => (widget.type === "line" || widget.type === "area" ? toChartSeries(payload as SeriesPayload) : []), [widget.type, payload]);
  const annotations = useMemo(() => fromWidgetAnnotations((payload as SeriesPayload | null)?.annotations), [payload]);

  switch (widget.type) {
    case "line":
    case "area":
      return (
        <TimeseriesChart series={series} annotations={annotations} timezone={timezone} height={height} factory={chartFactory} title={title} zoom={zoom} onZoom={onZoom} hideTableToggle tableOpen={tableOpen} loading={loading} />
      );
    case "bar":
    case "gauge":
    case "heatmap":
      return (
        <>
          <EChartView option={widget.type === "bar" ? bar : widget.type === "gauge" ? gauge : heat} height={height} factory={chartFactory} label={t("dashboards.table.summary", { title, rows: table.rows.length })} loading={loading} />
          {tableBlock}
        </>
      );
    case "stat": {
      const s = (payload ?? {}) as StatPayload;
      const tone = thresholdTone(s.value, options.thresholds);
      const trend = trendOf(s);
      const decimals = typeof options.decimals === "number" ? options.decimals : null;
      return (
        <div className="flex h-full flex-col justify-center">
          <p className="font-mono text-[28px] font-semibold" data-testid="stat-value">
            {formatNumber(s.value, i18n.language, { precision: decimals, unit: (options.unit as string) || s.unit })}
            {trend && (
              <span className="ml-2 text-[16px]" aria-label={t(`dashboards.trend.${trend}`)}>
                {trend === "up" ? "▲" : trend === "down" ? "▼" : "＝"}
              </span>
            )}
          </p>
          {tone && (
            <Badge tone={badgeTone(tone)}>
              {statusIcon(tone)} {t(`dashboards.tone.${tone}`)}
            </Badge>
          )}
          {s.at && <p className="text-[12px] text-muted">{formatDateTime(s.at, timezone, i18n.language)}</p>}
          {tableBlock}
        </div>
      );
    }
    case "table": {
      const tb = (payload ?? { columns: [], rows: [] }) as TablePayload;
      return <DataTable view={{ columns: tb.columns ?? [], rows: (tb.rows ?? []).map((r) => r.map((v) => (v === undefined ? null : (v as string | number | null)))) }} caption={title} summary={t("dashboards.table.summary", { title, rows: (tb.rows ?? []).length })} />;
    }
    case "status-list": {
      const items = ((payload as { items?: StatusItem[] })?.items ?? []) as StatusItem[];
      return (
        <ul className="divide-y divide-line text-[13px]">
          {items.map((item) => {
            const tone = connectionTone(item.connection);
            return (
              <li key={item.deviceId} className="flex items-center justify-between gap-2 py-1.5">
                <span>{item.name}</span>
                <span className="flex items-center gap-2">
                  {typeof item.battery === "number" && <span className="font-mono text-muted">🔋{Math.round(item.battery)}%</span>}
                  {(item.alarms ?? 0) > 0 && <Badge tone="danger">▲ {item.alarms}</Badge>}
                  <Badge tone={badgeTone(tone)}>
                    {statusIcon(tone)} {t(`dashboards.connection.${item.connection ?? "UNKNOWN"}`, { defaultValue: item.connection ?? "" })}
                  </Badge>
                </span>
              </li>
            );
          })}
          {items.length === 0 && <li className="py-2 text-muted">{t("dashboards.widget.noData")}</li>}
          {tableBlock}
        </ul>
      );
    }
    case "alarm-list": {
      const items = ((payload as { items?: AlarmItem[] })?.items ?? []) as AlarmItem[];
      return (
        <ul className="divide-y divide-line text-[13px]">
          {items.map((a) => {
            const tone = severityTone(a.severity);
            return (
              <li key={a.alarmId} className="flex items-center gap-2 py-1.5">
                <Badge tone={badgeTone(tone)}>
                  {statusIcon(tone)} {t(`dashboards.severity.${a.severity}`, { defaultValue: a.severity })}
                </Badge>
                <a href={`/alarms/${encodeURIComponent(a.alarmId)}`} className="flex-1 hover:underline">
                  {a.title}
                </a>
                <span className="text-[12px] text-muted">{formatDateTime(a.at, timezone, i18n.language)}</span>
              </li>
            );
          })}
          {items.length === 0 && <li className="py-2 text-muted">{t("dashboards.widget.noAlarms")}</li>}
          {tableBlock}
        </ul>
      );
    }
    case "floorplan": {
      const f = (payload ?? { markers: [] }) as FloorplanPayload;
      const src = toBffUrl(f.imageUrl);
      return (
        <div>
          <div className="relative w-full overflow-hidden rounded-md border border-line bg-bg" style={{ aspectRatio: f.width && f.height ? `${f.width} / ${f.height}` : "4 / 3" }}>
            {src && <img src={src} alt={t("dashboards.types.floorplan")} className="absolute inset-0 h-full w-full object-contain" />}
            {(f.markers ?? []).map((m) => {
              const tone: StatusTone = m.state === "ALARM" ? "bad" : m.state === "OFFLINE" ? "muted" : "good";
              return (
                <span
                  key={m.deviceId}
                  className="absolute -translate-x-1/2 -translate-y-1/2 rounded border border-line bg-panel px-1 font-mono text-[11px]"
                  style={{ left: `${m.x <= 1 ? m.x * 100 : m.x}%`, top: `${m.y <= 1 ? m.y * 100 : m.y}%` }}
                >
                  {statusIcon(tone)} {formatNumber(m.value ?? null, i18n.language, { unit: m.unit })}
                </span>
              );
            })}
          </div>
          {tableBlock}
        </div>
      );
    }
    case "markdown":
      return <div className="whitespace-pre-wrap text-[13px]">{String(options.content ?? "")}</div>;
    default:
      return <p className="text-[13px] text-muted">{t("dashboards.widget.unsupported", { type: widget.type })}</p>;
  }
}
