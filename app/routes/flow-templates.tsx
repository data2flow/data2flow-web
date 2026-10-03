/**
 * UI-FLW-04 템플릿 갤러리(FLW-01.05, FLW-03.07). OPERATOR 이상(FLOW_WRITE, VIEWER는 메뉴·경로 모두 403).
 * 템플릿 카드(이름, 설명, 필요한 측정 항목·기능, 미리 보기), 검색, 분류(쾌적·안전·에너지·설비). [사용하기] → 파라미터 폼(paramsSchema)
 * → [플로우 만들기](API-FLW-20 instantiate) → DRAFT 플로우 편집기로. 자동 적용하지 않는다.
 * 가상 환경 키트 배치에서 `?template={key}&spaceId={id}`로 들어오면 대상 공간을 채워 둔다(FLW-03.07).
 */
import { useTranslation } from "react-i18next";
import { Form, Link, data, redirect, useNavigate, useSearchParams } from "react-router";
import { callApi, callList, field, listOrThrow, newIdempotencyKey } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { Alert, Badge, Button, ButtonLink, Card, CsrfField, Dialog, EmptyState, PageHeader, SelectField, TextField } from "~/components/ui";
import { SpaceSelect } from "~/components/space-picker";
import { splitDuration } from "~/features/flows/model/duration";
import { paramsFromForm } from "~/features/flows/model/template-params";
import type { ConfigSchema } from "~/features/flows/model/types";
import { validateConfig } from "~/features/flows/model/validation";
import { errorText } from "~/lib/error-text";
import type { SpaceNode } from "~/lib/spaces";
import type { Route } from "./+types/flow-templates";

interface FlowTemplate {
  key: string;
  name: string;
  description?: string;
  category?: string;
  required?: { metrics?: string[]; capabilities?: string[] };
  paramsSchema?: ConfigSchema;
  preview?: { nodes?: { name: string; type?: string }[] } | null;
}

const CATEGORIES = ["COMFORT", "SAFETY", "ENERGY", "FACILITY"];

export function meta() {
  return [{ title: "data2flow" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = bff(context);
  const url = new URL(request.url);
  const category = url.searchParams.get("category") ?? "";
  const [templates, spaces] = await Promise.all([
    callList<FlowTemplate>(ctx, request, `/api/v1/core/flow-templates${category ? `?category=${encodeURIComponent(category)}` : ""}`),
    callApi<SpaceNode[]>(ctx, request, "/api/v1/core/spaces"),
  ]);
  const q = url.searchParams.get("q")?.trim().toLowerCase() ?? "";
  const all = listOrThrow(templates).responses;
  return {
    templates: q ? all.filter((tpl) => [tpl.name, tpl.description ?? ""].some((s) => s.toLowerCase().includes(q))) : all,
    all,
    spaces: spaces.ok ? (spaces.data ?? []) : [],
    idempotencyKey: newIdempotencyKey(),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const ctx = bff(context);
  const form = await request.formData();
  const key = field(form, "templateKey");
  const templates = await callList<FlowTemplate>(ctx, request, "/api/v1/core/flow-templates");
  if (!templates.ok) return data({ error: { code: templates.code, message: templates.message } }, { status: templates.status });
  const template = templates.list.responses.find((tpl) => tpl.key === key);
  if (!template) return data({ error: { code: "RESOURCE_NOT_FOUND" } }, { status: 404 });
  const name = field(form, "name").trim();
  const params = paramsFromForm(template.paramsSchema, form);
  const fieldErrors: Record<string, string> = {};
  if (!name || name.length > 100) fieldErrors.name = "name";
  for (const p of validateConfig(template.paramsSchema ? { ...template.paramsSchema, type: "object" } : undefined, params)) fieldErrors[p.path] ??= `${p.rule}:${p.limit ?? ""}`;
  if (Object.keys(fieldErrors).length > 0) return data({ fieldErrors }, { status: 400 });
  const result = await callApi<{ flowId: string; draftVersion: number; warnings?: unknown[] }>(ctx, request, `/api/v1/core/flow-templates/${encodeURIComponent(key)}/instantiate`, {
    method: "POST",
    idempotencyKey: field(form, "idempotencyKey") || newIdempotencyKey(),
    body: { name, params },
  });
  if (!result.ok) return data({ error: { code: result.code, message: result.message } }, { status: result.status });
  return redirect(`/automation/flows/${encodeURIComponent(result.data.flowId)}?from=template`);
}

export default function FlowTemplates({ loaderData, actionData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const result = actionData as { fieldErrors?: Record<string, string>; error?: { code: string; message?: string } } | undefined;
  const chosen = loaderData.all.find((tpl) => tpl.key === params.get("template"));
  const category = params.get("category") ?? "";
  const close = () => {
    const next = new URLSearchParams(params);
    next.delete("template");
    navigate(`?${next}`);
  };
  const ruleText = (code: string | undefined) => {
    if (!code) return undefined;
    if (code === "name") return t("flows.editor.nameRule", { max: 100 });
    const [rule, limit] = code.split(":");
    return t(`flows.rule.${rule}`, { limit, defaultValue: rule });
  };
  return (
    <>
      <PageHeader crumb={t("flows.crumb")} title={t("flows.templates.title")} actions={<ButtonLink to="/automation/flows">{t("flows.title")}</ButtonLink>} />
      {result?.error && !chosen && <Alert tone="danger">{errorText(t, result.error)}</Alert>}
      <Card>
        <Form method="get" className="mb-3 flex flex-wrap items-end gap-2">
          {category && <input type="hidden" name="category" value={category} />}
          <TextField label={t("flows.templates.search")} name="q" defaultValue={params.get("q") ?? ""} />
          <Button type="submit">{t("common.search")}</Button>
        </Form>
        <nav aria-label={t("flows.templates.category")} className="mb-3 flex flex-wrap gap-1">
          {["", ...CATEGORIES].map((c) => (
            <Link key={c || "all"} to={c ? `?category=${c}` : "?"} aria-current={category === c ? "page" : undefined} className={`rounded-full border px-3 py-1 text-[12.5px] ${category === c ? "border-accent text-accent" : "border-line text-muted"}`}>
              {c ? t(`flows.templates.categories.${c}`) : t("common.all")}
            </Link>
          ))}
        </nav>
        {loaderData.templates.length === 0 ? (
          <EmptyState title={t("flows.templates.empty")} />
        ) : (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {loaderData.templates.map((tpl) => (
              <li key={tpl.key} className="flex flex-col gap-2 rounded-lg border border-line p-3">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-[14px] font-semibold">{tpl.name}</h2>
                  {tpl.category && <Badge tone="neutral">{t(`flows.templates.categories.${tpl.category}`, { defaultValue: tpl.category })}</Badge>}
                </div>
                {tpl.description && <p className="text-[12.5px] text-muted">{tpl.description}</p>}
                <p className="text-[12px]">{t("flows.templates.required", { items: [...(tpl.required?.metrics ?? []), ...(tpl.required?.capabilities ?? [])].join(", ") || "–" })}</p>
                {tpl.preview?.nodes && <p className="font-mono text-[11.5px] text-muted">{tpl.preview.nodes.map((n) => n.name).join(" → ")}</p>}
                <div className="mt-auto flex justify-end">
                  <ButtonLink to={`?${new URLSearchParams({ ...Object.fromEntries(params), template: tpl.key })}`} variant="primary">
                    {t("flows.templates.use")}
                  </ButtonLink>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {chosen && (
        <Dialog open title={t("flows.templates.formTitle", { name: chosen.name })} onClose={close}>
          <Form method="post" className="flex flex-col gap-3">
            <CsrfField />
            <input type="hidden" name="templateKey" value={chosen.key} />
            <input type="hidden" name="idempotencyKey" value={loaderData.idempotencyKey} />
            <TextField label={t("flows.templates.flowName")} name="name" defaultValue={chosen.name} error={ruleText(result?.fieldErrors?.name)} />
            {Object.entries(chosen.paramsSchema?.properties ?? {}).map(([key, prop]) => {
              const label = t(`flows.field.${key}`, { defaultValue: prop.title ?? key });
              const error = ruleText(result?.fieldErrors?.[key]);
              const defaultValue = key === "spaceId" && params.get("spaceId") ? params.get("spaceId")! : prop.default === undefined ? "" : String(prop.default);
              if (prop["x-widget"] === "space") return <SpaceSelect key={key} spaces={loaderData.spaces} name={`p.${key}`} label={label} defaultValue={defaultValue} error={error} />;
              if (prop.format === "duration" || prop["x-widget"] === "duration") {
                const split = splitDuration(prop.default);
                return (
                  <div key={key} className="flex items-end gap-2">
                    <TextField label={label} name={`p.${key}`} type="number" min={1} defaultValue={split.amount} error={error} />
                    <SelectField label={t("flows.duration.unit", { label })} name={`p.${key}.unit`} defaultValue={split.unit}>
                      {(["s", "m", "h"] as const).map((u) => (
                        <option key={u} value={u}>
                          {t(`flows.duration.${u}`)}
                        </option>
                      ))}
                    </SelectField>
                  </div>
                );
              }
              if (prop.enum)
                return (
                  <SelectField key={key} label={label} name={`p.${key}`} defaultValue={defaultValue} error={error}>
                    {prop.enum.map((v) => (
                      <option key={String(v)} value={String(v)}>
                        {String(v)}
                      </option>
                    ))}
                  </SelectField>
                );
              return <TextField key={key} label={label} name={`p.${key}`} type={prop.type === "number" || prop.type === "integer" ? "number" : "text"} step="any" min={prop.minimum} max={prop.maximum} defaultValue={defaultValue} error={error} />;
            })}
            <p className="text-[12px] text-muted">{t("flows.templates.notApplied")}</p>
            {result?.error && <Alert tone="danger">{errorText(t, result.error)}</Alert>}
            <div className="flex justify-end gap-2">
              <Button onClick={close}>{t("common.cancel")}</Button>
              <Button type="submit" variant="primary">
                {t("flows.templates.create")}
              </Button>
            </div>
          </Form>
        </Dialog>
      )}
    </>
  );
}
