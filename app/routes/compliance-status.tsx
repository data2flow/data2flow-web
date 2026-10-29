/**
 * UI-CMP-06 준수 현황판(`/compliance/status?siteId=&profileId=&period=7|30|90|custom&from=&to=&open=spaceId:profileId`, CMP-02.01).
 * 조회 CMP_READ(VIEWER+). 기간 최대 400일(넘으면 core가 CMP_REPORT_PERIOD_INVALID). 펼친 줄은 일별 막대와 이탈 구간(API-CMP-14).
 * API: 현황 API-CMP-13, 공간 상세 API-CMP-14, CSV API-CMP-15(BFF 통과 링크).
 */
import { useTranslation } from "react-i18next";
import { Form, useRouteLoaderData, useSearchParams } from "react-router";
import { callApi, callList } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { getMe } from "~/bff/user.server";
import { Alert, Button, ButtonLink, Card, EmptyState, PageHeader, SelectField, TextField } from "~/components/ui";
import { StatusSummary, StatusTable } from "~/features/compliance/components/status-board";
import { PERIODS, resolvePeriod, todayIn, type SpaceStatus, type StatusView } from "~/features/compliance/model/status";
import type { ProfileSummary } from "~/features/compliance/model/types";
import type { SiteMapRow } from "~/features/spaces/model/site-map";
import { errorText } from "~/lib/error-text";
import { resolveTimezone } from "~/lib/format";
import type { RootData } from "~/root";
import type { Route } from "./+types/compliance-status";

export function meta() {
  return [{ title: "data2flow" }];
}

const sitesOf = (data: SiteMapRow[] | { sites?: SiteMapRow[] } | null | undefined): SiteMapRow[] => (Array.isArray(data) ? data : (data?.sites ?? []));

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = bff(context);
  const url = new URL(request.url);
  const me = await getMe(ctx, request);
  const timezone = resolveTimezone(me.ok ? me.data.timezone : undefined);
  const range = resolvePeriod(url.searchParams.get("period"), url.searchParams.get("from"), url.searchParams.get("to"), todayIn(timezone));
  const query = new URLSearchParams({ from: range.from, to: range.to });
  for (const key of ["siteId", "profileId"]) {
    const value = url.searchParams.get(key);
    if (value) query.set(key, value);
  }
  const open = url.searchParams.get("open");
  const [openSpace, openProfile] = open?.split(":") ?? [];
  const [status, sites, profiles, detail] = await Promise.all([
    callApi<StatusView>(ctx, request, `/api/v1/core/compliance/status?${query}`),
    callApi<SiteMapRow[] | { sites?: SiteMapRow[] }>(ctx, request, "/api/v1/core/sites/map"),
    callList<ProfileSummary>(ctx, request, "/api/v1/core/compliance/profiles?size=100&applied=true"),
    openSpace && openProfile
      ? callApi<SpaceStatus>(ctx, request, `/api/v1/core/compliance/status/spaces/${encodeURIComponent(openSpace)}?${new URLSearchParams({ profileId: openProfile, from: range.from, to: range.to })}`)
      : Promise.resolve(null),
  ]);
  return {
    status: status.ok ? status.data : null,
    failed: status.ok ? null : { code: status.code, message: status.message },
    sites: sites.ok ? sitesOf(sites.data) : [],
    profiles: profiles.ok ? profiles.list.responses : [],
    open: openSpace && openProfile ? open : null,
    detail: detail?.ok ? detail.data : null,
    range,
    csv: `/bff/api/core/compliance/status.csv?${query}`,
    timezone,
  };
}

export default function ComplianceStatus({ loaderData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const root = useRouteLoaderData("root") as RootData | undefined;
  const [params] = useSearchParams();
  const { status, failed, sites, profiles, open, detail, range, csv } = loaderData;
  const timezone = root?.timezone ?? loaderData.timezone;
  const linkFor = (key: string | null) => {
    const next = new URLSearchParams(params);
    if (key) next.set("open", key);
    else next.delete("open");
    return `/compliance/status?${next}`;
  };
  return (
    <>
      <PageHeader
        title={t("compliance.status.title")}
        crumb={t("nav.compliance")}
        actions={
          status && (
            <a href={csv} download className="text-[13px] text-accent hover:underline">
              {t("compliance.status.csv")}
            </a>
          )
        }
      />
      <Form method="get" className="mb-4 flex flex-wrap items-end gap-3">
        <SelectField label={t("compliance.status.site")} name="siteId" defaultValue={params.get("siteId") ?? ""}>
          <option value="">{t("common.all")}</option>
          {sites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </SelectField>
        <SelectField label={t("compliance.status.profile")} name="profileId" defaultValue={params.get("profileId") ?? ""}>
          <option value="">{t("common.all")}</option>
          {profiles.map((p) => (
            <option key={p.profileId} value={p.profileId}>
              {p.name}
            </option>
          ))}
        </SelectField>
        <SelectField label={t("compliance.status.period")} name="period" defaultValue={range.period}>
          {PERIODS.map((p) => (
            <option key={p} value={p}>
              {t(`compliance.status.periods.${p}`)}
            </option>
          ))}
        </SelectField>
        <TextField type="date" label={t("compliance.status.from")} name="from" defaultValue={range.from} />
        <TextField type="date" label={t("compliance.status.to")} name="to" defaultValue={range.to} />
        <Button type="submit">{t("common.filter")}</Button>
      </Form>
      {failed ? (
        <Alert tone="warning">
          {errorText(t, failed)} <ButtonLink to={`/compliance/status?${params}`}>{t("common.retry")}</ButtonLink>
        </Alert>
      ) : status && status.rows.length ? (
        <div className="flex flex-col gap-4">
          <StatusSummary summary={status.summary} />
          <Card>
            <StatusTable rows={status.rows} openKey={open} detail={detail} linkFor={linkFor} timezone={timezone} lang={i18n.language} />
          </Card>
        </div>
      ) : (
        <EmptyState title={t("compliance.status.empty")} body={t("compliance.status.emptyBody")} action={<ButtonLink to="/compliance/profiles">{t("compliance.area.profiles")}</ButtonLink>} />
      )}
    </>
  );
}
