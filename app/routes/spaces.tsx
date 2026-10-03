/**
 * /spaces 공간(UI-DEV-01, UI-DSH-02). 공간이 있으면 첫 공간 상세로 보내고, 빈 조직이면 시작 안내와 [사이트 추가](DEV-01.01, DSH-08.02).
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { redirect, useActionData, useLoaderData, useRouteLoaderData } from "react-router";
import { field } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { Button, EmptyState, PageHeader } from "~/components/ui";
import { AddSpaceDialog, type TreeActionResult } from "~/features/spaces/components/space-tree";
import { hasAny } from "~/lib/permissions";
import { flattenSpaces } from "~/lib/spaces";
import type { RootData } from "~/root";
import type { Route } from "./+types/spaces";
import { loadTree, treeAction } from "./spaces-shared.server";

export function meta() {
  return [{ title: "data2flow" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const tree = await loadTree(bff(context), request);
  const first = flattenSpaces(tree).find((s) => s.node.accessible !== false);
  if (first) throw redirect(`/spaces/${first.id}`);
  return { empty: true };
}

export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  return (await treeAction(bff(context), request, form, field(form, "intent"))) ?? null;
}

export default function Spaces() {
  const { t } = useTranslation();
  useLoaderData<typeof loader>();
  const result = useActionData<TreeActionResult>() ?? undefined;
  const root = useRouteLoaderData("root") as RootData | undefined;
  const canEdit = hasAny(root?.me?.permissions, ["DEV_ADMIN"]);
  const [open, setOpen] = useState(Boolean(result));
  return (
    <>
      <PageHeader title={t("nav.spaces")} />
      <EmptyState
        title={t("spaces.empty.title")}
        body={canEdit ? t("spaces.empty.body") : t("spaces.empty.askAdmin")}
        action={canEdit && <Button variant="primary" onClick={() => setOpen(true)}>{t("spaces.tree.addSite")}</Button>}
      />
      {open && <AddSpaceDialog result={result} onClose={() => setOpen(false)} />}
    </>
  );
}
