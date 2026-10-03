/**
 * UI-OPS-07 시스템 설정: 조직 탭(OPS-07.01, API-OPS-40)과 외부 서비스 탭(OPS-07.02, API-OPS-41·42).
 * 메일 서버(SMTP)는 초대·비밀번호 재설정 메일에 쓰여 M1에서 필요하다. 비밀값은 쓰기 전용이고 비워 두면 기존 값을 유지한다(BR-OPS-05).
 * 기능 플래그·공지 탭(OPS-11.03, OPS-13.02)은 해당 마일스톤에서 추가한다.
 */
import { useTranslation } from "react-i18next";
import { Form, data, useNavigation, useSearchParams } from "react-router";
import { callApi, callList, field, orThrow } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { LANGUAGE_LABELS } from "~/components/public-shell";
import { Alert, Badge, Button, Card, Checkbox, CsrfField, PageHeader, SelectField, Tabs, TextArea, TextField } from "~/components/ui";
import { SUPPORTED_LANGUAGES } from "~/i18n";
import { errorText } from "~/lib/error-text";
import { COMMON_TIMEZONES, isValidTimezone } from "~/lib/format";
import { buildServiceBody, EXTERNAL_KINDS, type ExternalService } from "~/lib/external-services";
import type { Route } from "./+types/admin-settings";

interface OrgSettings {
  displayName: string;
  logoUrl?: string | null;
  timezone: string;
  locale: string;
  unitSystem: string;
  dateFormat: string;
  version: number;
}

const DATE_FORMATS = ["YYYY-MM-DD", "YYYY.MM.DD", "MM/DD/YYYY", "DD/MM/YYYY"];
const LOGO_TYPES = ["image/png", "image/svg+xml"];
const LOGO_MAX_BYTES = 512 * 1024;

export function meta() {
  return [{ title: "data2flow" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = bff(context);
  const tab = new URL(request.url).searchParams.get("tab") === "services" ? "services" : "org";
  if (tab === "org") {
    return { tab, org: orThrow(await callApi<OrgSettings>(ctx, request, "/api/v1/core/org-settings")), services: [] as ExternalService[] };
  }
  const list = await callList<ExternalService>(ctx, request, "/api/v1/core/external-services");
  if (!list.ok) throw data({ code: list.code }, { status: list.status });
  return { tab, org: null, services: list.list.responses };
}

export async function action({ request, context }: Route.ActionArgs) {
  const ctx = bff(context);
  const form = await request.formData();
  const intent = field(form, "intent");
  if (intent === "org") {
    const displayName = field(form, "displayName").trim();
    const timezone = field(form, "timezone");
    const locale = field(form, "locale");
    const unitSystem = field(form, "unitSystem");
    const dateFormat = field(form, "dateFormat");
    const invalid: string[] = [];
    if (!displayName || displayName.length > 100) invalid.push("displayName");
    if (!isValidTimezone(timezone)) invalid.push("timezone");
    if (!(SUPPORTED_LANGUAGES as readonly string[]).includes(locale)) invalid.push("locale");
    if (!["METRIC", "IMPERIAL"].includes(unitSystem)) invalid.push("unitSystem");
    if (invalid.length) return data({ intent, invalid }, { status: 400 });
    const result = await callApi(ctx, request, "/api/v1/core/org-settings", {
      method: "PUT",
      body: { displayName, timezone, locale, unitSystem, dateFormat, baseVersion: Number(field(form, "baseVersion")) },
    });
    return result.ok ? { intent, saved: true } : data({ intent, error: { code: result.code, message: result.message } }, { status: result.status });
  }
  if (intent === "logo") {
    const file = form.get("logo");
    if (!(file instanceof File) || file.size === 0 || !LOGO_TYPES.includes(file.type) || file.size > LOGO_MAX_BYTES) {
      return data({ intent, invalid: ["logo"] }, { status: 400 });
    }
    const upload = new FormData();
    upload.set("file", file, file.name);
    const result = await callApi(ctx, request, "/api/v1/core/org-settings/logo", { method: "PUT", rawBody: upload });
    return result.ok ? { intent, saved: true } : data({ intent, error: { code: result.code, message: result.message } }, { status: result.status });
  }
  if (intent === "service-save" || intent === "service-test") {
    const kind = field(form, "kind");
    if (!(EXTERNAL_KINDS as readonly string[]).includes(kind)) return data({ intent, error: { code: "INVALID_REQUEST" } }, { status: 400 });
    const built = buildServiceBody(kind, form);
    if ("invalid" in built) return data({ intent, kind, invalid: built.invalid }, { status: 400 });
    if (intent === "service-test") {
      const { enabled: _enabled, baseVersion: _version, ...testBody } = built.body;
      const result = await callApi<{ ok: boolean; detail?: string }>(ctx, request, `/api/v1/core/external-services/${kind}/test`, { method: "POST", body: testBody });
      if (result.ok) return { intent, kind, test: result.data };
      return data({ intent, kind, error: { code: result.code, message: result.message } }, { status: result.status });
    }
    const result = await callApi(ctx, request, `/api/v1/core/external-services/${kind}`, { method: "PUT", body: built.body });
    return result.ok ? { intent, kind, saved: true } : data({ intent, kind, error: { code: result.code, message: result.message } }, { status: result.status });
  }
  return data({ intent, error: { code: "INVALID_REQUEST" } }, { status: 400 });
}

type ActionResult = { intent?: string; kind?: string; saved?: boolean; invalid?: string[]; error?: { code: string; message?: string }; test?: { ok: boolean; detail?: string } };

function OrgTab({ org, result }: { org: OrgSettings; result?: ActionResult }) {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const invalid = (key: string) => (result?.invalid?.includes(key) ? t(`settings.invalid.${key}`) : undefined);
  const zones = COMMON_TIMEZONES.includes(org.timezone) ? COMMON_TIMEZONES : [org.timezone, ...COMMON_TIMEZONES];
  return (
    <div className="grid gap-4">
      <Card title={t("settings.org.title")}>
        <Form method="post" className="grid max-w-lg gap-3" noValidate>
          <CsrfField />
          <input type="hidden" name="intent" value="org" />
          <input type="hidden" name="baseVersion" value={org.version} />
          {result?.intent === "org" && result.saved && <Alert tone="success">{t("common.saved")}</Alert>}
          {result?.intent === "org" && result.error && <Alert tone="danger">{errorText(t, result.error)}</Alert>}
          <TextField label={t("settings.org.displayName")} name="displayName" defaultValue={org.displayName} maxLength={100} error={invalid("displayName")} />
          <SelectField label={t("settings.org.timezone")} name="timezone" defaultValue={org.timezone} error={invalid("timezone")}>
            {zones.map((zone) => (
              <option key={zone}>{zone}</option>
            ))}
          </SelectField>
          <SelectField label={t("settings.org.locale")} name="locale" defaultValue={org.locale}>
            {SUPPORTED_LANGUAGES.map((code) => (
              <option key={code} value={code}>
                {LANGUAGE_LABELS[code]}
              </option>
            ))}
          </SelectField>
          <SelectField label={t("settings.org.unitSystem")} name="unitSystem" defaultValue={org.unitSystem}>
            <option value="METRIC">{t("settings.org.metric")}</option>
            <option value="IMPERIAL">{t("settings.org.imperial")}</option>
          </SelectField>
          <SelectField label={t("settings.org.dateFormat")} name="dateFormat" defaultValue={org.dateFormat}>
            {(DATE_FORMATS.includes(org.dateFormat) ? DATE_FORMATS : [org.dateFormat, ...DATE_FORMATS]).map((f) => (
              <option key={f}>{f}</option>
            ))}
          </SelectField>
          <div>
            <Button type="submit" variant="primary" disabled={navigation.state !== "idle"}>
              {t("common.save")}
            </Button>
          </div>
        </Form>
      </Card>
      <Card title={t("settings.org.logo")}>
        <Form method="post" encType="multipart/form-data" className="flex flex-wrap items-end gap-3">
          <CsrfField />
          <input type="hidden" name="intent" value="logo" />
          {org.logoUrl && <img src={org.logoUrl} alt={t("settings.org.logo")} className="h-10" />}
          <input type="file" name="logo" accept="image/png,image/svg+xml" aria-label={t("settings.org.logo")} />
          <Button type="submit">{t("settings.org.upload")}</Button>
        </Form>
        <p className="mt-2 text-[12px] text-muted">{t("settings.org.logoHint")}</p>
        {result?.intent === "logo" && result.invalid && <Alert tone="danger">{t("settings.invalid.logo")}</Alert>}
        {result?.intent === "logo" && result.saved && <Alert tone="success">{t("common.saved")}</Alert>}
        {result?.intent === "logo" && result.error && <Alert tone="danger">{errorText(t, result.error)}</Alert>}
      </Card>
    </div>
  );
}

function ServiceCard({ service, result }: { service: ExternalService; result?: ActionResult }) {
  const { t } = useTranslation();
  const mine = result?.kind === service.kind ? result : undefined;
  const settings = (service.settings ?? {}) as Record<string, unknown>;
  const isMail = service.kind === "MAIL";
  return (
    <Card
      title={t(`settings.services.kinds.${service.kind}`, { defaultValue: service.kind })}
      actions={
        <>
          {service.secretConfigured && <Badge tone="neutral">{t("settings.services.secretSet")}</Badge>}
          {service.lastTestResult && <Badge tone={service.lastTestResult === "OK" || service.lastTestResult === "SUCCESS" ? "success" : "danger"}>{service.lastTestResult}</Badge>}
        </>
      }
    >
      <Form method="post" className="grid gap-3" noValidate>
        <CsrfField />
        <input type="hidden" name="kind" value={service.kind} />
        <input type="hidden" name="baseVersion" value={service.version ?? 0} />
        {mine?.saved && <Alert tone="success">{t("common.saved")}</Alert>}
        {mine?.error && <Alert tone="danger">{errorText(t, mine.error)}</Alert>}
        {mine?.test && <Alert tone={mine.test.ok ? "success" : "danger"}>{mine.test.ok ? t("settings.services.testOk") : t("settings.services.testFailed", { detail: mine.test.detail ?? "" })}</Alert>}
        {mine?.invalid && <Alert tone="danger">{mine.invalid.map((key) => t(`settings.invalid.${key}`)).join(" · ")}</Alert>}
        {isMail ? (
          <>
            <input type="hidden" name="provider" value="smtp" />
            <TextField label={t("settings.mail.host")} name="host" defaultValue={String(settings.host ?? "")} />
            <TextField label={t("settings.mail.port")} name="port" type="number" min={1} max={65535} defaultValue={String(settings.port ?? 587)} />
            <SelectField label={t("settings.mail.security")} name="security" defaultValue={String(settings.security ?? "STARTTLS")}>
              <option value="STARTTLS">STARTTLS</option>
              <option value="TLS">TLS</option>
              <option value="NONE">{t("settings.mail.none")}</option>
            </SelectField>
            <TextField label={t("settings.mail.username")} name="username" autoComplete="off" defaultValue={String(settings.username ?? "")} />
            <TextField label={t("settings.mail.fromAddress")} name="fromAddress" type="email" defaultValue={String(settings.fromAddress ?? "")} />
            <TextField label={t("settings.mail.fromName")} name="fromName" defaultValue={String(settings.fromName ?? "")} />
          </>
        ) : (
          <>
            <TextField label={t("settings.services.provider")} name="provider" defaultValue={service.provider ?? ""} />
            <TextArea label={t("settings.services.settings")} name="settingsJson" rows={3} defaultValue={JSON.stringify(settings, null, 2)} />
          </>
        )}
        <TextField
          label={isMail ? t("settings.mail.password") : t("settings.services.secret")}
          name="secret"
          type="password"
          autoComplete="new-password"
          placeholder={service.secretConfigured ? "●●●●" : ""}
          hint={t("settings.services.secretHint")}
        />
        <Checkbox name="enabled" defaultChecked={service.enabled} label={t("settings.services.enabled")} />
        <div className="flex gap-2">
          <Button type="submit" name="intent" value="service-save" variant="primary">
            {t("common.save")}
          </Button>
          <Button type="submit" name="intent" value="service-test">
            {t("settings.services.test")}
          </Button>
        </div>
      </Form>
    </Card>
  );
}

export default function AdminSettings({ loaderData, actionData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const result = actionData as ActionResult | undefined;
  const tab = params.get("tab") === "services" ? "services" : loaderData.tab;
  const services = [...loaderData.services];
  if (tab === "services" && !services.some((s) => s.kind === "MAIL")) services.unshift({ kind: "MAIL", provider: "smtp", settings: {}, enabled: false, secretConfigured: false, version: 0 });
  return (
    <>
      <PageHeader crumb={t("nav.admin")} title={t("nav.settings")} />
      <Tabs
        current={tab}
        items={[
          { key: "org", label: t("settings.tabs.org"), to: "?tab=org" },
          { key: "services", label: t("settings.tabs.services"), to: "?tab=services" },
        ]}
      />
      {tab === "org" && loaderData.org ? (
        <OrgTab org={loaderData.org} result={result} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {services.map((service) => (
            <ServiceCard key={service.kind} service={service} result={result} />
          ))}
        </div>
      )}
    </>
  );
}
