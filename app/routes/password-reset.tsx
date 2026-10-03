/**
 * UI-IAM-03 비밀번호 재설정 요청(IAM-02.04, API-IAM-13). 계정이 있든 없든 같은 안내를 보여 준다(BR-IAM-11).
 */
import { useTranslation } from "react-i18next";
import { Form, Link, data, useNavigation } from "react-router";
import { callApi, field } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { checkLangParam } from "~/bff/routing.server";
import { PublicShell, usePublicPath } from "~/components/public-shell";
import { Alert, Button, CsrfField, TextField } from "~/components/ui";
import { errorText } from "~/lib/error-text";
import type { Route } from "./+types/password-reset";

export function meta() {
  return [{ title: "data2flow" }];
}

export function loader({ request, params }: Route.LoaderArgs) {
  checkLangParam(params.lang, request);
  return null;
}

export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  const loginIdOrEmail = field(form, "loginIdOrEmail").trim();
  if (!loginIdOrEmail) return data({ fieldError: "required" as const }, { status: 400 });
  const result = await callApi(bff(context), request, "/api/v1/core/password-resets", {
    method: "POST",
    body: { loginIdOrEmail },
    anonymous: true,
  });
  if (!result.ok && result.status === 429) return data({ error: { code: result.code, retryAfter: result.retryAfter } }, { status: 429 });
  // 계정 존재 여부를 드러내지 않도록 다른 응답은 모두 같은 안내로 처리한다
  return { sent: true };
}

export default function PasswordReset({ actionData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const publicPath = usePublicPath();
  const result = actionData as { sent?: boolean; fieldError?: string; error?: { code: string; retryAfter?: number } } | undefined;
  return (
    <PublicShell title={t("passwordReset.title")}>
      {result?.sent ? (
        <Alert tone="success">{t("passwordReset.sent")}</Alert>
      ) : (
        <Form method="post" className="flex flex-col gap-3" noValidate>
          <CsrfField />
          {result?.error && <Alert tone="danger">{errorText(t, result.error)}</Alert>}
          <TextField
            label={t("passwordReset.loginIdOrEmail")}
            name="loginIdOrEmail"
            autoComplete="username"
            error={result?.fieldError ? t("validation.required") : undefined}
          />
          <Button type="submit" variant="primary" disabled={navigation.state !== "idle"}>
            {t("passwordReset.submit")}
          </Button>
        </Form>
      )}
      <p className="mt-4 text-[12.5px]">
        <Link to={publicPath("/login")} className="text-accent hover:underline">
          {t("common.backToLogin")}
        </Link>
      </p>
    </PublicShell>
  );
}
