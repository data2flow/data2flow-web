/**
 * UI-IAM-04 내 정보 > 알림 수신(OPS-06.05, UI-RUL-11, RUL-05.02·05.04). 본인만, 모든 역할.
 * - 받을 알람: 최소 심각도와 종류 — API-DSH-26 `GET|PUT /accounts/me/notification-preferences {push, minSeverity}`(AT-OPS-13.1)
 * - 방해 금지: API-RUL-30 `PUT /accounts/me/notify-preferences {dndFrom, dndTo, dndAllowCritical, locale}`(AT-OPS-13.2, AT-RUL-08.2).
 *   현재 값 조회 API는 문서에 없어 같은 경로 GET을 시도하고, 없으면 기본값을 보인다
 * - 메신저 계정 연결: API-RUL-30 `POST …/messenger-links/start`, `DELETE …/messenger-links/{channel}`. 상태 조회도 문서에 없어 GET을 시도한다
 */
import { useTranslation } from "react-i18next";
import { Form, data, useRouteLoaderData } from "react-router";
import { callApi, field } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { Alert, Button, Card, Checkbox, CsrfField, SelectField, TextField } from "~/components/ui";
import { notifyApi, type MessengerLink } from "~/features/notify/api";
import { ResultAlert } from "~/features/notify/components/common";
import { MessengerLinkPanel } from "~/features/notify/components/messenger-link";
import { checkDnd, dndBody, isSeverity } from "~/features/notify/model/prefs";
import { SEVERITIES, rowsOf } from "~/features/notify/model/types";
import { done, failed, type NotifyActionResult } from "~/features/notify/server";
import type { RootData } from "~/root";
import type { Route } from "./+types/me-notifications";

interface PushPrefs {
  push: { alarm: boolean; workOrderAssigned: boolean; approvalRequest: boolean };
  minSeverity: string;
}
interface DndPrefs {
  dndFrom: string | null;
  dndTo: string | null;
  dndAllowCritical: boolean;
  locale: string;
}

const MESSENGER_CHANNEL = "TELEGRAM";

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = bff(context);
  const [push, dnd, links] = await Promise.all([
    callApi<PushPrefs>(ctx, request, "/api/v1/core/accounts/me/notification-preferences", { noGuards: true }),
    callApi<DndPrefs>(ctx, request, "/api/v1/core/accounts/me/notify-preferences", { noGuards: true }),
    callApi<unknown>(ctx, request, "/api/v1/core/accounts/me/messenger-links", { noGuards: true }),
  ]);
  return {
    push: push.ok ? push.data : null,
    dnd: dnd.ok ? dnd.data : null,
    link: links.ok ? (rowsOf<MessengerLink>(links.data).find((l) => l.channel === MESSENGER_CHANNEL) ?? null) : undefined,
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const ctx = bff(context);
  const form = await request.formData();
  const intent = field(form, "intent");
  if (intent === "severity") {
    const minSeverity = field(form, "minSeverity");
    if (!isSeverity(minSeverity)) return data({ intent, fieldErrors: { minSeverity: "severityInvalid" } } satisfies NotifyActionResult, { status: 400 });
    const on = (name: string) => form.get(name) === "on";
    const result = await callApi(ctx, request, "/api/v1/core/accounts/me/notification-preferences", { method: "PUT", body: { push: { alarm: on("pushAlarm"), workOrderAssigned: on("pushWorkOrder"), approvalRequest: on("pushApproval") }, minSeverity } });
    return result.ok ? done(intent, "notify.prefs.saved") : failed(intent, result);
  }
  const input = { enabled: form.get("dndEnabled") === "on", dndFrom: field(form, "dndFrom"), dndTo: field(form, "dndTo"), dndAllowCritical: form.get("dndAllowCritical") === "on", locale: field(form, "locale") };
  const problem = checkDnd(input);
  if (problem) return data({ intent: "dnd", fieldErrors: { dnd: problem } } satisfies NotifyActionResult, { status: 400 });
  const result = await callApi(ctx, request, "/api/v1/core/accounts/me/notify-preferences", { method: "PUT", body: dndBody(input) });
  return result.ok ? done("dnd", "notify.prefs.saved") : failed("dnd", result);
}

export default function MeNotifications({ loaderData, actionData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const root = useRouteLoaderData("root") as RootData | undefined;
  const result = actionData as NotifyActionResult | undefined;
  const push = loaderData.push ?? { push: { alarm: true, workOrderAssigned: true, approvalRequest: true }, minSeverity: "MAJOR" };
  const dnd = loaderData.dnd;
  const locale = dnd?.locale ?? (["ko", "en", "ja", "zh"].includes(i18n.language) ? i18n.language : "ko");
  const at = (intent: string) => (result?.intent === intent ? result : undefined);
  return (
    <div className="flex flex-col gap-4">
      <Card title={t("notify.prefs.severityTitle")}>
        <ResultAlert result={at("severity")} />
        {!loaderData.push && <Alert tone="warning">{t("notify.prefs.unavailable")}</Alert>}
        <Form method="post" className="flex flex-col gap-3">
          <CsrfField />
          <input type="hidden" name="intent" value="severity" />
          <SelectField label={t("notify.prefs.minSeverity")} name="minSeverity" defaultValue={push.minSeverity} error={at("severity")?.fieldErrors?.minSeverity ? t(`notify.prefs.errors.${at("severity")?.fieldErrors?.minSeverity}`) : undefined}>
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {t("notify.severityAtLeast", { severity: t(`notify.severity.${s}`) })}
              </option>
            ))}
          </SelectField>
          <p className="text-[12.5px] text-muted">{t("notify.prefs.minSeverityHint")}</p>
          <fieldset className="flex flex-wrap gap-4">
            <legend className="mb-1 text-[12.5px] font-medium text-muted">{t("notify.prefs.categories")}</legend>
            <Checkbox label={t("notify.prefs.pushAlarm")} name="pushAlarm" defaultChecked={push.push.alarm} />
            <Checkbox label={t("notify.prefs.pushWorkOrder")} name="pushWorkOrder" defaultChecked={push.push.workOrderAssigned} />
            <Checkbox label={t("notify.prefs.pushApproval")} name="pushApproval" defaultChecked={push.push.approvalRequest} />
          </fieldset>
          <div className="flex justify-end">
            <Button type="submit" variant="primary">
              {t("common.save")}
            </Button>
          </div>
        </Form>
      </Card>
      <Card title={t("notify.prefs.dndTitle")}>
        <ResultAlert result={at("dnd")} />
        <Form method="post" className="flex flex-col gap-3">
          <CsrfField />
          <input type="hidden" name="intent" value="dnd" />
          <Checkbox label={t("notify.prefs.dndEnabled")} name="dndEnabled" defaultChecked={Boolean(dnd?.dndFrom && dnd?.dndTo)} />
          <div className="flex flex-wrap gap-3">
            <TextField label={t("notify.prefs.dndFrom")} name="dndFrom" type="time" defaultValue={dnd?.dndFrom ?? "22:00"} />
            <TextField label={t("notify.prefs.dndTo")} name="dndTo" type="time" defaultValue={dnd?.dndTo ?? "07:00"} />
            <SelectField label={t("notify.prefs.locale")} name="locale" defaultValue={locale}>
              {["ko", "en", "ja", "zh"].map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </SelectField>
          </div>
          <Checkbox label={t("notify.prefs.dndAllowCritical")} name="dndAllowCritical" defaultChecked={dnd?.dndAllowCritical ?? true} />
          <p className="text-[12.5px] text-muted">{t("notify.prefs.dndHint")}</p>
          {at("dnd")?.fieldErrors?.dnd && <p className="text-[12.5px] text-bad">{t(`notify.prefs.errors.${at("dnd")?.fieldErrors?.dnd}`)}</p>}
          <div className="flex justify-end">
            <Button type="submit" variant="primary">
              {t("common.save")}
            </Button>
          </div>
        </Form>
      </Card>
      <Card title={t("notify.messenger.title")}>
        <MessengerLinkPanel channel={MESSENGER_CHANNEL} initial={loaderData.link} api={notifyApi} timezone={root?.timezone ?? "Asia/Seoul"} />
      </Card>
    </div>
  );
}
