/**
 * UI-CMP-01 기준 프로필 목록(`/compliance/profiles?kind=&keyword=&applied=&page=`, CMP-01.01·01.02). 조회 CMP_READ(VIEWER+),
 * [새 프로필]·[복제해 수정] CMP_ADMIN(ADMIN·INTEGRATOR). API: 목록 API-CMP-01, 복제 API-CMP-06.
 */
import { useTranslation } from "react-i18next";
import { Form, useRouteLoaderData, useSearchParams } from "react-router";
import { callList, field } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { getMe } from "~/bff/user.server";
import { Alert, Button, ButtonLink, Card, Checkbox, PageHeader, Pager, SelectField, TextField } from "~/components/ui";
import { CloneDialog, ProfileTable, useCloneDialog } from "~/features/compliance/components/profile-views";
import type { ProfileSummary } from "~/features/compliance/model/types";
import { cloneProfile, type ComplianceActionResult } from "~/features/compliance/server";
import { errorText } from "~/lib/error-text";
import { resolveTimezone } from "~/lib/format";
import { hasAny } from "~/lib/permissions";
import type { RootData } from "~/root";
import type { Route } from "./+types/compliance-profiles";

export function meta() {
  return [{ title: "data2flow" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = bff(context);
  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const query = new URLSearchParams({ page: String(page), size: "50" });
  for (const key of ["kind", "keyword", "applied"]) {
    const value = url.searchParams.get(key);
    if (value) query.set(key, value);
  }
  const [list, me] = await Promise.all([callList<ProfileSummary>(ctx, request, `/api/v1/core/compliance/profiles?${query}`), getMe(ctx, request)]);
  return {
    profiles: list.ok ? list.list.responses : [],
    totalPages: list.ok ? list.list.totalPages : undefined,
    page,
    failed: list.ok ? null : { code: list.code, message: list.message },
    timezone: resolveTimezone(me.ok ? me.data.timezone : undefined),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  if (field(form, "intent") === "clone") return cloneProfile(bff(context), request, form);
  return { intent: "unknown", error: { code: "INVALID_REQUEST" } } as ComplianceActionResult;
}

export default function ComplianceProfiles({ loaderData, actionData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const root = useRouteLoaderData("root") as RootData | undefined;
  const canAdmin = hasAny(root?.me?.permissions, ["CMP_ADMIN"]);
  const [params] = useSearchParams();
  const { profiles, totalPages, page, failed, timezone } = loaderData;
  const result = actionData as ComplianceActionResult | undefined;
  const clone = useCloneDialog();
  const organizationCount = profiles.filter((p) => p.kind === "ORGANIZATION").length;
  return (
    <>
      <PageHeader
        title={t("compliance.list.title")}
        crumb={t("nav.compliance")}
        actions={
          canAdmin && (
            <ButtonLink to="/compliance/profiles/new" variant="primary">
              {t("compliance.list.new")}
            </ButtonLink>
          )
        }
      />
      {result?.error && (
        <div className="mb-3">
          <Alert tone="danger">{errorText(t, result.error)}</Alert>
        </div>
      )}
      <Form method="get" className="mb-4 flex flex-wrap items-end gap-3">
        <SelectField label={t("compliance.list.kind")} name="kind" defaultValue={params.get("kind") ?? ""}>
          <option value="">{t("common.all")}</option>
          <option value="SYSTEM">{t("compliance.kind.SYSTEM")}</option>
          <option value="ORGANIZATION">{t("compliance.kind.ORGANIZATION")}</option>
        </SelectField>
        <TextField label={t("compliance.list.keyword")} name="keyword" defaultValue={params.get("keyword") ?? ""} />
        <div className="pb-2">
          <Checkbox name="applied" value="true" defaultChecked={params.get("applied") === "true"} label={t("compliance.list.appliedOnly")} />
        </div>
        <Button type="submit">{t("common.filter")}</Button>
      </Form>
      {failed ? (
        <Alert tone="warning">
          {errorText(t, failed)} <ButtonLink to={`/compliance/profiles?${params}`}>{t("common.retry")}</ButtonLink>
        </Alert>
      ) : (
        <Card>
          {organizationCount === 0 && !params.get("kind") && profiles.length > 0 && <p className="mb-2 text-[12.5px] text-muted">{t("compliance.list.noOrganization")}</p>}
          <ProfileTable profiles={profiles} timezone={timezone} canAdmin={canAdmin} onClone={clone.open} />
          <Pager page={page} totalPages={totalPages} />
        </Card>
      )}
      {canAdmin && <CloneDialog source={clone.source} onClose={clone.close} error={result?.fieldErrors?.name ? t("compliance.validation.nameRequired") : undefined} />}
    </>
  );
}
