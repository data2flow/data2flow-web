/**
 * UI-SCR-01 스크립트 목록(SCR-01, SCR-04.03). 조회 SCRIPT_READ(OPERATOR+), [새 스크립트]·[템플릿에서 만들기] SCRIPT_WRITE(INTEGRATOR+).
 * API: 목록 API-SCR-01, 생성 API-SCR-02, 템플릿 API-SCR-15, 연결 대상 후보(소스 API-DSC-01, 모델 API-DEV-46)
 */
import { useTranslation } from "react-i18next";
import { Form, Link, data, redirect, useNavigate, useRouteLoaderData, useSearchParams } from "react-router";
import { callApi, callList, field, listOrThrow, newIdempotencyKey } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { Badge, Button, ButtonLink, Card, Checkbox, EmptyState, PageHeader, Pager, SelectField, Table, TextField } from "~/components/ui";
import { IngestAreaTabs } from "~/features/ingest/area-tabs";
import { CreateScriptDialog, type ScriptTemplate } from "~/features/scripts/create-script-dialog";
import { SCRIPT_QUOTA, bindingSummary, checkCreateInput, isHighErrorRate } from "~/features/scripts/model/script-model";
import { errorText } from "~/lib/error-text";
import { formatDateTime } from "~/lib/format";
import { hasAny } from "~/lib/permissions";
import type { RootData } from "~/root";
import type { Route } from "./+types/scripts";

interface ScriptRow {
  id: string;
  name: string;
  kind: "DECODE" | "TRANSFORM";
  status: string;
  activeVersion?: number | null;
  hasDraft?: boolean;
  bindingsSummary?: { sources?: number; models?: number; devices?: number; first?: string | null };
  stats24h?: { processed?: number; errorRate?: number; p95Ms?: number };
  lastDeployedBy?: string | null;
  lastDeployedAt?: string | null;
}

const PAGE_SIZE = 50;

export function meta() {
  return [{ title: "data2flow" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = bff(context);
  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const query = new URLSearchParams({ page: String(page), size: String(PAGE_SIZE) });
  for (const key of ["kind", "status", "keyword"]) {
    const value = url.searchParams.get(key);
    if (value) query.set(key, value);
  }
  if (url.searchParams.get("checkFailed") === "true") query.set("checkFailed", "true");
  const wantsDialog = url.searchParams.get("dialog") === "create";
  const [scripts, templates, sources, models] = await Promise.all([
    callList<ScriptRow>(ctx, request, `/api/v1/core/scripts?${query}`),
    callList<ScriptTemplate>(ctx, request, "/api/v1/core/scripts/templates"),
    wantsDialog ? callList<{ id: string; name: string }>(ctx, request, "/api/v1/core/sources?size=100") : Promise.resolve(null),
    wantsDialog ? callList<{ id: string; code: string; name: string }>(ctx, request, "/api/v1/core/device-models?size=100") : Promise.resolve(null),
  ]);
  const list = listOrThrow(scripts);
  return {
    page,
    list,
    // 조직 한도 대비 사용량(totalCount, API-SCR-01). 필터가 걸리면 전체 수가 아니므로 필터 없을 때만 한도를 판단한다
    filtered: [...query.keys()].some((k) => !["page", "size"].includes(k)),
    templates: templates.ok ? templates.list.responses : [],
    sources: sources?.ok ? sources.list.responses : [],
    models: models?.ok ? models.list.responses : [],
    idempotencyKey: newIdempotencyKey(),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const ctx = bff(context);
  const form = await request.formData();
  if (field(form, "intent") !== "create") return data({ error: { code: "INVALID_REQUEST" } }, { status: 400 });
  const kind = field(form, "kind");
  const sourceId = field(form, "sourceId");
  const modelIds = form.getAll("modelId").filter((v): v is string => typeof v === "string" && v !== "");
  const bindings =
    kind === "DECODE" ? (sourceId ? [{ targetType: "SOURCE", targetId: sourceId, failurePolicy: "FAIL_CLOSED" }] : []) : modelIds.map((id) => ({ targetType: "MODEL", targetId: id, failurePolicy: "FAIL_OPEN" }));
  const name = field(form, "name").trim();
  const fieldErrors = checkCreateInput({ name, kind, bindings });
  if (Object.keys(fieldErrors).length > 0) return data({ fieldErrors }, { status: 400 });
  const result = await callApi<{ id: string }>(ctx, request, "/api/v1/core/scripts", {
    method: "POST",
    idempotencyKey: field(form, "idempotencyKey") || newIdempotencyKey(),
    body: { name, kind, description: field(form, "description").trim() || undefined, templateKey: field(form, "templateKey") || undefined, bindings },
  });
  if (!result.ok) return data({ error: { code: result.code, message: result.message } }, { status: result.status });
  return redirect(`/scripts/${encodeURIComponent(result.data.id)}`);
}

export default function Scripts({ loaderData, actionData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const root = useRouteLoaderData("root") as RootData | undefined;
  const canWrite = hasAny(root?.me?.permissions, ["SCRIPT_WRITE"]);
  const { list, templates } = loaderData;
  const total = list.totalCount ?? list.responses.length;
  const quotaReached = !loaderData.filtered && total >= SCRIPT_QUOTA;
  const result = actionData as { fieldErrors?: Record<string, string>; error?: { code: string; message?: string } } | undefined;
  const dialogOpen = params.get("dialog") === "create" && canWrite && !quotaReached;
  const filtered = loaderData.filtered;
  const closeDialog = () => {
    const next = new URLSearchParams(params);
    next.delete("dialog");
    next.delete("template");
    navigate(`?${next}`);
  };

  return (
    <>
      <PageHeader
        crumb={t("scripts.crumb")}
        title={t("scripts.title")}
        actions={
          canWrite && (
            <>
              <span className="self-center text-[12.5px] text-muted">{t("scripts.usage", { n: total, max: SCRIPT_QUOTA })}</span>
              {quotaReached ? (
                <Button variant="primary" disabled>
                  {t("scripts.create.open")}
                </Button>
              ) : (
                <>
                  <ButtonLink to={`?dialog=create${templates[0] ? `&template=${encodeURIComponent(templates[0].key)}` : ""}`}>{t("scripts.create.fromTemplate")}</ButtonLink>
                  <ButtonLink to="?dialog=create" variant="primary">
                    {t("scripts.create.open")}
                  </ButtonLink>
                </>
              )}
            </>
          )
        }
      />
      <IngestAreaTabs current="scripts" />
      {quotaReached && canWrite && <p className="mb-2 text-[12.5px] text-warn">{t("scripts.quotaReached")}</p>}
      {dialogOpen && (
        <CreateScriptDialog
          open
          onClose={closeDialog}
          templates={templates}
          sources={loaderData.sources}
          models={loaderData.models}
          idempotencyKey={loaderData.idempotencyKey}
          fieldErrors={result?.fieldErrors}
          error={result?.error ? errorText(t, result.error) : undefined}
          initialTemplate={params.get("template") ?? undefined}
        />
      )}
      <Card>
        <Form method="get" className="mb-3 flex flex-wrap items-end gap-2">
          <SelectField label={t("scripts.kind.label")} name="kind" defaultValue={params.get("kind") ?? ""}>
            <option value="">{t("common.all")}</option>
            <option value="DECODE">DECODE</option>
            <option value="TRANSFORM">TRANSFORM</option>
          </SelectField>
          <SelectField label={t("scripts.status.label")} name="status" defaultValue={params.get("status") ?? ""}>
            <option value="">{t("common.all")}</option>
            {["ENABLED", "DISABLED", "AUTO_DISABLED"].map((s) => (
              <option key={s} value={s}>
                {t(`scripts.status.${s}`)}
              </option>
            ))}
          </SelectField>
          <TextField label={t("scripts.keyword")} name="keyword" defaultValue={params.get("keyword") ?? ""} />
          <Checkbox label={t("scripts.status.checkFailed")} name="checkFailed" value="true" defaultChecked={params.get("checkFailed") === "true"} />
          <Button type="submit">{t("common.search")}</Button>
        </Form>
        {list.responses.length === 0 ? (
          filtered ? (
            <EmptyState title={t("scripts.noMatch")} action={<ButtonLink to="/scripts">{t("common.reset")}</ButtonLink>} />
          ) : (
            <EmptyState
              title={t("scripts.empty")}
              action={
                canWrite && (
                  <ButtonLink to={`?dialog=create${templates[0] ? `&template=${encodeURIComponent(templates[0].key)}` : ""}`} variant="primary">
                    {t("scripts.create.fromTemplate")}
                  </ButtonLink>
                )
              }
            />
          )
        ) : (
          <Table>
            <thead>
              <tr>
                <th>{t("scripts.col.name")}</th>
                <th>{t("scripts.col.kind")}</th>
                <th>{t("scripts.col.targets")}</th>
                <th>{t("scripts.col.active")}</th>
                <th>{t("scripts.col.draft")}</th>
                <th>{t("scripts.col.processed")}</th>
                <th>{t("scripts.col.errorRate")}</th>
                <th>{t("scripts.col.p95")}</th>
                <th>{t("scripts.col.lastDeploy")}</th>
              </tr>
            </thead>
            <tbody>
              {list.responses.map((s) => {
                const targets = bindingSummary(s.bindingsSummary);
                const rate = s.stats24h?.errorRate;
                return (
                  <tr key={s.id}>
                    <td>
                      <Link to={`/scripts/${s.id}`} className="text-accent hover:underline">
                        {s.name}
                      </Link>
                      {s.status !== "ENABLED" && (
                        <span className="ml-1">
                          <Badge tone={s.status === "AUTO_DISABLED" ? "danger" : "neutral"}>{t(`scripts.status.${s.status}`, { defaultValue: s.status })}</Badge>
                        </span>
                      )}
                    </td>
                    <td>
                      <Badge tone="info">{s.kind}</Badge>
                    </td>
                    <td>{targets.length === 0 ? t("scripts.targets.none") : targets.map((x) => t(`scripts.targets.${x.type}`, { n: x.n })).join(", ")}</td>
                    <td className="font-mono">{s.activeVersion ? `v${s.activeVersion}` : "–"}</td>
                    <td>{s.hasDraft && <span title={t("scripts.hasDraft")} aria-label={t("scripts.hasDraft")} className="text-accent">●</span>}</td>
                    <td className="font-mono">{(s.stats24h?.processed ?? 0).toLocaleString(i18n.language)}</td>
                    <td className={isHighErrorRate(rate) ? "font-mono text-bad" : "font-mono"}>{rate === undefined ? "–" : `${(rate * 100).toFixed(1)}%`}</td>
                    <td className="font-mono">{s.stats24h?.p95Ms ?? "–"}</td>
                    <td>{s.lastDeployedAt ? `${s.lastDeployedBy ?? ""} ${formatDateTime(s.lastDeployedAt, root?.timezone ?? "Asia/Seoul", i18n.language)}` : "–"}</td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
        <Pager page={loaderData.page} totalPages={list.totalPages} />
      </Card>
    </>
  );
}
