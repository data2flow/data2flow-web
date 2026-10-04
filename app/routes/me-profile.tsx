/**
 * UI-IAM-04 프로필 탭(IAM-01.05, API-IAM-15). 이름·연락처·언어·시간대를 본인이 고친다. 시간대를 바꾸면 이후 모든 화면 시각이
 * 그 시간대로 보인다(AT-IAM-08.1).
 */
import { useTranslation } from "react-i18next";
import { Form, data, useNavigation, useRouteLoaderData } from "react-router";
import { callApi, field } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { LANGUAGE_LABELS } from "~/components/public-shell";
import { Alert, Button, Card, CsrfField, SelectField, TextField } from "~/components/ui";
import { SUPPORTED_LANGUAGES } from "~/i18n";
import type { Me } from "~/lib/api-types";
import { errorText } from "~/lib/error-text";
import { COMMON_TIMEZONES, formatDateTime, isValidTimezone } from "~/lib/format";
import { E164_PATTERN, checkName } from "~/lib/validation";
import type { RootData } from "~/root";
import type { Route } from "./+types/me-profile";

type FieldErrors = Partial<Record<"name" | "phone" | "timezone" | "locale", string>>;

/** DEV-04.04 사용자별 표시 단위(API-DSH-12 `temperatureUnit`, 비우면 조직 기본) */
export async function loader({ request, context }: Route.LoaderArgs) {
  const prefs = await callApi<{ temperatureUnit?: string | null; effectiveTemperatureUnit?: string | null; version?: number }>(bff(context), request, "/api/v1/core/accounts/me/preferences", { noGuards: true });
  return { prefs: prefs.ok ? (prefs.data ?? null) : null };
}

export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  if (field(form, "intent") === "temperatureUnit") {
    const unit = field(form, "temperatureUnit");
    if (!["", "C", "F"].includes(unit)) return data({ unitError: true }, { status: 400 });
    const saved = await callApi(bff(context), request, "/api/v1/core/accounts/me/preferences", { method: "PUT", body: { temperatureUnit: unit || null, baseVersion: Number(field(form, "baseVersion")) } });
    if (saved.ok) return { unitSaved: true };
    return data({ error: { code: saved.code, message: saved.message } }, { status: saved.status });
  }
  const name = field(form, "name").trim();
  const phone = field(form, "phone").trim();
  const locale = field(form, "locale");
  const timezone = field(form, "timezone");
  const fieldErrors: FieldErrors = {};
  if (checkName(name)) fieldErrors.name = "name";
  if (phone && !E164_PATTERN.test(phone)) fieldErrors.phone = "phone";
  if (!(SUPPORTED_LANGUAGES as readonly string[]).includes(locale)) fieldErrors.locale = "locale";
  if (!isValidTimezone(timezone)) fieldErrors.timezone = "timezone";
  if (Object.keys(fieldErrors).length > 0) return data({ fieldErrors }, { status: 400 });
  const result = await callApi<Me>(bff(context), request, "/api/v1/core/accounts/me", {
    method: "PATCH",
    body: { name, phone: phone || null, locale, timezone, baseVersion: Number(field(form, "baseVersion")) },
  });
  if (result.ok) return { saved: true };
  return data({ error: { code: result.code, message: result.message } }, { status: result.status });
}

export default function MeProfile({ actionData, loaderData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const navigation = useNavigation();
  const root = useRouteLoaderData("root") as RootData;
  const me = root.me as Me;
  const result = actionData as { saved?: boolean; unitSaved?: boolean; fieldErrors?: FieldErrors; error?: { code: string; message?: string } } | undefined;
  const prefs = loaderData?.prefs;
  const fe = result?.fieldErrors ?? {};
  const zones = COMMON_TIMEZONES.includes(root.timezone) ? COMMON_TIMEZONES : [root.timezone, ...COMMON_TIMEZONES];
  return (
    <Card title={t("me.profile.title")}>
      <Form method="post" className="grid max-w-lg gap-3" noValidate>
        <CsrfField />
        <input type="hidden" name="baseVersion" value={me.version ?? 0} />
        {result?.saved && <Alert tone="success">{t("common.saved")}</Alert>}
        {result?.error && <Alert tone="danger">{errorText(t, result.error)}</Alert>}
        <TextField label={t("me.profile.loginId")} value={me.loginId} readOnly disabled />
        <TextField label={t("me.profile.email")} value={me.email ?? ""} readOnly disabled hint={t("me.profile.emailHint")} />
        <TextField label={t("me.profile.name")} name="name" defaultValue={me.name ?? ""} maxLength={50} error={fe.name ? t("validation.name") : undefined} />
        <TextField label={t("me.profile.phone")} name="phone" defaultValue={me.phone ?? ""} placeholder="+821012345678" error={fe.phone ? t("validation.phone") : undefined} />
        <SelectField label={t("me.profile.locale")} name="locale" defaultValue={me.locale ?? root.lang}>
          {SUPPORTED_LANGUAGES.map((code) => (
            <option key={code} value={code}>
              {LANGUAGE_LABELS[code]}
            </option>
          ))}
        </SelectField>
        <SelectField label={t("me.profile.timezone")} name="timezone" defaultValue={root.timezone} error={fe.timezone ? t("validation.timezone") : undefined}>
          {zones.map((zone) => (
            <option key={zone} value={zone}>
              {zone}
            </option>
          ))}
        </SelectField>
        <p className="text-[12px] text-muted" data-testid="now">
          {t("me.profile.nowIn", { time: formatDateTime(new Date().toISOString(), root.timezone, i18n.language), zone: root.timezone })}
        </p>
        <div>
          <Button type="submit" variant="primary" disabled={navigation.state !== "idle"}>
            {t("common.save")}
          </Button>
        </div>
      </Form>
      {prefs && (
        <Form method="post" className="mt-6 grid max-w-lg gap-3 border-t border-line pt-4">
          <CsrfField />
          <input type="hidden" name="intent" value="temperatureUnit" />
          <input type="hidden" name="baseVersion" value={prefs.version ?? 0} />
          {result?.unitSaved && <Alert tone="success">{t("common.saved")}</Alert>}
          <SelectField label={t("devmodel.units.mine")} name="temperatureUnit" defaultValue={prefs.temperatureUnit ?? ""}>
            <option value="">{t("devmodel.units.followOrg")}</option>
            <option value="C">{t("devmodel.units.C")}</option>
            <option value="F">{t("devmodel.units.F")}</option>
          </SelectField>
          <div>
            <Button type="submit">{t("common.save")}</Button>
          </div>
        </Form>
      )}
    </Card>
  );
}
