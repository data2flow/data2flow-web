/**
 * UI-FLW-08 Sink 저장소 연결(FLW-04.01, BR-FLW-27·28). 권한 SINK_CONNECTION_MANAGE(ADMIN·INTEGRATOR, 경로 가드).
 * API: 목록·상세·생성·수정·삭제 API-FLW-50, 연결 테스트(저장 전·저장된 연결) API-FLW-51, 대상 스키마 확인, dead-letter 목록·재전송.
 * 비밀값(사용자·비밀번호·토큰)은 쓰기 전용 — 응답에 없고 폼에도 다시 채우지 않는다.
 * 화면 상태는 쿼리로 연다: `?edit=new&type=…`(등록), `?edit={id}`(수정·스키마 확인 `&target=`), `?deadLetters={id}`.
 */
import { useTranslation } from "react-i18next";
import { Form, Link, data, useRouteLoaderData } from "react-router";
import { callApi, callList, field, listOrThrow, newIdempotencyKey } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { Alert, Badge, Button, ButtonLink, Card, Checkbox, CsrfField, EmptyState, PageHeader, Pager, Table, TextField } from "~/components/ui";
import { FlowOpsTabs, SinkTestResultView } from "~/features/flowops/components/parts";
import {
  SINK_TYPES,
  createSinkBody,
  emptySinkForm,
  isValidTarget,
  readSinkForm,
  sinkFormFrom,
  testSinkBody,
  updateSinkBody,
  validateSinkForm,
  withoutSecrets,
  type SinkConnection,
  type SinkFieldErrors,
  type SinkFormValues,
  type SinkTestResult,
  type SinkType,
} from "~/features/flowops/model/sink";
import { errorText } from "~/lib/error-text";
import { formatDateTime } from "~/lib/format";
import type { RootData } from "~/root";
import type { Route } from "./+types/sink-connections";

interface DeadLetter {
  deadLetterId: string;
  flowId: string;
  nodeId: string;
  target: string;
  record: Record<string, unknown>;
  error: string;
  attempts: number;
  failedAt: string;
  expiresAt?: string;
}

export function meta() {
  return [{ title: "data2flow" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = bff(context);
  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const edit = url.searchParams.get("edit");
  const deadLettersOf = url.searchParams.get("deadLetters");
  const target = url.searchParams.get("target")?.trim() ?? "";
  const [list, detail, deadLetters] = await Promise.all([
    callList<SinkConnection>(ctx, request, `/api/v1/core/sink-connections?page=${page}&size=50`),
    edit && edit !== "new" ? callApi<SinkConnection>(ctx, request, `/api/v1/core/sink-connections/${encodeURIComponent(edit)}`) : Promise.resolve(null),
    deadLettersOf ? callList<DeadLetter>(ctx, request, `/api/v1/core/sink-connections/${encodeURIComponent(deadLettersOf)}/dead-letters?size=100`) : Promise.resolve(null),
  ]);
  let schema: { target: string; exists?: boolean; columns?: { name: string; type: string }[]; error?: { code: string; message?: string } } | null = null;
  if (detail?.ok && target) {
    if (!isValidTarget(target)) schema = { target, error: { code: "INVALID_REQUEST" } };
    else {
      const result = await callApi<{ exists: boolean; columns: { name: string; type: string }[] }>(ctx, request, `/api/v1/core/sink-connections/${encodeURIComponent(edit!)}/schema?target=${encodeURIComponent(target)}`);
      schema = result.ok ? { target, exists: result.data.exists, columns: result.data.columns ?? [] } : { target, error: { code: result.code, message: result.message } };
    }
  }
  const rawType = url.searchParams.get("type") ?? "";
  const newType = ((SINK_TYPES as readonly string[]).includes(rawType) ? rawType : "POSTGRESQL") as SinkType;
  return {
    list: listOrThrow(list),
    page,
    edit,
    newType,
    detail: detail?.ok ? detail.data : null,
    detailError: detail && !detail.ok ? { code: detail.code } : null,
    deadLettersOf,
    deadLetters: deadLetters?.ok ? deadLetters.list.responses : null,
    deadLettersError: deadLetters && !deadLetters.ok ? { code: deadLetters.code } : null,
    schema,
  };
}

type ActionData = {
  intent: string;
  done?: boolean;
  values?: SinkFormValues;
  fieldErrors?: SinkFieldErrors;
  test?: SinkTestResult | null;
  testFailure?: { code: string; message?: string };
  testedId?: string;
  resend?: { requested: number; resent: number; failed: number };
  error?: { code: string; message?: string };
};

export async function action({ request, context }: Route.ActionArgs) {
  const ctx = bff(context);
  const form = await request.formData();
  const intent = field(form, "intent");
  const id = field(form, "sinkConnectionId");
  const path = (suffix = "") => `/api/v1/core/sink-connections/${encodeURIComponent(id)}${suffix}`;
  const fail = (status: number, body: ActionData) => data<ActionData>(body, { status });

  if (intent === "test" || intent === "save") {
    const values = readSinkForm(form);
    const mode = intent === "test" ? "test" : id ? "update" : "create";
    const fieldErrors = validateSinkForm(values, mode);
    if (Object.keys(fieldErrors).length > 0) return fail(400, { intent, values: withoutSecrets(values), fieldErrors });
    if (intent === "test") {
      const result = await callApi<SinkTestResult>(ctx, request, "/api/v1/core/sink-connections/test", { method: "POST", body: testSinkBody(values) });
      if (!result.ok) return fail(result.status, { intent, values: withoutSecrets(values), test: null, testFailure: { code: result.code, message: result.message } });
      return { intent, values: withoutSecrets(values), test: result.data } satisfies ActionData;
    }
    const result = id
      ? await callApi<SinkConnection>(ctx, request, path(), { method: "PATCH", body: updateSinkBody(values, Number(field(form, "baseVersion")) || 0) })
      : await callApi<SinkConnection>(ctx, request, "/api/v1/core/sink-connections", { method: "POST", body: createSinkBody(values), idempotencyKey: newIdempotencyKey() });
    if (!result.ok) return fail(result.status, { intent, values: withoutSecrets(values), error: { code: result.code, message: result.message } });
    return { intent, done: true } satisfies ActionData;
  }
  if (intent === "testSaved") {
    const result = await callApi<SinkTestResult>(ctx, request, path("/test"), { method: "POST", body: {} });
    if (!result.ok) return fail(result.status, { intent, testedId: id, test: null, testFailure: { code: result.code, message: result.message } });
    return { intent, testedId: id, test: result.data } satisfies ActionData;
  }
  if (intent === "delete") {
    const result = await callApi(ctx, request, path(), { method: "DELETE" });
    return result.ok ? ({ intent, done: true } satisfies ActionData) : fail(result.status, { intent, error: { code: result.code, message: result.message } });
  }
  if (intent === "resend") {
    const all = field(form, "all") === "true";
    const ids = form.getAll("ids").filter((v): v is string => typeof v === "string" && v.length > 0);
    if (!all && ids.length === 0) return fail(400, { intent, error: { code: "FLOWOPS_SELECT_REQUIRED" } });
    const result = await callApi<{ requested: number; resent: number; failed: number }>(ctx, request, path("/dead-letters/resend"), { method: "POST", body: all ? { all: true } : { ids }, idempotencyKey: newIdempotencyKey() });
    return result.ok ? ({ intent, done: true, resend: result.data } satisfies ActionData) : fail(result.status, { intent, error: { code: result.code, message: result.message } });
  }
  return fail(400, { intent, error: { code: "INVALID_REQUEST" } });
}

const STATUS_TONE = { OK: "success", ERROR: "danger", UNTESTED: "neutral" } as const;

function SinkForm({ values, errors, detail, schema }: { values: SinkFormValues; errors?: SinkFieldErrors; detail: SinkConnection | null; schema: Awaited<ReturnType<typeof loader>>["schema"] }) {
  const { t } = useTranslation();
  const err = (key: keyof SinkFormValues) => (errors?.[key] ? t(`flowops.sinks.errors.${key}.${errors[key]}`, { defaultValue: t(`flowops.sinks.errors.${errors[key]}`) }) : undefined);
  const influx = values.type === "INFLUXDB";
  return (
    <Card title={detail ? t("flowops.sinks.editTitle", { name: detail.name }) : t("flowops.sinks.newTitle")}>
      {!detail && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-[13px]">
          <span className="text-muted">{t("flowops.sinks.type")}</span>
          {SINK_TYPES.map((type) => (
            <Link key={type} to={`?edit=new&type=${type}`} aria-current={type === values.type ? "true" : undefined} className={type === values.type ? "font-semibold text-accent" : "text-muted hover:text-text"}>
              {t(`flowops.sinks.types.${type}`)}
            </Link>
          ))}
        </div>
      )}
      <Form method="post" className="grid gap-3 md:grid-cols-2">
        <CsrfField />
        <input type="hidden" name="type" value={values.type} />
        {detail && <input type="hidden" name="sinkConnectionId" value={detail.sinkConnectionId} />}
        {detail && <input type="hidden" name="baseVersion" value={String(detail.version ?? 0)} />}
        <TextField label={t("flowops.sinks.name")} name="name" defaultValue={values.name} maxLength={100} error={err("name")} />
        <TextField label={t("flowops.sinks.host")} name="host" defaultValue={values.host} error={err("host")} />
        <TextField label={t("flowops.sinks.port")} name="port" inputMode="numeric" defaultValue={values.port} error={err("port")} />
        {influx ? (
          <>
            <TextField label={t("flowops.sinks.bucket")} name="bucket" defaultValue={values.bucket} error={err("bucket")} />
            <TextField label={t("flowops.sinks.org")} name="org" defaultValue={values.org} error={err("org")} />
            <TextField label={t("flowops.sinks.token")} name="token" type="password" autoComplete="off" error={err("token")} hint={detail ? t("flowops.sinks.secretKept") : undefined} />
          </>
        ) : (
          <>
            <TextField label={t("flowops.sinks.database")} name="database" defaultValue={values.database} error={err("database")} />
            <TextField label={t("flowops.sinks.username")} name="username" autoComplete="off" defaultValue={values.username} error={err("username")} hint={detail ? t("flowops.sinks.secretKept") : undefined} />
            <TextField label={t("flowops.sinks.password")} name="password" type="password" autoComplete="new-password" error={err("password")} hint={t("flowops.sinks.passwordHint")} />
          </>
        )}
        <Checkbox label={t("flowops.sinks.tls")} name="tls" defaultChecked={values.tls} />
        <div className="flex items-end justify-end gap-2 md:col-span-2">
          <ButtonLink to="/automation/sink-connections">{t("common.cancel")}</ButtonLink>
          <Button type="submit" name="intent" value="test">
            {t("flowops.sinks.test")}
          </Button>
          <Button type="submit" name="intent" value="save" variant="primary">
            {t("common.save")}
          </Button>
        </div>
      </Form>
      {detail && (
        <div className="mt-4 border-t border-line pt-3">
          <Form method="get" className="flex items-end gap-2">
            <input type="hidden" name="edit" value={detail.sinkConnectionId} />
            <TextField label={t("flowops.sinks.target")} name="target" defaultValue={schema?.target ?? ""} hint={t("flowops.sinks.targetHint")} />
            <Button type="submit">{t("flowops.sinks.checkSchema")}</Button>
          </Form>
          {schema?.error && <Alert tone="danger">{errorText(t, schema.error)}</Alert>}
          {schema && !schema.error && (
            <div className="mt-2 text-[13px]">
              {schema.exists ? (
                <>
                  <p>{t("flowops.sinks.schemaExists", { target: schema.target, count: schema.columns?.length ?? 0 })}</p>
                  <p className="text-muted">{(schema.columns ?? []).map((c) => `${c.name}: ${c.type}`).join(", ")}</p>
                </>
              ) : (
                <Alert tone="warning">{t("flowops.sinks.schemaMissing", { target: schema.target })}</Alert>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

export default function SinkConnections({ loaderData, actionData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const root = useRouteLoaderData("root") as RootData | undefined;
  const tz = root?.timezone ?? "Asia/Seoul";
  const result = actionData as ActionData | undefined;
  const { list, edit, detail, deadLetters, deadLettersOf, schema } = loaderData;
  const rows = list.responses;
  // 폼 제출 실패(검증·테스트 결과)면 주소에 ?edit가 없어도 폼을 다시 연다
  const formOpen = (Boolean(edit) || Boolean(result?.values)) && !(result?.intent === "save" && result.done);
  const formValues = result?.values ?? (detail ? sinkFormFrom(detail) : emptySinkForm(loaderData.newType));
  const deadLetterOwner = rows.find((r) => r.sinkConnectionId === deadLettersOf);
  return (
    <>
      <PageHeader crumb={t("nav.automation")} title={t("flowops.sinks.title")} actions={<ButtonLink to="?edit=new" variant="primary">{t("flowops.sinks.new")}</ButtonLink>} />
      <FlowOpsTabs current="sinks" />
      {result?.error && <Alert tone="danger">{errorText(t, result.error)}</Alert>}
      {result?.done && result.intent === "save" && <Alert tone="success">{t("flowops.sinks.saved")}</Alert>}
      {result?.done && result.intent === "delete" && <Alert tone="success">{t("flowops.sinks.deleted")}</Alert>}
      {result?.resend && <Alert tone={result.resend.failed > 0 ? "warning" : "success"}>{t("flowops.sinks.resendResult", result.resend)}</Alert>}
      {loaderData.detailError && <Alert tone="danger">{errorText(t, loaderData.detailError)}</Alert>}
      {(result?.intent === "test" || result?.intent === "testSaved") && (result.test !== undefined || result.testFailure) && (
        <div className="mb-3">
          {result.testedId && <p className="mb-1 text-[12.5px] text-muted">{rows.find((r) => r.sinkConnectionId === result.testedId)?.name}</p>}
          <SinkTestResultView result={result.test ?? null} failureMessage={result.testFailure?.message || (result.testFailure ? errorText(t, result.testFailure) : undefined)} />
        </div>
      )}
      <div className="flex flex-col gap-4">
        {formOpen && <SinkForm key={`${edit}:${formValues.type}`} values={formValues} errors={result?.fieldErrors} detail={detail} schema={schema} />}
        <Card>
          {rows.length === 0 ? (
            <EmptyState title={t("flowops.sinks.empty")} body={t("flowops.sinks.emptyBody")} />
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>{t("flowops.sinks.name")}</th>
                  <th>{t("flowops.sinks.type")}</th>
                  <th>{t("flowops.sinks.status")}</th>
                  <th>{t("flowops.sinks.lastError")}</th>
                  <th>{t("flowops.sinks.usedFlows")}</th>
                  <th>{t("flowops.sinks.updatedAt")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.sinkConnectionId}>
                    <td>
                      <Link to={`?edit=${encodeURIComponent(row.sinkConnectionId)}`} className="text-accent hover:underline">
                        {row.name}
                      </Link>
                    </td>
                    <td>{t(`flowops.sinks.types.${row.type}`, { defaultValue: row.type })}</td>
                    <td>
                      <Badge tone={STATUS_TONE[row.status] ?? "neutral"}>{t(`flowops.sinks.statuses.${row.status}`, { defaultValue: row.status })}</Badge>
                    </td>
                    <td className="max-w-[18rem] truncate text-muted" title={row.lastError ?? undefined}>
                      {row.lastError ?? "–"}
                    </td>
                    <td>{row.usedFlowCount ?? 0}</td>
                    <td>{row.updatedAt ? formatDateTime(row.updatedAt, tz, i18n.language) : "–"}</td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        <Form method="post">
                          <CsrfField />
                          <input type="hidden" name="sinkConnectionId" value={row.sinkConnectionId} />
                          <Button type="submit" name="intent" value="testSaved">
                            {t("flowops.sinks.test")}
                          </Button>
                        </Form>
                        <ButtonLink to={`?deadLetters=${encodeURIComponent(row.sinkConnectionId)}`}>{t("flowops.sinks.deadLetters")}</ButtonLink>
                        <Form method="post">
                          <CsrfField />
                          <input type="hidden" name="sinkConnectionId" value={row.sinkConnectionId} />
                          <Button type="submit" name="intent" value="delete" variant="danger" disabled={(row.usedFlowCount ?? 0) > 0} title={(row.usedFlowCount ?? 0) > 0 ? t("errors.SINK_CONNECTION_IN_USE") : undefined}>
                            {t("common.delete")}
                          </Button>
                        </Form>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          <Pager page={loaderData.page} totalPages={list.totalPages} />
        </Card>
        {deadLettersOf && (
          <Card title={t("flowops.sinks.deadLettersOf", { name: deadLetterOwner?.name ?? deadLettersOf })}>
            {loaderData.deadLettersError && <Alert tone="danger">{errorText(t, loaderData.deadLettersError)}</Alert>}
            {deadLetters && deadLetters.length === 0 && <EmptyState title={t("flowops.sinks.deadLettersEmpty")} />}
            {deadLetters && deadLetters.length > 0 && (
              <Form method="post" className="flex flex-col gap-2">
                <CsrfField />
                <input type="hidden" name="sinkConnectionId" value={deadLettersOf} />
                <Table>
                  <thead>
                    <tr>
                      <th />
                      <th>{t("flowops.sinks.dlTarget")}</th>
                      <th>{t("flowops.sinks.dlError")}</th>
                      <th>{t("flowops.sinks.dlAttempts")}</th>
                      <th>{t("flowops.sinks.dlFailedAt")}</th>
                      <th>{t("flowops.sinks.dlRecord")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deadLetters.map((d) => (
                      <tr key={d.deadLetterId}>
                        <td>
                          <input type="checkbox" name="ids" value={d.deadLetterId} aria-label={t("flowops.sinks.dlSelect", { id: d.deadLetterId })} />
                        </td>
                        <td>{d.target}</td>
                        <td className="text-bad">{d.error}</td>
                        <td>{d.attempts}</td>
                        <td>{formatDateTime(d.failedAt, tz, i18n.language)}</td>
                        <td className="max-w-[16rem] truncate font-mono text-[12px]">{JSON.stringify(d.record)}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
                <div className="flex justify-end gap-2">
                  <input type="hidden" name="intent" value="resend" />
                  <Button type="submit">{t("flowops.sinks.resendSelected")}</Button>
                  <Button type="submit" name="all" value="true" variant="primary">
                    {t("flowops.sinks.resendAll")}
                  </Button>
                </div>
              </Form>
            )}
          </Card>
        )}
      </div>
    </>
  );
}
