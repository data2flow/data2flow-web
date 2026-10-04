/**
 * UI-TSD-01 데이터 탐색기 화면. loader 결과를 그리고, 조건을 바꾸면 `onNavigate`로 주소(`?q=`)를 바꿔 다시 조회한다.
 * 끝이 "지금"이고 원본·1분 단위면 SSE `point`로 마지막 구간을 이어 그린다(명세의 30초 갱신 대신 실시간 구독).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { TimeseriesChart, type ChartFactory } from "~/components/charts/timeseries-chart";
import { LiveBanner, LiveDot, useLiveStream, type UseLiveStreamOptions } from "~/components/live";
import { Alert, Button, Card, EmptyState, PageHeader } from "~/components/ui";
import { appendPoint, type ChartSeries } from "~/lib/chart-model";
import { errorText } from "~/lib/error-text";
import { liveUrl, type StreamEvent } from "~/lib/event-stream";
import { liveTopics, shouldGoLive } from "../model/query";
import { addSeries, seriesKey, type ExploreState } from "../model/state";
import { utcToLocal } from "../model/time";
import type { ExploreActionResult, ExploreData } from "../model/types";
import { AddSeriesDialog, type FetchJson } from "./add-series-dialog";
import { AnnotationForm, AnnotationList, AnnotationToggles } from "./annotations";
import { SeriesPanel } from "./series-panel";
import { Toolbar } from "./toolbar";
import { RuleFromChart } from "~/features/rules/components/rule-from-chart";

export interface ExploreViewProps {
  data: ExploreData;
  onNavigate: (state: ExploreState) => void;
  loading?: boolean;
  actionResult?: ExploreActionResult;
  fetchJson?: FetchJson;
  chartFactory?: ChartFactory;
  live?: UseLiveStreamOptions;
}

interface PointEvent {
  deviceId: string | number;
  metricKey: string;
  t: string;
  v: number | null;
  quality?: number | null;
}

export function ExploreView({ data, onNavigate, loading, actionResult, fetchJson, chartFactory, live }: ExploreViewProps) {
  const { t } = useTranslation();
  const { state } = data;
  const [series, setSeries] = useState<ChartSeries[]>(data.series);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string>();
  const [copied, setCopied] = useState(false);
  useEffect(() => setSeries(data.series), [data.series]);

  const goLive = shouldGoLive(data.range.live, data.result?.resolutionUsed) && !data.problem && !data.failure;
  const url = goLive ? liveUrl(liveTopics(state)) : null;
  const onPoint = useCallback((event: StreamEvent) => {
    const p = event.data as PointEvent;
    if (!p || p.deviceId === undefined) return;
    const key = `d${p.deviceId}.${p.metricKey}`;
    setSeries((current) => current.map((s) => (s.key === key ? appendPoint(s, { t: p.t, v: p.v, quality: p.quality }) : s)));
  }, []);
  const status = useLiveStream(url, ["point"], onPoint, live);

  const visibleSeries = useMemo(() => {
    const visible = new Set(state.series.filter((s) => !s.hidden).map(seriesKey));
    return series.filter((s) => visible.has(s.key));
  }, [series, state.series]);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const problemText = data.problem ? t(`explore.problem.${data.problem}`) : undefined;
  const annotationError = actionResult?.fieldError ? t(`explore.annotations.${actionResult.fieldError}Invalid`) : undefined;

  return (
    <>
      <PageHeader
        title={t("explore.title")}
        crumb={t("explore.crumb")}
        actions={
          <>
            {url && <LiveDot status={status} />}
            <Button onClick={() => void copyLink()}>{copied ? t("common.copied") : t("explore.copyLink")}</Button>
          </>
        }
      />
      <LiveBanner status={status} />
      <div className="grid gap-4 md:grid-cols-[260px_1fr]">
        <Card>
          <SeriesPanel
            state={state}
            onChange={onNavigate}
            onAdd={() => {
              setAddError(undefined);
              setAdding(true);
            }}
          />
        </Card>
        <div className="flex min-w-0 flex-col gap-3">
          <Card>
            <Toolbar state={state} timezone={data.timezone} onChange={onNavigate} />
          </Card>
          {problemText && (
            <Alert tone="danger">
              <span>{problemText}</span>
              {data.problem === "RAW_TOO_LONG" && (
                <Button className="ml-2" onClick={() => onNavigate({ ...state, resolution: "1h" })}>
                  {t("explore.problem.useHourly")}
                </Button>
              )}
            </Alert>
          )}
          {data.failure && <Alert tone="danger">{errorText(t, data.failure)}</Alert>}
          {data.result?.resolutionUsed && (
            <Alert tone="info">
              {t(`explore.resolutionInfo.${data.result.reason === "CAPPED" ? "CAPPED" : data.result.reason === "REQUESTED" ? "REQUESTED" : "AUTO"}`, { resolution: t(`explore.resolution.${data.result.resolutionUsed}`, { defaultValue: data.result.resolutionUsed }) })}
              {data.result.truncated && ` ${t("explore.truncated")}`}
            </Alert>
          )}
          <Card>
            {state.series.length === 0 ? (
              <EmptyState title={t("explore.emptyTitle")} body={t("explore.emptyBody")} action={<Button variant="primary" onClick={() => setAdding(true)}>{t("explore.series.add")}</Button>} />
            ) : (
              <TimeseriesChart series={visibleSeries} timezone={data.timezone} annotations={data.annotations} loading={loading} factory={chartFactory} title={t("explore.title")} />
            )}
            <RuleFromChart series={state.series} />
          </Card>
          <Card>
            <div className="flex flex-col gap-2">
              <AnnotationToggles state={state} onChange={onNavigate} />
              <AnnotationList items={data.annotations} timezone={data.timezone} meId={data.meId} canEdit={data.canAnnotate} />
              {data.canAnnotate && state.series.length > 0 && (
                <AnnotationForm
                  key={actionResult?.ok ? "saved" : "form"}
                  state={state}
                  timezone={data.timezone}
                  defaultFrom={utcToLocal(data.range.from, data.timezone)}
                  defaultTo=""
                  error={annotationError}
                />
              )}
              {actionResult?.ok && <Alert tone="success">{t("common.saved")}</Alert>}
              {actionResult?.error && <Alert tone="danger">{errorText(t, actionResult.error)}</Alert>}
            </div>
          </Card>
        </div>
      </div>
      <AddSeriesDialog
        open={adding}
        spaces={data.spaces}
        fetchJson={fetchJson}
        error={addError}
        onClose={() => setAdding(false)}
        onAdd={(spec) => {
          const next = addSeries(state, spec);
          if (next.error) {
            setAddError(t("explore.tooMany"));
            return;
          }
          setAdding(false);
          onNavigate(next.state);
        }}
      />
    </>
  );
}
