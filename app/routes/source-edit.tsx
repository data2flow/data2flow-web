/**
 * UI-DSC-08/02 소스 설정 편집(DSC-01.01·01.04·01.06·01.07, DSC-09.04). 편집 SRC_ADMIN, OPERATOR는 읽기 전용(비밀값은 지문만).
 * 저장: API-DSC-04 PATCH + baseVersion(불일치 409 VERSION_CONFLICT → 새로 고침 안내). ACTIVE면 이 소스 연결만 다시 맺는다(BR-DSC-05).
 * 연결 테스트: API-DSC-57 기존 소스 경로(`/sources/{id}/test`, 저장된 비밀값 사용).
 */
import { useTranslation } from "react-i18next";
import { data, redirect } from "react-router";
import { callApi, field, orThrow } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { getMe } from "~/bff/user.server";
import { PageHeader } from "~/components/ui";
import { hasAny } from "~/lib/permissions";
import { IngestTabs } from "~/features/sources/components/common";
import { SourceForm } from "~/features/sources/components/source-form";
import { formFromSource, updateBody, type SourceDetail } from "~/features/sources/model/source";
import { loadChoices, readPayload } from "./sources-form.server";
import type { Route } from "./+types/source-edit";

export function meta() {
  return [{ title: "data2flow" }];
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const ctx = bff(context);
  const id = encodeURIComponent(params.sourceId);
  const [source, choices, me] = await Promise.all([callApi<SourceDetail>(ctx, request, `/api/v1/core/sources/${id}`), loadChoices(ctx, request), getMe(ctx, request)]);
  const detail = orThrow(source);
  const canAdmin = me.ok && hasAny(me.data.permissions, ["SRC_ADMIN"]);
  return { ...choices, source: detail, initial: formFromSource(detail), readOnly: !canAdmin || detail.lifecycle === "ARCHIVED" };
}

export async function action({ request, context, params }: Route.ActionArgs) {
  const ctx = bff(context);
  const form = await request.formData();
  const values = readPayload(form, { editing: true, secretConfigured: true });
  if (!values) return data({ error: { code: "INVALID_REQUEST" } }, { status: 400 });
  const id = encodeURIComponent(params.sourceId);
  const result = await callApi(ctx, request, `/api/v1/core/sources/${id}`, { method: "PATCH", body: { ...updateBody(values), baseVersion: Number(field(form, "baseVersion")) } });
  if (!result.ok) return data({ error: { code: result.code, message: result.message }, errors: result.errors ?? [] }, { status: result.status });
  return redirect(`/sources/${id}?tab=settings&saved=1`);
}

export default function SourceEdit({ loaderData, actionData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const { source, initial, models, spaces, scripts, readOnly } = loaderData;
  return (
    <>
      <IngestTabs current="sources" />
      <PageHeader crumb={t("sources.list.title")} title={t("sources.edit.title", { name: source.name })} />
      <SourceForm
        initial={initial}
        mode="edit"
        readOnly={readOnly}
        secretConfigured={Boolean(source.secret?.configured)}
        secretFingerprint={source.secret?.fingerprint}
        baseVersion={source.version}
        models={models}
        spaces={spaces}
        scripts={scripts}
        testPath={`/bff/api/core/sources/${encodeURIComponent(source.id)}/test`}
        serverError={actionData?.error ?? null}
        serverFieldErrors={(actionData as { errors?: { field: string; code: string; message: string }[] } | undefined)?.errors}
      />
    </>
  );
}
