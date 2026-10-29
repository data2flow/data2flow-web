/**
 * UI-ENE-03 에너지 대시보드(`/energy?scope={spaceId}&period=&from=&to=&compare=`, ENE-01.02~03, UC-ENE-03). VIEWER 이상(ENE_READ).
 * 범위 선택(브레드크럼 포트폴리오 › 사이트 › 건물 › 층 › 공간), 기간(이번 달/지난달/올해/사용자 지정), 비교(기준선/직전 기간/작년 같은 기간).
 * 지표 카드(사용량·EUI·재실 시간당·비용·탄소, 비교 대비 ±%), 일별 추이(추정분 빗금, 기준선 선), 하위 단위 표(추정 비율·출처 배지)와 기타·공용.
 * 계량이 없으면 "에너지 출처를 연결하세요 [계량 설정]", 면적이 없으면 EUI "–". 공간 범위가 제한된 사용자는 허용 공간만 합산된다(TC-ENE-019).
 * API: API-ENE-10 지표, API-ENE-11 하위 단위, 공간 트리 API-DEV-01.
 * 범위 공간이 있으면 [기준선] 탭(`?tab=baseline&version=`, UI-ENE-04, API-ENE-12): 기준선·버전 목록·버전 상세, 계산(ENE_ANALYZE)·적용.
 */
import { useCallback, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Form, Link, data, redirect, useRouteLoaderData } from "react-router";
import { callApi, callList, field } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { getMe } from "~/bff/user.server";
import { EChartView } from "~/components/charts/echart-view";
import { Alert, Badge, Button, ButtonLink, Card, EmptyState, PageHeader, SelectField, Table, Tabs, TextField } from "~/components/ui";
import { BaselineSettings, type BaselineFailure } from "~/features/energy/components/baseline-settings";
import { baselineBody, validateBaselineForm, type BaselineDetail, type BaselineForm, type BaselineSummary, type BaselineVersion } from "~/features/energy/model/baseline";
import { COMPARES, PERIODS, diffText, diffTone, granularityOf, periodRange, trendOption, type Breakdown, type EnergyMetrics } from "~/features/energy/model/dashboard";
import { percent } from "~/features/energy/model/settings";
import { errorText } from "~/lib/error-text";
import { formatNumber, resolveTimezone, zonedDate } from "~/lib/format";
import { hasAny } from "~/lib/permissions";
import { flattenSpaces, type SpaceNode } from "~/lib/spaces";
import type { RootData } from "~/root";
import type { Route } from "./+types/energy";

export function meta() {
  return [{ title: "data2flow" }];
}

const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** [기준선] 탭: 범위 공간의 기준선, 버전 목록, 고른 버전(없으면 활성 → 최신) 상세, 기온 원천 후보 기기 */
async function baselineTab(ctx: ReturnType<typeof bff>, request: Request, scope: string, versionParam: string | null, today: string) {
  const [baselines, devices] = await Promise.all([
    callList<BaselineSummary>(ctx, request, `/api/v1/core/energy/baselines?scopeSpaceId=${encodeURIComponent(scope)}`),
    callList<{ id: string; name: string }>(ctx, request, "/api/v1/core/devices?status=ACTIVE&virtual=false&size=100"),
  ]);
  const baseline = baselines.ok ? (baselines.list.responses[0] ?? null) : null;
  const versions = baseline ? await callList<BaselineVersion>(ctx, request, `/api/v1/core/energy/baselines/${baseline.baselineId}/versions?size=50`) : null;
  const rows = versions?.ok ? versions.list.responses : [];
  const selected = versionParam ?? baseline?.activeVersion?.versionId ?? rows[0]?.versionId ?? null;
  const detail = baseline && selected ? await callApi<BaselineDetail>(ctx, request, `/api/v1/core/energy/baselines/${baseline.baselineId}/versions/${encodeURIComponent(selected)}`) : null;
  const yesterday = addDays(today, -1);
  return {
    baseline,
    versions: rows,
    detail: detail?.ok ? detail.data : null,
    devices: devices.ok ? devices.list.responses.map((d) => ({ id: String(d.id), name: d.name })) : [],
    defaults: { trainFrom: addDays(yesterday, -89), trainTo: yesterday },
    failed: baselines.ok ? null : { code: baselines.code, message: baselines.message },
  };
}

type BaselineActionResult = { error?: BaselineFailure; fieldErrors?: Record<string, string>; values?: Partial<BaselineForm> };

export async function action({ request, context }: Route.ActionArgs) {
  const ctx = bff(context);
  const url = new URL(request.url);
  const scope = url.searchParams.get("scope") ?? "";
  const form = await request.formData();
  const intent = field(form, "intent");
  const back = (version?: string) => `/energy?${new URLSearchParams({ scope, tab: "baseline", ...(version ? { version } : {}) })}`;
  if (intent === "activateBaseline") {
    const versionId = field(form, "versionId");
    const result = await callApi(ctx, request, `/api/v1/core/energy/baselines/versions/${encodeURIComponent(versionId)}/activate`, { method: "POST" });
    if (!result.ok) return data<BaselineActionResult>({ error: { code: result.code, message: result.message } }, { status: result.status });
    throw redirect(back(versionId));
  }
  if (intent === "createBaseline") {
    const values: BaselineForm = {
      method: field(form, "method"),
      trainFrom: field(form, "trainFrom").trim(),
      trainTo: field(form, "trainTo").trim(),
      coolingBaseC: field(form, "coolingBaseC").trim(),
      heatingBaseC: field(form, "heatingBaseC").trim(),
      splitWeekday: field(form, "splitWeekday") === "true",
      temperatureDeviceId: field(form, "temperatureDeviceId"),
      temperatureMetricKey: field(form, "temperatureMetricKey").trim(),
    };
    const fieldErrors = validateBaselineForm(values);
    if (Object.keys(fieldErrors).length) return data<BaselineActionResult>({ fieldErrors, values }, { status: 400 });
    const result = await callApi<{ jobId: string; versionId: string }>(ctx, request, "/api/v1/core/energy/baselines/versions", { method: "POST", body: baselineBody(scope, values) });
    if (!result.ok) return data<BaselineActionResult>({ error: { code: result.code, message: result.message, errors: result.errors }, values }, { status: result.status });
    throw redirect(back(result.data.versionId));
  }
  return data<BaselineActionResult>({ error: { code: "BAD_REQUEST" } }, { status: 400 });
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = bff(context);
  const url = new URL(request.url);
  const me = await getMe(ctx, request);
  const today = zonedDate(ctx.runtime.now(), resolveTimezone(me.ok ? me.data.timezone : undefined));
  const scopeParam = url.searchParams.get("scope") ?? "";
  if (scopeParam && url.searchParams.get("tab") === "baseline") {
    const spaces = await callApi<SpaceNode[]>(ctx, request, "/api/v1/core/spaces");
    return { tab: "baseline" as const, scope: scopeParam, trail: trailOf(spaces.ok ? flattenSpaces(spaces.data) : [], scopeParam),
      baselineTab: await baselineTab(ctx, request, scopeParam, url.searchParams.get("version"), today) };
  }
  const range = periodRange(url.searchParams.get("period") ?? "thisMonth", today, { from: url.searchParams.get("from"), to: url.searchParams.get("to") });
  const compareParam = url.searchParams.get("compare") ?? "BASELINE";
  const compare = (COMPARES as readonly string[]).includes(compareParam) ? compareParam : "BASELINE";
  const scope = url.searchParams.get("scope") ?? "";
  const query = new URLSearchParams({ from: range.from, to: range.to, granularity: granularityOf(range.from, range.to), compare });
  if (scope) query.set("scopeSpaceId", scope);
  const breakdownQuery = new URLSearchParams({ from: range.from, to: range.to, size: "50" });
  if (scope) breakdownQuery.set("scopeSpaceId", scope);
  const [spaces, metrics, breakdown, sources] = await Promise.all([
    callApi<SpaceNode[]>(ctx, request, "/api/v1/core/spaces"),
    callApi<EnergyMetrics>(ctx, request, `/api/v1/core/energy/metrics?${query}`),
    callApi<Breakdown>(ctx, request, `/api/v1/core/energy/breakdown?${breakdownQuery}`),
    callApi<unknown[]>(ctx, request, "/api/v1/core/energy/sources"),
  ]);
  return {
    tab: "dashboard" as const,
    ...range,
    compare,
    scope,
    trail: trailOf(spaces.ok ? flattenSpaces(spaces.data) : [], scope),
    metrics: metrics.ok ? metrics.data : null,
    breakdown: breakdown.ok ? breakdown.data : null,
    noSources: sources.ok && sources.data.length === 0,
    failed: metrics.ok ? null : { code: metrics.code, message: metrics.message },
  };
}

function trailOf(flat: ReturnType<typeof flattenSpaces>, scope: string) {
  const trail: { id: string; name: string }[] = [];
  for (let cur = flat.find((s) => s.id === scope); cur; cur = flat.find((s) => s.id === cur!.parentId)) trail.unshift({ id: cur.id, name: cur.name });
  return trail;
}

export default function EnergyRoute({ loaderData, actionData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const { scope, trail } = loaderData;
  const tabs = scope ? (
    <Tabs
      current={loaderData.tab}
      items={[
        { key: "dashboard", label: t("energy.dashboard.tabs.dashboard"), to: `/energy?scope=${encodeURIComponent(scope)}` },
        { key: "baseline", label: t("energy.dashboard.tabs.baseline"), to: `/energy?scope=${encodeURIComponent(scope)}&tab=baseline` },
      ]}
    />
  ) : null;
  if (loaderData.tab === "baseline") {
    const b = loaderData.baselineTab;
    const result = actionData as BaselineActionResult | undefined;
    return (
      <>
        <PageHeader title={t("energy.dashboard.title")} crumb={t("nav.energy")} />
        <ScopeTrail scope={scope} trail={trail} href={(id) => (id ? `/energy?scope=${encodeURIComponent(id)}&tab=baseline` : "/energy")} />
        {tabs}
        {b.failed ? (
          <Alert tone="warning">{errorText(t, b.failed)}</Alert>
        ) : (
          <BaselineSettings
            scopeSpaceId={scope}
            baseline={b.baseline}
            versions={b.versions}
            detail={b.detail}
            devices={b.devices}
            defaults={b.defaults}
            versionHref={(v) => `/energy?scope=${encodeURIComponent(scope)}&tab=baseline&version=${encodeURIComponent(v)}`}
            error={result?.error}
            fieldErrors={result?.fieldErrors}
            values={result?.values}
          />
        )}
      </>
    );
  }
  return <EnergyDashboard data={loaderData} tabs={tabs} />;
}

function ScopeTrail({ scope, trail, href }: { scope: string; trail: { id: string; name: string }[]; href: (id: string) => string }) {
  const { t } = useTranslation();
  return (
    <nav aria-label={t("energy.dashboard.scope")} className="mb-3 flex flex-wrap items-center gap-1 text-[13px]">
      <Link to={href("")} className={scope ? "text-accent" : "font-semibold"}>
        {t("energy.dashboard.portfolio")}
      </Link>
      {trail.map((s, i) => (
        <span key={s.id} className="flex items-center gap-1">
          <span aria-hidden className="text-muted">›</span>
          {i === trail.length - 1 ? <span className="font-semibold">{s.name}</span> : <Link to={href(s.id)} className="text-accent">{s.name}</Link>}
        </span>
      ))}
    </nav>
  );
}

type DashboardData = Extract<Route.ComponentProps["loaderData"], { tab: "dashboard" }>;

function EnergyDashboard({ data: loaderData, tabs }: { data: DashboardData; tabs: ReactNode }) {
  const { t, i18n } = useTranslation();
  const root = useRouteLoaderData("root") as RootData | undefined;
  const canConfigure = hasAny(root?.me?.permissions, ["ENE_OPERATE", "ENE_ADMIN"]);
  const { period, from, to, compare, scope, trail, metrics: m, breakdown, noSources, failed } = loaderData;
  const lang = i18n.language;
  const num = (v: number | null | undefined, precision = 0, unit?: string) => formatNumber(v, lang, { precision, unit });
  const keep = (next: Record<string, string>) => {
    const q = new URLSearchParams({ period, compare, ...(period === "custom" ? { from, to } : {}) });
    for (const [k, v] of Object.entries(next)) {
      if (v) q.set(k, v);
      else q.delete(k);
    }
    return `/energy?${q}`;
  };
  const option = useCallback(
    (dark: boolean) => trendOption(m?.series ?? [], { measured: t("energy.dashboard.measured"), estimated: t("energy.dashboard.estimated"), baseline: t("energy.dashboard.baseline"), unit: "kWh" }, dark),
    [m, t],
  );
  const diff = m?.compare?.diffRatio ?? null;
  const diffBadge = diffText(diff) && <Badge tone={diffTone(diff)}>{diffText(diff)}</Badge>;
  const cards: { key: string; value: string; note?: string | null }[] = m
    ? [
        { key: "kwh", value: num(m.totals.kwh, 0, "kWh") },
        { key: "eui", value: num(m.totals.euiKwhPerM2, 1, "kWh/㎡"), note: m.totals.euiKwhPerM2 == null ? t("energy.dashboard.noArea") : null },
        { key: "perHour", value: num(m.totals.kwhPerOccupiedHour, 1, "kWh"), note: m.totals.kwhPerOccupiedHour == null ? t("energy.dashboard.noOccupancy") : null },
        { key: "krw", value: num(m.totals.krw, 0, t("energy.dashboard.won")) },
        { key: "tco2", value: num(m.totals.tco2, 2, "tCO2eq") },
      ]
    : [];
  return (
    <>
      <PageHeader title={t("energy.dashboard.title")} crumb={t("nav.energy")} />
      <ScopeTrail scope={scope} trail={trail} href={(id) => keep({ scope: id })} />
      {tabs}
      <Form method="get" className="mb-4 flex flex-wrap items-end gap-3">
        {scope && <input type="hidden" name="scope" value={scope} />}
        <SelectField label={t("energy.dashboard.period")} name="period" defaultValue={period}>
          {PERIODS.map((p) => (
            <option key={p} value={p}>
              {t(`energy.dashboard.periods.${p}`)}
            </option>
          ))}
        </SelectField>
        <TextField label={t("energy.dashboard.from")} type="date" name="from" defaultValue={from} />
        <TextField label={t("energy.dashboard.to")} type="date" name="to" defaultValue={to} />
        <SelectField label={t("energy.dashboard.compare")} name="compare" defaultValue={compare}>
          {COMPARES.map((c) => (
            <option key={c} value={c}>
              {t(`energy.dashboard.compares.${c}`)}
            </option>
          ))}
        </SelectField>
        <Button type="submit">{t("energy.dashboard.apply")}</Button>
      </Form>
      {noSources ? (
        <EmptyState title={t("energy.dashboard.noSources")} action={canConfigure ? <ButtonLink to="/energy/meters">{t("energy.area.meters")}</ButtonLink> : undefined} />
      ) : failed || !m ? (
        <Alert tone="warning">{errorText(t, failed ?? { code: "SERVICE_UNAVAILABLE" })}</Alert>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            {cards.map((c) => (
              <div key={c.key} data-metric={c.key} className="flex flex-col gap-1 rounded-lg border border-line bg-panel p-3">
                <span className="text-[12.5px] text-muted">{t(`energy.dashboard.cards.${c.key}`)}</span>
                <span className="text-[18px] font-semibold">{c.value}</span>
                {c.note ? <span className="text-[11.5px] text-muted">{c.note}</span> : c.key === "kwh" && diffBadge}
              </div>
            ))}
          </div>
          <p className="text-[12.5px] text-muted">
            {t("energy.dashboard.summary", { from, to, estimated: percent(m.totals.estimatedRatio) ?? "–" })}
            {m.compare?.reason === "NO_BASELINE" && ` · ${t("energy.dashboard.noBaseline")}`}
            {m.compare?.reason === "NO_WEATHER" && ` · ${t("energy.dashboard.noWeather")}`}
            {m.compare && !m.compare.reason && ` · ${t(`energy.dashboard.compares.${m.compare.kind}`)} ${num(m.compare.kwh, 0, "kWh")}`}
          </p>
          <Card title={t("energy.dashboard.trend")}>
            <div className="p-3">
              {m.series.length ? <EChartView option={option} height={260} label={t("energy.dashboard.trend")} /> : <EmptyState title={t("energy.dashboard.noData")} />}
            </div>
          </Card>
          <Card title={t("energy.dashboard.children")}>
            {breakdown && breakdown.items.length ? (
              <Table>
                <thead>
                  <tr>
                    <th>{t("energy.dashboard.columns.name")}</th>
                    <th>{t("energy.dashboard.columns.kwh")}</th>
                    <th>{t("energy.dashboard.columns.eui")}</th>
                    <th>{t("energy.dashboard.columns.share")}</th>
                    <th>{t("energy.dashboard.columns.estimated")}</th>
                    <th>{t("energy.dashboard.columns.source")}</th>
                  </tr>
                </thead>
                <tbody>
                  {breakdown.items.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <Link to={keep({ scope: c.id })} className="text-accent">
                          {c.name}
                        </Link>
                      </td>
                      <td>{num(c.kwh)}</td>
                      <td>{num(c.euiKwhPerM2, 1)}</td>
                      <td>{percent(c.share) ?? "–"}</td>
                      <td>{percent(c.estimatedRatio) ?? "–"}</td>
                      <td>
                        {c.hasData === false ? (
                          <Badge tone="neutral">{t("energy.dashboard.sources.none")}</Badge>
                        ) : (
                          <Badge tone={c.estimated ? "warning" : "info"}>{t(c.estimated ? "energy.dashboard.sources.mixed" : "energy.dashboard.sources.metered")}</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                  {breakdown.other && Math.abs(breakdown.other.kwh) > 0 && (
                    <tr data-other>
                      <td>{t("energy.dashboard.other")}</td>
                      <td>{num(breakdown.other.kwh)}</td>
                      <td colSpan={4} />
                    </tr>
                  )}
                </tbody>
              </Table>
            ) : (
              <div className="p-3">
                <EmptyState title={t("energy.dashboard.noChildren")} />
              </div>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
