/**
 * UI-FLW-18 스냅샷(FLW-11.02, UC-FLW-26, BR-FLW-32). 경로 가드 FLOW_WRITE, 제어 노드 포함 복원은 서버가 FLOW_DEPLOY_CONTROL 또는 승인 요청(202)으로 처리.
 * API: 생성 API-FLW-60, 목록·상세 API-FLW-61, 비교 API-FLW-62(`?compare=a&compare=b`), 복원 API-FLW-63(먼저 dryRun으로 영향 범위 확인 → 확인 후 적용).
 */
import { useTranslation } from "react-i18next";
import { Form, Link, data, useRouteLoaderData } from "react-router";
import { callApi, callList, field, listOrThrow, newIdempotencyKey } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { Alert, Button, ButtonLink, Card, CsrfField, EmptyState, PageHeader, Pager, Table, TextArea, TextField } from "~/components/ui";
import { FlowOpsTabs, SnapshotCompareView } from "~/features/flowops/components/parts";
import {
  SNAPSHOT_MEMO_MAX,
  SNAPSHOT_NAME_MAX,
  comparePair,
  normalizeCompare,
  normalizeRestore,
  validateSnapshot,
  type RestorePreview,
  type SnapshotDetail,
  type SnapshotErrors,
  type SnapshotRow,
} from "~/features/flowops/model/snapshot";
import { errorText } from "~/lib/error-text";
import { formatDateTime } from "~/lib/format";
import type { RootData } from "~/root";
import type { Route } from "./+types/flow-snapshots";

interface FlowOption {
  flowId: string;
  name: string;
  activeVersion: number | null;
  environment?: string;
}

export function meta() {
  return [{ title: "data2flow" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = bff(context);
  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const creating = url.searchParams.get("new") === "1";
  const detailId = url.searchParams.get("id");
  const pair = comparePair(url.searchParams.getAll("compare"));
  const [list, flows, detail, compare] = await Promise.all([
    callList<SnapshotRow>(ctx, request, `/api/v1/core/flow-snapshots?page=${page}&size=50`),
    creating ? callList<FlowOption>(ctx, request, "/api/v1/core/flows?size=100&sort=name") : Promise.resolve(null),
    detailId ? callApi<SnapshotDetail>(ctx, request, `/api/v1/core/flow-snapshots/${encodeURIComponent(detailId)}`) : Promise.resolve(null),
    pair ? callApi<unknown>(ctx, request, `/api/v1/core/flow-snapshots/compare?a=${encodeURIComponent(pair[0])}&b=${encodeURIComponent(pair[1])}`) : Promise.resolve(null),
  ]);
  return {
    list: listOrThrow(list),
    page,
    creating,
    flows: flows?.ok ? flows.list.responses.filter((f) => f.activeVersion) : [],
    detail: detail?.ok ? detail.data : null,
    pair: pair ?? null,
    compare: compare?.ok ? normalizeCompare(compare.data) : null,
    loadError: (detail && !detail.ok ? { code: detail.code } : null) ?? (compare && !compare.ok ? { code: compare.code } : null),
    selectionInvalid: url.searchParams.getAll("compare").length > 0 && !pair,
  };
}

type ActionData = {
  intent: string;
  created?: { snapshotId: string; items?: { flowId: string; version: number }[]; scripts?: { scriptId: string; version: number }[]; sinkConnections?: { id?: string; name: string }[] };
  fieldErrors?: SnapshotErrors;
  values?: { name: string; memo: string; flowIds: string[] };
  snapshotId?: string;
  preview?: RestorePreview;
  restored?: RestorePreview;
  approvalRequired?: boolean;
  error?: { code: string; message?: string };
};

export async function action({ request, context }: Route.ActionArgs) {
  const ctx = bff(context);
  const form = await request.formData();
  const intent = field(form, "intent");
  const fail = (status: number, body: ActionData) => data<ActionData>(body, { status });
  if (intent === "create") {
    const values = { name: field(form, "name").trim(), memo: field(form, "memo"), flowIds: form.getAll("flowIds").filter((v): v is string => typeof v === "string") };
    const fieldErrors = validateSnapshot(values);
    if (Object.keys(fieldErrors).length > 0) return fail(400, { intent, fieldErrors, values });
    const result = await callApi<ActionData["created"]>(ctx, request, "/api/v1/core/flow-snapshots", {
      method: "POST",
      body: { name: values.name, memo: values.memo || undefined, flowIds: [...new Set(values.flowIds)] },
      idempotencyKey: newIdempotencyKey(),
    });
    if (!result.ok) {
      if (result.code === "SNAPSHOT_NAME_DUPLICATED") return fail(result.status, { intent, values, fieldErrors: { name: "duplicated" } });
      return fail(result.status, { intent, values, error: { code: result.code, message: result.message } });
    }
    return { intent, created: result.data } satisfies ActionData;
  }
  if (intent === "previewRestore" || intent === "restore") {
    const snapshotId = field(form, "snapshotId");
    const dryRun = intent === "previewRestore";
    const result = await callApi<unknown>(ctx, request, `/api/v1/core/flow-snapshots/${encodeURIComponent(snapshotId)}/restore`, {
      method: "POST",
      body: { dryRun },
      idempotencyKey: dryRun ? undefined : newIdempotencyKey(),
    });
    if (!result.ok) return fail(result.status, { intent, snapshotId, error: { code: result.code, message: result.message } });
    // 제어 노드 포함 복원에 승인이 필요하면 202 FLOW_APPROVAL_REQUIRED(API-FLW-63)
    if (result.status === 202) return { intent, snapshotId, approvalRequired: true } satisfies ActionData;
    const normalized = normalizeRestore(result.data);
    return dryRun ? ({ intent, snapshotId, preview: normalized } satisfies ActionData) : ({ intent, snapshotId, restored: normalized } satisfies ActionData);
  }
  return fail(400, { intent, error: { code: "INVALID_REQUEST" } });
}

function NewSnapshotForm({ flows, result }: { flows: FlowOption[]; result?: ActionData }) {
  const { t } = useTranslation();
  const errors = result?.fieldErrors;
  const chosen = new Set(result?.values?.flowIds ?? []);
  return (
    <Card title={t("flowops.snapshots.newTitle")}>
      <Form method="post" className="flex flex-col gap-3">
        <CsrfField />
        <input type="hidden" name="intent" value="create" />
        <TextField label={t("flowops.snapshots.name")} name="name" maxLength={SNAPSHOT_NAME_MAX} defaultValue={result?.values?.name} error={errors?.name ? t(`flowops.snapshots.errors.name.${errors.name}`) : undefined} />
        <TextArea label={t("flowops.snapshots.memo")} name="memo" maxLength={SNAPSHOT_MEMO_MAX} defaultValue={result?.values?.memo} error={errors?.memo ? t("flowops.snapshots.errors.memo") : undefined} />
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-[12.5px] font-medium">{t("flowops.snapshots.flows")}</legend>
          {flows.length === 0 && <p className="text-[12.5px] text-muted">{t("flowops.snapshots.noActiveFlows")}</p>}
          {flows.map((f) => (
            <label key={f.flowId} className="flex items-center gap-2 text-[13px]">
              <input type="checkbox" name="flowIds" value={f.flowId} defaultChecked={chosen.has(f.flowId)} />
              {`${f.name} v${f.activeVersion}`}
            </label>
          ))}
          {errors?.flowIds && (
            <p role="alert" className="text-[12px] text-bad-ink">
              {t(`flowops.snapshots.errors.flowIds.${errors.flowIds}`)}
            </p>
          )}
        </fieldset>
        <p className="text-[12px] text-muted">{t("flowops.snapshots.bundleHint")}</p>
        <div className="flex justify-end gap-2">
          <ButtonLink to="/automation/snapshots">{t("common.cancel")}</ButtonLink>
          <Button type="submit" variant="primary">
            {t("flowops.snapshots.create")}
          </Button>
        </div>
      </Form>
    </Card>
  );
}

function RestorePreviewCard({ snapshotName, snapshotId, preview }: { snapshotName: string; snapshotId: string; preview: RestorePreview }) {
  const { t } = useTranslation();
  return (
    <Card title={t("flowops.snapshots.restoreTitle", { name: snapshotName })}>
      <div role="dialog" aria-label={t("flowops.snapshots.restoreTitle", { name: snapshotName })} className="flex flex-col gap-2 text-[13px]">
        <p>{t("flowops.snapshots.restoreFlows", { count: preview.affectedFlows.length })}</p>
        <ul className="list-disc pl-5">
          {preview.affectedFlows.map((f) => (
            <li key={f.flowId}>{f.fromVersion != null && f.toVersion != null ? t("flowops.snapshots.restoreFlowLine", { name: f.flowName, from: f.fromVersion, to: f.toVersion }) : f.flowName}</li>
          ))}
        </ul>
        {preview.resetNodeStates.length > 0 ? (
          <Alert tone="warning">{t("flowops.snapshots.restoreReset", { count: preview.resetNodeStates.length, nodes: preview.resetNodeStates.map((s) => s.nodeId).join(", ") })}</Alert>
        ) : (
          <p className="text-muted">{t("flowops.snapshots.restoreNoReset")}</p>
        )}
        <p className="text-[12px] text-muted">{t("flowops.snapshots.restoreLive")}</p>
        <Form method="post" className="flex justify-end gap-2">
          <CsrfField />
          <input type="hidden" name="snapshotId" value={snapshotId} />
          <ButtonLink to="/automation/snapshots">{t("common.cancel")}</ButtonLink>
          <Button type="submit" name="intent" value="restore" variant="primary">
            {t("flowops.snapshots.restoreConfirm")}
          </Button>
        </Form>
      </div>
    </Card>
  );
}

export default function FlowSnapshots({ loaderData, actionData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const root = useRouteLoaderData("root") as RootData | undefined;
  const tz = root?.timezone ?? "Asia/Seoul";
  const result = actionData as ActionData | undefined;
  const { list, detail, compare, pair } = loaderData;
  const rows = list.responses;
  const nameOf = (id: string) => rows.find((r) => r.snapshotId === id)?.name ?? id;
  const showForm = (loaderData.creating || (result?.intent === "create" && Boolean(result.values))) && !result?.created;
  return (
    <>
      <PageHeader crumb={t("nav.automation")} title={t("flowops.snapshots.title")} actions={<ButtonLink to="?new=1" variant="primary">{t("flowops.snapshots.new")}</ButtonLink>} />
      <FlowOpsTabs current="snapshots" />
      {result?.error && <Alert tone="danger">{errorText(t, result.error)}</Alert>}
      {loaderData.loadError && <Alert tone="danger">{errorText(t, loaderData.loadError)}</Alert>}
      {loaderData.selectionInvalid && <Alert tone="warning">{t("flowops.snapshots.pickTwo")}</Alert>}
      {result?.created && (
        <Alert tone="success">
          {t("flowops.snapshots.created", { flows: result.created.items?.length ?? 0, scripts: result.created.scripts?.length ?? 0, sinks: result.created.sinkConnections?.length ?? 0 })}
        </Alert>
      )}
      {result?.approvalRequired && <Alert tone="info">{t("flowops.snapshots.approvalRequired")}</Alert>}
      {result?.restored && (
        <Alert tone="success">
          {t("flowops.snapshots.restored", {
            versions: Object.entries(result.restored.appliedVersions)
              .map(([flowId, v]) => `${result.restored!.affectedFlows.find((f) => f.flowId === flowId)?.flowName ?? flowId} v${v}`)
              .join(", "),
          })}
        </Alert>
      )}
      <div className="flex flex-col gap-4">
        {showForm && <NewSnapshotForm flows={loaderData.flows} result={result?.intent === "create" ? result : undefined} />}
        {result?.preview && result.snapshotId && <RestorePreviewCard snapshotId={result.snapshotId} snapshotName={nameOf(result.snapshotId)} preview={result.preview} />}
        <Card>
          {rows.length === 0 ? (
            <EmptyState title={t("flowops.snapshots.empty")} />
          ) : (
            <Form method="get">
              <Table>
                <thead>
                  <tr>
                    <th>{t("flowops.snapshots.name")}</th>
                    <th>{t("flowops.snapshots.flowCount")}</th>
                    <th>{t("flowops.snapshots.createdBy")}</th>
                    <th>{t("flowops.snapshots.createdAt")}</th>
                    <th>{t("flowops.snapshots.memo")}</th>
                    <th>{t("flowops.snapshots.compare")}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.snapshotId}>
                      <td>
                        <Link to={`?id=${encodeURIComponent(row.snapshotId)}`} className="text-accent hover:underline">
                          {row.name}
                        </Link>
                      </td>
                      <td>{row.flowCount}</td>
                      <td>{row.createdBy?.name ?? "–"}</td>
                      <td>{formatDateTime(row.createdAt, tz, i18n.language)}</td>
                      <td className="max-w-[16rem] truncate text-muted">{row.memo ?? ""}</td>
                      <td>
                        <input type="checkbox" name="compare" value={row.snapshotId} defaultChecked={pair?.includes(row.snapshotId)} aria-label={t("flowops.snapshots.compareSelect", { name: row.name })} />
                      </td>
                      <td>
                        <Button type="submit" form={`restore-${row.snapshotId}`}>
                          {t("flowops.snapshots.restore")}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              <div className="mt-2 flex justify-end">
                <Button type="submit">{t("flowops.snapshots.compareRun")}</Button>
              </div>
            </Form>
          )}
          {rows.map((row) => (
            <Form key={row.snapshotId} id={`restore-${row.snapshotId}`} method="post" className="hidden">
              <CsrfField />
              <input type="hidden" name="intent" value="previewRestore" />
              <input type="hidden" name="snapshotId" value={row.snapshotId} />
            </Form>
          ))}
          <Pager page={loaderData.page} totalPages={list.totalPages} />
        </Card>
        {compare && pair && (
          <Card title={t("flowops.snapshots.compareTitle", { a: nameOf(pair[0]), b: nameOf(pair[1]) })}>
            <SnapshotCompareView compare={compare} names={[nameOf(pair[0]), nameOf(pair[1])]} />
          </Card>
        )}
        {detail && (
          <Card title={detail.name}>
            <dl className="grid gap-x-4 gap-y-1 text-[13px] md:grid-cols-[10rem_1fr]">
              <dt className="text-muted">{t("flowops.snapshots.flows")}</dt>
              <dd>{detail.flows.map((f) => `${f.flowName ?? f.flowId} v${f.version}`).join(", ") || "–"}</dd>
              <dt className="text-muted">{t("flowops.snapshots.scripts")}</dt>
              <dd>{detail.scripts.map((s) => `${s.scriptId} v${s.version}`).join(", ") || "–"}</dd>
              <dt className="text-muted">{t("flowops.snapshots.subflows")}</dt>
              <dd>{detail.subflows.map((s) => `${s.subflowId} v${s.version}`).join(", ") || "–"}</dd>
              <dt className="text-muted">{t("flowops.snapshots.variables")}</dt>
              <dd>{Object.keys(detail.variables ?? {}).join(", ") || "–"}</dd>
              <dt className="text-muted">{t("flowops.snapshots.sinkConnections")}</dt>
              <dd>{detail.sinkConnections.map((s) => s.name).join(", ") || "–"}</dd>
            </dl>
          </Card>
        )}
      </div>
    </>
  );
}
