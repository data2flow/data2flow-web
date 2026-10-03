/**
 * UI-IAM-12 보안 설정(IAM-02.03, IAM-02.05, IAM-03.01, IAM-01.08, API-IAM-72). 범위는 domain-model §2.9.
 * 정책 변경은 다음 로그인·재발급부터 적용된다.
 */
import { useTranslation } from "react-i18next";
import { Form, data, useNavigation } from "react-router";
import { callApi, field, orThrow } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { Alert, Button, Card, Checkbox, CsrfField, PageHeader, TextField } from "~/components/ui";
import { BUILTIN_ROLES } from "~/lib/api-types";
import { errorText } from "~/lib/error-text";
import type { Route } from "./+types/admin-security";

interface SecurityPolicy {
  sessionIdleMinutes: number;
  sessionAbsoluteHours: number;
  accessTtlMinutes: number;
  refreshTtlHours: number;
  loginMaxFailures: number;
  lockoutMinutes: number;
  mfaRequiredRoles: string[];
  signupRequestEnabled: boolean;
  signupAllowedDomains: string[];
  auditRetentionDays: number;
  version: number;
}

/** 항목별 허용 범위(domain-model §2.9) */
const POLICY_RANGES = {
  sessionIdleMinutes: [5, 240],
  sessionAbsoluteHours: [1, 24],
  accessTtlMinutes: [5, 120],
  refreshTtlHours: [1, 24],
  loginMaxFailures: [3, 10],
  lockoutMinutes: [5, 120],
  auditRetentionDays: [365, 3650],
} as const;

type NumericKey = keyof typeof POLICY_RANGES;

export function meta() {
  return [{ title: "data2flow" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  return { policy: orThrow(await callApi<SecurityPolicy>(bff(context), request, "/api/v1/core/security-policy")) };
}

export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  const body: Record<string, unknown> = {};
  const invalid: string[] = [];
  for (const [key, [min, max]] of Object.entries(POLICY_RANGES) as [NumericKey, readonly [number, number]][]) {
    const value = Number(field(form, key));
    if (!Number.isInteger(value) || value < min || value > max) invalid.push(key);
    body[key] = value;
  }
  if (invalid.length > 0) return data({ invalid }, { status: 400 });
  body.mfaRequiredRoles = form.getAll("mfaRequiredRoles").filter((v) => typeof v === "string");
  body.signupRequestEnabled = form.get("signupRequestEnabled") === "on";
  body.signupAllowedDomains = field(form, "signupAllowedDomains")
    .split(/[\s,]+/)
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
  body.baseVersion = Number(field(form, "baseVersion"));
  const result = await callApi<SecurityPolicy>(bff(context), request, "/api/v1/core/security-policy", { method: "PUT", body });
  if (result.ok) return { saved: true };
  return data({ error: { code: result.code, message: result.message } }, { status: result.status });
}

export default function AdminSecurity({ loaderData, actionData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const { policy } = loaderData;
  const result = actionData as { saved?: boolean; invalid?: string[]; error?: { code: string; message?: string } } | undefined;
  const numberField = (key: NumericKey) => (
    <TextField
      key={key}
      label={t(`security.${key}`)}
      name={key}
      type="number"
      min={POLICY_RANGES[key][0]}
      max={POLICY_RANGES[key][1]}
      defaultValue={policy[key]}
      hint={t("security.range", { min: POLICY_RANGES[key][0], max: POLICY_RANGES[key][1] })}
      error={result?.invalid?.includes(key) ? t("security.range", { min: POLICY_RANGES[key][0], max: POLICY_RANGES[key][1] }) : undefined}
    />
  );
  return (
    <>
      <PageHeader crumb={t("nav.admin")} title={t("nav.security")} />
      <Form method="post" className="grid gap-4" noValidate>
        <CsrfField />
        <input type="hidden" name="baseVersion" value={policy.version} />
        {result?.saved && <Alert tone="success">{t("security.saved")}</Alert>}
        {result?.error && <Alert tone="danger">{errorText(t, result.error)}</Alert>}
        <Card title={t("security.session")}>
          <div className="grid gap-3 md:grid-cols-4">{(["sessionIdleMinutes", "sessionAbsoluteHours", "accessTtlMinutes", "refreshTtlHours"] as const).map(numberField)}</div>
        </Card>
        <Card title={t("security.loginProtection")}>
          <div className="grid gap-3 md:grid-cols-4">{(["loginMaxFailures", "lockoutMinutes"] as const).map(numberField)}</div>
        </Card>
        <Card title={t("security.mfa")}>
          <div className="flex flex-wrap gap-4">
            {BUILTIN_ROLES.map((role) => (
              <Checkbox key={role} name="mfaRequiredRoles" value={role} defaultChecked={policy.mfaRequiredRoles?.includes(role)} label={t(`roles.${role}`)} />
            ))}
          </div>
        </Card>
        <Card title={t("security.signup")}>
          <div className="grid gap-3">
            <Checkbox name="signupRequestEnabled" defaultChecked={policy.signupRequestEnabled} label={t("security.signupEnabled")} />
            <TextField label={t("security.allowedDomains")} name="signupAllowedDomains" defaultValue={(policy.signupAllowedDomains ?? []).join(", ")} />
          </div>
        </Card>
        <Card title={t("security.audit")}>
          <div className="grid gap-3 md:grid-cols-4">{numberField("auditRetentionDays")}</div>
        </Card>
        <p className="text-[12px] text-muted">{t("security.appliesNext")}</p>
        <div>
          <Button type="submit" variant="primary" disabled={navigation.state !== "idle"}>
            {t("common.save")}
          </Button>
        </div>
      </Form>
    </>
  );
}
