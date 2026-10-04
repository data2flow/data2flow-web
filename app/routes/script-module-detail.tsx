/**
 * UI-SCR-06 공유 모듈 편집기(`/scripts/modules/{moduleId}`, SCR-04.01). 조회 SCRIPT_READ, 저장·버전 배포·버전 삭제 SCRIPT_WRITE.
 * API: 상세 API-SCR-18(GET). 저장(PUT)·사용처·버전 배포·삭제(API-SCR-18·19)는 브라우저에서 BFF로
 */
import { useTranslation } from "react-i18next";
import { useRouteLoaderData } from "react-router";
import { callApi, orThrow } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { PageHeader } from "~/components/ui";
import { IngestAreaTabs } from "~/features/ingest/area-tabs";
import { ScriptAreaTabs } from "~/features/scripts/area-tabs";
import { moduleApi, type ModuleDetail } from "~/features/scripts/m5-api";
import { ModuleEditor } from "~/features/scripts/module-editor";
import { hasAny } from "~/lib/permissions";
import type { RootData } from "~/root";
import type { Route } from "./+types/script-module-detail";

export function meta() {
  return [{ title: "data2flow" }];
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const ctx = bff(context);
  const module = orThrow(await callApi<ModuleDetail>(ctx, request, `/api/v1/core/script-modules/${encodeURIComponent(params.moduleId)}`));
  return { module: { ...module, id: String(module.id) } };
}

export default function ScriptModuleDetail({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const root = useRouteLoaderData("root") as RootData | undefined;
  const { module } = loaderData;
  return (
    <>
      <PageHeader crumb={t("scripts.modules.title")} title={module.name} />
      <IngestAreaTabs current="scripts" />
      <ScriptAreaTabs current="modules" />
      <ModuleEditor key={module.id} module={module} canWrite={hasAny(root?.me?.permissions, ["SCRIPT_WRITE"])} timezone={root?.timezone ?? "Asia/Seoul"} api={moduleApi} />
    </>
  );
}
