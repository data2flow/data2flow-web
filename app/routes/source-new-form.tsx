/**
 * UI-DSC-08 커넥터 설정 폼 — 새 소스 2단계(+ UI-DSC-09 연결 테스트 패널). DSC-01.01·01.02·01.03·01.04·01.06·01.07, DSC-09.01·09.04~09.08·09.11·09.12.
 * 기본 유형(MQTT 구독·플랫폼 브로커·가상 환경)은 전용 폼, 그 밖의 카탈로그 커넥터(22종)와 Webhook 수신은 커넥터 스키마(API-DSC-56)로 만든 폼.
 * 템플릿(`?template=`)을 고르면 API-DSC-56 preset으로 미리 채운다. 저장: API-DSC-02(Idempotency-Key, [저장 후 활성화]는 activate=true),
 * 한 요청에 못 넣은 비밀값은 저장 뒤 API-DSC-58로. Webhook은 만든 응답의 수신 URL·HMAC 비밀값을 이 화면에서 한 번만 보여 준다.
 */
import { useTranslation } from "react-i18next";
import { data, redirect } from "react-router";
import { callApi, field, newIdempotencyKey } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { Alert, PageHeader } from "~/components/ui";
import { IngestTabs } from "~/features/sources/components/common";
import { ConnectorSourceForm } from "~/features/sources/components/connector-source-form";
import { SourceForm } from "~/features/sources/components/source-form";
import { WebhookCreated } from "~/features/sources/components/webhook-created";
import { connectorCreateBody, emptyConnectorForm, type TemplatePresetLike } from "~/features/sources/model/connector-source";
import { CONNECTOR_TYPES, createBody, emptyForm, extraSecrets, mqttFromPreset, typeOfConnector, type MqttPreset } from "~/features/sources/model/source";
import { loadChoices, loadConnector, putSecrets, readConnectorPayload, readPayload } from "./sources-form.server";
import type { Route } from "./+types/source-new-form";

export function meta() {
  return [{ title: "data2flow" }];
}

interface TemplatePreset {
  name?: string;
  connectorKey?: string;
  preset?: MqttPreset;
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const ctx = bff(context);
  const connectorKey = params.connectorKey;
  const basic = connectorKey in CONNECTOR_TYPES;
  const url = new URL(request.url);
  const templateKey = url.searchParams.get("template");
  const [choices, template, connector] = await Promise.all([
    loadChoices(ctx, request),
    templateKey ? callApi<TemplatePreset>(ctx, request, `/api/v1/core/connector-templates/${encodeURIComponent(templateKey)}`) : Promise.resolve(null),
    basic ? Promise.resolve(null) : loadConnector(ctx, request, connectorKey),
  ]);
  const preset = template?.ok ? (template.data?.preset ?? null) : null;
  const templateName = template?.ok ? (template.data?.name ?? null) : null;
  const common = { ...choices, connectorKey, templateName, idempotencyKey: newIdempotencyKey() };
  if (basic) {
    const type = typeOfConnector(connectorKey);
    const initial = preset ? mqttFromPreset(emptyForm(type, connectorKey), preset) : emptyForm(type, connectorKey);
    return { ...common, kind: "basic" as const, initial, connector: null };
  }
  if (!connector) return { ...common, kind: "unsupported" as const, initial: null, connector: null };
  return { ...common, kind: "connector" as const, initial: emptyConnectorForm(connector.schema, connector.connector.authMethods ?? [], preset as TemplatePresetLike | null), connector };
}

export async function action({ request, context, params }: Route.ActionArgs) {
  const ctx = bff(context);
  const form = await request.formData();
  const intent = field(form, "intent");
  const idem = field(form, "idempotencyKey") || newIdempotencyKey();
  if (params.connectorKey in CONNECTOR_TYPES) {
    const values = readPayload(form, { editing: false, maxTopics: 200 });
    if (!values) return data({ error: { code: "INVALID_REQUEST" } }, { status: 400 });
    const result = await callApi<{ id: string }>(ctx, request, "/api/v1/core/sources", { method: "POST", idempotencyKey: idem, body: createBody(values, intent === "activate") });
    if (!result.ok) return data({ error: { code: result.code, message: result.message }, errors: result.errors ?? [] }, { status: result.status });
    await putSecrets(ctx, request, String(result.data.id), extraSecrets(values));
    return redirect(`/sources/${encodeURIComponent(result.data.id)}${intent === "activate" ? "?tab=status" : "?tab=settings"}`);
  }
  const connector = await loadConnector(ctx, request, params.connectorKey);
  if (!connector) return data({ error: { code: "CONNECTOR_NOT_FOUND" } }, { status: 404 });
  const values = readConnectorPayload(form, connector, { editing: false, activate: intent === "activate" });
  if (!values) return data({ error: { code: "INVALID_REQUEST" } }, { status: 400 });
  const { body, extras } = connectorCreateBody(connector.schema, connector.connector.authMethods ?? [], values, intent === "activate");
  const result = await callApi<{ id: string; webhookUrl?: string | null; issuedSecret?: { kind: string; value: string } | null }>(ctx, request, "/api/v1/core/sources", { method: "POST", idempotencyKey: idem, body });
  if (!result.ok) return data({ error: { code: result.code, message: result.message }, errors: result.errors ?? [] }, { status: result.status });
  const id = String(result.data.id);
  const failed = await putSecrets(ctx, request, id, extras);
  // Webhook: 서버가 만든 서명 비밀값은 이 응답에서만 보인다(리다이렉트하면 다시 볼 수 없다)
  if (values.type === "WEBHOOK") return { created: { id, webhookUrl: result.data.webhookUrl ?? null, issuedSecret: result.data.issuedSecret ?? null }, failedSecrets: failed };
  if (failed.length > 0) return redirect(`/sources/${encodeURIComponent(id)}?tab=settings&secretFailed=${encodeURIComponent(failed.map((f) => f.kind).join(","))}`);
  return redirect(`/sources/${encodeURIComponent(id)}${intent === "activate" ? "?tab=status" : "?tab=settings"}`);
}

type ActionData = { error?: { code: string; message?: string }; errors?: { field: string; code: string; message: string }[]; created?: { id: string; webhookUrl: string | null; issuedSecret: { kind: string; value: string } | null }; failedSecrets?: { kind: string }[] } | undefined;

export default function SourceNewForm({ loaderData, actionData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const { models, spaces, scripts, idempotencyKey, templateName, limits } = loaderData;
  const result = actionData as ActionData;
  const typeName = loaderData.kind === "connector" ? loaderData.connector.connector.name : loaderData.kind === "basic" ? t(`sources.type.${loaderData.initial.type}`, { defaultValue: loaderData.initial.type }) : loaderData.connectorKey;
  return (
    <>
      <IngestTabs current="sources" />
      <PageHeader crumb={t("sources.new.title")} title={templateName ? t("sources.new.withTemplate", { type: typeName, template: templateName }) : typeName} />
      {result?.created ? (
        <>
          {(result.failedSecrets?.length ?? 0) > 0 && <Alert tone="warning">{t("sources.schema.secretSaveFailed", { kinds: result.failedSecrets?.map((f) => f.kind).join(", ") })}</Alert>}
          <WebhookCreated sourceId={result.created.id} webhookUrl={result.created.webhookUrl} secret={result.created.issuedSecret} />
        </>
      ) : loaderData.kind === "basic" ? (
        <SourceForm
          initial={loaderData.initial}
          mode="create"
          models={models}
          spaces={spaces}
          scripts={scripts}
          maxTopics={limits?.maxTopicsPerSource}
          idempotencyKey={idempotencyKey}
          testPath="/bff/api/core/sources/test"
          serverError={result?.error ?? null}
          serverFieldErrors={result?.errors}
        />
      ) : loaderData.kind === "connector" ? (
        <ConnectorSourceForm
          schema={loaderData.connector.schema}
          connector={loaderData.connector.connector}
          initial={loaderData.initial}
          mode="create"
          models={models}
          spaces={spaces}
          scripts={scripts}
          idempotencyKey={idempotencyKey}
          testPath="/bff/api/core/sources/test"
          serverError={result?.error ?? null}
          serverFieldErrors={result?.errors}
        />
      ) : (
        <p className="text-[13px] text-muted">{t("sources.new.unsupported")}</p>
      )}
    </>
  );
}
