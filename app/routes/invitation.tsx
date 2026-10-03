/**
 * UI-IAM-02 초대 수락(IAM-01.03, API-IAM-10·10a·11). 개인정보 수집 항목·목적을 고지하고 동의를 받는다(NFR-12.01).
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Form, Link, data, redirect, useNavigation } from "react-router";
import { callApi, field } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { checkLangParam } from "~/bff/routing.server";
import { PasswordFields } from "~/components/password-fields";
import { PublicShell, usePublicPath } from "~/components/public-shell";
import { Alert, Button, Checkbox, CsrfField, TextField } from "~/components/ui";
import { bffFetch } from "~/lib/bff-client";
import { policyErrorText } from "~/lib/error-text";
import { DEFAULT_TIMEZONE, formatDateTime } from "~/lib/format";
import { checkLoginId, checkPassword } from "~/lib/validation";
import type { Route } from "./+types/invitation";

interface Invitation {
  organizationName?: string;
  invitedBy?: string | { name?: string };
  role?: string;
  email?: string;
  expiresAt?: string;
}

export function meta() {
  return [{ title: "data2flow" }];
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  checkLangParam(params.lang, request);
  const result = await callApi<Invitation>(bff(context), request, `/api/v1/core/invitations/${encodeURIComponent(params.token)}`, { anonymous: true });
  if (!result.ok) {
    if (result.status === 410 || result.status === 404 || result.code === "INVITATION_INVALID") return { invalid: true as const };
    throw data({ code: result.code }, { status: result.status });
  }
  return { invalid: false as const, invitation: result.data ?? {} };
}

type FieldErrors = Partial<Record<"loginId" | "password" | "consent", string>>;

export async function action({ request, context, params }: Route.ActionArgs) {
  const form = await request.formData();
  const loginId = field(form, "loginId").trim().toLowerCase();
  const password = field(form, "newPassword");
  const fieldErrors: FieldErrors = {};
  const idProblem = checkLoginId(loginId);
  if (idProblem) fieldErrors.loginId = idProblem;
  const pwProblem = checkPassword(password, { loginId, email: field(form, "email"), confirm: field(form, "confirmPassword") });
  if (pwProblem) fieldErrors.password = pwProblem;
  if (form.get("privacyConsent") !== "on") fieldErrors.consent = "required";
  if (Object.keys(fieldErrors).length > 0) return data({ fieldErrors, loginId }, { status: 400 });
  const result = await callApi<{ loginId: string }>(bff(context), request, `/api/v1/core/invitations/${encodeURIComponent(params.token)}/accept`, {
    method: "POST",
    body: { loginId, password, privacyConsent: true },
    anonymous: true,
  });
  if (result.ok) {
    const prefix = params.lang ? `/${params.lang}` : "";
    throw redirect(`${prefix}/login?reason=invited&loginId=${encodeURIComponent(result.data?.loginId ?? loginId)}`);
  }
  if (result.code === "INVITATION_INVALID") return data({ invalid: true, loginId }, { status: 410 });
  if (result.code === "LOGIN_ID_DUPLICATED") return data({ fieldErrors: { loginId: "duplicated" } as FieldErrors, loginId }, { status: 409 });
  if (result.code === "LOGIN_ID_INVALID") return data({ fieldErrors: { loginId: "format" } as FieldErrors, loginId }, { status: 400 });
  return data({ error: { code: result.code, message: result.message }, loginId }, { status: result.status });
}

type Availability = "idle" | "checking" | "available" | "taken" | "invalid";

function useLoginIdAvailability(token: string, loginId: string): Availability {
  const [state, setState] = useState<Availability>("idle");
  useEffect(() => {
    const value = loginId.trim().toLowerCase();
    if (!value) {
      setState("idle");
      return;
    }
    if (checkLoginId(value)) {
      setState("invalid");
      return;
    }
    setState("checking");
    let cancelled = false;
    // 입력이 멈추고 0.5초 뒤에 확인한다(UI-IAM-02)
    const timer = setTimeout(async () => {
      try {
        const response = await bffFetch(`/bff/api/core/invitations/${encodeURIComponent(token)}/login-id-availability?loginId=${encodeURIComponent(value)}`);
        const body = (await response.json()) as { response?: { available?: boolean } };
        if (!cancelled) setState(response.ok && body.response?.available ? "available" : response.ok ? "taken" : "invalid");
      } catch {
        if (!cancelled) setState("idle");
      }
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [token, loginId]);
  return state;
}

function loginIdError(t: (k: string) => string, problem: string | undefined) {
  if (!problem) return undefined;
  if (problem === "duplicated") return t("validation.loginIdDuplicated");
  if (problem === "required") return t("validation.loginIdRequired");
  return t("validation.loginIdFormat");
}

export default function InvitationAccept({ loaderData, actionData, params }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const navigation = useNavigation();
  const publicPath = usePublicPath();
  const result = actionData as { invalid?: boolean; fieldErrors?: FieldErrors; error?: { code: string; message?: string }; loginId?: string } | undefined;
  const [loginId, setLoginId] = useState(result?.loginId ?? "");
  const availability = useLoginIdAvailability(params.token, loginId);

  if (loaderData.invalid || result?.invalid) {
    return (
      <PublicShell title={t("invitation.title")}>
        <Alert tone="danger">{t("errors.INVITATION_INVALID")}</Alert>
      </PublicShell>
    );
  }
  const invitation = loaderData.invitation;
  const invitedBy = typeof invitation.invitedBy === "string" ? invitation.invitedBy : invitation.invitedBy?.name;
  return (
    <PublicShell title={t("invitation.title")}>
      <dl className="mb-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13px]">
        <dt className="text-muted">{t("invitation.organization")}</dt>
        <dd>{invitation.organizationName}</dd>
        <dt className="text-muted">{t("invitation.invitedBy")}</dt>
        <dd>{invitedBy}</dd>
        <dt className="text-muted">{t("invitation.role")}</dt>
        <dd>{invitation.role ? t(`roles.${invitation.role}`, { defaultValue: invitation.role }) : "–"}</dd>
        <dt className="text-muted">{t("invitation.email")}</dt>
        <dd>{invitation.email}</dd>
        <dt className="text-muted">{t("invitation.expiresAt")}</dt>
        <dd>{formatDateTime(invitation.expiresAt, DEFAULT_TIMEZONE, i18n.language)}</dd>
      </dl>
      <Form method="post" className="flex flex-col gap-3" noValidate>
        <CsrfField />
        <input type="hidden" name="email" value={invitation.email ?? ""} />
        {result?.error && <Alert tone="danger">{policyErrorText(t, result.error)}</Alert>}
        <TextField
          label={t("invitation.loginId")}
          name="loginId"
          autoComplete="username"
          autoCapitalize="none"
          value={loginId}
          onChange={(event) => setLoginId(event.target.value)}
          hint={availability === "available" ? t("invitation.available") : availability === "checking" ? t("invitation.checking") : t("validation.loginIdFormat")}
          error={loginIdError(t, result?.fieldErrors?.loginId ?? (availability === "taken" ? "duplicated" : undefined))}
        />
        <PasswordFields name="newPassword" problem={result?.fieldErrors?.password} />
        <div className="rounded-md border border-line bg-bg p-3 text-[12.5px] text-muted">
          <p>{t("privacy.summary")}</p>
          <Link to={publicPath("/privacy")} className="text-accent hover:underline" target="_blank" rel="noreferrer">
            {t("privacy.view")}
          </Link>
        </div>
        <Checkbox name="privacyConsent" label={t("invitation.consent")} error={result?.fieldErrors?.consent ? t("validation.consentRequired") : undefined} />
        <Button type="submit" variant="primary" disabled={navigation.state !== "idle"}>
          {t("invitation.submit")}
        </Button>
      </Form>
    </PublicShell>
  );
}
