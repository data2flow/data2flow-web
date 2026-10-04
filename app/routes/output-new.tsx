/**
 * UI-DSC-05 출력 연결 만들기(`/outputs/new`, DSC-04.01). SRC_ADMIN(INTEGRATOR 이상). 저장 API-DSC-30(Idempotency-Key), 테스트 API-DSC-32.
 */
import { useTranslation } from "react-i18next";
import { data, redirect } from "react-router";
import { callApi, callList, field, newIdempotencyKey, requirePermission } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { getMe } from "~/bff/user.server";
import { PageHeader } from "~/components/ui";
import { IngestTabs } from "~/features/sources/components/common";
import { OutputForm } from "~/features/sources/components/outputs";
import { SourcesSubTabs } from "~/features/sources/components/sub-tabs";
import { emptyOutput, outputBody, validateOutput, type OutputFormValues } from "~/features/sources/model/output";
import type { Route } from "./+types/output-new";

export function meta() {
  return [{ title: "data2flow" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = bff(context);
  const me = await getMe(ctx, request);
  requirePermission(me.ok ? me.data.permissions : [], "SRC_ADMIN");
  const devices = await callList<{ id: string; name: string }>(ctx, request, "/api/v1/core/devices?size=50");
  return { devices: devices.ok ? devices.list.responses.map((d) => ({ id: String(d.id), name: d.name })) : [], idempotencyKey: newIdempotencyKey() };
}

export async function action({ request, context }: Route.ActionArgs) {
  const ctx = bff(context);
  const form = await request.formData();
  let values: OutputFormValues;
  try {
    values = JSON.parse(field(form, "payload")) as OutputFormValues;
  } catch {
    return data({ error: { code: "INVALID_REQUEST" }, errors: [] }, { status: 400 });
  }
  if (!values || Object.keys(validateOutput(values)).length > 0) return data({ error: { code: "INVALID_REQUEST" }, errors: [] }, { status: 400 });
  const result = await callApi<{ id: string }>(ctx, request, "/api/v1/core/output-connections", { method: "POST", idempotencyKey: field(form, "idempotencyKey") || newIdempotencyKey(), body: outputBody(values) });
  if (!result.ok) return data({ error: { code: result.code, message: result.message }, errors: result.errors ?? [] }, { status: result.status });
  return redirect(`/outputs/${encodeURIComponent(result.data.id)}?created=1`);
}

export default function OutputNew({ loaderData, actionData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const result = actionData as { error?: { code: string; message?: string }; errors?: { field: string; code: string; message: string }[] } | undefined;
  return (
    <>
      <IngestTabs current="sources" />
      <PageHeader crumb={t("sources.outputs.title")} title={t("sources.outputs.new")} />
      <SourcesSubTabs current="outputs" />
      <OutputForm initial={emptyOutput()} mode="create" devices={loaderData.devices} idempotencyKey={loaderData.idempotencyKey} serverError={result?.error ?? null} serverFieldErrors={result?.errors} />
    </>
  );
}
