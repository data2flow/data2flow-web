/**
 * UI-IAM-05 가입 신청 이메일 확인(API-IAM-68). 링크를 여는 것만으로는 바꾸지 않고 [확인]을 눌러야 한다(GET에 부작용 없음).
 */
import { useTranslation } from "react-i18next";
import { Form, data } from "react-router";
import { callApi } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { checkLangParam } from "~/bff/routing.server";
import { PublicShell } from "~/components/public-shell";
import { Alert, Button, CsrfField } from "~/components/ui";
import type { Route } from "./+types/signup-verify";

export function loader({ request, params }: Route.LoaderArgs) {
  checkLangParam(params.lang, request);
  return null;
}

export async function action({ request, context, params }: Route.ActionArgs) {
  const result = await callApi(bff(context), request, `/api/v1/core/signup-requests/${encodeURIComponent(params.token)}/verify`, {
    method: "POST",
    anonymous: true,
  });
  if (result.ok) return { verified: true };
  return data({ invalid: true, code: result.code }, { status: result.status });
}

export default function SignupVerify({ actionData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const result = actionData as { verified?: boolean; invalid?: boolean } | undefined;
  return (
    <PublicShell title={t("signup.verifyTitle")}>
      {result?.verified ? (
        <Alert tone="success">{t("signup.verified")}</Alert>
      ) : result?.invalid ? (
        <Alert tone="danger">{t("errors.SIGNUP_REQUEST_INVALID")}</Alert>
      ) : (
        <Form method="post">
          <CsrfField />
          <Button type="submit" variant="primary">
            {t("signup.verify")}
          </Button>
        </Form>
      )}
    </PublicShell>
  );
}
