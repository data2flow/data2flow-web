/**
 * UI-DSC-05 출력 연결 상세·편집(`/outputs/{id}`, DSC-04.01). 조회 SRC_READ(OPERATOR 이상), 수정·삭제·재전송 SRC_ADMIN.
 * 상세: 최근 1시간 1분 지표(API-DSC-31), 실패 보관함 다시 보내기(API-DSC-33 `{from, to}` → `{queued}`). 수정 API-DSC-30 PATCH + baseVersion.
 */
import { useTranslation } from "react-i18next";
import { Form, data, redirect } from "react-router";
import { callApi, callList, field, orThrow } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { getMe } from "~/bff/user.server";
import { Alert, Button, CsrfField, PageHeader } from "~/components/ui";
import { hasAny } from "~/lib/permissions";
import { localToUtc } from "~/features/explore/model/time";
import { IngestTabs, useTimezone } from "~/features/sources/components/common";
import { OutputForm, OutputStats } from "~/features/sources/components/outputs";
import { SourcesSubTabs } from "~/features/sources/components/sub-tabs";
import { outputBody, outputForm, validateOutput, type OutputConnection, type OutputFormValues, type OutputStat } from "~/features/sources/model/output";
import type { Route } from "./+types/output-detail";

export function meta() {
  return [{ title: "data2flow" }];
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const ctx = bff(context);
  const id = encodeURIComponent(params.outputId);
  const now = ctx.runtime.now();
  const from = new Date(now - 3600_000).toISOString();
  const to = new Date(now).toISOString();
  const [output, stats, me, devices] = await Promise.all([
    callApi<OutputConnection>(ctx, request, `/api/v1/core/output-connections/${id}`),
    callApi<OutputStat[]>(ctx, request, `/api/v1/core/output-connections/${id}/stats?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
    getMe(ctx, request),
    callList<{ id: string; name: string }>(ctx, request, "/api/v1/core/devices?size=50"),
  ]);
  const detail = orThrow(output);
  return {
    output: detail,
    initial: outputForm(detail),
    stats: stats.ok && Array.isArray(stats.data) ? stats.data : [],
    canAdmin: me.ok && hasAny(me.data.permissions, ["SRC_ADMIN"]),
    devices: devices.ok ? devices.list.responses.map((d) => ({ id: String(d.id), name: d.name })) : [],
    created: new URL(request.url).searchParams.get("created") === "1",
  };
}


export async function action({ request, context, params }: Route.ActionArgs) {
  const ctx = bff(context);
  const form = await request.formData();
  const intent = field(form, "intent");
  const id = encodeURIComponent(params.outputId);
  if (intent === "replay") {
    const result = await callApi<{ queued: number }>(ctx, request, `/api/v1/core/output-connections/${id}/replay-failed`, { method: "POST", body: { from: localToUtc(field(form, "from"), field(form, "timezone") || "Asia/Seoul"), to: localToUtc(field(form, "to"), field(form, "timezone") || "Asia/Seoul") } });
    return result.ok ? { intent, queued: result.data.queued } : data({ intent, error: { code: result.code, message: result.message } }, { status: result.status });
  }
  if (intent === "delete") {
    const result = await callApi(ctx, request, `/api/v1/core/output-connections/${id}`, { method: "DELETE" });
    return result.ok ? redirect("/sources?tab=outputs") : data({ intent, error: { code: result.code, message: result.message } }, { status: result.status });
  }
  let values: OutputFormValues;
  try {
    values = JSON.parse(field(form, "payload")) as OutputFormValues;
  } catch {
    return data({ intent, error: { code: "INVALID_REQUEST" } }, { status: 400 });
  }
  if (!values || Object.keys(validateOutput(values)).length > 0) return data({ intent, error: { code: "INVALID_REQUEST" } }, { status: 400 });
  const { type: _type, ...body } = outputBody(values);
  void _type;
  const result = await callApi(ctx, request, `/api/v1/core/output-connections/${id}`, { method: "PATCH", body: { ...body, baseVersion: Number(field(form, "baseVersion")) } });
  if (!result.ok) return data({ intent, error: { code: result.code, message: result.message }, errors: result.errors ?? [] }, { status: result.status });
  return { intent, saved: true };
}

export default function OutputDetail({ loaderData, actionData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const timezone = useTimezone();
  const { output, initial, stats, canAdmin, devices, created } = loaderData;
  const result = actionData as { intent?: string; queued?: number; saved?: boolean; error?: { code: string; message?: string }; errors?: { field: string; code: string; message: string }[] } | undefined;
  return (
    <>
      <IngestTabs current="sources" />
      <PageHeader
        crumb={t("sources.outputs.title")}
        title={output.name}
        actions={
          canAdmin && (
            <Form method="post" onSubmit={(e) => (window.confirm(t("sources.outputs.deleteConfirm")) ? undefined : e.preventDefault())}>
              <CsrfField />
              <Button type="submit" name="intent" value="delete" variant="danger">
                {t("common.delete")}
              </Button>
            </Form>
          )
        }
      />
      <SourcesSubTabs current="outputs" />
      {created && <Alert tone="success">{t("sources.outputs.created")}</Alert>}
      {result?.saved && <Alert tone="success">{t("sources.edit.saved")}</Alert>}
      <div className="flex flex-col gap-4">
        <OutputStats stats={stats} timezone={timezone} canAdmin={canAdmin} replayed={result?.intent === "replay" ? (result.queued ?? null) : null} />
        <OutputForm
          key={output.version}
          initial={initial}
          mode="edit"
          readOnly={!canAdmin}
          configuredKinds={output.secretKinds ?? []}
          baseVersion={output.version}
          outputId={output.id}
          devices={devices}
          serverError={result?.intent !== "replay" ? (result?.error ?? null) : null}
          serverFieldErrors={result?.errors}
        />
        {result?.intent === "replay" && result.error && <Alert tone="danger">{result.error.code}</Alert>}
      </div>
    </>
  );
}
