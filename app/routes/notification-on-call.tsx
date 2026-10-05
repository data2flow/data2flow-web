/**
 * UI-RUL-09 당직 일정(RUL-05.03, BR-RUL-19: 대체 근무 > 주간 교대, 비면 정책의 다른 수신자). 경로 권한 NOTIFY_POLICY_WRITE.
 * API-RUL-26: `GET|PUT /on-call {name, timezone, shifts[{dayOfWeek, from, to, userId}], baseVersion}`, `GET /on-call/current → {userId, name, until}`,
 * 대체 근무 `POST /on-call/overrides {startsAt, endsAt, originalUserId, substituteUserId}`(core는 원래 담당자도 필수, 응답은 근무표 전체)·
 * `DELETE /on-call/overrides/{override-id}`. 대체 근무 행은 `originalUser`·`substituteUser`({userId, name}).
 * 대체 근무 일시는 조직 시간대로 입력받아 UTC로 보낸다
 */
import { useTranslation } from "react-i18next";
import { Form, useRouteLoaderData } from "react-router";
import { callApi, field, orThrow } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { Button, Card, CsrfField, PageHeader, SelectField, Table, TextField } from "~/components/ui";
import { localToUtc } from "~/features/explore/model/time";
import { NotifyTabs, ResultAlert } from "~/features/notify/components/common";
import { ShiftEditor, WeekGrid } from "~/features/notify/components/on-call";
import { checkOverride, checkShifts, normalizeCurrent, normalizeSchedule, parseShifts } from "~/features/notify/model/oncall";
import { done, failed, invalid, loadUsers, type NotifyActionResult } from "~/features/notify/server";
import { COMMON_TIMEZONES, formatDateTime } from "~/lib/format";
import { hasAny } from "~/lib/permissions";
import type { RootData } from "~/root";
import type { Route } from "./+types/notification-on-call";

export function meta() {
  return [{ title: "data2flow" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = bff(context);
  const [schedule, current, users] = await Promise.all([
    callApi<Record<string, unknown>>(ctx, request, "/api/v1/core/on-call"),
    callApi<Record<string, unknown>>(ctx, request, "/api/v1/core/on-call/current", { noGuards: true }),
    loadUsers(ctx, request),
  ]);
  return { schedule: normalizeSchedule(orThrow(schedule)), current: current.ok ? normalizeCurrent(current.data) : null, users: users.users, usersAvailable: users.available };
}

export async function action({ request, context }: Route.ActionArgs) {
  const ctx = bff(context);
  const form = await request.formData();
  const intent = field(form, "intent");
  if (intent === "deleteOverride") {
    const result = await callApi(ctx, request, `/api/v1/core/on-call/overrides/${encodeURIComponent(field(form, "overrideId"))}`, { method: "DELETE" });
    return result.ok ? done(intent, "notify.onCall.overrideDeleted") : failed(intent, result);
  }
  if (intent === "addOverride") {
    const timezone = field(form, "timezone") || "Asia/Seoul";
    const input = { startsAt: localToUtc(field(form, "startsAt"), timezone), endsAt: localToUtc(field(form, "endsAt"), timezone), originalUserId: field(form, "originalUserId").trim(), substituteUserId: field(form, "substituteUserId").trim() };
    const problem = checkOverride(input);
    if (problem) return invalid(intent, { override: problem });
    const result = await callApi(ctx, request, "/api/v1/core/on-call/overrides", { method: "POST", body: input });
    return result.ok ? done(intent, "notify.onCall.overrideAdded") : failed(intent, result);
  }
  const shifts = parseShifts(field(form, "shifts"));
  const name = field(form, "name").trim();
  if (!name) return invalid("save", { schedule: "nameRequired" });
  if (!shifts) return invalid("save", { schedule: "shiftsInvalid" });
  const problem = checkShifts(shifts);
  if (problem) return invalid("save", { schedule: problem.code }, { n: problem.index + 1 });
  const result = await callApi(ctx, request, "/api/v1/core/on-call", { method: "PUT", body: { name, timezone: field(form, "timezone"), shifts, baseVersion: Number(field(form, "baseVersion") || 0) } });
  return result.ok ? done("save", "notify.onCall.saved") : failed("save", result);
}

export default function NotificationOnCall({ loaderData, actionData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const root = useRouteLoaderData("root") as RootData | undefined;
  const canWrite = hasAny(root?.me?.permissions, ["NOTIFY_POLICY_WRITE"]);
  const { schedule, current, users, usersAvailable } = loaderData;
  const result = actionData as NotifyActionResult | undefined;
  const tz = schedule.timezone || root?.timezone || "Asia/Seoul";
  const userName = (id: string | null, name?: string | null) => (id ? name || users.find((u) => u.id === id)?.name || id : "–");
  const scheduleError = result?.fieldErrors?.schedule ? t(`notify.onCall.errors.${result.fieldErrors.schedule}`, { n: result.payload?.n ?? "" }) : undefined;
  const overrideError = result?.fieldErrors?.override ? t(`notify.onCall.errors.${result.fieldErrors.override}`) : undefined;
  return (
    <>
      <PageHeader crumb={t("notify.crumb")} title={t("notify.onCall.title")} />
      <NotifyTabs current="onCall" />
      <ResultAlert result={result} />
      <Card className="mb-4" title={t("notify.onCall.current")}>
        <p className="text-[14px]" data-testid="on-call-current">
          {current?.userId ? t("notify.onCall.currentUntil", { name: current.name ?? current.userId, until: formatDateTime(current.until, tz, i18n.language) }) : t("notify.onCall.nobody")}
        </p>
      </Card>
      <Card className="mb-4" title={`${t("notify.onCall.week")} · ${schedule.name}`}>
        <WeekGrid shifts={schedule.shifts} users={users} />
      </Card>
      {canWrite && (
        <Card className="mb-4" title={t("notify.onCall.edit")}>
          <Form method="post" className="flex flex-col gap-3" key={schedule.version}>
            <CsrfField />
            <input type="hidden" name="intent" value="save" />
            <input type="hidden" name="baseVersion" value={schedule.version} />
            <div className="grid gap-3 md:grid-cols-2">
              <TextField label={t("notify.onCall.scheduleName")} name="name" defaultValue={schedule.name} maxLength={100} />
              <SelectField label={t("notify.onCall.timezone")} name="timezone" defaultValue={schedule.timezone}>
                {[...new Set([schedule.timezone, ...COMMON_TIMEZONES])].map((zone) => (
                  <option key={zone} value={zone}>
                    {zone}
                  </option>
                ))}
              </SelectField>
            </div>
            <ShiftEditor initial={schedule.shifts} users={users} usersAvailable={usersAvailable} />
            {scheduleError && <p className="text-[12.5px] text-bad-ink">{scheduleError}</p>}
            <div className="flex justify-end">
              <Button type="submit" variant="primary">
                {t("common.save")}
              </Button>
            </div>
          </Form>
        </Card>
      )}
      <Card title={t("notify.onCall.overrides")}>
        {schedule.overrides.length === 0 ? (
          <p className="text-[13px] text-muted">{t("notify.onCall.noOverrides")}</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>{t("notify.onCall.period")}</th>
                <th>{t("notify.onCall.original")}</th>
                <th>{t("notify.onCall.substitute")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {schedule.overrides.map((o) => (
                <tr key={o.overrideId}>
                  <td>{`${formatDateTime(o.startsAt, tz, i18n.language)} – ${formatDateTime(o.endsAt, tz, i18n.language)}`}</td>
                  <td>{userName(o.originalUserId, o.originalUserName)}</td>
                  <td>{userName(o.substituteUserId, o.substituteUserName)}</td>
                  <td>
                    {canWrite && (
                      <Form method="post">
                        <CsrfField />
                        <input type="hidden" name="intent" value="deleteOverride" />
                        <input type="hidden" name="overrideId" value={o.overrideId} />
                        <Button type="submit" variant="ghost">
                          {t("common.delete")}
                        </Button>
                      </Form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {canWrite && (
          <Form method="post" className="mt-3 flex flex-wrap items-end gap-3">
            <CsrfField />
            <input type="hidden" name="intent" value="addOverride" />
            <input type="hidden" name="timezone" value={tz} />
            <TextField label={t("notify.onCall.from")} name="startsAt" type="datetime-local" required />
            <TextField label={t("notify.onCall.to")} name="endsAt" type="datetime-local" required />
            {usersAvailable ? (
              <>
                <SelectField label={t("notify.onCall.original")} name="originalUserId" required>
                  <option value="" />
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </SelectField>
                <SelectField label={t("notify.onCall.substitute")} name="substituteUserId">
                  <option value="" />
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </SelectField>
              </>
            ) : (
              <>
                <TextField label={t("notify.onCall.original")} name="originalUserId" placeholder={t("notify.policy.userIdPlaceholder")} required />
                <TextField label={t("notify.onCall.substitute")} name="substituteUserId" placeholder={t("notify.policy.userIdPlaceholder")} />
              </>
            )}
            <Button type="submit">{t("notify.onCall.addOverride")}</Button>
            {overrideError && <p className="w-full text-[12.5px] text-bad-ink">{overrideError}</p>}
          </Form>
        )}
      </Card>
    </>
  );
}
