/**
 * UI-IAM-04 보안 탭: 비밀번호 변경(IAM-01.09, API-IAM-12)과 2단계 인증(IAM-02.05, API-IAM-60·61·61a·61c).
 * - 임시 비밀번호 상태(IAM-01.02)에서는 이 화면만 열린다. 바꾸면 메뉴가 다시 보인다(AT-IAM-01.3)
 * - 비밀번호를 바꾸면 다른 기기의 로그인은 끊기고 이 기기는 유지된다(keepCurrentSession, AT-IAM-08.2)
 */
import QRCode from "qrcode";
import { useTranslation } from "react-i18next";
import { Form, data, redirect, useNavigation, useRouteLoaderData, useSearchParams } from "react-router";
import { callApi, field } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { PasswordFields } from "~/components/password-fields";
import { Alert, Badge, Button, Card, CsrfField, TextField } from "~/components/ui";
import { policyErrorText } from "~/lib/error-text";
import { TOTP_PATTERN, checkPassword } from "~/lib/validation";
import type { RootData } from "~/root";
import type { Route } from "./+types/me-security";

type Result =
  | { intent: "password"; fieldError?: string; error?: { code: string; message?: string }; changed?: boolean }
  | { intent: "mfa-setup"; otpauthUri?: string; secret?: string; qrSvg?: string; error?: { code: string; message?: string } }
  | { intent: "mfa-confirm"; recoveryCodes?: string[]; error?: { code: string; message?: string }; otpauthUri?: string; secret?: string; qrSvg?: string }
  | { intent: "mfa-disable" | "mfa-recovery"; recoveryCodes?: string[]; done?: boolean; error?: { code: string; message?: string } };

async function qrSvgOf(uri: string | undefined) {
  if (!uri) return undefined;
  return QRCode.toString(uri, { type: "svg", margin: 1, width: 180 });
}

export async function action({ request, context }: Route.ActionArgs) {
  const ctx = bff(context);
  const form = await request.formData();
  const intent = field(form, "intent");
  if (intent === "password") {
    const currentPassword = field(form, "currentPassword");
    const newPassword = field(form, "newPassword");
    if (!currentPassword) return data({ intent, fieldError: "current" } satisfies Result, { status: 400 });
    const problem = checkPassword(newPassword, { confirm: field(form, "confirmPassword") });
    if (problem) return data({ intent, fieldError: problem } satisfies Result, { status: 400 });
    const wasRequired = ctx.session.mustChangePassword;
    const result = await callApi(ctx, request, "/api/v1/core/accounts/me/password", {
      method: "PUT",
      body: { currentPassword, newPassword, keepCurrentSession: true },
      noGuards: true,
    });
    if (!result.ok) return data({ intent, error: { code: result.code, message: result.message } } satisfies Result, { status: result.status });
    ctx.session.setMustChangePassword(false);
    if (wasRequired) throw redirect("/");
    return { intent, changed: true } satisfies Result;
  }
  if (intent === "mfa-setup") {
    const result = await callApi<{ otpauthUri?: string; secret?: string }>(ctx, request, "/api/v1/core/accounts/me/mfa/setup", { method: "POST", noGuards: true });
    if (!result.ok) return data({ intent, error: { code: result.code, message: result.message } } satisfies Result, { status: result.status });
    return { intent, otpauthUri: result.data?.otpauthUri, secret: result.data?.secret, qrSvg: await qrSvgOf(result.data?.otpauthUri) } satisfies Result;
  }
  if (intent === "mfa-confirm") {
    const code = field(form, "code").trim();
    const otpauthUri = field(form, "otpauthUri") || undefined;
    const secret = field(form, "secret") || undefined;
    if (!TOTP_PATTERN.test(code)) {
      return data({ intent, error: { code: "TOTP_FORMAT" }, otpauthUri, secret, qrSvg: await qrSvgOf(otpauthUri) } satisfies Result, { status: 400 });
    }
    const result = await callApi<{ recoveryCodes?: string[] }>(ctx, request, "/api/v1/core/accounts/me/mfa/confirm", { method: "POST", body: { code }, noGuards: true });
    if (!result.ok) {
      return data({ intent, error: { code: result.code, message: result.message }, otpauthUri, secret, qrSvg: await qrSvgOf(otpauthUri) } satisfies Result, { status: result.status });
    }
    return { intent, recoveryCodes: result.data?.recoveryCodes ?? [] } satisfies Result;
  }
  if (intent === "mfa-disable" || intent === "mfa-recovery") {
    const currentPassword = field(form, "currentPassword");
    if (!currentPassword) return data({ intent, error: { code: "PASSWORD_REQUIRED" } } satisfies Result, { status: 400 });
    const result =
      intent === "mfa-disable"
        ? await callApi(ctx, request, "/api/v1/core/accounts/me/mfa", { method: "DELETE", body: { currentPassword } })
        : await callApi<{ recoveryCodes?: string[] }>(ctx, request, "/api/v1/core/accounts/me/mfa/recovery-codes", { method: "POST", body: { currentPassword } });
    if (!result.ok) return data({ intent, error: { code: result.code, message: result.message } } satisfies Result, { status: result.status });
    return { intent, done: true, recoveryCodes: (result.data as { recoveryCodes?: string[] } | undefined)?.recoveryCodes } satisfies Result;
  }
  return data({ intent: "password", error: { code: "INVALID_REQUEST" } } satisfies Result, { status: 400 });
}

function ErrorLine({ error }: { error?: { code: string; message?: string } }) {
  const { t } = useTranslation();
  if (!error) return null;
  const text = error.code === "TOTP_FORMAT" ? t("validation.totp") : error.code === "PASSWORD_REQUIRED" ? t("validation.passwordRequired") : policyErrorText(t, error);
  return <Alert tone="danger">{text}</Alert>;
}

function RecoveryCodes({ codes }: { codes: string[] }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-2">
      <Alert tone="warning">{t("me.security.recoveryOnce")}</Alert>
      <ol className="grid grid-cols-2 gap-1 font-mono text-[13px]" data-testid="recovery-codes">
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ol>
    </div>
  );
}

export default function MeSecurity({ actionData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const [params] = useSearchParams();
  const root = useRouteLoaderData("root") as RootData;
  const me = root.me;
  const result = actionData as Result | undefined;
  const required = params.get("required") ?? (me?.mustChangePassword ? "password" : root.meError === "MFA_SETUP_REQUIRED" ? "mfa" : null);
  const busy = navigation.state !== "idle";
  const passwordResult = result?.intent === "password" ? result : undefined;
  const setup = result?.intent === "mfa-setup" || result?.intent === "mfa-confirm" ? result : undefined;
  const mfaEnabled = Boolean(me?.mfaEnabled) || (result?.intent === "mfa-confirm" && Boolean(result.recoveryCodes));
  const other = result?.intent === "mfa-disable" || result?.intent === "mfa-recovery" ? result : undefined;

  return (
    <div className="grid gap-4">
      {required === "password" && <Alert tone="warning">{t("errors.AUTH_PASSWORD_CHANGE_REQUIRED")}</Alert>}
      {required === "mfa" && <Alert tone="warning">{t("errors.MFA_SETUP_REQUIRED")}</Alert>}
      <Card title={t("me.security.passwordTitle")}>
        <Form method="post" className="grid max-w-lg gap-3" noValidate>
          <CsrfField />
          <input type="hidden" name="intent" value="password" />
          {passwordResult?.changed && <Alert tone="success">{t("me.security.passwordChanged")}</Alert>}
          <ErrorLine error={passwordResult?.error} />
          <TextField
            label={t("me.security.currentPassword")}
            name="currentPassword"
            type="password"
            autoComplete="current-password"
            error={passwordResult?.fieldError === "current" ? t("validation.passwordRequired") : undefined}
          />
          <PasswordFields name="newPassword" problem={passwordResult?.fieldError !== "current" ? passwordResult?.fieldError : undefined} />
          <p className="text-[12px] text-muted">{t("me.security.otherSessionsNotice")}</p>
          <div>
            <Button type="submit" variant="primary" disabled={busy}>
              {t("me.security.changePassword")}
            </Button>
          </div>
        </Form>
      </Card>

      {!me?.mustChangePassword && (
        <Card
          title={t("me.security.mfaTitle")}
          actions={<Badge tone={mfaEnabled ? "success" : "neutral"}>{mfaEnabled ? t("me.security.mfaOn") : t("me.security.mfaOff")}</Badge>}
        >
          {setup?.intent === "mfa-confirm" && setup.recoveryCodes ? (
            <RecoveryCodes codes={setup.recoveryCodes} />
          ) : setup && (setup.otpauthUri || setup.secret) ? (
            <Form method="post" className="grid max-w-lg gap-3" noValidate>
              <CsrfField />
              <input type="hidden" name="intent" value="mfa-confirm" />
              <input type="hidden" name="otpauthUri" value={setup.otpauthUri ?? ""} />
              <input type="hidden" name="secret" value={setup.secret ?? ""} />
              <p>{t("me.security.scanQr")}</p>
              {setup.qrSvg && <div className="h-[180px] w-[180px] bg-white" dangerouslySetInnerHTML={{ __html: setup.qrSvg }} />}
              {setup.secret && <p className="font-mono text-[12px] text-muted">{t("me.security.secret", { secret: setup.secret })}</p>}
              <ErrorLine error={setup.error} />
              <TextField label={t("login.code")} name="code" inputMode="numeric" autoComplete="one-time-code" />
              <div>
                <Button type="submit" variant="primary" disabled={busy}>
                  {t("me.security.confirmMfa")}
                </Button>
              </div>
            </Form>
          ) : mfaEnabled ? (
            <div className="grid max-w-lg gap-3">
              {other?.done && other.intent === "mfa-disable" && <Alert tone="success">{t("me.security.mfaDisabled")}</Alert>}
              {other?.recoveryCodes && <RecoveryCodes codes={other.recoveryCodes} />}
              <ErrorLine error={other?.error} />
              <Form method="post" className="flex flex-wrap items-end gap-2" noValidate>
                <CsrfField />
                <TextField label={t("me.security.currentPassword")} name="currentPassword" type="password" autoComplete="current-password" />
                <Button type="submit" name="intent" value="mfa-recovery" disabled={busy}>
                  {t("me.security.regenerateRecovery")}
                </Button>
                <Button type="submit" name="intent" value="mfa-disable" variant="danger" disabled={busy}>
                  {t("me.security.disableMfa")}
                </Button>
              </Form>
            </div>
          ) : (
            <Form method="post" className="grid max-w-lg gap-3">
              <CsrfField />
              <input type="hidden" name="intent" value="mfa-setup" />
              <p className="text-muted">{t("me.security.mfaIntro")}</p>
              <ErrorLine error={setup?.error ?? other?.error} />
              <div>
                <Button type="submit" variant="primary" disabled={busy}>
                  {t("me.security.setupMfa")}
                </Button>
              </div>
            </Form>
          )}
        </Card>
      )}
    </div>
  );
}
