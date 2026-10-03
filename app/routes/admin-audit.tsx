/**
 * UI-IAM-11 감사 로그(IAM-06.03, IAM-06.04, API-IAM-50·51·52). ADMIN(`AUDIT_READ`)만.
 * 기간(기본 최근 7일, 최대 1년)·행위자·행위·대상·결과·IP로 검색하고(커서 목록), CSV 내보내기는 비동기 작업이다.
 */
import { useTranslation } from "react-i18next";
import { Form, Link, data, useRouteLoaderData, useSearchParams } from "react-router";
import { callApi, callList, field, listOrThrow, newIdempotencyKey } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { getMe } from "~/bff/user.server";
import { Alert, Button, ButtonLink, Card, CsrfField, PageHeader, SelectField, Table, TextField } from "~/components/ui";
import { errorText } from "~/lib/error-text";
import { AUDIT_FILTERS as FILTERS, auditQuery } from "~/lib/audit";
import { formatDateTime, resolveTimezone } from "~/lib/format";
import type { RootData } from "~/root";
import type { Route } from "./+types/admin-audit";

interface AuditRow {
  id: string;
  occurredAt?: string;
  actorType?: string;
  actorId?: string;
  actorName?: string;
  action?: string;
  targetType?: string;
  targetId?: string;
  targetName?: string;
  result?: string;
  ip?: string;
}

interface AuditDetail extends AuditRow {
  requestId?: string;
  detail?: unknown;
  cause?: { flowId?: string; flowVersion?: number; nodeId?: string; triggerMessageId?: string; executionUrl?: string } | null;
}

export function meta() {
  return [{ title: "data2flow" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = bff(context);
  const url = new URL(request.url);
  const me = await getMe(ctx, request);
  const timezone = resolveTimezone(me.ok ? me.data.timezone : undefined);
  const { query, fromDate, toDate, tooLong } = auditQuery(url.searchParams, timezone, ctx.runtime.now());
  if (tooLong) return { rows: [], nextCursor: null, fromDate, toDate, tooLong, detail: null, idempotencyKey: newIdempotencyKey() };
  const cursor = url.searchParams.get("cursor");
  if (cursor) query.set("cursor", cursor);
  query.set("size", "50");
  const started = ctx.runtime.now();
  const list = listOrThrow(await callList<AuditRow>(ctx, request, `/api/v1/core/audit-logs?${query}`));
  const slow = ctx.runtime.now() - started > 3000;
  const id = url.searchParams.get("id");
  let detail: AuditDetail | null = null;
  if (id) {
    const result = await callApi<AuditDetail>(ctx, request, `/api/v1/core/audit-logs/${encodeURIComponent(id)}`);
    if (result.ok) detail = result.data;
  }
  return { rows: list.responses, nextCursor: list.nextCursor ?? null, fromDate, toDate, tooLong: false, slow, detail, idempotencyKey: newIdempotencyKey() };
}

export async function action({ request, context }: Route.ActionArgs) {
  const ctx = bff(context);
  const form = await request.formData();
  const me = await getMe(ctx, request);
  const timezone = resolveTimezone(me.ok ? me.data.timezone : undefined);
  const search = new URLSearchParams();
  for (const key of ["from", "to", ...FILTERS]) {
    const value = field(form, key);
    if (value) search.set(key, value);
  }
  const { query, tooLong } = auditQuery(search, timezone, ctx.runtime.now());
  if (tooLong) return data({ error: { code: "AUDIT_RANGE_TOO_LONG" } }, { status: 400 });
  const result = await callApi<{ jobId: string }>(ctx, request, "/api/v1/core/audit-logs/export", {
    method: "POST",
    idempotencyKey: field(form, "idempotencyKey") || newIdempotencyKey(),
    body: Object.fromEntries(query),
  });
  if (result.ok) return { jobId: result.data?.jobId ?? "" };
  return data({ error: { code: result.code, message: result.message } }, { status: result.status });
}

export default function AdminAudit({ loaderData, actionData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const [params] = useSearchParams();
  const root = useRouteLoaderData("root") as RootData;
  const result = actionData as { jobId?: string; error?: { code: string; message?: string } } | undefined;
  const fmt = (iso?: string) => formatDateTime(iso, root.timezone, i18n.language, true);
  const withParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value === null) next.delete(key);
    else next.set(key, value);
    return `?${next}`;
  };
  return (
    <>
      <PageHeader
        crumb={t("nav.admin")}
        title={t("nav.audit")}
        actions={
          <Form method="post">
            <CsrfField />
            <input type="hidden" name="idempotencyKey" value={loaderData.idempotencyKey} />
            <input type="hidden" name="from" value={loaderData.fromDate} />
            <input type="hidden" name="to" value={loaderData.toDate} />
            {FILTERS.map((key) => (
              <input key={key} type="hidden" name={key} value={params.get(key) ?? ""} />
            ))}
            <Button type="submit">{t("audit.export")}</Button>
          </Form>
        }
      />
      <div className="grid gap-4">
        {result?.jobId !== undefined && !result.error && <Alert tone="success">{t("audit.exportRequested", { jobId: result.jobId })}</Alert>}
        {result?.error && <Alert tone="danger">{result.error.code === "AUDIT_RANGE_TOO_LONG" ? t("audit.rangeTooLong") : errorText(t, result.error)}</Alert>}
        <Card>
          <Form method="get" className="flex flex-wrap items-end gap-2">
            <TextField label={t("audit.from")} name="from" type="date" defaultValue={loaderData.fromDate} />
            <TextField label={t("audit.to")} name="to" type="date" defaultValue={loaderData.toDate} />
            <SelectField label={t("audit.actorType")} name="actorType" defaultValue={params.get("actorType") ?? ""}>
              <option value="">{t("common.all")}</option>
              {["USER", "SERVICE", "FLOW"].map((v) => (
                <option key={v} value={v}>
                  {t(`audit.actorTypes.${v}`)}
                </option>
              ))}
            </SelectField>
            <TextField label={t("audit.actor")} name="actor" defaultValue={params.get("actor") ?? ""} />
            <TextField label={t("audit.action")} name="action" defaultValue={params.get("action") ?? ""} placeholder="USER_LOGGED_IN" />
            <TextField label={t("audit.targetType")} name="targetType" defaultValue={params.get("targetType") ?? ""} />
            <TextField label={t("audit.targetId")} name="targetId" defaultValue={params.get("targetId") ?? ""} />
            <SelectField label={t("audit.result")} name="result" defaultValue={params.get("result") ?? ""}>
              <option value="">{t("common.all")}</option>
              {["SUCCESS", "FAILURE"].map((v) => (
                <option key={v} value={v}>
                  {t(`audit.results.${v}`)}
                </option>
              ))}
            </SelectField>
            <TextField label="IP" name="ip" defaultValue={params.get("ip") ?? ""} />
            <Button type="submit" variant="primary">
              {t("common.search")}
            </Button>
          </Form>
        </Card>
        {loaderData.tooLong && <Alert tone="danger">{t("audit.rangeTooLong")}</Alert>}
        {loaderData.slow && <Alert tone="info">{t("audit.slowHint")}</Alert>}
        <Card>
          {loaderData.rows.length === 0 ? (
            <p className="py-6 text-center text-muted">{t("audit.empty")}</p>
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>{t("audit.time")}</th>
                  <th>{t("audit.actor")}</th>
                  <th>{t("audit.action")}</th>
                  <th>{t("audit.target")}</th>
                  <th>{t("audit.result")}</th>
                  <th>IP</th>
                </tr>
              </thead>
              <tbody>
                {loaderData.rows.map((row) => (
                  <tr key={row.id}>
                    <td className="whitespace-nowrap">
                      <Link to={withParam("id", row.id)} className="text-accent hover:underline">
                        {fmt(row.occurredAt)}
                      </Link>
                    </td>
                    <td>
                      <span className="text-muted">{row.actorType ? t(`audit.actorTypes.${row.actorType}`, { defaultValue: row.actorType }) : ""}</span>{" "}
                      {row.actorName ?? row.actorId ?? t("audit.unknownActor")}
                    </td>
                    <td className="font-mono text-[12px]">{row.action}</td>
                    <td>{row.targetName ?? [row.targetType, row.targetId].filter(Boolean).join(" ")}</td>
                    <td>{row.result ? t(`audit.results.${row.result}`, { defaultValue: row.result }) : ""}</td>
                    <td className="font-mono">{row.ip}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          {loaderData.nextCursor && (
            <div className="mt-3 flex justify-end">
              <ButtonLink to={withParam("cursor", loaderData.nextCursor)}>{t("common.next")}</ButtonLink>
            </div>
          )}
        </Card>
        {loaderData.detail && (
          <Card title={t("audit.detail")} actions={<ButtonLink to={withParam("id", null)}>{t("common.close")}</ButtonLink>}>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
              <dt className="text-muted">{t("audit.requestId")}</dt>
              <dd className="font-mono">{loaderData.detail.requestId ?? "–"}</dd>
              {loaderData.detail.cause?.flowId && (
                <>
                  <dt className="text-muted">{t("audit.cause")}</dt>
                  <dd>
                    {t("audit.causeFlow", { flowId: loaderData.detail.cause.flowId, version: loaderData.detail.cause.flowVersion ?? "", node: loaderData.detail.cause.nodeId ?? "" })}
                    {loaderData.detail.cause.executionUrl && (
                      <Link to={loaderData.detail.cause.executionUrl} className="ml-2 text-accent hover:underline">
                        {t("audit.viewExecution")}
                      </Link>
                    )}
                  </dd>
                </>
              )}
            </dl>
            <pre className="mt-3 overflow-x-auto rounded-md bg-bg p-3 font-mono text-[12px]">{JSON.stringify(loaderData.detail.detail ?? {}, null, 2)}</pre>
          </Card>
        )}
      </div>
    </>
  );
}
