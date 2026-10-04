/**
 * UI-RUL-08 무음 일정(RUL-02.07, BR-RUL-14). ALARM_HANDLE 또는 NOTIFY_POLICY_WRITE(OPERATOR+). 무음은 알람을 기록하되 알림만 건너뛴다.
 * API-RUL-25: 목록 `GET /silences`, 만들기 `POST /silences {kind, target, startsAt?, endsAt?, recurrence?, reason?}`, 해제 `DELETE /silences/{id}`.
 * 일시 무음은 시작·끝(사용자 시간대 입력 → UTC), 반복 무음은 요일 + 시간대 또는 날짜 범위. 규칙 목록 [무음]은 `?targetType=RULE&targetId=`로 미리 채운다.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Form, data, useRouteLoaderData, useSearchParams } from "react-router";
import { callApi, callList, field } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { getMe } from "~/bff/user.server";
import { SpaceSelect } from "~/components/space-picker";
import { Alert, Badge, Button, Card, CsrfField, EmptyState, PageHeader, SelectField, Table, TextField } from "~/components/ui";
import { SILENCE_TARGETS, silencePayload, validateSilence, type Silence, type SilenceInput, type SilenceTargetType } from "~/features/alarms/model/silence";
import { localToUtc } from "~/features/explore/model/time";
import { errorText } from "~/lib/error-text";
import { formatDateTime } from "~/lib/format";
import type { SpaceNode } from "~/lib/spaces";
import type { RootData } from "~/root";
import type { Route } from "./+types/notification-silences";

export function meta() {
  return [{ title: "data2flow" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = bff(context);
  const [silences, spaces, rules, devices] = await Promise.all([
    callList<Silence>(ctx, request, "/api/v1/core/silences?size=100"),
    callApi<SpaceNode[]>(ctx, request, "/api/v1/core/spaces"),
    callList<{ ruleId: string; name: string }>(ctx, request, "/api/v1/core/rules?size=100"),
    callList<{ id: string; name: string }>(ctx, request, "/api/v1/core/devices?status=ACTIVE&size=100"),
  ]);
  return {
    silences: silences.ok ? silences.list.responses : [],
    failure: silences.ok ? null : { code: silences.code, message: silences.message },
    spaces: spaces.ok ? (spaces.data ?? []) : [],
    rules: rules.ok ? rules.list.responses.map((r) => ({ id: String(r.ruleId), name: r.name })) : [],
    devices: devices.ok ? devices.list.responses.map((d) => ({ id: String(d.id), name: d.name })) : [],
  };
}

type ActionResult = { intent: string; ok?: boolean; error?: { code: string; message?: string }; problems?: Record<string, string> };

export async function action({ request, context }: Route.ActionArgs) {
  const ctx = bff(context);
  const form = await request.formData();
  const intent = field(form, "intent");
  if (intent === "delete") {
    const result = await callApi(ctx, request, `/api/v1/core/silences/${encodeURIComponent(field(form, "silenceId"))}`, { method: "DELETE" });
    return result.ok ? { intent, ok: true } : data<ActionResult>({ intent, error: { code: result.code, message: result.message } }, { status: result.status });
  }
  if (intent !== "create") return data<ActionResult>({ intent, error: { code: "INVALID_REQUEST" } }, { status: 400 });
  const me = await getMe(ctx, request);
  const timezone = me.ok ? (me.data.timezone ?? "Asia/Seoul") : "Asia/Seoul";
  const kind = field(form, "kind") === "RECURRING" ? "RECURRING" : "ONE_TIME";
  const input: SilenceInput = {
    kind,
    targetType: (SILENCE_TARGETS as string[]).includes(field(form, "targetType")) ? (field(form, "targetType") as SilenceTargetType) : "RULE",
    targetId: field(form, "targetId"),
    startsAt: localToUtc(field(form, "startsAt"), timezone),
    endsAt: localToUtc(field(form, "endsAt"), timezone),
    repeat: field(form, "repeat") === "DATES" ? "DATES" : "WEEKLY",
    days: form.getAll("days").map(Number).filter((d) => d >= 1 && d <= 7),
    from: field(form, "from"),
    to: field(form, "to"),
    dateFrom: field(form, "dateFrom"),
    dateTo: field(form, "dateTo"),
    reason: field(form, "reason"),
  };
  const problems = validateSilence(input);
  if (Object.keys(problems).length) return data<ActionResult>({ intent, problems: problems as Record<string, string> }, { status: 400 });
  const result = await callApi(ctx, request, "/api/v1/core/silences", { method: "POST", body: silencePayload(input) });
  return result.ok ? { intent, ok: true } : data<ActionResult>({ intent, error: { code: result.code, message: result.message } }, { status: result.status });
}

export default function Silences({ loaderData, actionData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const root = useRouteLoaderData("root") as RootData | undefined;
  const [params] = useSearchParams();
  const timezone = root?.timezone ?? "Asia/Seoul";
  const result = actionData as ActionResult | undefined;
  const initialType = (SILENCE_TARGETS as string[]).includes(params.get("targetType") ?? "") ? (params.get("targetType") as SilenceTargetType) : "RULE";
  const [kind, setKind] = useState<"ONE_TIME" | "RECURRING">("ONE_TIME");
  const [repeat, setRepeat] = useState<"WEEKLY" | "DATES">("WEEKLY");
  const [targetType, setTargetType] = useState<SilenceTargetType>(initialType);
  const problem = (key: string) => (result?.problems?.[key] ? t(result.problems[key]) : undefined);
  const recurrenceText = (s: Silence) => {
    const r = s.recurrence ?? {};
    if (r.dateFrom) return `${r.dateFrom} ~ ${r.dateTo ?? ""}`;
    return `${(r.days ?? []).map((d) => t(`rules.dow.${d}`)).join(", ")} ${r.from ?? ""}~${r.to ?? ""}`;
  };
  const targetOptions = targetType === "RULE" ? loaderData.rules : targetType === "DEVICE" ? loaderData.devices : [];
  return (
    <>
      <PageHeader crumb={t("alarms.crumb")} title={t("silences.title")} />
      {result?.ok && <Alert tone="success">{t("common.saved")}</Alert>}
      {result?.error && <Alert tone="danger">{errorText(t, result.error)}</Alert>}
      {loaderData.failure && <Alert tone="danger">{errorText(t, loaderData.failure)}</Alert>}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card title={t("silences.list")}>
          {loaderData.silences.length === 0 ? (
            <EmptyState title={t("silences.empty")} />
          ) : (
            <Table>
              <thead>
                <tr>
                  <th scope="col">{t("silences.col.kind")}</th>
                  <th scope="col">{t("silences.col.target")}</th>
                  <th scope="col">{t("silences.col.when")}</th>
                  <th scope="col">{t("silences.col.reason")}</th>
                  <th scope="col">{t("silences.col.by")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {loaderData.silences.map((s) => (
                  <tr key={s.silenceId}>
                    <td>
                      {t(`silences.kind.${s.kind}`)} {s.active && <Badge tone="warning">{t("silences.active")}</Badge>}
                    </td>
                    <td>
                      {t(`silences.target.${s.target.type}`)} · {s.target.name ?? s.target.id}
                    </td>
                    <td className="font-mono text-[12.5px]">{s.kind === "ONE_TIME" ? `${formatDateTime(s.startsAt, timezone, i18n.language)} ~ ${formatDateTime(s.endsAt, timezone, i18n.language)}` : recurrenceText(s)}</td>
                    <td>{s.reason ?? ""}</td>
                    <td>{s.createdBy?.name ?? ""}</td>
                    <td>
                      <Form method="post">
                        <CsrfField />
                        <input type="hidden" name="intent" value="delete" />
                        <input type="hidden" name="silenceId" value={s.silenceId} />
                        <Button type="submit">{t("silences.release")}</Button>
                      </Form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
        <Card title={t("silences.new")}>
          <Form method="post" className="flex flex-col gap-3">
            <CsrfField />
            <input type="hidden" name="intent" value="create" />
            <div role="radiogroup" aria-label={t("silences.col.kind")} className="flex gap-3 text-[13px]">
              {(["ONE_TIME", "RECURRING"] as const).map((k) => (
                <label key={k} className="flex items-center gap-1">
                  <input type="radio" name="kind" value={k} checked={kind === k} onChange={() => setKind(k)} />
                  {t(`silences.kind.${k}`)}
                </label>
              ))}
            </div>
            <SelectField label={t("silences.targetType")} name="targetType" value={targetType} onChange={(e) => setTargetType(e.target.value as SilenceTargetType)}>
              {SILENCE_TARGETS.map((type) => (
                <option key={type} value={type}>
                  {t(`silences.target.${type}`)}
                </option>
              ))}
            </SelectField>
            {targetType === "SPACE" ? (
              <SpaceSelect spaces={loaderData.spaces} name="targetId" label={t("silences.targetId")} defaultValue={params.get("targetType") === "SPACE" ? (params.get("targetId") ?? "") : ""} error={problem("target")} />
            ) : (
              <SelectField key={targetType} label={t("silences.targetId")} name="targetId" defaultValue={params.get("targetType") === targetType ? (params.get("targetId") ?? "") : ""} error={problem("target")}>
                <option value="">{t("silences.chooseTarget")}</option>
                {targetOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </SelectField>
            )}
            {kind === "ONE_TIME" ? (
              <>
                <TextField label={t("silences.startsAt")} type="datetime-local" name="startsAt" />
                <TextField label={t("silences.endsAt")} type="datetime-local" name="endsAt" error={problem("range")} />
              </>
            ) : (
              <>
                <SelectField label={t("silences.repeat")} name="repeat" value={repeat} onChange={(e) => setRepeat(e.target.value as "WEEKLY" | "DATES")}>
                  <option value="WEEKLY">{t("silences.weekly")}</option>
                  <option value="DATES">{t("silences.dates")}</option>
                </SelectField>
                {repeat === "WEEKLY" ? (
                  <>
                    <fieldset className="flex flex-wrap gap-2 text-[13px]">
                      <legend className="text-[12.5px] text-muted">{t("rules.form.days")}</legend>
                      {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                        <label key={d} className="flex items-center gap-1">
                          <input type="checkbox" name="days" value={d} />
                          {t(`rules.dow.${d}`)}
                        </label>
                      ))}
                      {problem("days") && (
                        <p role="alert" className="w-full text-[12px] text-bad">
                          {problem("days")}
                        </p>
                      )}
                    </fieldset>
                    <div className="flex gap-2">
                      <TextField label={t("rules.form.timeFrom")} type="time" name="from" />
                      <TextField label={t("rules.form.timeTo")} type="time" name="to" error={problem("range")} />
                    </div>
                  </>
                ) : (
                  <div className="flex gap-2">
                    <TextField label={t("silences.dateFrom")} type="date" name="dateFrom" />
                    <TextField label={t("silences.dateTo")} type="date" name="dateTo" error={problem("range")} />
                  </div>
                )}
              </>
            )}
            <TextField label={t("silences.reason")} name="reason" maxLength={200} error={problem("reason")} />
            <Button type="submit" variant="primary">
              {t("silences.create")}
            </Button>
          </Form>
        </Card>
      </div>
    </>
  );
}
