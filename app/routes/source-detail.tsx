/**
 * UI-DSC-03 소스 상세(DSC-02.01·02.03·02.06, DSC-01.07, DSC-03.02, DSC-07.01).
 * 탭: 상태(인스턴스 카드 API-DSC-14, 수신 지표 차트 API-DSC-09 최대 7일) · 실시간 메시지(API-DSC-10 SSE, SRC_ADMIN) ·
 * 설정(기본 모델·공간 링크) · 사용처(API-DSC-11) · 무시 목록(API-DSC-13) · 자격증명(플랫폼 브로커, API-DSC-23).
 * 헤더 버튼: 활성화·일시정지·재개·보관·삭제(API-DSC-06·07), 복제(API-DSC-12). 조회 SRC_READ, 변경 SRC_ADMIN.
 */
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Form, Link, data, redirect, useSearchParams } from "react-router";
import { callApi, callList, field, orThrow } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { getMe } from "~/bff/user.server";
import { TimeseriesChart } from "~/components/charts/timeseries-chart";
import { Alert, Badge, ButtonLink, Card, CsrfField, EmptyState, PageHeader, Table, Tabs } from "~/components/ui";
import type { ChartSeries } from "~/lib/chart-model";
import { errorText } from "~/lib/error-text";
import { formatDate, formatDateTime, rangeOf } from "~/lib/format";
import { hasAny } from "~/lib/permissions";
import { findSpace, type SpaceNode } from "~/lib/spaces";
import { IngestTabs, LifecycleBadge, StateBadge, useTimezone } from "~/features/sources/components/common";
import { LifecycleActions, type UsageSummary } from "~/features/sources/components/lifecycle-actions";
import { LiveMessages } from "~/features/sources/components/live-messages";
import { useSourceStates } from "~/features/sources/components/source-state-live";
import type { BrokerInfo } from "~/features/sources/device-credentials";
import { STAT_RANGES, STAT_SERIES, representativeState, statBucket, type RuntimeInstance, type SourceDetail } from "~/features/sources/model/source";
import type { Route } from "./+types/source-detail";

const TABS = ["status", "live", "settings", "usage", "ignore", "credentials"] as const;
type Tab = (typeof TABS)[number];

interface StatPoint {
  t: string;
  received?: number;
  accepted?: number;
  decodeErrors?: number;
  scriptErrors?: number;
  rejectedUnknown?: number;
  invalid?: number;
  reconnects?: number;
}

interface Usage extends UsageSummary {
  volume7d?: { day: string; count: number }[];
}

interface IgnoreEntry {
  externalId: string;
  reason: string;
  createdAt?: string;
}

export function meta() {
  return [{ title: "data2flow" }];
}

function tabsFor(source: SourceDetail, canAdmin: boolean): Tab[] {
  return TABS.filter((tab) => (tab === "live" ? canAdmin : tab === "credentials" ? source.type === "PLATFORM_BROKER" : true));
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const ctx = bff(context);
  const url = new URL(request.url);
  const id = encodeURIComponent(params.sourceId);
  const [sourceResult, me, usageResult] = await Promise.all([callApi<SourceDetail>(ctx, request, `/api/v1/core/sources/${id}`), getMe(ctx, request), callApi<Usage>(ctx, request, `/api/v1/core/sources/${id}/usage`)]);
  const source = orThrow(sourceResult);
  const canAdmin = me.ok && hasAny(me.data.permissions, ["SRC_ADMIN"]);
  const available = tabsFor(source, canAdmin);
  const requested = url.searchParams.get("tab") as Tab | null;
  const tab: Tab = requested && available.includes(requested) ? requested : "status";
  const range = (STAT_RANGES as readonly string[]).includes(url.searchParams.get("range") ?? "") ? (url.searchParams.get("range") as string) : "24h";
  const usage = usageResult.ok ? usageResult.data : null;
  let runtime: RuntimeInstance[] = source.runtime ?? [];
  let stats: StatPoint[] = [];
  let statsError = false;
  let settings: { modelName: string | null; modelCode: string | null; modelMissing: boolean; spacePath: string[] | null; spaceMissing: boolean } | null = null;
  let ignore: IgnoreEntry[] = [];
  let broker: BrokerInfo | null = null;
  if (tab === "status") {
    const { from, to } = rangeOf(range, ctx.runtime.now());
    const [runtimeResult, statsResult] = await Promise.all([
      callApi<{ instances: RuntimeInstance[] }>(ctx, request, `/api/v1/core/sources/${id}/runtime`),
      callApi<StatPoint[] | { points: StatPoint[] }>(ctx, request, `/api/v1/core/sources/${id}/stats?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&bucket=${statBucket(range)}`),
    ]);
    if (runtimeResult.ok && runtimeResult.data?.instances) runtime = runtimeResult.data.instances;
    if (statsResult.ok) stats = Array.isArray(statsResult.data) ? statsResult.data : (statsResult.data?.points ?? []);
    else statsError = true;
  }
  if (tab === "settings") {
    const [model, spaces] = await Promise.all([source.defaultModelId ? callApi<{ code: string; name: string }>(ctx, request, `/api/v1/core/device-models/${encodeURIComponent(source.defaultModelId)}`) : Promise.resolve(null), callApi<SpaceNode[]>(ctx, request, "/api/v1/core/spaces")]);
    const space = spaces.ok && Array.isArray(spaces.data) ? findSpace(spaces.data, source.defaultSpaceId) : undefined;
    settings = {
      modelName: model?.ok ? model.data.name : null,
      modelCode: model?.ok ? model.data.code : null,
      modelMissing: Boolean(source.defaultModelId) && !model?.ok,
      spacePath: space ? space.path : null,
      spaceMissing: Boolean(source.defaultSpaceId) && !space,
    };
  }
  if (tab === "ignore") {
    const list = await callList<IgnoreEntry>(ctx, request, `/api/v1/core/sources/${id}/ignore-list?size=100`);
    ignore = list.ok ? list.list.responses : [];
  }
  if (tab === "credentials") {
    const info = await callApi<BrokerInfo>(ctx, request, "/api/v1/core/platform-broker");
    broker = info.ok ? info.data : null;
  }
  return { source, canAdmin, tabs: available, tab, range, usage, runtime, stats, statsError, settings, ignore, broker, saved: url.searchParams.get("saved") === "1" };
}

export async function action({ request, context, params }: Route.ActionArgs) {
  const ctx = bff(context);
  const form = await request.formData();
  const intent = field(form, "intent");
  const id = encodeURIComponent(params.sourceId);
  const baseVersion = Number(field(form, "baseVersion"));
  const fail = (r: { code: string; message: string; status: number }) => data({ intent, error: { code: r.code, message: r.message } }, { status: r.status });
  switch (intent) {
    case "activate":
    case "pause":
    case "resume": {
      const result = await callApi(ctx, request, `/api/v1/core/sources/${id}/${intent}`, { method: "POST", body: { baseVersion } });
      return result.ok ? { intent, done: true } : fail(result);
    }
    case "archive": {
      const source = await callApi<SourceDetail>(ctx, request, `/api/v1/core/sources/${id}`);
      if (!source.ok) return fail(source);
      if (field(form, "confirm") !== source.data.code) return data({ intent, error: { code: "CONFIRM_MISMATCH" } }, { status: 400 });
      const result = await callApi(ctx, request, `/api/v1/core/sources/${id}/archive`, { method: "POST", body: { baseVersion, confirm: true } });
      return result.ok ? { intent, done: true } : fail(result);
    }
    case "delete": {
      const result = await callApi(ctx, request, `/api/v1/core/sources/${id}`, { method: "DELETE" });
      return result.ok ? redirect("/sources") : fail(result);
    }
    case "clone": {
      const result = await callApi<{ id: string }>(ctx, request, `/api/v1/core/sources/${id}/clone`, { method: "POST", body: { code: field(form, "code").trim(), name: field(form, "name").trim() } });
      return result.ok ? redirect(`/sources/${encodeURIComponent(result.data.id)}/edit`) : fail(result);
    }
    case "unignore": {
      const result = await callApi(ctx, request, `/api/v1/core/sources/${id}/ignore-list/${encodeURIComponent(field(form, "externalId"))}`, { method: "DELETE" });
      return result.ok ? { intent, done: true } : fail(result);
    }
    default:
      return data({ intent, error: { code: "INVALID_REQUEST" } }, { status: 400 });
  }
}

export default function SourceDetailPage({ loaderData, actionData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const timezone = useTimezone();
  const { source, canAdmin, tabs, tab, usage, runtime } = loaderData;
  const error = actionData && "error" in actionData ? actionData.error : undefined;
  // 실시간 상태(DSC-02.01, `sources` 토픽)가 오면 대표 상태를 바로 바꾼다. ACTIVE가 아니면 DISABLED 그대로
  const live = useSourceStates(source.lifecycle === "ACTIVE");
  const representative = source.lifecycle === "ACTIVE" ? (live.states[source.id] ?? representativeState(source, runtime)) : representativeState(source, runtime);
  return (
    <>
      <IngestTabs current="sources" />
      <PageHeader
        crumb={t("sources.list.title")}
        title={
          <span className="flex flex-wrap items-center gap-2">
            {source.name}
            <span className="font-mono text-[13px] font-normal text-muted">{source.code}</span>
            <Badge tone="neutral">{t(`sources.type.${source.type}`, { defaultValue: source.type })}</Badge>
            <LifecycleBadge lifecycle={source.lifecycle} />
            <StateBadge state={representative} />
          </span>
        }
        actions={canAdmin && <LifecycleActions code={source.code} lifecycle={source.lifecycle} version={source.version} usage={usage} />}
      />
      {error && <Alert tone="danger">{error.code === "CONFIRM_MISMATCH" ? t("sources.confirm.mismatch") : errorText(t, error)}</Alert>}
      {loaderData.saved && <Alert tone="success">{t("sources.edit.saved")}</Alert>}
      <Tabs current={tab} items={tabs.map((key) => ({ key, label: t(`sources.detail.tab.${key}`), to: `?tab=${key}` }))} />
      {tab === "status" && <StatusTab runtime={runtime} stats={loaderData.stats} statsError={loaderData.statsError} range={loaderData.range} timezone={timezone} lang={i18n.language} />}
      {tab === "live" && (
        <Card title={t("sources.detail.tab.live")}>
          <LiveMessages sourceId={source.id} timezone={timezone} />
        </Card>
      )}
      {tab === "settings" && <SettingsTab source={source} settings={loaderData.settings} canAdmin={canAdmin} />}
      {tab === "usage" && <UsageTab sourceId={source.id} usage={usage} />}
      {tab === "ignore" && <IgnoreTab entries={loaderData.ignore} canAdmin={canAdmin} timezone={timezone} lang={i18n.language} />}
      {tab === "credentials" && <CredentialsTab broker={loaderData.broker} />}
    </>
  );
}

function StatusTab({ runtime, stats, statsError, range, timezone, lang }: { runtime: RuntimeInstance[]; stats: StatPoint[]; statsError: boolean; range: string; timezone: string; lang: string }) {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const series: ChartSeries[] = useMemo(
    () =>
      STAT_SERIES.map((key) => ({
        key,
        label: t(`sources.stats.${key}`),
        unit: t("sources.stats.unit"),
        points: stats.map((p) => [p.t, typeof p[key] === "number" ? (p[key] as number) : null, null] as [string, number | null, null]),
        error: statsError,
      })),
    [stats, statsError, t],
  );
  const link = (r: string) => {
    const next = new URLSearchParams(params);
    next.set("tab", "status");
    next.set("range", r);
    return `?${next}`;
  };
  return (
    <div className="flex flex-col gap-4">
      {runtime.length === 0 ? (
        <EmptyState title={t("sources.detail.noInstances")} body={t("sources.detail.noInstancesBody")} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {runtime.map((r) => (
            <Card key={r.instanceId} title={r.instanceId}>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13px]">
                <dt className="text-muted">{t("sources.detail.state")}</dt>
                <dd>
                  <StateBadge state={r.state} />
                </dd>
                <dt className="text-muted">client-id</dt>
                <dd className="font-mono">{r.clientId ?? "–"}</dd>
                <dt className="text-muted">{t("sources.detail.connectedSince")}</dt>
                <dd>{formatDateTime(r.connectedSince, timezone, lang)}</dd>
                <dt className="text-muted">{t("sources.detail.reconnects24h")}</dt>
                <dd className="font-mono">{r.reconnects24h ?? "–"}</dd>
                <dt className="text-muted">{t("sources.detail.lastError")}</dt>
                <dd>{r.errorKind ? `${r.errorKind}${r.errorMessage ? ` · ${r.errorMessage}` : ""}` : t("sources.detail.noError")}</dd>
              </dl>
            </Card>
          ))}
        </div>
      )}
      <Card
        title={t("sources.detail.metrics")}
        actions={
          <div className="flex gap-1" role="group" aria-label={t("sources.detail.period")}>
            {STAT_RANGES.map((r) => (
              <Link key={r} to={link(r)} aria-current={r === range ? "true" : undefined} className={r === range ? "rounded border border-accent px-2 py-0.5 text-[12px] text-accent" : "rounded border border-line px-2 py-0.5 text-[12px] text-muted"}>
                {t(`range.${r}`)}
              </Link>
            ))}
          </div>
        }
      >
        <p className="mb-2 text-[12px] text-muted">{t("sources.detail.periodLimit")}</p>
        <TimeseriesChart series={series} timezone={timezone} title={t("sources.detail.metrics")} />
      </Card>
    </div>
  );
}

function SettingsTab({ source, settings, canAdmin }: { source: SourceDetail; settings: { modelName: string | null; modelCode: string | null; modelMissing: boolean; spacePath: string[] | null; spaceMissing: boolean } | null; canAdmin: boolean }) {
  const { t } = useTranslation();
  const c = (source.connection ?? {}) as Record<string, unknown>;
  const rows: [string, React.ReactNode][] = [
    [t("sources.form.type"), t(`sources.type.${source.type}`, { defaultValue: source.type })],
    ...(c.url ? [[t("sources.form.url"), <span className="font-mono">{String(c.url)}</span>] as [string, React.ReactNode]] : []),
    ...(source.clientIds?.length ? [["client-id", <span className="font-mono">{source.clientIds.join(", ")}</span>] as [string, React.ReactNode]] : []),
    ...(source.topics?.length ? [[t("sources.form.tab.subscription"), <span className="font-mono">{source.topics.map((x) => `${x.topic} (QoS ${x.qos})`).join(", ")}</span>] as [string, React.ReactNode]] : []),
    [t("sources.form.auth"), source.secret?.configured ? `${t(`sources.auth.${source.secret.kind ?? "NONE"}`, { defaultValue: source.secret.kind })} · ${source.secret.fingerprint ?? "••••"}` : t(`sources.auth.${String(c.auth ?? "NONE")}`, { defaultValue: String(c.auth ?? "–") })],
    [t("sources.form.decoder"), t(`sources.decoder.${source.decoderKey}`, { defaultValue: source.decoderKey ?? "–" })],
    [t("sources.form.unknownDevicePolicy"), t(`sources.policy.${source.unknownDevicePolicy}`, { defaultValue: source.unknownDevicePolicy ?? "–" })],
    [
      t("sources.form.defaultModel"),
      settings?.modelMissing ? (
        <Badge tone="warning">{t("sources.detail.modelMissing")}</Badge>
      ) : settings?.modelCode ? (
        <Link to={`/models/${encodeURIComponent(settings.modelCode)}`} className="text-accent hover:underline">
          {settings.modelName ?? settings.modelCode}
        </Link>
      ) : (
        t("sources.form.noDefault")
      ),
    ],
    [
      t("sources.form.defaultSpace"),
      settings?.spaceMissing ? (
        <Badge tone="warning">{t("sources.detail.spaceMissing")}</Badge>
      ) : settings?.spacePath && source.defaultSpaceId ? (
        <Link to={`/spaces/${encodeURIComponent(source.defaultSpaceId)}`} className="text-accent hover:underline">
          {settings.spacePath.join(" › ")}
        </Link>
      ) : (
        t("sources.form.noDefault")
      ),
    ],
    [t("sources.form.autoregLimit"), String(source.autoregLimitPerHour ?? "–")],
    [t("sources.form.noDataAlarm"), String(source.noDataAlarmAfterSec ?? "–")],
  ];
  return (
    <Card title={t("sources.detail.tab.settings")} actions={<ButtonLink to={`/sources/${encodeURIComponent(source.id)}/edit`}>{canAdmin && source.lifecycle !== "ARCHIVED" ? t("common.edit") : t("sources.detail.viewSettings")}</ButtonLink>}>
      <dl className="grid grid-cols-[160px_1fr] gap-x-3 gap-y-2 text-[13px]">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

function UsageTab({ sourceId, usage }: { sourceId: string; usage: Usage | null }) {
  const { t } = useTranslation();
  if (!usage) return <EmptyState title={t("sources.detail.usageUnavailable")} />;
  const max = Math.max(1, ...(usage.volume7d ?? []).map((v) => v.count));
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card title={t("sources.detail.devices")}>
        <Link to={`/devices?sourceId=${encodeURIComponent(sourceId)}`} className="text-[20px] font-semibold text-accent hover:underline">
          {t("sources.detail.deviceCount", { n: usage.deviceCount ?? 0 })}
        </Link>
      </Card>
      <Card title={t("sources.detail.flows")}>
        {usage.flows && usage.flows.length > 0 ? (
          <ul className="text-[13px]">
            {usage.flows.map((f) => (
              <li key={f.id}>{f.name}</li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-muted">{t("sources.detail.noFlows")}</p>
        )}
      </Card>
      <Card title={t("sources.detail.volume7d")} className="md:col-span-2">
        <ul className="flex flex-col gap-1 text-[12.5px]">
          {(usage.volume7d ?? []).map((v) => (
            <li key={v.day} className="grid grid-cols-[90px_1fr_80px] items-center gap-2">
              <span className="font-mono">{v.day}</span>
              <span className="h-2 rounded bg-accent" style={{ width: `${(v.count / max) * 100}%` }} aria-hidden />
              <span className="text-right font-mono">{v.count.toLocaleString()}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function IgnoreTab({ entries, canAdmin, timezone, lang }: { entries: IgnoreEntry[]; canAdmin: boolean; timezone: string; lang: string }) {
  const { t } = useTranslation();
  if (entries.length === 0) return <EmptyState title={t("sources.ignore.empty")} body={t("sources.ignore.emptyBody")} />;
  return (
    <Card title={t("sources.detail.tab.ignore")}>
      <Table>
        <thead>
          <tr>
            <th scope="col">{t("sources.ignore.externalId")}</th>
            <th scope="col">{t("sources.ignore.reason")}</th>
            <th scope="col">{t("sources.ignore.createdAt")}</th>
            <th scope="col" />
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.externalId}>
              <td className="font-mono">{e.externalId}</td>
              <td>{t(`sources.ignore.reasons.${e.reason}`, { defaultValue: e.reason })}</td>
              <td>{formatDate(e.createdAt, timezone, lang)}</td>
              <td>
                {canAdmin && (
                  <Form method="post">
                    <CsrfField />
                    <input type="hidden" name="externalId" value={e.externalId} />
                    <button type="submit" name="intent" value="unignore" className="text-[12.5px] text-accent hover:underline">
                      {t("sources.ignore.release")}
                    </button>
                  </Form>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}

function CredentialsTab({ broker }: { broker: BrokerInfo | null }) {
  const { t } = useTranslation();
  return (
    <Card title={t("sources.credentials.connectInfo")}>
      <dl className="grid grid-cols-[160px_1fr] gap-x-3 gap-y-2 text-[13px]">
        <dt className="text-muted">{t("sources.credentials.endpoint")}</dt>
        <dd className="font-mono">{broker?.wssUrl ?? "wss://iot-data.java21.net/mqtt"}</dd>
        <dt className="text-muted">{t("sources.credentials.authMethod")}</dt>
        <dd>{broker?.auth ?? "BASIC"}</dd>
        <dt className="text-muted">{t("sources.credentials.signing")}</dt>
        <dd>{broker?.signing ?? "HMAC-SHA256"}</dd>
        <dt className="text-muted">{t("sources.credentials.topicRules")}</dt>
        <dd className="font-mono">{(broker?.topicRules ?? []).join(", ") || "–"}</dd>
      </dl>
      <p className="mt-3 text-[12.5px] text-muted">{t("sources.credentials.perDevice")}</p>
    </Card>
  );
}
