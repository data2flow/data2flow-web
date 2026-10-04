/**
 * UI-DSC-10 엣지 게이트웨이 목록(`/sources/edges`, DSC-08.03). 조회 SRC_READ(OPERATOR 이상), [등록] SRC_ADMIN.
 * 등록(API-DSC-62 `{name, siteId}`, Idempotency-Key) 결과의 토큰·설치 명령은 이 응답에서 한 번만 보인다(BR-DSC-31).
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Form, data } from "react-router";
import { callApi, callList, field, listOrThrow, newIdempotencyKey } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { getMe } from "~/bff/user.server";
import { Alert, Button, Card, CsrfField, Dialog, PageHeader, SelectField, TextField } from "~/components/ui";
import { errorText } from "~/lib/error-text";
import { hasAny } from "~/lib/permissions";
import type { SpaceNode } from "~/lib/spaces";
import { IngestTabs, useTimezone } from "~/features/sources/components/common";
import { EdgeList, EdgeRegistrationCard } from "~/features/sources/components/edges";
import { SourcesSubTabs } from "~/features/sources/components/sub-tabs";
import type { EdgeGateway, EdgeRegistration } from "~/features/sources/model/edge";
import type { Route } from "./+types/source-edges";

export function meta() {
  return [{ title: "data2flow" }];
}

function sitesOf(nodes: SpaceNode[]): { id: string; name: string }[] {
  const out: { id: string; name: string }[] = [];
  const walk = (list: SpaceNode[]) => list.forEach((n) => (n.type === "SITE" ? out.push({ id: String(n.id), name: n.name }) : walk(n.children ?? [])));
  walk(nodes);
  return out;
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = bff(context);
  const [edges, spaces, me] = await Promise.all([callList<EdgeGateway>(ctx, request, "/api/v1/core/edges?size=100"), callApi<SpaceNode[]>(ctx, request, "/api/v1/core/spaces"), getMe(ctx, request)]);
  return {
    edges: listOrThrow(edges).responses,
    sites: spaces.ok && Array.isArray(spaces.data) ? sitesOf(spaces.data) : [],
    canAdmin: me.ok && hasAny(me.data.permissions, ["SRC_ADMIN"]),
    now: ctx.runtime.now(),
    idempotencyKey: newIdempotencyKey(),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const ctx = bff(context);
  const form = await request.formData();
  const name = field(form, "name").trim();
  const siteId = field(form, "siteId");
  if (!name || name.length > 100 || !siteId) return data({ error: { code: "INVALID_REQUEST" } }, { status: 400 });
  const result = await callApi<EdgeRegistration>(ctx, request, "/api/v1/core/edges", { method: "POST", idempotencyKey: field(form, "idempotencyKey") || newIdempotencyKey(), body: { name, siteId } });
  if (!result.ok) return data({ error: { code: result.code, message: result.message } }, { status: result.status });
  return { registration: result.data };
}

export default function SourceEdges({ loaderData, actionData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const timezone = useTimezone();
  const { edges, sites, canAdmin, now, idempotencyKey } = loaderData;
  const [open, setOpen] = useState(false);
  const result = actionData as { registration?: EdgeRegistration; error?: { code: string; message?: string } } | undefined;
  return (
    <>
      <IngestTabs current="sources" />
      <PageHeader title={t("sources.edges.title")} actions={canAdmin && <Button variant="primary" onClick={() => setOpen(true)}>{t("sources.edges.register")}</Button>} />
      <SourcesSubTabs current="edges" />
      {result?.error && <Alert tone="danger">{errorText(t, result.error)}</Alert>}
      {result?.registration && (
        <div className="mb-4">
          <EdgeRegistrationCard registration={result.registration} timezone={timezone} lang={i18n.language} />
        </div>
      )}
      <Card>
        <EdgeList edges={edges} now={now} lang={i18n.language} />
      </Card>
      <Dialog open={open} onClose={() => setOpen(false)} title={t("sources.edges.register")}>
        <Form method="post" className="flex flex-col gap-3" onSubmit={() => setOpen(false)}>
          <CsrfField />
          <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
          <TextField label={t("sources.edges.name")} name="name" required maxLength={100} />
          <SelectField label={t("sources.edges.site")} name="siteId" required>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </SelectField>
          <p className="text-[12px] text-muted">{t("sources.edges.registerHint")}</p>
          <div className="flex justify-end">
            <Button type="submit" variant="primary">
              {t("sources.edges.issueToken")}
            </Button>
          </div>
        </Form>
      </Dialog>
    </>
  );
}
