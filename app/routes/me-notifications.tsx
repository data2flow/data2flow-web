/**
 * UI-IAM-04 내 정보 > 알림 수신(OPS-06.05, UI-RUL-11, RUL-05.02·05.04). 본인만, 모든 역할.
 * core API-RUL-30 하나로 읽고 쓴다: `GET|PUT /accounts/me/notify-preferences`
 *   → `{channels, minSeverity, dndFrom, dndTo, dndAllowCritical, locale, links[{channel, externalUserId(가림), linkedAt}], version}`.
 *   PUT은 보낸 키만 바꾼다(부분 저장). 웹 푸시 종류(API-DSH-26 `notification-preferences`)는 core에 없어 받을 채널로 대신한다.
 * - 받을 알람: 최소 심각도와 받을 채널(웹·텔레그램)(AT-OPS-13.1)
 * - 방해 금지: `{dndFrom, dndTo, dndAllowCritical, locale}`(AT-OPS-13.2, AT-RUL-08.2)
 * - 메신저 계정 연결: `POST …/messenger-links/start`, `DELETE …/messenger-links/{channel}`. 연결 상태는 위 `links`
 */
import { useTranslation } from "react-i18next";
import { Form, data, useRouteLoaderData } from "react-router";
import { callApi, field } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { Alert, Button, Card, Checkbox, CsrfField, SelectField, TextField } from "~/components/ui";
import { notifyApi, type NotifyPreferences } from "~/features/notify/api";
import { ResultAlert } from "~/features/notify/components/common";
import { MessengerLinkPanel } from "~/features/notify/components/messenger-link";
import { checkDnd, dndBody, isSeverity } from "~/features/notify/model/prefs";
import { SEVERITIES } from "~/features/notify/model/types";
import { done, failed, type NotifyActionResult } from "~/features/notify/server";
import type { RootData } from "~/root";
import type { Route } from "./+types/me-notifications";

const MESSENGER_CHANNEL = "TELEGRAM";
/** 받을 채널 후보(core 기본값 WEB·TELEGRAM) */
const PREF_CHANNELS = ["WEB", MESSENGER_CHANNEL];
const PREFS_PATH = "/api/v1/core/accounts/me/notify-preferences";

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = bff(context);
  const prefs = await callApi<NotifyPreferences>(ctx, request, PREFS_PATH, { noGuards: true });
  return {
    prefs: prefs.ok ? prefs.data : null,
    link: prefs.ok ? ((prefs.data.links ?? []).find((l) => l.channel === MESSENGER_CHANNEL) ?? null) : undefined,
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const ctx = bff(context);
  const form = await request.formData();
  const intent = field(form, "intent");
  if (intent === "severity") {
    const minSeverity = field(form, "minSeverity");
    if (!isSeverity(minSeverity)) return data({ intent, fieldErrors: { minSeverity: "severityInvalid" } } satisfies NotifyActionResult, { status: 400 });
    const channels = PREF_CHANNELS.filter((c) => form.get(`channel.${c}`) === "on");
    const result = await callApi(ctx, request, PREFS_PATH, { method: "PUT", body: { minSeverity, channels } });
    return result.ok ? done(intent, "notify.prefs.saved") : failed(intent, result);
  }
  const input = { enabled: form.get("dndEnabled") === "on", dndFrom: field(form, "dndFrom"), dndTo: field(form, "dndTo"), dndAllowCritical: form.get("dndAllowCritical") === "on", locale: field(form, "locale") };
  const problem = checkDnd(input);
  if (problem) return data({ intent: "dnd", fieldErrors: { dnd: problem } } satisfies NotifyActionResult, { status: 400 });
  const result = await callApi(ctx, request, PREFS_PATH, { method: "PUT", body: dndBody(input) });
  return result.ok ? done("dnd", "notify.prefs.saved") : failed("dnd", result);
}

export default function MeNotifications({ loaderData, actionData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const root = useRouteLoaderData("root") as RootData | undefined;
  const result = actionData as NotifyActionResult | undefined;
  const prefs = loaderData.prefs;
  const dnd = prefs;
  const minSeverity = prefs?.minSeverity ?? "INFO";
  const channels = prefs?.channels ?? PREF_CHANNELS;
  const locale = dnd?.locale ?? (["ko", "en", "ja", "zh"].includes(i18n.language) ? i18n.language : "ko");
  const at = (intent: string) => (result?.intent === intent ? result : undefined);
  return (
    <div className="flex flex-col gap-4">
      <Card title={t("notify.prefs.severityTitle")}>
        <ResultAlert result={at("severity")} />
        {!prefs && <Alert tone="warning">{t("notify.prefs.unavailable")}</Alert>}
        <Form method="post" className="flex flex-col gap-3">
          <CsrfField />
          <input type="hidden" name="intent" value="severity" />
          <SelectField label={t("notify.prefs.minSeverity")} name="minSeverity" defaultValue={minSeverity} error={at("severity")?.fieldErrors?.minSeverity ? t(`notify.prefs.errors.${at("severity")?.fieldErrors?.minSeverity}`) : undefined}>
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {t("notify.severityAtLeast", { severity: t(`notify.severity.${s}`) })}
              </option>
            ))}
          </SelectField>
          <p className="text-[12.5px] text-muted">{t("notify.prefs.minSeverityHint")}</p>
          <fieldset className="flex flex-wrap gap-4">
            <legend className="mb-1 text-[12.5px] font-medium text-muted">{t("notify.prefs.categories")}</legend>
            {PREF_CHANNELS.map((c) => (
              <Checkbox key={c} label={t(`notify.channel.${c}`, { defaultValue: c })} name={`channel.${c}`} defaultChecked={channels.includes(c)} />
            ))}
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
