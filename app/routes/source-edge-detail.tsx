/**
 * UI-DSC-10 엣지 게이트웨이 상세(`/sources/edges/{id}?tab=overview|config|update|logs`, DSC-08.03·08.04).
 * 개요(상태·버퍼·처리량·마지막 연결, 오프라인이면 "버퍼에 쌓이는 중일 수 있음"), 수집 대상 설정 판(API-DSC-64 편집·배포·롤백),
 * 업데이트(API-DSC-65 승인·이력), 로그 수집(API-DSC-67 `{minutes}`), 재시작·폐기·등록 토큰 재발급. 관리 SRC_ADMIN, 조회 SRC_READ.
 */
import { useTranslation } from "react-i18next";
import { Form, data, redirect } from "react-router";
import { callApi, field, orThrow } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { getMe } from "~/bff/user.server";
import { Alert, Button, Card, CsrfField, PageHeader, Tabs, TextField } from "~/components/ui";
import { errorText } from "~/lib/error-text";
import { formatDateTime, formatRelative } from "~/lib/format";
import { hasAny } from "~/lib/permissions";
import { IngestTabs, useTimezone } from "~/features/sources/components/common";
import { ConfigVersions, EdgeRegistrationCard, EdgeStatus, EdgeUpdatesPanel } from "~/features/sources/components/edges";
import { SourcesSubTabs } from "~/features/sources/components/sub-tabs";
import { bufferPercent, compactCount, edgeActions, parseConfigVersion, type EdgeConfigVersion, type EdgeGateway, type EdgeRegistration, type EdgeUpdates } from "~/features/sources/model/edge";
import type { Route } from "./+types/source-edge-detail";

export function meta() {
  return [{ title: "data2flow" }];
}

const TABS = ["overview", "config", "update", "logs"] as const;

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const ctx = bff(context);
  const id = encodeURIComponent(params.edgeId);
  const url = new URL(request.url);
  const tab = (TABS as readonly string[]).includes(url.searchParams.get("tab") ?? "") ? (url.searchParams.get("tab") as (typeof TABS)[number]) : "overview";
  const [edge, me, versions, updates] = await Promise.all([
    callApi<EdgeGateway>(ctx, request, `/api/v1/core/edges/${id}`),
    getMe(ctx, request),
    tab === "config" ? callApi<EdgeConfigVersion[]>(ctx, request, `/api/v1/core/edges/${id}/config-versions`) : Promise.resolve(null),
    tab === "update" ? callApi<EdgeUpdates>(ctx, request, `/api/v1/core/edges/${id}/updates`) : Promise.resolve(null),
  ]);
  return {
    edge: orThrow(edge),
    tab,
    canAdmin: me.ok && hasAny(me.data.permissions, ["SRC_ADMIN"]),
    versions: versions?.ok && Array.isArray(versions.data) ? [...versions.data].sort((a, b) => b.version - a.version) : [],
    updates: updates?.ok ? updates.data : null,
    now: ctx.runtime.now(),
  };
}

export async function action({ request, context, params }: Route.ActionArgs) {
  const ctx = bff(context);
  const form = await request.formData();
  const intent = field(form, "intent");
  const id = encodeURIComponent(params.edgeId);
  const base = `/api/v1/core/edges/${id}`;
  const fail = (r: { code: string; message: string; status: number }) => data({ intent, error: { code: r.code, message: r.message } }, { status: r.status });
  switch (intent) {
    case "createConfig": {
      const parsed = parseConfigVersion(field(form, "config"));
      if (!parsed.ok) return data({ intent, error: { code: "INVALID_REQUEST" } }, { status: 400 });
      const r = await callApi<EdgeConfigVersion>(ctx, request, `${base}/config-versions`, { method: "POST", body: parsed.body });
      return r.ok ? redirect(`/sources/edges/${id}?tab=config`) : fail(r);
    }
    case "deploy":
    case "rollback": {
      const version = Number(field(form, "version"));
      if (!Number.isInteger(version) || version < 1) return data({ intent, error: { code: "INVALID_REQUEST" } }, { status: 400 });
      const r = await callApi(ctx, request, `${base}/config-versions/${version}/${intent}`, { method: "POST" });
      return r.ok ? { intent, done: true } : fail(r);
    }
    case "approveUpdate": {
      const r = await callApi(ctx, request, `${base}/updates`, { method: "POST", body: { toVersion: field(form, "toVersion") } });
      return r.ok ? { intent, done: true } : fail(r);
    }
    case "restart":
    case "revoke":
    case "collect-logs": {
      const minutes = Number(field(form, "minutes") || 60);
      if (intent === "collect-logs" && !(Number.isInteger(minutes) && minutes >= 1 && minutes <= 1440)) return data({ intent, error: { code: "INVALID_REQUEST" } }, { status: 400 });
      const r = await callApi<{ requestId: string }>(ctx, request, `${base}/${intent}`, { method: "POST", body: intent === "collect-logs" ? { minutes } : {} });
      return r.ok ? { intent, requestId: r.data.requestId } : fail(r);
    }
    case "reissue": {
      const r = await callApi<EdgeRegistration>(ctx, request, `${base}/registration-tokens`, { method: "POST" });
      return r.ok ? { intent, registration: r.data } : fail(r);
    }
    default:
      return data({ intent, error: { code: "INVALID_REQUEST" } }, { status: 400 });
  }
}

export default function SourceEdgeDetail({ loaderData, actionData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const timezone = useTimezone();
  const { edge, tab, canAdmin, versions, updates, now } = loaderData;
  const result = actionData as { intent?: string; done?: boolean; requestId?: string; registration?: EdgeRegistration; error?: { code: string; message?: string } } | undefined;
  const actions = canAdmin ? edgeActions(edge) : [];
  const pct = bufferPercent(edge.bufferUsedBytes);
  return (
    <>
      <IngestTabs current="sources" />
      <PageHeader
        crumb={t("sources.edges.title")}
        title={
          <span className="flex flex-wrap items-center gap-2">
            {edge.name} <EdgeStatus status={edge.status} />
          </span>
        }
        actions={
          actions.length > 0 && (
            <Form method="post" className="flex flex-wrap gap-2" onSubmit={(e) => {
              const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
              if (submitter?.value === "revoke" && !window.confirm(t("sources.edges.revokeConfirm"))) e.preventDefault();
            }}>
              <CsrfField />
              {actions
                .filter((a) => a !== "collect-logs")
                .map((a) => (
                  <Button key={a} type="submit" name="intent" value={a} variant={a === "revoke" ? "danger" : "secondary"}>
                    {t(`sources.edges.action.${a}`)}
                  </Button>
                ))}
            </Form>
          )
        }
      />
      <SourcesSubTabs current="edges" />
      {result?.error && <Alert tone="danger">{errorText(t, result.error)}</Alert>}
      {result?.requestId && <Alert tone="success">{t("sources.edges.requested", { id: result.requestId })}</Alert>}
      {result?.done && <Alert tone="success">{t("sources.edges.done")}</Alert>}
      {result?.registration && (
        <div className="mb-4">
          <EdgeRegistrationCard registration={result.registration} timezone={timezone} lang={i18n.language} />
        </div>
      )}
      <Tabs current={tab} items={TABS.map((key) => ({ key, label: t(`sources.edges.tab.${key}`), to: `?tab=${key}` }))} />
      {tab === "overview" && (
        <Card>
          {edge.status === "OFFLINE" && <Alert tone="warning">{t("sources.edges.offlineHint", { at: edge.lastSeenAt ? formatDateTime(edge.lastSeenAt, timezone, i18n.language) : "–" })}</Alert>}
          <dl className="grid grid-cols-[160px_1fr] gap-x-3 gap-y-2 text-[13px]">
            <dt className="text-muted">{t("sources.edges.site")}</dt>
            <dd>{edge.site?.name ?? "–"}</dd>
            <dt className="text-muted">{t("sources.edges.version")}</dt>
            <dd className="font-mono">
              {edge.agentVersion ?? "–"} {edge.arch ? `(${edge.arch})` : ""} {edge.updateAvailable ? t("sources.edges.updateTo", { version: edge.latestAgentVersion ?? "" }) : ""}
            </dd>
            <dt className="text-muted">{t("sources.edges.buffer")}</dt>
            <dd className="font-mono">{pct === null ? "–" : `${pct}% · ${compactCount(edge.bufferItems)} · ${t("sources.edges.dropped", { n: edge.droppedItems ?? 0 })}`}</dd>
            <dt className="text-muted">{t("sources.edges.throughput")}</dt>
            <dd className="font-mono">{edge.throughput === null || edge.throughput === undefined ? "–" : t("sources.edges.perMin", { n: Math.round(edge.throughput) })}</dd>
            <dt className="text-muted">{t("sources.edges.lastSeen")}</dt>
            <dd>{formatRelative(edge.lastSeenAt, now, i18n.language)}</dd>
            <dt className="text-muted">{t("sources.edges.config")}</dt>
            <dd className="font-mono">{t("sources.edges.configLine", { applied: edge.appliedConfigVersion ?? "–", desired: edge.desiredConfigVersion ?? "–" })}</dd>
            <dt className="text-muted">{t("sources.edges.cert")}</dt>
            <dd className="font-mono">{edge.certFingerprint ?? "–"}</dd>
          </dl>
        </Card>
      )}
      {tab === "config" && <ConfigVersions versions={versions} canAdmin={canAdmin} timezone={timezone} lang={i18n.language} />}
      {tab === "update" && <EdgeUpdatesPanel updates={updates} canAdmin={canAdmin} timezone={timezone} lang={i18n.language} />}
      {tab === "logs" && (
        <Card title={t("sources.edges.tab.logs")}>
          <p className="mb-2 text-[12.5px] text-muted">{t("sources.edges.logsHint")}</p>
          {actions.includes("collect-logs") && (
            <Form method="post" className="flex flex-wrap items-end gap-2">
              <CsrfField />
              <TextField label={t("sources.edges.minutes")} name="minutes" type="number" min={1} max={1440} defaultValue="60" />
              <Button type="submit" name="intent" value="collect-logs">
                {t("sources.edges.action.collect-logs")}
              </Button>
            </Form>
          )}
        </Card>
      )}
    </>
  );
}
