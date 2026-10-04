/**
 * 기기 화면 부품(UI-DEV-04·05·06): 상태 배지, 연결 표시, 배터리, 현재값 카드, 온보딩 체크리스트,
 * 실시간 개요(API-DSH-20 `space:{id}` → `device-update`), 데이터 탭(API-TSD-02 + `telemetry:{기기}.{항목}` → `point`).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { TimeseriesChart, type ChartFactory } from "~/components/charts/timeseries-chart";
import { LiveBanner, LiveDot, useLiveStream, type UseLiveStreamOptions } from "~/components/live";
import { Badge, Button, Card, SelectField, StatusDot, Term, cx } from "~/components/ui";
import { bffJson, type BffJsonResult } from "~/lib/bff-client";
import { appendPoint, type ChartAnnotation, type ChartSeries, type SeriesPoint } from "~/lib/chart-model";
import { liveUrl } from "~/lib/event-stream";
import { formatDateTime, formatNumber, formatRelative, rangeOf } from "~/lib/format";
import { toDisplayLatest, toDisplaySeriesList, useTemperatureUnit } from "~/lib/units";
import type { Command } from "~/features/control/model/control";
import { commandBands } from "./model/detail";
import { ONBOARDING_ITEMS, applyDeviceUpdate, connectivityTone, statusTone, type DeviceDetail, type LatestValue } from "./model/devices";

export function DeviceStatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  return (
    <Term term="deviceStatus">
      <Badge tone={statusTone(status)}>{t(`status.device.${status}`, { defaultValue: status })}</Badge>
    </Term>
  );
}

export function ConnectivityLabel({ connectivity }: { connectivity?: string | null }) {
  const { t } = useTranslation();
  const value = connectivity ?? "UNKNOWN";
  return <StatusDot tone={connectivityTone(value)} label={t(`status.connectivity.${value}`, { defaultValue: value })} />;
}

export function BatteryBar({ value }: { value?: number | null }) {
  const { t } = useTranslation();
  if (value === null || value === undefined) return <span className="text-muted">–</span>;
  const low = value <= 20;
  return (
    <span className="inline-flex items-center gap-1" aria-label={t("devices.battery", { n: value })}>
      <span aria-hidden className="inline-block h-2 w-10 overflow-hidden rounded bg-bg">
        <span className={cx("block h-full", low ? "bg-bad" : "bg-good")} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </span>
      <span className={cx("font-mono text-[12px]", low && "text-bad")}>{value}%</span>
    </span>
  );
}

export function LatestValueCards({ latest, lang }: { latest: LatestValue[]; lang: string }) {
  const { t } = useTranslation();
  // DEV-04.04: 표시 단위(℉)로 바꿔 보여 준다. 저장값은 그대로
  const shown = toDisplayLatest(latest, useTemperatureUnit());
  return (
    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      {shown.map((m) => (
        <li key={m.metricKey} className="rounded-md border border-line p-3">
          <p className="font-mono text-[11.5px] text-muted">
            <Term term="metric">{m.displayName || m.metricKey}</Term>
          </p>
          <p className="mt-1 font-mono text-[20px] font-semibold">{formatNumber(m.value, lang, { unit: m.unit ?? undefined })}</p>
          {m.quality !== undefined && m.quality !== null && m.quality !== 0 && (
            <p className="text-[11.5px] text-warn">
              <Term term="quality">{t("devices.quality", { code: m.quality })}</Term>
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

/** 온보딩 체크리스트(BR-DEV-26). `links`가 있으면 미완료 항목에 바로가기(DEV-09.01: 모델·공간 → 편집, 첫 수신·디코딩 → 소스, 규칙 → 규칙 템플릿) */
export function OnboardingChecklist({ onboarding, links }: { onboarding: DeviceDetail["onboarding"]; links?: (item: string) => string | undefined }) {
  const { t } = useTranslation();
  return (
    <ul className="flex flex-wrap gap-3 text-[13px]" aria-label={t("devices.onboarding.title")}>
      {ONBOARDING_ITEMS.map((key) => {
        const done = Boolean(onboarding?.[key]);
        const href = !done ? links?.(key) : undefined;
        return (
          <li key={key} className={done ? "text-good" : "text-muted"}>
            {done ? "✓" : "✗"} {t(`devices.onboarding.${key}`)}
            <span className="sr-only">{done ? t("devices.onboarding.done") : t("devices.onboarding.todo")}</span>
            {href && (
              <a href={href} className="ml-1 text-accent hover:underline" aria-label={`${t(`devices.onboarding.${key}`)} ${t("devices.onboarding.fix")}`}>
                → {t("devices.onboarding.fix")}
              </a>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** 개요 탭: 현재값·연결 상태를 실시간으로 갱신한다 */
export function DeviceOverview({ device, timezone, lang, now, live, onboardingLinks }: { device: DeviceDetail; timezone: string; lang: string; now: number; live?: UseLiveStreamOptions; onboardingLinks?: (item: string) => string | undefined }) {
  const { t } = useTranslation();
  const [current, setCurrent] = useState({ latest: device.latest ?? [], state: device.state ?? {} });
  useEffect(() => setCurrent({ latest: device.latest ?? [], state: device.state ?? {} }), [device]);
  const onEvent = useCallback(
    (event: { data: unknown }) => {
      setCurrent((prev) => applyDeviceUpdate({ id: device.id, latest: prev.latest, state: prev.state }, event.data as never) as typeof prev ?? prev);
    },
    [device.id],
  );
  const url = device.space?.id ? liveUrl([`space:${device.space.id}`]) : null;
  const status = useLiveStream(url, ["device-update"], onEvent, live);
  const state = current.state ?? {};
  const effective = device.effective;
  return (
    <div className="grid gap-4">
      <LiveBanner status={status} />
      <Card title={t("devices.overview.title")} actions={<LiveDot status={status} />}>
        <dl className="mb-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px]">
          <dt className="text-muted">{t("devices.lastSeen")}</dt>
          <dd>
            {state.lastSeenAt ? `${formatRelative(state.lastSeenAt, now, lang)} (${formatDateTime(state.lastSeenAt, timezone, lang, true)})` : "–"}
          </dd>
          <dt className="text-muted">{t("devices.batteryLabel")}</dt>
          <dd>
            <BatteryBar value={state.battery} />
          </dd>
          <dt className="text-muted">{t("devices.signal")}</dt>
          <dd className="font-mono">
            {state.rssi ?? "–"}dBm / {state.snr ?? "–"} · {state.bestGatewayEui ?? "–"}
          </dd>
          <dt className="text-muted">{t("devices.offlineBaseline")}</dt>
          <dd>
            {effective?.expectedIntervalSec
              ? t("devices.offlineBaselineValue", { sec: effective.expectedIntervalSec, n: effective.offlineMultiplier ?? 3, from: t(`devices.inheritedFrom.${effective.inheritedFrom ?? "SYSTEM"}`) })
              : "–"}
          </dd>
        </dl>
        {current.latest.length === 0 ? (
          <p className="text-muted">
            {t("devices.noData")}{" "}
            {device.source?.id && (
              <a href={`/sources/${device.source.id}`} className="text-accent hover:underline">
                {t("devices.noDataLink")}
              </a>
            )}
          </p>
        ) : (
          <LatestValueCards latest={current.latest} lang={lang} />
        )}
      </Card>
      <Card title={t("devices.onboarding.title")}>
        <OnboardingChecklist onboarding={device.onboarding} links={onboardingLinks} />
      </Card>
    </div>
  );
}

type Fetcher = <T>(path: string) => Promise<BffJsonResult<T>>;

interface SeriesResponse {
  resolutionUsed?: string;
  series?: { metric: string; unit?: string | null; points: SeriesPoint[]; gaps?: { from: string; to: string }[] }[];
}

const PERIODS = ["1h", "24h", "7d", "30d"] as const;

/**
 * 데이터 탭(UI-DEV-06): 측정 항목·기간·품질을 고르면 API-TSD-02로 다시 조회하고, 끝 구간은 실시간 점을 이어 그린다.
 */
export function DeviceDataPanel({
  deviceId,
  metrics,
  latest,
  expectedIntervalSec,
  timezone,
  now,
  fetcher = bffJson as Fetcher,
  live,
  chartFactory,
  showCommands = false,
}: {
  deviceId: string;
  metrics: string[];
  latest?: LatestValue[];
  expectedIntervalSec?: number | null;
  timezone: string;
  now: () => number;
  fetcher?: Fetcher;
  live?: UseLiveStreamOptions;
  chartFactory?: ChartFactory;
  /** 액추에이터: 적용된 명령을 구간 띠로 겹친다(DEV-02.07, AT-DEV-05.2, API-ACT-02) */
  showCommands?: boolean;
}) {
  const { t } = useTranslation();
  const [bandsOn, setBandsOn] = useState(showCommands);
  const [bands, setBands] = useState<ChartAnnotation[]>([]);
  const [selected, setSelected] = useState<string[]>(metrics.slice(0, 2));
  const [period, setPeriod] = useState<(typeof PERIODS)[number]>("24h");
  const [quality, setQuality] = useState<"normal" | "all">("normal");
  const [series, setSeries] = useState<ChartSeries[]>([]);
  const [annotations, setAnnotations] = useState<ChartAnnotation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const unitOf = useMemo(() => Object.fromEntries((latest ?? []).map((l) => [l.metricKey, l.unit ?? null])), [latest]);
  const temperatureUnit = useTemperatureUnit();

  useEffect(() => {
    if (selected.length === 0) {
      setSeries([]);
      return;
    }
    let cancelled = false;
    const { from, to } = rangeOf(period, now());
    const query = new URLSearchParams({ deviceId, metrics: selected.join(","), from, to, resolution: "auto", quality });
    setLoading(true);
    setError(null);
    void Promise.all([
      fetcher<SeriesResponse>(`/bff/api/core/telemetry/series?${query}`),
      fetcher<{ responses?: ChartAnnotation[] } | ChartAnnotation[]>(`/bff/api/core/annotations?${new URLSearchParams({ deviceId, from, to })}`),
      showCommands ? fetcher<{ responses?: Command[] }>(`/bff/api/core/devices/${encodeURIComponent(deviceId)}/commands?${new URLSearchParams({ from, to, status: "APPLIED", size: "100" })}`) : Promise.resolve(null),
    ]).then(([result, notes, commands]) => {
      if (cancelled) return;
      setBands(commands?.ok ? commandBands(commands.data.responses ?? [], to) : []);
      setLoading(false);
      if (!result.ok) {
        setError(result.code);
        return;
      }
      const raw = result.data.resolutionUsed === "raw";
      setSeries(
        (result.data.series ?? []).map((s) => ({ key: s.metric, label: s.metric, unit: s.unit ?? unitOf[s.metric], points: s.points ?? [], gaps: s.gaps, raw, expectedIntervalSec: raw ? expectedIntervalSec : null })),
      );
      if (notes.ok) setAnnotations(Array.isArray(notes.data) ? notes.data : (notes.data.responses ?? []));
    });
    return () => {
      cancelled = true;
    };
  }, [deviceId, selected, period, quality, fetcher, now, expectedIntervalSec, unitOf, reload, showCommands]);

  const onPoint = useCallback(
    (event: { data: unknown }) => {
      const p = event.data as { deviceId?: string; metricKey?: string; t?: string; v?: number | null; quality?: number | null };
      if (!p || String(p.deviceId) !== deviceId || !p.t) return;
      if (quality === "normal" && p.quality !== undefined && p.quality !== null && ![0, 4].includes(p.quality)) return;
      setSeries((prev) => prev.map((s) => (s.key === p.metricKey ? appendPoint(s, { t: p.t as string, v: p.v ?? null, quality: p.quality }) : s)));
    },
    [deviceId, quality],
  );
  const url = selected.length ? liveUrl(selected.map((m) => `telemetry:${deviceId}.${m}`)) : null;
  const status = useLiveStream(url, ["point"], onPoint, live);

  const toggle = (metric: string) => setSelected((prev) => (prev.includes(metric) ? prev.filter((m) => m !== metric) : [...prev, metric]));
  return (
    <Card title={t("devices.data.title")} actions={<LiveDot status={status} />}>
      <LiveBanner status={status} />
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <fieldset className="flex flex-wrap items-center gap-2">
          <legend className="text-[12.5px] font-medium text-muted">{t("devices.data.metrics")}</legend>
          {metrics.map((m) => (
            <label key={m} className="flex items-center gap-1 text-[13px]">
              <input type="checkbox" checked={selected.includes(m)} onChange={() => toggle(m)} />
              <span className="font-mono">{m}</span>
            </label>
          ))}
        </fieldset>
        <SelectField label={t("devices.data.period")} value={period} onChange={(e) => setPeriod(e.target.value as (typeof PERIODS)[number])}>
          {PERIODS.map((p) => (
            <option key={p} value={p}>
              {t(`range.${p}`)}
            </option>
          ))}
        </SelectField>
        <SelectField label={t("devices.data.quality")} value={quality} onChange={(e) => setQuality(e.target.value as "normal" | "all")}>
          <option value="normal">{t("devices.data.qualityNormal")}</option>
          <option value="all">{t("devices.data.qualityAll")}</option>
        </SelectField>
        {showCommands && (
          <label className="flex items-center gap-1 text-[13px]">
            <input type="checkbox" checked={bandsOn} onChange={(e) => setBandsOn(e.target.checked)} />
            {t("devices.commandBands")}
          </label>
        )}
      </div>
      {error && (
        <p role="alert" className="mb-2 text-[13px] text-bad">
          {t("devices.data.error")}{" "}
          <Button variant="ghost" onClick={() => setReload((n) => n + 1)}>
            {t("common.retry")}
          </Button>
        </p>
      )}
      {selected.length === 0 ? (
        <p className="text-muted">{t("devices.data.chooseMetric")}</p>
      ) : (
        <TimeseriesChart series={toDisplaySeriesList(series, temperatureUnit)} timezone={timezone} annotations={bandsOn ? [...annotations, ...bands] : annotations} loading={loading} title={t("devices.data.title")} factory={chartFactory} />
      )}
    </Card>
  );
}
