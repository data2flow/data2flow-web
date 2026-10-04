/**
 * UI-RUL-10 규칙 튜닝 제안(RUL-06.02, BR-RUL-22, AT-RUL-14.2). 조회 RULE_READ(ANALYST+), 적용·무시 RULE_WRITE(OPERATOR+).
 * API-RUL-08: `GET /rule-tuning-suggestions?status=OPEN`, `POST …/{id}/apply`(새 규칙 버전) · `/dismiss`(204). 적용 전에는 규칙이 바뀌지 않는다.
 */
import { useTranslation } from "react-i18next";
import { Form, Link, data, useRouteLoaderData } from "react-router";
import { callApi, callList, field, listOrThrow } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { Alert, Badge, Button, ButtonLink, Card, CsrfField, EmptyState, PageHeader } from "~/components/ui";
import { summarize } from "~/features/rules/model/condition";
import type { MetricInfo, RuleCondition, TuningSuggestion } from "~/features/rules/model/types";
import { errorText } from "~/lib/error-text";
import { hasAny } from "~/lib/permissions";
import type { RootData } from "~/root";
import type { Route } from "./+types/rule-tuning";

export function meta() {
  return [{ title: "data2flow" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = bff(context);
  const [list, metrics] = await Promise.all([
    callList<TuningSuggestion>(ctx, request, "/api/v1/core/rule-tuning-suggestions?status=OPEN&size=100"),
    callList<MetricInfo>(ctx, request, "/api/v1/core/metrics?status=VERIFIED&size=100"),
  ]);
  return { items: listOrThrow(list).responses, metrics: metrics.ok ? metrics.list.responses : [] };
}

export async function action({ request, context }: Route.ActionArgs) {
  const ctx = bff(context);
  const form = await request.formData();
  const intent = field(form, "intent");
  const id = encodeURIComponent(field(form, "id"));
  if (!id || (intent !== "apply" && intent !== "dismiss")) return data({ intent, error: { code: "INVALID_REQUEST" } }, { status: 400 });
  const result = await callApi<{ ruleVersion?: number }>(ctx, request, `/api/v1/core/rule-tuning-suggestions/${id}/${intent}`, { method: "POST", body: {} });
  return result.ok ? { intent, ok: true, ruleVersion: result.data?.ruleVersion } : data({ intent, error: { code: result.code, message: result.message } }, { status: result.status });
}

export default function RuleTuning({ loaderData, actionData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const root = useRouteLoaderData("root") as RootData | undefined;
  const canWrite = hasAny(root?.me?.permissions, ["RULE_WRITE"]);
  const result = actionData as { intent?: string; ok?: boolean; ruleVersion?: number; error?: { code: string; message?: string } } | undefined;
  const words = { s: t("rules.unit.s"), m: t("rules.unit.m"), h: t("rules.unit.h"), and: t("rules.cond.and"), or: t("rules.cond.or"), noData: t("rules.cond.kinds.noData"), rate: t("rules.cond.kinds.rateOfChange"), clear: t("rules.cond.clear"), repeat: t("rules.cond.repeat"), anomaly: t("rules.cond.kinds.anomaly") };
  const describe = (value: Record<string, unknown>) => ("kind" in value ? summarize(value as unknown as RuleCondition, loaderData.metrics, words) : JSON.stringify(value));
  return (
    <>
      <PageHeader crumb={t("rules.crumb")} title={t("tuning.title")} actions={<ButtonLink to="/alarms/stats">{t("alarmStats.title")}</ButtonLink>} />
      {result?.ok && <Alert tone="success">{result.intent === "apply" ? t("tuning.applied", { version: result.ruleVersion ?? "" }) : t("tuning.dismissed")}</Alert>}
      {result?.error && <Alert tone="danger">{errorText(t, result.error)}</Alert>}
      {loaderData.items.length === 0 ? (
        <Card>
          <EmptyState title={t("tuning.empty")} />
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {loaderData.items.map((s) => (
            <li key={s.tuningSuggestionId}>
              <Card>
                <div className="flex flex-wrap items-center gap-2">
                  <Link to={`/rules/${encodeURIComponent(s.ruleId)}`} className="font-semibold text-accent underline">
                    {s.ruleName}
                  </Link>
                  <Badge tone="warning">{t(`tuning.problem.${s.problem}`)}</Badge>
                </div>
                <dl className="mt-2 grid gap-x-4 gap-y-1 text-[13px] sm:grid-cols-[max-content_1fr]">
                  <dt className="text-muted">{t("tuning.current")}</dt>
                  <dd className="font-mono">{describe(s.current)}</dd>
                  <dt className="text-muted">{t("tuning.proposed")}</dt>
                  <dd className="font-mono">{describe(s.proposed)}</dd>
                  <dt className="text-muted">{t("tuning.simulation")}</dt>
                  <dd>{t("tuning.simulationValue", { before: s.simulation.alarmsBefore, after: s.simulation.alarmsAfter })}</dd>
                </dl>
                {canWrite && (
                  <div className="mt-3 flex justify-end gap-2">
                    {(["dismiss", "apply"] as const).map((intent) => (
                      <Form method="post" key={intent}>
                        <CsrfField />
                        <input type="hidden" name="intent" value={intent} />
                        <input type="hidden" name="id" value={s.tuningSuggestionId} />
                        <Button type="submit" variant={intent === "apply" ? "primary" : "secondary"}>
                          {t(`tuning.${intent}`)}
                        </Button>
                      </Form>
                    ))}
                  </div>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
