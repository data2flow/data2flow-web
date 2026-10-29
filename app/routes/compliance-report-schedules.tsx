/**
 * UI-CMP-09 정기 발행 목록(`/compliance/reports/schedules?runs=id`, CMP-02.04). 조회 CMP_READ, 만들기·지금 실행은 CMP_REPORT(OPERATOR+).
 * 목록: 이름·유형·주기·다음 발행 예정·마지막 결과(성공/실패, 판). 마지막이 실패면 빨간 배지와 원인, [재시도](지금 실행).
 * [이력]은 같은 화면 아래에 실행 이력(API-CMP-22)을 펼친다.
 * API: 목록·지금 실행 API-CMP-21, 이력 API-CMP-22.
 */
import { useTranslation } from "react-i18next";
import { Form, Link, data, redirect, useRouteLoaderData } from "react-router";
import { callApi, callList, field, newIdempotencyKey } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { getMe } from "~/bff/user.server";
import { Alert, Badge, Button, ButtonLink, Card, CsrfField, EmptyState, PageHeader, Pager, Table } from "~/components/ui";
import { runTone, type ReportSchedule, type ScheduleRun } from "~/features/compliance/model/schedules";
import { errorText } from "~/lib/error-text";
import { formatDateTime, resolveTimezone } from "~/lib/format";
import { hasAny } from "~/lib/permissions";
import type { RootData } from "~/root";
import type { Route } from "./+types/compliance-report-schedules";

export function meta() {
  return [{ title: "data2flow" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = bff(context);
  const url = new URL(request.url);
  const query = new URLSearchParams({ size: "20" });
  const page = url.searchParams.get("page");
  if (page) query.set("page", page);
  const runsOf = url.searchParams.get("runs");
  const [schedules, me, runs] = await Promise.all([
    callList<ReportSchedule>(ctx, request, `/api/v1/core/compliance/report-schedules?${query}`),
    getMe(ctx, request),
    runsOf ? callList<ScheduleRun>(ctx, request, `/api/v1/core/compliance/report-schedules/${encodeURIComponent(runsOf)}/runs?size=20`) : Promise.resolve(null),
  ]);
  return {
    schedules: schedules.ok ? schedules.list.responses : [],
    page: schedules.ok ? (schedules.list.page ?? 1) : 1,
    totalPages: schedules.ok ? schedules.list.totalPages : undefined,
    failed: schedules.ok ? null : { code: schedules.code, message: schedules.message },
    runsOf,
    runs: runs?.ok ? runs.list.responses : [],
    runsFailed: runs && !runs.ok ? { code: runs.code, message: runs.message } : null,
    timezone: resolveTimezone(me.ok ? me.data.timezone : undefined),
  };
}

type ActionResult = { error?: { code: string; message?: string } };

export async function action({ request, context }: Route.ActionArgs) {
  const ctx = bff(context);
  const form = await request.formData();
  if (field(form, "intent") !== "runNow") return data<ActionResult>({ error: { code: "BAD_REQUEST" } }, { status: 400 });
  const id = field(form, "scheduleId");
  const result = await callApi(ctx, request, `/api/v1/core/compliance/report-schedules/${encodeURIComponent(id)}/run-now`, { method: "POST", idempotencyKey: newIdempotencyKey() });
  if (!result.ok) return data<ActionResult>({ error: { code: result.code, message: result.message } }, { status: result.status });
  throw redirect(`/compliance/reports/schedules?runs=${encodeURIComponent(id)}`);
}

function RunBadge({ run }: { run?: ScheduleRun | null }) {
  const { t } = useTranslation();
  if (!run) return <span className="text-muted">–</span>;
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <Badge tone={runTone(run.status)}>{t(`compliance.schedules.runStatus.${run.status}`)}</Badge>
      {run.revisionNo ? <span>r{run.revisionNo}</span> : null}
      {run.status === "FAILED" && run.error && <span className="text-[12px] text-bad-ink">{t(`errors.${run.error}`, { defaultValue: run.error })}</span>}
    </span>
  );
}

function RunNow({ id, label }: { id: string; label: string }) {
  return (
    <Form method="post">
      <CsrfField />
      <input type="hidden" name="intent" value="runNow" />
      <input type="hidden" name="scheduleId" value={id} />
      <Button type="submit">{label}</Button>
    </Form>
  );
}

export default function ComplianceReportSchedules({ loaderData, actionData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const root = useRouteLoaderData("root") as RootData | undefined;
  const canReport = hasAny(root?.me?.permissions, ["CMP_REPORT"]);
  const { schedules, page, totalPages, failed, runsOf, runs, runsFailed } = loaderData;
  const timezone = root?.timezone ?? loaderData.timezone;
  const result = actionData as ActionResult | undefined;
  const at = (iso?: string | null) => (iso ? formatDateTime(iso, timezone, i18n.language) : "–");
  const selected = schedules.find((s) => s.reportScheduleId === runsOf);
  const newButton = canReport && (
    <ButtonLink to="/compliance/reports/schedules/new" variant="primary">
      {t("compliance.schedules.new")}
    </ButtonLink>
  );
  return (
    <>
      <PageHeader title={t("compliance.schedules.title")} crumb={t("compliance.reports.title")} actions={newButton} />
      {result?.error && (
        <div className="mb-3">
          <Alert tone="danger">{errorText(t, result.error)}</Alert>
        </div>
      )}
      <p className="mb-3 text-[12.5px] text-muted">{t("compliance.schedules.hint", { timezone })}</p>
      {failed ? (
        <Alert tone="warning">{errorText(t, failed)}</Alert>
      ) : schedules.length === 0 ? (
        <EmptyState title={t("compliance.schedules.empty")} body={t("compliance.schedules.emptyBody")} action={newButton} />
      ) : (
        <Card>
          <Table>
            <thead>
              <tr>
                <th>{t("compliance.schedules.col.name")}</th>
                <th>{t("compliance.schedules.col.type")}</th>
                <th>{t("compliance.schedules.col.cadence")}</th>
                <th>{t("compliance.schedules.col.next")}</th>
                <th>{t("compliance.schedules.col.last")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {schedules.map((s) => (
                <tr key={s.reportScheduleId} data-schedule={s.reportScheduleId}>
                  <td>
                    {canReport ? (
                      <Link className="text-accent hover:underline" to={`/compliance/reports/schedules/${s.reportScheduleId}`}>
                        {s.name}
                      </Link>
                    ) : (
                      s.name
                    )}
                  </td>
                  <td>{t(`compliance.reports.types.${s.reportTemplate.type}`, { defaultValue: s.reportTemplate.type })}</td>
                  <td className="whitespace-nowrap">{t(`compliance.schedules.every.${s.cadence}`, { day: s.dayOfPeriod, time: s.publishTime })}</td>
                  <td className="whitespace-nowrap">{s.enabled ? at(s.nextRunAt) : <Badge tone="neutral">{t("compliance.schedules.disabled")}</Badge>}</td>
                  <td>
                    <RunBadge run={s.lastRun} />
                  </td>
                  <td>
                    <div className="flex justify-end gap-2">
                      {canReport && <RunNow id={s.reportScheduleId} label={s.lastRun?.status === "FAILED" ? t("compliance.schedules.retry") : t("compliance.schedules.runNow")} />}
                      <ButtonLink to={`?runs=${s.reportScheduleId}`}>{t("compliance.schedules.history")}</ButtonLink>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pager page={page} totalPages={totalPages} />
        </Card>
      )}
      {runsOf && (
        <div className="mt-4">
          <Card title={t("compliance.schedules.historyOf", { name: selected?.name ?? runsOf })}>
            {runsFailed ? (
              <Alert tone="warning">{errorText(t, runsFailed)}</Alert>
            ) : runs.length === 0 ? (
              <EmptyState title={t("compliance.schedules.noRuns")} />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <th>{t("compliance.schedules.run.at")}</th>
                    <th>{t("compliance.schedules.run.trigger")}</th>
                    <th>{t("compliance.schedules.run.result")}</th>
                    <th>{t("compliance.schedules.run.report")}</th>
                    <th>{t("compliance.schedules.run.deliveries")}</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={r.runId} data-run={r.runId}>
                      <td className="whitespace-nowrap">{at(r.scheduledAt)}</td>
                      <td>{t(`compliance.schedules.trigger.${r.trigger}`)}</td>
                      <td>
                        <RunBadge run={r} />
                        {r.attempts > 1 && <span className="ml-1 text-[12px] text-muted">{t("compliance.schedules.attempts", { n: r.attempts })}</span>}
                      </td>
                      <td>
                        {r.reportId ? (
                          <Link className="text-accent hover:underline" to={`/compliance/reports/${r.reportId}${r.revisionNo ? `?rev=${r.revisionNo}` : ""}`}>
                            {t("compliance.schedules.openReport")}
                          </Link>
                        ) : (
                          "–"
                        )}
                      </td>
                      <td className="text-[12.5px]">
                        {r.deliveries.length
                          ? r.deliveries.map((d) => `${d.recipient} ${t(`compliance.schedules.delivery.${d.status}`, { defaultValue: d.status })}`).join(", ")
                          : "–"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
