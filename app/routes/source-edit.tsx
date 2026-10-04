/**
 * UI-DSC-08/02 소스 설정 편집(DSC-01.01·01.04·01.06·01.07, DSC-07.05, DSC-09.04~09.06). 편집 SRC_ADMIN, OPERATOR는 읽기 전용(비밀값은 지문만).
 * 저장: API-DSC-04 PATCH + baseVersion(불일치 409 VERSION_CONFLICT → 새로 고침 안내). ACTIVE면 이 소스 연결만 다시 맺는다(BR-DSC-05).
 * 카탈로그 커넥터·Webhook 소스는 커넥터 스키마 폼(API-DSC-56)이고, 비밀값은 종류별로 API-DSC-58.
 * 복제 직후(`?cloned=1`)에는 비밀값이 복사되지 않았으니 다시 넣으라고 안내한다(BR-DSC-11, TC-DSC-192).
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
import { ConnectorSourceForm } from "~/features/sources/components/connector-source-form";
import { SourceForm } from "~/features/sources/components/source-form";
import { connectorFormFromSource, connectorUpdateBody, type ConnectorSourceDetail } from "~/features/sources/model/connector-source";
import { extraSecrets, formFromSource, updateBody, type SourceDetail } from "~/features/sources/model/source";
import { loadChoices, loadConnector, putSecrets, readConnectorPayload, readPayload } from "./sources-form.server";
import type { Route } from "./+types/source-edit";

export function meta() {
  return [{ title: "data2flow" }];
}

type Detail = SourceDetail & ConnectorSourceDetail & { secrets?: { kind: string; configured: boolean; fingerprint?: string | null; certificateExpiresAt?: string | null }[] | null };

const usesSchema = (type: string) => type === "CONNECTOR" || type === "WEBHOOK";
const keyOf = (s: Detail) => s.connectorKey ?? (s.type === "WEBHOOK" ? "webhook" : "");

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const ctx = bff(context);
  const id = encodeURIComponent(params.sourceId);
  const url = new URL(request.url);
  const [source, choices, me] = await Promise.all([callApi<Detail>(ctx, request, `/api/v1/core/sources/${id}`), loadChoices(ctx, request), getMe(ctx, request)]);
  const detail = orThrow(source);
  const canAdmin = me.ok && hasAny(me.data.permissions, ["SRC_ADMIN"]);
  const common = { ...choices, source: detail, readOnly: !canAdmin || detail.lifecycle === "ARCHIVED", cloned: url.searchParams.get("cloned") === "1", storedSecrets: detail.secrets ?? (detail.secret ? [{ kind: detail.secret.kind ?? "", configured: Boolean(detail.secret.configured), fingerprint: detail.secret.fingerprint ?? null }] : []) };
  if (usesSchema(detail.type)) {
    const connector = await loadConnector(ctx, request, keyOf(detail));
    if (connector) return { ...common, kind: "connector" as const, connector, initial: connectorFormFromSource(connector.schema, connector.connector.authMethods ?? [], detail), basic: null };
  }
  return { ...common, kind: "basic" as const, connector: null, initial: null, basic: formFromSource(detail) };
}

export async function action({ request, context, params }: Route.ActionArgs) {
  const ctx = bff(context);
  const form = await request.formData();
  const id = encodeURIComponent(params.sourceId);
  const baseVersion = Number(field(form, "baseVersion"));
  const current = await callApi<Detail>(ctx, request, `/api/v1/core/sources/${id}`);
  if (!current.ok) return data({ error: { code: current.code, message: current.message }, errors: [] }, { status: current.status });
  if (usesSchema(current.data.type)) {
    const connector = await loadConnector(ctx, request, keyOf(current.data));
    if (!connector) return data({ error: { code: "CONNECTOR_NOT_FOUND" }, errors: [] }, { status: 404 });
    const configured = (current.data.secrets ?? []).filter((s) => s.configured).map((s) => s.kind);
    const values = readConnectorPayload(form, connector, { editing: true, activate: false, configuredSecrets: configured });
    if (!values) return data({ error: { code: "INVALID_REQUEST" }, errors: [] }, { status: 400 });
    const result = await callApi(ctx, request, `/api/v1/core/sources/${id}`, { method: "PATCH", body: { ...connectorUpdateBody(connector.schema, values), baseVersion } });
    if (!result.ok) return data({ error: { code: result.code, message: result.message }, errors: result.errors ?? [] }, { status: result.status });
    const failed = await putSecrets(ctx, request, params.sourceId, Object.entries(values.secrets).filter(([, v]) => v.trim()).map(([kind, value]) => ({ kind, value })));
    return redirect(`/sources/${id}?tab=settings&saved=1${failed.length ? `&secretFailed=${encodeURIComponent(failed.map((f) => f.kind).join(","))}` : ""}`);
  }
  const values = readPayload(form, { editing: true, secretConfigured: true, maxTopics: 200 });
  if (!values) return data({ error: { code: "INVALID_REQUEST" }, errors: [] }, { status: 400 });
  const result = await callApi(ctx, request, `/api/v1/core/sources/${id}`, { method: "PATCH", body: { ...updateBody(values), baseVersion } });
  if (!result.ok) return data({ error: { code: result.code, message: result.message }, errors: result.errors ?? [] }, { status: result.status });
  await putSecrets(ctx, request, params.sourceId, extraSecrets(values));
  return redirect(`/sources/${id}?tab=settings&saved=1`);
}

export default function SourceEdit({ loaderData, actionData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const { source, models, spaces, scripts, readOnly, limits, cloned, storedSecrets } = loaderData;
  const result = actionData as { error?: { code: string; message?: string }; errors?: { field: string; code: string; message: string }[] } | undefined;
  return (
    <>
      <IngestTabs current="sources" />
      <PageHeader crumb={t("sources.list.title")} title={t("sources.edit.title", { name: source.name })} />
      {loaderData.kind === "connector" ? (
        <ConnectorSourceForm
          schema={loaderData.connector.schema}
          connector={loaderData.connector.connector}
          initial={loaderData.initial}
          mode="edit"
          readOnly={readOnly}
          storedSecrets={storedSecrets}
          baseVersion={source.version}
          models={models}
          spaces={spaces}
          scripts={scripts}
          testPath={`/bff/api/core/sources/${encodeURIComponent(source.id)}/test`}
          serverError={result?.error ?? null}
          serverFieldErrors={result?.errors}
          cloned={cloned}
        />
      ) : (
        <SourceForm
          initial={loaderData.basic}
          mode="edit"
          readOnly={readOnly}
          secretConfigured={Boolean(source.secret?.configured)}
          secretFingerprint={source.secret?.fingerprint}
          storedSecrets={storedSecrets}
          baseVersion={source.version}
          models={models}
          spaces={spaces}
          scripts={scripts}
          maxTopics={limits?.maxTopicsPerSource}
          testPath={`/bff/api/core/sources/${encodeURIComponent(source.id)}/test`}
          serverError={result?.error ?? null}
          serverFieldErrors={result?.errors}
          cloned={cloned}
        />
      )}
    </>
  );
}
