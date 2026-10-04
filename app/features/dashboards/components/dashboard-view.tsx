/**
 * 대시보드 보기(UI-DSH-04 보기 구성): 상단 바(변수 선택기·시간 범위·집계·새로고침·확대 초기화)와 격자.
 * 로그인 화면·키오스크·공유 링크가 함께 쓴다. 위젯 데이터 요청 방법(fetcher)만 다르다.
 * - 실시간(LIVE): 기기 측정 항목 대상의 `point` 이벤트가 오면 그 위젯만 1초 묶음으로 다시 조회(NFR-01.09 "2초 이내")
 * - 확대 동기화(DSH-11.01): 한 차트에서 드래그로 고른 구간을 모든 시계열 위젯에 맞추고 [초기화]로 대시보드 범위로
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { ChartFactory } from "~/components/charts/timeseries-chart";
import { useLiveStream, type UseLiveStreamOptions } from "~/components/live";
import { Button, SelectField } from "~/components/ui";
import { liveUrl } from "~/lib/event-stream";
import { RANGE_PRESETS, RESOLUTIONS, REFRESHES, customRange, isRelative, type ZoomWindow } from "../model/time";
import { resolveValues, type VariableOption } from "../model/variables";
import { liveTopicsOf } from "../model/widgets";
import type { DashboardVariable, TimeRange, Widget, WidgetState } from "../model/types";
import { DashboardGrid } from "./dashboard-grid";
import { useDashboardData, type WidgetFetcher } from "./use-dashboard-data";

export interface DashboardViewProps {
  name: string;
  widgets: Widget[];
  variables: DashboardVariable[];
  timeRange: TimeRange;
  resolution: string;
  refresh: string;
  fetcher: WidgetFetcher;
  timezone: string;
  initialStates?: Record<string, WidgetState>;
  initialValues?: Record<string, string>;
  variableOptions?: Record<string, VariableOption[]>;
  /** 실시간 구독을 쓸 수 있는지(로그인 세션). 공유 링크는 LIVE를 30초 주기로 바꾼다 */
  live?: boolean;
  noExport?: boolean;
  actions?: ReactNode;
  onValuesChange?: (values: Record<string, string>) => void;
  chartFactory?: ChartFactory;
  streamOptions?: UseLiveStreamOptions;
  /** 키오스크처럼 상단 바를 숨긴다 */
  hideToolbar?: boolean;
  gridRef?: React.Ref<HTMLDivElement>;
}

export function DashboardView(props: DashboardViewProps) {
  const { t } = useTranslation();
  const { widgets, variables } = props;
  const [timeRange, setTimeRange] = useState<TimeRange>(props.timeRange);
  const [resolution, setResolution] = useState(props.resolution || "AUTO");
  const [refresh, setRefresh] = useState(props.live === false && props.refresh === "LIVE" ? "30s" : props.refresh || "OFF");
  const [selected, setSelected] = useState<Record<string, string>>(props.initialValues ?? {});
  const [zoom, setZoom] = useState<ZoomWindow | null>(null);
  const [custom, setCustom] = useState({ from: "", to: "" });
  const values = useMemo(() => resolveValues(variables, selected), [variables, selected]);
  const { states, reload } = useDashboardData({ widgets, timeRange, resolution, values, fetcher: props.fetcher, initial: props.initialStates, refresh });

  // 실시간: 토픽 → 위젯
  const topicMap = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const w of widgets) for (const topic of liveTopicsOf(w, values)) map.set(topic, [...(map.get(topic) ?? []), w.id]);
    return map;
  }, [widgets, values]);
  const url = props.live !== false && refresh === "LIVE" ? liveUrl([...topicMap.keys()]) : null;
  const pending = useRef(new Set<string>());
  const flush = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onPoint = useCallback(
    (event: { data: unknown }) => {
      const p = event.data as { deviceId?: string | number; metricKey?: string } | null;
      if (!p?.deviceId || !p.metricKey) return;
      for (const id of topicMap.get(`telemetry:${p.deviceId}.${p.metricKey}`) ?? []) pending.current.add(id);
      if (pending.current.size && !flush.current) {
        flush.current = setTimeout(() => {
          flush.current = null;
          const ids = [...pending.current];
          pending.current.clear();
          reload(ids);
        }, 1000);
      }
    },
    [topicMap, reload],
  );
  useEffect(
    () => () => {
      if (flush.current) clearTimeout(flush.current);
    },
    [],
  );
  useLiveStream(url, ["point"], onPoint, props.streamOptions ?? {});

  const changeVariable = (name: string, value: string) => {
    const next = { ...selected, [name]: value };
    setSelected(next);
    props.onValuesChange?.(resolveValues(variables, next));
  };
  const preset = isRelative(timeRange) ? timeRange.relative : "custom";

  return (
    <div>
      {!props.hideToolbar && (
        <div className="mb-3 flex flex-wrap items-end gap-3" role="toolbar" aria-label={t("dashboards.view.toolbar")}>
          {variables.map((v) => (
            <div key={v.name} className="w-44">
              <SelectField label={v.label || v.name} value={values[v.name] ?? ""} onChange={(e) => changeVariable(v.name, e.target.value)}>
                <option value="">{t("dashboards.view.choose")}</option>
                {(props.variableOptions?.[v.name] ?? []).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </SelectField>
            </div>
          ))}
          <div className="w-32">
            <SelectField
              label={t("dashboards.view.range")}
              value={preset}
              onChange={(e) => {
                setZoom(null);
                if (e.target.value !== "custom") setTimeRange({ relative: e.target.value });
                else setCustom({ from: "", to: "" });
              }}
            >
              {RANGE_PRESETS.map((r) => (
                <option key={r} value={r}>
                  {t(`dashboards.ranges.${r}`)}
                </option>
              ))}
              {!RANGE_PRESETS.includes(preset as (typeof RANGE_PRESETS)[number]) && preset !== "custom" && <option value={preset}>{preset}</option>}
              <option value="custom">{t("dashboards.ranges.custom")}</option>
            </SelectField>
          </div>
          {preset === "custom" && (
            <div className="flex items-end gap-2 text-[13px]">
              <label className="flex flex-col">
                {t("dashboards.view.from")}
                <input type="datetime-local" className="rounded-md border border-line bg-panel px-2 py-1" value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} />
              </label>
              <label className="flex flex-col">
                {t("dashboards.view.to")}
                <input type="datetime-local" className="rounded-md border border-line bg-panel px-2 py-1" value={custom.to} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} />
              </label>
              <Button
                onClick={() => {
                  const r = customRange(custom.from, custom.to);
                  if (r) setTimeRange(r);
                }}
              >
                {t("dashboards.view.apply")}
              </Button>
            </div>
          )}
          <div className="w-28">
            <SelectField label={t("dashboards.view.resolution")} value={resolution} onChange={(e) => setResolution(e.target.value)}>
              {RESOLUTIONS.map((r) => (
                <option key={r} value={r}>
                  {t(`dashboards.resolutions.${r}`)}
                </option>
              ))}
            </SelectField>
          </div>
          <div className="w-28">
            <SelectField label={t("dashboards.view.refresh")} value={refresh} onChange={(e) => setRefresh(e.target.value)}>
              {REFRESHES.filter((r) => props.live !== false || r !== "LIVE").map((r) => (
                <option key={r} value={r}>
                  {t(`dashboards.refreshes.${r}`)}
                </option>
              ))}
            </SelectField>
          </div>
          {zoom && <Button onClick={() => setZoom(null)}>{t("dashboards.view.resetZoom")}</Button>}
          <div className="ml-auto flex flex-wrap items-center gap-2">{props.actions}</div>
        </div>
      )}
      <div ref={props.gridRef}>
        <DashboardGrid
          widgets={widgets}
          states={states}
          timezone={props.timezone}
          zoom={zoom}
          onZoom={setZoom}
          noExport={props.noExport}
          dashboardName={props.name}
          chartFactory={props.chartFactory}
          onRetry={(id) => reload([id])}
        />
      </div>
      {widgets.length === 0 && <p className="py-10 text-center text-[13px] text-muted">{t("dashboards.view.empty")}</p>}
    </div>
  );
}
