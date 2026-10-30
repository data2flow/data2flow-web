/**
 * UI-CMP-10 개선 조치 기록(`/compliance/excursions/{id}?edit=actionId`, CMP-02.05). 조회 CMP_READ, 기록·수정·삭제는 CMP_ACTION(OPERATOR+).
 * 위쪽은 대상 이탈(공간·항목·기간·최고값)과 기록된 조치, 아래는 원인·조치 내용·조치자·조치 일시·연결(알람·작업 지시)·결과 확인 입력이다.
 * [작업 지시 만들기]는 작업 지시(API-DEV-08)를 만들어 연결 목록에 넣는다. 자동 확인은 조치 후 24시간이 지나야 결과가 채워진다(BR-CMP-18).
 * API: 이탈 구간·조치 조회(GET /core/compliance/excursions/{id}), 기록·수정·삭제 API-CMP-23.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Form, Link, data, redirect, useNavigation, useRouteLoaderData } from "react-router";
import { callApi, field, newIdempotencyKey, orThrow } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { getMe } from "~/bff/user.server";
import { Alert, Badge, Button, ButtonLink, Card, CsrfField, EmptyState, PageHeader, SelectField, TextArea, TextField } from "~/components/ui";
import { metricName } from "~/features/compliance/components/score-card";
import { actionBody, CAUSES, parseIds, RESULT_MODES, resultSummary, validateActionForm, type ActionForm, type CorrectiveAction, type ExcursionDetail } from "~/features/compliance/model/actions";
import { isoToZonedLocal, zonedLocalToIso } from "~/features/ingest/model/m5";
import { loadUsers } from "~/features/notify/server";
import { errorText } from "~/lib/error-text";
import { formatDateTime, formatNumber, resolveTimezone } from "~/lib/format";
import { hasAny } from "~/lib/permissions";
import type { RootData } from "~/root";
import type { Route } from "./+types/compliance-excursion-actions";

export function meta() {
  return [{ title: "data2flow" }];
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const ctx = bff(context);
  const url = new URL(request.url);
  const [excursion, me] = await Promise.all([
    callApi<ExcursionDetail>(ctx, request, `/api/v1/core/compliance/excursions/${encodeURIComponent(params.excursionId)}`),
    getMe(ctx, request),
  ]);
  const detail = orThrow(excursion);
  const canAction = hasAny(me.ok ? me.data.permissions : [], ["CMP_ACTION"]);
  const users = canAction ? await loadUsers(ctx, request) : { users: [], available: false };
  const editId = url.searchParams.get("edit");
  return {
    excursion: detail,
    editing: editId ? (detail.actions.find((a) => a.actionId === editId) ?? null) : null,
    users: users.users,
    me: me.ok ? { userId: String(me.data.id), name: me.data.name ?? me.data.loginId } : null,
    timezone: resolveTimezone(me.ok ? me.data.timezone : undefined),
    nowIso: new Date(ctx.runtime.now()).toISOString(),
    idempotencyKey: newIdempotencyKey(),
  };
}

type ActionResult = { intent: string; fieldErrors?: Record<string, string>; error?: { code: string; message?: string }; values?: ActionForm; actionId?: string };

function readForm(form: FormData): ActionForm {
  return {
    cause: field(form, "cause"),
    causeNote: field(form, "causeNote"),
    actionText: field(form, "actionText"),
    actorUserId: field(form, "actorUserId"),
    actedAt: field(form, "actedAt"),
    linkedAlarmIds: parseIds(field(form, "linkedAlarmIds")),
    linkedWorkOrderIds: parseIds(field(form, "linkedWorkOrderIds")),
    resultMode: field(form, "resultMode") || "AUTO",
    resultNote: field(form, "resultNote"),
  };
}

/** 서버 오류 코드를 고칠 필드로 */
const FIELD_OF: Record<string, [string, string]> = {
  WORKORDER_NOT_FOUND: ["linkedWorkOrderIds", "workOrderNotFound"],
  ALARM_NOT_FOUND: ["linkedAlarmIds", "alarmNotFound"],
};

export async function action({ request, context, params }: Route.ActionArgs) {
  const ctx = bff(context);
  const form = await request.formData();
  const intent = field(form, "intent");
  const excursionId = encodeURIComponent(params.excursionId);
  const path = `/compliance/excursions/${excursionId}`;
  const actionId = field(form, "actionId");
  const fail = (failure: { code: string; message?: string; status: number }, values?: ActionForm) => {
    const mapped = FIELD_OF[failure.code];
    return data<ActionResult>(
      { intent, values, actionId, fieldErrors: mapped ? { [mapped[0]]: mapped[1] } : undefined, error: mapped ? undefined : { code: failure.code, message: failure.message } },
      { status: failure.status },
    );
  };
  if (intent === "delete") {
    const result = await callApi(ctx, request, `/api/v1/core/compliance/actions/${encodeURIComponent(actionId)}`, { method: "DELETE" });
    if (!result.ok) return fail(result);
    throw redirect(path);
  }
  const me = await getMe(ctx, request);
  const timezone = resolveTimezone(me.ok ? me.data.timezone : undefined);
  const values = readForm(form);
  if (intent === "createWorkOrder") {
    // 작업 지시를 만들어 연결 목록에 넣는다(저장은 [저장]에서)
    const excursion = await callApi<ExcursionDetail>(ctx, request, `/api/v1/core/compliance/excursions/${excursionId}`);
    if (!excursion.ok) return fail(excursion, values);
    const x = excursion.data;
    const created = await callApi<{ id: string }>(ctx, request, "/api/v1/core/work-orders", {
      method: "POST",
      body: { title: `${x.spaceName ?? x.spaceId} ${x.metricKey} 기준 이탈 조치`.slice(0, 150), type: "INSPECTION", priority: "NORMAL", targets: [{ spaceId: x.spaceId }], origin: "MANUAL" },
      idempotencyKey: newIdempotencyKey(),
    });
    if (!created.ok) return fail(created, values);
    return data<ActionResult>({ intent, actionId, values: { ...values, linkedWorkOrderIds: [...new Set([...values.linkedWorkOrderIds, String(created.data.id)])] } });
  }
  if (intent !== "save") return data<ActionResult>({ intent: intent || "unknown" }, { status: 400 });
  const startedAt = field(form, "startedAt");
  const actedAtIso = zonedLocalToIso(values.actedAt, timezone);
  const fieldErrors = validateActionForm(values, actedAtIso, startedAt, new Date(ctx.runtime.now()).toISOString());
  if (Object.keys(fieldErrors).length || !actedAtIso) return data<ActionResult>({ intent, fieldErrors, values, actionId }, { status: 400 });
  const body = actionBody(values, actedAtIso);
  const result = actionId
    ? await callApi<CorrectiveAction>(ctx, request, `/api/v1/core/compliance/actions/${encodeURIComponent(actionId)}`, { method: "PUT", body })
    : await callApi<CorrectiveAction>(ctx, request, `/api/v1/core/compliance/excursions/${excursionId}/actions`, { method: "POST", body, idempotencyKey: field(form, "idempotencyKey") || newIdempotencyKey() });
  if (!result.ok) return fail(result, values);
  throw redirect(path);
}

function ActionItem({ action, timezone, lang, canAction }: { action: CorrectiveAction; timezone: string; lang: string; canAction: boolean }) {
  const { t } = useTranslation();
  const result = resultSummary(action);
  const cause = t(`compliance.actions.causes.${action.cause}`) + (action.causeNote ? `: ${action.causeNote}` : "");
  return (
    <li className="flex flex-col gap-1.5 border-b border-line py-3 last:border-0" data-action={action.actionId}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="neutral">{cause}</Badge>
        <span className="text-[13px] font-medium">{action.actionText}</span>
      </div>
      <p className="text-[12.5px] text-muted">
        {action.actor.name ?? action.actor.userId} · {formatDateTime(action.actedAt, timezone, lang)}
      </p>
      <p className="text-[12.5px]">
        <Badge tone={result.key === "confirmed" ? "success" : result.key === "unverifiable" ? "warning" : "info"}>{t(`compliance.actions.result.${result.key}`, { ratio: result.ratio, note: result.note })}</Badge>
      </p>
      {(action.linkedWorkOrderIds.length > 0 || action.linkedAlarmIds.length > 0) && (
        <p className="flex flex-wrap gap-2 text-[12.5px]">
          {action.linkedWorkOrderIds.map((id) => (
            <Link key={`w${id}`} className="text-accent hover:underline" to={`/work-orders/${id}`}>
              {t("compliance.actions.workOrder", { id })}
            </Link>
          ))}
          {action.linkedAlarmIds.map((id) => (
            <Link key={`a${id}`} className="text-accent hover:underline" to={`/alarms/${id}`}>
              {t("compliance.actions.alarm", { id })}
            </Link>
          ))}
        </p>
      )}
      {canAction && (
        <div className="flex gap-2">
          <ButtonLink to={`?edit=${action.actionId}`}>{t("common.edit")}</ButtonLink>
          <Form method="post">
            <CsrfField />
            <input type="hidden" name="intent" value="delete" />
            <input type="hidden" name="actionId" value={action.actionId} />
            <Button type="submit" variant="danger">
              {t("common.delete")}
            </Button>
          </Form>
        </div>
      )}
    </li>
  );
}

export default function ComplianceExcursionActions({ loaderData, actionData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const navigation = useNavigation();
  const root = useRouteLoaderData("root") as RootData | undefined;
  const canAction = hasAny(root?.me?.permissions, ["CMP_ACTION"]);
  const { excursion: x, editing, users, me } = loaderData;
  const timezone = root?.timezone ?? loaderData.timezone;
  const result = actionData as ActionResult | undefined;
  const values: ActionForm | undefined =
    result?.values ??
    (editing
      ? {
          cause: editing.cause,
          causeNote: editing.causeNote ?? "",
          actionText: editing.actionText,
          actorUserId: editing.actor.userId,
          actedAt: isoToZonedLocal(editing.actedAt, timezone),
          linkedAlarmIds: editing.linkedAlarmIds,
          linkedWorkOrderIds: editing.linkedWorkOrderIds,
          resultMode: editing.resultMode,
          resultNote: editing.resultNote ?? "",
        }
      : undefined);
  const actionId = result?.actionId ?? editing?.actionId ?? "";
  const errors = result?.fieldErrors ?? {};
  const v = (key: string) => (errors[key] ? t(`compliance.actions.validation.${errors[key]}`) : undefined);
  const [cause, setCause] = useState(values?.cause ?? "");
  const [mode, setMode] = useState(values?.resultMode ?? "AUTO");
  const actors = me && !users.some((u) => u.id === me.userId) ? [{ id: me.userId, name: me.name || me.userId }, ...users] : users;
  // 편집·작업 지시 만들기 뒤에는 폼을 새 값으로 다시 그린다
  const formKey = `${actionId}:${values?.linkedWorkOrderIds.join(",") ?? ""}`;
  return (
    <>
      <PageHeader title={t("compliance.actions.title")} crumb={t("compliance.status.title")} actions={<ButtonLink to="/compliance/status">{t("compliance.actions.back")}</ButtonLink>} />
      {result?.error && (
        <div className="mb-3">
          <Alert tone="danger">{errorText(t, result.error)}</Alert>
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <div className="flex flex-col gap-4">
          <Card title={t("compliance.actions.target")}>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[13px]">
              <dt className="text-muted">{t("compliance.actions.space")}</dt>
              <dd>{x.spaceName ?? x.spaceId}</dd>
              <dt className="text-muted">{t("compliance.actions.metric")}</dt>
              <dd>{metricName(t, x.metricKey)}</dd>
              <dt className="text-muted">{t("compliance.actions.period")}</dt>
              <dd>
                {formatDateTime(x.startedAt, timezone, i18n.language)} ~ {x.endedAt ? formatDateTime(x.endedAt, timezone, i18n.language) : t("compliance.status.ongoing")}
              </dd>
              <dt className="text-muted">{t("compliance.actions.peak")}</dt>
              <dd>{formatNumber(x.peakValue, i18n.language, { precision: 1 })}</dd>
              {x.alarmId && (
                <>
                  <dt className="text-muted">{t("compliance.actions.alarmLabel")}</dt>
                  <dd>
                    <Link className="text-accent hover:underline" to={`/alarms/${x.alarmId}`}>
                      {t("compliance.actions.alarm", { id: x.alarmId })}
                    </Link>
                  </dd>
                </>
              )}
            </dl>
          </Card>
          <Card title={t("compliance.actions.recorded", { n: x.actions.length })}>
            {x.actions.length ? (
              <ul>
                {x.actions.map((a) => (
                  <ActionItem key={a.actionId} action={a} timezone={timezone} lang={i18n.language} canAction={canAction} />
                ))}
              </ul>
            ) : (
              <EmptyState title={t("compliance.actions.empty")} />
            )}
          </Card>
        </div>
        {canAction && (
          <Card title={actionId ? t("compliance.actions.editTitle") : t("compliance.actions.newTitle")}>
            <Form key={formKey} method="post" className="flex flex-col gap-3">
              <CsrfField />
              <input type="hidden" name="actionId" value={actionId} />
              <input type="hidden" name="startedAt" value={x.startedAt} />
              <input type="hidden" name="idempotencyKey" value={loaderData.idempotencyKey} />
              <SelectField label={t("compliance.actions.cause")} name="cause" value={cause} onChange={(e) => setCause(e.target.value)} error={v("cause")} required>
                <option value="">{t("compliance.actions.causePlaceholder")}</option>
                {CAUSES.map((c) => (
                  <option key={c} value={c}>
                    {t(`compliance.actions.causes.${c}`)}
                  </option>
                ))}
              </SelectField>
              {(cause === "OTHER" || values?.causeNote) && <TextField label={t("compliance.actions.causeNote")} name="causeNote" defaultValue={values?.causeNote ?? ""} maxLength={200} error={v("causeNote")} />}
              <TextArea label={t("compliance.actions.actionText")} name="actionText" defaultValue={values?.actionText ?? ""} maxLength={1000} rows={4} error={v("actionText")} required />
              <SelectField label={t("compliance.actions.actor")} name="actorUserId" defaultValue={values?.actorUserId ?? me?.userId ?? ""} error={v("actorUserId")}>
                {actors.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </SelectField>
              <TextField
                type="datetime-local"
                label={t("compliance.actions.actedAt")}
                name="actedAt"
                defaultValue={values?.actedAt ?? isoToZonedLocal(loaderData.nowIso, timezone)}
                min={isoToZonedLocal(x.startedAt, timezone)}
                hint={t("compliance.actions.actedAtHint", { timezone })}
                error={v("actedAt")}
              />
              <TextField label={t("compliance.actions.alarms")} name="linkedAlarmIds" defaultValue={(values?.linkedAlarmIds ?? (x.alarmId ? [x.alarmId] : [])).join(", ")} hint={t("compliance.actions.idsHint")} error={v("linkedAlarmIds")} />
              <div className="flex flex-col gap-1">
                <TextField label={t("compliance.actions.workOrders")} name="linkedWorkOrderIds" defaultValue={(values?.linkedWorkOrderIds ?? []).join(", ")} hint={t("compliance.actions.idsHint")} error={v("linkedWorkOrderIds")} />
                <div>
                  <Button type="submit" name="intent" value="createWorkOrder" formNoValidate>
                    {t("compliance.actions.createWorkOrder")}
                  </Button>
                </div>
              </div>
              <fieldset className="flex flex-col gap-1.5">
                <legend className="text-[12.5px] font-medium">{t("compliance.actions.resultMode")}</legend>
                {RESULT_MODES.map((m) => (
                  <label key={m} className="flex items-center gap-2 text-[13px]">
                    <input type="radio" name="resultMode" value={m} checked={mode === m} onChange={() => setMode(m)} />
                    {t(`compliance.actions.modes.${m}`)}
                  </label>
                ))}
              </fieldset>
              {mode === "AUTO" ? (
                <p className="text-[12px] text-muted">{t("compliance.actions.autoHint")}</p>
              ) : (
                <TextArea label={t("compliance.actions.resultNote")} name="resultNote" defaultValue={values?.resultNote ?? ""} maxLength={500} rows={3} error={v("resultNote")} />
              )}
              <div className="flex gap-2">
                <Button type="submit" name="intent" value="save" variant="primary" disabled={navigation.state === "submitting"}>
                  {t("common.save")}
                </Button>
                {actionId && <ButtonLink to="?">{t("common.cancel")}</ButtonLink>}
              </div>
            </Form>
          </Card>
        )}
      </div>
    </>
  );
}
