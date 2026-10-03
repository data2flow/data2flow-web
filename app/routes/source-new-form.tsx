/**
 * UI-DSC-08 커넥터 설정 폼 — 새 소스 2단계(+ UI-DSC-09 연결 테스트 패널). DSC-01.01·01.02·01.04·01.06·01.07, DSC-09.04.
 * 템플릿(`?template=`)을 고르면 API-DSC-56 preset으로 미리 채운다. 저장: API-DSC-02(Idempotency-Key, [저장 후 활성화]는 activate=true).
 */
import { useTranslation } from "react-i18next";
import { data, redirect } from "react-router";
import { callApi, field, newIdempotencyKey } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { PageHeader } from "~/components/ui";
import { IngestTabs } from "~/features/sources/components/common";
import { SourceForm } from "~/features/sources/components/source-form";
import { createBody, emptyForm, typeOfConnector, type SourceFormValues } from "~/features/sources/model/source";
import { loadChoices, readPayload } from "./sources-form.server";
import type { Route } from "./+types/source-new-form";

export function meta() {
  return [{ title: "data2flow" }];
}

interface TemplatePreset {
  name?: string;
  preset?: { connection?: Record<string, unknown>; topics?: { topic: string; qos: number }[]; decoderKey?: string; decoderConfig?: unknown };
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const ctx = bff(context);
  const connectorKey = params.connectorKey;
  const type = typeOfConnector(connectorKey);
  const url = new URL(request.url);
  const templateKey = url.searchParams.get("template");
  const [choices, template] = await Promise.all([loadChoices(ctx, request), templateKey ? callApi<TemplatePreset>(ctx, request, `/api/v1/core/connector-templates/${encodeURIComponent(templateKey)}`) : Promise.resolve(null)]);
  let initial: SourceFormValues = emptyForm(type, connectorKey);
  if (template?.ok && template.data?.preset) {
    const p = template.data.preset;
    const c = p.connection ?? {};
    initial = {
      ...initial,
      url: typeof c.url === "string" ? c.url : initial.url,
      auth: typeof c.auth === "string" ? c.auth : initial.auth,
      headerName: typeof c.headerName === "string" ? c.headerName : initial.headerName,
      topics: p.topics?.length ? p.topics : initial.topics,
      decoderKey: p.decoderKey ?? initial.decoderKey,
      decoderConfig: p.decoderConfig ? JSON.stringify(p.decoderConfig, null, 2) : initial.decoderConfig,
    };
  }
  return { ...choices, initial, connectorKey, templateName: template?.ok ? (template.data?.name ?? null) : null, idempotencyKey: newIdempotencyKey(), supported: type !== "CONNECTOR" };
}

export async function action({ request, context }: Route.ActionArgs) {
  const ctx = bff(context);
  const form = await request.formData();
  const intent = field(form, "intent");
  const values = readPayload(form, { editing: false });
  if (!values) return data({ error: { code: "INVALID_REQUEST" } }, { status: 400 });
  const result = await callApi<{ id: string }>(ctx, request, "/api/v1/core/sources", { method: "POST", idempotencyKey: field(form, "idempotencyKey") || newIdempotencyKey(), body: createBody(values, intent === "activate") });
  if (!result.ok) return data({ error: { code: result.code, message: result.message }, errors: result.errors ?? [] }, { status: result.status });
  return redirect(`/sources/${encodeURIComponent(result.data.id)}${intent === "activate" ? "?tab=status" : "?tab=settings"}`);
}

export default function SourceNewForm({ loaderData, actionData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const { initial, models, spaces, scripts, idempotencyKey, templateName, supported } = loaderData;
  return (
    <>
      <IngestTabs current="sources" />
      <PageHeader crumb={t("sources.new.title")} title={templateName ? t("sources.new.withTemplate", { type: t(`sources.type.${initial.type}`, { defaultValue: initial.type }), template: templateName }) : t(`sources.type.${initial.type}`, { defaultValue: initial.connectorKey })} />
      {!supported ? (
        <p className="text-[13px] text-muted">{t("sources.new.unsupported")}</p>
      ) : (
        <SourceForm
          initial={initial}
          mode="create"
          models={models}
          spaces={spaces}
          scripts={scripts}
          idempotencyKey={idempotencyKey}
          testPath="/bff/api/core/sources/test"
          serverError={actionData?.error ?? null}
          serverFieldErrors={(actionData as { errors?: { field: string; code: string; message: string }[] } | undefined)?.errors}
        />
      )}
    </>
  );
}
