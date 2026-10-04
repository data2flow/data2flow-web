/**
 * UI-FLW-01 플로우 목록(FLW-01.06, FLW-08.04, FLW-05.05). 조회 FLOW_READ(ANALYST+), [새 플로우]·[템플릿에서 만들기]·상태 변경 FLOW_WRITE.
 * API: 목록 API-FLW-01(검색·상태·종류·공간 필터, 기본 정렬 health, 페이지 50), 상태 변경 API-FLW-09, 삭제 API-FLW-05(DRAFT·DISABLED만, 이름 입력 확인)
 */
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Form, Link, data, useNavigate, useRevalidator, useRouteLoaderData, useSearchParams } from "react-router";
import { callApi, callList, field, listOrThrow } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { Alert, Badge, Button, ButtonLink, Card, CsrfField, Dialog, EmptyState, PageHeader, Pager, SelectField, Table, TextField } from "~/components/ui";
import { SpaceSelect } from "~/components/space-picker";
import { FlowStatusBadge } from "~/features/flows/components/status-badge";
import { ownerMissing } from "~/features/flows/model/settings";
import { errorText } from "~/lib/error-text";
import { formatDateTime } from "~/lib/format";
import { hasAny } from "~/lib/permissions";
import { findSpace, type SpaceNode } from "~/lib/spaces";
import type { RootData } from "~/root";
import type { Route } from "./+types/flows";

interface FlowRow {
  flowId: string;
  name: string;
  kind: string;
  status: string;
  environment?: string;
  activeVersion?: number | null;
  draftVersion?: number | null;
  spaceIds?: string[];
  hasControlNode?: boolean;
  /** 엔진 지표 묶음 조회가 생기기 전까지 core가 생략한다 */
  metrics1h?: { executions?: number; errorRate?: number | null; actions?: number } | null;
  updatedBy?: { userId: string; name: string } | null;
  updatedAt?: string;
  /** FLW-11.06 설명서(목록 응답에 오면 보인다): 목적, 책임자(비활성이면 active=false) */
  purpose?: string | null;
  ownerUserId?: string | null;
  owner?: { userId: string; name: string; active?: boolean } | null;
}

const PAGE_SIZE = 50;
const STATUSES = ["ACTIVE", "PAUSED", "DEGRADED", "DRAFT", "DISABLED"];

export function meta() {
  return [{ title: "data2flow" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = bff(context);
  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const query = new URLSearchParams({ page: String(page), size: String(PAGE_SIZE), sort: url.searchParams.get("sort") || "health" });
  for (const key of ["q", "kind", "spaceId", "owner"]) {
    const value = url.searchParams.get(key)?.trim();
    if (value) query.set(key, value);
  }
  const status = url.searchParams.get("status");
  if (status) query.append("status", status);
  const [flows, spaces] = await Promise.all([callList<FlowRow>(ctx, request, `/api/v1/core/flows?${query}`), callApi<SpaceNode[]>(ctx, request, "/api/v1/core/spaces")]);
  return { page, list: listOrThrow(flows), spaces: spaces.ok ? (spaces.data ?? []) : [], filtered: ["q", "kind", "spaceId", "status", "owner"].some((k) => url.searchParams.get(k)) };
}

export async function action({ request, context }: Route.ActionArgs) {
  const ctx = bff(context);
  const form = await request.formData();
  const intent = field(form, "intent");
  const flowId = encodeURIComponent(field(form, "flowId"));
  if (!flowId) return data({ intent, error: { code: "INVALID_REQUEST" } }, { status: 400 });
  if (intent === "pause" || intent === "resume" || intent === "disable") {
    const result = await callApi(ctx, request, `/api/v1/core/flows/${flowId}/${intent}`, { method: "POST", body: {} });
    return result.ok ? { intent, done: true } : data({ intent, error: { code: result.code, message: result.message } }, { status: result.status });
  }
  if (intent === "delete") {
    if (field(form, "confirmName").trim() !== field(form, "name")) return data({ intent, fieldErrors: { confirmName: "mismatch" } }, { status: 400 });
    const result = await callApi(ctx, request, `/api/v1/core/flows/${flowId}`, { method: "DELETE" });
    return result.ok ? { intent, done: true, deleted: true } : data({ intent, error: { code: result.code, message: result.message } }, { status: result.status });
  }
  return data({ intent, error: { code: "INVALID_REQUEST" } }, { status: 400 });
}

export default function Flows({ loaderData, actionData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const root = useRouteLoaderData("root") as RootData | undefined;
  const canWrite = hasAny(root?.me?.permissions, ["FLOW_WRITE"]);
  const { list, spaces } = loaderData;
  const result = actionData as { intent?: string; done?: boolean; deleted?: boolean; error?: { code: string; message?: string }; fieldErrors?: Record<string, string> } | undefined;
  const deleting = list.responses.find((f) => f.flowId === params.get("delete"));
  const timezone = root?.timezone ?? "Asia/Seoul";

  // 실시간: 상태 배지와 실행 수는 30초마다 갱신(UI-FLW-01)
  useEffect(() => {
    const timer = setInterval(() => {
      if (revalidator.state === "idle") void revalidator.revalidate();
    }, 30_000);
    return () => clearInterval(timer);
  }, [revalidator]);

  const closeDelete = () => {
    const next = new URLSearchParams(params);
    next.delete("delete");
    navigate(`?${next}`);
  };

  return (
    <>
      <PageHeader
        crumb={t("flows.crumb")}
        title={t("flows.title")}
        actions={
          canWrite && (
            <>
              <ButtonLink to="/automation/approvals">{t("flows.approvals.title")}</ButtonLink>
              <ButtonLink to="/automation/templates">{t("flows.fromTemplate")}</ButtonLink>
              <ButtonLink to="/automation/flows/new" variant="primary">
                {t("flows.newFlow")}
              </ButtonLink>
            </>
          )
        }
      />
      {result?.error && <Alert tone="danger">{errorText(t, result.error)}</Alert>}
      {result?.done && <Alert tone="success">{result.deleted ? t("flows.list.deleted") : t("common.done")}</Alert>}
      <Card>
        <Form method="get" className="mb-3 flex flex-wrap items-end gap-2">
          <TextField label={t("flows.list.search")} name="q" defaultValue={params.get("q") ?? ""} />
          <SelectField label={t("flows.list.status")} name="status" defaultValue={params.get("status") ?? ""}>
            <option value="">{t("common.all")}</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`flows.status.${s}`)}
              </option>
            ))}
          </SelectField>
          <SelectField label={t("flows.list.kind")} name="kind" defaultValue={params.get("kind") ?? ""}>
            <option value="">{t("common.all")}</option>
            <option value="FLOW">{t("flows.kind.FLOW")}</option>
            <option value="RULE">{t("flows.kind.RULE")}</option>
          </SelectField>
          <SpaceSelect spaces={spaces} name="spaceId" label={t("flows.list.space")} emptyLabel={t("common.all")} defaultValue={params.get("spaceId") ?? ""} />
          {root?.me && (
            <SelectField label={t("flows.list.owner")} name="owner" defaultValue={params.get("owner") ?? ""}>
              <option value="">{t("common.all")}</option>
              <option value={root.me.id}>{t("flows.list.ownerMe")}</option>
            </SelectField>
          )}
          <Button type="submit">{t("common.search")}</Button>
        </Form>
        {list.responses.length === 0 ? (
          loaderData.filtered ? (
            <EmptyState title={t("flows.list.noMatch")} action={<ButtonLink to="/automation/flows">{t("common.reset")}</ButtonLink>} />
          ) : (
            <EmptyState title={t("flows.list.empty")} action={canWrite && <ButtonLink to="/automation/templates" variant="primary">{t("flows.fromTemplate")}</ButtonLink>} />
          )
        ) : (
          <Table>
            <thead>
              <tr>
                <th>{t("flows.list.col.status")}</th>
                <th>{t("flows.list.col.name")}</th>
                <th>{t("flows.list.col.kind")}</th>
                <th>{t("flows.list.col.space")}</th>
                <th>{t("flows.list.col.version")}</th>
                <th>{t("flows.list.col.executions")}</th>
                <th>{t("flows.list.col.errorRate")}</th>
                <th>{t("flows.list.col.actions")}</th>
                <th>{t("flows.list.col.updated")}</th>
                {canWrite && <th />}
              </tr>
            </thead>
            <tbody>
              {list.responses.map((f) => {
                const rate = f.metrics1h?.errorRate;
                return (
                  <tr key={f.flowId}>
                    <td>
                      <FlowStatusBadge status={f.status} />
                    </td>
                    <td>
                      <Link to={`/automation/flows/${encodeURIComponent(f.flowId)}`} className="text-accent hover:underline">
                        {f.name}
                      </Link>
                      {f.purpose && <p className="text-[11.5px] text-muted">{f.purpose}</p>}
                      {ownerMissing(f) && (
                        <span className="ml-1">
                          <Badge tone="warning">{t("flows.list.noOwner")}</Badge>
                        </span>
                      )}
                    </td>
                    <td>{t(`flows.kind.${f.kind}`, { defaultValue: f.kind })}</td>
                    <td>{(f.spaceIds ?? []).map((id) => findSpace(spaces, id)?.name ?? id).join(", ") || "–"}</td>
                    <td className="font-mono">{f.activeVersion ? `v${f.activeVersion}` : "–"}</td>
                    {/* metrics1h는 엔진 지표 묶음 조회가 생기기 전까지 오지 않는다(API-FLW-01): "지표 없음" */}
                    <td className="font-mono" title={f.metrics1h ? undefined : t("flows.list.metricsNone")}>{f.metrics1h?.executions == null ? "–" : f.metrics1h.executions.toLocaleString(i18n.language)}</td>
                    <td className={rate != null && rate >= 0.1 ? "font-mono text-bad" : "font-mono"}>{rate == null ? "–" : `${Math.round(rate * 100)}%`}</td>
                    <td className="font-mono">{f.metrics1h?.actions ?? "–"}</td>
                    <td>{f.updatedAt ? `${f.updatedBy?.name ?? ""} ${formatDateTime(f.updatedAt, timezone, i18n.language)}` : "–"}</td>
                    {canWrite && (
                      <td>
                        <div className="flex gap-1">
                          {(f.status === "ACTIVE" || f.status === "DEGRADED") && <RowAction intent="pause" flowId={f.flowId} label={t("flows.list.pause")} />}
                          {f.status === "PAUSED" && <RowAction intent="resume" flowId={f.flowId} label={t("flows.list.resume")} />}
                          {f.status !== "DISABLED" && f.status !== "DRAFT" && <RowAction intent="disable" flowId={f.flowId} label={t("flows.list.disable")} />}
                          {(f.status === "DRAFT" || f.status === "DISABLED") && <ButtonLink to={`?${new URLSearchParams({ ...Object.fromEntries(params), delete: f.flowId })}`}>{t("common.delete")}</ButtonLink>}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
        <Pager page={loaderData.page} totalPages={list.totalPages} />
      </Card>
      {deleting && canWrite && (
        <Dialog open title={t("flows.list.deleteTitle", { name: deleting.name })} onClose={closeDelete}>
          <Form method="post" className="flex flex-col gap-3">
            <CsrfField />
            <input type="hidden" name="intent" value="delete" />
            <input type="hidden" name="flowId" value={deleting.flowId} />
            <input type="hidden" name="name" value={deleting.name} />
            <p className="text-[13px]">{t("flows.list.deleteBody", { name: deleting.name })}</p>
            <TextField label={t("flows.list.confirmName")} name="confirmName" autoComplete="off" error={result?.fieldErrors?.confirmName ? t("flows.list.confirmMismatch") : undefined} />
            <div className="flex justify-end gap-2">
              <Button onClick={closeDelete}>{t("common.cancel")}</Button>
              <Button type="submit" variant="danger">
                {t("common.delete")}
              </Button>
            </div>
          </Form>
        </Dialog>
      )}
    </>
  );
}

function RowAction({ intent, flowId, label }: { intent: string; flowId: string; label: string }) {
  const { t } = useTranslation();
  return (
    <Form method="post" onSubmit={(e) => {
      // 확인 후 상태 변경(UI-FLW-01)
      if (typeof window !== "undefined" && !window.confirm(t("flows.list.confirmState", { action: label }))) e.preventDefault();
    }}>
      <CsrfField />
      <input type="hidden" name="intent" value={intent} />
      <input type="hidden" name="flowId" value={flowId} />
      <Button type="submit">{label}</Button>
    </Form>
  );
}
