/**
 * UI-CMP-02 기준 프로필 상세(`/compliance/profiles/{id}?tab=criteria|versions|applications&version=`, CMP-01.01~01.04).
 * 시스템 프로필은 읽기 전용 + [복제해 수정]. 지난 버전은 `?version=n`으로 본다(안내 띠).
 * [적용 범위] 탭이 UI-CMP-04: 적용 목록·측정 가능성(API-CMP-08)·적용 추가(API-CMP-07)·해제(규칙은 그대로 둔다).
 * API: 상세 API-CMP-02, 버전 API-CMP-03, 복제 API-CMP-06, 보관·해제 API-CMP-06a, 적용 API-CMP-07.
 */
import { useTranslation } from "react-i18next";
import { Form, useRouteLoaderData } from "react-router";
import { callApi, callList, field, newIdempotencyKey, orThrow } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { getMe } from "~/bff/user.server";
import { Alert, Button, ButtonLink, Card, CsrfField, PageHeader, Tabs } from "~/components/ui";
import { ApplicationsPanel } from "~/features/compliance/components/applications-panel";
import { CloneDialog, CriteriaView, KindBadge, VersionsView, useCloneDialog } from "~/features/compliance/components/profile-views";
import type { Application, MeasurabilityItem, ProfileDetail, ProfileVersion, VersionSummary } from "~/features/compliance/model/types";
import { TARGET_TYPES } from "~/features/compliance/model/types";
import { cloneProfile, failed, invalid, type ComplianceActionResult } from "~/features/compliance/server";
import { errorText } from "~/lib/error-text";
import { resolveTimezone } from "~/lib/format";
import { hasAny } from "~/lib/permissions";
import type { SpaceNode } from "~/lib/spaces";
import type { RootData } from "~/root";
import type { Route } from "./+types/compliance-profile-detail";

const TABS = ["criteria", "versions", "applications"] as const;
type Tab = (typeof TABS)[number];

export function meta() {
  return [{ title: "data2flow" }];
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const ctx = bff(context);
  const url = new URL(request.url);
  const tabParam = url.searchParams.get("tab");
  const tab: Tab = (TABS as readonly string[]).includes(tabParam ?? "") ? (tabParam as Tab) : "criteria";
  const base = `/api/v1/core/compliance/profiles/${encodeURIComponent(params.profileId)}`;
  const [profile, me] = await Promise.all([callApi<ProfileDetail>(ctx, request, base), getMe(ctx, request)]);
  const detail = orThrow(profile);
  const wanted = Number(url.searchParams.get("version"));
  const older = Number.isInteger(wanted) && wanted > 0 && wanted !== detail.currentVersionNo ? wanted : null;
  const [shown, metrics, versions, applications, spaces] = await Promise.all([
    older && tab === "criteria" ? callApi<ProfileVersion>(ctx, request, `${base}/versions/${older}`) : null,
    tab === "criteria" ? callList<{ key: string; displayName?: string }>(ctx, request, "/api/v1/core/metrics?size=100") : null,
    tab === "versions" ? callApi<VersionSummary[]>(ctx, request, `${base}/versions`) : null,
    tab === "applications" ? callList<Application>(ctx, request, `/api/v1/core/compliance/applications?profileId=${encodeURIComponent(detail.profileId)}&size=100`) : null,
    tab === "applications" ? callApi<SpaceNode[]>(ctx, request, "/api/v1/core/spaces") : null,
  ]);
  const apps = applications?.ok ? applications.list.responses : [];
  // 항목별 측정 가능성(API-CMP-08)은 적용마다 따로 부른다. 실패한 적용은 요약 수만 보여 준다
  const measured = await Promise.all(
    apps.slice(0, 20).map(async (a) => {
      const r = await callApi<MeasurabilityItem[]>(ctx, request, `/api/v1/core/compliance/applications/${encodeURIComponent(a.applicationId)}/measurability`);
      return [a.applicationId, r.ok ? r.data : undefined] as const;
    }),
  );
  return {
    tab,
    profile: detail,
    version: shown?.ok ? shown.data : detail.currentVersion,
    olderMissing: Boolean(shown && !shown.ok),
    metricNames: Object.fromEntries((metrics?.ok ? metrics.list.responses : []).map((m) => [m.key, m.displayName ?? m.key])),
    versions: versions?.ok ? versions.data : [],
    applications: apps,
    applicationsFailed: applications && !applications.ok ? { code: applications.code, message: applications.message } : null,
    measurability: Object.fromEntries(measured.filter(([, items]) => items)) as Record<string, MeasurabilityItem[]>,
    spaces: spaces?.ok ? spaces.data : [],
    timezone: resolveTimezone(me.ok ? me.data.timezone : undefined),
    idempotencyKey: newIdempotencyKey(),
  };
}

export async function action({ request, context, params }: Route.ActionArgs) {
  const ctx = bff(context);
  const form = await request.formData();
  const intent = field(form, "intent");
  const base = `/api/v1/core/compliance/profiles/${encodeURIComponent(params.profileId)}`;
  switch (intent) {
    case "clone":
      return cloneProfile(ctx, request, form);
    case "archive":
    case "unarchive": {
      const result = await callApi(ctx, request, `${base}/${intent}`, { method: "POST" });
      return result.ok ? ({ intent, done: true } satisfies ComplianceActionResult) : failed(intent, result);
    }
    case "apply": {
      const targetType = field(form, "targetType");
      if (!(TARGET_TYPES as readonly string[]).includes(targetType)) return invalid(intent, { targetType: "required" });
      const targetSpaceId = targetType === "SPACE_USAGE" ? null : field(form, "targetSpaceId") || null;
      if (targetType !== "SPACE_USAGE" && !targetSpaceId) return invalid(intent, { targetSpaceId: "spaceRequired" });
      const pin = Number(field(form, "pinVersion"));
      const body = {
        profileId: params.profileId,
        pinnedVersionNo: pin > 0 ? pin : null,
        targetType,
        targetSpaceId,
        targetUsage: targetType === "SPACE_USAGE" ? field(form, "targetUsage") : null,
        includeDescendants: targetType === "SPACE" ? field(form, "includeDescendants") === "true" : targetType === "SITE",
        facilityType: field(form, "facilityType") || null,
      };
      const result = await callApi(ctx, request, "/api/v1/core/compliance/applications", { method: "POST", body, idempotencyKey: field(form, "idempotencyKey") || newIdempotencyKey() });
      if (result.ok) return { intent, done: true } satisfies ComplianceActionResult;
      if (result.code === "CMP_FACILITY_TYPE_REQUIRED") return failed(intent, result, { facilityType: "facilityRequired" });
      return failed(intent, result);
    }
    case "unapply": {
      // 해제해도 이 적용으로 만든 규칙은 그대로 둔다(규칙 정리는 규칙 화면에서)
      const id = encodeURIComponent(field(form, "applicationId"));
      const result = await callApi(ctx, request, `/api/v1/core/compliance/applications/${id}?deactivateRules=false`, { method: "DELETE" });
      return result.ok ? ({ intent, done: true } satisfies ComplianceActionResult) : failed(intent, result);
    }
    default:
      return invalid(intent || "unknown", {});
  }
}

export default function ComplianceProfileDetail({ loaderData, actionData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const root = useRouteLoaderData("root") as RootData | undefined;
  const canAdmin = hasAny(root?.me?.permissions, ["CMP_ADMIN"]);
  const { tab, profile, version, olderMissing, metricNames, versions, applications, applicationsFailed, measurability, spaces, timezone } = loaderData;
  const result = actionData as ComplianceActionResult | undefined;
  const clone = useCloneDialog();
  const system = profile.kind === "SYSTEM";
  const path = `/compliance/profiles/${profile.profileId}`;
  const viewingOlder = version.versionNo !== profile.currentVersionNo;
  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            {profile.name} <KindBadge kind={profile.kind} />
          </span>
        }
        crumb={t("nav.compliance")}
        id={`v${profile.currentVersionNo}`}
        actions={
          canAdmin && (
            <div className="flex gap-2">
              <Button type="button" onClick={() => clone.open(profile)}>
                {t("compliance.clone.open")}
              </Button>
              {!system && !profile.archived && <ButtonLink to={`${path}/edit`}>{t("compliance.detail.edit")}</ButtonLink>}
              {!system && (
                <Form method="post">
                  <CsrfField />
                  <input type="hidden" name="intent" value={profile.archived ? "unarchive" : "archive"} />
                  <Button type="submit">{profile.archived ? t("compliance.detail.unarchive") : t("compliance.detail.archive")}</Button>
                </Form>
              )}
            </div>
          )
        }
      />
      {result?.error && result.intent !== "clone" && (
        <div className="mb-3">
          <Alert tone="danger">{errorText(t, result.error)}</Alert>
        </div>
      )}
      {system && (
        <div className="mb-3">
          <Alert tone="info">{t("compliance.detail.systemNote")}</Alert>
        </div>
      )}
      {profile.archived && (
        <div className="mb-3">
          <Alert tone="warning">{t("compliance.detail.archivedNote")}</Alert>
        </div>
      )}
      <Tabs items={TABS.map((key) => ({ key, label: t(`compliance.tabs.${key}`), to: `${path}?tab=${key}` }))} current={tab} />
      {tab === "criteria" && (
        <Card>
          {olderMissing && (
            <div className="mb-3">
              <Alert tone="warning">{t("compliance.detail.versionMissing")}</Alert>
            </div>
          )}
          {viewingOlder && (
            <div className="mb-3">
              <Alert tone="info">
                {t("compliance.detail.olderVersion", { n: version.versionNo, current: profile.currentVersionNo })} <ButtonLink to={path}>{t("compliance.detail.toCurrent")}</ButtonLink>
              </Alert>
            </div>
          )}
          <CriteriaView version={version} metricNames={metricNames} />
        </Card>
      )}
      {tab === "versions" && (
        <Card>
          <VersionsView profileId={profile.profileId} versions={versions} current={profile.currentVersionNo} timezone={timezone} />
        </Card>
      )}
      {tab === "applications" &&
        (applicationsFailed ? (
          <Alert tone="warning">{errorText(t, applicationsFailed)}</Alert>
        ) : (
          <Card>
            <ApplicationsPanel
              applications={applications}
              measurability={measurability}
              spaces={spaces}
              facilityTypes={profile.currentVersion.facilityTypes}
              facilityRequired={profile.currentVersion.facilityTypeRequired}
              currentVersion={profile.currentVersionNo}
              canAdmin={canAdmin}
              archived={profile.archived}
              timezone={timezone}
              fieldErrors={result?.intent === "apply" ? result.fieldErrors : undefined}
            />
          </Card>
        ))}
      {canAdmin && <CloneDialog source={clone.source} onClose={clone.close} error={result?.intent === "clone" ? (result.fieldErrors?.name ? t("compliance.validation.nameRequired") : result.error ? errorText(t, result.error) : undefined) : undefined} />}
    </>
  );
}
