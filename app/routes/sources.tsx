/**
 * UI-DSC-01 데이터 소스 목록(DSC-01.01, DSC-01.02, DSC-02.01, DSC-02.03, DSC-02.06, DSC-07.01, DSH-08.02).
 * API: 목록 API-DSC-01, 상태 변경 API-DSC-06(activate·pause·resume, baseVersion).
 * 조회 SRC_READ(OPERATOR 이상), [새 소스]·행의 [실시간 메시지]·상태 변경은 SRC_ADMIN(INTEGRATOR 이상).
 * 연결 상태는 실시간(API-DSH-20 `sources` 토픽의 `source-state`)으로 5초 안에 갱신하고(DSC-02.01), 수신량은 1분마다 다시 불러온다.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Form, Link, data, useRevalidator, useSearchParams } from "react-router";
import { callApi, callList, field, listOrThrow } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { getMe } from "~/bff/user.server";
import { Alert, Badge, ButtonLink, Card, Checkbox, CsrfField, EmptyState, PageHeader, Pager, SelectField, Table, TextField } from "~/components/ui";
import { errorText } from "~/lib/error-text";
import { formatRelative } from "~/lib/format";
import { hasAny } from "~/lib/permissions";
import { IngestTabs, LifecycleBadge, Sparkline, StateBadge } from "~/features/sources/components/common";
import { useSourceStates } from "~/features/sources/components/source-state-live";
import { OutputList } from "~/features/sources/components/outputs";
import { SourcesSubTabs } from "~/features/sources/components/sub-tabs";
import type { OutputConnection, OutputStat } from "~/features/sources/model/output";
import type { BffRequestContext } from "~/bff/middleware.server";
import { LIFECYCLES, TYPE_CARDS, displayState, percent, type SourceLimits, type SourceSummary } from "~/features/sources/model/source";
import type { Route } from "./+types/sources";

export function meta() {
  return [{ title: "data2flow" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = bff(context);
  const url = new URL(request.url);
  // 출력 연결 탭(UI-DSC-05, API-DSC-31): 목록 + 연결마다 최근 1시간 1분 지표
  const outputs = url.searchParams.get("tab") === "outputs" ? await loadOutputs(ctx, request) : null;
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const query = new URLSearchParams({ page: String(page), size: "50" });
  const q = url.searchParams.get("q");
  if (q) query.set("q", q);
  for (const type of url.searchParams.getAll("type").filter(Boolean)) query.append("type", type);
  const lifecycle = url.searchParams.get("lifecycle");
  const archived = url.searchParams.get("archived") === "1";
  if (lifecycle) query.set("lifecycle", lifecycle);
  else if (archived) query.set("lifecycle", LIFECYCLES.join(","));
  const [list, me, limits] = await Promise.all([
    callList<SourceSummary>(ctx, request, `/api/v1/core/sources?${query}`),
    getMe(ctx, request),
    // 조직 소스 한도(API-DSC-71, DSC-07.03). 실패해도 목록은 보인다
    callApi<SourceLimits>(ctx, request, "/api/v1/core/source-limits"),
  ]);
  const permissions = me.ok ? me.data.permissions : [];
  return { outputs, sources: listOrThrow(list), page, limits: limits.ok && limits.data ? limits.data : null, canAdmin: hasAny(permissions, ["SRC_ADMIN"]), filtered: Boolean(q || lifecycle || url.searchParams.get("type")), now: ctx.runtime.now() };
}

async function loadOutputs(ctx: BffRequestContext, request: Request) {
  const list = await callList<OutputConnection>(ctx, request, "/api/v1/core/output-connections?size=100");
  if (!list.ok) return { items: [] as OutputConnection[], stats: {} as Record<string, OutputStat[]>, failed: true };
  const now = ctx.runtime.now();
  const range = `from=${encodeURIComponent(new Date(now - 3600_000).toISOString())}&to=${encodeURIComponent(new Date(now).toISOString())}`;
  const stats = await Promise.all(list.list.responses.map((o) => callApi<OutputStat[]>(ctx, request, `/api/v1/core/output-connections/${encodeURIComponent(o.id)}/stats?${range}`)));
  return { items: list.list.responses, stats: Object.fromEntries(list.list.responses.map((o, i) => [o.id, stats[i].ok && Array.isArray(stats[i].data) ? stats[i].data : []])), failed: false };
}

export async function action({ request, context }: Route.ActionArgs) {
  const ctx = bff(context);
  const form = await request.formData();
  const intent = field(form, "intent");
  if (!["activate", "pause", "resume"].includes(intent)) return data({ intent, error: { code: "INVALID_REQUEST" } }, { status: 400 });
  const id = encodeURIComponent(field(form, "id"));
  const result = await callApi(ctx, request, `/api/v1/core/sources/${id}/${intent}`, { method: "POST", body: { baseVersion: Number(field(form, "baseVersion")) } });
  if (!result.ok) return data({ intent, error: { code: result.code, message: result.message } }, { status: result.status });
  return { intent, done: true };
}

export default function Sources({ loaderData, actionData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const { sources, page, canAdmin, filtered, now } = loaderData;
  const [params] = useSearchParams();
  const revalidator = useRevalidator();
  const [clock, setClock] = useState(now);
  const live = useSourceStates(sources.responses.length > 0);
  // 수신량·마지막 수신은 1분마다 다시 불러온다(TC-DSC-075)
  useEffect(() => {
    const timer = setInterval(() => {
      setClock(Date.now());
      if (revalidator.state === "idle") void revalidator.revalidate();
    }, 60_000);
    return () => clearInterval(timer);
  }, [revalidator]);
  const error = actionData && "error" in actionData ? actionData.error : undefined;

  return (
    <>
      <IngestTabs current="sources" />
      <PageHeader
        title={t("sources.list.title")}
        actions={
          <>
            {loaderData.limits && <span className="self-center text-[12.5px] text-muted">{t("sources.limits.sources", { n: loaderData.limits.activeSources, max: loaderData.limits.maxSources })}</span>}
            {canAdmin && (
              <ButtonLink to="/sources/new" variant="primary">
                {t("sources.list.new")}
              </ButtonLink>
            )}
          </>
        }
      />
      {error && <Alert tone="danger">{errorText(t, error)}</Alert>}
      <SourcesSubTabs current={loaderData.outputs ? "outputs" : "sources"} />
      {loaderData.outputs ? (
        <Card actions={canAdmin && <ButtonLink to="/outputs/new">{t("sources.outputs.new")}</ButtonLink>} title={t("sources.outputs.title")}>
          {loaderData.outputs.failed && <Alert tone="warning">{t("sources.outputs.loadFailed")}</Alert>}
          <OutputList outputs={loaderData.outputs.items} stats={loaderData.outputs.stats} canAdmin={canAdmin} />
        </Card>
      ) : (
      <Card>
        <Form method="get" className="mb-3 flex flex-wrap items-end gap-3">
          <TextField label={t("common.search")} name="q" defaultValue={params.get("q") ?? ""} />
          <SelectField label={t("sources.list.type")} name="type" defaultValue={params.get("type") ?? ""}>
            <option value="">{t("common.all")}</option>
            {TYPE_CARDS.map((type) => (
              <option key={type} value={type}>
                {t(`sources.type.${type}`)}
              </option>
            ))}
          </SelectField>
          <SelectField label={t("sources.list.lifecycle")} name="lifecycle" defaultValue={params.get("lifecycle") ?? ""}>
            <option value="">{t("common.all")}</option>
            {LIFECYCLES.map((l) => (
              <option key={l} value={l}>
                {t(`sources.lifecycle.${l}`)}
              </option>
            ))}
          </SelectField>
          <Checkbox label={t("sources.list.includeArchived")} name="archived" value="1" defaultChecked={params.get("archived") === "1"} />
          <button type="submit" className="rounded-md border border-line px-3 py-1.5 text-[13px]">
            {t("common.search")}
          </button>
        </Form>
        {sources.responses.length === 0 ? (
          filtered ? (
            <EmptyState title={t("sources.list.noMatch")} action={<ButtonLink to="/sources">{t("common.reset")}</ButtonLink>} />
          ) : (
            <EmptyState
              title={t("sources.list.emptyTitle")}
              body={canAdmin ? t("sources.list.emptyBody") : t("sources.list.emptyAskAdmin")}
              action={canAdmin && <ButtonLink to="/sources/new" variant="primary">{t("sources.list.connect")}</ButtonLink>}
            />
          )
        ) : (
          <Table>
            <thead>
              <tr>
                <th scope="col">{t("sources.list.state")}</th>
                <th scope="col">{t("sources.list.name")}</th>
                <th scope="col">{t("sources.list.type")}</th>
                <th scope="col">{t("sources.list.lifecycle")}</th>
                <th scope="col">{t("sources.list.rate")}</th>
                <th scope="col">{t("sources.list.decodeErrors")}</th>
                <th scope="col">{t("sources.list.lastReceived")}</th>
                <th scope="col">{t("sources.list.devices")}</th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {sources.responses.map((s) => (
                <tr key={s.id}>
                  <td>
                    {s.type === "WEBHOOK" ? (
                      s.lifecycle === "ACTIVE" ? <Badge tone="info">{t("sources.webhook.waiting")}</Badge> : <StateBadge state="DISABLED" />
                    ) : (
                      <StateBadge state={displayState(s, live.states)} />
                    )}
                  </td>
                  <td>
                    <Link to={`/sources/${s.id}`} className="font-medium text-accent hover:underline">
                      {s.name}
                    </Link>
                    <div className="font-mono text-[12px] text-muted">{s.code}</div>
                  </td>
                  <td>
                    <span aria-hidden className="mr-1 font-mono text-[11px] text-muted">
                      {t(`sources.typeIcon.${s.type}`, { defaultValue: "•" })}
                    </span>
                    {t(`sources.type.${s.type}`, { defaultValue: s.type })}
                  </td>
                  <td>
                    <LifecycleBadge lifecycle={s.lifecycle} />
                  </td>
                  <td className="whitespace-nowrap font-mono">
                    <Sparkline values={s.rateSeries} label={t("sources.list.sparkline")} /> {s.ratePerMin ?? "–"}
                    {t("sources.list.perMin")}
                  </td>
                  <td className="font-mono">{percent(s.decodeErrorRate1h)}</td>
                  <td>{formatRelative(s.lastReceivedAt, clock, i18n.language)}</td>
                  <td className="font-mono">{s.deviceCount ?? 0}</td>
                  <td>
                    {canAdmin && (
                      <div className="flex flex-wrap gap-2">
                        <Link to={`/sources/${s.id}?tab=live`} className="text-[12.5px] text-accent hover:underline">
                          {t("sources.list.live")}
                        </Link>
                        {(s.lifecycle === "DRAFT" || s.lifecycle === "ACTIVE" || s.lifecycle === "PAUSED") && (
                          <Form method="post">
                            <CsrfField />
                            <input type="hidden" name="id" value={s.id} />
                            <input type="hidden" name="baseVersion" value={s.version ?? 0} />
                            <button type="submit" name="intent" value={s.lifecycle === "DRAFT" ? "activate" : s.lifecycle === "ACTIVE" ? "pause" : "resume"} className="text-[12.5px] text-accent hover:underline">
                              {t(`sources.action.${s.lifecycle === "DRAFT" ? "activate" : s.lifecycle === "ACTIVE" ? "pause" : "resume"}`)}
                            </button>
                          </Form>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <Pager page={page} totalPages={sources.totalPages} />
      </Card>
      )}
    </>
  );
}
