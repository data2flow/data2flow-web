/**
 * UI-IAM-03 새 비밀번호 설정(IAM-02.04, API-IAM-14). 바꾸면 모든 기기에서 로그아웃된다(BR-IAM-12).
 */
import { useTranslation } from "react-i18next";
import { Form, Link, data, redirect, useNavigation } from "react-router";
import { callApi, field } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { checkLangParam } from "~/bff/routing.server";
import { PasswordFields } from "~/components/password-fields";
import { PublicShell, usePublicPath } from "~/components/public-shell";
import { Alert, Button, CsrfField } from "~/components/ui";
import { policyErrorText } from "~/lib/error-text";
import { checkPassword } from "~/lib/validation";
import type { Route } from "./+types/password-reset-confirm";

export function meta() {
  return [{ title: "data2flow" }];
}

export function loader({ request, params }: Route.LoaderArgs) {
  checkLangParam(params.lang, request);
  return null;
}

export async function action({ request, context, params }: Route.ActionArgs) {
  const form = await request.formData();
  const newPassword = field(form, "newPassword");
  const problem = checkPassword(newPassword, { confirm: field(form, "confirmPassword") });
  if (problem) return data({ fieldError: problem }, { status: 400 });
  const result = await callApi(bff(context), request, `/api/v1/core/password-resets/${encodeURIComponent(params.token)}/confirm`, {
    method: "POST",
    body: { newPassword },
    anonymous: true,
  });
  if (result.ok) throw redirect(`${params.lang ? `/${params.lang}` : ""}/login?reason=passwordReset`);
  if (result.code === "RESET_TOKEN_INVALID" || result.status === 410) return data({ invalid: true }, { status: 410 });
  return data({ error: { code: result.code, message: result.message } }, { status: result.status });
}

export default function PasswordResetConfirm({ actionData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const publicPath = usePublicPath();
  const result = actionData as { invalid?: boolean; fieldError?: string; error?: { code: string; message?: string } } | undefined;
  if (result?.invalid) {
    return (
      <PublicShell title={t("passwordReset.confirmTitle")}>
        <Alert tone="danger">{t("errors.RESET_TOKEN_INVALID")}</Alert>
        <p className="mt-4">
          <Link to={publicPath("/password-reset")} className="text-accent hover:underline">
            {t("passwordReset.requestAgain")}
          </Link>
        </p>
      </PublicShell>
    );
  }
  return (
    <PublicShell title={t("passwordReset.confirmTitle")}>
      <Form method="post" className="flex flex-col gap-3" noValidate>
        <CsrfField />
        {result?.error && <Alert tone="danger">{policyErrorText(t, result.error)}</Alert>}
        <PasswordFields name="newPassword" problem={result?.fieldError} />
        <p className="text-[12px] text-muted">{t("passwordReset.logoutNotice")}</p>
        <Button type="submit" variant="primary" disabled={navigation.state !== "idle"}>
          {t("passwordReset.change")}
        </Button>
      </Form>
    </PublicShell>
  );
}
