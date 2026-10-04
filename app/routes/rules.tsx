/**
 * UI-RUL-01 규칙 목록(RUL-01, RUL-06.03 상태·오류 사유, RUL-06.04 한도, TC-RUL-106 AT-RUL-01.3·14.3). 조회 RULE_READ(ANALYST+), 생성·변경 RULE_WRITE(OPERATOR+).
 * API: 목록 API-RUL-01(검색·상태·심각도·공간·템플릿, counts.total/limit), 튜닝 제안 수 API-RUL-08, 상태 변경·삭제·변환 API-RUL-04.
 * 정렬: ERROR 먼저, 그다음 수정 시각 내림차순. 행 메뉴: 수정·복제·활성/비활성·시뮬레이션·무음·플로우로 열기·삭제.
 */
import { useTranslation } from "react-i18next";
import { Form, Link, data, redirect, useNavigate, useRouteLoaderData, useSearchParams } from "react-router";
import { callApi, callList, field, listOrThrow } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { SpaceSelect } from "~/components/space-picker";
import { Alert, Button, ButtonLink, Card, Checkbox, CsrfField, Dialog, EmptyState, PageHeader, Pager, SelectField, TextField } from "~/components/ui";
import { SeverityBadge } from "~/features/alarms/components/badges";
import { RuleStatusBadge } from "~/features/rules/components/rule-status";
import { MAX_RULES, RULE_LIMIT_WARN, sortRules } from "~/features/rules/model/rule-form";
import { SEVERITIES, type RuleRow, type RuleTemplate } from "~/features/rules/model/types";
import { errorText } from "~/lib/error-text";
import { formatDateTime } from "~/lib/format";
import { hasAny } from "~/lib/permissions";
import type { SpaceNode } from "~/lib/spaces";
import type { RootData } from "~/root";
import type { Route } from "./+types/rules";

const PAGE_SIZE = 50;

export function meta() {
  return [{ title: "data2flow" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = bff(context);
  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const query = new URLSearchParams({ page: String(page), size: String(PAGE_SIZE) });
  for (const key of ["q", "status", "severity", "spaceId", "templateKey"]) {
    const value = url.searchParams.get(key)?.trim();
    if (value) query.set(key, value);
  }
  const [rules, spaces, templates, tuning] = await Promise.all([
    callList<RuleRow>(ctx, request, `/api/v1/core/rules?${query}`),
    callApi<SpaceNode[]>(ctx, request, "/api/v1/core/spaces"),
    callList<RuleTemplate>(ctx, request, "/api/v1/core/rule-templates"),
    callList<unknown>(ctx, request, "/api/v1/core/rule-tuning-suggestions?status=OPEN&size=1"),
  ]);
  const list = listOrThrow(rules) as ReturnType<typeof listOrThrow<RuleRow>> & { counts?: { total?: number; limit?: number } };
  return {
    page,
    rows: sortRules(list.responses.map((r) => ({ ...r, ruleId: String(r.ruleId) }))),
    totalPages: list.totalPages,
    counts: { total: list.counts?.total ?? list.totalCount ?? list.responses.length, limit: list.counts?.limit ?? MAX_RULES },
    spaces: spaces.ok ? (spaces.data ?? []) : [],
    templates: templates.ok ? templates.list.responses : [],
    tuningOpen: tuning.ok ? (tuning.list.totalCount ?? tuning.list.responses.length) : 0,
    filtered: ["q", "status", "severity", "spaceId", "templateKey"].some((k) => url.searchParams.get(k)),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const ctx = bff(context);
  const form = await request.formData();
  const intent = field(form, "intent");
  const ruleId = field(form, "ruleId");
  if (!ruleId) return data({ intent, error: { code: "INVALID_REQUEST" } }, { status: 400 });
  const base = `/api/v1/core/rules/${encodeURIComponent(ruleId)}`;
  if (intent === "activate" || intent === "deactivate") {
    const result = await callApi(ctx, request, `${base}/${intent}`, { method: "POST", body: {} });
    return result.ok ? { intent, done: true } : data({ intent, error: { code: result.code, message: result.message } }, { status: result.status });
  }
  if (intent === "delete") {
    const clear = field(form, "clearOpenAlarms") === "true";
    const result = await callApi(ctx, request, `${base}?clearOpenAlarms=${clear}`, { method: "DELETE" });
    return result.ok ? { intent, done: true } : data({ intent, error: { code: result.code, message: result.message } }, { status: result.status });
  }
  if (intent === "convert") {
    const result = await callApi<{ flowId: string }>(ctx, request, `${base}/convert-to-flow`, { method: "POST", body: {} });
    if (result.ok) throw redirect(`/automation/flows/${encodeURIComponent(result.data.flowId)}`);
    return data({ intent, error: { code: result.code, message: result.message } }, { status: result.status });
  }
  return data({ intent, error: { code: "INVALID_REQUEST" } }, { status: 400 });
}

export default function Rules({ loaderData, actionData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const root = useRouteLoaderData("root") as RootData | undefined;
  const canWrite = hasAny(root?.me?.permissions, ["RULE_WRITE"]);
  const canSilence = hasAny(root?.me?.permissions, ["ALARM_HANDLE", "NOTIFY_POLICY_WRITE"]);
  const result = actionData as { intent?: string; done?: boolean; error?: { code: string; message?: string } } | undefined;
  const { rows, counts, spaces, templates } = loaderData;
  const timezone = root?.timezone ?? "Asia/Seoul";
  const dialog = params.get("dialog");
  const target = rows.find((r) => r.ruleId === params.get("rule"));
  const openDialog = (kind: string, ruleId: string) => navigate(`?${new URLSearchParams({ ...Object.fromEntries(params), dialog: kind, rule: ruleId })}`);
  const closeDialog = () => {
    const next = new URLSearchParams(params);
    next.delete("dialog");
    next.delete("rule");
    navigate(`?${next}`);
  };

  return (
    <>
      <PageHeader
        crumb={t("rules.crumb")}
        title={t("rules.title")}
        actions={
          <>
            <ButtonLink to="/rules/tuning">{t("rules.tuningCount", { n: loaderData.tuningOpen })}</ButtonLink>
            {canWrite && (
              <ButtonLink to="/rules/new" variant="primary">
                {t("rules.newRule")}
              </ButtonLink>
            )}
          </>
        }
      />
      {counts.total >= RULE_LIMIT_WARN && <Alert tone="warning">{t("rules.limitNear", { total: counts.total, limit: counts.limit })}</Alert>}
      {result?.error && <Alert tone="danger">{errorText(t, result.error)}</Alert>}
      {result?.done && <Alert tone="success">{t("common.done")}</Alert>}
      <Card>
        <Form method="get" className="mb-3 flex flex-wrap items-end gap-2">
          <TextField label={t("rules.list.search")} name="q" defaultValue={params.get("q") ?? ""} />
          <SelectField label={t("rules.list.status")} name="status" defaultValue={params.get("status") ?? ""}>
            <option value="">{t("common.all")}</option>
            {(["ACTIVE", "INACTIVE", "ERROR"] as const).map((s) => (
              <option key={s} value={s}>
                {t(`rules.status.${s}`)}
              </option>
            ))}
          </SelectField>
          <SelectField label={t("rules.list.severity")} name="severity" defaultValue={params.get("severity") ?? ""}>
            <option value="">{t("common.all")}</option>
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {t(`alarms.severity.${s}`)}
              </option>
            ))}
          </SelectField>
          <SpaceSelect spaces={spaces} name="spaceId" label={t("rules.list.space")} emptyLabel={t("common.all")} defaultValue={params.get("spaceId") ?? ""} />
          <SelectField label={t("rules.list.template")} name="templateKey" defaultValue={params.get("templateKey") ?? ""}>
            <option value="">{t("common.all")}</option>
            {templates.map((tpl) => (
              <option key={tpl.key} value={tpl.key}>
                {tpl.name}
              </option>
            ))}
          </SelectField>
          <Button type="submit">{t("common.search")}</Button>
        </Form>
        {rows.length === 0 ? (
          loaderData.filtered ? (
            <EmptyState title={t("rules.list.noMatch")} action={<ButtonLink to="/rules">{t("common.reset")}</ButtonLink>} />
          ) : (
            <EmptyState title={t("rules.list.empty")} action={canWrite && <ButtonLink to="/rules/new" variant="primary">{t("rules.newRule")}</ButtonLink>} />
          )
        ) : (
          <ul aria-label={t("rules.title")} className="flex flex-col">
            {rows.map((r) => (
              <li key={r.ruleId} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-2 py-2 text-[13px]">
                <span className="w-36 shrink-0">
                  <RuleStatusBadge status={r.status} reason={r.errorReason} />
                </span>
                <Link to={`/rules/${encodeURIComponent(r.ruleId)}`} className="min-w-0 basis-40 font-medium text-accent hover:underline">
                  {r.name}
                </Link>
                <span className="min-w-0 flex-1 basis-48 font-mono text-[12.5px]">{r.conditionSummary ?? "–"}</span>
                <span className="text-muted">
                  {scopeText(r, spaces, t)}
                  {r.scope.targetCount === 0 && <span className="ml-1 text-warn">⚠</span>}
                </span>
                <SeverityBadge severity={r.severity} short />
                <span title={t("rules.list.raised7d")} className="font-mono">
                  {t("rules.list.raised7dValue", { n: r.stats7d?.raised ?? 0 })}
                </span>
                <Link to={`/alarms?ruleId=${encodeURIComponent(r.ruleId)}`} title={t("rules.list.openAlarms")} className="font-mono text-accent">
                  {t("rules.list.openAlarmsValue", { n: r.openAlarms ?? 0 })}
                </Link>
                <span className="text-muted">{r.updatedAt ? `${r.updatedBy?.name ?? ""} ${formatDateTime(r.updatedAt, timezone, i18n.language)}` : ""}</span>
                <span className="ml-auto flex flex-wrap gap-1">
                  {canWrite && (
                    <>
                      <ButtonLink to={`/rules/${encodeURIComponent(r.ruleId)}`}>{t("common.edit")}</ButtonLink>
                      <ButtonLink to={`/rules/new?copy=${encodeURIComponent(r.ruleId)}`}>{t("rules.list.copy")}</ButtonLink>
                      {r.status === "INACTIVE" ? <RowAction intent="activate" ruleId={r.ruleId} label={t("rules.list.activate")} /> : <RowAction intent="deactivate" ruleId={r.ruleId} label={t("rules.list.deactivate")} />}
                      <ButtonLink to={`/rules/${encodeURIComponent(r.ruleId)}?simulate=1`}>{t("rules.form.simulate")}</ButtonLink>
                    </>
                  )}
                  {canSilence && <ButtonLink to={`/notifications/silences?targetType=RULE&targetId=${encodeURIComponent(r.ruleId)}`}>{t("alarms.silence")}</ButtonLink>}
                  {canWrite && (
                    <>
                      <Button onClick={() => openDialog("convert", r.ruleId)}>{t("rules.openFlow")}</Button>
                      <Button variant="danger" onClick={() => openDialog("delete", r.ruleId)}>
                        {t("common.delete")}
                      </Button>
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
        <Pager page={loaderData.page} totalPages={loaderData.totalPages} />
      </Card>
      {target && dialog === "delete" && canWrite && (
        <Dialog open title={t("rules.list.deleteTitle", { name: target.name })} onClose={closeDialog}>
          <Form method="post" className="flex flex-col gap-3">
            <CsrfField />
            <input type="hidden" name="intent" value="delete" />
            <input type="hidden" name="ruleId" value={target.ruleId} />
            <p className="text-[13px]">{t("rules.list.deleteBody", { n: target.openAlarms ?? 0 })}</p>
            <Checkbox label={t("rules.list.clearOpenAlarms")} name="clearOpenAlarms" value="true" defaultChecked />
            <div className="flex justify-end gap-2">
              <Button onClick={closeDialog}>{t("common.cancel")}</Button>
              <Button type="submit" variant="danger">
                {t("common.delete")}
              </Button>
            </div>
          </Form>
        </Dialog>
      )}
      {target && dialog === "convert" && canWrite && (
        <Dialog open title={t("rules.list.convertTitle", { name: target.name })} onClose={closeDialog}>
          <Form method="post" className="flex flex-col gap-3">
            <CsrfField />
            <input type="hidden" name="intent" value="convert" />
            <input type="hidden" name="ruleId" value={target.ruleId} />
            <p className="text-[13px]">{t("rules.list.convertBody")}</p>
            <div className="flex justify-end gap-2">
              <Button onClick={closeDialog}>{t("common.cancel")}</Button>
              <Button type="submit" variant="primary">
                {t("rules.openFlow")}
              </Button>
            </div>
          </Form>
        </Dialog>
      )}
    </>
  );
}

function scopeText(r: RuleRow, spaces: SpaceNode[], t: (key: string, o?: Record<string, unknown>) => string): string {
  const ids = r.scope.ids ?? [];
  const names = r.scope.type === "SPACE" ? ids.map((id) => findName(spaces, String(id)) ?? String(id)) : ids.map(String);
  const head = names.length > 2 ? `${names.slice(0, 2).join(", ")} +${names.length - 2}` : names.join(", ");
  const children = r.scope.type === "SPACE" && r.scope.includeChildren ? ` ${t("rules.list.withChildren")}` : "";
  return t("rules.list.scopeValue", { scope: `${t(`rules.scope.${r.scope.type}`)} ${head}${children}`, n: r.scope.targetCount ?? 0 });
}

function findName(spaces: SpaceNode[], id: string): string | undefined {
  for (const s of spaces) {
    if (String(s.id) === id) return s.name;
    const found = findName(s.children ?? [], id);
    if (found) return found;
  }
  return undefined;
}

function RowAction({ intent, ruleId, label }: { intent: string; ruleId: string; label: string }) {
  return (
    <Form method="post">
      <CsrfField />
      <input type="hidden" name="intent" value={intent} />
      <input type="hidden" name="ruleId" value={ruleId} />
      <Button type="submit">{label}</Button>
    </Form>
  );
}
