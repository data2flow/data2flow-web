/**
 * 수집 모니터(UI-ING-01 + UI-DSH-03 공유 화면, `/ingest/monitor`). OPERATOR 이상(INGEST_READ).
 * DSH-03.01 흐름 다이어그램 · DSH-03.02 소스별 처리량 · DSH-03.03 메시지 스트림 · DSH-03.04 단계 → 실패 목록 · OPS-01.02 수집 지표.
 * API: API-ING-01 요약, API-DSH-05 흐름 스냅샷, API-ING-02 지표 시계열, API-ING-04 알람 기준(ADMIN), 실시간 API-DSH-20(`ingest`)·API-DSH-21(`ingest-messages`)
 */
import { useTranslation } from "react-i18next";
import { Form, data, useActionData, useLoaderData, useRouteLoaderData, useSearchParams } from "react-router";
import { callApi, field } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { getMe } from "~/bff/user.server";
import { TimeseriesChart } from "~/components/charts/timeseries-chart";
import { Alert, Button, ButtonLink, Card, CsrfField, EmptyState, PageHeader, Tabs, TextField } from "~/components/ui";
import { IngestAreaTabs } from "~/features/ingest/area-tabs";
import { LiveMonitor } from "~/features/ingest/live-monitor";
import { MessageStream } from "~/features/ingest/message-stream";
import { checkThresholds, latencySeries, throughputSeries, type IngestSummary, type MetricPoint, type MonitorSnapshot, type Thresholds } from "~/features/ingest/model/ingest";
import { SummaryCards } from "~/features/ingest/summary-cards";
import { errorText } from "~/lib/error-text";
import { hasAny } from "~/lib/permissions";
import type { RootData } from "~/root";
import type { Route } from "./+types/ingest-monitor";

export function meta() {
  return [{ title: "data2flow" }];
}

const WINDOWS = ["1h", "24h"] as const;

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = bff(context);
  const url = new URL(request.url);
  const window = (WINDOWS as readonly string[]).includes(url.searchParams.get("window") ?? "") ? (url.searchParams.get("window") as string) : "1h";
  const tab = url.searchParams.get("tab") === "stream" ? "stream" : "overview";
  const nowMs = ctx.runtime.now();
  const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
  const hours = window === "24h" ? 24 : 1;
  const me = await getMe(ctx, request);
  const canManage = me.ok && hasAny(me.data.permissions, ["OPS_MANAGE"]);
  const [summary, snapshot, metrics, thresholds] = await Promise.all([
    callApi<IngestSummary>(ctx, request, `/api/v1/core/ingest/summary?window=${window}`),
    callApi<MonitorSnapshot>(ctx, request, `/api/v1/core/monitoring/ingest?window=${window}`),
    callApi<{ points: MetricPoint[] }>(ctx, request, `/api/v1/core/ingest/metrics?from=${iso(nowMs - hours * 3600_000)}&to=${iso(nowMs)}&step=${window === "24h" ? "5m" : "1m"}`),
    canManage ? callApi<Thresholds & { version: number }>(ctx, request, "/api/v1/core/ingest/alert-thresholds") : Promise.resolve(null),
  ]);
  if (!snapshot.ok && snapshot.status === 403) throw data({ code: snapshot.code }, { status: 403 });
  return {
    window,
    tab,
    nowMs,
    summary: summary.ok ? summary.data : null,
    summaryError: summary.ok ? undefined : summary.code,
    snapshot: snapshot.ok ? snapshot.data : null,
    snapshotError: snapshot.ok ? undefined : snapshot.code,
    metrics: metrics.ok ? (metrics.data?.points ?? []) : null,
    thresholds: thresholds?.ok ? thresholds.data : null,
  };
}

type ActionResult = { saved?: boolean; errors?: Record<string, string>; error?: { code: string; message?: string } };

export async function action({ request, context }: Route.ActionArgs) {
  const ctx = bff(context);
  const form = await request.formData();
  const values: Thresholds = { lagWarnSec: Number(field(form, "lagWarnSec")), lagCriticalSec: Number(field(form, "lagCriticalSec")), heartbeatCriticalSec: Number(field(form, "heartbeatCriticalSec")) };
  const errors = checkThresholds(values);
  if (Object.keys(errors).length) return data({ errors } as ActionResult, { status: 400 });
  const result = await callApi(ctx, request, "/api/v1/core/ingest/alert-thresholds", { method: "PUT", body: { ...values, baseVersion: Number(field(form, "baseVersion")) } });
  if (!result.ok) return data({ error: { code: result.code, message: result.message } } as ActionResult, { status: result.status });
  return { saved: true } as ActionResult;
}

export default function IngestMonitor() {
  const { t } = useTranslation();
  const loaded = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const root = useRouteLoaderData("root") as RootData | undefined;
  const [params] = useSearchParams();
  const permissions = root?.me?.permissions ?? [];
  const timezone = root?.timezone ?? "Asia/Seoul";
  const snapshot = loaded.snapshot ?? { stages: [], sources: [], throughput: [] };
  const sources = snapshot.sources.length ? snapshot.sources : (loaded.summary?.sources ?? []).map((s) => ({ id: s.sourceId, name: s.name, state: s.connection, perMin: s.perMinute, lastMessageAt: s.lastReceivedAt }));
  const link = (changes: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) next.set(k, v);
    return `?${next}`;
  };
  const noSources = loaded.snapshot !== null && sources.length === 0;
  return (
    <>
      <PageHeader
        crumb={t("nav.ingest")}
        title={t("ingest.monitor.title")}
        actions={WINDOWS.map((w) => (
          <ButtonLink key={w} to={link({ window: w })} variant={loaded.window === w ? "primary" : "secondary"}>
            {t(`range.${w}`)}
          </ButtonLink>
        ))}
      />
      <IngestAreaTabs current="monitor" />
      {loaded.summaryError && <Alert tone="warning">{t("ingest.monitor.metricsFailed")}</Alert>}
      {noSources ? (
        <EmptyState
          title={t("ingest.monitor.noSources")}
          body={t("ingest.monitor.noSourcesBody")}
          action={hasAny(permissions, ["SRC_ADMIN"]) ? <ButtonLink to="/sources/new" variant="primary">{t("ingest.monitor.addSource")}</ButtonLink> : <span className="text-[13px] text-muted">{t("ingest.monitor.askAdmin")}</span>}
        />
      ) : (
        <div className="flex flex-col gap-4">
          <SummaryCards summary={loaded.summary} />
          <Tabs
            current={loaded.tab}
            items={[
              { key: "overview", label: t("ingest.monitor.tabOverview"), to: link({ tab: "overview" }) },
              { key: "stream", label: t("ingest.monitor.tabStream"), to: link({ tab: "stream" }) },
            ]}
          />
          {loaded.tab === "stream" ? (
            <MessageStream sources={sources.map((s) => ({ id: String(s.id), name: s.name }))} timezone={timezone} initialFilter={{ sourceId: params.get("sourceId") ?? undefined }} />
          ) : (
            <>
              {loaded.snapshotError ? <Alert tone="warning">{errorText(t, { code: loaded.snapshotError })}</Alert> : <LiveMonitor initial={{ ...snapshot, sources }} counts={loaded.summary?.sources} loadedAt={loaded.nowMs} />}
              <div className="grid gap-4 lg:grid-cols-2">
                <Card title={t("ingest.monitor.throughput", { window: t(`range.${loaded.window}`) })}>
                  <TimeseriesChart series={throughputSeries(snapshot, t("ingest.monitor.perMinUnit"))} timezone={timezone} title={t("ingest.monitor.throughput", { window: t(`range.${loaded.window}`) })} />
                </Card>
                <Card title={t("ingest.monitor.latency")}>
                  {loaded.metrics === null ? (
                    <p className="text-[13px] text-muted">{t("ingest.monitor.metricsFailed")}</p>
                  ) : (
                    <TimeseriesChart series={latencySeries(loaded.metrics, { p50: "p50", p95: "p95" })} timezone={timezone} title={t("ingest.monitor.latency")} />
                  )}
                </Card>
              </div>
              {loaded.summary?.heartbeat?.stages && loaded.summary.heartbeat.stages.length > 0 && (
                <Card title={t("ingest.monitor.heartbeat")}>
                  <p className="font-mono text-[13px]">{loaded.summary.heartbeat.stages.map((s) => `${s.name} ${(s.ms / 1000).toFixed(1)}s`).join(" → ")}</p>
                </Card>
              )}
              {hasAny(permissions, ["OPS_MANAGE"]) && loaded.thresholds && <ThresholdForm thresholds={loaded.thresholds} result={result} />}
            </>
          )}
        </div>
      )}
    </>
  );
}

function ThresholdForm({ thresholds, result }: { thresholds: Thresholds & { version: number }; result?: ActionResult }) {
  const { t } = useTranslation();
  const err = (key: string) => {
    const code = result?.errors?.[key];
    if (!code) return undefined;
    return code === "order" ? t("ingest.threshold.order") : t(`ingest.threshold.range.${key}`);
  };
  return (
    <Card title={t("ingest.threshold.title")}>
      <Form method="post" className="grid gap-3 md:grid-cols-4">
        <CsrfField />
        <input type="hidden" name="baseVersion" value={thresholds.version} />
        <TextField label={t("ingest.threshold.lagWarnSec")} name="lagWarnSec" type="number" defaultValue={thresholds.lagWarnSec} error={err("lagWarnSec")} />
        <TextField label={t("ingest.threshold.lagCriticalSec")} name="lagCriticalSec" type="number" defaultValue={thresholds.lagCriticalSec} error={err("lagCriticalSec")} />
        <TextField label={t("ingest.threshold.heartbeatCriticalSec")} name="heartbeatCriticalSec" type="number" defaultValue={thresholds.heartbeatCriticalSec} error={err("heartbeatCriticalSec")} />
        <div className="flex items-end gap-2">
          <Button type="submit" variant="primary">
            {t("common.save")}
          </Button>
        </div>
        {result?.saved && <Alert tone="success">{t("common.saved")}</Alert>}
        {result?.error && <Alert tone="danger">{errorText(t, result.error)}</Alert>}
      </Form>
    </Card>
  );
}
