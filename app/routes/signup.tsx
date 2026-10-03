/**
 * UI-IAM-05 가입 신청(IAM-01.08, API-IAM-67). 조직 설정이 꺼져 있으면 404다(공개 회원가입은 없음, IAM-01.06).
 */
import { useTranslation } from "react-i18next";
import { Form, Link, data, useNavigation } from "react-router";
import { callApi, field } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { checkLangParam } from "~/bff/routing.server";
import { PasswordFields } from "~/components/password-fields";
import { PublicShell, usePublicPath } from "~/components/public-shell";
import { Alert, Button, Checkbox, CsrfField, TextArea, TextField } from "~/components/ui";
import { policyErrorText } from "~/lib/error-text";
import { EMAIL_PATTERN, checkLoginId, checkName, checkPassword } from "~/lib/validation";
import type { Route } from "./+types/signup";

export function meta() {
  return [{ title: "data2flow" }];
}

function ensureEnabled(enabled: boolean) {
  if (!enabled) throw data({ code: "SIGNUP_DISABLED" }, { status: 404 });
}

export function loader({ request, context, params }: Route.LoaderArgs) {
  checkLangParam(params.lang, request);
  ensureEnabled(bff(context).runtime.config.signupRequestEnabled);
  return null;
}

type FieldErrors = Partial<Record<"email" | "name" | "loginId" | "password" | "message" | "consent", string>>;

export async function action({ request, context }: Route.ActionArgs) {
  const ctx = bff(context);
  ensureEnabled(ctx.runtime.config.signupRequestEnabled);
  const form = await request.formData();
  const values = {
    email: field(form, "email").trim().toLowerCase(),
    name: field(form, "name").trim(),
    loginId: field(form, "loginId").trim().toLowerCase(),
    message: field(form, "message").trim(),
  };
  const password = field(form, "newPassword");
  const fieldErrors: FieldErrors = {};
  if (!EMAIL_PATTERN.test(values.email)) fieldErrors.email = "email";
  if (checkName(values.name)) fieldErrors.name = "name";
  const idProblem = checkLoginId(values.loginId);
  if (idProblem) fieldErrors.loginId = idProblem;
  const pwProblem = checkPassword(password, { loginId: values.loginId, email: values.email, confirm: field(form, "confirmPassword") });
  if (pwProblem) fieldErrors.password = pwProblem;
  if (values.message.length > 500) fieldErrors.message = "length";
  if (form.get("privacyConsent") !== "on") fieldErrors.consent = "required";
  if (Object.keys(fieldErrors).length > 0) return data({ fieldErrors, values }, { status: 400 });
  const result = await callApi(ctx, request, "/api/v1/core/signup-requests", {
    method: "POST",
    body: { ...values, password, privacyConsent: true },
    anonymous: true,
  });
  if (result.ok) return { done: true };
  if (result.code === "LOGIN_ID_DUPLICATED") return data({ fieldErrors: { loginId: "duplicated" } as FieldErrors, values }, { status: 409 });
  if (result.code === "SIGNUP_DOMAIN_NOT_ALLOWED") return data({ fieldErrors: { email: "domain" } as FieldErrors, values }, { status: 400 });
  return data({ error: { code: result.code, message: result.message, retryAfter: result.retryAfter }, values }, { status: result.status });
}

export default function Signup({ actionData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const publicPath = usePublicPath();
  const result = actionData as
    | { done?: boolean; fieldErrors?: FieldErrors; values?: Record<string, string>; error?: { code: string; message?: string } }
    | undefined;
  if (result?.done) {
    return (
      <PublicShell title={t("signup.title")}>
        <Alert tone="success">{t("signup.sent")}</Alert>
      </PublicShell>
    );
  }
  const fe = result?.fieldErrors ?? {};
  const v = result?.values ?? {};
  return (
    <PublicShell title={t("signup.title")}>
      <Form method="post" className="flex flex-col gap-3" noValidate>
        <CsrfField />
        {result?.error && <Alert tone="danger">{policyErrorText(t, result.error)}</Alert>}
        <TextField
          label={t("signup.email")}
          name="email"
          type="email"
          defaultValue={v.email}
          error={fe.email === "domain" ? t("errors.SIGNUP_DOMAIN_NOT_ALLOWED") : fe.email ? t("validation.email") : undefined}
        />
        <TextField label={t("signup.name")} name="name" defaultValue={v.name} error={fe.name ? t("validation.name") : undefined} />
        <TextField
          label={t("invitation.loginId")}
          name="loginId"
          autoCapitalize="none"
          defaultValue={v.loginId}
          error={fe.loginId === "duplicated" ? t("validation.loginIdDuplicated") : fe.loginId ? t("validation.loginIdFormat") : undefined}
        />
        <PasswordFields name="newPassword" problem={fe.password} />
        <TextArea label={t("signup.message")} name="message" maxLength={500} rows={3} defaultValue={v.message} error={fe.message ? t("validation.messageLength") : undefined} />
        <div className="rounded-md border border-line bg-bg p-3 text-[12.5px] text-muted">
          <p>{t("privacy.summary")}</p>
          <Link to={publicPath("/privacy")} className="text-accent hover:underline">
            {t("privacy.view")}
          </Link>
        </div>
        <Checkbox name="privacyConsent" label={t("invitation.consent")} error={fe.consent ? t("validation.consentRequired") : undefined} />
        <Button type="submit" variant="primary" disabled={navigation.state !== "idle"}>
          {t("signup.submit")}
        </Button>
      </Form>
    </PublicShell>
  );
}
