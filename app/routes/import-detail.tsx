/**
 * UI-TSD-03 가져오기 작업(`/imports/{id}`, TSD-04.02): 미리 실행 결과 → [가져오기 실행], 진행률·결과·오류 목록. TS_IMPORT.
 * API: API-TSD-31 상세·오류, API-TSD-32 실행.
 */
import { useTranslation } from "react-i18next";
import { Link, useRouteLoaderData } from "react-router";
import { callApi, callList, orThrow } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { PageHeader } from "~/components/ui";
import { ImportDetail } from "~/features/data/components/import-detail";
import type { ImportError, ImportJob } from "~/features/data/model/imports";
import { hasAny } from "~/lib/permissions";
import type { RootData } from "~/root";
import type { Route } from "./+types/import-detail";

export function meta() {
  return [{ title: "data2flow" }];
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const ctx = bff(context);
  const id = encodeURIComponent(params.importId);
  const [job, errors] = await Promise.all([callApi<ImportJob>(ctx, request, `/api/v1/core/imports/${id}`), callList<ImportError>(ctx, request, `/api/v1/core/imports/${id}/errors?size=100`)]);
  return { job: orThrow(job), errors: errors.ok ? errors.list.responses : [] };
}

export default function ImportDetailRoute({ loaderData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const root = useRouteLoaderData("root") as RootData | undefined;
  const { job, errors } = loaderData;
  return (
    <>
      <PageHeader
        crumb={
          <Link to="/imports" className="hover:underline">
            {t("data.imports.title")}
          </Link>
        }
        title={job.originLabel || `#${job.id}`}
      />
      <ImportDetail key={job.id} initial={job} errors={errors} canImport={hasAny(root?.me?.permissions, ["TS_IMPORT"])} timezone={root?.timezone ?? "Asia/Seoul"} lang={i18n.language} />
    </>
  );
}
