/**
 * UI-FLW-15 승인 대기(FLW-05.06, 제어 노드 배포 승인). 목록은 FLOW_WRITE(자기 요청)·FLOW_APPROVE(전체), [승인]·[거절(사유 필수)]은 ADMIN(FLOW_APPROVE).
 * API: API-FLW-24 목록(`status=PENDING`)·승인·거절
 */
import { useTranslation } from "react-i18next";
import { Form, Link, data, useRouteLoaderData } from "react-router";
import { callApi, callList, field, listOrThrow } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { Alert, Badge, Button, ButtonLink, Card, CsrfField, EmptyState, PageHeader, Table, TextField } from "~/components/ui";
import { errorText } from "~/lib/error-text";
import { formatDateTime } from "~/lib/format";
import { hasAny } from "~/lib/permissions";
import type { RootData } from "~/root";
import type { Route } from "./+types/flow-approvals";

interface ApprovalRow {
  approvalId: string;
  flowId: string;
  flowName: string;
  version: number;
  kind: "APPLY" | "PROMOTE";
  status: string;
  hasControlNode?: boolean;
  requestedBy?: { userId: string; name: string };
  requestedAt?: string;
}

const REASON_MAX = 500;

export function meta() {
  return [{ title: "data2flow" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const list = await callList<ApprovalRow>(bff(context), request, "/api/v1/core/flows/approvals?status=PENDING");
  return { list: listOrThrow(list) };
}

export async function action({ request, context }: Route.ActionArgs) {
  const ctx = bff(context);
  const form = await request.formData();
  const intent = field(form, "intent");
  const id = encodeURIComponent(field(form, "approvalId"));
  if (intent === "approve") {
    const result = await callApi(ctx, request, `/api/v1/core/flow-approvals/${id}/approve`, { method: "POST", body: {} });
    return result.ok ? { intent, done: true } : data({ intent, error: { code: result.code, message: result.message } }, { status: result.status });
  }
  if (intent === "reject") {
    const reason = field(form, "reason").trim();
    if (!reason || reason.length > REASON_MAX) return data({ intent, approvalId: field(form, "approvalId"), fieldErrors: { reason: "required" } }, { status: 400 });
    const result = await callApi(ctx, request, `/api/v1/core/flow-approvals/${id}/reject`, { method: "POST", body: { reason } });
    return result.ok ? { intent, done: true } : data({ intent, error: { code: result.code, message: result.message } }, { status: result.status });
  }
  return data({ intent, error: { code: "INVALID_REQUEST" } }, { status: 400 });
}

export default function FlowApprovals({ loaderData, actionData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const root = useRouteLoaderData("root") as RootData | undefined;
  const canApprove = hasAny(root?.me?.permissions, ["FLOW_APPROVE"]);
  const result = actionData as { intent?: string; done?: boolean; approvalId?: string; error?: { code: string; message?: string }; fieldErrors?: Record<string, string> } | undefined;
  const rows = loaderData.list.responses;
  return (
    <>
      <PageHeader crumb={t("flows.crumb")} title={t("flows.approvals.title")} actions={<ButtonLink to="/automation/flows">{t("flows.title")}</ButtonLink>} />
      {result?.error && <Alert tone="danger">{errorText(t, result.error)}</Alert>}
      {result?.done && <Alert tone="success">{result.intent === "approve" ? t("flows.approvals.approved") : t("flows.approvals.rejected")}</Alert>}
      {!canApprove && <p className="mb-2 text-[12.5px] text-muted">{t("flows.approvals.ownOnly")}</p>}
      <Card>
        {rows.length === 0 ? (
          <EmptyState title={t("flows.approvals.empty")} />
        ) : (
          <Table>
            <thead>
              <tr>
                <th>{t("flows.approvals.flow")}</th>
                <th>{t("flows.approvals.kind")}</th>
                <th>{t("flows.approvals.requestedBy")}</th>
                <th>{t("flows.approvals.requestedAt")}</th>
                {canApprove && <th />}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.approvalId}>
                  <td>
                    <Link to={`/automation/flows/${encodeURIComponent(row.flowId)}`} className="text-accent hover:underline">
                      {`${row.flowName} v${row.version}`}
                    </Link>{" "}
                    {row.hasControlNode && <Badge tone="warning">{t("flows.approvals.control")}</Badge>}
                  </td>
                  <td>{t(`flows.approvals.kinds.${row.kind}`, { defaultValue: row.kind })}</td>
                  <td>{row.requestedBy?.name ?? "–"}</td>
                  <td>{row.requestedAt ? formatDateTime(row.requestedAt, root?.timezone ?? "Asia/Seoul", i18n.language) : "–"}</td>
                  {canApprove && (
                    <td>
                      <div className="flex flex-wrap items-end gap-2">
                        <Form method="post">
                          <CsrfField />
                          <input type="hidden" name="intent" value="approve" />
                          <input type="hidden" name="approvalId" value={row.approvalId} />
                          <Button type="submit" variant="primary">
                            {t("flows.approvals.approve")}
                          </Button>
                        </Form>
                        <Form method="post" className="flex items-end gap-1">
                          <CsrfField />
                          <input type="hidden" name="intent" value="reject" />
                          <input type="hidden" name="approvalId" value={row.approvalId} />
                          <TextField label={t("flows.approvals.reason")} name="reason" maxLength={REASON_MAX} error={result?.fieldErrors?.reason && result.approvalId === row.approvalId ? t("flows.approvals.reasonRequired") : undefined} />
                          <Button type="submit" variant="danger">
                            {t("flows.approvals.reject")}
                          </Button>
                        </Form>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
