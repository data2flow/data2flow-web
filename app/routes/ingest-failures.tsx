/**
 * 실패 메시지(DLQ) 화면(UI-ING-04, `/ingest/failures`, ING-07.03). 조회 OPERATOR 이상(INGEST_READ), 재처리·폐기 INTEGRATOR·ADMIN(INGEST_REPROCESS).
 * API: API-ING-08 목록(사유별 묶음·개별), API-ING-07 재처리, API-ING-11 폐기, API-ING-06 원본 상세(패널)
 */
import { useTranslation } from "react-i18next";
import { Form, Link, data, useActionData, useLoaderData, useRouteLoaderData, useSearchParams } from "react-router";
import { callApi, callList, field, newIdempotencyKey } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { Alert, Button, ButtonLink, Card, CountBadge, CsrfField, EmptyState, PageHeader, Pager, Tabs } from "~/components/ui";
import { IngestAreaTabs } from "~/features/ingest/area-tabs";
import { FailureItems, type FailureItem } from "~/features/ingest/failure-items";
import { ReprocessResultPanel } from "~/features/ingest/failures-panels";
import { FAILURE_STAGES, MAX_REPROCESS, PERIOD_DAYS, checkDiscardReason, periodRange, reprocessProblem, type ReprocessResult } from "~/features/ingest/model/ingest";
import { errorText } from "~/lib/error-text";
import { formatDateTime } from "~/lib/format";
import { hasAny } from "~/lib/permissions";
import type { RootData } from "~/root";
import type { Route } from "./+types/ingest-failures";

export function meta() {
  return [{ title: "data2flow" }];
}

interface FailureGroup {
  errorCode: string;
  count: number;
  firstAt?: string;
  lastAt?: string;
  sampleMessage?: string;
}

const PAGE_SIZE = 100;

function filters(url: URL, nowMs: number) {
  const stageParam = url.searchParams.get("stage") ?? "";
  const stage = (FAILURE_STAGES as readonly string[]).includes(stageParam) ? stageParam : "";
  const days = Number(url.searchParams.get("days")) || 7;
  return { stage, code: url.searchParams.get("code") ?? "", days, ...periodRange(days, nowMs) };
}

function query(f: ReturnType<typeof filters>, extra: Record<string, string>) {
  const q = new URLSearchParams({ status: "OPEN", from: f.from, to: f.to, ...extra });
  if (f.stage) q.set("stage", f.stage);
  return q;
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = bff(context);
  const url = new URL(request.url);
  const f = filters(url, ctx.runtime.now());
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const grouped = await callApi<{ groups: FailureGroup[]; countsByStage: Record<string, number> }>(ctx, request, `/api/v1/core/ingest/failures?${query(f, { groupBy: "errorCode" })}`);
  if (!grouped.ok) throw data({ code: grouped.code }, { status: grouped.status });
  let items: { responses: FailureItem[]; totalPages?: number; totalCount?: number } | null = null;
  if (f.code) {
    const listed = await callList<FailureItem>(ctx, request, `/api/v1/core/ingest/failures?${query(f, { groupBy: "none", errorCode: f.code, page: String(page), size: String(PAGE_SIZE) })}`);
    items = listed.ok ? listed.list : { responses: [] };
  }
  return { ...f, page, groups: grouped.data?.groups ?? [], countsByStage: grouped.data?.countsByStage ?? {}, items, idempotencyKey: newIdempotencyKey() };
}

type ActionResult =
  | { intent: "reprocess"; result?: ReprocessResult; error?: { code: string; message?: string } }
  | { intent: "discard"; discarded?: number; error?: { code: string; message?: string }; fieldError?: string }
  | { intent: string; error?: { code: string; message?: string }; fieldError?: string };

export async function action({ request, context }: Route.ActionArgs) {
  const ctx = bff(context);
  const form = await request.formData();
  const intent = field(form, "intent");
  let ids = form.getAll("dlqItemId").filter((v): v is string => typeof v === "string");
  const fail = (code: string, status: number, message?: string) => data({ intent, error: { code, message } } as ActionResult, { status });
  if (intent === "reprocess-group") {
    // 묶음 전체 재처리: 같은 오류 코드의 열린 항목 ID를 모아(최대 5,000) 재처리한다
    const f = filters(new URL(request.url), ctx.runtime.now());
    const code = field(form, "errorCode");
    ids = [];
    for (let page = 1; ids.length <= MAX_REPROCESS; page++) {
      const listed = await callList<FailureItem>(ctx, request, `/api/v1/core/ingest/failures?${query({ ...f, code }, { groupBy: "none", errorCode: code, page: String(page), size: "100" })}`);
      if (!listed.ok) return fail(listed.code, listed.status, listed.message);
      ids.push(...listed.list.responses.filter((i) => i.status === "OPEN").map((i) => String(i.id)));
      if (page >= (listed.list.totalPages ?? 1) || listed.list.responses.length === 0) break;
    }
  }
  if (intent === "reprocess" || intent === "reprocess-group") {
    const problem = reprocessProblem(ids.length);
    if (problem) return fail(problem === "tooMany" ? "ING_DLQ_BATCH_TOO_LARGE" : "INVALID_REQUEST", 400);
    const result = await callApi<ReprocessResult>(ctx, request, "/api/v1/core/ingest/failures/reprocess", { method: "POST", idempotencyKey: field(form, "idempotencyKey") || newIdempotencyKey(), body: { dlqItemIds: ids } });
    if (!result.ok) return fail(result.code, result.status, result.message);
    return { intent: "reprocess", result: result.data } as ActionResult;
  }
  if (intent === "discard") {
    const reason = field(form, "reason").trim();
    if (!checkDiscardReason(reason)) return data({ intent, fieldError: "reason" } as ActionResult, { status: 400 });
    if (reprocessProblem(ids.length)) return fail("INVALID_REQUEST", 400);
    const result = await callApi<{ discarded: number }>(ctx, request, "/api/v1/core/ingest/failures/discard", { method: "POST", body: { dlqItemIds: ids, reason } });
    if (!result.ok) return fail(result.code, result.status, result.message);
    return { intent, discarded: result.data?.discarded ?? ids.length } as ActionResult;
  }
  return fail("INVALID_REQUEST", 400);
}

export default function IngestFailures() {
  const { t, i18n } = useTranslation();
  const loaded = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>() as ActionResult | undefined;
  const root = useRouteLoaderData("root") as RootData | undefined;
  const [params] = useSearchParams();
  const timezone = root?.timezone ?? "Asia/Seoul";
  const canReprocess = hasAny(root?.me?.permissions, ["INGEST_REPROCESS"]);
  const link = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    next.delete("page");
    for (const [k, v] of Object.entries(changes)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    const q = next.toString();
    return q ? `?${q}` : "?";
  };
  const total = Object.values(loaded.countsByStage).reduce((a, b) => a + (b ?? 0), 0);
  const tabs = [
    { key: "", label: <>{t("ingest.failures.stageAll")}<CountBadge n={total} /></>, to: link({ stage: null, code: null }) },
    ...FAILURE_STAGES.map((s) => ({ key: s, label: <>{t(`ingest.failureStage.${s}`)}<CountBadge n={loaded.countsByStage[s] ?? 0} /></>, to: link({ stage: s, code: null }) })),
  ];
  return (
    <>
      <PageHeader
        crumb={t("nav.ingest")}
        title={t("ingest.failures.title")}
        actions={PERIOD_DAYS.map((d) => (
          <ButtonLink key={d} to={link({ days: String(d) })} variant={loaded.days === d ? "primary" : "secondary"}>
            {t("ingest.failures.days", { n: d })}
          </ButtonLink>
        ))}
      />
      <IngestAreaTabs current="failures" />
      <Tabs items={tabs} current={loaded.stage} />
      {result?.error && <Alert tone="danger">{errorText(t, result.error)}</Alert>}
      {result && "fieldError" in result && result.fieldError === "reason" && <Alert tone="danger">{t("ingest.failures.reasonRequired")}</Alert>}
      {result?.intent === "discard" && "discarded" in result && result.discarded !== undefined && <Alert tone="success">{t("ingest.failures.discarded", { n: result.discarded })}</Alert>}
      {result?.intent === "reprocess" && "result" in result && result.result && <ReprocessResultPanel result={result.result} />}
      {loaded.groups.length === 0 ? (
        <EmptyState title={t("ingest.failures.empty")} body={t("ingest.failures.emptyBody")} action={<ButtonLink to="/ingest/monitor">{t("ingest.area.monitor")}</ButtonLink>} />
      ) : (
        <div className="flex flex-col gap-3">
          {loaded.groups.map((group) => {
            const expanded = loaded.code === group.errorCode;
            const tooMany = group.count > MAX_REPROCESS;
            return (
              <Card
                key={group.errorCode}
                title={
                  <Link to={link({ code: expanded ? null : group.errorCode })} aria-expanded={expanded} className="font-mono hover:underline">
                    {expanded ? "▾" : "▸"} {group.errorCode}
                  </Link>
                }
                actions={
                  <>
                    <span className="text-[12.5px] text-muted">
                      {t("ingest.failures.groupCount", { n: group.count })} · {formatDateTime(group.firstAt, timezone, i18n.language)} ~ {formatDateTime(group.lastAt, timezone, i18n.language)}
                    </span>
                    {canReprocess && (
                      <Form method="post">
                        <CsrfField />
                        <input type="hidden" name="intent" value="reprocess-group" />
                        <input type="hidden" name="errorCode" value={group.errorCode} />
                        <input type="hidden" name="idempotencyKey" value={loaded.idempotencyKey} />
                        <Button type="submit" disabled={tooMany} title={tooMany ? t("ingest.failures.tooMany", { max: MAX_REPROCESS.toLocaleString("en-US") }) : undefined}>
                          {t("ingest.failures.reprocessGroup")}
                        </Button>
                      </Form>
                    )}
                  </>
                }
              >
                {group.sampleMessage && <p className="text-[12.5px] text-muted">{group.sampleMessage}</p>}
                {tooMany && canReprocess && <p className="text-[12.5px] text-bad">{t("ingest.failures.tooMany", { max: MAX_REPROCESS.toLocaleString("en-US") })}</p>}
                {expanded && loaded.items && (
                  <div className="mt-3">
                    <FailureItems items={loaded.items.responses} canReprocess={canReprocess} timezone={timezone} idempotencyKey={loaded.idempotencyKey} />
                    <Pager page={loaded.page} totalPages={loaded.items.totalPages} />
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
