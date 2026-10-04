/**
 * UI-DSC-04 외부 맥락 데이터 — 사이트 카드(`/sources/context/{siteId}`, DSC-06.01·06.02·06.04·06.05).
 * API: GET /core/sites/{id}/context-sources(API-DSC-44 제안), PUT …/context-sources/{type}(API-DSC-45 제안),
 * 호출량 GET /core/sources/{id}/api-usage?days=90(API-DSC-40), 지금 갱신 POST /core/sources/{id}/refresh-now(API-DSC-41),
 * 측정소 GET /core/external/airkorea-stations(API-DSC-42, SRC_ADMIN), iCal 파일 POST /core/sources/ical/upload(API-DSC-43).
 * 조회 SRC_READ(OPERATOR+), 설정 SRC_ADMIN(INTEGRATOR+).
 */
import { useTranslation } from "react-i18next";
import { Link, data, useRouteLoaderData } from "react-router";
import { callApi, field } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { getMe } from "~/bff/user.server";
import { Alert, Card, PageHeader } from "~/components/ui";
import { ContextCards, UsageBars, type ContextResult } from "~/features/context/components/context-cards";
import { checkContextInput, checkIcsFile, serverFieldCode, typeMappingBody, type SiteContext, type Station, type UsageDay } from "~/features/context/model/context";
import { IngestTabs } from "~/features/sources/components/common";
import { resolveTimezone, zonedDate } from "~/lib/format";
import { hasAny } from "~/lib/permissions";
import type { RootData } from "~/root";
import type { Route } from "./+types/sources-context-site";

export function meta() {
  return [{ title: "data2flow" }];
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const ctx = bff(context);
  const siteId = encodeURIComponent(params.siteId);
  const [site, me] = await Promise.all([callApi<SiteContext>(ctx, request, `/api/v1/core/sites/${siteId}/context-sources`), getMe(ctx, request)]);
  if (!site.ok) throw data({ code: site.code }, { status: site.status === 401 ? 401 : site.status });
  const permissions = me.ok ? me.data.permissions : [];
  const canAdmin = hasAny(permissions, ["SRC_ADMIN"]);
  const timezone = resolveTimezone(me.ok ? me.data.timezone : undefined);
  const located = site.data.latitude !== null && site.data.latitude !== undefined && site.data.longitude !== null && site.data.longitude !== undefined;
  const withSource = site.data.sources.filter((s) => s.sourceId);
  const [stations, ...usages] = await Promise.all([
    canAdmin && located ? callApi<Station[]>(ctx, request, `/api/v1/core/external/airkorea-stations?lat=${site.data.latitude}&lng=${site.data.longitude}`) : Promise.resolve(null),
    ...withSource.map((s) => callApi<UsageDay[]>(ctx, request, `/api/v1/core/sources/${encodeURIComponent(String(s.sourceId))}/api-usage?days=90`)),
  ]);
  return {
    site: site.data,
    stations: stations?.ok ? (stations.data ?? []) : [],
    usage: withSource.map((s, i) => ({ type: String(s.type), days: usages[i].ok ? (usages[i].data ?? []) : [], failed: !usages[i].ok })),
    today: zonedDate(ctx.runtime.now(), timezone),
  };
}

function parseRows(raw: string): { category: string; type: string }[] {
  try {
    const rows = JSON.parse(raw || "[]") as unknown;
    return Array.isArray(rows) ? (rows as { category: string; type: string }[]) : [];
  } catch {
    return [];
  }
}

const optionalNumber = (raw: string) => (raw.trim() === "" ? null : Number(raw));

function failure(type: string, intent: string, result: { code: string; message: string; status: number; errors?: { field: string; code: string }[] }) {
  const fieldErrors = Object.fromEntries((result.errors ?? []).map((e) => [e.field, serverFieldCode(e.field, e.code)]));
  return data({ intent, type, error: { code: result.code, message: result.message }, fieldErrors } as ContextResult, { status: result.status });
}

export async function action({ request, context, params }: Route.ActionArgs) {
  const ctx = bff(context);
  const form = await request.formData();
  const intent = field(form, "intent");
  const type = field(form, "type");
  if (intent === "refresh") {
    const result = await callApi<{ status: string; added: number; updated: number; removed: number; error?: string | null }>(ctx, request, `/api/v1/core/sources/${encodeURIComponent(field(form, "sourceId"))}/refresh-now`, { method: "POST" });
    return result.ok ? ({ intent, type, ok: true, refresh: result.data } as ContextResult) : failure(type, intent, result);
  }
  if (intent !== "save" || !["KMA_WEATHER", "AIRKOREA", "HOLIDAY", "ICAL"].includes(type)) return data({ intent, type, error: { code: "INVALID_REQUEST" } } as ContextResult, { status: 400 });
  const enabled = field(form, "enabled") === "true";
  const apiKey = field(form, "apiKey").trim();
  const body: Record<string, unknown> = { enabled };
  if (apiKey) body.apiKey = apiKey;
  const file = form.get("file");
  const hasFile = file instanceof File && file.size > 0;
  const errors = checkContextInput(type, {
    enabled,
    apiKey,
    // 이미 저장된 키가 있는지는 서버가 판단한다(없으면 400 apiKey NotBlank)
    apiKeyConfigured: true,
    url: field(form, "url"),
    hasFile,
    fileObjectKey: "stored",
    nx: field(form, "nx"),
    ny: field(form, "ny"),
    refreshHours: field(form, "refreshHours"),
    dailyQuota: field(form, "dailyQuota"),
    unitCost: field(form, "unitCost"),
  });
  if (hasFile && checkIcsFile({ name: (file as File).name, size: (file as File).size })) errors.file = checkIcsFile({ name: (file as File).name, size: (file as File).size })!;
  if (Object.keys(errors).length) return data({ intent, type, fieldErrors: errors } as ContextResult, { status: 400 });
  if (type === "KMA_WEATHER") {
    if (field(form, "nx").trim()) body.nx = Number(field(form, "nx"));
    if (field(form, "ny").trim()) body.ny = Number(field(form, "ny"));
    body.items = form.getAll("items").map(String);
    body.forecast = field(form, "forecast") === "true";
  } else if (type === "AIRKOREA") {
    const station = field(form, "stationName").trim();
    if (station) body.stationName = station;
    body.items = form.getAll("items").map(String);
  } else if (type === "HOLIDAY") {
    body.countryCode = field(form, "countryCode") || "KR";
  } else {
    const url = field(form, "url").trim();
    if (url) body.url = url;
    if (hasFile) {
      const upload = new FormData();
      upload.set("file", file as File, (file as File).name);
      const uploaded = await callApi<{ fileObjectKey: string; categories?: string[] }>(ctx, request, "/api/v1/core/sources/ical/upload", { method: "POST", rawBody: upload });
      if (!uploaded.ok) return failure(type, intent, uploaded);
      body.fileObjectKey = uploaded.data.fileObjectKey;
    }
    body.typeMapping = typeMappingBody(parseRows(field(form, "typeMapping")));
    if (field(form, "refreshHours").trim()) body.refreshHours = Number(field(form, "refreshHours"));
  }
  if (form.has("dailyQuota")) body.dailyQuota = optionalNumber(field(form, "dailyQuota"));
  if (form.has("unitCost")) body.unitCost = optionalNumber(field(form, "unitCost"));
  const result = await callApi(ctx, request, `/api/v1/core/sites/${encodeURIComponent(params.siteId)}/context-sources/${type}`, { method: "PUT", body });
  return result.ok ? ({ intent, type, ok: true } as ContextResult) : failure(type, intent, result);
}

export default function SourcesContextSite({ loaderData, actionData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const root = useRouteLoaderData("root") as RootData | undefined;
  const canAdmin = hasAny(root?.me?.permissions, ["SRC_ADMIN"]);
  const { site, stations, usage, today } = loaderData;
  return (
    <>
      <PageHeader crumb={<Link to="/sources/context">{t("context.title")}</Link>} title={t("context.siteTitle", { name: site.siteName })} />
      <IngestTabs current="context" />
      {actionData && "fieldErrors" in actionData && actionData.fieldErrors && Object.keys(actionData.fieldErrors).length > 0 && !actionData.error && <Alert tone="danger">{t("context.fixErrors")}</Alert>}
      <ContextCards key={JSON.stringify(site.sources.map((s) => s.version))} site={site} stations={stations} canAdmin={canAdmin} result={actionData as ContextResult | undefined} timezone={root?.timezone ?? "Asia/Seoul"} lang={i18n.language} />
      <div className="mt-4">
        <Card title={t("context.usageTitle")}>
          {usage.length === 0 ? (
            <p className="text-[13px] text-muted">{t("context.noUsage")}</p>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {usage.map((u) => (
                <div key={u.type}>
                  <UsageBars title={t(`context.type.${u.type}`)} days={u.days} today={today} lang={i18n.language} />
                  {u.failed && <p className="text-[12px] text-warn">{t("context.usageFailed")}</p>}
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
