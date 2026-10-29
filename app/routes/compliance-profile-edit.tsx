/**
 * UI-CMP-03 기준 프로필 만들기·편집(`/compliance/profiles/new`, `/compliance/profiles/{id}/edit`, CMP-01.01). CMP_ADMIN만.
 * 현재 버전이 잠기지 않았으면(적용·보고서에 쓰인 적 없음) 그 버전을 고치고(PUT), 잠겼으면 새 버전으로 저장한다(POST, 변경 메모 필수).
 * 시스템 프로필은 고칠 수 없어 상세로 돌려보낸다([복제해 수정]을 쓴다).
 * API: 생성 API-CMP-04, 버전 추가·수정 API-CMP-05(baseVersion).
 */
import { useTranslation } from "react-i18next";
import { redirect } from "react-router";
import { callApi, callList, field, newIdempotencyKey, orThrow, requirePermission } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { getMe } from "~/bff/user.server";
import { PageHeader } from "~/components/ui";
import { ProfileEditor, type EditorMode, type MetricOption } from "~/features/compliance/components/profile-editor";
import { checkDraft, draftFrom, emptyDraft, parseDraft, versionBody } from "~/features/compliance/model/profile-form";
import type { ProfileDetail } from "~/features/compliance/model/types";
import { editorFieldErrors, failed, invalid, type ComplianceActionResult } from "~/features/compliance/server";
import { errorText } from "~/lib/error-text";
import type { Route } from "./+types/compliance-profile-edit";

export function meta() {
  return [{ title: "data2flow" }];
}

function modeOf(profile: ProfileDetail): EditorMode {
  return profile.currentVersion.locked ? "version" : "update";
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const ctx = bff(context);
  const me = await getMe(ctx, request);
  requirePermission(me.ok ? me.data.permissions : [], "CMP_ADMIN");
  const [metrics, profile] = await Promise.all([
    callList<MetricOption>(ctx, request, "/api/v1/core/metrics?size=100"),
    params.profileId ? callApi<ProfileDetail>(ctx, request, `/api/v1/core/compliance/profiles/${encodeURIComponent(params.profileId)}`) : null,
  ]);
  const detail = profile ? orThrow(profile) : null;
  if (detail && (detail.kind === "SYSTEM" || detail.archived)) throw redirect(`/compliance/profiles/${detail.profileId}`);
  const mode: EditorMode = detail ? modeOf(detail) : "create";
  const initial = detail ? { ...draftFrom(detail.currentVersion, detail.name), changeNote: mode === "update" ? (detail.currentVersion.changeNote ?? "") : "" } : emptyDraft();
  return {
    mode,
    profile: detail ? { profileId: detail.profileId, name: detail.name, version: detail.version, currentVersionNo: detail.currentVersionNo } : null,
    initial,
    metrics: metrics.ok ? metrics.list.responses.map((m) => ({ key: m.key, displayName: m.displayName, unit: m.unit })) : [],
    idempotencyKey: newIdempotencyKey(),
  };
}

export async function action({ request, context, params }: Route.ActionArgs) {
  const ctx = bff(context);
  const form = await request.formData();
  const draft = parseDraft(field(form, "payload"));
  if (!draft) return invalid("save", { payload: "required" });
  const mode = (params.profileId ? field(form, "mode") : "create") as EditorMode;
  const errors = checkDraft(draft, mode);
  if (Object.keys(errors).length) return invalid("save", errors);
  const body = versionBody(draft);
  const baseVersion = Number(field(form, "baseVersion"));
  const idempotencyKey = field(form, "idempotencyKey") || newIdempotencyKey();
  if (!params.profileId) {
    const result = await callApi<ProfileDetail>(ctx, request, "/api/v1/core/compliance/profiles", { method: "POST", body: { name: draft.name.trim(), version: body }, idempotencyKey });
    if (!result.ok) return failed("save", result, editorFieldErrors(draft, result));
    throw redirect(`/compliance/profiles/${result.data.profileId}`);
  }
  const base = `/api/v1/core/compliance/profiles/${encodeURIComponent(params.profileId)}/versions`;
  const versionNo = Number(field(form, "versionNo"));
  const result =
    mode === "update"
      ? await callApi(ctx, request, `${base}/${versionNo}`, { method: "PUT", body: { ...body, baseVersion } })
      : await callApi(ctx, request, base, { method: "POST", body: { ...body, baseVersion }, idempotencyKey });
  if (!result.ok) return failed("save", result, editorFieldErrors(draft, result));
  throw redirect(`/compliance/profiles/${encodeURIComponent(params.profileId)}`);
}

export default function ComplianceProfileEdit({ loaderData, actionData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const { mode, profile, initial, metrics, idempotencyKey } = loaderData;
  const result = actionData as ComplianceActionResult | undefined;
  const title = profile ? t(mode === "version" ? "compliance.editor.newVersionTitle" : "compliance.editor.editTitle", { name: profile.name, n: profile.currentVersionNo }) : t("compliance.editor.createTitle");
  return (
    <>
      <PageHeader title={title} crumb={t("nav.compliance")} />
      {mode === "version" && <p className="mb-3 text-[12.5px] text-muted">{t("compliance.editor.lockedNote", { n: profile?.currentVersionNo })}</p>}
      <ProfileEditor
        key={profile ? `${profile.profileId}:${profile.version}` : "new"}
        mode={mode}
        initial={initial}
        metrics={metrics}
        serverErrors={result?.fieldErrors}
        error={result?.error ? errorText(t, result.error) : undefined}
        cancelTo={profile ? `/compliance/profiles/${profile.profileId}` : "/compliance/profiles"}
        baseVersion={profile?.version}
        versionNo={profile?.currentVersionNo}
        idempotencyKey={idempotencyKey}
      />
    </>
  );
}
