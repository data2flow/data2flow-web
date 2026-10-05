/**
 * UI-FLW-19 승격 파이프라인(FLW-11.03, UC-FLW-27, BR-FLW-31) + UI-FLW-13 승격 대상 매핑(FLW-09.01~09.03, UC-FLW-21, BR-FLW-23).
 * 권한: 정의 FLOW_APPROVE(ADMIN), 요청 FLOW_WRITE, 단계 승인·반려 FLOW_APPROVE. 경로 가드는 FLOW_DEPLOY_CONTROL·FLOW_APPROVE.
 * API: 정의 API-FLW-64(GET·PUT `/flow-pipelines/{id}`), 요청 API-FLW-65, 승인·반려 API-FLW-66,
 * 시험 플로우 운영 승격 API-FLW-19(`/flows/{id}/promote`, 매핑 + 시나리오 조건).
 * 문서에 없는 목록 두 개를 쓴다: 파이프라인 목록 `GET /flow-pipelines`, 승격 요청 목록 `GET /flow-promotions?pipelineId=`(보고서에 기록).
 * 화면 상태는 쿼리로 연다: `?pipeline=`, `?edit=1`, `?request=1&snapshot=`, `?promotion=`, `?promote={flowId}`.
 */
import { useTranslation } from "react-i18next";
import { Form, Link, data, useRouteLoaderData } from "react-router";
import { callApi, callList, field, newIdempotencyKey } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { Alert, Badge, Button, ButtonLink, Card, CsrfField, EmptyState, PageHeader, SelectField, Table, TextField } from "~/components/ui";
import { ChecksList, FlowOpsTabs, MappingTable } from "~/features/flowops/components/parts";
import { buildMappingRows, chosenFromForm, type Candidate, type MappingRow, type Reference } from "~/features/flowops/model/mapping";
import {
  APPROVER_ROLES,
  STAGES_MAX,
  STAGE_ENVS,
  approvalBlock,
  defaultPipeline,
  hasPipelineErrors,
  nextStage,
  readPipelineForm,
  validatePipeline,
  type Pipeline,
  type PipelineErrors,
  type Promotion,
  type Stage,
} from "~/features/flowops/model/pipeline";
import type { SnapshotDetail, SnapshotRow } from "~/features/flowops/model/snapshot";
import { loadCandidates, loadReferences, loadScenarios, type ScenarioOption } from "~/features/flowops/server";
import { errorText } from "~/lib/error-text";
import { formatDateTime } from "~/lib/format";
import { hasAny } from "~/lib/permissions";
import type { RootData } from "~/root";
import type { Route } from "./+types/flow-pipelines";

interface FlowRow {
  flowId: string;
  name: string;
  environment?: string;
  activeVersion: number | null;
  draftVersion?: number | null;
  hasControlNode?: boolean;
}

interface MappingContext {
  references: Reference[];
  candidates: Record<string, Candidate[]>;
  failed: string[];
}

export function meta() {
  return [{ title: "data2flow" }];
}

async function mappingContext(ctx: Parameters<typeof loadReferences>[0], request: Request, flows: { flowId: string; version?: number | null }[]): Promise<MappingContext> {
  const { references, failed } = await loadReferences(ctx, request, flows);
  const candidates = await loadCandidates(ctx, request, new Set(references.map((r) => r.kind)));
  return { references, candidates, failed };
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = bff(context);
  const url = new URL(request.url);
  const q = url.searchParams;
  const pipelines = await callList<Pipeline>(ctx, request, "/api/v1/core/flow-pipelines?size=20");
  const pipelineList = pipelines.ok ? pipelines.list.responses : [];
  const selectedId = q.get("pipeline") ?? pipelineList[0]?.pipelineId ?? null;
  const selected = selectedId ? await callApi<Pipeline>(ctx, request, `/api/v1/core/flow-pipelines/${encodeURIComponent(selectedId)}`) : null;
  const pipeline = selected?.ok ? selected.data : null;
  const chosen = chosenFromForm(q);

  const [promotions, testFlows, snapshots] = await Promise.all([
    pipeline ? callList<Promotion>(ctx, request, `/api/v1/core/flow-promotions?pipelineId=${encodeURIComponent(pipeline.pipelineId)}&size=50`) : Promise.resolve(null),
    callList<FlowRow>(ctx, request, "/api/v1/core/flows?environment=TEST&size=100&sort=name"),
    q.get("request") === "1" ? callList<SnapshotRow>(ctx, request, "/api/v1/core/flow-snapshots?size=100") : Promise.resolve(null),
  ]);

  // 승격 요청 작성: 스냅샷을 고르면 그 안 플로우들의 참조로 매핑 표를 만든다
  let requestMapping: { snapshotId: string; rows: MappingRow[]; failed: string[] } | null = null;
  const snapshotId = q.get("snapshot");
  if (q.get("request") === "1" && snapshotId) {
    const snapshot = await callApi<SnapshotDetail>(ctx, request, `/api/v1/core/flow-snapshots/${encodeURIComponent(snapshotId)}`);
    if (snapshot.ok) {
      const m = await mappingContext(ctx, request, snapshot.data.flows.map((f) => ({ flowId: f.flowId, version: f.version })));
      requestMapping = { snapshotId, rows: buildMappingRows(m.references, m.candidates, chosen), failed: m.failed };
    }
  }

  // 시험 플로우 하나 운영 승격(API-FLW-19)
  let promote: { flow: FlowRow; version: number; rows: MappingRow[]; failed: string[]; scenarios: ScenarioOption[] } | null = null;
  const promoteId = q.get("promote");
  if (promoteId) {
    const flow = testFlows.ok ? testFlows.list.responses.find((f) => f.flowId === promoteId) : undefined;
    const version = flow?.activeVersion ?? flow?.draftVersion ?? null;
    if (flow && version) {
      const [m, scenarios] = await Promise.all([mappingContext(ctx, request, [{ flowId: flow.flowId, version }]), loadScenarios(ctx, request)]);
      promote = { flow, version, rows: buildMappingRows(m.references, m.candidates, chosen), failed: m.failed, scenarios };
    }
  }

  return {
    pipelines: pipelineList,
    pipelinesError: pipelines.ok ? null : { code: pipelines.code },
    pipeline,
    editing: q.get("edit") === "1",
    promotions: promotions?.ok ? promotions.list.responses : [],
    promotionsError: promotions && !promotions.ok ? { code: promotions.code } : null,
    selectedPromotion: q.get("promotion"),
    testFlows: testFlows.ok ? testFlows.list.responses : [],
    requesting: q.get("request") === "1",
    snapshots: snapshots?.ok ? snapshots.list.responses : [],
    requestMapping,
    promote,
    promoteMissing: Boolean(promoteId) && !promote,
  };
}

type ActionData = {
  intent: string;
  done?: boolean;
  pipelineErrors?: PipelineErrors;
  pipelineValues?: { name: string; stages: Stage[] };
  promotion?: { promotionId: string; status: string; checks?: { name: string; passed: boolean; detail?: string | null }[] };
  promoted?: { approvalId?: string | null; targetFlowId?: string };
  promotionId?: string;
  unmapped?: number;
  reasonError?: boolean;
  error?: { code: string; message?: string; details?: string[] };
};

/** 폼에 실린 참조 키(`refs` = `kind:id`)마다 매핑을 골랐는지 본다. 관계(RELATION)는 공간 매핑을 따른다 */
function mappingFromForm(form: FormData) {
  const chosen = chosenFromForm(form);
  const refs = form.getAll("refs").filter((v): v is string => typeof v === "string");
  const rows = refs
    .map((key) => {
      const index = key.indexOf(":");
      return { kind: key.slice(0, index), sourceId: key.slice(index + 1), targetId: chosen[key] ?? "" };
    })
    .filter((r) => r.kind !== "RELATION");
  return { rows, unmapped: rows.filter((r) => !r.targetId).length };
}

export async function action({ request, context }: Route.ActionArgs) {
  const ctx = bff(context);
  const form = await request.formData();
  const intent = field(form, "intent");
  const fail = (status: number, body: ActionData) => data<ActionData>(body, { status });
  const failure = (result: { status: number; code: string; message?: string; errors?: { field: string; code: string; message: string }[] }) =>
    fail(result.status, { intent, error: { code: result.code, message: result.message, details: (result.errors ?? []).map((e) => e.message || e.code) } });

  if (intent === "savePipeline") {
    const values = readPipelineForm(form);
    const errors = validatePipeline(values);
    if (hasPipelineErrors(errors)) return fail(400, { intent, pipelineErrors: errors, pipelineValues: values });
    const id = field(form, "pipelineId") || "default";
    const result = await callApi<Pipeline>(ctx, request, `/api/v1/core/flow-pipelines/${encodeURIComponent(id)}`, { method: "PUT", body: { ...values, baseVersion: Number(field(form, "baseVersion")) || 0 } });
    return result.ok ? ({ intent, done: true } satisfies ActionData) : failure(result);
  }
  if (intent === "requestPromotion") {
    const { rows, unmapped } = mappingFromForm(form);
    if (unmapped > 0) return fail(400, { intent, unmapped, error: { code: "FLOW_PROMOTION_BLOCKED" } });
    const result = await callApi<ActionData["promotion"]>(ctx, request, "/api/v1/core/flow-promotions", {
      method: "POST",
      body: { pipelineId: field(form, "pipelineId"), snapshotId: field(form, "snapshotId"), fromStage: field(form, "fromStage"), toStage: field(form, "toStage"), targetMappings: rows.map((r) => ({ from: r.sourceId, to: r.targetId })) },
      idempotencyKey: newIdempotencyKey(),
    });
    return result.ok ? ({ intent, done: true, promotion: result.data } satisfies ActionData) : failure(result);
  }
  if (intent === "approve" || intent === "reject") {
    const promotionId = field(form, "promotionId");
    const reason = field(form, "reason").trim();
    if (intent === "reject" && (!reason || reason.length > 500)) return fail(400, { intent, promotionId, reasonError: true });
    const result = await callApi(ctx, request, `/api/v1/core/flow-promotions/${encodeURIComponent(promotionId)}/${intent}`, { method: "POST", body: intent === "reject" ? { reason } : {} });
    return result.ok ? ({ intent, done: true, promotionId } satisfies ActionData) : failure(result);
  }
  if (intent === "promoteFlow") {
    const { rows, unmapped } = mappingFromForm(form);
    if (unmapped > 0) return fail(400, { intent, unmapped, error: { code: "FLOW_PROMOTION_BLOCKED" } });
    const flowId = field(form, "flowId");
    const scenarioId = field(form, "scenarioId");
    const result = await callApi<ActionData["promoted"]>(ctx, request, `/api/v1/core/flows/${encodeURIComponent(flowId)}/promote`, {
      method: "POST",
      body: { version: Number(field(form, "version")), mappings: rows, ...(scenarioId ? { scenarioId } : {}) },
      idempotencyKey: newIdempotencyKey(),
    });
    return result.ok ? ({ intent, done: true, promoted: result.data ?? {} } satisfies ActionData) : failure(result);
  }
  return fail(400, { intent, error: { code: "INVALID_REQUEST" } });
}

const PROMOTION_TONE: Record<string, "info" | "success" | "warning" | "danger" | "neutral"> = { PENDING: "info", CHECK_FAILED: "danger", APPROVED: "success", REJECTED: "neutral", APPLIED: "success" };

function StageDiagram({ stages }: { stages: Stage[] }) {
  const { t } = useTranslation();
  return (
    <ol className="flex flex-wrap items-start gap-2 text-[12.5px]" aria-label={t("flowops.pipelines.stages")}>
      {stages.map((s, i) => (
        <li key={s.key} className="flex items-start gap-2">
          {i > 0 && <span className="pt-1 text-muted">→</span>}
          <div className="rounded-md border border-line px-3 py-1.5">
            <p className="font-semibold">{`${s.key} · ${t(`flowops.pipelines.envs.${s.env}`)}`}</p>
            <p className="text-muted">{s.approvers.roles.length + s.approvers.userIds.length > 0 ? t("flowops.pipelines.approvers", { list: [...s.approvers.roles, ...s.approvers.userIds].join(", ") }) : t("flowops.pipelines.noApproval")}</p>
            {(s.checks.testRunRequired || s.checks.maxCommands > 0) && (
              <p className="text-muted">
                {[s.checks.testRunRequired ? t("flowops.pipelines.checkTestRun") : null, s.checks.maxCommands > 0 ? t("flowops.pipelines.checkCommands", { n: s.checks.maxCommands }) : null, s.checks.maxNotifications > 0 ? t("flowops.pipelines.checkNotifications", { n: s.checks.maxNotifications }) : null]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

function PipelineEditor({ pipeline, values, errors }: { pipeline: Pipeline | null; values: { name: string; stages: Stage[] }; errors?: PipelineErrors }) {
  const { t } = useTranslation();
  const rows = [...values.stages, ...Array.from({ length: Math.max(0, STAGES_MAX - values.stages.length) }, () => null)];
  return (
    <Card title={pipeline ? t("flowops.pipelines.editTitle", { name: pipeline.name }) : t("flowops.pipelines.newTitle")}>
      <Form method="post" className="flex flex-col gap-3">
        <CsrfField />
        <input type="hidden" name="intent" value="savePipeline" />
        <input type="hidden" name="pipelineId" value={pipeline?.pipelineId ?? "default"} />
        <input type="hidden" name="baseVersion" value={String(pipeline?.version ?? 0)} />
        <TextField label={t("flowops.pipelines.name")} name="name" maxLength={80} defaultValue={values.name} error={errors?.name ? t(`flowops.pipelines.errors.name.${errors.name}`) : undefined} />
        {errors?.stages && <Alert tone="danger">{t("flowops.pipelines.errors.stages")}</Alert>}
        <Table>
          <thead>
            <tr>
              <th>{t("flowops.pipelines.stageKey")}</th>
              <th>{t("flowops.pipelines.env")}</th>
              <th>{t("flowops.pipelines.approverRoles")}</th>
              <th>{t("flowops.pipelines.approverUsers")}</th>
              <th>{t("flowops.pipelines.checks")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((stage, i) => {
              const p = `stage.${i}.`;
              const e = errors?.stageErrors?.[i];
              return (
                <tr key={i}>
                  <td>
                    <input name={`${p}key`} defaultValue={stage?.key ?? ""} aria-label={t("flowops.pipelines.stageKeyOf", { n: i + 1 })} aria-invalid={Boolean(e?.key)} className="w-28 rounded-md border border-line bg-panel px-2 py-1 text-[13px] aria-[invalid=true]:border-bad" />
                    {e?.key && <p className="text-[12px] text-bad-ink">{t(`flowops.pipelines.errors.key.${e.key}`)}</p>}
                  </td>
                  <td>
                    <select name={`${p}env`} defaultValue={stage?.env ?? "TEST"} aria-label={t("flowops.pipelines.envOf", { n: i + 1 })} className="rounded-md border border-line bg-panel px-2 py-1 text-[13px]">
                      {STAGE_ENVS.map((env) => (
                        <option key={env} value={env}>
                          {t(`flowops.pipelines.envs.${env}`)}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    {APPROVER_ROLES.map((role) => (
                      <label key={role} className="mr-2 inline-flex items-center gap-1 text-[12.5px]">
                        <input type="checkbox" name={`${p}roles`} value={role} defaultChecked={stage?.approvers.roles.includes(role)} />
                        {role}
                      </label>
                    ))}
                  </td>
                  <td>
                    <input name={`${p}userIds`} defaultValue={stage?.approvers.userIds.join(", ") ?? ""} aria-label={t("flowops.pipelines.approverUsersOf", { n: i + 1 })} className="w-28 rounded-md border border-line bg-panel px-2 py-1 text-[13px]" />
                  </td>
                  <td className="text-[12.5px]">
                    <label className="mr-2 inline-flex items-center gap-1">
                      <input type="checkbox" name={`${p}testRunRequired`} defaultChecked={stage?.checks.testRunRequired} />
                      {t("flowops.pipelines.checkTestRun")}
                    </label>
                    <label className="mr-2 inline-flex items-center gap-1">
                      {t("flowops.pipelines.replayDays")}
                      <input name={`${p}replayDays`} inputMode="numeric" defaultValue={stage ? String(stage.checks.replayDays) : ""} className="w-12 rounded-md border border-line bg-panel px-1 py-0.5" />
                    </label>
                    <label className="mr-2 inline-flex items-center gap-1">
                      {t("flowops.pipelines.maxCommands")}
                      <input name={`${p}maxCommands`} inputMode="numeric" defaultValue={stage ? String(stage.checks.maxCommands) : ""} className="w-14 rounded-md border border-line bg-panel px-1 py-0.5" />
                    </label>
                    <label className="inline-flex items-center gap-1">
                      {t("flowops.pipelines.maxNotifications")}
                      <input name={`${p}maxNotifications`} inputMode="numeric" defaultValue={stage ? String(stage.checks.maxNotifications) : ""} className="w-14 rounded-md border border-line bg-panel px-1 py-0.5" />
                    </label>
                    {e?.checks && <p className="text-[12px] text-bad-ink">{t("flowops.pipelines.errors.checks")}</p>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
        <p className="text-[12px] text-muted">{t("flowops.pipelines.stageHint")}</p>
        <div className="flex justify-end gap-2">
          <ButtonLink to="/automation/pipelines">{t("common.cancel")}</ButtonLink>
          <Button type="submit" variant="primary">
            {t("common.save")}
          </Button>
        </div>
      </Form>
    </Card>
  );
}

function RefFields({ rows }: { rows: MappingRow[] }) {
  return (
    <>
      {rows.map((r) => (
        <input key={`${r.kind}:${r.sourceId}`} type="hidden" name="refs" value={`${r.kind}:${r.sourceId}`} />
      ))}
    </>
  );
}

export default function FlowPipelines({ loaderData, actionData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const root = useRouteLoaderData("root") as RootData | undefined;
  const tz = root?.timezone ?? "Asia/Seoul";
  const permissions = root?.me?.permissions;
  const canDefine = hasAny(permissions, ["FLOW_APPROVE"]);
  const canRequest = hasAny(permissions, ["FLOW_WRITE"]);
  const canApprove = hasAny(permissions, ["FLOW_APPROVE"]);
  const canGit = hasAny(permissions, ["GIT_SYNC_MANAGE"]);
  const result = actionData as ActionData | undefined;
  const { pipeline, promotions, requestMapping, promote } = loaderData;
  const selectedPromotion = promotions.find((p) => p.promotionId === loaderData.selectedPromotion);
  const showEditor = canDefine && (loaderData.editing || (result?.intent === "savePipeline" && !result.done));
  const editorValues = result?.pipelineValues ?? (pipeline ? { name: pipeline.name, stages: pipeline.stages } : defaultPipeline());
  const pipelineQuery = pipeline ? `pipeline=${encodeURIComponent(pipeline.pipelineId)}&` : "";
  return (
    <>
      <PageHeader
        crumb={t("nav.automation")}
        title={pipeline ? t("flowops.pipelines.titleOf", { name: pipeline.name }) : t("flowops.pipelines.title")}
        actions={
          <>
            {canGit && <ButtonLink to="/settings/git-sync">{t("flowops.git.title")}</ButtonLink>}
            {canDefine && <ButtonLink to={`?${pipelineQuery}edit=1`}>{pipeline ? t("flowops.pipelines.edit") : t("flowops.pipelines.create")}</ButtonLink>}
            {canRequest && pipeline && (
              <ButtonLink to={`?${pipelineQuery}request=1`} variant="primary">
                {t("flowops.pipelines.request")}
              </ButtonLink>
            )}
          </>
        }
      />
      <FlowOpsTabs current="pipelines" />
      {result?.error && (
        <Alert tone="danger">
          {result.unmapped ? t("flowops.mapping.unmapped", { count: result.unmapped }) : errorText(t, result.error)}
          {result.error.details && result.error.details.length > 0 && ` (${result.error.details.join(", ")})`}
        </Alert>
      )}
      {result?.done && result.intent === "savePipeline" && <Alert tone="success">{t("flowops.pipelines.saved")}</Alert>}
      {result?.promotion && (
        <Alert tone={result.promotion.status === "CHECK_FAILED" ? "warning" : "success"}>
          {result.promotion.status === "CHECK_FAILED" ? t("flowops.pipelines.requestCheckFailed") : t("flowops.pipelines.requested")}
        </Alert>
      )}
      {result?.done && (result.intent === "approve" || result.intent === "reject") && <Alert tone="success">{result.intent === "approve" ? t("flowops.pipelines.approved") : t("flowops.pipelines.rejected")}</Alert>}
      {result?.promoted && (
        <Alert tone="success">
          {result.promoted.approvalId ? t("flowops.promote.pendingApproval") : t("flowops.promote.done")}{" "}
          {result.promoted.targetFlowId && (
            <Link to={`/automation/flows/${encodeURIComponent(result.promoted.targetFlowId)}`} className="underline">
              {t("flowops.promote.openTarget")}
            </Link>
          )}
        </Alert>
      )}
      {loaderData.promotionsError && <Alert tone="danger">{errorText(t, loaderData.promotionsError)}</Alert>}
      <div className="flex flex-col gap-4">
        {loaderData.pipelines.length > 1 && (
          <nav className="flex flex-wrap gap-2 text-[13px]" aria-label={t("flowops.pipelines.list")}>
            {loaderData.pipelines.map((p) => (
              <Link key={p.pipelineId} to={`?pipeline=${encodeURIComponent(p.pipelineId)}`} aria-current={p.pipelineId === pipeline?.pipelineId ? "page" : undefined} className={p.pipelineId === pipeline?.pipelineId ? "font-semibold text-accent" : "text-muted"}>
                {p.name}
              </Link>
            ))}
          </nav>
        )}
        {showEditor && <PipelineEditor pipeline={pipeline} values={editorValues} errors={result?.pipelineErrors} />}
        {pipeline ? (
          <Card title={t("flowops.pipelines.stages")}>
            <StageDiagram stages={pipeline.stages} />
          </Card>
        ) : (
          !showEditor && <EmptyState title={t("flowops.pipelines.empty")} body={canDefine ? t("flowops.pipelines.emptyAdmin") : t("flowops.pipelines.emptyOther")} />
        )}

        {loaderData.requesting && pipeline && canRequest && (
          <Card title={t("flowops.pipelines.requestTitle")}>
            <Form method="get" className="mb-3 flex items-end gap-2">
              <input type="hidden" name="pipeline" value={pipeline.pipelineId} />
              <input type="hidden" name="request" value="1" />
              <SelectField label={t("flowops.pipelines.snapshot")} name="snapshot" defaultValue={requestMapping?.snapshotId ?? ""}>
                <option value="">{t("flowops.mapping.choose")}</option>
                {loaderData.snapshots.map((s) => (
                  <option key={s.snapshotId} value={s.snapshotId}>
                    {s.name}
                  </option>
                ))}
              </SelectField>
              <Button type="submit">{t("flowops.pipelines.loadMapping")}</Button>
            </Form>
            {requestMapping && (
              <Form method="post" className="flex flex-col gap-3">
                <CsrfField />
                <input type="hidden" name="intent" value="requestPromotion" />
                <input type="hidden" name="pipelineId" value={pipeline.pipelineId} />
                <input type="hidden" name="snapshotId" value={requestMapping.snapshotId} />
                <RefFields rows={requestMapping.rows} />
                <div className="flex flex-wrap gap-3">
                  <SelectField label={t("flowops.pipelines.fromStage")} name="fromStage" defaultValue={pipeline.stages[0]?.key}>
                    {pipeline.stages.slice(0, -1).map((s) => (
                      <option key={s.key} value={s.key}>
                        {`${s.key} → ${nextStage(pipeline, s.key)}`}
                      </option>
                    ))}
                  </SelectField>
                  <SelectField label={t("flowops.pipelines.toStage")} name="toStage" defaultValue={pipeline.stages[1]?.key}>
                    {pipeline.stages.slice(1).map((s) => (
                      <option key={s.key} value={s.key}>
                        {s.key}
                      </option>
                    ))}
                  </SelectField>
                </div>
                {requestMapping.failed.length > 0 && <Alert tone="warning">{t("flowops.mapping.referencesFailed", { count: requestMapping.failed.length })}</Alert>}
                <MappingTable
                  rows={requestMapping.rows}
                  submit={(blocked) => (
                    <div className="flex justify-end gap-2">
                      <Button type="submit" variant="primary" disabled={blocked}>
                        {t("flowops.pipelines.requestSubmit")}
                      </Button>
                    </div>
                  )}
                />
              </Form>
            )}
          </Card>
        )}

        {pipeline && (
          <Card title={t("flowops.pipelines.requests")}>
            {promotions.length === 0 ? (
              <EmptyState title={t("flowops.pipelines.noRequests")} />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <th>{t("flowops.pipelines.snapshot")}</th>
                    <th>{t("flowops.pipelines.stageMove")}</th>
                    <th>{t("flowops.pipelines.checks")}</th>
                    <th>{t("flowops.pipelines.status")}</th>
                    <th>{t("flowops.pipelines.requestedBy")}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {promotions.map((p) => (
                    <tr key={p.promotionId}>
                      <td>{p.snapshotName ?? p.snapshotId}</td>
                      <td>{`${p.fromStage} → ${p.toStage}`}</td>
                      <td>
                        <ChecksList checks={p.checks} />
                      </td>
                      <td>
                        <Badge tone={PROMOTION_TONE[p.status] ?? "neutral"}>{t(`flowops.pipelines.statuses.${p.status}`, { defaultValue: p.status })}</Badge>
                      </td>
                      <td>{p.requestedBy?.name ?? "–"}</td>
                      <td>
                        <ButtonLink to={`?${pipelineQuery}promotion=${encodeURIComponent(p.promotionId)}`}>{t("flowops.pipelines.detail")}</ButtonLink>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        )}

        {selectedPromotion && (
          <Card title={t("flowops.pipelines.requestDetail", { name: selectedPromotion.snapshotName ?? selectedPromotion.snapshotId })}>
            <div className="flex flex-col gap-3 text-[13px]">
              <p>{`${selectedPromotion.fromStage} → ${selectedPromotion.toStage} · ${t(`flowops.pipelines.statuses.${selectedPromotion.status}`, { defaultValue: selectedPromotion.status })}`}</p>
              <ChecksList checks={selectedPromotion.checks} />
              {(selectedPromotion.targetMappings ?? []).length > 0 && (
                <Table>
                  <thead>
                    <tr>
                      <th>{t("flowops.mapping.source")}</th>
                      <th>{t("flowops.mapping.target")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedPromotion.targetMappings!.map((m) => (
                      <tr key={`${m.from}-${m.to}`}>
                        <td>{m.from}</td>
                        <td>{m.to}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
              {selectedPromotion.decidedBy && <p className="text-muted">{t("flowops.pipelines.decided", { name: selectedPromotion.decidedBy.name, at: selectedPromotion.decidedAt ? formatDateTime(selectedPromotion.decidedAt, tz, i18n.language) : "–" })}</p>}
              {canApprove && (() => {
                const block = approvalBlock(selectedPromotion, root?.me?.id);
                return (
                  <div className="flex flex-col gap-2">
                    {block === "self" && <Alert tone="info">{t("errors.FLOW_PROMOTION_SELF_APPROVAL")}</Alert>}
                    {block === "checkFailed" && <Alert tone="warning">{t("flowops.pipelines.checkFailedBlock")}</Alert>}
                    {block !== "notPending" && (
                      <div className="flex flex-wrap items-end gap-2">
                        <Form method="post">
                          <CsrfField />
                          <input type="hidden" name="promotionId" value={selectedPromotion.promotionId} />
                          <Button type="submit" name="intent" value="approve" variant="primary" disabled={Boolean(block)}>
                            {t("flowops.pipelines.approve")}
                          </Button>
                        </Form>
                        <Form method="post" className="flex items-end gap-1">
                          <CsrfField />
                          <input type="hidden" name="promotionId" value={selectedPromotion.promotionId} />
                          <TextField label={t("flowops.pipelines.reason")} name="reason" maxLength={500} error={result?.reasonError ? t("flowops.pipelines.reasonRequired") : undefined} />
                          <Button type="submit" name="intent" value="reject" variant="danger">
                            {t("flowops.pipelines.reject")}
                          </Button>
                        </Form>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          </Card>
        )}

        <Card title={t("flowops.promote.sectionTitle")}>
          <p className="mb-2 text-[12.5px] text-muted">{t("flowops.promote.sectionBody")}</p>
          {loaderData.testFlows.length === 0 ? (
            <EmptyState title={t("flowops.promote.noTestFlows")} />
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>{t("flowops.promote.flow")}</th>
                  <th>{t("flowops.promote.version")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {loaderData.testFlows.map((f) => (
                  <tr key={f.flowId}>
                    <td>
                      <Link to={`/automation/flows/${encodeURIComponent(f.flowId)}`} className="text-accent hover:underline">
                        {f.name}
                      </Link>{" "}
                      {f.hasControlNode && <Badge tone="warning">{t("flowops.promote.control")}</Badge>}
                    </td>
                    <td>{f.activeVersion ? `v${f.activeVersion}` : f.draftVersion ? `v${f.draftVersion}` : "–"}</td>
                    <td>{canRequest && <ButtonLink to={`?${pipelineQuery}promote=${encodeURIComponent(f.flowId)}`}>{t("flowops.promote.open")}</ButtonLink>}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          {loaderData.promoteMissing && <Alert tone="warning">{t("flowops.promote.notTestFlow")}</Alert>}
        </Card>

        {promote && canRequest && (
          <Card title={t("flowops.promote.title", { name: promote.flow.name, version: promote.version })}>
            <Form method="post" className="flex flex-col gap-3">
              <CsrfField />
              <input type="hidden" name="intent" value="promoteFlow" />
              <input type="hidden" name="flowId" value={promote.flow.flowId} />
              <input type="hidden" name="version" value={String(promote.version)} />
              <RefFields rows={promote.rows} />
              {promote.failed.length > 0 && <Alert tone="warning">{t("flowops.mapping.referencesFailed", { count: promote.failed.length })}</Alert>}
              <SelectField label={t("flowops.promote.scenario")} name="scenarioId" defaultValue="">
                <option value="">{t("flowops.promote.noScenario")}</option>
                {promote.scenarios.map((s) => (
                  <option key={s.scenarioId} value={s.scenarioId}>
                    {s.lastRun ? t("flowops.promote.scenarioLast", { name: s.name, status: t(`flowops.promote.runStatus.${s.lastRun.status}`, { defaultValue: s.lastRun.status }) }) : s.name}
                  </option>
                ))}
              </SelectField>
              {promote.flow.hasControlNode && <Alert tone="warning">{t("flowops.promote.controlApproval")}</Alert>}
              <MappingTable
                rows={promote.rows}
                submit={(blocked) => (
                  <div className="flex justify-end gap-2">
                    <ButtonLink to={`/automation/pipelines${pipeline ? `?pipeline=${encodeURIComponent(pipeline.pipelineId)}` : ""}`}>{t("common.cancel")}</ButtonLink>
                    <Button type="submit" variant="primary" disabled={blocked}>
                      {t("flowops.promote.submit")}
                    </Button>
                  </div>
                )}
              />
            </Form>
          </Card>
        )}
      </div>
    </>
  );
}
