/**
 * UI-DEV-08 기기 모델 목록과 새 모델(DEV-03.01, BR-DEV-15). 조회 DEV_READ, 생성 DEV_ADMIN.
 * API: 목록 API-DEV-46, 생성 API-DEV-40(측정 항목 키는 API-DEV-50 검증된 항목에서 고른다)
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Form, Link, redirect, useNavigate, useRouteLoaderData, useSearchParams } from "react-router";
import { callApi, callList, field, listOrThrow, newIdempotencyKey } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { Alert, Badge, Button, ButtonLink, Card, CsrfField, EmptyState, PageHeader, SelectField } from "~/components/ui";
import { DeviceAreaTabs } from "~/features/devices/area-tabs";
import { ModelFields } from "~/features/catalog/components/model-fields";
import { DEVICE_KINDS, PROTOCOLS, checkModelInput, modelBody, readModelForm } from "~/features/catalog/model/catalog";
import type { MetricRow, ModelDetail, ModelSummary } from "~/features/catalog/model/types";
import { can, failed, invalid, type CatalogActionResult } from "~/features/catalog/server";
import { devModelApi } from "~/features/devmodel/api";
import { ModelImportDialog } from "~/features/devmodel/components/model-exchange";
import { errorText } from "~/lib/error-text";
import type { RootData } from "~/root";
import type { Route } from "./+types/models";

export function meta() {
  return [{ title: "data2flow" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = bff(context);
  const url = new URL(request.url);
  const query = new URLSearchParams({ size: "100", includeDeprecated: "true" });
  for (const key of ["protocol", "kind", "q"]) {
    const value = url.searchParams.get(key);
    if (value) query.set(key, value);
  }
  const creating = url.searchParams.get("new") === "1";
  const [models, metrics] = await Promise.all([
    callList<ModelSummary>(ctx, request, `/api/v1/core/device-models?${query}`),
    creating ? callList<MetricRow>(ctx, request, "/api/v1/core/metrics?status=VERIFIED&size=100") : Promise.resolve(null),
  ]);
  const builtin = url.searchParams.get("builtin");
  const list = listOrThrow(models).responses.filter((m) => (builtin === "true" ? m.builtin : builtin === "false" ? !m.builtin : true));
  return { models: list, metrics: metrics?.ok ? metrics.list.responses : [], creating, idempotencyKey: newIdempotencyKey() };
}

export async function action({ request, context }: Route.ActionArgs) {
  const ctx = bff(context);
  const form = await request.formData();
  const input = readModelForm(form);
  const errors = checkModelInput(input, { creating: true });
  if (Object.keys(errors).length) return invalid("create", errors);
  const result = await callApi<ModelDetail>(ctx, request, "/api/v1/core/device-models", { method: "POST", body: modelBody(input, true), idempotencyKey: field(form, "idempotencyKey") || newIdempotencyKey() });
  if (!result.ok) return failed("create", result);
  throw redirect(`/models/${encodeURIComponent(result.data.code)}`);
}

export default function Models({ loaderData, actionData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const root = useRouteLoaderData("root") as RootData | undefined;
  const admin = can(root?.me?.permissions, "DEV_ADMIN");
  const [params] = useSearchParams();
  const result = actionData as CatalogActionResult | undefined;
  const { models, metrics, creating, idempotencyKey } = loaderData;
  const filtered = ["protocol", "kind", "builtin"].some((k) => params.get(k));
  const navigate = useNavigate();
  const [importOpen, setImportOpen] = useState(false);
  return (
    <>
      <PageHeader
        title={t("catalog.models.title")}
        actions={
          admin &&
          !creating && (
            <>
              {/* DEV-03.04 모델 가져오기(API-DEV-45) */}
              <Button onClick={() => setImportOpen(true)}>{t("devmodel.models.importOpen")}</Button>
              <ButtonLink to="?new=1" variant="primary">
                {t("catalog.models.new")}
              </ButtonLink>
            </>
          )
        }
      />
      {admin && <ModelImportDialog open={importOpen} onClose={() => setImportOpen(false)} api={devModelApi} onImported={(code) => navigate(`/models/${encodeURIComponent(code)}`)} />}
      <DeviceAreaTabs current="models" />
      {result?.error && (
        <div className="mb-3">
          <Alert tone="danger">{errorText(t, result.error)}</Alert>
        </div>
      )}
      {creating && admin && (
        <Card title={t("catalog.models.new")} className="mb-4" actions={<ButtonLink to="/models">{t("common.cancel")}</ButtonLink>}>
          <Form method="post" className="flex flex-col gap-3">
            <CsrfField />
            <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
            <ModelFields metrics={metrics} creating fieldErrors={result?.fieldErrors} />
            <div className="flex justify-end">
              <Button type="submit" variant="primary">
                {t("common.save")}
              </Button>
            </div>
          </Form>
        </Card>
      )}
      <Form method="get" className="mb-4 flex flex-wrap items-end gap-3">
        <SelectField label={t("catalog.models.protocol")} name="protocol" defaultValue={params.get("protocol") ?? ""}>
          <option value="">{t("common.all")}</option>
          {PROTOCOLS.map((p) => (
            <option key={p} value={p}>
              {t(`catalog.protocol.${p}`)}
            </option>
          ))}
        </SelectField>
        <SelectField label={t("catalog.models.kind")} name="kind" defaultValue={params.get("kind") ?? ""}>
          <option value="">{t("common.all")}</option>
          {DEVICE_KINDS.map((k) => (
            <option key={k} value={k}>
              {t(`catalog.kind.${k}`)}
            </option>
          ))}
        </SelectField>
        <SelectField label={t("catalog.models.builtin")} name="builtin" defaultValue={params.get("builtin") ?? ""}>
          <option value="">{t("common.all")}</option>
          <option value="true">{t("catalog.models.builtinOnly")}</option>
          <option value="false">{t("catalog.models.customOnly")}</option>
        </SelectField>
        <Button type="submit">{t("common.filter")}</Button>
      </Form>
      {models.length === 0 ? (
        <EmptyState
          title={filtered ? t("catalog.models.noMatch") : t("catalog.models.empty")}
          body={filtered ? undefined : t("catalog.models.emptyBody")}
          action={filtered ? <ButtonLink to="/models">{t("common.reset")}</ButtonLink> : admin ? <ButtonLink to="?new=1" variant="primary">{t("catalog.models.new")}</ButtonLink> : <span className="text-[12.5px] text-muted">{t("catalog.askAdmin")}</span>}
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {models.map((m) => (
            <li key={m.id}>
              <Link to={`/models/${encodeURIComponent(m.code)}`} className="flex h-full flex-col gap-1 rounded-lg border border-line bg-panel p-4 hover:border-accent">
                <span className="flex flex-wrap gap-1">
                  {m.builtin && <Badge tone="info">{t("catalog.models.builtinBadge")}</Badge>}
                  {m.status === "DEPRECATED" && <Badge tone="neutral">DEPRECATED</Badge>}
                </span>
                <span className="text-[12px] text-muted">{m.vendor}</span>
                <span className="font-semibold">{m.name}</span>
                <span className="font-mono text-[12px] text-muted">{m.code}</span>
                <span className="text-[12.5px]">
                  {t(`catalog.protocol.${m.protocol}`, { defaultValue: m.protocol ?? "" })} · {t("catalog.models.metricCount", { n: m.metricCount ?? 0 })}
                </span>
                <span className="text-[12.5px] text-muted">{t("catalog.models.deviceCount", { n: m.deviceCount ?? 0 })}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
