/**
 * UI-IAM-01 로그인(IAM-02.01, IAM-02.05, IAM-07.11, IAM-01.06, IAM-01.08).
 * 아이디·비밀번호만(소셜 로그인·SSO 버튼 없음). TOTP 사용자는 2단계 화면으로 전환한다.
 * 폼은 BFF `POST /login`(CSRF 토큰 + Origin)으로 보내고, 성공하면 브라우저는 `data2flow_session` 쿠키 하나만 받는다.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Form, Link, data, redirect, useNavigation } from "react-router";
import { login, verifyMfa } from "~/bff/auth-flow.server";
import { field } from "~/bff/api.server";
import { UpstreamUnavailableError } from "~/bff/gateway.server";
import { bff } from "~/bff/middleware.server";
import { checkLangParam } from "~/bff/routing.server";
import { signupRequestEnabled } from "~/bff/signup-settings.server";
import { PublicShell, usePublicPath } from "~/components/public-shell";
import { Alert, Button, CsrfField, TextField } from "~/components/ui";
import { errorText } from "~/lib/error-text";
import { safeNextPath } from "~/lib/next-path";
import { announceLogout } from "~/lib/session-broadcast";
import { RECOVERY_CODE_PATTERN, TOTP_PATTERN } from "~/lib/validation";
import type { Route } from "./+types/login";

export function meta() {
  return [{ title: "data2flow" }];
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  checkLangParam(params.lang, request);
  const ctx = bff(context);
  const { session } = ctx;
  const url = new URL(request.url);
  const next = safeNextPath(url.searchParams.get("next"));
  if (session.authenticated) throw redirect(session.mustChangePassword ? "/me/security?required=password" : next);
  // 로컬 미리보기(OPS-08.01, ADR-057): localhost + Secure 쿠키 꺼짐일 때만 설정에 값이 있다(config.server.ts previewLoginFrom)
  const preview = ctx.runtime.config.previewLogin;
  return {
    step: session.pendingMfaTicket ? ("mfa" as const) : ("credentials" as const),
    next,
    reason: url.searchParams.get("reason"),
    loginId: url.searchParams.get("loginId") || preview?.loginId || "",
    previewPassword: preview?.password ?? "",
    previewAutofill: Boolean(preview),
    signupEnabled: await signupRequestEnabled(ctx, request),
  };
}

type FieldErrors = Partial<Record<"loginId" | "password" | "code", string>>;

export async function action({ request, context }: Route.ActionArgs) {
  const { session } = bff(context);
  const form = await request.formData();
  const intent = field(form, "intent");
  const next = safeNextPath(field(form, "next"));
  try {
    if (intent === "cancel-mfa") {
      session.clearPendingMfa();
      return { step: "credentials" as const };
    }
    if (intent === "mfa") {
      const code = field(form, "code").replace(/\s/g, "");
      if (!TOTP_PATTERN.test(code) && !RECOVERY_CODE_PATTERN.test(code)) {
        return data({ step: "mfa" as const, fieldErrors: { code: "totp" } as FieldErrors }, { status: 400 });
      }
      const outcome = await verifyMfa(session, code);
      if (outcome.kind === "ok") throw redirect(outcome.mustChangePassword ? "/me/security?required=password" : next);
      if (outcome.kind === "error" && outcome.code === "MFA_TICKET_EXPIRED") return data({ step: "credentials" as const, error: { code: outcome.code } }, { status: 401 });
      const error = outcome.kind === "error" ? { code: outcome.code, retryAfter: outcome.retryAfter } : { code: "MFA_CODE_INVALID" };
      return data({ step: "mfa" as const, error }, { status: outcome.kind === "error" ? outcome.status : 401 });
    }
    const loginId = field(form, "loginId").trim().toLowerCase();
    const password = field(form, "password");
    const fieldErrors: FieldErrors = {};
    if (!loginId || loginId.length < 4 || loginId.length > 30) fieldErrors.loginId = "loginId";
    if (!password) fieldErrors.password = "password";
    if (Object.keys(fieldErrors).length > 0) return data({ step: "credentials" as const, fieldErrors, loginId }, { status: 400 });
    const outcome = await login(session, loginId, password);
    if (outcome.kind === "ok") throw redirect(outcome.mustChangePassword ? "/me/security?required=password" : next);
    if (outcome.kind === "mfa") return { step: "mfa" as const };
    return data(
      { step: "credentials" as const, loginId, error: { code: outcome.code, retryAfter: outcome.retryAfter } },
      { status: outcome.status },
    );
  } catch (error) {
    if (error instanceof UpstreamUnavailableError) {
      return data({ step: "credentials" as const, error: { code: "AUTH_UNAVAILABLE" } }, { status: 503 });
    }
    throw error;
  }
}

function useCountdown(seconds: number | undefined) {
  const [left, setLeft] = useState(seconds ?? 0);
  useEffect(() => {
    setLeft(seconds ?? 0);
    if (!seconds) return;
    const timer = setInterval(() => setLeft((value) => (value > 0 ? value - 1 : 0)), 1000);
    return () => clearInterval(timer);
  }, [seconds]);
  return left;
}

export default function Login({ loaderData, actionData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const publicPath = usePublicPath();
  const busy = navigation.state !== "idle";
  const result = actionData as
    | { step?: "credentials" | "mfa"; error?: { code: string; retryAfter?: number }; fieldErrors?: FieldErrors; loginId?: string }
    | undefined;
  const step = result?.step ?? loaderData.step;
  const [showPassword, setShowPassword] = useState(false);
  const retryLeft = useCountdown(result?.error?.code?.endsWith("RATE_LIMITED") ? (result.error.retryAfter ?? 60) : undefined);

  useEffect(() => {
    // 세션이 끝나 이 화면에 왔으면 다른 탭에도 알린다(BroadcastChannel)
    if (loaderData.reason) announceLogout(loaderData.reason);
  }, [loaderData.reason]);

  const error = result?.error ? errorText(t, { ...result.error, retryAfter: retryLeft || result.error.retryAfter }) : undefined;
  const reasonText = loaderData.reason ? t(`login.reason.${loaderData.reason}`, { defaultValue: "" }) : "";

  return (
    <PublicShell
      title={step === "mfa" ? t("login.mfaTitle") : t("login.title")}
      aside={
        <div>
          <p className="text-[22px] font-bold leading-snug">{t("app.tagline")}</p>
          <p className="mt-3 text-muted">{t("login.intro")}</p>
        </div>
      }
    >
      {reasonText && !error && (
        <div className="mb-3">
          <Alert tone="warning">{reasonText}</Alert>
        </div>
      )}
      {error && (
        <div className="mb-3">
          <Alert tone="danger">{error}</Alert>
        </div>
      )}
      {loaderData.previewAutofill && step !== "mfa" && (
        <div className="mb-3" data-testid="preview-autofill">
          <Alert tone="info">{t("login.previewAutofill")}</Alert>
        </div>
      )}
      {step === "mfa" ? (
        <Form method="post" className="flex flex-col gap-3" noValidate>
          <CsrfField />
          <input type="hidden" name="intent" value="mfa" />
          <input type="hidden" name="next" value={loaderData.next} />
          <TextField
            label={t("login.code")}
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            hint={t("login.codeHint")}
            error={result?.fieldErrors?.code ? t("validation.totp") : undefined}
          />
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? t("common.processing") : t("login.verify")}
          </Button>
          <Button type="submit" variant="ghost" name="intent" value="cancel-mfa" formNoValidate>
            {t("login.backToCredentials")}
          </Button>
        </Form>
      ) : (
        <Form method="post" className="flex flex-col gap-3" noValidate>
          <CsrfField />
          <input type="hidden" name="intent" value="credentials" />
          <input type="hidden" name="next" value={loaderData.next} />
          <TextField
            label={t("login.loginId")}
            name="loginId"
            autoComplete="username"
            autoCapitalize="none"
            defaultValue={result?.loginId ?? loaderData.loginId}
            autoFocus
            error={result?.fieldErrors?.loginId ? t("validation.loginIdRequired") : undefined}
          />
          <div className="flex items-end gap-2">
            <TextField
              className="flex-1"
              label={t("login.password")}
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              defaultValue={loaderData.previewPassword}
              error={result?.fieldErrors?.password ? t("validation.passwordRequired") : undefined}
            />
            <Button onClick={() => setShowPassword((v) => !v)} aria-pressed={showPassword}>
              {showPassword ? t("login.hidePassword") : t("login.showPassword")}
            </Button>
          </div>
          <Button type="submit" variant="primary" disabled={busy || retryLeft > 0}>
            {busy ? t("common.processing") : t("login.submit")}
          </Button>
          <p className="text-[12px] text-muted">{t("login.lockNotice")}</p>
          <div className="flex justify-between text-[12.5px]">
            <Link to={publicPath("/password-reset")} className="text-accent hover:underline">
              {t("login.forgot")}
            </Link>
            {loaderData.signupEnabled && (
              <Link to={publicPath("/signup")} className="text-accent hover:underline">
                {t("login.signupRequest")}
              </Link>
            )}
          </div>
        </Form>
      )}
    </PublicShell>
  );
}
