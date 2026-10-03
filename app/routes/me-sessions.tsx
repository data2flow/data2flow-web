/**
 * UI-IAM-04 활성 로그인 탭(IAM-03.02, IAM-07.08, API-IAM-16·17). 기기·IP·처음 로그인·마지막 활동을 보이고,
 * 현재 세션은 "이 기기"로 표시한다. 다른 기기를 종료하면 그 sid만 폐기된다(AT-IAM-08.4).
 */
import { useTranslation } from "react-i18next";
import { Form, data, useRouteLoaderData } from "react-router";
import { callApi, field, orThrow } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { Alert, Badge, Button, Card, CsrfField, Table } from "~/components/ui";
import { errorText } from "~/lib/error-text";
import { formatDateTime } from "~/lib/format";
import { describeUserAgent } from "~/lib/user-agent";
import type { RootData } from "~/root";
import type { Route } from "./+types/me-sessions";

export interface SessionRow {
  sid: string;
  userAgent?: string;
  ip?: string;
  firstLoginAt?: string;
  lastUsedAt?: string;
  current?: boolean;
}

function rowsOf(value: unknown): SessionRow[] {
  if (Array.isArray(value)) return value as SessionRow[];
  const wrapped = value as { responses?: SessionRow[]; sessions?: SessionRow[] } | undefined;
  return wrapped?.responses ?? wrapped?.sessions ?? [];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = bff(context);
  const response = await callApi<unknown>(ctx, request, "/api/v1/core/accounts/me/sessions");
  return { sessions: rowsOf(orThrow(response)) };
}

export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  const sid = field(form, "sid");
  const result = await callApi(bff(context), request, `/api/v1/core/accounts/me/sessions/${encodeURIComponent(sid)}`, { method: "DELETE" });
  if (result.ok) return { revoked: sid };
  return data({ error: { code: result.code, message: result.message } }, { status: result.status });
}

export default function MeSessions({ loaderData, actionData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const root = useRouteLoaderData("root") as RootData;
  const result = actionData as { revoked?: string; error?: { code: string; message?: string } } | undefined;
  return (
    <Card title={t("me.sessions.title")}>
      {result?.revoked && <Alert tone="success">{t("me.sessions.revoked")}</Alert>}
      {result?.error && <Alert tone="danger">{errorText(t, result.error)}</Alert>}
      <Table>
        <thead>
          <tr>
            <th>{t("me.sessions.device")}</th>
            <th>{t("me.sessions.ip")}</th>
            <th>{t("me.sessions.firstLogin")}</th>
            <th>{t("me.sessions.lastUsed")}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {loaderData.sessions.map((row) => (
            <tr key={row.sid}>
              <td>
                {describeUserAgent(row.userAgent)} {row.current && <Badge tone="info">{t("me.sessions.current")}</Badge>}
              </td>
              <td className="font-mono">{row.ip ?? "–"}</td>
              <td>{formatDateTime(row.firstLoginAt, root.timezone, i18n.language)}</td>
              <td>{formatDateTime(row.lastUsedAt, root.timezone, i18n.language)}</td>
              <td className="text-right">
                {!row.current && (
                  <Form
                    method="post"
                    onSubmit={(event) => {
                      if (!window.confirm(t("me.sessions.confirm"))) event.preventDefault();
                    }}
                  >
                    <CsrfField />
                    <input type="hidden" name="sid" value={row.sid} />
                    <Button type="submit" variant="danger">
                      {t("me.sessions.revoke")}
                    </Button>
                  </Form>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}
